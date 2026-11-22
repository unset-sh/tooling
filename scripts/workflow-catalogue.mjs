import { createHash } from "node:crypto";
import { validateWorkflowDescriptions, workflowDocumentation } from "./workflow-descriptions.mjs";

const ORG = "unset-sh";
const SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;
const LIMIT = { repositories: 200, workflows: 2000, jobs: 256, calls: 10000, text: 8192,
  filters: 200, sourceBytes: 1024 * 1024, responseBytes: 4 * 1024 * 1024, catalogueBytes: 4 * 1024 * 1024 };
const FILTERS = ["branches", "branches-ignore", "tags", "tags-ignore", "paths", "paths-ignore", "types", "workflows"];
const EMPTY = Symbol("empty repository");
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const fail = (message) => { throw new Error(message); };
const requireValue = (condition, message) => { if (!condition) fail(message); };
const text = (value) => typeof value === "string" && value.trim().length > 0 && value.length <= LIMIT.text &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const filename = (value) => text(value) && value.length <= 255 && !/[\\/]/.test(value) && /\.ya?ml$/.test(value);
const refName = (value) => text(value) && value !== "@" && !/[\s~^:?*\[\\]/.test(value) && !value.includes("..") &&
  !value.includes("@{") && !value.startsWith("refs/") && value.split("/").every((part) =>
    part && !part.startsWith(".") && !part.endsWith(".") && !part.endsWith(".lock"));
const idFor = (repository, path, commit) => `${ORG}/${repository}/${path}@${commit}`;

function strings(value, limit = LIMIT.filters) {
  const items = typeof value === "string" ? [value] : value;
  requireValue(Array.isArray(items) && items.length <= limit && items.every(text), "Invalid workflow string list");
  return [...items];
}

function permissions(value) {
  if (value === undefined) return null;
  if (value === "read-all" || value === "write-all") return value;
  requireValue(object(value) && Object.keys(value).length <= 50, "Invalid workflow permissions");
  const entries = Object.entries(value).sort(([a], [b]) => compare(a, b));
  requireValue(entries.every(([key, access]) => text(key) && /^[a-z][a-z-]*$/.test(key) && ["none", "read", "write"].includes(access)),
    "Invalid workflow permissions");
  return Object.fromEntries(entries);
}

function events(value) {
  if (typeof value === "string") value = { [value]: null };
  else if (Array.isArray(value)) value = Object.fromEntries(strings(value).map((name) => [name, null]));
  requireValue(object(value) && Object.keys(value).length > 0 && Object.keys(value).length <= LIMIT.filters,
    "Invalid workflow events");
  return Object.entries(value).sort(([a], [b]) => compare(a, b)).map(([name, settings]) => {
    requireValue(text(name) && /^[a-z][a-z0-9_]*$/.test(name), "Invalid workflow event name");
    if (name === "schedule") {
      requireValue(Array.isArray(settings) && settings.length <= LIMIT.filters && settings.every((entry) => object(entry) && text(entry.cron)),
        "Invalid workflow schedule");
      return { name, config: settings.map(({ cron }) => cron) };
    }
    requireValue(settings === null || object(settings), "Invalid workflow event settings");
    const selected = FILTERS.filter((key) => settings?.[key] !== undefined)
      .map((key) => [key, strings(settings[key])]);
    return { name, config: selected.length ? Object.fromEntries(selected) : null };
  });
}

function normalizeWorkflow(source, parseYaml, repository, path, commit, current, descriptions) {
  let parsed;
  try { parsed = parseYaml(source); } catch { fail("Cannot parse workflow YAML"); }
  requireValue(object(parsed) && object(parsed.jobs), "Invalid workflow document");
  const entries = Object.entries(parsed.jobs).sort(([a], [b]) => compare(a, b));
  requireValue(entries.length > 0 && entries.length <= LIMIT.jobs, "Invalid workflow job count");
  const jobs = entries.map(([id, job]) => {
    requireValue(/^[A-Za-z_][A-Za-z0-9_-]*$/.test(id) && text(id) && object(job), "Invalid workflow job");
    const name = job.name ?? id;
    const needs = job.needs === undefined ? [] : strings(job.needs, LIMIT.jobs);
    const condition = job.if === undefined ? null : typeof job.if === "boolean" ? String(job.if) : job.if;
    const environment = object(job.environment) ? job.environment.name : job.environment ?? null;
    requireValue(text(name) && (condition === null || text(condition)) && (environment === null || text(environment)) &&
      (job.uses === undefined || text(job.uses)) && new Set(needs).size === needs.length, "Invalid workflow job fields");
    return { id, name, needs, condition, permissions: permissions(job.permissions), environment, uses: job.uses ?? null };
  });
  const jobIds = new Set(jobs.map(({ id }) => id));
  requireValue(jobs.every(({ id, needs }) => needs.every((need) => need !== id && jobIds.has(need))), "Invalid workflow job dependency");
  const ordered = new Set();
  for (let pass = 0; pass < jobs.length; pass++) {
    for (const job of jobs) if (job.needs.every((id) => ordered.has(id))) ordered.add(job.id);
  }
  requireValue(ordered.size === jobs.length, "Invalid workflow job dependency cycle");
  requireValue(parsed.name === undefined || text(parsed.name), "Invalid workflow name");
  const sha256 = createHash("sha256").update(source).digest("hex");
  return { id: idFor(repository, path, commit), repository, path, commit, sha256, name: parsed.name ?? path.slice(18),
    events: events(parsed.on), current, permissions: permissions(parsed.permissions), jobs,
    documentation: workflowDocumentation({ repository, path, sha256 }, descriptions) };
}

function githubReader(fetchImpl, githubToken) {
  let requests = 0;
  return async (path, { missing = false, empty = false } = {}) => {
    requireValue(++requests <= 10000, "Workflow catalogue request limit exceeded");
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" };
    if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
    let response;
    try {
      response = await fetchImpl(`https://api.github.com${path}`, {
        method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(15000),
      });
    } catch { fail("GitHub workflow catalogue request failed"); }
    requireValue(!response.redirected, "GitHub workflow catalogue redirect refused");
    if (missing && response.status === 404) return null;
    if (empty && response.status === 409) return EMPTY;
    requireValue(response.status === 200, `GitHub workflow catalogue request returned HTTP ${response.status}`);
    let data;
    try {
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > LIMIT.responseBytes) { await reader.cancel(); fail("Response too large"); }
        chunks.push(value);
      }
      data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } catch { fail("Invalid or oversized GitHub workflow catalogue response"); }
    return data;
  };
}

