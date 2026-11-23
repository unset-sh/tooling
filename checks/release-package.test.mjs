// What the publish job accepts as a packed npm package. The file comes from the job that runs the calling
// repository's code, so every test here is an archive that job could have written.
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { REGISTRY } from "../scripts/release-manifest.mjs";
import { packageProblems, packedManifest, packedName } from "../scripts/release-package.mjs";
import { END, entry, header, packed } from "./tarball.mjs";

const good = { name: "@unset-sh/brand", version: "1.4.0", publishConfig: { registry: REGISTRY }, dependencies: { "@unset-sh/tokens": "0.2.0" } };
const expected = { name: "@unset-sh/brand", version: "1.4.0" };
const manifestEntry = entry("package/package.json", good);
// The same package with nothing to fetch, for the tests that install it: an install resolves dependencies.
const installable = { name: good.name, version: good.version, publishConfig: good.publishConfig };
const installableEntry = entry("package/package.json", installable);

function refuses(tarball, reason, message) {
  assert.throws(() => packedManifest(tarball), reason, message);
}

/** A manifest entry whose header is bent out of the plain form, with its checksum still right. */
function bent(before) {
  return packed(entry("package/package.json", good, {}, { before }));
}

test("a package in the form bun pm pack writes gives its package.json", () => {
  const tarball = packed(entry("package/index.js", "export {};\n"), manifestEntry, entry("package/lib/deep/a.js", ""));
  assert.deepEqual(packedManifest(tarball), good);
  assert.deepEqual(packageProblems(packedManifest(tarball), expected), []);
});

test("a long path split between the folder field and the name field is read as one path", () => {
  const tarball = packed(entry("package.json", good, { folder: "package" }));
  assert.deepEqual(packedManifest(tarball), good);
  refuses(packed(entry("package.json", good, { folder: "other" })), /not under package/);
});

