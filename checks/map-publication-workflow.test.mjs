import assert from "node:assert/strict";
import { test } from "node:test";
import { jobsOf, readText, topLevel } from "./repo.mjs";

const workflow = () => readText(".github/workflows/automation-org-map.yml");

test("organisation map publication has a read-only generator and isolated publisher", () => {
  const text = workflow();
  assert.equal(topLevel(text, "permissions"), "permissions: {}\n");
  const jobs = jobsOf(text);
  assert.deepEqual(Object.keys(jobs), ["generate", "publish"]);
  assert.match(jobs.generate, /contents: read/);
  assert.doesNotMatch(jobs.generate, /: write|secrets\./);
  assert.match(jobs.publish, /needs: generate/);
  assert.match(jobs.publish, /contents: read/);
  assert.doesNotMatch(jobs.publish, /^ {6}(?:contents|pull-requests|actions): write|npm |working-directory: source|path: source/m);
  assert.match(jobs.publish, /uses: actions\/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3\.3\.0/);
  assert.match(jobs.publish, /owner: unset-sh\n {10}repositories: \.github\n {10}permission-contents: write\n {10}permission-pull-requests: write/);
  assert.match(jobs.publish, /private-key: \$\{\{ secrets.automation-app-private-key \}\}/);
  assert.doesNotMatch(text, /skip-token-revoke: true|permission-actions:|permission-administration:|permission-checks:|generated-map-checks\.mjs/);
  assert.equal((text.match(/secrets\./g) ?? []).length, 1);
  assert.match(topLevel(text, "on"), /secrets:\n {6}automation-app-private-key:\n {8}required: true/);

});

test("both jobs refuse other repositories, refs and events before checking out code", () => {
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
  assert.match(jobs.publish, /GH_TOKEN: \$\{\{ steps.token.outputs.token \}\}/);
  assert.doesNotMatch(workflow(), /continue-on-error:|always\(\)|pull_request_target|workflow_run/);
});

test("only the central publisher receives App token outputs after source artifact preparation", () => {
  const jobs = jobsOf(workflow());
  assert.doesNotMatch(jobs.generate, /app-token|AUTOMATION_APP|secrets\./);
  const positions = ["actions/download-artifact@", "node tooling/scripts/automation-app.mjs", "actions/create-github-app-token@", "generated-map-publication.mjs publish"].map(value => jobs.publish.indexOf(value));
  assert.ok(positions.every(value => value >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(jobs.publish, /AUTOMATION_APP_SLUG: \$\{\{ steps.token.outputs.app-slug \}\}/);
  assert.match(jobs.publish, /AUTOMATION_APP_INSTALLATION_ID: \$\{\{ steps.token.outputs.installation-id \}\}/);
  assert.doesNotMatch(jobs.publish, /GH_TOKEN: \$\{\{ github.token \}\}|outputs:\n|token: \$\{\{ steps.app-token/);
});
