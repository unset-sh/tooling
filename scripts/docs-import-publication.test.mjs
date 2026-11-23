import assert from "node:assert/strict";
import { after, test } from "node:test";
import { baseCommit, blob, importFixture, sourceCommit, sourceTree } from "../checks/docs-import-fixture.mjs";
import { appFixtureModules, appFixtureCredentials } from "../checks/automation-app-fixture.mjs";
const modules = await appFixtureModules(after);
const { automationApp } = modules["automation-app"];
const publishDocsImport = options => modules["docs-import-publication"].publishDocsImport({ ...appFixtureCredentials, ...options });

import { remote } from "../checks/docs-import-publication-fixture.mjs";

test("a verified import replaces only its section and opens a main PR without merging", async () => {
  const fixture = importFixture(), github = remote(fixture);
  const result = await publishDocsImport({ snapshot: fixture.snapshot, api: github.api });
  assert.deepEqual(result, { status: "opened", number: 12, branch: "automation/docs-app-tooling", head: "4".repeat(40), url: "https://github.com/unset-sh/docs/pull/12" });
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
    { "unset-sh/docs GET /git/ref/heads/automation/docs-app-tooling": () => ({ ref: "refs/heads/foreign", object: { type: "commit", sha: "9".repeat(40) } }) },
    { "unset-sh/docs GET /git/ref/heads/automation/docs-app-tooling": () => ({ ref: "refs/heads/automation/docs-app-tooling", object: { type: "commit", sha: "9".repeat(40) } }),
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
  for (const [repository, name, changeAt] of [["unset-sh/tooling", "main", 2], ["unset-sh/docs", "main", 2], ["unset-sh/docs", "automation/docs-app-tooling", 2]]) {
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


test("publication refuses an unverified App before any source or repository request", async () => {
  const fixture = importFixture(); let calls = 0;
  await assert.rejects(publishDocsImport({ snapshot: fixture.snapshot, api: () => { calls++; }, appSlug: "foreign" }), /App/);
  assert.equal(calls, 0);
});

test("new import PRs must belong to the App and never adopt an open legacy job-token PR", async () => {
  const fixture = importFixture(), github = remote(fixture);
  const oldBot = { login: "github-actions[bot]", id: 41898282, type: "Bot" };
  const api = async (...args) => {
    const value = await github.api(...args);
    return args[1] === "POST" && args[2] === "/pulls" ? { ...value, user: oldBot } : value;
  };
  await assert.rejects(publishDocsImport({ snapshot: fixture.snapshot, api }), /ownership/);
  const prior = remote(fixture);
  await publishDocsImport({ snapshot: fixture.snapshot, api: prior.api });
  const writes = prior.writes.length;
  await assert.rejects(publishDocsImport({ snapshot: fixture.snapshot, api: async (...args) => {
    const value = await prior.api(...args);
    return args[2].startsWith("/pulls?") ? value.map(pr => ({ ...pr, number: 10, user: oldBot })) : value;
  } }), /ownership/);
  assert.equal(prior.writes.length, writes);
});