test("a second package.json under another top folder is refused: bun install would unpack that one", () => {
  // bun install and npm drop the first folder of every entry, so both of these unpack to package.json and the
  // later wins, while bun publish sends the first.
  const other = entry("other/package.json", { ...good, publishConfig: { registry: REGISTRY, "strict-ssl": false } });
  refuses(packed(manifestEntry, other), /"other\/package\.json" is not under package\//);
  refuses(packed(other, manifestEntry), /not under package\//);
  refuses(packed(manifestEntry, entry("package", "x")), /not under package\//);
});

test("the same path twice is refused, also when only the case differs", () => {
  refuses(packed(manifestEntry, manifestEntry), /twice/);
  refuses(packed(manifestEntry, entry("package/PACKAGE.json", good)), /twice/);
  refuses(packed(entry("package/lib", "x"), entry("package/lib/a.js", "x"), manifestEntry), /under a path that is a file/);
  refuses(packed(entry("package/lib/a.js", "x"), entry("package/LIB", "x"), manifestEntry), /twice/);
});

test("a path that another reader could resolve differently is refused", () => {
  for (const path of ["package//package.json", "package/./package.json", "package/lib/../package.json", "package/lib/", "/package/package.json", "./package/package.json", "package\\package.json", "package/lib\\a.js"]) {
    refuses(packed(manifestEntry, entry(path, good)), /not a plain path|not under package/, path);
  }
});

test("a path npm's unpacker would write somewhere else is refused", () => {
  // node-tar strips a drive letter as a root, on every system, after it has dropped `package/`: each of the
  // first three would be written over package.json. A backslash becomes a separator.
  for (const path of ["package/c:package.json", "package/C:/package.json", "package/z:/q:package.json", "package/lib/c:a.js", "package/a:b", "package/package.json:x"]) {
    refuses(packed(manifestEntry, entry(path, good)), /not a plain path/, path);
  }
  // The rest of what node-tar rewrites on Windows, where such a name unpacks as another.
  for (const character of ["|", "<", ">", "?"]) {
    refuses(packed(manifestEntry, entry(`package/a${character}b.js`, "")), /not a plain path/, character);
  }
});

test("a .git folder in a package is refused: npm follows it to any file on the machine", () => {
  for (const path of ["package/.git/HEAD", "package/.git", "package/.GIT/HEAD", "package/.Git/config", "package/lib/.git/HEAD"]) {
    refuses(packed(manifestEntry, entry(path, "ref: /proc/self/environ\n")), /\.git folder, which npm reads when it publishes/, path);
  }
  // Names that only look like it are ordinary files.
  const tarball = packed(manifestEntry, entry("package/.gitignore", ""), entry("package/.github/x.yml", ""), entry("package/a.git", ""));
  assert.deepEqual(packedManifest(tarball), good);
});

test("an extended header is refused: it can rename the entry that follows", () => {
  for (const type of ["x", "g", "L", "K"]) {
    const renamed = Buffer.concat([entry("PaxHeader/a.json", "30 path=package/package.json\n", { type }), entry("package/a.json", good)]);
    refuses(packed(manifestEntry, renamed), /extended header/, type);
  }
});

test("anything but a regular file is refused", () => {
  for (const type of ["1", "2", "3", "4", "5", "6", "7", "\0", " ", "S"]) {
    refuses(packed(manifestEntry, entry("package/link", "", { type })), /not a regular file/, JSON.stringify(type));
  }
});

test("a header npm would skip is refused, so nothing can hide behind it", () => {
  // node-tar skips a file's header that names a link target and reads the blocks after it as headers.
  refuses(bent((block) => block.write("target", 157, "latin1")), /link name field/);
  refuses(packed(entry("package/package.json", good, {}, { after: (block) => block.write("7", 0, "latin1") })), /checksum is wrong/);
  // Read as twelve bytes, as node-tar reads the checksum, this field would run into the type and the link name.
  refuses(packed(entry("package/package.json", good, {}, { after: (block) => block.write(`0${block.latin1Slice(148, 155)}`, 148, "latin1") })), /checksum field/);
  // The form node-tar, and so npm pack, writes the checksum in: the right sum, ended by a space and a NUL.
  refuses(packed(entry("package/package.json", good, {}, { after: (block) => block.write(`${block.latin1Slice(148, 154)} \0`, 148, "latin1") })), /checksum field/);
});

test("every other field of a header must be in the form bun pm pack writes", () => {
  const cases = [
    // The form node-tar, and so npm pack, writes for these three fields.
    [/size field/, (block) => block.write("0000000204 \0", 124, "latin1")],
    [/time field/, (block) => block.write("3560116604 \0", 136, "latin1")],
    [/name field/, (block) => block.write("package/é.json", 0, "latin1")],
    [/name field/, (block) => block.write("package/a\0b", 0, "latin1")],
    [/name field/, (block) => block.fill(0, 0, 100)],
    [/mode field/, (block) => block.write("0000644\0", 100, "latin1")],
    [/owner field/, (block) => block.write("root", 108, "latin1")],
    [/group field/, (block) => block.write("0000000\0", 116, "latin1")],
    [/size field/, (block) => block.write("00000000204\0", 124, "latin1")],
    [/size field/, (block) => block.write("204         ", 124, "latin1")],
    [/size field/, (block) => block.writeUInt8(0x80, 124)],
    [/time field/, (block) => block.write("now", 136, "latin1")],
    [/time field/, (block) => block.fill(0, 136, 148)],
    [/format field/, (block) => block.write("ustar  \0", 257, "latin1")],
    [/format field/, (block) => block.fill(0, 257, 265)],
    [/owner and group names field/, (block) => block.write("root", 265, "latin1")],
    [/device numbers field/, (block) => block.write("x", 329, "latin1")],
    [/folder field/, (block) => block.write("pkg\0x", 345, "latin1")],
    [/end field/, (block) => block.write("x", 500, "latin1")],
  ];
  for (const [reason, before] of cases) refuses(bent(before), reason, String(before));
});

test("an archive that does not end where its content ends is refused", () => {
  const body = manifestEntry;
  refuses(gzipSync(body), /ends without the two empty blocks/);
  refuses(gzipSync(Buffer.concat([body, Buffer.alloc(512)])), /two closing blocks are missing/);
  refuses(gzipSync(Buffer.concat([body, END, entry("other/package.json", good)])), /something follows the end/);
  refuses(gzipSync(Buffer.concat([body, Buffer.alloc(512), entry("other/package.json", good), END])), /something follows the end/);
  refuses(gzipSync(Buffer.concat([body, END, Buffer.from("x")])), /whole number of tar blocks/);
  refuses(gzipSync(Buffer.concat([header({ name: "package/package.json", size: 4096 }), Buffer.alloc(512), END])), /cut short/);
  const padded = Buffer.from(body);
  padded.write("x", padded.length - 1, "latin1");
  refuses(packed(padded), /padding after "package\/package\.json" is not empty/);
});

test("a file that is not one gzip stream is refused", () => {
  refuses(Buffer.concat([manifestEntry, END]), /not one gzip stream/);
  refuses(Buffer.concat([packed(manifestEntry), Buffer.from("more")]), /not one gzip stream/);
  refuses(Buffer.alloc(0), /not one gzip stream/);
  // A second stream is unpacked too, and what it holds then follows the end of the first archive.
  refuses(Buffer.concat([packed(manifestEntry), packed(entry("other/package.json", good))]), /something follows the end/);
});

test("bytes after the gzip stream are refused: nothing is published that was not read", () => {
  // gunzipSync stops at a zero byte after the stream without an error. This test also holds
  // `engine.bytesWritten` to its meaning, the bytes of the file the stream took up, on the Node that runs.
  const whole = packed(manifestEntry);
  assert.deepEqual(packedManifest(whole), good);
  refuses(Buffer.concat([whole, Buffer.from([0])]), /^Error: 1 bytes follow its gzip stream$/);
  refuses(Buffer.concat([whole, Buffer.alloc(10)]), /10 bytes follow its gzip stream/);
  refuses(Buffer.concat([whole, Buffer.from([0]), Buffer.from("anything at all")]), /16 bytes follow its gzip stream/);
  refuses(Buffer.concat([whole, Buffer.from([0]), packed(entry("other/package.json", good))]), /bytes follow its gzip stream/);
});

test("a package with no package.json, or one that is not JSON, is refused", () => {
  refuses(packed(entry("package/index.js", "x")), /holds no package\/package\.json/);
  refuses(packed(entry("package/lib/package.json", good)), /holds no package\/package\.json/);
  refuses(packed(entry("package/package.json", "{")), /not JSON in UTF-8/);
  refuses(packed(entry("package/package.json", Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]))), /not JSON in UTF-8/);
});

test("a packed manifest that sets anything but the registry under publishConfig is refused", () => {
  for (const extra of [{ "https-proxy": "http://127.0.0.1:18080", "strict-ssl": false }, { ca: "-----BEGIN CERTIFICATE-----" }, { tag: "next" }, { access: "public" }]) {
    const problems = packageProblems({ ...good, publishConfig: { registry: REGISTRY, ...extra } }, expected);
    assert.match(problems.join("\n"), /may set only "registry"/, JSON.stringify(extra));
    for (const key of Object.keys(extra)) assert.match(problems.join("\n"), new RegExp(JSON.stringify(key)));
  }
  const hidden = JSON.parse(`{"name":"@unset-sh/brand","version":"1.4.0","publishConfig":{"registry":"${REGISTRY}","__proto__":{"proxy":"http://127.0.0.1"}}}`);
  assert.match(packageProblems(hidden, expected).join("\n"), /"__proto__"/);
});

test("a packed manifest that is not the package main describes is refused", () => {
  assert.match(packageProblems({ ...good, name: "@unset-sh/presentation" }, expected).join("\n"), /named @unset-sh\/presentation, but package\.json on main says @unset-sh\/brand/);
  assert.match(packageProblems({ ...good, version: "9.9.9" }, expected).join("\n"), /version is 9\.9\.9, but package\.json on main says 1\.4\.0/);
  assert.match(packageProblems({ ...good, dependencies: { left: "^1.0.0" } }, expected).join("\n"), /not one released, exact version/);
  assert.match(packageProblems({ ...good, private: true }, expected).join("\n"), /private/);
  assert.match(packageProblems({ ...good, publishConfig: undefined }, expected).join("\n"), /publishConfig\.registry/);
  assert.deepEqual(packageProblems(null, expected), ["package.json is not an object"]);
});

// The tests below use the Bun running the checks: in CI, the version `.bun-version` names, which is the one
// the release jobs install. The publish job runs exactly `publish` below: in a new folder that holds the
// checked package and a package.json of `{}`, with HOME set to that folder, and an environment of three names.
const bun = process.execPath;
const TOKEN = "token-for-the-local-registry";

function scratch() {
  return realpathSync(mkdtempSync(join(tmpdir(), "package-")));
}

function bunPack(manifest, files = {}) {
  const base = scratch();
  const source = join(base, "source");
  const out = join(base, "out");
  mkdirSync(out);
  for (const [path, content] of Object.entries({ "package.json": JSON.stringify(manifest), ...files })) {
    mkdirSync(dirname(join(source, path)), { recursive: true });
    writeFileSync(join(source, path), content);
  }
  const result = spawnSync(bun, ["pm", "pack", "--ignore-scripts", "--quiet", "--destination", out], {
    cwd: source,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: base, BUN_INSTALL_CACHE_DIR: join(base, "cache") },
  });
  assert.equal(result.status, 0, result.stderr);
  const names = readdirSync(out);
  assert.equal(names.length, 1);
  return join(out, names[0]);
}

