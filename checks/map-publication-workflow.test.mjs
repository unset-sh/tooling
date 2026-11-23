import assert from "node:assert/strict";
import { test } from "node:test";
import { jobsOf, readText, topLevel } from "./repo.mjs";

const workflow = () => readText(".github/workflows/automation-org-map.yml");

test("organisation map publication has a read-only generator and isolated publisher", () => {
  const text = workflow();
  assert.equal(topLevel(text, "permissions"), "permissions: {}\n");
  const jobs = jobsOf(text);
  assert.deepEqual(Object.keys(jobs), ["generate", "publish", "dispatch"]);
  assert.match(jobs.generate, /contents: read/);
  assert.doesNotMatch(jobs.generate, /: write|secrets\./);
  assert.match(jobs.publish, /needs: generate/);
  assert.match(jobs.publish, /contents: write/);
  assert.match(jobs.publish, /pull-requests: write/);
  assert.doesNotMatch(jobs.publish, /npm |working-directory: source|path: source/);
  assert.doesNotMatch(jobs.publish, /actions: write/);
  assert.match(jobs.dispatch, /needs: publish/);
  assert.match(jobs.dispatch, /if: needs\.publish\.outputs\.number != ''/);
  assert.match(jobs.dispatch, /contents: read\n {6}pull-requests: read\n {6}actions: write/);
  assert.doesNotMatch(jobs.dispatch, /contents: write|pull-requests: write|npm |path: source|download-artifact/);
  for (const field of ["number", "head", "base"]) assert.match(jobs.publish, new RegExp(`${field}: \\$\\{\\{ steps\\.publication\\.outputs\\.${field} \\}\\}`));
});

test("all three jobs refuse other repositories, refs and events before checking out code", () => {
  for (const job of Object.values(jobsOf(workflow()))) {
    const guard = job.indexOf('"$REPOSITORY" != unset-sh/.github');
    assert.ok(guard >= 0 && guard < job.indexOf("uses: actions/checkout@"));
    assert.match(job, /"\$REF" != refs\/heads\/main/);
    assert.match(job, /push\|schedule\|workflow_dispatch/);
    assert.match(job, /"\$WORKFLOW_REPOSITORY" != unset-sh\/tooling/);
    assert.match(job, /WORKFLOW_SHA/);
  }
});

test("only successful checked output reaches the same-run artifact and publisher", () => {
  const jobs = jobsOf(workflow());
  const generate = jobs.generate;
  const steps = ["npm run map", "npm run check", "generated-map-publication.mjs stage", "actions/upload-artifact@"];
  const positions = steps.map(step => generate.indexOf(step));
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(generate, /name: org-map-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);
  assert.match(jobs.publish, /name: org-map-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);
  assert.doesNotMatch(jobs.publish, /github-token:|run-id:|merge-multiple:|pattern:/);
  assert.match(jobs.publish, /repository: \$\{\{ job.workflow_repository \}\}/);
  assert.match(jobs.publish, /ref: \$\{\{ job.workflow_sha \}\}/);
  assert.match(jobs.publish, /GH_TOKEN: \$\{\{ github.token \}\}/);
  assert.doesNotMatch(workflow(), /continue-on-error:|always\(\)|pull_request_target|workflow_run/);
});
