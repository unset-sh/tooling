// GitHub REST API 2026-03-10: installation tokens are repository-scoped for writes.
// Every request, source reads included, carries the docs job token when there is one, so it
// counts against that token's quota rather than the runner's shared anonymous one (anonymous
// reads were refused with HTTP 403 in docs-import run 45302302882). The token only ever goes to
// api.github.com for the allowlisted repositories below, and only docs accepts writes. The
// tooling maps refresh already reads public org repositories with this same job token.
// https://docs.github.com/en/actions/concepts/security/github_token
// https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow
// https://docs.github.com/en/rest/git/trees#get-a-tree
import { decodeImportFiles, gitBlobHash, importLimits, importSource, isCommit, refuseImport, validateDocsImport, validateImportPaths } from "./docs-import-data.mjs";

const allowedRepositories = new Set(["unset-sh/docs", "unset-sh/tooling", "unset-sh/.github"]);
const maximumResponse = 10 * 1024 * 1024;

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) refuseImport("GitHub returned an empty response");
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximumResponse) { await reader.cancel(); refuseImport("GitHub response exceeds its limit"); }
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { refuseImport("Cannot read bounded GitHub JSON"); }
  finally { reader.releaseLock(); }
}

async function readRawDocs(fetchImpl, repository, path) {
  const match = /^\/raw\/([a-f0-9]{40})\/(tooling|github)\/(.+)$/.exec(path);
  if (repository !== "unset-sh/docs" || !match || match[0] !== path) refuseImport("Invalid raw documentation identity");
  validateImportPaths([{ path: match[3] }]);
  const address = `https://raw.githubusercontent.com/unset-sh/docs/${match[1]}/${match[2]}/${match[3].split("/").map(encodeURIComponent).join("/")}`;
  let response;
  try { response = await fetchImpl(address, { method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000) }); }
  catch { refuseImport("Raw documentation request failed"); }
  if (response.status !== 200) { await response.body?.cancel().catch(() => {}); refuseImport("Raw documentation request refused"); }
  const reader = response.body?.getReader();
  if (!reader) refuseImport("Missing raw documentation body");
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > importLimits.fileBytes) { await reader.cancel(); refuseImport("Raw documentation exceeds its byte limit"); }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch { refuseImport("Cannot read bounded raw documentation"); }
  finally { reader.releaseLock(); }
}

