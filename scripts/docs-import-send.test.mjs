import assert from "node:assert/strict";
import { test } from "node:test";
import { blob, importFixture, baseCommit, sourceCommit, sourceTree } from "../checks/docs-import-fixture.mjs";
import { dispatchDocsImportChecks } from "./docs-import-send.mjs";

const head = "c".repeat(40), baseTree = "e".repeat(40), headTree = "f".repeat(40), sectionTree = "9".repeat(40);
const branch = "automation/docs-tooling", repository = "unset-sh/docs";
const target = { number: "12", expectedHead: head, expectedBase: baseCommit, branch };
function fixture({ workflowChange = value => value, dispatchChange = value => value, runChange = value => value, moveAfterPost = false } = {}) {
  const source = importFixture(); const requests = []; let posted = 0;
  const readme = { path: "README.md", mode: "100644", type: "blob", sha: "8".repeat(40) };
  const pr = () => ({ number: 12, state: "open", draft: false, changed_files: 3,
    user: { login: "github-actions[bot]", id: 41898282, type: "Bot" },
    head: { sha: moveAfterPost && posted ? "7".repeat(40) : head, ref: branch, repo: { full_name: repository } },
    base: { sha: baseCommit, ref: "main", repo: { full_name: repository } } });
  const runs = new Map();
  const api = async (repo, method, path, body, statuses) => {
    requests.push({ repo, method, path, body, statuses });
    if (repo === "unset-sh/tooling") {
      assert.equal(method, "GET");
      if (path === "/actions/runs/123") return source.run;
      if (path === `/git/commits/${sourceCommit}`) return { sha: sourceCommit, tree: { sha: sourceTree } };
      if (path === `/git/trees/${sourceTree}?recursive=1`) return source.tree;
    }
    assert.equal(repo, repository);
    if (method === "RAW" && path.startsWith(`/raw/${head}/tooling/`)) {
      const file = source.files.find(file => file.path === path.slice(`/raw/${head}/tooling/`.length));
      assert.ok(file); return file.bytes;
    }
    if (path === "/pulls/12") return pr();
    if (path === "/pulls/12/files?per_page=100&page=1") return source.files.map(file => ({ filename: `tooling/${file.path}` }));
    if (path === `/git/commits/${baseCommit}`) return { sha: baseCommit, tree: { sha: baseTree } };
    if (path === `/git/commits/${head}`) return { sha: head, tree: { sha: headTree }, parents: [{ sha: baseCommit }],
      message: `Import tooling documentation\n\nSource revision: ${sourceCommit}\nExport run: 123\nDocs base: ${baseCommit}\n\nSigned-off-by: github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>` };
    if (path === `/git/trees/${baseTree}`) return { sha: baseTree, truncated: false, tree: [readme] };
    if (path === `/git/trees/${headTree}`) return { sha: headTree, truncated: false, tree: [readme, { path: "tooling", mode: "040000", type: "tree", sha: sectionTree }] };
    if (path === `/git/trees/${sectionTree}?recursive=1`) return { sha: sectionTree, truncated: false, tree: source.files.map(file => ({
      path: file.path, mode: "100644", type: "blob", sha: blob(file.bytes), size: file.bytes.length })) };
    if (path.startsWith("/git/blobs/")) {
      const file = source.files.find(file => blob(file.bytes) === path.split("/").at(-1)); assert.ok(file);
      return { sha: blob(file.bytes), size: file.bytes.length, encoding: "base64", content: file.bytes.toString("base64") };
    }
    if (path === "/git/ref/heads/main") return { ref: "refs/heads/main", object: { type: "commit", sha: baseCommit } };
    if (path === `/git/ref/heads/${branch}`) return { ref: `refs/heads/${branch}`, object: { type: "commit", sha: head } };
    const match = /^\/actions\/workflows\/(ci|branch-policy)\.yml(\/dispatches)?$/.exec(path);
    if (match) {
      const workflow = `${match[1]}.yml`, workflowId = match[1] === "ci" ? 101 : 102;
      if (method === "GET") return workflowChange({ id: workflowId, path: `.github/workflows/${workflow}`, state: "active" });
      assert.equal(method, "POST"); assert.deepEqual(statuses, [200]);
      posted++; const id = 1000 + posted;
      const url = `https://api.github.com/repos/${repository}/actions/runs/${id}`;
      const html = `https://github.com/${repository}/actions/runs/${id}`;
      runs.set(`/actions/runs/${id}`, runChange({ id, url, html_url: html, workflow_id: workflowId,
        path: `.github/workflows/${workflow}`, event: "workflow_dispatch", head_branch: branch, head_sha: head,
        repository: { full_name: repository }, head_repository: { full_name: repository }, status: "queued", conclusion: null }));
      return dispatchChange({ workflow_run_id: id, run_url: url, html_url: html });
    }
    if (method === "GET" && runs.has(path)) return runs.get(path);
    throw new Error(`Unexpected fixture API request ${method} ${path}`);
  };
  return { api, requests };
}

