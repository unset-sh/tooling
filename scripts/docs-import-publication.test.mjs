import assert from "node:assert/strict";
import { test } from "node:test";
import { baseCommit, blob, importFixture, sourceCommit, sourceTree } from "../checks/docs-import-fixture.mjs";
import { publishDocsImport, settledPr, validateImportPr } from "./docs-import-publication.mjs";

function remote(fixture, overrides = {}) {
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
    if (path === "/git/ref/heads/automation/docs-tooling") return branch;
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
      assert.deepEqual(body, { ref: "refs/heads/automation/docs-tooling", sha: newHead });
      branch = { ref: body.ref, object: { type: "commit", sha: body.sha } }; return branch;
    }
    if (method === "POST" && path === "/pulls") {
      assert.equal(body.base, "main"); assert.equal(body.head, "automation/docs-tooling");
      createdPr = { number: 12, state: "open", user: { login: "github-actions[bot]", id: 41898282, type: "Bot" },
        head: { sha: newHead, ref: body.head, repo: { full_name: repository } },
        base: { sha: baseCommit, ref: "main", repo: { full_name: repository } } };
      return createdPr;
    }
    throw new Error(`Unexpected fixture request: ${method} ${path}`);
  };
  return { api, writes, get section() { return createdSection; } };
}

test("a verified import replaces only its section and opens a main PR without merging", async () => {
  const fixture = importFixture(), github = remote(fixture);
  const result = await publishDocsImport({ snapshot: fixture.snapshot, api: github.api });
  assert.deepEqual(result, { status: "opened", number: 12, branch: "automation/docs-tooling", head: "4".repeat(40), url: "https://github.com/unset-sh/docs/pull/12" });
  assert.deepEqual(github.section.map(entry => entry.path), ["LICENSE", "_index.md", "source.json"]);
  assert.equal(github.writes.some(entry => /merge|main|staging/.test(entry.path)), false);
  assert.equal(github.writes.some(entry => entry.body?.force === true), false);
  const writes = github.writes.length;
  assert.equal((await publishDocsImport({ snapshot: fixture.snapshot, api: github.api })).status, "pending");
  assert.equal(github.writes.length, writes);
});

test("source or destination movement and corrupted source proof refuse all publication mutations", async () => {
  for (const [repository, branch] of [["unset-sh/tooling", "main"], ["unset-sh/docs", "main"]]) {
    const fixture = importFixture();
    const github = remote(fixture, { [`${repository} GET /git/ref/heads/${branch}`]: () => ({ ref: `refs/heads/${branch}`, object: { type: "commit", sha: "f".repeat(40) } }) });
    await assert.rejects(publishDocsImport({ snapshot: fixture.snapshot, api: github.api }), /moved|revision/i);
    assert.equal(github.writes.length, 0);
  }
  const fixture = importFixture(); fixture.tree.tree[0].sha = "f".repeat(40);
  const github = remote(fixture);
  await assert.rejects(publishDocsImport({ snapshot: fixture.snapshot, api: github.api }));
  assert.equal(github.writes.length, 0);
});

test("an existing foreign branch or ambiguous PR is never adopted or overwritten", async () => {
  for (const overrides of [
    { "unset-sh/docs GET /git/ref/heads/automation/docs-tooling": () => ({ ref: "refs/heads/foreign", object: { type: "commit", sha: "9".repeat(40) } }) },
    { "unset-sh/docs GET /git/ref/heads/automation/docs-tooling": () => ({ ref: "refs/heads/automation/docs-tooling", object: { type: "commit", sha: "9".repeat(40) } }),
      [`unset-sh/docs GET /git/commits/${"9".repeat(40)}`]: () => ({ sha: "9".repeat(40), tree: { sha: "8".repeat(40) }, parents: [{ sha: baseCommit }], message: "Manual changes" }) },
  ]) {
    const fixture = importFixture(), github = remote(fixture, overrides);
    await assert.rejects(publishDocsImport({ snapshot: fixture.snapshot, api: github.api }));
    assert.equal(github.writes.length, 0);
  }
});

test("an unchanged section retains valid provenance while missing or corrupt provenance is repaired", async () => {
  const fixture = importFixture();
  const complete = fixture.snapshot.files.map(file => ({ path: file.path, mode: "100644", type: "blob", sha: blob(Buffer.from(file.content, "base64")), size: Buffer.from(file.content, "base64").length }));
  const route = `unset-sh/docs GET /git/trees/${"7".repeat(40)}?recursive=1`;
  const github = remote(fixture, { [route]: () => ({ sha: "7".repeat(40), truncated: false, tree: complete }) });
  assert.deepEqual(await publishDocsImport({ snapshot: fixture.snapshot, api: github.api }), { status: "unchanged" });
  assert.equal(github.writes.length, 0);
  const absent = remote(fixture, { [route]: () => ({ sha: "7".repeat(40), truncated: false, tree: complete.filter(file => file.path !== "source.json") }) });
  assert.equal((await publishDocsImport({ snapshot: fixture.snapshot, api: absent.api })).status, "opened");
  const corrupt = Buffer.from("{bad provenance}");
  const invalid = remote(fixture, {
    [route]: () => ({ sha: "7".repeat(40), truncated: false, tree: complete.map(file => file.path === "source.json" ? { ...file, sha: blob(corrupt), size: corrupt.length } : file) }),
    [`unset-sh/docs RAW /raw/${baseCommit}/tooling/source.json`]: () => corrupt,
  });
  assert.equal((await publishDocsImport({ snapshot: fixture.snapshot, api: invalid.api })).status, "opened");
});

