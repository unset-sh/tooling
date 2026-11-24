import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { startedAsScript } from "./cli.mjs";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const defaultRepository = "unset-sh/tooling";
// Tooling moved its maintained human pages to docs/. Existing consumers keep their pinned docs/site contract.
// This selection is code-reviewed, never read from consumer configuration or guessed from available files.
// lexicons and agent-kit publish all of docs/ (docs-import-data.mjs holds the same selection).
const sourceDirectories = new Map([["unset-sh/tooling", "docs"], ["unset-sh/lexicons", "docs"], ["unset-sh/agent-kit", "docs"]]);
// unset-sh/docs reserves these framework and generated directories (scripts/prepare.mjs).
// The github section belongs to unset-sh/.github, not a second repository of that name.
// Its publication guard also rejects the retired legacy unset application mirror.
const reservedSections = new Set([
  "assets", "static", "layouts", "content", "data", "i18n", "archetypes", "scripts", "tests",
  "node_modules", ".build", "public", "resources", "github", "unset",
]);
const usage = "Usage: bun scripts/export-docs.mjs --revision <40sha> --out <fresh-dir> [--root <repo>] [--repository unset-sh/<name>]";

function sectionFor(repository) {
  const match = typeof repository === "string" && /^unset-sh\/(\.github|[a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(repository);
  // The complete match also rejects a trailing newline, which JavaScript's $ anchor otherwise permits.
  if (!match || match[0] !== repository) throw new Error("Repository must be unset-sh/<lowercase-kebab-name> or unset-sh/.github");
  const slug = match[1];
  if (slug === ".github") return "github";
  if (reservedSections.has(slug) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(slug)) {
    throw new Error(`Repository section is reserved: ${slug}`);
  }
  return slug;
}

function git(root, ...args) {
  // Ignore caller Git overrides, machine-wide configuration and replacement objects.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1",
  });
  try {
    return execFileSync("git", ["--no-replace-objects", ...args], {
      cwd: root, env, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, timeout: 30_000,
    });
  } catch {
    throw new Error(`Cannot read committed Git object (${args[0]}); check the repository and revision`);
  }
}

function freshOutput(out) {
  if (typeof out !== "string" || out.length === 0) throw new Error("A fresh output directory is required");
  if (!isAbsolute(out)) throw new Error("Output must be an absolute path to a fresh directory");
  if (out.split(/[\\/]/).includes("..")) throw new Error("Output path traversal (..) is not allowed");
  const absolute = resolve(out);
  const parent = dirname(absolute);
  let ancestor = parse(parent).root;
  for (const part of parent.slice(ancestor.length).split(sep).filter(Boolean)) {
    ancestor = join(ancestor, part);
    const stat = lstatSync(ancestor, { throwIfNoEntry: false });
    if (!stat) throw new Error("Output parent must already exist");
    if (stat.isSymbolicLink()) throw new Error("Output path has a symbolic link ancestor");
    if (!stat.isDirectory()) throw new Error("Output parent must be a directory");
  }
  if (lstatSync(absolute, { throwIfNoEntry: false })) throw new Error("Output already exists; choose a fresh directory");
  return absolute;
}

function validatePaths(files) {
  const names = new Map();
  for (const { path } of files) {
    const parts = path.split("/");
    if (parts[0].toLowerCase() === "source.json") throw new Error("source.json is a reserved provenance path");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(part) || part.endsWith(".") ||
          /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)) {
        throw new Error(`Unsafe documentation filename: ${JSON.stringify(part)}`);
      }
      const name = parts.slice(0, i + 1).join("/");
      const kind = i === parts.length - 1 ? "file" : "directory";
      const previous = names.get(name.toLowerCase());
      if (previous && (previous.name !== name || previous.kind !== kind || kind === "file")) {
        throw new Error(`Documentation path collision (including case): ${JSON.stringify(name)}`);
      }
      names.set(name.toLowerCase(), { name, kind });
    }
  }
}

