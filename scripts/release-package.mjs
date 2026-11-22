// Reads the package.json inside a packed npm package, and says what stops it from being published.
//
//   node scripts/release-package.mjs <package.tgz> <name> <version>
//
// The packed file is made by the job that runs the calling repository's code, so the job that publishes it
// trusts nothing about it. npm reads the "publishConfig" of the package it publishes as settings ("for
// historical reasons, publishConfig in package.json can contain ANY config keys that npm supports in .npmrc
// files and elsewhere", npm 11.20.0 lib/commands/publish.js), also for a packed file, so a package could tell
// npm to send the token that can write through a proxy of its own. The checks made on main's package.json
// never saw this file.
//
// Two tar readers can read two different package.json files out of one archive: npm drops the first folder of
// every entry, so `other/package.json` after `package/package.json` is the one it publishes, and it skips a
// header it finds invalid where another reader stops or goes on. So this reader does not interpret an archive
// the way npm would. It accepts only the one plain form `npm pack` writes, in which there is nothing to
// interpret, and refuses everything else:
//   - gzip with no byte after it, unpacking to tar blocks to the end;
//   - every header laid out byte for byte as node-tar 7.5.22 writes it for a regular file (npm 11.20.0,
//     node_modules/tar/dist/commonjs/header.js): no extended header, no link, no folder entry;
//   - every entry under `package/`, by a plain path, no path twice, exactly one `package/package.json`;
//   - no colon, backslash or other character node-tar rewrites for Windows. node-tar reads the root of a
//     path by the Windows rules on every system and drops it (strip-absolute-path.js, called from
//     unpack.js), so `package/c:package.json` is written over package.json;
//   - no `.git` anywhere. npm does more with a packed file than read its package.json: before it publishes
//     it unpacks the file and fills in fields from what lies beside the manifest, and for "gitHead" it reads
//     `.git/HEAD` and then whatever file that names, anywhere on the machine (@npmcli/package-json 7.0.5
//     lib/normalize.js), and sends the content to the registry. Its own environment holds the token.
// The second review of pull request 1 read the rest of that path (README and AUTHORS are copied from inside
// the package; bin, man and main are only listed or tested for existence) and found nothing else that
// leaves the package. Raising `.nvmrc` raises npm: read that path again then (CLAUDE.md).
// checks/release-package.test.mjs packs a real package with the npm that runs the checks, and compares this
// reader with npm's own on honest and on hostile archives.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { gunzipSync } from "node:zlib";
import { startedAsScript } from "./cli.mjs";
import { manifestProblems } from "./release-manifest.mjs";

const BLOCK = 512;
const MAX_UNPACKED = 512 * 1024 * 1024;
const MANIFEST = "package/package.json";

const empty = (length) => new RegExp(`^\\0{${length}}$`);
const octal = (length) => new RegExp(`^[0-7]{${length - 2}} \\0$`);
const octalOrEmpty = (length) => new RegExp(`^(?:[0-7]{${length - 2}} \\0|\\0{${length}})$`);

// Every byte of a header, as `npm pack` writes it. Anything else is refused, not skipped.
const HEADER = [
  ["name", 0, 100, /^[\x20-\x7e]+\0*$/],
  ["mode", 100, 8, octalOrEmpty(8)],
  ["owner", 108, 8, octalOrEmpty(8)],
  ["group", 116, 8, octalOrEmpty(8)],
  ["size", 124, 12, octal(12)],
  ["time", 136, 12, octalOrEmpty(12)],
  ["checksum", 148, 8, octal(8)],
  ["link name", 157, 100, empty(100)],
  ["format", 257, 8, /^ustar\x0000$/],
  ["owner and group names", 265, 64, empty(64)],
  ["device numbers", 329, 16, /^(?:[0-7]{6} \0|\0{8}){2}$/],
  ["folder", 345, 155, /^[\x20-\x7e]*\0*$/],
  ["end", 500, 12, empty(12)],
];

const EXTENDED = new Set(["x", "g", "L", "K"]);

// The colon makes a drive letter, which node-tar strips as a root on every system, and it turns a backslash
// into a separator (tar 7.5.22 strip-absolute-path.js, unpack.js). The other three are the rest of the
// characters node-tar swaps out when it writes a file on Windows (winchars.js: | < > ? :), so a name with
// one of them does not unpack the same everywhere.
const FORBIDDEN = /[|<>?:\\]/;

function isZero(bytes) {
  return bytes.every((byte) => byte === 0);
}

function untilNul(text) {
  const end = text.indexOf("\0");
  return end === -1 ? text : text.slice(0, end);
}

/** The path and size a header names. Throws unless the header is exactly the plain form. */
function entryOf(header) {
  const type = header.latin1Slice(156, 157);
  if (EXTENDED.has(type)) {
    throw new Error("it holds an extended header, which npm writes for a file name that is not plain ASCII or is too long; rename that file");
  }
  if (type !== "0") throw new Error(`it holds an entry that is not a regular file (tar type ${JSON.stringify(type)})`);
  const fields = {};
  for (const [name, start, length, form] of HEADER) {
    fields[name] = header.latin1Slice(start, start + length);
    if (!form.test(fields[name])) throw new Error(`a header's ${name} field is not in the form npm pack writes`);
  }
  let sum = 8 * 0x20;
  for (let index = 0; index < BLOCK; index += 1) {
    if (index < 148 || index >= 156) sum += header[index];
  }
  if (sum !== Number.parseInt(fields.checksum, 8)) throw new Error("a header's checksum is wrong");
  const name = untilNul(fields.name);
  const folder = untilNul(fields.folder);
  return { path: folder === "" ? name : `${folder}/${name}`, size: Number.parseInt(fields.size, 8) };
}

