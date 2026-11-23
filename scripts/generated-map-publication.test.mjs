import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
// Exercise the real publisher and identity verifier with public fixture identity
// only in an isolated copy. Production remains dormant until owner setup lands.
const appRoot = mkdtempSync(join(realpathSync(tmpdir()), "map-app-test-"));
after(() => rmSync(appRoot, { recursive: true, force: true }));
for (const name of ["generated-map-publication.mjs", "automation-app.mjs", "cli.mjs"]) {
  copyFileSync(new URL(`./${name}`, import.meta.url), join(appRoot, name));
}
writeFileSync(join(appRoot, "automation-app.json"), JSON.stringify({ clientId: "Iv23fixture1234567890", appId: 123, slug: "fixture-automation", botId: 456, installationId: 789 }));
const { publishGeneratedMap, stageGeneratedMap, validateSnapshot } = await import(pathToFileURL(join(appRoot, "generated-map-publication.mjs")));
const { automationApp } = await import(pathToFileURL(join(appRoot, "automation-app.mjs")));
const cli = join(appRoot, "generated-map-publication.mjs");
const repository = "unset-sh/.github";
const base = "a".repeat(40);
const baseTree = "b".repeat(40);
const newTree = "c".repeat(40);
const head = "d".repeat(40);
const signoff = automationApp.signoff;
const appIdentity = { appSlug: automationApp.slug, installationId: String(automationApp.installationId) };
const marker = "<!-- org-map:start (generated from repos.json; edit that, then run npm run map) -->";
const oldReadme = `# Authored introduction\n${marker}\nOld map\n<!-- org-map:end -->\nAuthored footer\n`;
const newReadme = oldReadme.replace("Old map", "New map");
const snapshot = () => ({ schemaVersion: 1, repository, commit: base, files: { "MAP.md": "New map\n", "profile/README.md": newReadme } });
const hash = (text) => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");
const entry = (path, sha) => ({ path, sha, mode: "100644", type: "blob" });

function server(options = {}) {
  const calls = [];
  let baseReads = 0;
  const pr = () => ({ number: 17, state: "open", user: automationApp.bot, head: { sha: head, ref: `automation/map-${base}`, repo: { full_name: repository } }, base: { ref: "main", sha: base, repo: { full_name: repository } }, ...options.prOverride });
  const fetchImpl = async (url, init) => {
    if (url === "https://api.github.com/installation/repositories?per_page=100") {
      calls.push({ method: init.method, path: "/installation/repositories?per_page=100" });
      return new Response(JSON.stringify(options.installation ?? { total_count: 1, repositories: [{ id: 123, full_name: repository, owner: { login: "unset-sh", type: "Organization" } }] }));
    }
    assert.ok(url.startsWith("https://api.github.com/repos/unset-sh/.github/"));
    assert.equal(init.redirect, "error");
    assert.ok(init.signal instanceof AbortSignal);
    const path = url.slice("https://api.github.com/repos/unset-sh/.github".length);
    const body = init.body && JSON.parse(init.body);
    calls.push({ method: init.method, path, body });
    const respond = (value, status = 200) => new Response(JSON.stringify(value), { status });
    if (options.failure) return respond({ message: "private-body TOKEN-SECRET" }, options.failure);
    if (path === "/git/ref/heads/main") {
      baseReads++;
      return respond({ ref: "refs/heads/main", object: { type: "commit", sha: baseReads >= (options.moveAt ?? Infinity) ? "e".repeat(40) : base } });
    }
    if (path === `/git/commits/${base}`) return respond({ sha: base, tree: { sha: baseTree }, parents: [] });
    if (path === `/git/trees/${baseTree}?recursive=1`) return respond({ sha: baseTree, truncated: false, tree: [
      entry("MAP.md", hash(options.unchanged ? "New map\n" : "Old map\n")),
      { path: "profile", mode: "040000", type: "tree", sha: "f".repeat(40) },
      entry("profile/README.md", hash(options.unchanged ? newReadme : oldReadme)),
      entry("repos.json", "1".repeat(40)), entry("scripts/map.mjs", "2".repeat(40)),
    ] });
    if (path === `/git/blobs/${hash(options.unchanged ? newReadme : oldReadme)}`) {
      const content = options.unchanged ? newReadme : oldReadme;
      return respond({ sha: hash(content), encoding: "base64", size: Buffer.byteLength(content), content: Buffer.from(content).toString("base64") });
    }
    if (path === `/git/ref/heads/automation/map-${base}`) return options.existing ? respond({ ref: `refs/heads/automation/map-${base}`, object: { sha: head, type: "commit" } }) : respond({}, 404);
    if (path === `/git/commits/${head}`) return respond({ sha: head, message: `Refresh generated organisation map${options.unsigned ? "" : `\n\n${signoff}`}`, tree: { sha: options.wrongTree ? baseTree : newTree }, parents: [{ sha: options.wrongParent ? "e".repeat(40) : base }] });
    if (path === "/git/blobs" && init.method === "POST") return respond({ sha: hash(body.content) }, 201);
    if (path === "/git/trees" && init.method === "POST") return respond({ sha: newTree }, 201);
    if (path === "/git/commits" && init.method === "POST") return respond({ sha: head, message: body.message, tree: { sha: newTree }, parents: [{ sha: base }] }, 201);
    if (path === "/git/refs" && init.method === "POST") return respond({ ref: `refs/heads/automation/map-${base}`, object: { sha: head, type: "commit" } }, 201);
    if (path.startsWith("/pulls?") && init.method === "GET") return respond(options.existingPr ? [pr(), ...(options.duplicatePr ? [pr()] : [])] : []);
    if (path === "/pulls" && init.method === "POST") return respond(pr(), 201);
    if (path === "/pulls/17/merge" && init.method === "PUT") return respond({ merged: !options.refusal, sha: "9".repeat(40), message: "private-body TOKEN-SECRET" }, options.refusal ?? 200);
    throw new Error(`Unexpected request ${init.method} ${path}`);
  };
  return { calls, fetchImpl, writes: () => calls.filter(({ method }) => method !== "GET") };
}

