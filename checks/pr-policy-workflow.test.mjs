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

test('the tooling caller rechecks metadata changes and has a matching form', () => {
  const caller = readText('.github/workflows/ci-pr-policy-self.yml');
  assert.match(caller, /types: \[opened, synchronize, reopened, edited, labeled, unlabeled, ready_for_review\]/);
  assert.match(caller, /uses: \.\/\.github\/workflows\/ci-pr-policy\.yml/);
  assert.doesNotMatch(caller, /paths:|if:|: write/);
  const template = readText('.github/pull_request_template.md');
  for (const heading of ['Readiness', 'Validation', 'Documentation']) assert.match(template, new RegExp(`^## ${heading}$`, 'm'));
  assert.match(template, /Prerequisites and order:/);
  assert.match(template, /Tested combination:/);
});
