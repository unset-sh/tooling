// Read-only PR metadata checks. No checkout or execution of pull-request code.
// REST contracts: https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request
// Policy taxonomy: unset-sh/.github PR13, reviewed 2026-11-22.
import { lstatSync, readFileSync } from 'node:fs';
import { startedAsScript } from './cli.mjs';

class PolicyError extends Error {}

const purposes = new Set(['kind:feature', 'kind:fix', 'kind:refactor', 'kind:docs', 'kind:maintenance']);
const maximumBody = 65536;
const maximumResponse = 1048576;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = value => typeof value === 'string' && value.length === 40 && /^[a-f0-9]{40}$/.test(value);
const repository = value => typeof value === 'string' && value.length <= 110 &&
  value.trim() === value && /^unset-sh\/(?:\.github|[a-zA-Z0-9][a-zA-Z0-9._-]*)$/.test(value);
const number = value => Number.isSafeInteger(value) && value > 0;

function validateIdentity(identity) {
  if (!object(identity) || !repository(identity.repository) || !number(identity.number) || !sha(identity.head)) {
    throw new PolicyError('Invalid pull-request repository, number or head identity');
  }
}

export function pullRequestIdentity(eventName, expectedRepository, event) {
  if (eventName !== 'pull_request') throw new PolicyError('PR metadata checks require a pull_request event');
  if (!repository(expectedRepository) || event?.repository?.full_name !== expectedRepository) {
    throw new PolicyError('Invalid pull-request repository');
  }
  if (!number(event.number) || event.pull_request?.number !== event.number) throw new PolicyError('Invalid pull-request number');
  const identity = { repository: expectedRepository, number: event.number, head: event.pull_request?.head?.sha };
  validateIdentity(identity);
  return identity;
}

// The template is a small Markdown form, not an executable configuration. Ignore
// comments and fenced/indented examples so they cannot fill in an unanswered field.
function formText(body) {
  const visible = body.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  let fence;
  const lines = [];
  for (const line of visible.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length &&
          line.slice(marker[0].length).trim() === '') fence = undefined;
      continue;
    }
    if (marker) { fence = marker[1]; continue; }
    if (/^(?: {4}|\t)/.test(line)) continue;
    lines.push(line);
  }
  return lines.join('\n');
}

function sectionsIn(body) {
  const sections = new Map();
  let current;
  for (const line of formText(body).split('\n')) {
    const heading = /^ {0,3}##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      current = heading[1].trim().toLowerCase();
      if (sections.has(current)) throw new PolicyError('Duplicate PR section');
      sections.set(current, []);
    } else if (current) sections.get(current).push(line);
  }
  return new Map([...sections].map(([key, lines]) => [key, lines.join('\n').trim()]));
}

function authored(value) {
  if (typeof value !== 'string') return false;
  const text = value.replace(/^\s*[-*]\s+\[[ xX]\].*$/gm, '').trim();
  return text.length > 0 && !/^(?:n\/?a|none|todo|tbd|not applicable|no change)[.\s]*$/i.test(text);
}

export function validatePullRequest(pr, identity) {
  validateIdentity(identity);
  if (!object(pr) || pr.number !== identity.number || pr.base?.repo?.full_name !== identity.repository ||
      pr.head?.sha !== identity.head) throw new PolicyError('Pull-request identity changed; rerun checks on its current head');
  if (pr.state !== 'open') throw new PolicyError('Pull request must be open');
  if (typeof pr.body !== 'string' || !pr.body.isWellFormed() || Buffer.byteLength(pr.body) > maximumBody) {
    throw new PolicyError('Invalid or oversized pull-request body payload');
  }
  if (!Array.isArray(pr.labels) || pr.labels.length > 100 || pr.labels.some(label =>
    !object(label) || typeof label.name !== 'string' || label.name.length > 100 || /[\r\n\0]/.test(label.name))) {
    throw new PolicyError('Invalid pull-request labels payload');
  }
  const problems = [];
  const kinds = pr.labels.filter(label => label.name.startsWith('kind:'));
  if (kinds.length !== 1 || !purposes.has(kinds[0].name)) {
    problems.push('Apply exactly one purpose label: kind:feature, kind:fix, kind:refactor, kind:docs or kind:maintenance');
  }
  const sections = sectionsIn(pr.body);
  const readiness = sections.get('readiness') ?? '';
  const choices = [...readiness.matchAll(/^ {0,3}[-*] \[[xX]\] (Independent|Dependent)(?:\s|$)/gm)];
  if (choices.length !== 1) problems.push('Select exactly one readiness choice: Independent or Dependent');
  const prerequisites = /^ {0,3}Prerequisites and order:[ \t]*(.*)$/mi.exec(readiness)?.[1]?.trim();
  if (!prerequisites || (choices[0]?.[1] === 'Dependent' && !authored(prerequisites))) {
    problems.push('Declare prerequisites and order; dependent work must name what must be available before it merges');
  }
  const combination = /^ {0,3}Tested combination:[ \t]*(.*)$/mi.exec(readiness)?.[1]?.trim();
  if (!authored(combination)) problems.push('Describe the tested combination of base and dependency revisions');
  if (!authored(sections.get('validation'))) problems.push('Fill in Validation with checks and their results or explicit verification limits');
  if (!authored(sections.get('documentation'))) problems.push('Fill in Documentation with the updated pages or a reason no documentation change is needed');
  return problems;
}

export async function checkPullRequest(identity, { token, fetchImpl = fetch } = {}) {
  validateIdentity(identity);
  const headers = { accept: 'application/vnd.github+json', 'x-github-api-version': '2026-03-10' };
  if (token) headers.authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetchImpl(`https://api.github.com/repos/${identity.repository}/pulls/${identity.number}`, {
      method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(30000),
    });
  } catch { throw new PolicyError('Unable to read current pull-request metadata from GitHub'); }
  if (!response.ok) throw new PolicyError(`GitHub returned HTTP ${response.status}`);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.byteLength;
    if (length > maximumResponse) throw new PolicyError('GitHub response exceeded the 1 MiB limit');
    chunks.push(chunk);
  }
  let pr;
  try { pr = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new PolicyError('GitHub returned invalid pull-request JSON'); }
  return validatePullRequest(pr, identity);
}

if (startedAsScript(import.meta.url)) {
  try {
    const path = process.env.GITHUB_EVENT_PATH;
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > maximumResponse) throw new PolicyError('Invalid pull-request event file');
    const event = JSON.parse(readFileSync(path, 'utf8'));
    const identity = pullRequestIdentity(process.env.GITHUB_EVENT_NAME, process.env.GITHUB_REPOSITORY, event);
    const problems = await checkPullRequest(identity, { token: process.env.GH_TOKEN });
    if (problems.length) {
      for (const problem of problems) console.error(`PR policy: ${problem}`);
      process.exitCode = 1;
    } else console.log('PR declarations and purpose label are present. Checks and independent review still determine merge readiness.');
  } catch (error) {
    // Never include API bodies, PR text or credentials in error output.
    console.error(`PR policy: ${error instanceof PolicyError ? error.message : 'Unable to read or validate pull-request data'}`);
    process.exitCode = 1;
  }
}