test("unchanged generated files cause no writes", async () => {
  const api = server({ unchanged: true });
  assert.deepEqual(await publishGeneratedMap({ snapshot: snapshot(), githubToken: "TOKEN-SECRET", ...appIdentity, fetchImpl: api.fetchImpl }), { status: "unchanged" });
  assert.deepEqual(api.writes(), []);
});

test("publishes only changed output blobs as a main PR with the immutable parent and no merge", async () => {
  const api = server();
  const result = await publishGeneratedMap({ snapshot: snapshot(), githubToken: "TOKEN-SECRET", ...appIdentity, fetchImpl: api.fetchImpl });
  assert.deepEqual(result, { status: "pending", number: 17, head, base, url: "https://github.com/unset-sh/.github/pull/17" });
  assert.deepEqual(api.writes().map(({ method, path }) => [method, path]), [
    ["POST", "/git/blobs"], ["POST", "/git/blobs"], ["POST", "/git/trees"],
    ["POST", "/git/commits"], ["POST", "/git/refs"], ["POST", "/pulls"],
  ]);
  assert.deepEqual(api.calls.find(({ path }) => path === "/git/trees").body, { base_tree: baseTree, tree: [entry("MAP.md", hash("New map\n")), entry("profile/README.md", hash(newReadme))] });
  const commit = api.calls.find(({ path }) => path === "/git/commits").body;
  assert.deepEqual(commit.parents, [base]);
  assert.equal(commit.tree, newTree);
  assert.equal(commit.message, `Refresh generated organisation map\n\n${signoff}`);
  assert.equal(commit.author, undefined);
  assert.equal(commit.committer, undefined);
  assert.deepEqual(api.calls.find(({ path }) => path === "/git/refs").body, { ref: `refs/heads/automation/map-${base}`, sha: head });
  assert.equal(api.calls.find(({ path }) => path === "/pulls").body.base, "main");
  assert.equal(api.calls.at(-1).path, "/git/ref/heads/main");
  assert.equal(api.calls.some(call => call.path.endsWith("/merge")), false);
});

