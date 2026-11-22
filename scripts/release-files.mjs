// Gathers the files a release attaches, and lists them again before they are published.
//
//   node scripts/release-files.mjs collect <repository> <folder> <destination>
//   node scripts/release-files.mjs list <folder>
//
// `collect` copies every file of <folder>, a folder inside <repository> that the repository's build wrote,
// into <destination>. `list` prints the names in a folder, one per line, and is run on both sides of the
// approval: on what was built, and on what was downloaded to be published.
//
// Both refuse anything that is not a plainly named regular file directly in the folder. A symbolic link
// would publish whatever it points at on the runner, and a sub-folder or an odd name would not survive as a
// release asset under the name it was attested with.

import { copyFileSync, lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { startedAsScript } from "./cli.mjs";

export const MAX_FILES = 50;

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The names of the files in a folder, sorted. Throws on anything that is not a plainly named regular file. */
export function listed(folder) {
  const names = readdirSync(folder).sort();
  if (names.length > MAX_FILES) throw new Error(`${names.length} files, more than the ${MAX_FILES} a release may attach`);
  const seen = new Set();
  for (const name of names) {
    if (!NAME.test(name)) throw new Error(`"${name}" is not a plain file name (letters, digits, dot, dash, underscore)`);
    const stat = lstatSync(join(folder, name));
    if (stat.isSymbolicLink()) throw new Error(`${name} is a symbolic link`);
    if (!stat.isFile()) throw new Error(`${name} is not a regular file`);
    const folded = name.toLowerCase();
    if (seen.has(folded)) throw new Error(`${name} differs from another file only by case`);
    seen.add(folded);
  }
  return names;
}

/** Copies the files of `folder`, inside `repository`, into `destination`. Returns their names. */
export function collect(repository, folder, destination) {
  if (folder === "" || isAbsolute(folder)) throw new Error("the folder must be a path inside the repository");
  const root = realpathSync(repository);
  const expected = resolve(root, folder);
  if (expected === root || !expected.startsWith(root + sep)) throw new Error(`${folder} is not inside the repository`);
  const stat = lstatSync(expected, { throwIfNoEntry: false });
  if (stat === undefined) throw new Error(`${folder} does not exist; the build command did not write it`);
  // Any link on the way to the folder makes its real path differ from the path as written.
  if (realpathSync(expected) !== expected) throw new Error(`${folder} is reached through a symbolic link`);
  if (!stat.isDirectory()) throw new Error(`${folder} is not a folder`);
  const names = listed(expected);
  if (names.length === 0) throw new Error(`${folder} is empty; the build command wrote nothing to release`);
  mkdirSync(destination, { recursive: true });
  const taken = new Set(readdirSync(destination).map((name) => name.toLowerCase()));
  for (const name of names) {
    if (taken.has(name.toLowerCase())) throw new Error(`${name} is already among the release files`);
    copyFileSync(join(expected, name), join(destination, name));
  }
  return names;
}

if (startedAsScript(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "collect" && args.length === 3) {
      for (const name of collect(...args)) console.log(name);
    } else if (command === "list" && args.length === 1) {
      for (const name of listed(args[0])) console.log(name);
    } else {
      console.error("usage: release-files.mjs collect <repository> <folder> <destination> | list <folder>");
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`release files: ${error.message}`);
    process.exitCode = 1;
  }
}
