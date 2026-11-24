import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { baseCommit, importFixture, sourceCommit } from "../checks/docs-import-fixture.mjs";
import { receiverContext, runDocsImport } from "./docs-import.mjs";

const environment = { GITHUB_REPOSITORY: "unset-sh/docs", GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "schedule", GITHUB_SHA: baseCommit };

test("receiver and command refusals occur before any API request or output", async () => {
  for (const event of ["schedule", "workflow_dispatch"]) assert.equal(receiverContext({ ...environment, GITHUB_EVENT_NAME: event }), baseCommit);
  let calls = 0; const api = () => { calls++; throw new Error("API must not be reached"); };
  const output = () => { throw new Error("Output must not be written"); };
  for (const change of [{ GITHUB_REPOSITORY: "unset-sh/tooling" }, { GITHUB_REF: "refs/heads/staging" },
    { GITHUB_EVENT_NAME: "push" }, { GITHUB_EVENT_NAME: "pull_request_target" }, { GITHUB_SHA: "main" }]) {
    await assert.rejects(runDocsImport({ args: ["resolve", "--source", "tooling"], environment: { ...environment, ...change }, api, output }), /only in docs/i);
  }
  for (const args of [["unknown"], ["resolve"], ["resolve", "--repository", "tooling"],
    ["resolve", "--source", "tooling", "--source", "github"], ["resolve", "source", "tooling"]]) {
    await assert.rejects(runDocsImport({ args, environment, api, output }), /command|arguments/i);
  }
  assert.equal(calls, 0);
});

test("source resolution emits only the exact successful current-main export and refuses a moved receiver", async () => {
  const fixture = importFixture(); const outputs = []; const calls = [];
  const api = async (repository, method, path) => {
    calls.push({ repository, method, path }); assert.equal(method, "GET");
    if (repository === "unset-sh/docs") return { ref: "refs/heads/main", object: { type: "commit", sha: baseCommit } };
    assert.equal(repository, "unset-sh/tooling");
    if (path === "/git/ref/heads/main") return { ref: "refs/heads/main", object: { type: "commit", sha: sourceCommit } };
    assert.match(path, /automation-docs-self\.yml\/runs\?.*head_sha=/);
    return { total_count: 1, workflow_runs: [fixture.run] };
  };
  assert.deepEqual(await runDocsImport({ args: ["resolve", "--source", "tooling"], environment, api, output: value => outputs.push(value) }),
    { key: "tooling", revision: sourceCommit, runId: 123 });
  assert.deepEqual(outputs, [{ repository: "unset-sh/tooling", revision: sourceCommit, "run-id": 123 }]);
  assert.equal(calls[0].repository, "unset-sh/docs");
  await assert.rejects(runDocsImport({ args: ["resolve", "--source", "tooling"], environment: { ...environment, GITHUB_SHA: "f".repeat(40) }, api }), /main moved/i);
});

test("publication and dispatch bind source and base to the receiver before any mutation", async t => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "docs-import-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const snapshot = join(root, "snapshot.json"); writeFileSync(snapshot, JSON.stringify(importFixture().snapshot));
  for (const sample of [
    { args: ["publish", "--source", "github", "--snapshot", snapshot], base: baseCommit, error: /another source/i },
    { args: ["publish", "--source", "tooling", "--snapshot", snapshot], base: "f".repeat(40), error: /another docs revision/i },
    { args: ["dispatch", "--pull-request", "12", "--expected-head", "c".repeat(40), "--expected-base", "d".repeat(40), "--branch", "automation/docs-tooling"],
      base: baseCommit, error: /another docs revision/i },
  ]) {
    let calls = 0;
    const api = async (repository, method, path) => {
      calls++; assert.equal(repository, "unset-sh/docs"); assert.equal(method, "GET"); assert.equal(path, "/git/ref/heads/main");
      return { ref: "refs/heads/main", object: { type: "commit", sha: sample.base } };
    };
    await assert.rejects(runDocsImport({ args: sample.args, environment: { ...environment, GITHUB_SHA: sample.base }, api }), sample.error);
    assert.equal(calls, 1);
  }
});

test("the executable rejects a foreign receiver without logging its token or arbitrary arguments", () => {
  const run = spawnSync(process.execPath, [new URL("./docs-import.mjs", import.meta.url).pathname, "resolve", "--source", "PRIVATE_SOURCE"], {
    env: { PATH: process.env.PATH, ...environment, GITHUB_REPOSITORY: "outside/docs", DOCS_GITHUB_TOKEN: "PRIVATE_TOKEN" }, encoding: "utf8", timeout: 3000 });
  assert.equal(run.status, 1); assert.match(run.stderr, /Documentation import refused/);
  assert.doesNotMatch(run.stdout + run.stderr, /PRIVATE_TOKEN|PRIVATE_SOURCE/);
});

test("the executable names the fixed refusal reason so a failed run can be diagnosed", () => {
  const run = spawnSync(process.execPath, [new URL("./docs-import.mjs", import.meta.url).pathname, "resolve", "--source", "PRIVATE_SOURCE"], {
    env: { PATH: process.env.PATH, ...environment, GITHUB_REPOSITORY: "outside/docs", DOCS_GITHUB_TOKEN: "PRIVATE_TOKEN" }, encoding: "utf8", timeout: 3000 });
  assert.equal(run.status, 1); assert.match(run.stderr, /Reason: Documentation imports run only in docs on main/);
  assert.doesNotMatch(run.stdout + run.stderr, /PRIVATE_TOKEN|PRIVATE_SOURCE/);
});
