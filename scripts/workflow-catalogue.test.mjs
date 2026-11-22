import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { collectWorkflowCatalogue } from "./workflow-catalogue.mjs";

const sha = (letter) => letter.repeat(40);
const collectorCommit = sha("f");
const now = () => new Date("2026-11-22T12:00:00.000Z");
const workflowPath = (name) => `.github/workflows/${name}`;
const workflowId = (repo, name, commit) => `unset-sh/${repo}/${workflowPath(name)}@${commit}`;
const reviewed = { repository: "web", path: workflowPath("ci.yml"), reviewedCommit: sha("a"),
  reviewedSha256: "0".repeat(64), purpose: "Check the web application.",
  steps: ["Run the application checks."], outputs: ["A check result."] };
const registry = (records = [reviewed]) => ({ schemaVersion: 1, workflows: records });

function fixture({ descriptions = registry(), includeTooling = true } = {}) {
  const routes = new Map();
  const repositories = [];
  const requests = [];
  const put = (path, value, status = 200) => routes.set(path, { value, status });
  const object = (repo, kind, value) => {
    const identity = createHash("sha1").update(JSON.stringify(value)).digest("hex");
    put(`/repos/unset-sh/${repo}/git/${kind}/${identity}`, { sha: identity, ...value });
    return identity;
  };
  const blob = (repo, path, source) => {
    const bytes = Buffer.isBuffer(source) ? source : Buffer.from(typeof source === "string" ? source : JSON.stringify(source));
    const identity = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    put(`/repos/unset-sh/${repo}/git/blobs/${identity}`, {
      sha: identity, size: bytes.length, encoding: "base64", content: bytes.toString("base64"),
    });
    return { path, sha: identity, type: "blob", mode: "100644", size: bytes.length };
  };
  const revision = (repo, commit, files) => {
    const entries = Object.entries(files).map(([path, source]) => blob(repo, path, source));
    const workflows = object(repo, "trees", { truncated: false, tree: entries });
    const github = object(repo, "trees", { truncated: false, tree: [
      { path: "workflows", type: "tree", mode: "040000", sha: workflows },
    ] });
    const rootEntries = [
      { path: ".github", type: "tree", mode: "040000", sha: github },
    ];
    let descriptionEntry;
    let descriptionTree;
    if (repo === "tooling" && descriptions !== null) {
      descriptionEntry = blob(repo, "descriptions.json", descriptions);
      descriptionTree = object(repo, "trees", { truncated: false, tree: [descriptionEntry] });
      rootEntries.push({ path: "workflows", type: "tree", mode: "040000", sha: descriptionTree });
    }
    const root = object(repo, "trees", { truncated: false, tree: rootEntries });
    put(`/repos/unset-sh/${repo}/git/commits/${commit}`, { sha: commit, tree: { sha: root } });
    return { root, github, workflows, entries, descriptionEntry, descriptionTree, rootEntries };
  };
  const ref = (repo, kind, name, commit, type = "commit") => put(
    `/repos/unset-sh/${repo}/git/ref/${kind}/${encodeURIComponent(name)}`,
    { ref: `refs/${kind}/${name}`, object: { type, sha: commit } },
  );
  const repository = (name, commit, files = {}, extra = {}) => {
    if (name === "tooling") {
      const previous = repositories.findIndex((repo) => repo.name === name);
      if (previous >= 0) repositories.splice(previous, 1);
    }
    repositories.push({ name, full_name: `unset-sh/${name}`, owner: { login: "unset-sh" },
      private: false, visibility: "public", archived: false, default_branch: "main", size: commit ? 1 : 0, ...extra });
    if (commit) {
      ref(name, "heads", extra.default_branch ?? "main", commit);
      return revision(name, commit, files);
    }
    put(`/repos/unset-sh/${name}/git/ref/heads/main`, { message: "Git Repository is empty." }, 409);
  };
  const toolingTree = includeTooling ? repository("tooling", sha("e")) : null;
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url);
    requests.push({ url: String(url), options });
    const path = parsed.pathname + parsed.search;
    if (path === "/orgs/unset-sh/repos?type=public&per_page=100&page=1" && !routes.has(path)) {
      return new Response(JSON.stringify(repositories), { status: 200 });
    }
    const route = routes.get(path);
    if (!route) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    return new Response(JSON.stringify(route.value), { status: route.status });
  };
  return { routes, repositories, requests, put, ref, revision, repository, toolingTree,
    collect: (options = {}) => collectWorkflowCatalogue({ parseYaml: JSON.parse, fetchImpl, now, collectorCommit, ...options }),
  };
}