function run(command, args, options) {
  return new Promise((done) => {
    execFile(command, args, { ...options, encoding: "utf8" }, (error, stdout, stderr) => done({ status: error ? (error.code ?? 1) : 0, stdout, stderr }));
  });
}

/**
 * What `bun publish` sends for a packed file, run as the publish job runs it, to a registry on this machine
 * that records the request: the name and version, the manifest of that version, and the file attached.
 */
async function bunPublishes(file, { folderFiles = {} } = {}) {
  const requests = [];
  const registry = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body = request.method === "PUT" ? await request.json() : null;
      requests.push({ method: request.method, path: new URL(request.url).pathname, authorization: request.headers.get("authorization"), body });
      return Response.json({ ok: true });
    },
  });
  try {
    const folder = scratch();
    const name = basename(file);
    writeFileSync(join(folder, name), readFileSync(file));
    writeFileSync(join(folder, "package.json"), "{}\n");
    for (const [path, content] of Object.entries(folderFiles)) writeFileSync(join(folder, path), content);
    const result = await run(bun, ["publish", "--ignore-scripts", "--registry", `http://127.0.0.1:${registry.port}/`, `./${name}`], {
      cwd: folder,
      env: { PATH: process.env.PATH, HOME: folder, NPM_CONFIG_TOKEN: TOKEN },
    });
    const puts = requests.filter((request) => request.method === "PUT");
    if (puts.length === 0) return { result, requests };
    assert.equal(puts.length, 1, JSON.stringify(requests.map(({ method, path }) => `${method} ${path}`)));
    const [put] = puts;
    const versions = Object.values(put.body.versions);
    assert.equal(versions.length, 1);
    const attachments = Object.values(put.body._attachments);
    assert.equal(attachments.length, 1);
    return { result, requests, put, sent: put.body, version: versions[0], attached: Buffer.from(attachments[0].data, "base64") };
  } finally {
    registry.stop(true);
  }
}