export function createDocsApi({ githubToken, fetchImpl = fetch } = {}) {
  if (githubToken !== undefined && (typeof githubToken !== "string" || !githubToken || /[\r\n]/.test(githubToken))) refuseImport("Invalid job token");
  const immutable = new Map(); let anonymousRequests = 0, cacheBytes = 0;
  return async (repository, method, path, body, statuses = [200]) => {
    if (method === "RAW") return readRawDocs(fetchImpl, repository, path);
    if (!allowedRepositories.has(repository) || !["GET", "POST", "PATCH"].includes(method)
      || (method !== "GET" && repository !== "unset-sh/docs") || typeof path !== "string"
      || !/^\/[A-Za-z0-9_./?=&%:-]+$/.test(path) || path.startsWith("//") || /(?:^|\/)\.\.(?:\/|$)/.test(path)) refuseImport("Invalid documentation API request");
    const address = `https://api.github.com/repos/${repository}${path}`;
    const url = new URL(address);
    if (`${url.pathname}${url.search}` !== `/repos/${repository}${path}`) refuseImport("Invalid documentation API path");
    if (method === "POST" && !/^\/(?:git\/(?:blobs|trees|commits|refs)|pulls|actions\/workflows\/(?:ci|branch-policy)\.yml\/dispatches)$/.test(path)) refuseImport("Unsupported documentation mutation");
    if (method === "PATCH" && !/^\/(?:git\/refs\/heads\/automation\/docs-(?:tooling|github)|pulls\/[1-9][0-9]*)$/.test(path)) refuseImport("Unsupported documentation update");
    if (method !== "GET" && !githubToken) refuseImport("Documentation publication requires its job token");
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "Content-Type": "application/json" };
    if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
    const cacheable = method === "GET" && (/^\/git\/(?:commits|trees)\/[a-f0-9]{40}(?:\?recursive=1)?$/.test(path)
      || (repository !== "unset-sh/docs" && /^\/actions\/runs\/[1-9][0-9]*$/.test(path)));
    const cacheKey = `${repository}${path}`;
    if (cacheable && immutable.has(cacheKey)) return structuredClone(immutable.get(cacheKey));
    if (!headers.Authorization && ++anonymousRequests > 48) refuseImport("Anonymous documentation request budget exceeded");
    let response;
    try {
      response = await fetchImpl(address, { method, redirect: "error", signal: AbortSignal.timeout(30_000), headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { refuseImport("Documentation GitHub request failed"); }
    if (!statuses.includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      refuseImport(`Documentation GitHub request refused (HTTP ${Number.isInteger(response.status) ? response.status : "unknown"})`);
    }
    if (response.status === 404 || response.status === 204) { await response.body?.cancel().catch(() => {}); return null; }
    const result = await boundedJson(response);
    if (cacheable && immutable.size < 32) {
      const size = Buffer.byteLength(JSON.stringify(result));
      if (cacheBytes + size <= 16 * 1024 * 1024) { immutable.set(cacheKey, structuredClone(result)); cacheBytes += size; }
    }
    return result;
  };
}

export async function readImportRef(api, repository, name) {
  const result = await api(repository, "GET", `/git/ref/heads/${name}`);
  if (result?.ref !== `refs/heads/${name}` || result.object?.type !== "commit" || !isCommit(result.object.sha)) refuseImport("Invalid documentation branch identity");
  return result.object.sha;
}

function validExportRun(run, source, revision) {
  return Number.isSafeInteger(run?.id) && run.id > 0 && run.event === "push" && run.head_branch === "main"
    && run.head_sha === revision && run.status === "completed" && run.conclusion === "success"
    && run.path === source.workflow && run.repository?.full_name === source.repository && run.head_repository?.full_name === source.repository;
}

export async function resolveImportSource({ source: key, api }) {
  const source = importSource(key);
  const revision = await readImportRef(api, source.repository, "main");
  const path = `/actions/workflows/${source.workflow.split("/").at(-1)}/runs?branch=main&event=push&head_sha=${revision}&status=success&per_page=100`;
  const response = await api(source.repository, "GET", path);
  if (!Number.isSafeInteger(response?.total_count) || response.total_count < 1 || !Array.isArray(response.workflow_runs)
    || response.workflow_runs.length > 100) refuseImport("No successful export for the current source revision");
  const eligible = response.workflow_runs.filter(run => validExportRun(run, source, revision)).sort((a, b) => b.id - a.id);
  if (!eligible.length) refuseImport("No successful export for the current source revision");
  return { key, revision, runId: eligible[0].id };
}

export async function verifyImportSource({ snapshot, api, current = true }) {
  validateDocsImport(snapshot);
  const source = importSource(snapshot.source.key);
  const revision = snapshot.source.revision;
  if (current && await readImportRef(api, source.repository, "main") !== revision) refuseImport("Documentation source main moved; prepare a fresh import");
  const run = await api(source.repository, "GET", `/actions/runs/${snapshot.source.runId}`);
  if (!validExportRun(run, source, revision) || run.id !== snapshot.source.runId) refuseImport("Documentation export proof does not match its source");
  return verifyImportTree({ snapshot, api });
}

export async function verifyImportTree({ snapshot, api }) {
  validateDocsImport(snapshot);
  const source = importSource(snapshot.source.key), revision = snapshot.source.revision;
  const commit = await api(source.repository, "GET", `/git/commits/${revision}`);
  if (commit?.sha !== revision || !isCommit(commit.tree?.sha)) refuseImport("Invalid documentation source commit");
  const tree = await api(source.repository, "GET", `/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree?.sha !== commit.tree.sha || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 10000) refuseImport("Incomplete or oversized documentation source tree");
  const selected = tree.tree.filter(entry => entry.path === "LICENSE" || entry.path === source.directory || entry.path?.startsWith(`${source.directory}/`));
  const files = new Map(); const seen = new Set();
  let rootLicence;
  for (const entry of selected) {
    if (typeof entry.path !== "string" || seen.has(entry.path) || !isCommit(entry.sha)) refuseImport("Invalid or duplicate documentation source entry");
    seen.add(entry.path);
    if (entry.type === "tree" && entry.mode === "040000") continue;
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode) || !Number.isSafeInteger(entry.size)
      || entry.size < 0 || entry.size > importLimits.fileBytes) refuseImport("Documentation source must contain bounded regular files");
    if (entry.path === "LICENSE") rootLicence = entry;
    else if (entry.path.startsWith(`${source.directory}/`)) files.set(entry.path.slice(source.directory.length + 1), entry);
    else refuseImport("Documentation source directory is not a tree");
  }
  if (!rootLicence || !seen.has(source.directory) || (files.has("LICENSE") && files.get("LICENSE").sha !== rootLicence.sha)) refuseImport("Documentation source licence or directory is missing or inconsistent");
  files.set("LICENSE", rootLicence);
  const payload = decodeImportFiles(snapshot); payload.delete("source.json");
  if (files.size !== payload.size) refuseImport("Import does not contain the complete committed documentation section");
  for (const [path, bytes] of payload) {
    const original = files.get(path);
    if (!original || original.size !== bytes.length || original.sha !== gitBlobHash(bytes)) refuseImport("Import bytes do not match the immutable documentation source");
  }
  return source;
}
