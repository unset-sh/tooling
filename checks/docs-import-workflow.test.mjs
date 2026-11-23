import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { jobsOf, readText, runBlocks, topLevel } from "./repo.mjs";

const workflow = readText("workflows/shared/docs/import.yml");
const jobs = jobsOf(workflow);
const permissions = job => [...job.slice(job.indexOf("    permissions:"), job.indexOf("    steps:")).matchAll(/^ {6}([a-z-]+): (read|write)$/gm)]
  .map(([, scope, access]) => `${scope}:${access}`);

test("docs imports separate source preparation from an App publisher with a read-only built-in token", () => {
  assert.deepEqual(Object.keys(jobs), ["prepare", "publish"]);
  assert.match(topLevel(workflow, "on"), /^on:\n  workflow_call:/);
  assert.equal(topLevel(workflow, "permissions").trim(), "permissions: {}");
  assert.deepEqual(permissions(jobs.prepare), ["contents:read"]);
  assert.deepEqual(permissions(jobs.publish), ["contents:read"]);
  assert.match(jobs.publish, /^    needs: prepare$/m);
  assert.doesNotMatch(workflow, /always\(\)|pull_request_target|workflow_run|npm (ci|run)|bash -c/);
  for (const block of runBlocks(workflow)) assert.doesNotMatch(block, /\$\{\{/);
});

test("every job refuses unsafe receiver and helper identity before the first checkout", () => {
  const environment = { PATH: process.env.PATH, WORKFLOW_REPOSITORY: "unset-sh/tooling", WORKFLOW_SHA: "a".repeat(40),
    GITHUB_REPOSITORY: "unset-sh/docs", GITHUB_REF: "refs/heads/main", GITHUB_SHA: "b".repeat(40), IMPORT_SOURCE: "tooling", GITHUB_EVENT_NAME: "schedule" };
  for (const job of Object.values(jobs)) {
    const guard = runBlocks(job)[0];
    assert.ok(job.indexOf("Invalid documentation receiver") < job.indexOf("uses: actions/checkout@"));
    assert.equal(spawnSync("bash", ["-c", guard], { env: environment, encoding: "utf8" }).status, 0);
    for (const change of [{ WORKFLOW_REPOSITORY: "outside/tooling" }, { WORKFLOW_SHA: "main" },
      { GITHUB_REPOSITORY: "unset-sh/tooling" }, { GITHUB_REF: "refs/heads/staging" }, { GITHUB_SHA: "main" },
      { IMPORT_SOURCE: "$(exit 77)" }, { GITHUB_EVENT_NAME: "pull_request" }]) {
      const result = spawnSync("bash", ["-c", guard], { env: { ...environment, ...change }, encoding: "utf8" });
      assert.equal(result.status, 1, result.stderr); assert.match(result.stdout, /Invalid documentation/);
    }
  }
});

test("privileged jobs load only pinned central code and consume the same-run artifact as data", () => {
  for (const name of ["publish"]) {
    const job = jobs[name];
    assert.equal((job.match(/uses: actions\/checkout@/g) ?? []).length, 1);
    assert.match(job, /repository: \$\{\{ job\.workflow_repository \}\}\n\s+ref: \$\{\{ job\.workflow_sha \}\}/);
    assert.doesNotMatch(job, /path: source|working-directory:|inputs\.(command|build|check)|persist-credentials: true/);
  }
  const name = "name: docs-import-${{ inputs.source }}-${{ github.run_id }}-${{ github.run_attempt }}";
  assert.ok(jobs.prepare.includes(name)); assert.ok(jobs.publish.includes(name));
  assert.match(jobs.prepare, /repository: \$\{\{ steps\.source\.outputs\.repository \}\}\n\s+ref: \$\{\{ steps\.source\.outputs\.revision \}\}/);
  assert.match(jobs.publish, /docs-import\.mjs publish --source "\$IMPORT_SOURCE" --snapshot "\$RUNNER_TEMP\/docs-import\/docs-import\.json"/);
});


test("only the isolated publisher mints the one-repository App token and passes no key to a shell", () => {
  assert.doesNotMatch(jobs.prepare, /create-github-app-token|automation-app-private-key|DOCS_APP_TOKEN/);
  assert.match(jobs.publish, /id: app\n\s+run: node tooling\/scripts\/automation-app\.mjs/);
  assert.match(jobs.publish, /DOCS_APP_TOKEN: \$\{\{ steps\.token\.outputs\.token \}\}/);
  assert.match(jobs.publish, /AUTOMATION_APP_SLUG: \$\{\{ steps\.token\.outputs\.app-slug \}\}/);
  assert.match(jobs.publish, /AUTOMATION_APP_INSTALLATION_ID: \$\{\{ steps\.token\.outputs\.installation-id \}\}/);
  assert.doesNotMatch(jobs.publish, /DOCS_GITHUB_TOKEN|^      (actions|pull-requests): write/m);
});