test("a README-only change leaves the unchanged MAP blob out of the new tree entries", async () => {
  const api = server();
  const s = snapshot(); s.files["MAP.md"] = "Old map\n";
  await publishGeneratedMap({ snapshot: s, githubToken: "TOKEN-SECRET", ...appIdentity, fetchImpl: api.fetchImpl });
  assert.equal(api.writes().filter(({ path }) => path === "/git/blobs").length, 1);
  assert.deepEqual(api.calls.find(({ path }) => path === "/git/trees").body.tree, [entry("profile/README.md", hash(newReadme))]);
});

for (const content of [newReadme.replace("Authored", "Changed"), newReadme.replace("<!-- org-map:end -->", ""), newReadme + marker, newReadme.replace(marker, ""), newReadme.replace(marker, "<!-- org-map:end -->").replace("New map", marker), newReadme + "<!-- org-map:end -->"]) {
  test("rejects authored README or malformed marker edits before writing", async () => {
    const api = server();
    const value = snapshot(); value.files["profile/README.md"] = content;
    await assert.rejects(publishGeneratedMap({ snapshot: value, githubToken: "TOKEN-SECRET", ...appIdentity, fetchImpl: api.fetchImpl }), /README|marker/);
    assert.deepEqual(api.writes(), []);
  });
}

for (const [label, mutate] of [
  ["repository", (s) => { s.repository = "elsewhere/repo"; }],
  ["path", (s) => { s.files["repos.json"] = "{}"; }],
  ["schema", (s) => { s.schemaVersion = 2; }],
  ["extra key", (s) => { s.command = "anything"; }],
  ["missing file", (s) => { delete s.files["MAP.md"]; }],
  ["nontext", (s) => { s.files["MAP.md"] = {}; }],
  ["oversize", (s) => { s.files["MAP.md"] = "x".repeat(1024 * 1024 + 1); }],
  ["invalid Unicode", (s) => { s.files["MAP.md"] = "\ud800"; }],
  ["nonimmutable commit", (s) => { s.commit = "main"; }],
  ["commit newline", (s) => { s.commit += "\n"; }],
]) {
  test(`rejects invalid ${label} without making requests`, async () => {
    const s = snapshot(); mutate(s);
    assert.throws(() => validateSnapshot(s));
    const api = server();
    await assert.rejects(publishGeneratedMap({ snapshot: s, githubToken: "TOKEN-SECRET", ...appIdentity, fetchImpl: api.fetchImpl }));
    assert.deepEqual(api.calls, []);
  });
}

for (const moveAt of [1, 2, 3]) {
  test(`refuses main moving at check ${moveAt}`, async () => {
    const api = server({ moveAt });
    await assert.rejects(publishGeneratedMap({ snapshot: snapshot(), githubToken: "TOKEN-SECRET", ...appIdentity, fetchImpl: api.fetchImpl }), /main.*moved/);
    assert.equal(api.calls.some(({ path }) => path.endsWith("/merge")), false);
    if (moveAt <= 2) assert.deepEqual(api.writes(), []);
  });
}

for (const existingPr of [false, true]) {
  test(`retries a verified existing publication branch ${existingPr ? "and PR" : "without a PR"} without moving its ref`, async () => {
    const api = server({ existing: true, existingPr });
    assert.deepEqual(await publishGeneratedMap({ snapshot: snapshot(), githubToken: "TOKEN-SECRET", ...appIdentity, fetchImpl: api.fetchImpl }), { status: "pending", number: 17, head, base, url: "https://github.com/unset-sh/.github/pull/17" });
    assert.deepEqual(api.writes().filter(({ path }) => path === "/git/refs" || path === "/git/commits"), []);
    assert.equal(api.writes().filter(({ path }) => path === "/pulls").length, existingPr ? 0 : 1);
    assert.ok(api.calls.some(({ path }) => path === `/git/commits/${head}`));
  });
}

for (const bad of [{ wrongTree: true }, { wrongParent: true }, { existingPr: true, duplicatePr: true }]) {
  test("refuses unverified existing trees, parents and ambiguous pull requests", async () => {
    const api = server({ existing: true, ...bad });
    await assert.rejects(publishGeneratedMap({ snapshot: snapshot(), githubToken: "TOKEN-SECRET", ...appIdentity, fetchImpl: api.fetchImpl }), /existing|ambiguous/);
    assert.ok(api.writes().every(({ path }) => ["/git/blobs", "/git/trees"].includes(path)));
  });
}

