import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchGeneratedMapChecks } from "./generated-map-checks.mjs";
import { repository, base, head, branch, server } from "../checks/map-dispatch-fixture.mjs";

const context = { repository, ref: "refs/heads/staging", sha: base, event: "push" };
function transport() {
  const s = server(); const calls = [], runs = new Map();
  const fetchImpl = async (url, init) => {
    assert.ok(url.startsWith(`https://api.github.com/repos/${repository}/`));
    assert.equal(init.redirect, "error"); assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.headers.Authorization, "Bearer TOKEN-SECRET");
    const path = url.slice(`https://api.github.com/repos/${repository}`.length);
    const body = init.body && JSON.parse(init.body); calls.push({ method: init.method, path, body });
    if (init.method === "POST") {
      const match = /^\/actions\/workflows\/(org-map|docs-export|branch-policy)\.yml\/dispatches$/.exec(path);
      assert.ok(match); assert.deepEqual(body, { ref: branch, inputs: { "pull-request": "17", "expected-head": head, "expected-base": base } });
      const id = 123 + runs.size;
      runs.set(`/actions/runs/${id}`, { id, event: "workflow_dispatch", head_branch: branch, head_sha: head,
        path: `.github/workflows/${match[1]}.yml`, repository: { full_name: repository }, head_repository: { full_name: repository } });
      return Response.json({ workflow_run_id: id, run_url: `https://api.github.com/repos/${repository}/actions/runs/${id}`,
        html_url: `https://github.com/${repository}/actions/runs/${id}` });
    }
    return Response.json(runs.get(path) ?? await s.api(repository, "GET", path));
  };
  return { ...s, calls, runs, fetchImpl };
}
const dispatch = (s, extra = {}) => dispatchGeneratedMapChecks({ context, number: "17", expectedHead: head, expectedBase: base,
  githubToken: "TOKEN-SECRET", fetchImpl: s.fetchImpl, ...extra });

test("a separate dispatcher proves the generated PR and requests only the three existing required workflows", async () => {
  const s = transport(); const result = await dispatch(s);
  assert.deepEqual(result.runs.map(item => item.workflow), ["org-map.yml", "docs-export.yml", "branch-policy.yml"]);
  assert.equal(s.calls.filter(call => call.method !== "GET").length, 3);
  assert.equal(s.calls.some(call => /merge|labels/.test(call.path)), false);
});

test("wrong source context, forged PRs and moved branches cannot dispatch checks", async () => {
  for (const change of [{ repository: "unset-sh/docs" }, { ref: "refs/heads/main" }, { sha: head }, { event: "pull_request" }]) {
    const s = transport(); await assert.rejects(dispatch(s, { context: { ...context, ...change } })); assert.deepEqual(s.calls, []);
  }
  const s = transport(); s.objects.get("/pulls/17").user.login = "human";
  await assert.rejects(dispatch(s)); assert.equal(s.calls.some(call => call.method === "POST"), false);
});

test("dispatch HTTP failures and wrong returned run identities stop subsequent dispatches without leaking diagnostics", async () => {
  for (const kind of ["http", "identity", "head", "body"]) {
    const s = transport();
    const fetchImpl = async (url, init) => {
      const response = await s.fetchImpl(url, init);
      if (init.method === "POST") {
        if (kind === "http") return new Response("TOKEN-SECRET private response", { status: 403 });
        if (kind === "identity") return Response.json({ workflow_run_id: 123, html_url: "https://outside.invalid/secret" });
        if (kind === "body") return new Response("x".repeat(8 * 1024 * 1024 + 1));
      }
      if (kind === "head" && url.endsWith("/actions/runs/123")) return Response.json({ ...(await response.json()), head_sha: base });
      return response;
    };
    await assert.rejects(dispatch(s, { fetchImpl }), error => !/TOKEN-SECRET|private response/.test(error.message));
    assert.equal(s.calls.filter(call => call.method === "POST").length, 1);
  }
});