// Fixed host and public-only inventory: never follow API-provided URLs or run repository code.
// https://docs.github.com/en/rest/repos/repos#list-organization-repositories
async function discoverRepositories(read) {
  const found = new Map();
  for (let page = 1; page <= 3; page++) {
    const batch = await read(`/orgs/${ORG}/repos?type=public&per_page=100&page=${page}`);
    requireValue(Array.isArray(batch) && batch.length <= 100, "Invalid public repository inventory");
    for (const repo of batch) {
      requireValue(object(repo) && REPOSITORY.test(repo.name) && repo.full_name === `${ORG}/${repo.name}` &&
        repo.owner?.login === ORG && repo.private === false && repo.visibility === "public" && typeof repo.archived === "boolean" &&
        (repo.default_branch === null || refName(repo.default_branch)) && Number.isSafeInteger(repo.size) && repo.size >= 0 &&
        !found.has(repo.name.toLowerCase()), "Invalid public repository inventory entry");
      found.set(repo.name.toLowerCase(), repo);
      requireValue(found.size <= LIMIT.repositories, "Workflow catalogue repository limit exceeded");
    }
    if (batch.length < 100) return [...found.values()].sort((a, b) => compare(a.name, b.name));
  }
  fail("Workflow catalogue repository pagination limit exceeded");
}

