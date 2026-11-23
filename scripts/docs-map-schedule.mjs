// A timer on the default staging branch requests the existing approved main build.
// REST 2026-03-10 returns the created workflow run identity with HTTP 200.
// https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
// https://docs.github.com/en/actions/concepts/security/github_token
import { startedAsScript } from './cli.mjs';

export async function dispatchDocsMaps(context, { token, fetchImpl = fetch } = {}) {
  if (context?.repository !== 'unset-sh/docs' || context.ref !== 'refs/heads/staging' ||
      !['schedule', 'workflow_dispatch'].includes(context.event)) throw Error('Invalid docs map schedule context');
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw Error('Missing or invalid docs job token');
  let response;
  try {
    response = await fetchImpl('https://api.github.com/repos/unset-sh/docs/actions/workflows/site.yml/dispatches', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2026-03-10',
        authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    });
  } catch { throw Error('Docs site dispatch request failed'); }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    throw Error('Docs site dispatch was not confirmed');
  }
  let result;
  try {
    const chunks = []; let length = 0;
    for await (const chunk of response.body ?? []) {
      length += chunk.byteLength;
      if (length > 4096) throw Error('limit');
      chunks.push(chunk);
    }
    result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { throw Error('Cannot read the bounded docs dispatch result'); }
  const id = result?.workflow_run_id;
  if (!Number.isSafeInteger(id) || id <= 0 || result.run_url !== `https://api.github.com/repos/unset-sh/docs/actions/runs/${id}` ||
      result.html_url !== `https://github.com/unset-sh/docs/actions/runs/${id}`) throw Error('Invalid docs site run identity');
  return { runId: id, url: result.html_url };
}

if (startedAsScript(import.meta.url)) {
  try {
    const result = await dispatchDocsMaps({ repository: process.env.GITHUB_REPOSITORY,
      ref: process.env.GITHUB_REF, event: process.env.GITHUB_EVENT_NAME }, { token: process.env.GH_TOKEN });
    console.log(`Requested the main site refresh: ${result.url}`);
    console.log('Follow that run for collection, build and deployment results. Dispatch does not prove deployment succeeded.');
  } catch {
    console.error('Unable to confirm the main site refresh. Inspect site runs before retrying; the request may already have created a run.');
    process.exitCode = 1;
  }
}