test("collection joins reviewed descriptions by repository and path, preserving missing and stale states", async () => {
  const f = fixture();
  const source = { on: "push", jobs: { check: { "runs-on": "ubuntu-latest", steps: [{ run: "true" }] } } };
  f.repository(reviewed.repository, sha("a"), { [reviewed.path.slice(18)]: source });
  f.repository("undocumented-fixture", sha("b"), { "ci.yml": source });
  const result = await f.collect();
  const known = result.workflows.find(({ repository }) => repository === reviewed.repository);
  assert.deepEqual(known.documentation, { status: "review", purpose: reviewed.purpose, steps: reviewed.steps,
    outputs: reviewed.outputs, reviewedCommit: reviewed.reviewedCommit, reviewedSha256: reviewed.reviewedSha256 });
  const unknown = result.workflows.find(({ repository }) => repository === "undocumented-fixture");
  assert.deepEqual(unknown.documentation, { status: "missing", purpose: null, steps: [], outputs: [],
    reviewedCommit: null, reviewedSha256: null });
});

test("reviewed metadata advances independently of the executable pin at one resolved tooling revision", async () => {
  const snapshots = [];
  for (const [commit, purpose] of [[sha("a"), "First reviewed purpose."], [sha("b"), "New reviewed purpose."]]) {
    const f = fixture({ descriptions: registry([{ ...reviewed, purpose }]) });
    f.repository("tooling", commit);
    f.repository("web", sha("c"), { "ci.yml": { on: "push", jobs: { check: {} } } });
    snapshots.push(await f.collect());
    assert.equal(snapshots.at(-1).workflows[0].documentation.purpose, purpose);
    assert.equal(snapshots.at(-1).descriptions.commit, commit);
    assert.equal(snapshots.at(-1).repositories.find(({ name }) => name === "tooling").commit, commit);
    assert.equal(f.requests.filter(({ url }) => url.endsWith("/tooling/git/ref/heads/main")).length, 1);
    assert.equal(f.requests.filter(({ url }) => url.endsWith(`/tooling/git/commits/${commit}`)).length, 1);
  }
  assert.deepEqual(snapshots[0].collector, snapshots[1].collector);
  assert.notEqual(snapshots[0].descriptions.sha256, snapshots[1].descriptions.sha256);
});

test("remote metadata retains exact descriptions for both current and historical workflow versions", async () => {
  const current = { on: "workflow_call", jobs: { current: {} } };
  const previous = { on: "workflow_call", jobs: { previous: {} } };
  const description = (source, commit, purpose) => ({ ...reviewed, repository: "tooling", path: workflowPath("shared.yml"),
    reviewedCommit: commit, reviewedSha256: createHash("sha256").update(JSON.stringify(source)).digest("hex"), purpose });
  const f = fixture({ descriptions: registry([
    description(current, sha("b"), "Current implementation."), description(previous, sha("c"), "Historical implementation."),
  ]) });
  f.repository("tooling", sha("b"), { "shared.yml": current });
  f.revision("tooling", sha("c"), { "shared.yml": previous });
  f.repository("web", sha("a"), { "ci.yml": { on: "push", jobs: {
    shared: { uses: `unset-sh/tooling/.github/workflows/shared.yml@${sha("c")}` },
  } } });
  const result = await f.collect();
  const versions = result.workflows.filter(({ repository }) => repository === "tooling");
  assert.deepEqual(versions.map(({ documentation }) => [documentation.status, documentation.purpose]),
    [["current", "Current implementation."], ["current", "Historical implementation."]]);
  assert.equal(result.descriptions.commit, sha("b"));
});

