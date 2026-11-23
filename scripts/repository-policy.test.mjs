import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { inspectRepositoryPolicy } from "./repository-policy.mjs";

const config = { schemaVersion: 1, dependencyManifests: ["package.json"], actionDefinitions: [], kit: "if-present", artifactPaths: [], exceptions: [] };
const env = { PATH: process.env.PATH, HOME: tmpdir(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "repository-policy-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  git("init", "--quiet");
  put(".github/repository-policy.json", JSON.stringify(config));
  put("package.json", JSON.stringify({ dependencies: { example: "1.2.3" } }));
  put(".github/workflows/check.yml", "on: push\njobs: {}\n");
  const commit = () => { git("add", "."); git("-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Fixture"); return git("rev-parse", "HEAD"); };
  return { root, git, put, commit };
}
const inspect = (fixture, revision, scan = () => []) => inspectRepositoryPolicy({ root: fixture.root, revision, repository: "unset-sh/example", scanner: "/verified/zizmor", scan });

test("inspection uses committed bytes, not dirty config, manifests, workflows or untracked artifacts", t => {
  const f = fixture(t); const revision = f.commit();
  f.put("package.json", '{"dependencies":{"example":"latest"}}');
  f.put(".github/repository-policy.json", "not JSON");
  f.put("notes/untracked.md", "Not part of this commit.");
  f.put(".github/workflows/check.yml", "UNCOMMITTED");
  const result = inspect(f, revision, files => {
    assert.deepEqual([...files.keys()], [".github/workflows/check.yml"]);
    assert.equal(files.values().next().value.toString(), "on: push\njobs: {}\n");
    return [];
  });
  assert.deepEqual(result, { revision, files: 3, workflows: 1, findings: [] });
});

test("identity, required files, malformed JSON and symlinked policy inputs fail before scanner execution", t => {
  for (const kind of ["head", "identity", "missing", "json", "link", "oversized"]) {
    const f = fixture(t);
    if (kind === "missing") rmSync(join(f.root, "package.json"));
    if (kind === "json") f.put("package.json", "{invalid secret}");
    if (kind === "oversized") f.put("package.json", " ".repeat(1024 * 1024 + 1));
    if (kind === "link") { rmSync(join(f.root, "package.json")); symlinkSync("/etc/passwd", join(f.root, "package.json")); }
    const revision = f.commit();
    let scanned = false;
    assert.throws(() => inspectRepositoryPolicy({ root: f.root, revision: kind === "head" ? "a".repeat(40) : revision,
      repository: kind === "identity" ? "outside/repo" : "unset-sh/example", scanner: "/verified/zizmor", scan: () => { scanned = true; return []; } }),
    error => !error.message.includes("secret"));
    assert.equal(scanned, false);
  }
});

test("committed violations combine with exact exceptions and never execute installed code", t => {
  const f = fixture(t);
  f.put("package.json", '{"dependencies":{"example":"latest"}}');
  f.put("notes/plan.md", "AI working notes belong in agent-kit.");
  const issue = { kind: "workflow", path: ".github/workflows/check.yml", reference: "example/action@v1", line: 5 };
  f.put(".github/repository-policy.json", JSON.stringify({ ...config, exceptions: [{ kind: "workflow", path: issue.path, reference: issue.reference, reason: "Reviewed temporary exception." }] }));
  const revision = f.commit();
  assert.deepEqual(inspect(f, revision, () => [issue]).findings, [
    { kind: "artifact", path: "notes/plan.md" },
    { kind: "dependency", path: "package.json", key: "dependencies.example", reference: "latest" },
  ]);
});

test("linked or nested workflow definitions and unsafe kit paths cannot be silently skipped", t => {
  for (const [path, linked] of [[".github/workflows/nested/check.yml", false], [".github/workflows/linked.yml", true], [".claude/agent-kit/unsafe file", false]]) {
    const f = fixture(t); f.put(path, "source");
    if (linked) { rmSync(join(f.root, path)); symlinkSync("../../package.json", join(f.root, path)); }
    const revision = f.commit();
    assert.throws(() => inspect(f, revision), /policy|workflow|input|kit/i);
  }
});