function gitObjects(read) {
  const directories = new Map();
  const roots = new Map();
  async function tree(repository, sha) {
    const result = await read(`/repos/${ORG}/${repository}/git/trees/${sha}`);
    requireValue(result?.sha === sha && result.truncated === false && Array.isArray(result.tree) && result.tree.length <= 10000,
      "Invalid or truncated workflow tree");
    const seen = new Set();
    for (const entry of result.tree) {
      requireValue(object(entry) && text(entry.path) && !/[\\/]/.test(entry.path) && SHA.test(entry.sha) && !seen.has(entry.path),
        "Invalid workflow tree entry");
      seen.add(entry.path);
    }
    return result.tree;
  }
  async function root(repository, commit, missing = false) {
    const key = `${repository}@${commit}`;
    if (roots.has(key)) return roots.get(key);
    const data = await read(`/repos/${ORG}/${repository}/git/commits/${commit}`, { missing });
    if (data === null) return null;
    requireValue(data?.sha === commit && SHA.test(data.tree?.sha), "Invalid workflow commit identity");
    const entries = await tree(repository, data.tree.sha);
    roots.set(key, entries);
    return entries;
  }
  async function files(repository, commit, missing = false) {
    const key = `${repository}@${commit}`;
    if (directories.has(key)) return directories.get(key);
    let entries = await root(repository, commit, missing);
    if (entries === null) return null;
    for (const name of [".github", "workflows"]) {
      const entry = entries.find(({ path }) => path === name);
      if (!entry) { directories.set(key, []); return []; }
      requireValue(entry.type === "tree" && entry.mode === "040000", "Workflow directory must be a Git tree");
      entries = await tree(repository, entry.sha);
    }
    const workflows = entries.filter(({ path }) => /\.ya?ml$/.test(path));
    requireValue(workflows.every((entry) => filename(entry.path) && entry.type === "blob" && ["100644", "100755"].includes(entry.mode) &&
      Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= LIMIT.sourceBytes), "Workflow must be a bounded regular file");
    workflows.sort((a, b) => compare(a.path, b.path));
    directories.set(key, workflows);
    return workflows;
  }
  async function descriptions(commit) {
    const directory = (await root("tooling", commit)).find(({ path }) => path === "workflows");
    requireValue(directory?.type === "tree" && directory.mode === "040000", "Missing or invalid workflow descriptions directory");
    const entry = (await tree("tooling", directory.sha)).find(({ path }) => path === "descriptions.json");
    requireValue(entry?.type === "blob" && ["100644", "100755"].includes(entry.mode) &&
      Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= LIMIT.sourceBytes,
    "Missing or invalid bounded workflow descriptions file");
    const content = await source("tooling", entry);
    let parsed;
    try { parsed = JSON.parse(content.replace(/^\uFEFF/, "")); }
    catch { fail("Invalid workflow descriptions JSON"); }
    return { records: validateWorkflowDescriptions(parsed), provenance: { repository: `${ORG}/tooling`, commit,
      sha256: createHash("sha256").update(content).digest("hex") } };
  }
  // Blobs must match their Git object identity, byte length, and UTF-8 source.
  // https://docs.github.com/en/rest/git/blobs#get-a-blob
  async function source(repository, entry) {
    const blob = await read(`/repos/${ORG}/${repository}/git/blobs/${entry.sha}`);
    requireValue(blob?.sha === entry.sha && blob.encoding === "base64" && typeof blob.content === "string" &&
      blob.size === entry.size, "Invalid workflow blob identity");
    const encoded = blob.content.replace(/\n/g, "");
    const bytes = Buffer.from(encoded, "base64");
    requireValue(bytes.length === entry.size && bytes.toString("base64") === encoded &&
      createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") === entry.sha,
    "Invalid workflow blob content");
    // Keep a leading BOM in the text so re-encoding for SHA-256 preserves every source byte.
    // https://nodejs.org/download/release/v26.12.0/docs/api/util.html#new-textdecoderencoding-options
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { fail("Workflow source must be UTF-8"); }
  }
  return { files, source, descriptions };
}

function parseReference(reference, caller, repositories) {
  if (/^[.$]\/\.github\/workflows\//.test(reference)) {
    const name = reference.slice(20);
    return filename(name) && !name.includes("@") ? { repository: caller.repository,
      path: `.github/workflows/${name}`, commit: caller.commit, resolution: "local" } : { status: "invalid" };
  }
  const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/\.github\/workflows\/([^/]+\.ya?ml)@(.+)$/.exec(reference);
  if (!match || !filename(match[3]) || !refName(match[4])) return { status: "invalid" };
  const [, owner, repository, name, ref] = match;
  const known = repositories.find((entry) => entry.name.toLowerCase() === repository.toLowerCase());
  if (owner.toLowerCase() !== ORG || !known) return { status: "external" };
  return { repository: known.name, path: `.github/workflows/${name}`, ref };
}

// Tags take precedence over branches; local calls use the caller's exact commit.
// https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows#calling-a-reusable-workflow
function revisionResolver(read) {
  const resolved = new Map();
  return async (repository, ref) => {
    if (SHA.test(ref)) return { commit: ref, resolution: "commit" };
    const key = `${repository}@${ref}`;
    if (resolved.has(key)) return resolved.get(key);
    for (const [kind, resolution] of [["tags", "tag"], ["heads", "branch"]]) {
      const value = await read(`/repos/${ORG}/${repository}/git/ref/${kind}/${encodeURIComponent(ref)}`, { missing: true });
      if (value === null) continue;
      requireValue(value.ref === `refs/${kind}/${ref}` && SHA.test(value.object?.sha), "Invalid workflow reference identity");
      let target = value.object;
      const seen = new Set();
      while (kind === "tags" && target.type === "tag") {
        requireValue(seen.size < 10 && !seen.has(target.sha), "Invalid or excessive annotated tag chain");
        seen.add(target.sha);
        const tag = await read(`/repos/${ORG}/${repository}/git/tags/${target.sha}`);
        requireValue(tag.sha === target.sha && SHA.test(tag.object?.sha), "Invalid annotated tag identity");
        target = tag.object;
      }
      const result = target.type === "commit" ? { commit: target.sha, resolution } : { status: "invalid" };
      resolved.set(key, result);
      return result;
    }
    resolved.set(key, { status: "missing" });
    return { status: "missing" };
  };
}