test("missing or invalid remote metadata fails without falling back to the local checkout", async () => {
  await assert.rejects(fixture({ includeTooling: false }).collect(), /tooling.*description/i);
  const empty = fixture();
  empty.repository("tooling", null);
  await assert.rejects(empty.collect(), /tooling.*description/i);
  for (const descriptions of [null, {}, registry([]), "private-parser-source", Buffer.from([0xff])]) {
    await assert.rejects(fixture({ descriptions }).collect(), (error) => {
      assert.match(error.message, /description|UTF-8/i);
      assert.doesNotMatch(error.message, /private-parser-source/);
      return true;
    });
  }
  const mutations = [
    (f) => { f.toolingTree.rootEntries.find(({ path }) => path === "workflows").mode = "120000"; },
    (f) => { f.toolingTree.descriptionEntry.mode = "120000"; },
    (f) => { f.toolingTree.descriptionEntry.size = 1024 * 1024 + 1; },
    (f) => { f.routes.get(`/repos/unset-sh/tooling/git/trees/${f.toolingTree.descriptionTree}`).value.tree = []; },
    (f) => { f.routes.get(`/repos/unset-sh/tooling/git/trees/${f.toolingTree.descriptionTree}`).value.truncated = true; },
    (f) => { f.routes.get(`/repos/unset-sh/tooling/git/blobs/${f.toolingTree.descriptionEntry.sha}`).value.sha = sha("d"); },
    (f) => { f.routes.get(`/repos/unset-sh/tooling/git/blobs/${f.toolingTree.descriptionEntry.sha}`).value.content = "eA=="; },
    (f) => { f.put(`/repos/unset-sh/tooling/git/blobs/${f.toolingTree.descriptionEntry.sha}`, "private-error-body", 403); },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f);
    await assert.rejects(f.collect(), (error) => {
      assert.match(error.message, /description|tree|blob|HTTP/);
      assert.doesNotMatch(error.message, /private-error-body/);
      return true;
    });
  }
});

test("description provenance hashes the exact remote registry bytes including BOM and CRLF", async () => {
  const source = '\uFEFF' + JSON.stringify(registry(), null, 2).replaceAll("\n", "\r\n") + "\r\n";
  const result = await fixture({ descriptions: source }).collect();
  assert.equal(result.descriptions.sha256, createHash("sha256").update(source).digest("hex"));
});

test("catalogue records actual event filters, jobs and immutable workflow revisions", async () => {
  const f = fixture();
  f.repository("web", sha("a"), {
    "ci.yml": { name: "Web checks", on: { push: { branches: ["main"], paths: ["src/**"] },
      workflow_dispatch: { inputs: { privateDefault: { default: "omit me" } } },
      schedule: [{ cron: "23 * * * *" }] }, permissions: { contents: "read" }, jobs: {
      test: { name: "Check", "runs-on": "ubuntu-latest", steps: [{ uses: "example/action@v1" }] },
      publish: { needs: "test", if: "github.ref == 'refs/heads/main'", environment: { name: "pages" },
        permissions: { pages: "write" }, steps: [{ run: "echo secret-like-value" }] },
    } },
  });
  f.repository("empty", null);
  f.repository("archived", sha("b"), {}, { archived: true });
  const result = await f.collect();
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.organisation, "unset-sh");
  assert.equal(result.collectedAt, "2026-11-22T12:00:00.000Z");
  assert.deepEqual(result.collector, { repository: "unset-sh/tooling", commit: collectorCommit });
  assert.deepEqual(result.descriptions, { repository: "unset-sh/tooling", commit: sha("e"),
    sha256: createHash("sha256").update(JSON.stringify(registry())).digest("hex") });
  assert.deepEqual(result.repositories.map(({ name, commit, archived, workflowIds }) => [name, commit, archived, workflowIds.length]),
    [["archived", sha("b"), true, 0], ["empty", null, false, 0], ["tooling", sha("e"), false, 0], ["web", sha("a"), false, 1]]);
  assert.equal(result.workflows.length, 1);
  const workflow = result.workflows[0];
  assert.equal(workflow.id, workflowId("web", "ci.yml", sha("a")));
  assert.equal(workflow.name, "Web checks");
  assert.equal(workflow.current, true);
  assert.match(workflow.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(workflow.events, [
    { name: "push", config: { branches: ["main"], paths: ["src/**"] } },
    { name: "schedule", config: ["23 * * * *"] },
    { name: "workflow_dispatch", config: null },
  ]);
  assert.deepEqual(workflow.jobs, [
    { id: "publish", name: "publish", needs: ["test"], condition: "github.ref == 'refs/heads/main'",
      permissions: { pages: "write" }, environment: "pages", uses: null },
    { id: "test", name: "Check", needs: [], condition: null, permissions: null, environment: null, uses: null },
  ]);
  assert.deepEqual(result.calls, []);
  assert.doesNotMatch(JSON.stringify(result), /omit me|secret-like-value|example\/action/);
});

