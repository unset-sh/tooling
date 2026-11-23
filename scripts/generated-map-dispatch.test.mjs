import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { validateGeneratedMapDispatch } from "./generated-map-publication.mjs";

const repository = "unset-sh/.github", base = "a".repeat(40), head = "b".repeat(40);
const baseTree = "c".repeat(40), headTree = "d".repeat(40), other = "e".repeat(40);
const branch = `automation/map-${base}`;
const marker = "<!-- org-map:start (generated from repos.json; edit that, then run npm run map) -->";
const oldReadme = `# Authored\n${marker}\nOld\n<!-- org-map:end -->\nFooter\n`;
const newReadme = oldReadme.replace("Old", "New");
const hash = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const entry = (path, sha, mode = "100644", type = "blob") => ({ path, sha, mode, type });
const context = { repository, event: "workflow_dispatch", ref: `refs/heads/${branch}`, sha: head };

function server() {
  const objects = new Map(); const calls = [];
  const blob = value => {
    const bytes = Buffer.from(value), sha = hash(bytes);
    objects.set(`/git/blobs/${sha}`, { sha, size: bytes.length, encoding: "base64", content: bytes.toString("base64") });
    return sha;
  };
  const oldMap = blob("Old map\n"), newMap = blob("New map\n"), oldProfile = blob(oldReadme), newProfile = blob(newReadme);
  objects.set("/pulls/17", { number: 17, state: "open", draft: false,
    user: { login: "github-actions[bot]", id: 41898282, type: "Bot" },
    head: { sha: head, ref: branch, repo: { full_name: repository } },
    base: { sha: base, ref: "staging", repo: { full_name: repository } } });
  objects.set("/git/ref/heads/staging", { ref: "refs/heads/staging", object: { type: "commit", sha: base } });
  objects.set(`/git/ref/heads/${branch}`, { ref: `refs/heads/${branch}`, object: { type: "commit", sha: head } });
  objects.set(`/git/commits/${base}`, { sha: base, tree: { sha: baseTree } });
  objects.set(`/git/commits/${head}`, { sha: head, tree: { sha: headTree }, parents: [{ sha: base }],
    message: "Refresh generated organisation map\n\nSigned-off-by: github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>" });
  for (const [tree, map, profile] of [[baseTree, oldMap, oldProfile], [headTree, newMap, newProfile]]) {
    objects.set(`/git/trees/${tree}?recursive=1`, { sha: tree, truncated: false, tree: [
      entry("MAP.md", map), entry("profile", other, "040000", "tree"), entry("profile/README.md", profile),
      entry("repos.json", other), entry("scripts/map.mjs", other),
    ] });
  }
  const api = async (repo, method, path) => {
    assert.equal(repo, repository); assert.equal(method, "GET"); calls.push(path);
    assert.ok(objects.has(path), `Unexpected ${path}`); return structuredClone(objects.get(path));
  };
  return { objects, calls, api, blob };
}
const validate = (s, extra = {}) => validateGeneratedMapDispatch({ context, number: "17", expectedHead: head, expectedBase: base, api: s.api, ...extra });

test("a generated map dispatch verifies actual PR identities and only reads the exact base/head trees", async () => {
  const s = server();
  assert.deepEqual(await validate(s), { number: 17, repository, head, base, branch });
  assert.ok(s.calls.includes(`/git/trees/${headTree}?recursive=1`));
  assert.ok(s.calls.filter(path => path === "/git/ref/heads/staging").length >= 2);
});

test("unsupported dispatch contexts and identities fail before API reads", async () => {
  for (const extra of [{ number: "17\n" }, { number: "0" }, { number: "9007199254740992" }, { expectedHead: "main" },
    { expectedBase: head }, ...[{ repository: "unset-sh/docs" }, { event: "pull_request" }, { ref: "refs/heads/staging" }, { sha: other }].map(change => ({ context: { ...context, ...change } }))]) {
    const s = server(); await assert.rejects(validate(s, extra)); assert.deepEqual(s.calls, []);
  }
});

test("foreign, edited, closed, draft and stale generated PRs are rejected", async () => {
  for (const change of [{ number: 18 }, { state: "closed" }, { draft: true }, { user: { login: "human", id: 123, type: "User" } },
    { head: { sha: other } }, { base: { ref: "main" } }]) {
    const s = server(); Object.assign(s.objects.get("/pulls/17"), change);
    await assert.rejects(validate(s), /PR|pull request|identity/i);
  }
  for (const path of ["/git/ref/heads/staging", `/git/ref/heads/${branch}`]) {
    const s = server(); s.objects.get(path).object.sha = other;
    await assert.rejects(validate(s), /moved|identity/i);
  }
});

test("unowned tree changes, unsafe generated paths and incomplete API trees are refused", async () => {
  for (const mutate of [
    tree => tree.tree.push(entry("notes/plan.md", other)),
    tree => { tree.tree.find(item => item.path === "repos.json").sha = head; },
    tree => { tree.tree.find(item => item.path === "MAP.md").mode = "120000"; },
    tree => tree.tree.push(entry("MAP.md", other)),
    tree => { tree.truncated = true; },
    tree => { tree.tree = Array(10001).fill(entry("x", other)); },
  ]) {
    const s = server(); mutate(s.objects.get(`/git/trees/${headTree}?recursive=1`));
    await assert.rejects(validate(s), /tree|output|path/i);
  }
  for (const change of [{ parents: [{ sha: other }] }, { parents: [{ sha: base }, { sha: other }] }, { message: "Unowned commit" }]) {
    const s = server(); Object.assign(s.objects.get(`/git/commits/${head}`), change);
    await assert.rejects(validate(s), /commit|parent|sign-off/i);
  }
});

test("authored profile edits, corrupt blobs and late identity changes fail without executing source code", async () => {
  const s = server();
  s.objects.get(`/git/trees/${headTree}?recursive=1`).tree.find(item => item.path === "profile/README.md").sha = s.blob(newReadme.replace("Authored", "Changed"));
  await assert.rejects(validate(s), /authored/i);
  const corrupt = server();
  const readmeSha = corrupt.objects.get(`/git/trees/${headTree}?recursive=1`).tree.find(item => item.path === "profile/README.md").sha;
  corrupt.objects.get(`/git/blobs/${readmeSha}`).content = Buffer.from("Forged").toString("base64");
  await assert.rejects(validate(corrupt), /blob|hash/i);
  const stale = server(); let reads = 0;
  const api = async (...args) => {
    const result = await stale.api(...args);
    if (args[2] === "/git/ref/heads/staging" && ++reads > 1) result.object.sha = other;
    return result;
  };
  await assert.rejects(validate(stale, { api }), /moved|identity/i);
});
