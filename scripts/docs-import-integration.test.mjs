import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stageDocsImport } from "./docs-import-data.mjs";
import { publishDocsImport } from "./docs-import-publication.mjs";
import { validateDocsImportDispatch } from "./docs-import-dispatch.mjs";

const environment = { PATH: process.env.PATH, LANG: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "github-actions[bot]", GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
  GIT_COMMITTER_NAME: "github-actions[bot]", GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com" };

function repository(root, branch) {
  mkdirSync(root);
  const git = (args, input) => execFileSync("git", args, { cwd: root, env: environment, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trimEnd();
  git(["init", "-q", "-b", branch]);
  return { root, git,
    put(path, contents) { const filename = join(root, path); mkdirSync(join(filename, ".."), { recursive: true }); writeFileSync(filename, contents); },
    commit(message) { git(["add", "."]); git(["commit", "-qm", message]); return git(["rev-parse", "HEAD"]); },
    head() { return git(["rev-parse", "HEAD"]); },
  };
}

function gitTree(repo, sha, recursive = false) {
  const entries = repo.git(["ls-tree", "-z", "-l", ...(recursive ? ["-r"] : []), sha]).split("\0").filter(Boolean).map(line => {
    const match = /^(\d+) (\w+) ([a-f0-9]{40})\s+(-|\d+)\t([\s\S]+)$/.exec(line);
    assert.ok(match, line);
    const [, mode, type, object, size, path] = match;
    return { path, mode, type, sha: object, ...(size === "-" ? {} : { size: Number(size) }) };
  });
  // GitHub recursive trees include directories; git ls-tree needs -t for them.
  if (recursive) {
    const all = repo.git(["ls-tree", "-r", "-t", "-z", sha]).split("\0").filter(Boolean);
    for (const line of all) {
      const match = /^040000 tree ([a-f0-9]{40})\t([\s\S]+)$/.exec(line);
      if (match) entries.push({ path: match[2], mode: "040000", type: "tree", sha: match[1] });
    }
  }
  return { sha, truncated: false, tree: entries };
}

function gitCommit(repo, sha) {
  return { sha, tree: { sha: repo.git(["show", "-s", "--format=%T", sha]) },
    parents: repo.git(["show", "-s", "--format=%P", sha]).split(" ").filter(Boolean).map(sha => ({ sha })),
    message: repo.git(["show", "-s", "--format=%B", sha]) };
}

test("updating a checked import after staging advances keeps its real three-dot diff section-only", async t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "docs-import-integration-")));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = repository(join(directory, "source"), "main");
  source.put("LICENSE", "Fixture licence\n");
  source.put("docs/_index.md", "First docs\n");
  source.commit("Initial source");
  const docs = repository(join(directory, "docs"), "staging");
  docs.put("README.md", "Framework\n"); docs.put("other/_index.md", "Another section\n");
  const initialBase = docs.commit("Initial framework");
  const runs = new Map(); let pr = null, sequence = 0;
  const changes = () => docs.git(["diff", "--name-only", `${docs.head()}...${pr.head.ref}`]).split("\n").filter(Boolean);
  const currentPr = () => pr && { ...pr, draft: false, changed_files: changes().length,
    head: { ...pr.head, sha: docs.git(["rev-parse", `refs/heads/${pr.head.ref}`]) }, base: { ...pr.base, sha: docs.head() } };
  const api = async (name, method, path, body) => {
    const repo = name === "unset-sh/tooling" ? source : docs;
    assert.ok(["unset-sh/tooling", "unset-sh/docs"].includes(name));
    if (method === "RAW") {
      const [, , commit, ...parts] = path.split("/");
      return execFileSync("git", ["show", `${commit}:${parts.join("/")}`], { cwd: docs.root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    }
    if (path.startsWith("/actions/runs/")) return runs.get(Number(path.split("/").at(-1)));
    if (path.startsWith("/git/ref/heads/")) {
      const ref = `refs/heads/${path.slice("/git/ref/heads/".length)}`;
      try { return { ref, object: { type: "commit", sha: repo.git(["rev-parse", "--verify", ref]) } }; }
      catch { return null; }
    }
    if (method === "GET" && path.startsWith("/git/commits/")) return gitCommit(repo, path.split("/").at(-1));
    if (method === "GET" && path.startsWith("/git/trees/")) return gitTree(repo, path.split("/").at(-1).split("?")[0], path.includes("recursive=1"));
    if (method === "GET" && path.startsWith("/git/blobs/")) {
      const sha = path.split("/").at(-1);
      const bytes = execFileSync("git", ["cat-file", "blob", sha], { cwd: repo.root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
      return { sha, encoding: "base64", content: bytes.toString("base64"), size: bytes.length };
    }
    if (path.startsWith("/compare/")) {
      const [base, head] = path.slice("/compare/".length).split("...");
      const ancestor = repo.git(["merge-base", base, head]);
      return { status: ancestor === base ? (base === head ? "identical" : "ahead") : "diverged", base_commit: { sha: base }, merge_base_commit: { sha: ancestor } };
    }
    if (path.startsWith("/pulls?")) return pr ? [currentPr()] : [];
    if (method === "GET" && path === "/pulls/1") return currentPr();
    if (method === "GET" && path === "/pulls/1/files?per_page=100&page=1") return changes().map(filename => ({ filename, status: "added" }));
    assert.equal(name, "unset-sh/docs", "source repositories are never written");
    if (method === "POST" && path === "/git/blobs") return { sha: docs.git(["hash-object", "-w", "--stdin"], Buffer.from(body.content, "base64")) };
    if (method === "POST" && path === "/git/trees") {
      const entries = new Map((body.base_tree ? gitTree(docs, body.base_tree).tree : []).map(entry => [entry.path, entry]));
      for (const entry of body.tree) { assert.equal(entry.path.includes("/"), false); entries.set(entry.path, entry); }
      const content = [...entries.values()].map(entry => `${entry.mode} ${entry.type} ${entry.sha}\t${entry.path}\0`).join("");
      return { sha: docs.git(["mktree", "-z"], content) };
    }
    if (method === "POST" && path === "/git/commits") {
      const sha = docs.git(["commit-tree", body.tree, ...body.parents.flatMap(parent => ["-p", parent])], `${body.message}\n`);
      return gitCommit(docs, sha);
    }
    if (method === "POST" && path === "/git/refs") {
      docs.git(["update-ref", body.ref, body.sha, "0".repeat(40)]);
      return { ref: body.ref, object: { type: "commit", sha: body.sha } };
    }
    if (method === "PATCH" && path.startsWith("/git/refs/heads/")) {
      assert.equal(body.force, false);
      const ref = `refs/heads/${path.slice("/git/refs/heads/".length)}`;
      const before = docs.git(["rev-parse", ref]);
      docs.git(["merge-base", "--is-ancestor", before, body.sha]);
      docs.git(["update-ref", ref, body.sha, before]);
      return { ref, object: { type: "commit", sha: body.sha } };
    }
    if (method === "POST" && path === "/pulls") {
      pr = { number: 1, state: "open", user: { login: "github-actions[bot]", id: 41898282, type: "Bot" },
        head: { ref: body.head, repo: { full_name: name } }, base: { ref: body.base, repo: { full_name: name } } };
      return currentPr();
    }
    if (method === "PATCH" && path === "/pulls/1") return currentPr();
    throw new Error(`Unexpected Git fixture API request ${method} ${path}`);
  };
  const snapshot = () => {
    const runId = ++sequence;
    runs.set(runId, { id: runId, event: "push", head_branch: "main", head_sha: source.head(), status: "completed", conclusion: "success",
      path: ".github/workflows/automation-docs-self.yml", repository: { full_name: "unset-sh/tooling" }, head_repository: { full_name: "unset-sh/tooling" } });
    const out = join(directory, `snapshot-${runId}.json`);
    stageDocsImport({ root: source.root, source: "tooling", revision: source.head(), runId, baseCommit: docs.head(), workflowCommit: docs.head(), out });
    return JSON.parse(readFileSync(out));
  };
  const first = await publishDocsImport({ snapshot: snapshot(), api });
  assert.equal(first.status, "opened");
  docs.put("README.md", "Updated framework\n"); docs.put("other/_index.md", "Updated other section\n");
  const secondBase = docs.commit("Advance staging independently");
  source.put("docs/_index.md", "Updated source docs\n"); source.commit("Update source docs");
  const nextSnapshot = snapshot();
  const second = await publishDocsImport({ snapshot: nextSnapshot, api });
  assert.equal(second.status, "updated"); assert.equal(second.number, first.number);
  assert.equal(docs.git(["merge-base", secondBase, second.head]), secondBase);
  assert.deepEqual(docs.git(["diff", "--name-only", `${secondBase}...${second.head}`]).split("\n"), ["tooling/LICENSE", "tooling/_index.md", "tooling/source.json"]);
  assert.deepEqual(gitCommit(docs, second.head).parents.map(parent => parent.sha), [first.head, secondBase]);
  assert.equal(docs.git(["show", `${second.head}:README.md`]), "Updated framework");
  assert.equal(docs.git(["rev-parse", "staging"]), secondBase);
  assert.notEqual(initialBase, secondBase);
  assert.equal((await publishDocsImport({ snapshot: nextSnapshot, api })).status, "pending");
  const dispatch = { context: { repository: "unset-sh/docs", event: "workflow_dispatch", ref: `refs/heads/${second.branch}`, sha: second.head },
    number: "1", expectedHead: second.head, expectedBase: secondBase, api };
  assert.deepEqual(await validateDocsImportDispatch(dispatch), { number: 1, head: second.head, base: secondBase, branch: second.branch, repository: "unset-sh/docs" });
  await assert.rejects(validateDocsImportDispatch({ ...dispatch, api: (name, method, path, ...rest) => path.includes("/files?")
    ? [{ filename: "README.md", status: "modified" }] : api(name, method, path, ...rest) }), /another section|framework/);
  // Staging can advance only inside this section while the source bytes stay unchanged.
  // The previous branch still needs a new recorded base and reconciliation parent.
  docs.put("tooling/_index.md", "Independent section change\n");
  const thirdBase = docs.commit("Advance the owned section on staging");
  const third = await publishDocsImport({ snapshot: snapshot(), api });
  assert.equal(third.status, "updated");
  assert.deepEqual(gitCommit(docs, third.head).parents.map(parent => parent.sha), [second.head, thirdBase]);
  assert.equal(docs.git(["merge-base", thirdBase, third.head]), thirdBase);
  assert.ok(docs.git(["diff", "--name-only", `${thirdBase}...${third.head}`]).split("\n").every(path => path.startsWith("tooling/")));
  await validateDocsImportDispatch({ ...dispatch, context: { ...dispatch.context, sha: third.head }, expectedHead: third.head, expectedBase: thirdBase });

});