test("the sender dispatches only the two approved workflows and returns verified requested run identities", async () => {
  const f = fixture(); const result = await dispatchDocsImportChecks({ ...target, api: f.api });
  assert.deepEqual(result, [
    { workflow: "ci.yml", id: 1001, url: "https://github.com/unset-sh/docs/actions/runs/1001" },
    { workflow: "branch-policy.yml", id: 1002, url: "https://github.com/unset-sh/docs/actions/runs/1002" },
  ]);
  const writes = f.requests.filter(call => ["POST", "PATCH"].includes(call.method));
  assert.deepEqual(writes.map(call => call.path), ["/actions/workflows/ci.yml/dispatches", "/actions/workflows/branch-policy.yml/dispatches"]);
  for (const request of writes) assert.deepEqual(request.body, { ref: branch, inputs: {
    "pull-request": "12", "expected-head": head, "expected-base": baseCommit } });
  assert.ok(f.requests.filter(call => call.path === "/pulls/12").length >= 6, "Real target identity is revalidated around dispatches");
  assert.ok(result.every(run => !Object.hasOwn(run, "conclusion") && !Object.hasOwn(run, "success")));
});

test("invalid targets or inactive, renamed and malformed workflows cause no dispatch", async () => {
  for (const change of [{ branch: "main" }, { number: "12\n" }, { expectedHead: baseCommit }, { expectedBase: "staging" }]) {
    const f = fixture(); await assert.rejects(dispatchDocsImportChecks({ ...target, ...change, api: f.api }));
    assert.equal(f.requests.some(call => ["POST", "PATCH"].includes(call.method)), false);
  }
  for (const workflowChange of [v => ({ ...v, state: "disabled_manually" }), v => ({ ...v, id: 0 }),
    v => ({ ...v, path: ".github/workflows/release.yml" }), v => v.id === 102 ? { ...v, state: "disabled_inactivity" } : v]) {
    const f = fixture({ workflowChange }); await assert.rejects(dispatchDocsImportChecks({ ...target, api: f.api }));
    assert.equal(f.requests.some(call => ["POST", "PATCH"].includes(call.method)), false);
  }
});

test("unconfirmed responses and unrelated returned runs cannot be accepted as the requested checks", async () => {
  for (const dispatchChange of [() => null, v => ({ ...v, workflow_run_id: "1001" }), v => ({ ...v, run_url: "https://outside.invalid" }),
    v => ({ ...v, html_url: "https://github.com/other/docs/actions/runs/1001" })]) {
    const f = fixture({ dispatchChange }); await assert.rejects(dispatchDocsImportChecks({ ...target, api: f.api }));
    assert.equal(f.requests.filter(call => call.method === "POST").length, 1);
  }
  for (const runChange of [v => ({ ...v, id: 2000 }), v => ({ ...v, workflow_id: 999 }), v => ({ ...v, event: "push" }),
    v => ({ ...v, head_sha: baseCommit }), v => ({ ...v, head_branch: "main" }), v => ({ ...v, path: ".github/workflows/release.yml" }),
    v => ({ ...v, repository: { full_name: "outside/docs" } }), v => ({ ...v, head_repository: { full_name: "outside/docs" } }),
    v => ({ ...v, url: "https://outside.invalid" }), v => ({ ...v, html_url: "https://outside.invalid" })]) {
    const f = fixture({ runChange }); await assert.rejects(dispatchDocsImportChecks({ ...target, api: f.api }));
    assert.equal(f.requests.filter(call => call.method === "POST").length, 1);
  }
});

test("movement after one request stops the second dispatch without claiming either check passed", async () => {
  const f = fixture({ moveAfterPost: true });
  await assert.rejects(dispatchDocsImportChecks({ ...target, api: f.api }), /identity|changed/i);
  assert.equal(f.requests.filter(call => call.method === "POST").length, 1);
});
