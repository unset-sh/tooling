import assert from "node:assert/strict";
import { test } from "node:test";
import { jobsOf, readText, topLevel } from "./repo.mjs";

test("channel release keeps consumer execution read-only and gates central publication behind both prior jobs", () => {
  const workflow = readText(".github/workflows/releases-channel.yml"); const jobs = jobsOf(workflow);
  assert.deepEqual(Object.keys(jobs), ["plan", "build", "publish"]);
  assert.match(topLevel(workflow, "on"), /^on:\n  workflow_call:/);
  for (const name of ["plan", "build"]) assert.doesNotMatch(jobs[name], /: write|^    environment:/m);
  assert.match(jobs.publish, /needs: \[plan, build\]/);
  assert.match(jobs.publish, /if: needs\.plan\.outputs\.publish == 'true'/);
  assert.match(jobs.publish, /environment: \$\{\{ needs\.plan\.outputs\.environment \}\}/);
  assert.doesNotMatch(jobs.publish, /inputs\.(check|build|files)|COMMAND|path: repository|working-directory:/);
  assert.doesNotMatch(jobs.plan, /path: repository|working-directory:/);
  for (const job of Object.values(jobs)) {
    const guard = job.indexOf('if [ "$WORKFLOW_REPOSITORY" != unset-sh/tooling ]');
    assert.ok(guard > 0 && guard < job.indexOf("uses: actions/checkout@"));
    assert.match(job, /repository: \$\{\{ job\.workflow_repository \}\}\n\s+ref: \$\{\{ job\.workflow_sha \}\}/);
  }
  assert.match(jobs.build, /ref: \$\{\{ github\.sha \}\}/);
  assert.ok(jobs.build.indexOf("release-channel-run.mjs prepare") < jobs.build.indexOf("bun install --frozen-lockfile --ignore-scripts"));
  assert.match(jobs.build, /bun pm pack --ignore-scripts /);
  assert.match(jobs.publish, /name: channel-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  const order = ["release-channel-run.mjs verify", "actions/attest@", "release-channel-run.mjs reserve", "bun publish", "gh release create", "release-channel-run.mjs confirm"];
  const positions = order.map((s) => jobs.publish.indexOf(s));
  assert.ok(positions.every((p) => p >= 0)); assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  // As in releases-package.yml: a new folder with only the package and `{}`, HOME set to it, three names.
  assert.match(jobs.publish, /folder="\$\(mktemp -d\)"\n\s+cp "release\/files\/\$package" "\$folder\/"\n\s+printf '\{\}\\n' > "\$folder\/package\.json"\n\s+cd "\$folder"\n/);
  assert.match(jobs.publish, /env -i PATH="\$PATH" HOME="\$folder" NPM_CONFIG_TOKEN="\$NPM_CONFIG_TOKEN" \\\n\s+bun publish --ignore-scripts --tag "\$DIST_TAG" --registry https:\/\/npm\.pkg\.github\.com "\.\/\$package"\n/);
  assert.equal(jobs.publish.match(/bun publish/g).length, 1, "Bun publishes in one place");
  assert.match(jobs.publish, /--verify-tag/); assert.match(jobs.publish, /--prerelease --latest=false/);
  assert.doesNotMatch(jobs.publish, /--clobber|--force|release delete|git push/);
});
