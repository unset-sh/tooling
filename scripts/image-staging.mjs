// Checks for the staging image workflow (workflows/shared/image/staging.yml).
//
//   bun scripts/image-staging.mjs dockerfile <repository> <context> <dockerfile>
//   bun scripts/image-staging.mjs license <package.json>
//   bun scripts/image-staging.mjs layout <folder> <platform> <source> <revision>
//
// `dockerfile` runs in the build job before anything of the calling repository runs. It refuses a context or
// Dockerfile outside the repository, and every image the Dockerfile would pull by a name that can move: the
// org rule is that dependencies are pinned, and a moving base tag would make the same commit build different
// images. It prints the pinned images it found, one per line.
//
// `license` prints the SPDX expression in the calling repository's package.json, for the
// org.opencontainers.image.licenses label (at most 256 characters on GHCR, github/docs
// content/packages/working-with-a-github-packages-registry/working-with-the-container-registry.md, read
// 2026-11-24).
//
// `layout` runs on both sides: in the build job on what BuildKit wrote, and in the publish job, which runs no
// code of the calling repository, on what it downloaded. It checks that the folder is an OCI image layout
// (https://github.com/opencontainers/image-spec/blob/main/image-layout.md) holding exactly one image for the
// expected platform, that every blob's name is the SHA-256 of its bytes, that no file is there that the image
// does not name, and that the image carries the source and revision labels of this run. It prints the image's
// digest, the one the publish job pushes and attests.