function checkPath(path, files, folders) {
  const parts = path.split("/");
  const plain = parts.every((part) => part !== "" && part !== "." && part !== "..") && !FORBIDDEN.test(path);
  if (!plain) throw new Error(`${JSON.stringify(path)} is not a plain path`);
  if (parts[0] !== "package" || parts.length < 2) throw new Error(`${JSON.stringify(path)} is not under package/`);
  if (parts.some((part) => part.toLowerCase() === ".git")) throw new Error(`${JSON.stringify(path)} is in a .git folder, which npm reads when it publishes`);
  // Compared without case, so the package unpacks the same on a file system that folds it.
  const folded = path.toLowerCase();
  if (files.has(folded) || folders.has(folded)) throw new Error(`${JSON.stringify(path)} is in the package twice`);
  for (let depth = 1; depth < parts.length; depth += 1) {
    const above = parts.slice(0, depth).join("/").toLowerCase();
    if (files.has(above)) throw new Error(`${JSON.stringify(path)} sits under a path that is a file`);
    folders.add(above);
  }
  files.add(folded);
}

/** The package.json inside a packed package, parsed. Throws on anything but the plain form `npm pack` writes. */
export function packedManifest(tarball) {
  let archive;
  let used;
  try {
    // gunzipSync stops at a zero byte after the stream and ignores the rest, which would then be attested
    // and published unread. With `info` it also returns the engine, whose bytesWritten is how much of the
    // file it took up. Node's documentation (v26.12.0 doc/api/zlib.md) only calls that "the number of bytes
    // written to the engine", so a check holds it to this meaning on the Node that runs.
    const unpacked = gunzipSync(tarball, { maxOutputLength: MAX_UNPACKED, info: true });
    archive = unpacked.buffer;
    used = unpacked.engine.bytesWritten;
  } catch (error) {
    throw new Error(`it is not one gzip stream of at most ${MAX_UNPACKED} bytes unpacked (${error.code ?? error.message})`);
  }
  if (used !== tarball.length) throw new Error(`${tarball.length - used} bytes follow its gzip stream`);
  if (archive.length % BLOCK !== 0) throw new Error("its length is not a whole number of tar blocks");
  const files = new Set();
  const folders = new Set();
  let manifest;
  let position = 0;
  for (;;) {
    if (position + BLOCK > archive.length) throw new Error("it ends without the two empty blocks that close a tar archive");
    const header = archive.subarray(position, position + BLOCK);
    if (isZero(header)) break;
    const { path, size } = entryOf(header);
    checkPath(path, files, folders);
    const start = position + BLOCK;
    const next = start + Math.ceil(size / BLOCK) * BLOCK;
    if (next > archive.length) throw new Error(`${JSON.stringify(path)} is cut short`);
    if (!isZero(archive.subarray(start + size, next))) throw new Error(`the padding after ${JSON.stringify(path)} is not empty`);
    if (path === MANIFEST) manifest = archive.subarray(start, start + size);
    position = next;
  }
  const rest = archive.subarray(position);
  if (rest.length < 2 * BLOCK || !isZero(rest)) throw new Error("something follows the end of the tar archive, or its two closing blocks are missing");
  if (manifest === undefined) throw new Error(`it holds no ${MANIFEST}`);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifest));
  } catch (error) {
    throw new Error(`its ${MANIFEST} is not JSON in UTF-8 (${error.message})`);
  }
}

/** The file name `npm pack` gives a package (npm 11.20.0 lib/utils/tar.js). */
export function packedName(name, version) {
  return `${name.replace("@", "").replace("/", "-")}-${version}.tgz`;
}

/** Problems with a packed package's manifest, against the name and version read from main. */
export function packageProblems(manifest, { name, version }) {
  const problems = manifestProblems(manifest, { npmPackage: true });
  if (problems.length > 0) return problems;
  if (manifest.name !== name) problems.push(`it is named ${manifest.name}, but package.json on main says ${name}`);
  if (manifest.version !== version) problems.push(`its version is ${manifest.version}, but package.json on main says ${version}`);
  return problems;
}

if (startedAsScript(import.meta.url)) {
  const [file, name, version] = process.argv.slice(2);
  if (process.argv.length !== 5) {
    console.error("usage: release-package.mjs <package.tgz> <name> <version>");
    process.exitCode = 1;
  } else {
    let problems;
    try {
      problems = packageProblems(packedManifest(readFileSync(file)), { name, version });
      if (basename(file) !== packedName(name, version)) problems.push(`the file is not named ${packedName(name, version)}`);
    } catch (error) {
      problems = [error.message];
    }
    for (const problem of problems) console.error(`packed package: ${problem}`);
    if (problems.length > 0) {
      console.error("Nothing was published.");
      process.exitCode = 1;
    } else {
      console.log(`${name}@${version}: the packed package is the one main describes`);
    }
  }
}
