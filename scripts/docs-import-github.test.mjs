import assert from "node:assert/strict";
import { test } from "node:test";
import { importFixture, sourceCommit, sourceTree } from "../checks/docs-import-fixture.mjs";
import { createDocsApi, resolveImportSource, verifyImportSource } from "./docs-import-github.mjs";

function remote(fixture, changes = {}) {
  return async (repository, method, path) => {
    assert.equal(repository, "unset-sh/tooling"); assert.equal(method, "GET");
    if (path === "/git/ref/heads/main") return { ref: "refs/heads/main", object: { type: "commit", sha: changes.head ?? sourceCommit } };
    if (path.startsWith("/actions/workflows/automation-docs-self.yml/runs?")) {
      assert.match(path, new RegExp(`head_sha=${sourceCommit}`));
      assert.match(path, /branch=main/); assert.match(path, /event=push/); assert.match(path, /status=success/);
      return { total_count: 1, workflow_runs: [fixture.run] };
    }
    if (path === "/actions/runs/123") return fixture.run;
    if (path === `/git/commits/${sourceCommit}`) return { sha: sourceCommit, tree: { sha: sourceTree } };
    if (path === `/git/trees/${sourceTree}?recursive=1`) return fixture.tree;
    throw new Error(`Unexpected fixture request ${path}`);
  };
}

test("source selection requires a successful same-repository main push for the exact resolved commit", async () => {
  const result = await resolveImportSource({ source: "tooling", api: remote(importFixture()) });
  assert.deepEqual(result, { key: "tooling", revision: sourceCommit, runId: 123 });
  for (const change of [
    run => { run.head_sha = "f".repeat(40); },
    run => { run.head_branch = "staging"; },
    run => { run.event = "pull_request"; },
    run => { run.conclusion = "failure"; },
    run => { run.status = "in_progress"; },
    run => { run.head_repository.full_name = "outside/tooling"; },
    run => { run.repository.full_name = "unset-sh/docs"; },
    run => { run.path = ".github/workflows/ci-self.yml"; },
    run => { run.id = -1; },
  ]) {
    const fixture = importFixture(); change(fixture.run);
    await assert.rejects(resolveImportSource({ source: "tooling", api: remote(fixture) }));
  }
});

test("payload verification compares complete file sets and actual bytes to immutable Git blobs", async () => {
  const fixture = importFixture();
  await assert.doesNotReject(verifyImportSource({ snapshot: fixture.snapshot, api: remote(fixture) }));
  for (const change of [
    value => { value.tree.truncated = true; },
    value => { value.tree.sha = "f".repeat(40); },
    value => { value.tree.tree[0].sha = "f".repeat(40); },
    value => { value.tree.tree[0].mode = "120000"; },
    value => { value.tree.tree[2].mode = "120000"; },
    value => { value.tree.tree[2].type = "commit"; },
    value => { value.tree.tree.push({ ...value.tree.tree[2], path: "docs/new.md" }); },
    value => { value.tree.tree.push({ ...value.tree.tree[2], path: "docs/LICENSE" }); },
    value => { value.tree.tree.splice(2, 1); },
    value => { value.tree.tree.push(value.tree.tree[0]); },
  ]) {
    const copy = importFixture(); change(copy);
    await assert.rejects(verifyImportSource({ snapshot: copy.snapshot, api: remote(copy) }));
  }
  await assert.rejects(verifyImportSource({ snapshot: fixture.snapshot, api: remote(fixture, { head: "f".repeat(40) }) }), /moved/i);
});

test("the API sends its token only to docs and cannot write another repository or follow redirects", async () => {
  const requests = [];
  const api = createDocsApi({ githubToken: "test-token", fetchImpl: async (url, options) => {
    requests.push({ url, options }); return Response.json({ ok: true });
  } });
  await api("unset-sh/tooling", "GET", "/git/ref/heads/main");
  await api("unset-sh/docs", "GET", "/git/ref/heads/staging");
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.equal(requests[1].options.headers.Authorization, "Bearer test-token");
  assert.equal(requests[0].options.redirect, "error");
  for (const args of [
    ["outside/repo", "GET", "/git/ref/heads/main"],
    ["unset-sh/tooling", "POST", "/git/refs", {}],
    ["unset-sh/docs", "GET", "//outside.invalid"],
    ["unset-sh/docs", "GET", "/../tooling/git/refs"],
  ]) await assert.rejects(api(...args));
  assert.equal(requests.length, 2);
});

test("API failures are bounded and redact remote bodies and thrown transport causes", async () => {
  for (const fetchImpl of [
    async () => new Response("sensitive remote diagnostic", { status: 403 }),
    async () => new Response("not JSON sensitive remote diagnostic"),
    async () => { throw new Error("sensitive remote diagnostic"); },
    async () => new Response('"' + "x".repeat(12 * 1024 * 1024) + '"'),
    async () => new Response(null, { status: 302 }),
  ]) {
    const api = createDocsApi({ githubToken: "test-token", fetchImpl });
    await assert.rejects(api("unset-sh/docs", "GET", "/git/ref/heads/staging"), error => !error.message.includes("sensitive"));
  }
});


test("raw documentation reads use only exact docs commits without credentials or redirects", async () => {
  const requests = [], bytes = Buffer.from("Immutable document");
  const api = createDocsApi({ githubToken: "private-job-token", fetchImpl: async (url, options) => {
    requests.push({ url, options }); return new Response(bytes);
  } });
  assert.deepEqual(await api("unset-sh/docs", "RAW", `/raw/${"a".repeat(40)}/tooling/guides/start.md`), bytes);
  assert.equal(requests[0].url, `https://raw.githubusercontent.com/unset-sh/docs/${"a".repeat(40)}/tooling/guides/start.md`);
  assert.equal(requests[0].options.redirect, "error");
  assert.equal(requests[0].options.headers, undefined);
  for (const [repo, path] of [["outside/docs", `/raw/${"a".repeat(40)}/tooling/index.md`],
    ["unset-sh/docs", "/raw/main/tooling/index.md"], ["unset-sh/docs", `/raw/${"a".repeat(40)}/other/index.md`],
    ["unset-sh/docs", `/raw/${"a".repeat(40)}/tooling/../secret`], ["unset-sh/docs", `/raw/${"a".repeat(40)}/tooling/%2e%2e/secret`]]) {
    await assert.rejects(api(repo, "RAW", path));
  }
  assert.equal(requests.length, 1);
  const huge = createDocsApi({ fetchImpl: async () => new Response(Buffer.alloc(1024 * 1024 + 1)) });
  await assert.rejects(huge("unset-sh/docs", "RAW", `/raw/${"a".repeat(40)}/github/index.md`), /bounded/);
});
