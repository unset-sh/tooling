import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { inputsOf, jobsOf, readText, runBlocks } from "./repo.mjs";

const workflow = readText(".github/workflows/automation-maps-refresh.yml");
const job = jobsOf(workflow).refresh;

test("map refresh is one read-only job with a registry and an optional dependency install", () => {
  assert.deepEqual(Object.keys(jobsOf(workflow)), ["refresh"]);
  assert.deepEqual(inputsOf(workflow), ["registry", "install"]);
  assert.match(workflow, /registry:\n {8}description: [^\n]+\n {8}type: string\n {8}default: \.github\/maps.json/);
  assert.match(workflow, /install:\n {8}description: [^\n]+\n {8}type: boolean\n {8}default: true/);
  assert.match(job, /^ {4}permissions:\n {6}contents: read\n/m);
  assert.doesNotMatch(workflow, /: write|secrets\.|secrets: inherit|git push|environment:|deploy-pages/);
});

test("map refresh rejects an unknown helper identity before checkout", () => {
  const [guard] = runBlocks(job);
  assert.match(job, /WORKFLOW_REPOSITORY: \$\{\{ job\.workflow_repository \}\}/);
  assert.match(job, /WORKFLOW_SHA: \$\{\{ job\.workflow_sha \}\}/);
  assert.ok(job.indexOf(guard) < job.indexOf("uses: actions/checkout@"));
  for (const [repository, sha, expected] of [
    ["unset-sh/tooling", "a".repeat(40), 0],
    ["", "", 1],
    ["unset-sh/docs", "a".repeat(40), 1],
    ["unset-sh/tooling", "main", 1],
    ["unset-sh/tooling", "a".repeat(39), 1],
    ["unset-sh/tooling", "A".repeat(40), 1],
    ["unset-sh/tooling", `${"a".repeat(40)}\n`, 1],
  ]) {
    const result = spawnSync("bash", ["-eo", "pipefail", "-c", guard], {
      env: { PATH: process.env.PATH, WORKFLOW_REPOSITORY: repository, WORKFLOW_SHA: sha }, encoding: "utf8",
    });
    assert.equal(result.status, expected, `${repository}@${sha}`);
  }
});

test("the consumer and helper use their own exact commits with a central Node version", () => {
  assert.match(job, /repository: \$\{\{ github\.repository \}\}\n {10}ref: \$\{\{ github\.sha \}\}\n {10}path: source\n {10}persist-credentials: false/);
  assert.match(job, /repository: \$\{\{ job\.workflow_repository \}\}\n {10}ref: \$\{\{ job\.workflow_sha \}\}\n {10}path: source\/\.build\/tooling\n {10}persist-credentials: false/);
  assert.match(job, /node-version-file: source\/\.build\/tooling\/\.nvmrc\n {10}package-manager-cache: false/);
});

test("the read-only API token belongs only to the runner step and never to installation", () => {
  const steps = job.split("\n      - ").slice(1);
  const install = steps.find((step) => step.includes("npm ci"));
  const runner = steps.find((step) => step.includes("refresh-maps.mjs"));
  assert.match(install, /if: inputs\.install\n {8}working-directory: source\n {8}run: npm ci --ignore-scripts/);
  assert.doesNotMatch(install, /TOKEN|env:|--(?:foreground-scripts|ignore-scripts=false)/);
  assert.match(runner, /MAP_REGISTRY: \$\{\{ inputs\.registry \}\}\n {10}DOCS_GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.equal((workflow.match(/DOCS_GITHUB_TOKEN:/g) ?? []).length, 1);
  for (const step of steps.filter((step) => step !== runner)) assert.doesNotMatch(step, /DOCS_GITHUB_TOKEN/);
  assert.match(runner, /run: node source\/\.build\/tooling\/scripts\/refresh-maps\.mjs --root "\$GITHUB_WORKSPACE\/source" --registry "\$MAP_REGISTRY" --out "\$RUNNER_TEMP\/maps-output"/);
});

test("a successful refresh uploads only the fixed validated snapshot and returns its same-run name", () => {
  assert.match(workflow, /value: \$\{\{ jobs\.refresh\.outputs\.artifact-name \}\}/);
  assert.match(job, /artifact-name: maps-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  const upload = job.slice(job.indexOf("      - name: Upload the complete map snapshot"));
  assert.match(upload, /name: maps-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\n {10}path: \$\{\{ runner\.temp \}\}\/maps-output\n {10}if-no-files-found: error\n {10}retention-days: 7\n {10}include-hidden-files: false/);
  assert.doesNotMatch(workflow, /always\(\)|continue-on-error:|overwrite: true/);
  assert.ok(job.indexOf("refresh-maps.mjs") < job.indexOf("uses: actions/upload-artifact@"));
});
