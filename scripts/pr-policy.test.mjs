import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPullRequest, validatePullRequest, pullRequestIdentity } from './pr-policy.mjs';

const sha = 'a'.repeat(40);
const body = `## What changes
Add the shared checks.
## Readiness
- [x] Independent — can merge after checks
- [ ] Dependent — requires prerequisites
Prerequisites and order: None.
Tested combination: Current staging with the pinned tooling revision.
## Validation
Node 26: npm run check passed.
## Documentation
Updated docs/pr-policy.md with the caller contract and limits.
`;
const pr = (change = {}) => ({ number: 12, state: 'open', draft: false, body,
  labels: [{ name: 'kind:maintenance' }], base: { repo: { full_name: 'unset-sh/tooling' } },
  head: { sha }, ...change });
const identity = { repository: 'unset-sh/tooling', number: 12, head: sha };

test('the canonical readiness, documentation and validation declarations pass', () => {
  assert.deepEqual(validatePullRequest(pr(), identity), []);
});

test('one known purpose is required; other labels never replace or multiply it', () => {
  for (const labels of [[], ['kind:unknown'], ['kind:fix', 'kind:docs'], ['impact:breaking-change']]) {
    assert.match(validatePullRequest(pr({ labels: labels.map(name => ({ name })) }), identity).join('\n'), /purpose label/);
  }
  assert.deepEqual(validatePullRequest(pr({ labels: [{name: 'kind:fix'}, {name:'impact:breaking-change'}] }), identity), []);
});

test('exactly one checked readiness choice is required outside comments and code', () => {
  for (const value of [body.replace('[x]', '[ ]'), body.replace('[ ] Dependent', '[x] Dependent'),
    body.replace('[x] Independent — can merge after checks', '<!-- - [x] Independent -->'),
    body.replace('- [x] Independent — can merge after checks', '```md\n- [x] Independent\n```')]) {
    assert.match(validatePullRequest(pr({ body: value }), identity).join('\n'), /readiness/);
  }
});

test('dependent declarations must name prerequisites and the tested combination', () => {
  const dependent = body.replace('[x] Independent', '[ ] Independent').replace('[ ] Dependent', '[x] Dependent');
  assert.match(validatePullRequest(pr({ body: dependent }), identity).join('\n'), /prerequisites/);
  const ready = dependent.replace('Prerequisites and order: None.', 'Prerequisites and order: https://github.com/unset-sh/brand/pull/3, then publish @unset-sh/brand@0.2.0 before this PR.');
  assert.deepEqual(validatePullRequest(pr({ body: ready }), identity), []);
  assert.match(validatePullRequest(pr({ body: ready.replace('Tested combination: Current staging with the pinned tooling revision.', 'Tested combination: <!-- fill this -->') }), identity).join('\n'), /tested combination/);
  assert.match(validatePullRequest(pr({ body: ready.replace(/Prerequisites and order: .*/, 'Prerequisites and order:') }), identity).join('\n'), /prerequisites/);
});

test('documentation and validation require authored text, not template comments or placeholders', () => {
  for (const replacement of ['', '<!-- Explain why no update is needed. -->', 'TODO', 'N/A', '- [ ] Updated docs']) {
    const value = body.replace('Updated docs/pr-policy.md with the caller contract and limits.', replacement);
    assert.match(validatePullRequest(pr({ body: value }), identity).join('\n'), /Documentation/);
  }
  const noChange = body.replace('Updated docs/pr-policy.md with the caller contract and limits.', 'No documentation change: this only corrects an existing test fixture and leaves supported behaviour unchanged.');
  assert.deepEqual(validatePullRequest(pr({ body: noChange }), identity), []);
  assert.deepEqual(validatePullRequest(pr({ body: body.replace('Updated docs/pr-policy.md with the caller contract and limits.', 'README.md') }), identity), []);
});

test('duplicate sections and malformed/unbounded payloads fail closed', () => {
  for (const change of [{body: body+'\n## Documentation\nAnother statement.'}, {body: 'x'.repeat(65537)}, {body:null}, {labels: Array(101).fill({name:'kind:fix'})}]) {
    assert.throws(() => validatePullRequest(pr(change), identity), /payload|section|labels|body/);
  }
});

test('metadata cannot be accepted for another repository, PR, head or closed PR', () => {
  for (const change of [{number:13}, {state:'closed'}, {head:{sha:'b'.repeat(40)}}, {base:{repo:{full_name:'other/tooling'}}}]) {
    assert.throws(() => validatePullRequest(pr(change), identity), /identity|open/);
  }
});

test('only real pull-request events with bounded identity are accepted', () => {
  const event={number:12,repository:{full_name:'unset-sh/tooling'},pull_request:{number:12,head:{sha}}};
  assert.deepEqual(pullRequestIdentity('pull_request','unset-sh/tooling',event),identity);
  assert.throws(()=>pullRequestIdentity('pull_request_target','unset-sh/tooling',event),/pull_request/);
  for(const repository of ['other/tooling','unset-sh/tooling/extra','unset-sh/tooling\n']) {
    assert.throws(()=>pullRequestIdentity('pull_request',repository,event),/repository/);
  }
  assert.throws(()=>pullRequestIdentity('pull_request','unset-sh/tooling',{...event,number:13}),/number/);
});

test('the API request is fixed, read-only, bounded and uses current metadata', async () => {
  let seen;
  const fetchImpl=async(url,options)=>{seen={url,options};return new Response(JSON.stringify(pr()),{status:200});};
  assert.deepEqual(await checkPullRequest(identity,{token:'test-token',fetchImpl}),[]);
  assert.equal(seen.url,'https://api.github.com/repos/unset-sh/tooling/pulls/12');
  assert.equal(seen.options.method,'GET');
  assert.equal(seen.options.redirect,'error');
  assert.equal(seen.options.headers.authorization,'Bearer test-token');
  await assert.rejects(checkPullRequest(identity,{fetchImpl:async()=>new Response('secret diagnostic',{status:403})}),/GitHub returned HTTP 403$/);
  await assert.rejects(checkPullRequest(identity,{fetchImpl:async()=>new Response('x'.repeat(1048577),{status:200})}),/limit/);
});
