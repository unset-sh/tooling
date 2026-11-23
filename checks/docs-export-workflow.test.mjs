import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { jobsOf, readText, runBlocks, topLevel } from "./repo.mjs";

const workflow = readText(".github/workflows/automation-docs-export.yml");
const job = jobsOf(workflow).export;

test("documentation export has one read-only job and accepts no consumer commands", () => {
  assert.deepEqual(Object.keys(jobsOf(workflow)), ["export"]);
  assert.equal(topLevel(workflow, "on"), "on:\n  workflow_call:\n");
  assert.match(job, /^ {4}permissions:\n {6}contents: read\n {4}steps:/m);
  assert.doesNotMatch(workflow, /: write|inputs\.|secrets\.|secrets: inherit|working-directory:|\bnpm\b|\bgh\b/);
  assert.equal(runBlocks(job).length, 2, "only the identity guard and central exporter run shell code");
});

test("export checks central helper identity before either checkout, and fails closed", () => {
  const [guard] = runBlocks(job);
  assert.match(job, /WORKFLOW_REPOSITORY: \$\{\{ job\.workflow_repository \}\}/);
  assert.match(job, /WORKFLOW_SHA: \$\{\{ job\.workflow_sha \}\}/);
  assert.ok(job.indexOf(guard) < job.indexOf("uses: actions/checkout@"));
  for (const [repository, sha, expected] of [
    ["unset-sh/tooling", "a".repeat(40), 0],
    ["", "", 1],
    ["unset-sh/.github", "a".repeat(40), 1],
    ["unset-sh/tooling", "main", 1],
    ["unset-sh/tooling", "a".repeat(39), 1],
    ["unset-sh/tooling", "A".repeat(40), 1],
  ]) {
    const result = spawnSync("bash", ["-eo", "pipefail", "-c", guard], {
      env: { PATH: process.env.PATH, WORKFLOW_REPOSITORY: repository, WORKFLOW_SHA: sha }, encoding: "utf8",
    });
    assert.equal(result.status, expected, `${repository}@${sha}: ${result.stderr}`);
  }
});

test("export reads the consumer commit while running its own pinned helper and Node", () => {
  assert.match(job, /repository: \$\{\{ github\.repository \}\}\n {10}ref: \$\{\{ github\.sha \}\}\n {10}path: source\n {10}persist-credentials: false/);
  assert.match(job, /repository: \$\{\{ job\.workflow_repository \}\}\n {10}ref: \$\{\{ job\.workflow_sha \}\}\n {10}path: tooling\n {10}persist-credentials: false/);
  assert.match(job, /node-version-file: tooling\/\.nvmrc\n {10}package-manager-cache: false/);
  assert.match(job, /SOURCE_REPOSITORY: \$\{\{ github\.repository \}\}\n {10}SOURCE_REVISION: \$\{\{ github\.sha \}\}/);
  assert.equal(runBlocks(job)[1], 'node tooling/scripts/export-docs.mjs --root "$GITHUB_WORKSPACE/source" --repository "$SOURCE_REPOSITORY" --revision "$SOURCE_REVISION" --out "$RUNNER_TEMP/docs-export"');
});

test("export uploads the entire provenance-bearing section without credentials or deployment", () => {
  assert.match(job, /name: docs-\$\{\{ github\.sha \}\}\n {10}path: \$\{\{ runner\.temp \}\}\/docs-export\n {10}if-no-files-found: error\n {10}retention-days: 14/);
  assert.doesNotMatch(workflow, /deploy|git push|ssh|GH_TOKEN|NODE_AUTH_TOKEN|environment:/);
});

test("tooling's docs caller waits for its own checks before exporting", () => {
  const caller = readText(".github/workflows/automation-docs-self.yml");
  assert.equal(topLevel(caller, "on"), "on:\n  pull_request:\n  push:\n    branches: [main]\n  workflow_dispatch:\n");
  const jobs = jobsOf(caller);
  assert.deepEqual(Object.keys(jobs), ["validate-docs", "export"]);
  assert.match(jobs['validate-docs'], /^ {4}uses: \.\/\.github\/workflows\/ci-check\.yml$/m);
  assert.match(jobs.export, /^ {4}needs: validate-docs\n {4}uses: \.\/\.github\/workflows\/automation-docs-export\.yml$/m);
  for (const job of Object.values(jobs)) assert.match(job, /^ {4}permissions:\n {6}contents: read$/m);
});