test("refuses an existing publication commit without the bot sign-off", async () => {
  const api = server({ existing: true, existingPr: true, unsigned: true });
  await assert.rejects(publishGeneratedMap({ snapshot: snapshot(), githubToken: "TOKEN-SECRET", ...appIdentity, fetchImpl: api.fetchImpl }), /sign-off/);
  assert.ok(api.writes().every(({ path }) => ["/git/blobs", "/git/trees"].includes(path)));
});

test("refuses a human-created retry PR rather than adopting it as generated output", async () => {
  const api = server({ existing: true, existingPr: true, prOverride: { user: { login: "maintainer", id: 123, type: "User" } } });
  await assert.rejects(publishGeneratedMap({ snapshot: snapshot(), githubToken: "TOKEN-SECRET", ...appIdentity, fetchImpl: api.fetchImpl }), /bot author/);
  assert.ok(api.writes().every(({ path }) => ["/git/blobs", "/git/trees"].includes(path)));
});

for (const prOverride of [{ state: "closed" }, { head: { sha: "e".repeat(40) } }, { head: { sha: head, ref: `automation/map-${base}`, repo: { full_name: "other/repo" } } }, { base: { ref: "other", sha: base, repo: { full_name: repository } } }]) {
  test("refuses a closed, moved, foreign or retargeted existing PR without merge", async () => {
    const api = server({ existing: true, existingPr: true, prOverride });
    await assert.rejects(publishGeneratedMap({ snapshot: snapshot(), githubToken: "TOKEN-SECRET", ...appIdentity, fetchImpl: api.fetchImpl }), /pull request/);
    assert.ok(api.writes().every(({ path }) => ["/git/blobs", "/git/trees"].includes(path)));
  });
}

test("publication never attempts to merge or update the main ref", async () => {
  const api = server({ refusal: 405 });
  assert.deepEqual(await publishGeneratedMap({ snapshot: snapshot(), githubToken: "TOKEN-SECRET", ...appIdentity, fetchImpl: api.fetchImpl }),
    { status: "pending", number: 17, head, base, url: "https://github.com/unset-sh/.github/pull/17" });
  assert.equal(api.calls.some(({ method }) => ["PUT", "PATCH", "DELETE"].includes(method)), false);
});

test("HTTP and network failures never expose a token or response body", async () => {
  for (const fetchImpl of [server({ failure: 500 }).fetchImpl, async () => { throw new Error("TOKEN-SECRET private-body"); }]) {
    await assert.rejects(publishGeneratedMap({ snapshot: snapshot(), githubToken: "TOKEN-SECRET", ...appIdentity, fetchImpl }), (error) => {
      assert.doesNotMatch(error.message, /TOKEN-SECRET|private-body/);
      return true;
    });
  }
});

function fixture(t) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "generated-map-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "source");
  mkdirSync(join(root, "profile"), { recursive: true });
  mkdirSync(join(root, ".github"));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" };
  const git = (...args) => execFileSync("git", args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  writeFileSync(join(root, "MAP.md"), "Old map\n");
  writeFileSync(join(root, "profile/README.md"), oldReadme);
  writeFileSync(join(root, "repos.json"), "{}\n");
  writeFileSync(join(root, ".github/maps.json"), JSON.stringify({ schemaVersion: 1, maps: [{ id: "organisation", generator: "scripts/map.mjs", arguments: ["--write"], outputs: ["MAP.md", "profile/README.md"] }] }));
  git("init", "--initial-branch=main"); git("add", "."); git("-c", "commit.gpgsign=false", "commit", "-m", "fixture");
  const commit = git("rev-parse", "HEAD");
  writeFileSync(join(root, "MAP.md"), "New map\n");
  writeFileSync(join(root, "profile/README.md"), newReadme);
  return { root, out: join(directory, "snapshot.json"), repository, commit, git, directory };
}