test("last-moment source, docs main and import-branch races cannot move a visible ref or open a PR", async () => {
  for (const [repository, name, changeAt] of [["unset-sh/tooling", "main", 2], ["unset-sh/docs", "main", 2], ["unset-sh/docs", "automation/docs-tooling", 2]]) {
    const fixture = importFixture(); let reads = 0;
    const unchanged = repository === "unset-sh/tooling" ? sourceCommit : name === "main" ? baseCommit : null;
    const github = remote(fixture, { [`${repository} GET /git/ref/heads/${name}`]: () => {
      const sha = ++reads >= changeAt ? "f".repeat(40) : unchanged;
      return sha ? { ref: `refs/heads/${name}`, object: { type: "commit", sha } } : null;
    } });
    await assert.rejects(publishDocsImport({ snapshot: fixture.snapshot, api: github.api }), /moved/i);
    assert.equal(github.writes.some(write => write.path === "/git/refs" || write.path.startsWith("/git/refs/") || write.path === "/pulls"), false);
  }
});


test("previous section byte budget is checked before any old blob is fetched", async () => {
  const fixture = importFixture(), github = remote(fixture);
  await publishDocsImport({ snapshot: fixture.snapshot, api: github.api });
  let rawReads = 0;
  const bounded = async (repository, method, path, ...rest) => {
    if (method === "RAW") rawReads++;
    if (path === `/git/trees/${"2".repeat(40)}?recursive=1`) return { sha: "2".repeat(40), truncated: false,
      tree: Array.from({ length: 9 }, (_, index) => ({ path: `file-${index}.md`, mode: "100644", type: "blob", sha: "8".repeat(40), size: 1024 * 1024 })) };
    return github.api(repository, method, path, ...rest);
  };
  await assert.rejects(publishDocsImport({ snapshot: fixture.snapshot, api: bounded }), /total byte limit/);
  assert.equal(rawReads, 0);
});

test("an open import PR is accepted only at a base the caller names", () => {
  const head = "a".repeat(40), current = "b".repeat(40), previous = "c".repeat(40), other = "d".repeat(40);
  const pr = base => ({ number: 15, state: "open", user: { login: "github-actions[bot]", id: 41898282, type: "Bot" },
    head: { sha: head, ref: "automation/docs-github", repo: { full_name: "unset-sh/docs" } },
    base: { sha: base, ref: "main", repo: { full_name: "unset-sh/docs" } } });
  assert.equal(validateImportPr(pr(previous), "automation/docs-github", head, [current, previous]).number, 15);
  assert.throws(() => validateImportPr(pr(previous), "automation/docs-github", head, current), /identity or ownership/);
  assert.throws(() => validateImportPr(pr(other), "automation/docs-github", head, [current, previous]), /identity or ownership/);
});

test("an updated import PR is re-read until GitHub shows the new head, within a fixed bound", async () => {
  const head = "c".repeat(40), old = { number: 7, head: { sha: "d".repeat(40) } };
  const reads = [], waits = [];
  const lagging = after => async (repository, method, path) => {
    reads.push(`${repository} ${method} ${path}`);
    return reads.length >= after ? { number: 7, head: { sha: head } } : old;
  };
  assert.equal((await settledPr({ api: lagging(1), number: 7, pr: { number: 7, head: { sha: head } }, head, wait: async ms => waits.push(ms) })).head.sha, head);
  assert.deepEqual(reads, []);
  assert.equal((await settledPr({ api: lagging(3), number: 7, pr: old, head, wait: async ms => waits.push(ms) })).head.sha, head);
  assert.deepEqual(reads, Array(3).fill("unset-sh/docs GET /pulls/7")); assert.equal(waits.length, 2);
  reads.length = 0; waits.length = 0;
  assert.equal((await settledPr({ api: lagging(Infinity), number: 7, pr: old, head, wait: async ms => waits.push(ms) })).head.sha, old.head.sha);
  assert.equal(reads.length, 10); assert.equal(waits.length, 9);
  await assert.rejects(settledPr({ api: lagging(1), number: 0, pr: old, head }), /Invalid import pull request number/);
});
