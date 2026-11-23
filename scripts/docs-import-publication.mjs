// Only Git objects and pull requests in docs are written. No source checkout,
// package command, force update, merge or repository setting is used here.
// https://docs.github.com/en/rest/git/trees#create-a-tree
// https://docs.github.com/en/rest/git/refs#update-a-reference
import { decodeImportFiles, gitBlobHash, importLimits, importSource, isCommit, refuseImport, sha256, validateDocsImport, validateImportPaths, DocsImportError } from "./docs-import-data.mjs";
import { readImportRef, verifyImportSource, verifyImportTree } from "./docs-import-github.mjs";

const repository = "unset-sh/docs";
const signoff = "Signed-off-by: github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>";
const branchFor = key => `automation/docs-${key}`;
const titleFor = key => `Import ${key} documentation`;
const messageFor = snapshot => `${titleFor(snapshot.source.key)}\n\nSource revision: ${snapshot.source.revision}\nExport run: ${snapshot.source.runId}\nDocs base: ${snapshot.target.baseCommit}\n\n${signoff}`;
const canonicalTree = entries => JSON.stringify(entries.map(({ path, mode, type, sha }) => ({ path, mode, type, sha })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

async function commitAt(api, sha) {
  const commit = await api(repository, "GET", `/git/commits/${sha}`);
  if (commit?.sha !== sha || !isCommit(commit.tree?.sha)) refuseImport("Invalid docs commit");
  return commit;
}

async function treeAt(api, sha, recursive = false) {
  const tree = await api(repository, "GET", `/git/trees/${sha}${recursive ? "?recursive=1" : ""}`);
  if (tree?.sha !== sha || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 10000) refuseImport("Invalid or incomplete docs tree");
  const seen = new Set();
  for (const entry of tree.tree) {
    if (typeof entry.path !== "string" || !entry.path || seen.has(entry.path) || !isCommit(entry.sha)
      || (!recursive && entry.path.includes("/"))) refuseImport("Invalid docs tree entry");
    seen.add(entry.path);
  }
  return tree.tree;
}

async function rootAt(api, sha) {
  const commit = await commitAt(api, sha);
  return { commit, entries: await treeAt(api, commit.tree.sha) };
}

function sectionEntry(root, section) {
  const entry = root.find(entry => entry.path === section);
  if (entry && (entry.type !== "tree" || entry.mode !== "040000")) refuseImport("Documentation section collides with a non-directory");
  return entry;
}

async function sectionFiles(api, entry) {
  if (!entry) return [];
  return (await treeAt(api, entry.sha, true)).filter(item => item.type !== "tree");
}

function sameFiles(entries, snapshot, provenance = true) {
  if (!entries.some(entry => entry.path === "source.json" && entry.type === "blob" && entry.mode === "100644")) return false;
  const expected = snapshot.files.filter(file => provenance || file.path !== "source.json").map(file => ({ path: file.path, type: "blob", mode: "100644", sha: gitBlobHash(Buffer.from(file.content, "base64")) }));
  return canonicalTree(entries.filter(file => provenance || file.path !== "source.json")) === canonicalTree(expected);
}

async function readExistingFile(api, commit, section, entry) {
  if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > importLimits.fileBytes) refuseImport("Existing documentation blob exceeds its limit");
  const bytes = await api(repository, "RAW", `/raw/${commit}/${section}/${entry.path}`);
  if (!Buffer.isBuffer(bytes) || bytes.length !== entry.size || gitBlobHash(bytes) !== entry.sha) refuseImport("Existing documentation blob does not match its immutable hash");
  return bytes;
}

async function validRetainedProvenance(api, base, entries, snapshot, section) {
  const entry = entries.find(entry => entry.path === "source.json");
  const bytes = await readExistingFile(api, base, section, entry);
  let retained;
  try {
    const provenance = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    retained = validateDocsImport({ ...snapshot, source: { ...snapshot.source, revision: provenance.revision },
      files: snapshot.files.map(file => file.path === "source.json" ? { path: file.path, content: bytes.toString("base64"), sha256: sha256(bytes) } : file) });
  } catch (error) {
    if (error instanceof DocsImportError || error instanceof SyntaxError || error instanceof TypeError) return false;
    throw error;
  }
  await verifyImportTree({ snapshot: retained, api });
  return true;
}

async function previousSnapshot(api, commit, sourceKey, baseRoot, currentBase) {
  const match = /^Import (tooling|github) documentation\n\nSource revision: ([a-f0-9]{40})\nExport run: ([1-9][0-9]*)\nDocs base: ([a-f0-9]{40})\n\nSigned-off-by: github-actions\[bot\] <41898282\+github-actions\[bot\]@users\.noreply\.github\.com>$/.exec(commit.message);
  if (!match || match[1] !== sourceKey || !Array.isArray(commit.parents) || ![1, 2].includes(commit.parents.length)
    || commit.parents.some(parent => !isCommit(parent.sha))) refuseImport("Existing import branch is not an owned generated commit");
  const [, key, revision, run, previousBase] = match;
  if (commit.parents.length === 2 && (commit.parents[1].sha !== previousBase || commit.parents[0].sha === previousBase)) refuseImport("Import reconciliation must record staging as its second parent");
  const source = importSource(key);
  if (previousBase !== currentBase) {
    const comparison = await api(repository, "GET", `/compare/${previousBase}...${currentBase}`);
    if (!['ahead', 'identical'].includes(comparison?.status) || comparison.base_commit?.sha !== previousBase
      || comparison.merge_base_commit?.sha !== previousBase) refuseImport("Previous import base is not in staging history");
  }
  const original = previousBase === currentBase ? baseRoot : (await rootAt(api, previousBase)).entries;
  const root = await treeAt(api, commit.tree.sha);
  if (canonicalTree(root.filter(entry => entry.path !== source.section)) !== canonicalTree(original.filter(entry => entry.path !== source.section))) refuseImport("Existing import branch changes files outside its section");
  const section = sectionEntry(root, source.section);
  if (!section) refuseImport("Existing import branch has no owned section");
  const entries = await sectionFiles(api, section);
  if (entries.length > importLimits.files) refuseImport("Existing import section exceeds its file limit");
  const files = [];
  validateImportPaths([...entries].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  let total = 0;
  // Preflight the complete declared size before fetching any previous file.
  for (const entry of entries) {
    if (entry.type !== "blob" || entry.mode !== "100644" || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > importLimits.fileBytes) refuseImport("Existing import contains an unsafe file");
    total += entry.size;
    if (total > importLimits.totalBytes) refuseImport("Existing import exceeds its total byte limit");
  }
  for (const entry of entries) {
    const bytes = await readExistingFile(api, commit.sha, source.section, entry);
    files.push({ path: entry.path, content: bytes.toString("base64"), sha256: sha256(bytes) });
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const snapshot = validateDocsImport({ schemaVersion: 1, source: { key, revision, runId: Number(run) },
    target: { repository, base: "staging", baseCommit: previousBase, workflowCommit: previousBase }, files });
  await verifyImportSource({ snapshot, api, current: false });
  return { root, entries, base: previousBase };
}

export function validateImportPr(pr, branch, head, base) {
  if (!Number.isSafeInteger(pr?.number) || pr.number <= 0 || pr.state !== "open" || pr.head?.sha !== head || pr.head.ref !== branch
    || pr.head.repo?.full_name !== repository || pr.base?.ref !== "staging" || pr.base.sha !== base || pr.base.repo?.full_name !== repository
    || pr.user?.login !== "github-actions[bot]" || pr.user.id !== 41898282 || pr.user.type !== "Bot") refuseImport("Import pull request identity or ownership changed");
  return pr;
}

export async function verifyDocsImportHead({ api, key, head, base }) {
  const source = importSource(key);
  const { entries: root } = await rootAt(api, base);
  const commit = await commitAt(api, head);
  if (!commit.message?.includes(`\nDocs base: ${base}\n`)) refuseImport("Import commit does not record the current staging base");
  const previous = await previousSnapshot(api, commit, key, root, base);
  if (canonicalTree(previous.root.filter(entry => entry.path !== source.section)) !== canonicalTree(root.filter(entry => entry.path !== source.section))) refuseImport("Import head changes files outside its owned section");
  return source;
}

export async function publishDocsImport({ snapshot, api }) {
  snapshot = structuredClone(validateDocsImport(snapshot));
  const source = await verifyImportSource({ snapshot, api });
  const base = snapshot.target.baseCommit;
  const checkBase = async () => {
    if (await readImportRef(api, repository, "staging") !== base) refuseImport("Docs staging moved; prepare a fresh import");
  };
  await checkBase();
  const { commit: baseObject, entries: baseRoot } = await rootAt(api, base);
  const currentFiles = await sectionFiles(api, sectionEntry(baseRoot, source.section));
  if (sameFiles(currentFiles, snapshot, false) && await validRetainedProvenance(api, base, currentFiles, snapshot, source.section)) return { status: "unchanged" };
  const branch = branchFor(snapshot.source.key);
  const existing = await api(repository, "GET", `/git/ref/heads/${branch}`, undefined, [200, 404]);
  let previous;
  if (existing) {
    if (existing.ref !== `refs/heads/${branch}` || existing.object?.type !== "commit" || !isCommit(existing.object.sha)) refuseImport("Invalid existing import branch");
    previous = await previousSnapshot(api, await commitAt(api, existing.object.sha), snapshot.source.key, baseRoot, base);
  }
  const prs = await api(repository, "GET", `/pulls?state=all&head=unset-sh%3Aautomation%2Fdocs-${snapshot.source.key}&sort=created&direction=desc&per_page=100`);
  if (!Array.isArray(prs) || prs.length >= 100 || prs.filter(pr => pr.state === "open").length > 1) refuseImport("Ambiguous import pull request history");
  let pr = prs.find(pr => pr.state === "open");
  if (pr) validateImportPr(pr, branch, existing?.object.sha, base);
  else if (prs.some(item => item.state !== "closed" || !item.merged_at || item.user?.login !== "github-actions[bot]")) refuseImport("A previous import was closed without merging; review it before retrying");
  let head = existing?.object.sha;
  let changed = !(previous && canonicalTree(previous.root.filter(entry => entry.path !== source.section)) === canonicalTree(baseRoot.filter(entry => entry.path !== source.section)) && sameFiles(previous.entries, snapshot));
  if (changed) {
    const files = [];
    for (const [path, bytes] of decodeImportFiles(snapshot)) {
      const blob = await api(repository, "POST", "/git/blobs", { content: bytes.toString("base64"), encoding: "base64" }, [201]);
      if (blob?.sha !== gitBlobHash(bytes)) refuseImport("GitHub returned an unexpected documentation blob");
      files.push({ path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const section = await api(repository, "POST", "/git/trees", { tree: files }, [201]);
    if (!isCommit(section?.sha)) refuseImport("GitHub returned an invalid documentation section");
    const tree = await api(repository, "POST", "/git/trees", { base_tree: baseObject.tree.sha, tree: [{ path: source.section, mode: "040000", type: "tree", sha: section.sha }] }, [201]);
    if (!isCommit(tree?.sha)) refuseImport("GitHub returned an invalid documentation root");
    const message = messageFor(snapshot);
    const parents = head ? (previous.base === base ? [head] : [head, base]) : [base];
    const commit = await api(repository, "POST", "/git/commits", { message, tree: tree.sha, parents }, [201]);
    if (!isCommit(commit?.sha) || commit.tree?.sha !== tree.sha || JSON.stringify(commit.parents?.map(parent => parent.sha)) !== JSON.stringify(parents) || commit.message !== message) refuseImport("GitHub returned an unexpected documentation commit");
    await checkBase();
    if (await readImportRef(api, source.repository, "main") !== snapshot.source.revision) refuseImport("Documentation source main moved before publication");
    const current = await api(repository, "GET", `/git/ref/heads/${branch}`, undefined, [200, 404]);
    if ((current?.object?.sha ?? null) !== (head ?? null)) refuseImport("Import branch moved before publication");
    const result = head
      ? await api(repository, "PATCH", `/git/refs/heads/${branch}`, { sha: commit.sha, force: false })
      : await api(repository, "POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: commit.sha }, [201]);
    if (result?.ref !== `refs/heads/${branch}` || result.object?.type !== "commit" || result.object.sha !== commit.sha) refuseImport("GitHub returned an unexpected import ref");
    head = commit.sha;
  }
  await checkBase();
  const body = `Import ${source.repository} documentation at ${snapshot.source.revision} into ${source.section}/, retaining its licence and complete file hashes.

## Readiness

Ready after the required documentation and branch-policy checks pass. This PR targets staging; production promotion remains separate.

## Prerequisites and order

The source revision already has a successful export run. Merge this import after its required checks; no other PR is required.

## Tested combination

Source: ${snapshot.source.revision}. Docs staging: ${base}. The receiver validated the exact source Git objects, complete section and provenance before opening this PR.

## Validation

Source export: https://github.com/${source.repository}/actions/runs/${snapshot.source.runId}. Documentation CI and branch policy are dispatched separately against this exact PR head. Their results remain required before merge.

## Documentation

Only ${source.section}/ changes. Authored source documentation stays in its source repository; source.json records the imported revision and hashes.`;
  const existed = Boolean(pr);
  if (!pr) pr = await api(repository, "POST", "/pulls", { title: titleFor(snapshot.source.key), head: branch, base: "staging", body }, [201]);
  else if (changed) pr = await api(repository, "PATCH", `/pulls/${pr.number}`, { title: titleFor(snapshot.source.key), body });
  validateImportPr(pr, branch, head, base);
  return { status: changed ? (existed ? "updated" : "opened") : "pending", number: pr.number, branch, head, url: `https://github.com/${repository}/pull/${pr.number}` };
}