async function collectCalls(workflows, repositories, git, read, parseYaml, account, descriptions) {
  const known = new Map(workflows.map((workflow) => [workflow.id, workflow]));
  const resolveRevision = revisionResolver(read);
  const calls = [];
  // New pinned versions append to this queue; seen identities terminate repeated calls and cycles.
  for (let cursor = 0; cursor < workflows.length; cursor++) {
    const caller = workflows[cursor];
    for (const job of caller.jobs.filter(({ uses }) => uses !== null)) {
      const target = parseReference(job.uses, caller, repositories);
      const call = { callerId: caller.id, jobId: job.id, targetId: null, reference: job.uses,
        resolution: target.status ?? target.resolution, status: target.status ?? "resolved" };
      if (!target.status) {
        const revision = target.commit ? target : await resolveRevision(target.repository, target.ref);
        call.resolution = revision.status ?? revision.resolution;
        if (revision.status) call.status = revision.status;
        else {
          const id = idFor(target.repository, target.path, revision.commit);
          let workflow = known.get(id);
          if (!workflow) {
            const files = await git.files(target.repository, revision.commit, true);
            const entry = files?.find(({ path }) => `.github/workflows/${path}` === target.path);
            if (entry) workflow = normalizeWorkflow(await git.source(target.repository, entry), parseYaml,
              target.repository, target.path, revision.commit, false, descriptions);
          }
          if (!workflow) call.status = call.resolution = "missing";
          else if (!workflow.events.some(({ name }) => name === "workflow_call")) call.status = call.resolution = "invalid";
          else {
            call.targetId = id;
            if (!known.has(id)) {
              requireValue(workflows.length < LIMIT.workflows, "Workflow catalogue workflow limit exceeded");
              known.set(id, workflow);
              workflows.push(account(workflow));
            }
          }
        }
      }
      calls.push(account(call));
      requireValue(calls.length <= LIMIT.calls, "Workflow catalogue call limit exceeded");
    }
  }
  return calls.sort((a, b) => compare(a.callerId, b.callerId) || compare(a.jobId, b.jobId));
}

export async function collectWorkflowCatalogue({ parseYaml, fetchImpl = fetch, githubToken, now = () => new Date(), collectorCommit } = {}) {
  requireValue(typeof parseYaml === "function" && typeof fetchImpl === "function" && typeof now === "function" && SHA.test(collectorCommit),
    "Workflow catalogue requires a parser and full collector commit");
  requireValue(githubToken === undefined || (typeof githubToken === "string" && /^[\x21-\x7e]{1,4096}$/.test(githubToken)),
    "Invalid workflow catalogue token");
  const read = githubReader(fetchImpl, githubToken);
  const inventory = await discoverRepositories(read);
  const git = gitObjects(read);
  const repositories = [];
  const workflows = [];
  let bytes = 0;
  const account = (value) => {
    bytes += Buffer.byteLength(JSON.stringify(value));
    requireValue(bytes <= LIMIT.catalogueBytes, "Workflow catalogue size limit exceeded");
    return value;
  };
  for (const repo of inventory) {
    const branch = repo.default_branch === null ? EMPTY : await read(
      `/repos/${ORG}/${repo.name}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`, { empty: repo.size === 0 });
    const commit = branch === EMPTY ? null : branch.object?.sha;
    requireValue(branch === EMPTY || (branch.ref === `refs/heads/${repo.default_branch}` && branch.object?.type === "commit" && SHA.test(commit)),
      "Invalid workflow default branch identity");
    repositories.push({ name: repo.name, defaultBranch: repo.default_branch, commit, archived: repo.archived, workflowIds: [] });
  }
  const tooling = repositories.find(({ name }) => name === "tooling");
  requireValue(tooling?.commit, "Public nonempty tooling repository required for workflow descriptions");
  const { records: descriptions, provenance } = await git.descriptions(tooling.commit);
  account(provenance);
  for (const repo of repositories) {
    const { commit, workflowIds } = repo;
    if (commit) for (const entry of await git.files(repo.name, commit)) {
      const path = `.github/workflows/${entry.path}`;
      workflows.push(account(normalizeWorkflow(await git.source(repo.name, entry), parseYaml, repo.name, path, commit, true, descriptions)));
      workflowIds.push(idFor(repo.name, path, commit));
      requireValue(workflows.length <= LIMIT.workflows, "Workflow catalogue workflow limit exceeded");
    }
    account(repo);
  }
  const calls = await collectCalls(workflows, repositories, git, read, parseYaml, account, descriptions);
  const result = { schemaVersion: 1, organisation: ORG, collectedAt: now().toISOString(),
    collector: { repository: `${ORG}/tooling`, commit: collectorCommit }, descriptions: provenance, repositories,
    workflows: workflows.sort((a, b) => compare(a.id, b.id)), calls };
  requireValue(Buffer.byteLength(JSON.stringify(result)) <= LIMIT.catalogueBytes, "Workflow catalogue size limit exceeded");
  return result;
}
