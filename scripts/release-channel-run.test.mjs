import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runChannel } from "./release-channel-run.mjs";

test("runner prepares and receipts the exact push without accepting arbitrary channel or version inputs", async (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "channel-run-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { GITHUB_EVENT_NAME: "push", GITHUB_REPOSITORY: "unset-sh/example", GITHUB_SHA: "b".repeat(40), GITHUB_REF: "refs/heads/staging",
    GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", GITHUB_EVENT_PATH: join(root, "event.json"), SOURCE_DIRECTORY: root,
    NPM_PACKAGE: "false", INSTALL: "false", VERSION: "1.2.0-staging.123.1", ARTIFACT_DIRECTORY: join(root, "artifact") };
  writeFileSync(env.GITHUB_EVENT_PATH, JSON.stringify({ ref: env.GITHUB_REF, before: "a".repeat(40), after: env.GITHUB_SHA,
    created: false, deleted: false, forced: false, repository: { full_name: env.GITHUB_REPOSITORY, private: false } }));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "example", version: "1.2.0" }));
  await runChannel("prepare", env);
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).version, env.VERSION);
  await runChannel("receipt", env);
  assert.equal(JSON.parse(readFileSync(join(root, "artifact/receipt.json"))).commit, env.GITHUB_SHA);
  await assert.rejects(() => runChannel("receipt", { ...env, VERSION: "1.2.0" }), /version/i);
  await assert.rejects(() => runChannel("receipt", { ...env, GITHUB_EVENT_NAME: "workflow_dispatch" }), /push/i);
  await assert.rejects(() => runChannel("execute", env), /command/i);
  await assert.rejects(() => runChannel("prepare", { ...env, NPM_PACKAGE: "true\n" }), /boolean/i);
});