for (const change of [{ generator: "scripts/other.mjs" }, { outputs: ["MAP.md", "repos.json"] }]) {
  test("stage refuses registry expansion beyond the fixed generator and outputs", (t) => {
    const f = fixture(t);
    writeFileSync(join(f.root, ".github/maps.json"), JSON.stringify({ schemaVersion: 1, maps: [{ id: "organisation", generator: "scripts/map.mjs", arguments: ["--write"], outputs: ["MAP.md", "profile/README.md"], ...change }] }));
    f.git("add", ".github/maps.json"); f.git("-c", "commit.gpgsign=false", "commit", "-m", "registry");
    f.commit = f.git("rev-parse", "HEAD");
    assert.throws(() => stageGeneratedMap(f), /registry/);
    assert.equal(existsSync(f.out), false);
  });
}

test("stages a fresh bounded JSON snapshot from precisely the checked-out commit", (t) => {
  const f = fixture(t);
  stageGeneratedMap(f);
  assert.deepEqual(JSON.parse(readFileSync(f.out, "utf8")), { ...snapshot(), commit: f.commit });
  assert.throws(() => stageGeneratedMap(f), /exists/);
});

test("staging preserves exactly the 3 MiB JSON byte limit", (t) => {
  const f = fixture(t);
  const s = snapshot(); s.commit = f.commit;
  s.files["MAP.md"] = "\n".repeat(1024 * 1024);
  s.files["profile/README.md"] = "";
  const remainder = 3 * 1024 * 1024 - Buffer.byteLength(JSON.stringify(s));
  s.files["profile/README.md"] = "\n".repeat(Math.floor(remainder / 2)) + "x".repeat(remainder % 2);
  writeFileSync(join(f.root, "MAP.md"), s.files["MAP.md"]);
  writeFileSync(join(f.root, "profile/README.md"), s.files["profile/README.md"]);
  stageGeneratedMap(f);
  assert.equal(readFileSync(f.out).length, 3 * 1024 * 1024);
});