/** Where `bun install` puts the files of a packed package when a project depends on it, as paths inside the package. */
async function bunUnpacks(tarball) {
  const base = scratch();
  writeFileSync(join(base, "package.tgz"), tarball);
  writeFileSync(join(base, "package.json"), JSON.stringify({ name: "consumer", private: true, dependencies: { [good.name]: "file:./package.tgz" } }));
  const result = await run(bun, ["install", "--ignore-scripts", "--no-save"], {
    cwd: base,
    env: { PATH: process.env.PATH, HOME: base, BUN_INSTALL_CACHE_DIR: join(base, "cache") },
  });
  assert.equal(result.status, 0, result.stderr);
  const folder = join(base, "node_modules", ...good.name.split("/"));
  // Bun leaves a marker of its own beside the files it unpacked.
  const walk = (at) => readdirSync(at, { withFileTypes: true }).flatMap((item) => (item.isDirectory() ? walk(join(at, item.name)) : [relative(folder, join(at, item.name))]));
  return { folder, files: walk(folder).filter((path) => path !== ".bun-tag").sort() };
}

test("what bun pm pack writes is accepted, under the name this workflow expects, and published as this reader reads it", async () => {
  const long = "d".repeat(60);
  const file = bunPack(good, { "index.js": "export {};\n", "lib/deep/a.js": "", [`lib/${long}/${long}/file.js`]: "" });
  assert.equal(file.endsWith(`/${packedName(good.name, good.version)}`), true, file);
  const manifest = packedManifest(readFileSync(file));
  assert.deepEqual(manifest, good);
  const { result, put, sent, version, attached } = await bunPublishes(file);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(put.path, "/@unset-sh%2fbrand");
  assert.equal(put.authorization, `Bearer ${TOKEN}`);
  assert.equal(`${sent.name}@${version.version}`, `${good.name}@${good.version}`);
  for (const field of ["name", "version", "publishConfig", "dependencies"]) assert.deepEqual(version[field], manifest[field], field);
  // The file the registry receives is the file that was checked and attested, byte for byte.
  assert.deepEqual(attached, readFileSync(file));
  assert.equal(version.gitHead, undefined);
});