import { createHash } from "node:crypto";
import { createReadStream, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { startedAsScript } from "./cli.mjs";

const MAX_DOCKERFILE_BYTES = 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_BLOBS = 1000;

// The reference grammar of github.com/distribution/reference (reference.go), with the digest fixed to SHA-256.
const DOMAIN = "(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)(?:\\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?))*(?::[0-9]+)?";
const PATH = "[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*";
const TAG = "[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}";
export const PINNED_IMAGE = new RegExp(`^(?:${DOMAIN}/)?${PATH}(?:/${PATH})*(?::${TAG})?@sha256:[a-f0-9]{64}$`);

const RELATIVE = /^(?:\.|[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*)$/;
const PLATFORMS = { "linux/amd64": { os: "linux", architecture: "amd64" }, "linux/arm64": { os: "linux", architecture: "arm64" } };
const SPDX = /^[A-Za-z0-9.+-]+(?: (?:AND|OR|WITH) [A-Za-z0-9.+-]+)*$/;

/** A path given as an input, resolved inside the repository, or an error. */
export function inside(repository, path, what) {
  if (!RELATIVE.test(path) || path.split("/").some((part) => part === "..")) {
    throw new Error(`${what} '${path}' is not a plain relative path inside the repository`);
  }
  const root = realpathSync(repository);
  const target = resolve(root, path);
  if (target !== root && !target.startsWith(root + sep)) throw new Error(`${what} '${path}' is outside the repository`);
  const stat = lstatSync(target, { throwIfNoEntry: false });
  if (stat === undefined) throw new Error(`${what} '${path}' does not exist`);
  // Any link on the way makes the real path differ from the path as written.
  if (realpathSync(target) !== target) throw new Error(`${what} '${path}' is reached through a symbolic link`);
  return { target, stat };
}

// What follows reads a Dockerfile the way BuildKit v0.35.0 does (frontend/dockerfile/parser/parser.go,
// directives.go and split_command.go at that tag, read 2026-11-24), and refuses every shape where a smaller
// reader could see something else: a check that says "pinned" while BuildKit pulls a moving tag is worse than
// none. Shapes it refuses are rare in practice, and each refusal says how to write the line instead.
const KEYWORDS = new Set(["ADD", "ARG", "CMD", "COPY", "ENTRYPOINT", "ENV", "EXPOSE", "FROM", "HEALTHCHECK", "LABEL",
  "MAINTAINER", "ONBUILD", "RUN", "SHELL", "STOPSIGNAL", "USER", "VOLUME", "WORKDIR"]);
// Whitespace other than space and tab. Go's unicode.IsSpace and JavaScript's \s disagree on some of these, and
// split_command.go tests single bytes, so a byte inside a UTF-8 character can split a flag there.
const ODD_SPACE = /[\v\f\r\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/;
// A directive is a comment `# name=value` before anything else; directives.go `directiveRegexp`.
const DIRECTIVE = /^[ \t]*#[ \t]*([a-zA-Z][a-zA-Z0-9]*)[ \t]*=[ \t]*(.+?)[ \t]*$/;
// The heredoc forms this check reads (parser.go `reHeredoc`, narrowed): an optional descriptor, an optional
// dash, and a plain name, quoted whole or not at all.
const HEREDOC = /^(\d*)<<(-?)(["']?)([A-Za-z_][A-Za-z0-9_]*)\3$/;
const HEREDOC_KEYWORDS = new Set(["RUN", "COPY", "ADD"]);

/** The parser directives at the top of a Dockerfile, lower-cased names (Dockerfile reference, "Parser directives"). */
function directives(lines) {
  const found = {};
  let index = 0;
  for (; index < lines.length; index += 1) {
    const match = DIRECTIVE.exec(lines[index]);
    if (match === null) break;
    const name = match[1].toLowerCase();
    // An unknown directive is a comment, and no directive is looked for after a comment.
    if (!["syntax", "escape", "check"].includes(name)) break;
    if (name in found) throw new Error(`the parser directive '${name}' appears twice`);
    found[name] = match[2];
  }
  return found;
}

/** The names of the heredocs a RUN, COPY or ADD line opens, in order, or an error for a form not read here. */
function heredocs(line, number, words) {
  const keyword = words[0].toUpperCase() === "ONBUILD" ? words[1]?.toUpperCase() : words[0].toUpperCase();
  if (!HEREDOC_KEYWORDS.has(keyword) || !line.includes("<<")) return [];
  const names = [];
  let plain = true;
  // BuildKit splits this line into words with \ as the escape whatever the escape directive says (parser.go
  // `heredocsFromLine`), so a backslash is refused here even when the escape is a backtick.
  for (const word of words) {
    const match = HEREDOC.exec(word);
    if (match !== null) names.push({ name: match[4], strip: match[2] === "-" });
    else if (word.includes("<<") || /["'$`\\]/.test(word)) plain = false;
  }
  if (!plain) {
    throw new Error(
      `line ${number}: '<<' on a ${keyword} line is read only in the plain form <<NAME, <<-NAME, <<"NAME" or <<'NAME', ` +
        "with no other quote, backslash, backtick or $ on the line; move the rest of the command into the heredoc",
    );
  }
  return names;
}

/** The instructions of a Dockerfile: continuation lines joined, comments and heredoc bodies left out. */
export function instructions(text) {
  // Lines end at \n, and every trailing \r or \n is trimmed (parser.go `scanLines`, `trimNewline`).
  const lines = text.replace(/^\uFEFF/, "").split("\n").map((line) => line.replace(/\r+$/, ""));
  for (const [index, line] of lines.entries()) {
    if (ODD_SPACE.test(line)) throw new Error(`line ${index + 1}: write whitespace as spaces and tabs only`);
  }
  // DetectSyntax drops a #! first line, then reads the syntax directive; the parser reads that line as a comment.
  if (lines[0].startsWith("#!")) throw new Error("line 1: a #! line changes which syntax directive BuildKit reads; remove it");
  const found = directives(lines);
  const escape = found.escape ?? "\\";
  if (escape !== "\\" && escape !== "`") throw new Error(`the escape directive '${escape}' is neither \\ nor \``);
  const e = escape === "\\" ? "\\\\" : "`";
  // An escape character at the end, not itself escaped, continues the line (parser.go `setEscapeToken`).
  const continued = new RegExp(`(^|[^${e}])${e}[ \\t]*$`);
  const blank = /^[ \t]*$/;
  const comment = /^[ \t]*#/;
  const result = [];
  let index = 0;
  while (index < lines.length) {
    const number = index + 1;
    let line = lines[index].replace(/^[ \t]+/, "");
    index += 1;
    if (blank.test(line) || comment.test(line)) continue;
    while (continued.test(line)) {
      line = line.replace(continued, "$1");
      // Comment lines and empty lines inside a continued instruction are dropped; the rest is joined as it is.
      while (index < lines.length && (comment.test(lines[index]) || blank.test(lines[index]))) index += 1;
      if (index >= lines.length) break;
      line += lines[index];
      index += 1;
    }
    const words = line.trim().split(/[ \t]+/);
    const keyword = words[0].toUpperCase();
    if (!KEYWORDS.has(keyword)) throw new Error(`line ${number}: '${words[0]}' is not a Dockerfile instruction`);
    // A heredoc's body is data, not instructions: skip to the line that ends it, each heredoc of the line in turn.
    for (const { name, strip } of heredocs(line, number, words)) {
      while (index < lines.length && (strip ? lines[index].replace(/^\t+/, "") : lines[index]) !== name) index += 1;
      if (index >= lines.length) throw new Error(`the heredoc ${name} opened on line ${number} is never closed`);
      index += 1;
    }
    result.push({ line: number, keyword, words: words.slice(1) });
  }
  return { syntax: found.syntax, instructions: result };
}

/** Every image a Dockerfile would pull, each refused unless pinned by digest. Returns the pinned ones. */
export function pinnedImages(text) {
  const { syntax, instructions: list } = instructions(text);
  const images = [];
  const stages = [];
  const refuse = (line, what, reference) => {
    throw new Error(
      `line ${line}: ${what} '${reference}' is not pinned by digest; write it as name:tag@sha256:<64 hex> or name@sha256:<64 hex>`,
    );
  };
  // An earlier stage, named; COPY --from also takes an earlier stage's number (dockerfile2llb convert.go).
  const image = (line, what, reference, byNumber = false) => {
    if (reference.includes("$")) throw new Error(`line ${line}: ${what} '${reference}' uses a build argument; name the image itself`);
    if (stages.includes(reference.toLowerCase())) return;
    if (byNumber && /^[0-9]+$/.test(reference) && Number(reference) < stages.length) return;
    if (!PINNED_IMAGE.test(reference)) refuse(line, what, reference);
    images.push(reference);
  };
  if (syntax !== undefined) {
    // The syntax directive pulls the Dockerfile frontend itself as an image.
    if (!PINNED_IMAGE.test(syntax)) refuse(1, "the syntax directive", syntax);
    images.push(syntax);
  }
  const first = list.find(({ keyword }) => keyword !== "ARG");
  if (first !== undefined && first.keyword !== "FROM") throw new Error(`line ${first.line}: only ARG may come before the first FROM`);
  for (const { line, keyword, words } of list) {
    const flags = [];
    let position = 0;
    while (position < words.length && words[position].startsWith("--")) flags.push(words[position++]);
    // Without quotes and escapes, BuildKit's flag reader (split_command.go) and a split at spaces agree.
    for (const flag of flags) {
      if (!/^[\x21-\x7e]+$/.test(flag) || /["'`\\]/.test(flag)) {
        throw new Error(`line ${line}: the flag '${flag}' may not contain a quote, a backslash, a backtick or a non-ASCII character`);
      }
    }
    if (keyword === "FROM") {
      const reference = words[position];
      if (reference === undefined) throw new Error(`line ${line}: FROM names no image`);
      const rest = words.slice(position + 1);
      if (!(rest.length === 0 || (rest.length === 2 && rest[0].toUpperCase() === "AS"))) {
        throw new Error(`line ${line}: FROM has words after the image other than AS <name>`);
      }
      if (reference.toLowerCase() !== "scratch") image(line, "FROM", reference);
      stages.push(rest.length === 2 ? rest[1].toLowerCase() : `\u0000${stages.length}`);
    } else if (keyword === "COPY") {
      for (const flag of flags) {
        const match = /^--from=(.*)$/.exec(flag);
        if (match !== null) image(line, "COPY --from", match[1], true);
      }
    } else if (keyword === "RUN") {
      for (const flag of flags) {
        const match = /^--mount=(.*)$/.exec(flag);
        if (match === null) continue;
        // Keys are lower-cased and not trimmed (instructions/commands_runmount.go `parseMount`).
        for (const option of match[1].split(",")) {
          const [key, ...value] = option.split("=");
          if (key.toLowerCase() === "from") image(line, "RUN --mount from", value.join("="));
        }
      }
    }
  }
  if (stages.length === 0) throw new Error("the Dockerfile has no FROM");
  return images;
}

/** Checks the context and Dockerfile inputs, then every image the Dockerfile pulls. */
export function checkDockerfile(repository, context, dockerfile) {
  const { stat: contextStat } = inside(repository, context, "context");
  if (!contextStat.isDirectory()) throw new Error(`context '${context}' is not a folder`);
  const { target, stat } = inside(repository, dockerfile, "dockerfile");
  if (!stat.isFile()) throw new Error(`dockerfile '${dockerfile}' is not a regular file`);
  if (stat.size > MAX_DOCKERFILE_BYTES) throw new Error(`dockerfile '${dockerfile}' is larger than 1 MiB`);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(target));
  return pinnedImages(text);
}

/** The SPDX expression in a package.json's `license`. */
export function license(packageJson) {
  const value = JSON.parse(readFileSync(packageJson, "utf8"))?.license;
  if (typeof value !== "string" || value.length > 256 || !SPDX.test(value)) {
    throw new Error("package.json has no plain SPDX expression in 'license' for the org.opencontainers.image.licenses label");
  }
  return value;
}

function readJson(path, what) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile()) throw new Error(`${what} is missing or not a regular file`);
  if (stat.size > MAX_JSON_BYTES) throw new Error(`${what} is larger than 4 MiB`);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)));
  } catch {
    throw new Error(`${what} is not JSON`);
  }
}

function names(folder, expected, what) {
  const found = readdirSync(folder).sort();
  if (expected !== undefined && found.join(",") !== [...expected].sort().join(",")) {
    throw new Error(`${what} holds ${JSON.stringify(found)}, expected ${JSON.stringify([...expected].sort())}`);
  }
  return found;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const DIGEST = /^sha256:([a-f0-9]{64})$/;
const LAYER = /^application\/vnd\.oci\.image\.layer\.v1\.tar(?:\+gzip|\+zstd)?$/;

/** A descriptor the image names: an OCI media type, a SHA-256 digest of a blob in the folder, and its size. */
function described(descriptor, blobs, what, mediaType) {
  if (descriptor === null || typeof descriptor !== "object") throw new Error(`${what} is not a descriptor`);
  if (!mediaType.test(descriptor.mediaType ?? "")) throw new Error(`${what} has media type '${descriptor.mediaType}'`);
  const hex = DIGEST.exec(descriptor.digest ?? "")?.[1];
  if (hex === undefined) throw new Error(`${what} has digest '${descriptor.digest}', not sha256:<64 hex>`);
  const blob = blobs.get(hex);
  if (blob === undefined) throw new Error(`${what} names ${descriptor.digest}, which is not in the layout`);
  if (descriptor.size !== blob.size) throw new Error(`${what} says ${descriptor.size} bytes, the blob has ${blob.size}`);
  return hex;
}

/** Checks an OCI image layout folder and returns the digest of the one image in it. */
export async function checkLayout(folder, platform, source, revision) {
  const expected = PLATFORMS[platform];
  if (expected === undefined) throw new Error(`platform '${platform}' is not one of ${Object.keys(PLATFORMS).join(", ")}`);
  const root = lstatSync(folder, { throwIfNoEntry: false });
  if (root === undefined || root.isSymbolicLink() || !root.isDirectory()) throw new Error("the layout is not a folder");
  names(folder, ["blobs", "index.json", "oci-layout"], "the layout");
  for (const [path, what] of [[join(folder, "blobs"), "blobs"], [join(folder, "blobs", "sha256"), "blobs/sha256"]]) {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat === undefined || stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${what} is not a folder`);
  }
  names(join(folder, "blobs"), ["sha256"], "blobs");
  const blobs = new Map();
  const listed = names(join(folder, "blobs", "sha256"), undefined, "blobs/sha256");
  if (listed.length > MAX_BLOBS) throw new Error(`the layout holds ${listed.length} blobs, more than ${MAX_BLOBS}`);
  for (const name of listed) {
    if (!/^[a-f0-9]{64}$/.test(name)) throw new Error(`blobs/sha256/${name} is not named by a SHA-256 digest`);
    const path = join(folder, "blobs", "sha256", name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`blobs/sha256/${name} is not a regular file`);
    if ((await sha256(path)) !== name) throw new Error(`blobs/sha256/${name} does not hash to its name`);
    blobs.set(name, { path, size: stat.size });
  }

  const marker = readJson(join(folder, "oci-layout"), "oci-layout");
  if (JSON.stringify(marker) !== '{"imageLayoutVersion":"1.0.0"}') throw new Error("oci-layout is not image layout version 1.0.0");
  const index = readJson(join(folder, "index.json"), "index.json");
  if (index?.schemaVersion !== 2 || index.mediaType !== "application/vnd.oci.image.index.v1+json") {
    throw new Error("index.json is not an OCI image index");
  }
  if (!Array.isArray(index.manifests) || index.manifests.length !== 1) {
    throw new Error(`index.json names ${index.manifests?.length ?? 0} manifests; expected exactly one image`);
  }
  const entry = index.manifests[0];
  const manifestHex = described(entry, blobs, "the image in index.json", /^application\/vnd\.oci\.image\.manifest\.v1\+json$/);
  if (entry.platform?.os !== expected.os || entry.platform?.architecture !== expected.architecture) {
    throw new Error(`index.json names an image for ${entry.platform?.os}/${entry.platform?.architecture}, expected ${platform}`);
  }

  const manifest = readJson(blobs.get(manifestHex).path, "the image manifest");
  if (manifest?.schemaVersion !== 2 || manifest.mediaType !== "application/vnd.oci.image.manifest.v1+json") {
    throw new Error("the image manifest is not an OCI image manifest");
  }
  if ("subject" in manifest || "manifests" in manifest) throw new Error("the image manifest refers to other manifests");
  const configHex = described(manifest.config, blobs, "the image config", /^application\/vnd\.oci\.image\.config\.v1\+json$/);
  if (!Array.isArray(manifest.layers) || manifest.layers.length === 0) throw new Error("the image has no layers");
  const used = new Set([manifestHex, configHex]);
  manifest.layers.forEach((layer, number) => used.add(described(layer, blobs, `layer ${number + 1}`, LAYER)));
  const extra = [...blobs.keys()].filter((hex) => !used.has(hex));
  if (extra.length > 0) throw new Error(`the layout holds blobs the image does not name: ${extra.join(", ")}`);

  const config = readJson(blobs.get(configHex).path, "the image config");
  if (config?.os !== expected.os || config.architecture !== expected.architecture) {
    throw new Error(`the image config is for ${config?.os}/${config?.architecture}, expected ${platform}`);
  }
  const labels = config.config?.Labels ?? {};
  if (labels["org.opencontainers.image.source"] !== source) throw new Error(`the source label is not ${source}`);
  if (labels["org.opencontainers.image.revision"] !== revision) throw new Error(`the revision label is not ${revision}`);
  const licenses = labels["org.opencontainers.image.licenses"];
  if (typeof licenses !== "string" || licenses.length > 256 || !SPDX.test(licenses)) throw new Error("the licenses label is not an SPDX expression");
  return `sha256:${manifestHex}`;
}

if (startedAsScript(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "dockerfile" && args.length === 3) {
      for (const reference of checkDockerfile(...args)) console.log(reference);
    } else if (command === "license" && args.length === 1) {
      console.log(license(args[0]));
    } else if (command === "layout" && args.length === 4 && isAbsolute(args[0])) {
      console.log(await checkLayout(...args));
    } else {
      console.error(
        "usage: image-staging.mjs dockerfile <repository> <context> <dockerfile> | license <package.json> | layout <absolute folder> <platform> <source> <revision>",
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`staging image: ${error.message}`);
    process.exitCode = 1;
  }
}