test("publish CLI reports a prepared PR successfully and emits only bounded identity outputs", (t) => {
  const f = fixture(t);
  writeFileSync(f.out, JSON.stringify(snapshot()));
  const preload = join(f.directory, "fake-api.mjs");
  const declarations = { repository, base, baseTree, newTree, head, signoff, oldReadme, newReadme, automationApp };
  writeFileSync(preload, `import assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';\n` +
    Object.entries(declarations).map(([key, value]) => `const ${key} = ${JSON.stringify(value)};`).join("\n") +
    `\nconst hash = ${hash.toString()};\nconst entry = ${entry.toString()};\n${server.toString()}\n` +
    `const api = server({ refusal: 405 }); globalThis.fetch = (...args) => { assert.equal(process.env.GH_TOKEN, undefined); return api.fetchImpl(...args); };`);
  const output = join(f.directory, "outputs"); writeFileSync(output, "");
  const result = spawnSync(process.execPath, ["--import", preload, cli, "publish", "--snapshot", f.out], {
    env: { ...process.env, GITHUB_REPOSITORY: repository, GITHUB_SHA: base, GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "push", GH_TOKEN: "TOKEN-SECRET", AUTOMATION_APP_SLUG: appIdentity.appSlug, AUTOMATION_APP_INSTALLATION_ID: appIdentity.installationId, GITHUB_OUTPUT: output }, encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.equal(readFileSync(output, "utf8"), `number=17\nhead=${head}\nbase=${base}\n`);
  assert.equal(result.stdout.trim(), "pending https://github.com/unset-sh/.github/pull/17");
  assert.doesNotMatch(result.stdout + result.stderr, /TOKEN-SECRET|private-body/);
});

for (const kind of ["tracked", "staged", "untracked", "head", "symlink", "hardlink", "directory link", "invalid UTF-8"]) {
  test(`stage rejects ${kind} interference and leaves no artifact`, (t) => {
    const f = fixture(t);
    if (kind === "tracked" || kind === "staged") {
      writeFileSync(join(f.root, "repos.json"), "changed");
      if (kind === "staged") { f.git("add", "repos.json"); writeFileSync(join(f.root, "repos.json"), "{}\n"); }
    } else if (kind === "untracked") writeFileSync(join(f.root, "source.mjs"), "anything");
    else if (kind === "head") f.commit = base;
    else if (kind === "invalid UTF-8") writeFileSync(join(f.root, "MAP.md"), Buffer.from([0xff]));
    else if (kind === "directory link") {
      mkdirSync(join(f.directory, "other"));
      writeFileSync(join(f.directory, "other/README.md"), newReadme);
      rmSync(join(f.root, "profile"), { recursive: true });
      symlinkSync(join(f.directory, "other"), join(f.root, "profile"));
    } else {
      writeFileSync(join(f.directory, "linked"), "New map\n");
      rmSync(join(f.root, "MAP.md"));
      (kind === "symlink" ? symlinkSync : linkSync)(join(f.directory, "linked"), join(f.root, "MAP.md"));
    }
    assert.throws(() => stageGeneratedMap(f));
    assert.equal(existsSync(f.out), false);
  });
}

for (const [key, value] of [["GITHUB_REPOSITORY", "other/repo"], ["GITHUB_SHA", "f".repeat(40)], ["GITHUB_REF", "refs/heads/other"], ["GITHUB_EVENT_NAME", "pull_request"]]) {
  test(`publish CLI refuses mismatched ${key} context without leaking credentials`, (t) => {
    const f = fixture(t); stageGeneratedMap(f);
    const result = spawnSync(process.execPath, [cli, "publish", "--snapshot", f.out], {
      env: { ...process.env, GITHUB_REPOSITORY: repository, GITHUB_SHA: f.commit, GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "push", GH_TOKEN: "TOKEN-SECRET", [key]: value }, encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /context/);
    assert.doesNotMatch(result.stdout + result.stderr, /TOKEN-SECRET/);
  });
}

for (const override of [{ appSlug: "foreign-app" }, { installationId: "0" }, { appSlug: undefined }, { installationId: undefined }]) {
  test("wrong or missing App output identity fails before publication writes", async () => {
    const api = server();
    await assert.rejects(publishGeneratedMap({ snapshot: snapshot(), githubToken: "TOKEN-SECRET", ...appIdentity, ...override, fetchImpl: api.fetchImpl }));
    assert.deepEqual(api.writes(), []);
  });
}

test("legacy job-token PRs are not adopted as App-owned map PRs", async () => {
  const api = server({ existing: true, existingPr: true, prOverride: { user: { login: "github-actions[bot]", id: 41898282, type: "Bot" } } });
  await assert.rejects(publishGeneratedMap({ snapshot: snapshot(), githubToken: "TOKEN-SECRET", ...appIdentity, fetchImpl: api.fetchImpl }), /bot author/);
  assert.ok(api.writes().every(({ path }) => ["/git/blobs", "/git/trees"].includes(path)));
});

for (const installation of [
  { total_count: 2, repositories: [{ id: 123, full_name: repository, owner: { login: "unset-sh", type: "Organization" } }] },
  { total_count: 1, repositories: [{ id: 123, full_name: "unset-sh/docs", owner: { login: "unset-sh", type: "Organization" } }] },
]) {
  test("a token for extra or different repositories never reaches map publication", async () => {
    const api = server({ installation });
    await assert.rejects(publishGeneratedMap({ snapshot: snapshot(), githubToken: "TOKEN-SECRET", ...appIdentity, fetchImpl: api.fetchImpl }), /selected repository/);
    assert.deepEqual(api.calls.map(call => call.path), ["/installation/repositories?per_page=100"]);
    assert.deepEqual(api.writes(), []);
  });
}

for (const user of [
  { ...automationApp.bot, id: automationApp.bot.id + 1 },
  { ...automationApp.bot, login: "lookalike[bot]" },
  { ...automationApp.bot, type: "User" },
]) {
  test("App PR ownership requires the exact configured bot login, numeric ID and type", async () => {
    const api = server({ existing: true, existingPr: true, prOverride: { user } });
    await assert.rejects(publishGeneratedMap({ snapshot: snapshot(), githubToken: "TOKEN-SECRET", ...appIdentity, fetchImpl: api.fetchImpl }), /bot author/);
    assert.ok(api.writes().every(({ path }) => ["/git/blobs", "/git/trees"].includes(path)));
  });
}
