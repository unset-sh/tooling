import assert from "node:assert/strict";
import { test } from "node:test";
import { validateGeneratedMapDispatch } from "./generated-map-publication.mjs";

import { repository, base, head, baseTree, headTree, other, branch, context, newReadme, server, entry } from "../checks/map-dispatch-fixture.mjs";

const validate = (s, extra = {}) => validateGeneratedMapDispatch({ context, number: "17", expectedHead: head, expectedBase: base, api: s.api, ...extra });

test("a generated map dispatch verifies actual PR identities and only reads the exact base/head trees", async () => {
  const s = server();
  assert.deepEqual(await validate(s), { number: 17, repository, head, base, branch });
  assert.ok(s.calls.includes(`/git/trees/${headTree}?recursive=1`));
  assert.ok(s.calls.filter(path => path === "/git/ref/heads/main").length >= 2);
});

test("unsupported dispatch contexts and identities fail before API reads", async () => {
  for (const extra of [{ number: "17\n" }, { number: "0" }, { number: "9007199254740992" }, { expectedHead: "main" },
    { expectedBase: head }, ...[{ repository: "unset-sh/docs" }, { event: "pull_request" }, { ref: "refs/heads/staging" }, { ref: "refs/heads/master" }, { sha: other }].map(change => ({ context: { ...context, ...change } }))]) {
    const s = server(); await assert.rejects(validate(s, extra)); assert.deepEqual(s.calls, []);
  }
});

test("foreign, edited, closed, draft and stale generated PRs are rejected", async () => {
  for (const change of [{ number: 18 }, { state: "closed" }, { draft: true }, { user: { login: "human", id: 123, type: "User" } },
    { head: { sha: other } }, { base: { ref: "staging" } }]) {
    const s = server(); Object.assign(s.objects.get("/pulls/17"), change);
    await assert.rejects(validate(s), /PR|pull request|identity/i);
  }
  for (const path of ["/git/ref/heads/main", `/git/ref/heads/${branch}`]) {
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
    if (args[2] === "/git/ref/heads/main" && ++reads > 1) result.object.sha = other;
    return result;
  };
  await assert.rejects(validate(stale, { api }), /moved|identity/i);
});
