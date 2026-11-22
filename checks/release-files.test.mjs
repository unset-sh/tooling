// What may be attached to a release: plainly named regular files, directly in one folder of the repository.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MAX_FILES, collect, listed } from "../scripts/release-files.mjs";

function scratch() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "release-files-")));
  const repository = join(base, "repository");
  mkdirSync(join(repository, "dist"), { recursive: true });
  return { base, repository, destination: join(base, "out") };
}

test("the files of the folder are copied and named, sorted", () => {
  const { repository, destination } = scratch();
  writeFileSync(join(repository, "dist", "sync.mjs"), "b");
  writeFileSync(join(repository, "dist", "agent-kit.json"), "a");
  assert.deepEqual(collect(repository, "dist", destination), ["agent-kit.json", "sync.mjs"]);
  assert.deepEqual(readdirSync(destination).sort(), ["agent-kit.json", "sync.mjs"]);
  assert.equal(readFileSync(join(destination, "agent-kit.json"), "utf8"), "a");
  assert.deepEqual(listed(destination), ["agent-kit.json", "sync.mjs"]);
});

test("a folder outside the repository is refused", () => {
  const { base, repository, destination } = scratch();
  mkdirSync(join(base, "elsewhere"));
  writeFileSync(join(base, "elsewhere", "a.txt"), "a");
  for (const folder of ["", ".", "..", "../elsewhere", "dist/../../elsewhere", join(base, "elsewhere"), "/etc"]) {
    assert.throws(() => collect(repository, folder, destination), /inside the repository/, JSON.stringify(folder));
  }
});

test("a folder that is missing, empty or not a folder is refused", () => {
  const { repository, destination } = scratch();
  assert.throws(() => collect(repository, "build", destination), /does not exist/);
  assert.throws(() => collect(repository, "dist", destination), /is empty/);
  writeFileSync(join(repository, "file"), "a");
  assert.throws(() => collect(repository, "file", destination), /not a folder/);
});

test("a folder reached through a symbolic link is refused, wherever the link points", () => {
  const { base, repository, destination } = scratch();
  writeFileSync(join(repository, "dist", "a.txt"), "a");
  mkdirSync(join(base, "elsewhere"));
  writeFileSync(join(base, "elsewhere", "secret.txt"), "s");
  symlinkSync(join(base, "elsewhere"), join(repository, "outside"));
  symlinkSync(join(repository, "dist"), join(repository, "inside"));
  mkdirSync(join(repository, "nested"));
  symlinkSync(join(repository, "dist"), join(repository, "nested", "deep"));
  for (const folder of ["outside", "inside", "nested/deep"]) {
    assert.throws(() => collect(repository, folder, destination), /symbolic link|inside the repository/, folder);
  }
});

test("a symbolic link, a sub-folder or an oddly named file among the files is refused", () => {
  const cases = [
    ["link", (dist, base) => symlinkSync(join(base, "secret"), join(dist, "link")), /symbolic link/],
    ["sub", (dist) => mkdirSync(join(dist, "sub")), /not a regular file/],
    [".hidden", (dist) => writeFileSync(join(dist, ".hidden"), "x"), /plain file name/],
    ["a b.txt", (dist) => writeFileSync(join(dist, "a b.txt"), "x"), /plain file name/],
    ["-rf", (dist) => writeFileSync(join(dist, "-rf"), "x"), /plain file name/],
    ["a\nb", (dist) => writeFileSync(join(dist, "a\nb"), "x"), /plain file name/],
  ];
  for (const [name, make, expected] of cases) {
    const { base, repository, destination } = scratch();
    writeFileSync(join(base, "secret"), "s");
    writeFileSync(join(repository, "dist", "good.txt"), "g");
    make(join(repository, "dist"), base);
    assert.throws(() => collect(repository, "dist", destination), expected, name);
    assert.throws(() => listed(join(repository, "dist")), expected, name);
    assert.throws(() => readdirSync(destination), /ENOENT/, `${name}: nothing was copied`);
  }
});

test("two names that differ only by case are refused", () => {
  const { repository, destination } = scratch();
  writeFileSync(join(repository, "dist", "Notes.md"), "a");
  writeFileSync(join(repository, "dist", "notes.md"), "b");
  // On a file system that folds case the second write replaced the first, and there is nothing to refuse.
  if (readdirSync(join(repository, "dist")).length === 2) {
    assert.throws(() => collect(repository, "dist", destination), /only by case/);
  }
});

test("a file that is already among the release files is not overwritten", () => {
  const { repository, destination } = scratch();
  writeFileSync(join(repository, "dist", "package.tgz"), "from the build");
  mkdirSync(destination);
  writeFileSync(join(destination, "Package.tgz"), "from npm pack");
  assert.throws(() => collect(repository, "dist", destination), /already among the release files/);
  assert.equal(readFileSync(join(destination, "Package.tgz"), "utf8"), "from npm pack");
});

test("more files than a release may attach are refused", () => {
  const { repository, destination } = scratch();
  for (let index = 0; index <= MAX_FILES; index += 1) writeFileSync(join(repository, "dist", `f${index}.txt`), "x");
  assert.throws(() => collect(repository, "dist", destination), /more than/);
});

test("an empty folder lists as no files: a release may attach nothing", () => {
  const { repository } = scratch();
  assert.deepEqual(listed(join(repository, "dist")), []);
});
