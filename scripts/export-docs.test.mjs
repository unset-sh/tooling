import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { exportDocs } from "./export-docs.mjs";

const cli = fileURLToPath(new URL("./export-docs.mjs", import.meta.url));
const gitEnv = {
  PATH: process.env.PATH,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_AUTHOR_DATE: "2026-11-22T12:00:00Z",
  GIT_COMMITTER_DATE: "2026-11-22T12:00:00Z",
};

function git(root, ...args) {
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: root, env: gitEnv, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function put(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function commit(root) {
  git(root, "add", ".");
  git(root, "commit", "-m", "Fixture");
  return git(root, "rev-parse", "HEAD");
}

function fixture(t, directory = "docs") {
  const base = mkdtempSync(join(realpathSync(tmpdir()), "docs-export-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "repo");
  mkdirSync(root);
  git(root, "init", "--object-format=sha1", "-b", "main");
  put(root, "LICENSE", "Fixture licence\n");
  put(root, `${directory}/_index.md`, "---\ntitle: Developer tooling\n---\nCommitted docs.\n");
  put(root, `${directory}/guides/check.md`, "Check a repository.\n");
  put(root, `${directory}/assets/sample.bin`, Buffer.from([0, 255, 13, 10]));
  put(root, "notes/private.md", "Do not export notes.\n");
  put(root, "artifacts/private.json", "Do not export artifacts.\n");
  put(root, "internal/document.md", "Not part of the published section.\n");
  return { base, root, revision: commit(root), out: join(base, "export") };
}

function snapshot(path) {
  return readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1).flatMap((entry) => {
    if (entry.isDirectory()) return snapshot(join(path, entry.name)).map(([name, bytes]) => [`${entry.name}/${name}`, bytes]);
    return [[entry.name, readFileSync(join(path, entry.name)).toString("base64")]];
  });
}

test("export uses the exact requested commit, ignoring later commits, dirty and staged files", (t) => {
  const f = fixture(t);
  const original = readFileSync(join(f.root, "docs/_index.md"));
  put(f.root, "docs/_index.md", "Later committed docs.\n");
  commit(f.root);
  put(f.root, "docs/_index.md", "Dirty docs.\n");
  put(f.root, "docs/staged.md", "Staged only.\n");
  git(f.root, "add", "docs/staged.md");
  put(f.root, "docs/untracked.md", "Untracked only.\n");
  put(f.root, "LICENSE", "Dirty licence.\n");
  exportDocs(f);
  assert.deepEqual(readFileSync(join(f.out, "tooling/_index.md")), original);
  assert.equal(readFileSync(join(f.out, "tooling/LICENSE"), "utf8"), "Fixture licence\n");
  assert.deepEqual(readdirSync(f.out), ["tooling"]);
  assert.deepEqual(snapshot(f.out).map(([name]) => name), [
    "tooling/LICENSE", "tooling/_index.md", "tooling/assets/sample.bin", "tooling/guides/check.md", "tooling/source.json",
  ]);
  assert.deepEqual(readFileSync(join(f.out, "tooling/assets/sample.bin")), Buffer.from([0, 255, 13, 10]));
});

test("provenance names the source revision and hashes every exported source file", (t) => {
  const f = fixture(t);
  const returned = exportDocs(f);
  const provenance = JSON.parse(readFileSync(join(f.out, "tooling/source.json"), "utf8"));
  assert.deepEqual(returned, provenance);
  assert.deepEqual(Object.keys(provenance), ["schemaVersion", "repository", "revision", "directory", "section", "files"]);
  assert.equal(provenance.schemaVersion, 1);
  assert.equal(provenance.repository, "unset-sh/tooling");
  assert.equal(provenance.revision, f.revision);
  assert.equal(provenance.directory, "docs");
  assert.equal(provenance.section, "tooling");
  assert.deepEqual(provenance.files.map(({ path }) => path), ["LICENSE", "_index.md", "assets/sample.bin", "guides/check.md"]);
  for (const { path, sha256 } of provenance.files) {
    assert.equal(sha256, createHash("sha256").update(readFileSync(join(f.out, "tooling", path))).digest("hex"));
  }
});

test("a caller repository selects its own section and provenance", (t) => {
  for (const [repository, section] of [["unset-sh/.github", "github"], ["unset-sh/profile-recipes", "profile-recipes"]]) {
    const f = fixture(t, "docs/site");
    put(f.root, "docs/not-exported.md", "Outside the existing consumer export root.\n");
    f.revision = commit(f.root);
    const returned = exportDocs({ ...f, repository });
    assert.deepEqual(readdirSync(f.out), [section]);
    const provenance = JSON.parse(readFileSync(join(f.out, section, "source.json"), "utf8"));
    assert.deepEqual(returned, provenance);
    assert.equal(provenance.repository, repository);
    assert.equal(provenance.section, section);
    assert.equal(provenance.directory, "docs/site");
    assert.ok(!provenance.files.some(({ path }) => path === "not-exported.md"));
    assert.equal(provenance.revision, f.revision);
    for (const { path, sha256 } of provenance.files) {
      assert.equal(sha256, createHash("sha256").update(readFileSync(join(f.out, section, path))).digest("hex"));
    }
  }
});

test("lexicons and agent-kit export their whole docs root", (t) => {
  for (const [repository, section] of [["unset-sh/lexicons", "lexicons"], ["unset-sh/agent-kit", "agent-kit"]]) {
    const f = fixture(t, "docs");
    const provenance = exportDocs({ ...f, repository });
    assert.deepEqual(readdirSync(f.out), [section]);
    assert.equal(provenance.directory, "docs");
    assert.equal(provenance.section, section);
  }
});

test("tooling requires its explicit docs root and never guesses a legacy layout", (t) => {
  const f = fixture(t, "docs/site");
  assert.throws(() => exportDocs(f), /docs\/_index\.md/);
  assert.equal(existsSync(f.out), false);
});

test("unsupported or unsafe repository names are refused without mutation", (t) => {
  const f = fixture(t);
  const original = snapshot(f.root);
  const invalid = [null, 42, "", "other/tooling", "UNSET-SH/tooling", "unset-sh/Tooling", "unset-sh/a_b",
    "unset-sh/a.b", "unset-sh/a--b", "unset-sh/-a", "unset-sh/a-", "unset-sh/../tooling", "unset-sh/.",
    "unset-sh/a/b", "unset-sh/tooling\\child", "unset-sh/tooling\n", "unset-sh/github",
    "unset-sh/con", "unset-sh/nul", "unset-sh/com1", "unset-sh/lpt9"];
  for (const repository of invalid) {
    assert.throws(() => exportDocs({ ...f, repository }), /repository|section|reserved/i, JSON.stringify(repository));
    assert.equal(existsSync(f.out), false);
    assert.deepEqual(snapshot(f.root), original);
  }
});

test("framework and generated documentation sections are reserved", (t) => {
  const f = fixture(t);
  for (const section of ["assets", "static", "layouts", "content", "data", "i18n", "archetypes", "scripts", "tests",
    "node_modules", ".build", "public", "resources", "unset"]) {
    assert.throws(() => exportDocs({ ...f, repository: `unset-sh/${section}` }), /repository|reserved|section/i, section);
    assert.equal(existsSync(f.out), false);
  }
});

test("two exports of one commit have identical bytes and no timestamps or output paths", (t) => {
  const f = fixture(t);
  exportDocs(f);
  const other = join(f.base, "second");
  exportDocs({ ...f, out: other });
  assert.deepEqual(snapshot(f.out), snapshot(other));
});

test("only a full commit object is accepted as a revision", (t) => {
  const f = fixture(t);
  const blob = git(f.root, "rev-parse", `${f.revision}:LICENSE`);
  git(f.root, "tag", "-a", "release", "-m", "Fixture");
  const tag = git(f.root, "rev-parse", "release");
  for (const revision of [undefined, "main", "HEAD", f.revision.slice(0, 12), "0".repeat(40), blob, tag]) {
    assert.throws(() => exportDocs({ ...f, revision }), /revision|commit|object/i);
    assert.equal(existsSync(f.out), false);
  }
});

test("local replace refs cannot change the committed tree being exported", (t) => {
  const f = fixture(t);
  put(f.root, "docs/_index.md", "Replacement content.\n");
  const newer = commit(f.root);
  git(f.root, "replace", f.revision, newer);
  exportDocs(f);
  assert.match(readFileSync(join(f.out, "tooling/_index.md"), "utf8"), /Committed docs/);
});

test("missing index or licence fails before creating output", (t) => {
  for (const path of ["docs/_index.md", "LICENSE"]) {
    const f = fixture(t);
    git(f.root, "rm", path);
    const revision = commit(f.root);
    assert.throws(() => exportDocs({ ...f, revision }), /_index|LICENSE|licence/i);
    assert.equal(existsSync(f.out), false);
  }
});

test("committed symlinks and submodules are refused before any writes", (t) => {
  for (const path of ["docs/link.md", "LICENSE"]) {
    const f = fixture(t);
    if (path === "LICENSE") rmSync(join(f.root, path));
    symlinkSync("/outside", join(f.root, path));
    const revision = commit(f.root);
    assert.throws(() => exportDocs({ ...f, revision }), /regular|symbolic|symlink/i);
    assert.equal(existsSync(f.out), false);
  }
  const f = fixture(t);
  git(f.root, "update-index", "--add", "--cacheinfo", `160000,${f.revision},docs/submodule`);
  git(f.root, "commit", "-m", "Submodule fixture");
  const revision = git(f.root, "rev-parse", "HEAD");
  assert.throws(() => exportDocs({ ...f, revision }), /regular|submodule/i);
  assert.equal(existsSync(f.out), false);
});

test("unsafe committed filenames and reserved provenance paths are refused", (t) => {
  for (const name of ["bad name.md", "bad\nname.md", "bad\\name.md", "bad:name.md", "CON.md", "trail.", ".hidden.md", "source.json"]) {
    const f = fixture(t);
    put(f.root, `docs/${name}`, "Unsafe.\n");
    const revision = commit(f.root);
    assert.throws(() => exportDocs({ ...f, revision }), /name|path|reserved/i, name);
    assert.equal(existsSync(f.out), false);
  }
});

test("case-folded file and ancestor collisions are refused", (t) => {
  for (const name of ["docs/GUIDES/check.md", "docs/GUIDES"]) {
    const f = fixture(t);
    const blob = git(f.root, "rev-parse", `${f.revision}:LICENSE`);
    git(f.root, "update-index", "--add", "--cacheinfo", `100644,${blob},${name}`);
    git(f.root, "commit", "-m", "Collision fixture");
    const revision = git(f.root, "rev-parse", "HEAD");
    assert.throws(() => exportDocs({ ...f, revision }), /case|collision/i);
    assert.equal(existsSync(f.out), false);
  }
});

test("a source licence matching the root is kept, and a conflicting one is refused", (t) => {
  const f = fixture(t);
  put(f.root, "docs/LICENSE", "Fixture licence\n");
  exportDocs({ ...f, revision: commit(f.root) });
  assert.equal(readFileSync(join(f.out, "tooling/LICENSE"), "utf8"), "Fixture licence\n");
  put(f.root, "docs/LICENSE", "Different licence\n");
  const out = join(f.base, "conflict");
  assert.throws(() => exportDocs({ ...f, revision: commit(f.root), out }), /LICENSE|licence/i);
  assert.equal(existsSync(out), false);
});

test("existing output directories, files and links are never overwritten", (t) => {
  for (const kind of ["directory", "file", "link"]) {
    const f = fixture(t);
    put(f.base, "outside/brand/keep.md", "Keep another section.\n");
    if (kind === "directory") put(f.out, "brand/keep.md", "Keep another section.\n");
    if (kind === "file") writeFileSync(f.out, "Keep this file.\n");
    if (kind === "link") symlinkSync(join(f.base, "outside"), f.out);
    assert.throws(() => exportDocs(f), /exist|fresh|symbolic|symlink/i);
    assert.equal(readFileSync(join(f.base, "outside/brand/keep.md"), "utf8"), "Keep another section.\n");
    if (kind === "directory") assert.deepEqual(readdirSync(f.out), ["brand"]);
    if (kind === "file") assert.equal(readFileSync(f.out, "utf8"), "Keep this file.\n");
  }
});

test("output symlink ancestors, traversal and missing parents are refused", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.base, "outside"));
  symlinkSync(join(f.base, "outside"), join(f.base, "linked"));
  for (const out of [join(f.base, "linked/export"), `${f.base}/linked/../export`, join(f.base, "missing/export")]) {
    assert.throws(() => exportDocs({ ...f, out }), /symbolic|symlink|parent|traversal|\.\./i);
  }
  assert.deepEqual(readdirSync(join(f.base, "outside")), []);
  assert.equal(existsSync(join(f.base, "missing")), false);
});

test("output must be an absolute path", (t) => {
  const f = fixture(t);
  assert.throws(() => exportDocs({ ...f, out: "relative-export" }), /absolute/i);
  assert.equal(existsSync(f.out), false);
});

test("CLI exports and rejects missing, unknown and duplicate arguments", (t) => {
  const f = fixture(t, "docs/site");
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: gitEnv });
  const success = run("--root", f.root, "--repository", "unset-sh/.github", "--revision", f.revision, "--out", f.out);
  assert.equal(success.status, 0, success.stderr);
  assert.equal(existsSync(join(f.out, "github/source.json")), true);
  assert.equal(JSON.parse(readFileSync(join(f.out, "github/source.json"))).repository, "unset-sh/.github");
  for (const args of [[], ["--wat"], ["--revision", f.revision], ["--revision", f.revision, "--revision", f.revision, "--out", f.out]]) {
    const failure = run(...args);
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /usage|argument|revision|out/i);
  }
});