test("pinned calls and nested local calls retain historical revisions without duplicating cycles", async () => {
  const f = fixture();
  f.repository("web", sha("a"), { "ci.yml": { on: "push", jobs: {
    shared: { uses: `unset-sh/tooling/.github/workflows/shared.yml@${sha("c")}` },
    again: { uses: `unset-sh/tooling/.github/workflows/shared.yml@${sha("c")}` },
  } } });
  const reusable = { on: "workflow_call", jobs: { check: { steps: [{ run: "test" }] } } };
  f.repository("tooling", sha("b"), { "shared.yml": reusable, "helper.yaml": reusable });
  f.revision("tooling", sha("c"), {
    "shared.yml": { on: "workflow_call", jobs: { nested: { uses: "$/.github/workflows/helper.yaml" } } },
    "helper.yaml": { on: "workflow_call", jobs: { back: { uses: "./.github/workflows/shared.yml" } } },
  });
  const result = await f.collect();
  assert.equal(result.workflows.length, 5);
  assert.deepEqual(result.workflows.filter(({ current }) => !current).map(({ path, commit }) => [path, commit]), [
    [workflowPath("helper.yaml"), sha("c")], [workflowPath("shared.yml"), sha("c")],
  ]);
  assert.equal(result.calls.length, 4);
  const remote = result.calls.filter(({ resolution }) => resolution === "commit");
  assert.equal(remote.length, 2);
  assert.ok(remote.every(({ status, targetId }) => status === "resolved" && targetId === workflowId("tooling", "shared.yml", sha("c"))));
  const nested = result.calls.find(({ jobId }) => jobId === "nested");
  assert.equal(nested.targetId, workflowId("tooling", "helper.yaml", sha("c")));
  assert.equal(nested.resolution, "local");
  assert.equal(result.repositories.find(({ name }) => name === "tooling").workflowIds.length, 2);
});

test("tag precedence and annotated tags resolve once before following exact source trees", async () => {
  const f = fixture();
  f.repository("web", sha("a"), { "ci.yml": { on: ["push", "pull_request"], jobs: {
    tag: { uses: "unset-sh/tooling/.github/workflows/shared.yml@stable" },
    branch: { uses: "unset-sh/tooling/.github/workflows/shared.yml@next" },
  } } });
  const reusable = { on: { workflow_call: null }, jobs: { run: {} } };
  f.repository("tooling", sha("b"), { "shared.yml": reusable });
  f.revision("tooling", sha("c"), { "shared.yml": reusable });
  f.ref("tooling", "tags", "stable", sha("d"), "tag");
  f.ref("tooling", "heads", "stable", sha("b"));
  f.ref("tooling", "heads", "next", sha("b"));
  f.put(`/repos/unset-sh/tooling/git/tags/${sha("d")}`, { sha: sha("d"), object: { type: "tag", sha: sha("e") } });
  f.put(`/repos/unset-sh/tooling/git/tags/${sha("e")}`, { sha: sha("e"), object: { type: "commit", sha: sha("c") } });
  const result = await f.collect();
  const tag = result.calls.find(({ jobId }) => jobId === "tag");
  const branch = result.calls.find(({ jobId }) => jobId === "branch");
  assert.equal(tag.targetId, workflowId("tooling", "shared.yml", sha("c")));
  assert.equal(tag.resolution, "tag");
  assert.equal(branch.targetId, workflowId("tooling", "shared.yml", sha("b")));
  assert.equal(branch.resolution, "branch");
  assert.ok(!f.requests.some(({ url }) => url.endsWith("/heads/stable")));
});

