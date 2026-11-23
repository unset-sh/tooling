import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runChannel } from "./release-channel-run.mjs";

test("CLI refusals never echo native parser or source error payloads", (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "channel-log-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const event = join(root, "event.json");
  const sha = "b".repeat(40); const tree = "d".repeat(40); const bytes = Buffer.from("SECRET7");
  const hash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  writeFileSync(event, JSON.stringify({ ref: "refs/heads/staging", before: "a".repeat(40), after: sha,
    created: false, deleted: false, forced: false, repository: { full_name: "unset-sh/example", private: false } }));
  const replies = [{ sha, tree: { sha: tree } }, { sha: tree, truncated: false,
    tree: [{ path: "package.json", type: "blob", mode: "100644", sha: hash, size: bytes.length }] },
    { sha: hash, encoding: "base64", size: bytes.length, content: bytes.toString("base64") }];
  const script = new URL("./release-channel-run.mjs", import.meta.url);
  const bootstrap = `const replies = JSON.parse(process.env.REPLIES); globalThis.fetch = async () => new Response(JSON.stringify(replies.shift()));
    process.argv = [process.execPath, ${JSON.stringify(script.pathname)}, "plan"]; await import(${JSON.stringify(script.href)});`;
  const run = spawnSync(process.execPath, ["--input-type=module", "--eval", bootstrap], {
    env: { PATH: process.env.PATH, GITHUB_EVENT_PATH: event, GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/staging",
      GITHUB_REPOSITORY: "unset-sh/example", GITHUB_SHA: sha, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
      NPM_PACKAGE: "false", INSTALL: "false", GH_TOKEN: "fixture-token", REPLIES: JSON.stringify(replies) }, encoding: "utf8" });
  assert.equal(run.status, 1); assert.doesNotMatch(run.stderr + run.stdout, /SECRET7/);
  assert.match(run.stderr, /release channel:/);
});

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