test("a file name bun pm pack can only write with an extended header stops the release with a reason", () => {
  for (const name of ["lib/é.js", `lib/${"n".repeat(120)}.js`]) {
    const file = bunPack(good, { [name]: "" });
    refuses(readFileSync(file), /extended header.*rename that file/, name);
  }
});

test("bun publishes the first of two manifests and bun install unpacks the later, which is why this reader refuses the archive", async () => {
  const base = scratch();
  const file = join(base, packedName(good.name, good.version));
  const tarball = packed(installableEntry, entry("other/package.json", { ...installable, name: "@unset-sh/other", version: "9.9.9" }));
  writeFileSync(file, tarball);
  const { sent, version } = await bunPublishes(file);
  assert.equal(`${sent.name}@${version.version}`, `${good.name}@${good.version}`);
  const { folder } = await bunUnpacks(tarball);
  const unpacked = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"));
  assert.equal(`${unpacked.name}@${unpacked.version}`, "@unset-sh/other@9.9.9");
  refuses(tarball, /not under package/);
});

test("bun publishes an archive built by these checks the way this reader reads it", async () => {
  const file = join(scratch(), packedName(good.name, good.version));
  const tarball = packed(entry("package/index.js", "export {};\n"), entry("package.json", good, { folder: "package" }));
  writeFileSync(file, tarball);
  const { version, attached } = await bunPublishes(file);
  const manifest = packedManifest(tarball);
  for (const field of ["name", "version", "publishConfig", "dependencies"]) assert.deepEqual(version[field], manifest[field], field);
  assert.deepEqual(attached, tarball);
});

