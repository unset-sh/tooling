import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { validateAutomationDispatch } from "./automation-dispatch.mjs";

test("shared dispatch validation cannot be borrowed by arbitrary repositories or branch families", async () => {
  for (const repository of ["outside/docs", "unset-sh/tooling", "unset-sh/brand", "unset-sh/docs\n"]) {
    await assert.rejects(validateAutomationDispatch({ context: { repository }, api: () => { throw new Error("unreachable API"); } }), /unsupported|repository/i);
  }
  for (const repository of ["unset-sh/docs", "unset-sh/.github"]) {
    await assert.rejects(validateAutomationDispatch({ context: { repository, event: "push" }, api: () => { throw new Error("unreachable API"); } }), error => !error.message.includes("unreachable"));
  }
});

test("the executable names the fixed refusal reason without logging its token", () => {
  const run = spawnSync(process.execPath, [new URL("./automation-dispatch.mjs", import.meta.url).pathname,
    "--pull-request", "15", "--expected-head", "a".repeat(40), "--expected-base", "b".repeat(40)], {
    env: { PATH: process.env.PATH, GITHUB_REPOSITORY: "unset-sh/docs", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: "a".repeat(40), DOCS_GITHUB_TOKEN: "PRIVATE_TOKEN" }, encoding: "utf8", timeout: 3000 });
  assert.equal(run.status, 1); assert.match(run.stderr, /Reason: Invalid documentation dispatch identity/);
  assert.doesNotMatch(run.stdout + run.stderr, /PRIVATE_TOKEN/);
});