function committedFiles(root, revision, directory) {
  if (typeof revision !== "string" || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("Revision must be a full 40-character lowercase commit SHA");
  }
  if (git(root, "cat-file", "-t", revision).toString("utf8").trim() !== "commit") {
    throw new Error("Revision must identify a commit object");
  }
  // -z preserves filenames without quoting; cat-file blob returns raw committed bytes.
  // Git 2.54.0, checked 2026-11-22: https://git-scm.com/docs/git-ls-tree
  // and https://git-scm.com/docs/git-cat-file (no filters or textconv are requested).
  const tree = new TextDecoder("utf-8", { fatal: true }).decode(
    git(root, "ls-tree", "-r", "-z", "--full-tree", revision, "--", directory, "LICENSE"),
  );
  const files = [];
  let licence;
  for (const entry of tree.split("\0").filter(Boolean)) {
    const match = /^(\d{6}) ([a-z]+) ([0-9a-f]{40})\t([\s\S]+)$/.exec(entry);
    if (!match) throw new Error("Invalid Git tree entry");
    const [, mode, type, object, sourcePath] = match;
    if (type !== "blob" || !["100644", "100755"].includes(mode)) {
      throw new Error("Documentation and LICENSE must be regular files; symlinks and submodules are forbidden");
    }
    const bytes = git(root, "cat-file", "blob", object);
    if (sourcePath === "LICENSE") {
      licence = { path: "LICENSE", bytes, mode };
    } else if (sourcePath.startsWith(`${directory}/`)) {
      files.push({ path: sourcePath.slice(directory.length + 1), bytes, mode });
    } else {
      throw new Error(`Invalid documentation source path; ${directory} must be a directory and LICENSE a file`);
    }
  }
  if (!licence) throw new Error("The revision must contain a root LICENSE file");
  if (!files.some(({ path }) => path === "_index.md")) throw new Error(`The revision must contain ${directory}/_index.md`);
  const sourceLicence = files.find(({ path }) => path === "LICENSE");
  if (sourceLicence && !sourceLicence.bytes.equals(licence.bytes)) {
    throw new Error(`${directory}/LICENSE conflicts with the root LICENSE`);
  }
  if (!sourceLicence) files.push(licence);
  validatePaths(files);
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/** Export only the docs section and licence from an exact commit to a fresh directory. */
export function exportDocs({ root = defaultRoot, repository = defaultRepository, revision, out } = {}) {
  const section = sectionFor(repository);
  const directory = sourceDirectories.get(repository) ?? "docs/site";
  const output = freshOutput(out);
  const files = committedFiles(root, revision, directory);
  const provenance = {
    schemaVersion: 1,
    repository,
    revision,
    directory,
    section,
    files: files.map(({ path, bytes }) => ({ path, sha256: createHash("sha256").update(bytes).digest("hex") })),
  };
  const manifest = `${JSON.stringify(provenance, null, 2)}\n`;
  // Every source entry and output ancestor is checked before creating anything.
  freshOutput(out);
  mkdirSync(output, { mode: 0o700 });
  const destination = join(output, section);
  mkdirSync(destination);
  for (const { path, bytes, mode } of files) {
    const target = join(destination, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes, { flag: "wx", mode: mode === "100755" ? 0o755 : 0o644 });
  }
  writeFileSync(join(destination, "source.json"), manifest, { flag: "wx", mode: 0o644 });
  return provenance;
}

function argumentsFor(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!["--revision", "--out", "--root", "--repository"].includes(key) || !value || value.startsWith("--") || key.slice(2) in options) {
      throw new Error(`Invalid or duplicate argument. ${usage}`);
    }
    options[key.slice(2)] = value;
  }
  if (!options.revision || !options.out) throw new Error(usage);
  return options;
}

if (startedAsScript(import.meta.url)) {
  try {
    exportDocs(argumentsFor(process.argv.slice(2)));
  } catch (error) {
    console.error(`Docs export failed: ${error.message}`);
    process.exitCode = 1;
  }
}
