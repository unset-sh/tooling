import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobsOf, readText, topLevel } from './repo.mjs';

const workflow = readText('.github/workflows/ci-pr-policy.yml');
const jobs = jobsOf(workflow);

test('PR policy is a read-only reusable check with no pull-request checkout', () => {
  assert.match(topLevel(workflow, 'on'), /^on:\n  workflow_call:\n/);
  assert.deepEqual(Object.keys(jobs), ['check']);
  assert.match(jobs.check, /name: PR policy/);
  assert.match(jobs.check, /contents: read/);
  assert.match(jobs.check, /pull-requests: read/);
  assert.doesNotMatch(workflow, /: write|secrets:|pull_request_target|workflow_run/);
  assert.equal([...workflow.matchAll(/uses: actions\/checkout@/g)].length, 1);
  assert.match(workflow, /repository: \$\{\{ job\.workflow_repository \}\}/);
  assert.match(workflow, /ref: \$\{\{ job\.workflow_sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /\[ "\$EVENT_NAME" != pull_request \]/);
  assert.match(workflow, /\[ "\$WORKFLOW_REPOSITORY" != unset-sh\/tooling \]/);
  assert.match(workflow, /node tooling\/scripts\/pr-policy\.mjs/);
  assert.doesNotMatch(workflow, /npm (ci|install|exec)|inputs\.check|inputs\.command/);
});