test("unresolved, external, malformed and non-reusable targets are visible without invented edges", async () => {
  const f = fixture();
  f.repository("web", sha("a"), { "ci.yml": { on: "push", jobs: {
    outside: { uses: "other-org/workflows/.github/workflows/check.yml@v1" },
    private: { uses: "unset-sh/private-repo/.github/workflows/check.yml@main" },
    missingFile: { uses: "./.github/workflows/nope.yml" },
    missingRef: { uses: "unset-sh/web/.github/workflows/ci.yml@absent" },
    missingCommit: { uses: `unset-sh/web/.github/workflows/ci.yml@${sha("d")}` },
    malformed: { uses: "unset-sh/web/../../evil.yml@main" },
    notReusable: { uses: "./.github/workflows/ci.yml" },
  } } });
  const result = await f.collect();
  assert.deepEqual(Object.fromEntries(result.calls.map(({ jobId, status }) => [jobId, status])), {
    malformed: "invalid", missingCommit: "missing", missingFile: "missing", missingRef: "missing",
    notReusable: "invalid", outside: "external", private: "external",
  });
  assert.ok(result.calls.every(({ targetId }) => targetId === null));
  assert.ok(f.requests.every(({ url }) => new URL(url).hostname === "api.github.com"));
  assert.ok(!f.requests.some(({ url }) => /other-org|private-repo|evil/.test(url)));
});

test("all public inventory pages are read and API links cannot reroute credentials", async () => {
  const f = fixture();
  for (let i = 0; i < 101; i++) f.repository(`repo-${i}`, null);
  f.put("/orgs/unset-sh/repos?type=public&per_page=100&page=1", f.repositories.slice(0, 100));
  f.put("/orgs/unset-sh/repos?type=public&per_page=100&page=2", f.repositories.slice(100));
  for (const repo of f.repositories) repo.url = "https://untrusted.invalid/receive-token";
  const result = await f.collect({ githubToken: "fixture-token" });
  assert.equal(result.repositories.length, 102);
  assert.ok(result.repositories.some(({ name }) => name === "repo-100"));
  assert.ok(f.requests.every(({ url, options }) => new URL(url).origin === "https://api.github.com" &&
    options.method === "GET" && options.redirect === "error" && options.headers.Authorization === "Bearer fixture-token" &&
    options.signal instanceof AbortSignal));
});

test("private, foreign, duplicate and malformed inventory entries stop collection", async () => {
  for (const extra of [{ private: true }, { visibility: "private" }, { owner: { login: "someone-else" } },
    { full_name: "someone-else/repo" }, { name: "repo\n", full_name: "unset-sh/repo\n" },
    { default_branch: "../../secret" }, { size: -1 }]) {
    const f = fixture();
    f.repository("repo", null, {}, extra);
    await assert.rejects(f.collect(), /inventory/);
  }
  const f = fixture();
  f.repository("repo", null);
  f.repository("repo", null);
  await assert.rejects(f.collect(), /inventory/);
});

