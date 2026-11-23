import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { linkSync, symlinkSync, truncateSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { importSource, readDocsImport, stageDocsImport, validateDocsImport } from "./docs-import-data.mjs";

const base = "b".repeat(40);
const workflow = base;
const gitEnv = { PATH: process.env.PATH, LANG: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
function fixture(t, key = "tooling") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "docs-import-data-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source"); mkdirSync(source);
  const directory = key === "tooling" ? "docs" : "docs/site";
  const git = (...args) => execFileSync("git", args, { cwd: source, env: gitEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q");
  mkdirSync(join(source, directory, "assets"), { recursive: true });
  writeFileSync(join(source, "LICENSE"), "Fixture licence\n");
  writeFileSync(join(source, directory, "_index.md"), "---\ntitle: Fixture\ntype: docs\ncascade:\n  type: docs\nmenus:\n  main:\n    weight: 30\n---\n\nA source page.\n");
  writeFileSync(join(source, directory, "assets/image.bin"), Buffer.from([0, 128, 255, 10]));
  writeFileSync(join(source, "package.json"), '{"scripts":{"prepare":"touch MUST_NOT_RUN"}}');
  git("add", "."); git("commit", "-qm", "Fixture");
  return { root: source, source: key, revision: git("rev-parse", "HEAD"), runId: 123, baseCommit: base,
    workflowCommit: workflow, out: join(root, "snapshot.json"), git, directory };
}

test("stages only exact committed section bytes and root licence with complete provenance", t => {
  const f = fixture(t);
  writeFileSync(join(f.root, "docs/_index.md"), "Uncommitted replacement");
  const result = stageDocsImport(f);
  const snapshot = JSON.parse(readFileSync(f.out));
  assert.deepEqual(result, { source: "tooling", files: 4 });
  assert.deepEqual(snapshot.source, { key: "tooling", revision: f.revision, runId: 123 });
  assert.deepEqual(snapshot.target, { repository: "unset-sh/docs", base: "main", baseCommit: base, workflowCommit: workflow });
  assert.deepEqual(snapshot.files.map(file => file.path), ["LICENSE", "_index.md", "assets/image.bin", "source.json"]);
  assert.match(Buffer.from(snapshot.files[1].content, "base64").toString(), /A source page/);
  assert.deepEqual(Buffer.from(snapshot.files[2].content, "base64"), Buffer.from([0, 128, 255, 10]));
  assert.doesNotThrow(() => validateDocsImport(snapshot));
});

test("the organisation metadata source owns only the github alias", t => {
  const f = fixture(t, "github"); stageDocsImport(f);
  const snapshot = JSON.parse(readFileSync(f.out));
  const provenance = JSON.parse(Buffer.from(snapshot.files.at(-1).content, "base64"));
  assert.equal(provenance.repository, "unset-sh/.github");
  assert.equal(provenance.directory, "docs/site");
  assert.equal(provenance.section, "github");
  assert.equal(importSource("github").workflow, ".github/workflows/docs-export.yml");
  for (const source of ["docs", "unset", ".github", "../tooling", "tooling\n"]) assert.throws(() => importSource(source));
});

test("untrusted payloads cannot select another destination, revision, path or content", t => {
  const f = fixture(t); stageDocsImport(f);
  const snapshot = JSON.parse(readFileSync(f.out));
  for (const change of [
    item => { item.target.repository = "unset-sh/tooling"; },
    item => { item.target.base = "staging"; },
    item => { item.target.baseCommit = "main"; },
    item => { item.target.workflowCommit = "main"; },
    item => { item.source.key = "docs"; },
    item => { item.source.revision = "main"; },
    item => { item.source.runId = 0; },
    item => { item.source.repository = "outside/repo"; },
    item => { item.files[0].path = "../README.md"; },
    item => { item.files[0].path = "/etc/passwd"; },
    item => { item.files[0].path = ".github/workflows/ci.yml"; },
    item => { item.files[0].path = "C:/README.md"; },
    item => { item.files[0].path = "a\\b.md"; },
    item => { item.files[0].path = "CON.txt"; },
    item => { item.files[0].path = "trailing."; },
    item => { item.files[0].path = "LICENSE\n"; },
    item => { item.files[0].content += "\n"; },
    item => { item.files[0].content = Buffer.from("different licence").toString("base64"); },
    item => { item.files[0].sha256 = "f".repeat(64); },
    item => { item.files.push(item.files[0]); },
    item => { item.files[1].path = "license"; },
    item => { item.files[1].path = "LICENSE/child.md"; },
    item => { item.files.pop(); },
    item => { item.files.shift(); },
    item => { item.files = Array(257).fill(item.files[0]); },
  ]) {
    const copy = structuredClone(snapshot); change(copy);
    assert.throws(() => validateDocsImport(copy));
  }
});

test("forged provenance is refused even when its own content hash is recalculated", t => {
  const f = fixture(t); stageDocsImport(f);
  const snapshot = JSON.parse(readFileSync(f.out));
  for (const change of [
    value => { value.repository = "outside/tooling"; },
    value => { value.revision = "d".repeat(40); },
    value => { value.directory = ".github"; },
    value => { value.section = "content"; },
    value => { value.files.pop(); },
    value => { value.files[0].sha256 = "f".repeat(64); },
  ]) {
    const copy = structuredClone(snapshot);
    const file = copy.files.at(-1);
    const value = JSON.parse(Buffer.from(file.content, "base64")); change(value);
    const bytes = Buffer.from(JSON.stringify(value));
    file.content = bytes.toString("base64"); file.sha256 = createHash("sha256").update(bytes).digest("hex");
    assert.throws(() => validateDocsImport(copy));
  }
});

test("committed symlinks and missing licence fail before a snapshot exists", t => {
  const f = fixture(t);
  f.git("update-index", "--add", "--cacheinfo", `120000,${f.git("hash-object", "-w", "LICENSE")},docs/link`);
  f.git("commit", "-qm", "Add link");
  assert.throws(() => stageDocsImport({ ...f, revision: f.git("rev-parse", "HEAD") }), /regular|link/i);
  f.git("reset", "--hard", f.revision); f.git("rm", "LICENSE"); f.git("commit", "-qm", "Remove licence");
  assert.throws(() => stageDocsImport({ ...f, revision: f.git("rev-parse", "HEAD") }), /LICENSE|licence/i);
  assert.throws(() => readFileSync(f.out), { code: "ENOENT" });
});


test("snapshot reading refuses links, oversized files, malformed JSON and unknown fields", t => {
  const f = fixture(t); stageDocsImport(f);
  assert.deepEqual(readDocsImport(f.out), JSON.parse(readFileSync(f.out)));
  const link = join(f.out, "..", "linked.json"); symlinkSync(f.out, link);
  assert.throws(() => readDocsImport(link));
  const hard = join(f.out, "..", "hard.json"); linkSync(f.out, hard);
  assert.throws(() => readDocsImport(hard)); rmSync(hard);
  const large = join(f.out, "..", "large.json"); writeFileSync(large, "{}"); truncateSync(large, 12 * 1024 * 1024 + 1);
  assert.throws(() => readDocsImport(large), /bounded/);
  writeFileSync(large, "{invalid}"); assert.throws(() => readDocsImport(large), /JSON/);
  const snapshot = JSON.parse(readFileSync(f.out)); snapshot.extra = "untrusted";
  writeFileSync(large, JSON.stringify(snapshot)); assert.throws(() => readDocsImport(large), /identity/);
});