test("bun publish sends no commit from a .git folder; this reader refuses one anyway, for npm", async () => {
  const base = scratch();
  const outside = join(base, "outside-the-package");
  writeFileSync(outside, "a line from a file that is not in the package\n");
  const file = join(base, packedName(good.name, good.version));
  const tarball = packed(manifestEntry, entry("package/.git/HEAD", `ref: ${outside}\n`));
  writeFileSync(file, tarball);
  const { version } = await bunPublishes(file);
  assert.equal(version.gitHead, undefined);
  assert.doesNotMatch(JSON.stringify(version), /a line from a file/);
  refuses(tarball, /\.git folder/);
});

test("a registry named in the publish folder's settings wins over --registry, which is why that folder holds nothing else", async () => {
  // The token is sent only to the registry named on the command line, so a redirected publish fails with
  // no request made. The publish job's folder is new, and its HOME is that folder, so no settings file exists.
  const file = bunPack(good);
  const { result, requests } = await bunPublishes(file, { folderFiles: { ".npmrc": "@unset-sh:registry=http://127.0.0.1:9/\n" } });
  assert.notEqual(result.status, 0);
  assert.deepEqual(requests, []);
});

test("every path this reader accepts is unpacked by bun install to the place the path names", async () => {
  // The reader says `package/<rest>` is the file <rest>. Bun's unpacker has rules of its own (roots,
  // separators, trailing slashes), so odd names are put to both: the ones the reader accepts go into
  // archives, `bun install` unpacks them, and every file must lie where its path says, package.json untouched.
  const printable = Array.from({ length: 95 }, (_, index) => String.fromCharCode(0x20 + index));
  const candidates = new Set(["package/lib/c:package.json", "package/c:..", "package/con", "package/nul", "package/aux.txt", "package/x ", "package/x.", "package/ x", "package/package.json ", "package/package.json.", "package/~/x", "package/$HOME/x", "package/%2e%2e/x", "package/.../x", "package/package.json::$DATA"]);
  for (const first of printable) {
    for (const tail of ["package.json", "/package.json", "x", "/x"]) candidates.add(`package/${first}${tail}`);
    candidates.add(`package/x${first}`);
    for (const second of [":", ".", " ", "~", "$", "%", "/"]) {
      for (const tail of ["package.json", "/package.json"]) candidates.add(`package/${first}${second}${tail}`);
    }
  }
  const accepted = [...candidates].filter((path) => {
    try {
      packedManifest(packed(installableEntry, entry(path, "x")));
      return true;
    } catch {
      return false;
    }
  });
  assert.ok(accepted.length > 500, `only ${accepted.length} odd paths were accepted; the test no longer tries much`);
  // Paths that differ only by case, or where one is a folder of another, cannot share an archive.
  const batches = [];
  for (const path of accepted) {
    const folded = path.toLowerCase();
    const above = folded.split("/").map((_, depth, parts) => parts.slice(0, depth).join("/")).filter((part) => part !== "");
    let batch = batches.find((each) => !each.files.has(folded) && !each.folders.has(folded) && above.every((part) => !each.files.has(part)));
    if (batch === undefined) {
      batch = { paths: [], files: new Set(["package/package.json"]), folders: new Set() };
      batches.push(batch);
    }
    batch.paths.push(path);
    batch.files.add(folded);
    for (const part of above) batch.folders.add(part);
  }
  for (const batch of batches) {
    const tarball = packed(installableEntry, ...batch.paths.map((path) => entry(path, "x")));
    assert.deepEqual(packedManifest(tarball), installable);
    const { folder, files } = await bunUnpacks(tarball);
    assert.deepEqual(files, ["package.json", ...batch.paths.map((path) => path.slice("package/".length))].sort());
    assert.deepEqual(JSON.parse(readFileSync(join(folder, "package.json"), "utf8")), installable);
  }
});
