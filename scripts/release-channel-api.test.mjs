import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { githubClient, sourceAt, inspectRelease } from "./release-channel-api.mjs";

const sha = (c) => c.repeat(40);
const context = (branch = "staging") => ({ repository: "unset-sh/example", sha: sha("b"), before: sha("a"), branch,
  channel: branch === "main" ? "stable" : "staging", environment: branch === "main" ? "release-stable" : "release-staging", runId: "123", runAttempt: "1" });
function fixture(branch = "staging", version = "1.2.0") {
  const ctx = context(branch); const prefix = `/repos/${ctx.repository}`; const data = new Map();
  const commit = { sha: ctx.sha, tree: { sha: sha("d") }, parents: [{ sha: ctx.before }, { sha: sha("c") }] };
  const tree = { sha: sha("d"), truncated: false, tree: [] };
  const put = (path, text) => {
    const bytes = Buffer.from(text); const hash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    tree.tree.push({ path, sha: hash, size: bytes.length, type: "blob", mode: "100644" });
    data.set(`${prefix}/git/blobs/${hash}`, { sha: hash, size: bytes.length, encoding: "base64", content: bytes.toString("base64") });
  };
  put("package.json", JSON.stringify({ name: "@unset-sh/example", version, publishConfig: { registry: "https://npm.pkg.github.com" } }));
  put("CHANGELOG.md", `## v${version}\n\nReviewed changes.\n`);
  data.set(`${prefix}/git/commits/${ctx.sha}`, commit); data.set(`${prefix}/git/trees/${sha("d")}`, tree);
  data.set(prefix, { full_name: ctx.repository, private: false });
  data.set(`${prefix}/rules/branches/${branch}?per_page=100&page=1`, [{ type: "pull_request", ruleset_id: 7 }]);
  data.set(`${prefix}/rulesets/7`, { id: 7, enforcement: "active", bypass_actors: [], target: "branch",
    conditions: { ref_name: { include: [`refs/heads/${branch}`], exclude: [] } }, rules: [
      { type: "deletion" }, { type: "non_fast_forward" },
      { type: "pull_request", parameters: { allowed_merge_methods: ["merge"] } },
      { type: "required_status_checks", parameters: { strict_required_status_checks_policy: true,
        required_status_checks: [{ context: "Check", integration_id: 15368 }] } }] });
  data.set(`${prefix}/environments/${ctx.environment}`, { name: ctx.environment, can_admins_bypass: false,
    protection_rules: [{ type: "branch_policy" }], deployment_branch_policy: { custom_branch_policies: true, protected_branches: false } });
  data.set(`${prefix}/environments/${ctx.environment}/deployment-branch-policies?per_page=100&page=1`, { total_count: 1, branch_policies: [{ name: branch, type: "branch" }] });
  data.set(`${prefix}/commits/${ctx.sha}/pulls?per_page=100&page=1`, [{ number: 8 }]);
  data.set(`${prefix}/pulls/8`, { number: 8, state: "closed", merged: true, merge_commit_sha: ctx.sha,
    head: { ref: "staging", sha: sha("c"), repo: { full_name: ctx.repository } }, base: { ref: "main", repo: { full_name: ctx.repository } } });
  const calls = [];
  const get = async (path, { missing = false } = {}) => {
    calls.push(path);
    if (data.has(path)) return structuredClone(data.get(path));
    if (missing) return null;
    throw new Error(`Missing fixture ${path}`);
  };
  return { ctx, prefix, data, calls, get, put, tree, commit };
}