test("transport, authentication, redirects, malformed and oversized responses fail without leaking bodies", async () => {
  const sensitive = "fixture-sensitive-response";
  const responses = [
    () => { throw new Error(sensitive); },
    () => new Response(sensitive, { status: 403 }),
    () => new Response(sensitive, { status: 429 }),
    () => new Response(sensitive, { status: 500 }),
    () => new Response(sensitive),
    () => new Response('"' + "x".repeat(4 * 1024 * 1024) + '"'),
    () => ({ redirected: true, status: 200 }),
  ];
  for (const fetchImpl of responses) {
    await assert.rejects(collectWorkflowCatalogue({ parseYaml: JSON.parse, collectorCommit, now, fetchImpl }), (error) => {
      assert.match(error.message, /GitHub/);
      assert.doesNotMatch(error.message, new RegExp(sensitive));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test("missing default branch and nonempty conflict cannot silently erase workflow coverage", async () => {
  for (const status of [404, 409]) {
    const f = fixture();
    f.repository("web", sha("a"), { "ci.yml": { on: "push", jobs: { test: {} } } });
    f.put("/repos/unset-sh/web/git/ref/heads/main", { message: "unavailable" }, status);
    await assert.rejects(f.collect(), /HTTP/);
  }
});

test("malformed YAML and impossible needs graphs stop the refresh", async () => {
  const invalid = [null, [], {}, { on: "push", jobs: {} }, { on: true, jobs: { test: {} } },
    { on: "push", jobs: { test: { needs: "absent" } } },
    { on: "push", jobs: { a: { needs: "b" }, b: { needs: "a" } } },
    { on: "push", jobs: { "test\n": {} } },
    { on: "push", jobs: { test: { name: "   " } } },
    { on: "push", jobs: { test: { permissions: { contents: "owner" } } } },
  ];
  for (const value of invalid) {
    const f = fixture();
    f.repository("web", sha("a"), { "ci.yml": value });
    await assert.rejects(f.collect(), /Invalid workflow/);
  }
  const f = fixture();
  f.repository("web", sha("a"), { "ci.yml": "not JSON or YAML here" });
  await assert.rejects(f.collect({ parseYaml: () => { throw new Error("private-parser-source"); } }), (error) => {
    assert.match(error.message, /Cannot parse workflow/);
    assert.doesNotMatch(error.message, /private-parser-source/);
    return true;
  });
});

test("tree truncation, object mismatches, symlinks and excessive sources cannot produce a partial map", async () => {
  const mutations = [
    (f, tree) => { f.routes.get(`/repos/unset-sh/web/git/trees/${tree.workflows}`).value.truncated = true; },
    (f, tree) => { f.routes.get(`/repos/unset-sh/web/git/trees/${tree.workflows}`).value.sha = sha("e"); },
    (f, tree) => { tree.entries[0].mode = "120000"; },
    (f, tree) => { tree.entries[0].size = 1024 * 1024 + 1; },
    (f, tree) => { f.routes.get(`/repos/unset-sh/web/git/blobs/${tree.entries[0].sha}`).value.content = Buffer.from("changed").toString("base64"); },
    (f, tree) => { f.routes.get(`/repos/unset-sh/web/git/blobs/${tree.entries[0].sha}`).value.sha = sha("e"); },
    (f) => { f.routes.get(`/repos/unset-sh/web/git/commits/${sha("a")}`).value.sha = sha("a") + "\n"; },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    const tree = f.repository("web", sha("a"), { "ci.yml": { on: "push", jobs: { test: {} } } });
    mutate(f, tree);
    await assert.rejects(f.collect(), /Invalid|regular file/);
  }
});

test("catalogue size is bounded while collecting many individually valid workflows", async () => {
  const f = fixture();
  const jobs = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`job${i}`, { name: "x".repeat(6000) }]));
  f.repository("web", sha("a"), Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`ci${i}.yml`, { on: "push", jobs }])));
  await assert.rejects(f.collect(), /size limit/);
});

test("source provenance and parser input retain UTF-8 BOM and CRLF bytes", async () => {
  const f = fixture();
  const source = '\uFEFF{\r\n  "on": "push",\r\n  "jobs": { "test": {} }\r\n}\r\n';
  f.repository("web", sha("a"), { "ci.yml": source });
  let parserInput;
  const result = await f.collect({ parseYaml: (input) => {
    parserInput = input;
    return JSON.parse(input.replace(/^\uFEFF/, ""));
  } });
  assert.equal(parserInput, source);
  assert.equal(result.workflows[0].sha256, createHash("sha256").update(Buffer.from(source)).digest("hex"));
});
