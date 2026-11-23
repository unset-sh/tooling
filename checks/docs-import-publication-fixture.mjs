import assert from "node:assert/strict";
import { baseCommit, blob, sourceCommit, sourceTree } from "./docs-import-fixture.mjs";
export function remote(fixture, overrides = {}) {
  const writes = [];
  const baseTree = "1".repeat(40), sectionTree = "2".repeat(40), newTree = "3".repeat(40), newHead = "4".repeat(40);
  const existingSection = [{ path: "old.md", mode: "100644", type: "blob", sha: "5".repeat(40), size: 3 }];
  const root = [{ path: "README.md", mode: "100644", type: "blob", sha: "6".repeat(40), size: 10 },
    { path: "tooling", mode: "040000", type: "tree", sha: "7".repeat(40) }];
  let branch = null, createdCommit, createdSection, createdPr;
  const api = async (repository, method, path, body) => {
    if (!["GET", "RAW"].includes(method)) writes.push({ repository, method, path, body });
    if (overrides[`${repository} ${method} ${path}`]) return overrides[`${repository} ${method} ${path}`]({ body, writes });
    if (method === "RAW") {
      const file = fixture.snapshot.files.find(file => path.endsWith(`/${file.path}`));
      assert.ok(file); return Buffer.from(file.content, "base64");
    }
    if (repository === "unset-sh/tooling") {
      assert.equal(method, "GET");
      if (path === "/git/ref/heads/main") return { ref: "refs/heads/main", object: { type: "commit", sha: sourceCommit } };
      if (path === "/actions/runs/123") return fixture.run;
      if (path === `/git/commits/${sourceCommit}`) return { sha: sourceCommit, tree: { sha: sourceTree } };
      if (path === `/git/trees/${sourceTree}?recursive=1`) return fixture.tree;
    }
    assert.equal(repository, "unset-sh/docs");
    if (path === "/git/ref/heads/main") return { ref: "refs/heads/main", object: { type: "commit", sha: baseCommit } };
    if (path === `/git/commits/${baseCommit}`) return { sha: baseCommit, tree: { sha: baseTree } };
    if (path === `/git/trees/${baseTree}`) return { sha: baseTree, truncated: false, tree: root };
    if (path === `/git/trees/${"7".repeat(40)}?recursive=1`) return { sha: "7".repeat(40), truncated: false, tree: existingSection };
    if (path === "/git/ref/heads/automation/docs-app-tooling") return branch;
    if (path.startsWith("/pulls?")) return createdPr ? [createdPr] : [];
    if (path === `/git/commits/${newHead}`) return createdCommit;
    if (path === `/git/trees/${newTree}`) return { sha: newTree, truncated: false, tree: [root[0], { ...root[1], sha: sectionTree }] };
    if (path === `/git/trees/${sectionTree}?recursive=1`) return { sha: sectionTree, truncated: false,
      tree: createdSection.map(entry => ({ ...entry, size: Buffer.from(fixture.snapshot.files.find(file => file.path === entry.path).content, "base64").length })) };
    if (path.startsWith("/git/blobs/")) {
      const file = fixture.snapshot.files.find(file => blob(Buffer.from(file.content, "base64")) === path.split("/").at(-1));
      assert.ok(file); return { sha: path.split("/").at(-1), encoding: "base64", content: file.content, size: Buffer.from(file.content, "base64").length };
    }
    if (method === "POST" && path === "/git/blobs") return { sha: blob(Buffer.from(body.content, body.encoding)) };
    if (method === "POST" && path === "/git/trees") {
      if (!body.base_tree) { createdSection = body.tree; return { sha: sectionTree }; }
      assert.deepEqual(body, { base_tree: baseTree, tree: [{ path: "tooling", mode: "040000", type: "tree", sha: sectionTree }] });
      return { sha: newTree };
    }
    if (method === "POST" && path === "/git/commits") {
      assert.deepEqual(body.parents, [baseCommit]); assert.equal(body.tree, newTree);
      createdCommit = { sha: newHead, tree: { sha: newTree }, parents: [{ sha: baseCommit }], message: body.message };
      return createdCommit;
    }
    if (method === "POST" && path === "/git/refs") {
      assert.deepEqual(body, { ref: "refs/heads/automation/docs-app-tooling", sha: newHead });
      branch = { ref: body.ref, object: { type: "commit", sha: body.sha } }; return branch;
    }
    if (method === "POST" && path === "/pulls") {
      assert.equal(body.base, "main"); assert.equal(body.head, "automation/docs-app-tooling");
      createdPr = { number: 12, state: "open", user: { login: "fixture-automation[bot]", id: 456, type: "Bot" },
        head: { sha: newHead, ref: body.head, repo: { full_name: repository } },
        base: { sha: baseCommit, ref: "main", repo: { full_name: repository } } };
      return createdPr;
    }
    throw new Error(`Unexpected fixture request: ${method} ${path}`);
  };
  return { api, writes, get section() { return createdSection; } };
}
