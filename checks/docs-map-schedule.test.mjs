import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobsOf, readText, topLevel } from './repo.mjs';

test('the docs schedule dispatcher cannot execute consumer code or publish site content', () => {
  const workflow = readText('.github/workflows/automation-docs-map-schedule.yml');
  assert.match(topLevel(workflow, 'on'), /^on:\n  workflow_call:\n/);
  assert.deepEqual(Object.keys(jobsOf(workflow)), ['dispatch']);
  assert.match(workflow, /contents: read\n      actions: write/);
  assert.doesNotMatch(workflow, /contents: write|pages: write|id-token: write|secrets:|inputs:|npm (ci|install)/);
  assert.equal([...workflow.matchAll(/uses: actions\/checkout@/g)].length, 1);
  assert.match(workflow, /repository: \$\{\{ job\.workflow_repository \}\}/);
  assert.match(workflow, /ref: \$\{\{ job\.workflow_sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /schedule\|workflow_dispatch/);
  assert.match(workflow, /node tooling\/scripts\/docs-map-schedule\.mjs/);
});