test("bounded GitHub reader fixes origin and credentials, refuses redirects and bounds calls and streamed bytes", async () => {
  const seen = [];
  const get = githubClient({ token: "test-token", maxRequests: 2, maxBytes: 16, fetchImpl: async (url, options) => {
    seen.push({ url, options }); return new Response('{"ok":true}');
  } });
  assert.deepEqual(await get("/repos/unset-sh/example"), { ok: true });
  assert.equal(seen[0].url, "https://api.github.com/repos/unset-sh/example");
  assert.equal(seen[0].options.redirect, "error"); assert.equal(seen[0].options.method, "GET");
  await assert.rejects(() => get("https://bad.invalid"), /path/i);
  await assert.rejects(() => get("//bad.invalid"), /path/i);
  await get("/repos/unset-sh/example");
  await assert.rejects(() => get("/repos/unset-sh/example"), /request bound/i);
  for (const response of [new Response("x".repeat(17)), new Response("{}", { status: 302 }), new Response("{}", { status: 403 }), new Response("invalid")]) {
    await assert.rejects(() => githubClient({ token: "t", maxBytes: 16, fetchImpl: async () => response })("/repos/unset-sh/example"));
  }
  assert.equal(await githubClient({ token: "t", fetchImpl: async () => new Response("{}", { status: 404 }) })("/repos/unset-sh/example", { missing: true }), null);
});

test("source uses exact Git objects and rejects symlinks, digest mismatches, truncation and invalid JSON", async () => {
  const f = fixture(); const source = await sourceAt(f.get, f.ctx);
  assert.equal(source.manifest.version, "1.2.0"); assert.equal(source.lock, null);
  assert.ok(f.calls.every((path) => !path.includes("contents/") && !path.includes("heads/")));
  for (const alter of [
    (x) => { x.tree.truncated = true; },
    (x) => { x.tree.tree[0].mode = "120000"; },
    (x) => { x.tree.tree[0].size = 2 ** 20 + 1; },
    (x) => { x.tree.tree.push({ ...x.tree.tree[0] }); },
    (x) => { x.data.get(`${x.prefix}/git/blobs/${x.tree.tree[0].sha}`).content = Buffer.from("{}").toString("base64"); },
    (x) => { x.put("npm-shrinkwrap.json", "{}"); },
  ]) { const x = fixture(); alter(x); await assert.rejects(() => sourceAt(x.get, x.ctx)); }
});

test("inspection verifies immutable source, active rules, environment, unique tag and exact promotion detail", async () => {
  for (const branch of ["staging", "main"]) {
    const f = fixture(branch); const result = await inspectRelease(f.get, f.ctx, { npmPackage: true });
    assert.equal(result.version, branch === "main" ? "1.2.0" : "1.2.0-staging.123.1");
    assert.equal(result.distTag, branch === "main" ? "latest" : "staging");
    assert.equal(result.notes, "Reviewed changes.\n");
    if (branch === "main") { assert.equal(result.promotion, 8); assert.ok(f.calls.includes(`${f.prefix}/pulls/8`)); }
    assert.ok(!f.calls.some((path) => path.includes("heads/staging")), "The later staging tip is irrelevant");
  }
  const zero = fixture("main", "0.0.0"); assert.equal((await inspectRelease(zero.get, zero.ctx)).publish, false);
  assert.ok(zero.calls.every((path) => path.includes("/git/")), "0.0.0 performs no authority, tag, or promotion lookup");
  for (const alter of [
    (f) => f.data.set(`${f.prefix}/git/ref/tags/v1.2.0`, { ref: "refs/tags/v1.2.0" }),
    (f) => f.data.set(`${f.prefix}/releases/tags/v1.2.0`, { id: 1 }),
    (f) => f.data.set(`${f.prefix}/rules/branches/main?per_page=100&page=1`, []),
    (f) => f.data.set(`${f.prefix}/rules/branches/main?per_page=100&page=1`, Array(100).fill({ ruleset_id: 7 })),
    (f) => f.data.set(`${f.prefix}/commits/${f.ctx.sha}/pulls?per_page=100&page=1`, Array(100).fill({ number: 8 })),
    (f) => { f.data.get(`${f.prefix}/pulls/8`).head.sha = sha("e"); },
    (f) => { f.data.get(`${f.prefix}/rulesets/7`).enforcement = "disabled"; },
    (f) => { f.data.get(`${f.prefix}/environments/${f.ctx.environment}`).can_admins_bypass = true; },
  ]) { const f = fixture("main"); alter(f); await assert.rejects(() => inspectRelease(f.get, f.ctx)); }
});
