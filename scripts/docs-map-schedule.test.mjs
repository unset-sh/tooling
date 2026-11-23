import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dispatchDocsMaps } from './docs-map-schedule.mjs';

const context = { repository: 'unset-sh/docs', ref: 'refs/heads/staging', event: 'schedule' };
const result = { workflow_run_id: 123, run_url: 'https://api.github.com/repos/unset-sh/docs/actions/runs/123', html_url: 'https://github.com/unset-sh/docs/actions/runs/123' };

test('the timer can request only the approved main site workflow with a repository job token', async () => {
  for (const event of ['schedule', 'workflow_dispatch']) {
    const actual = await dispatchDocsMaps({ ...context, event }, { token: 'test-token', fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.github.com/repos/unset-sh/docs/actions/workflows/site.yml/dispatches');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.authorization, 'Bearer test-token');
      assert.equal(options.headers['x-github-api-version'], '2026-03-10');
      assert.deepEqual(JSON.parse(options.body), { ref: 'main' });
      return Response.json(result);
    } });
    assert.deepEqual(actual, { runId: 123, url: result.html_url });
  }
});

test('wrong repository, branch, event or missing credentials fail before a request', async () => {
  const fetchImpl = () => { throw Error('must not request'); };
  for (const change of [{ repository: 'unset-sh/tooling' }, { ref: 'refs/heads/main' }, { event: 'pull_request' }, { event: 'push' }]) {
    await assert.rejects(dispatchDocsMaps({ ...context, ...change }, { token: 'test-token', fetchImpl }), /context/);
  }
  for (const token of [undefined, '', 'abc\nheader']) await assert.rejects(dispatchDocsMaps(context, { token, fetchImpl }), /token/);
});

test('dispatch responses cannot invent a success, unrelated run or unsafe link', async () => {
  for (const value of [{ ...result, workflow_run_id: 0 }, { ...result, html_url: 'https://example.com' }, { ...result, run_url: result.run_url + '?token=secret' }]) {
    await assert.rejects(dispatchDocsMaps(context, { token: 'test-token', fetchImpl: async () => Response.json(value) }), /identity/);
  }
  for (const response of [new Response(null, { status: 204 }), new Response('secret', { status: 403 }), new Response('invalid secret'), new Response('x'.repeat(4097))]) {
    await assert.rejects(dispatchDocsMaps(context, { token: 'test-token', fetchImpl: async () => response }), error => !error.message.includes('secret'));
  }
  await assert.rejects(dispatchDocsMaps(context, { token: 'test-token', fetchImpl: async () => { throw Error('secret'); } }), /request failed/);
});
