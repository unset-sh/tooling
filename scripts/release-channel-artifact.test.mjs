import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { receiptFor, verifyArtifact, reserveTag } from "./release-channel-artifact.mjs";
import { entry, packed } from "../checks/tarball.mjs";

const context = { repository: "unset-sh/example", sha: "a".repeat(40), branch: "staging", channel: "staging", runId: "123", runAttempt: "1" };
const plan = { version: "1.2.0-staging.123.1", channel: "staging", manifest: { name: "@unset-sh/example", version: "1.2.0-staging.123.1",
  publishConfig: { registry: "https://npm.pkg.github.com" } } };
function fixture(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "channel-artifact-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "files")); writeFileSync(join(root, "receipt.json"), JSON.stringify(receiptFor(context, plan.version)));
  return root;
}
test("release artifacts bind repository, exact source, channel, run and attempt before accepting files", (t) => {
  const root = fixture(t); assert.deepEqual(verifyArtifact(root, context, plan), { names: [], packageName: null });
  const name = "unset-sh-example-1.2.0-staging.123.1.tgz";
  writeFileSync(join(root, "files", name), packed(entry("package/package.json", plan.manifest)));
  assert.deepEqual(verifyArtifact(root, context, plan, { npmPackage: true }), { names: [name], packageName: name });
  for (const changed of [{ sha: "b".repeat(40) }, { repository: "fork/example" }, { runId: "456" }, { runAttempt: "2" }, { channel: "stable" }]) {
    assert.throws(() => verifyArtifact(root, { ...context, ...changed }, plan), /receipt/i);
  }
  assert.throws(() => verifyArtifact(root, context, { ...plan, version: "1.2.0" }), /receipt/i);
  writeFileSync(join(root, "files", name), packed(entry("package/package.json", { ...plan.manifest, scripts: { prepublishOnly: "bad" } })));
  assert.throws(() => verifyArtifact(root, context, plan, { npmPackage: true }), /manifest/i);
});
test("artifact boundary refuses extra roots, links, odd names and excessive files or bytes", (t) => {
  for (const add of [
    (r) => writeFileSync(join(r, "extra"), "x"),
    (r) => symlinkSync("../receipt.json", join(r, "files/link")),
    (r) => linkSync(join(r, "receipt.json"), join(r, "files/hardlink")),
    (r) => writeFileSync(join(r, "files/bad\n"), "x"),
    (r) => { rmSync(join(r, "files"), { recursive: true }); symlinkSync(".", join(r, "files")); },
    (r) => { for (let n = 0; n < 51; n++) writeFileSync(join(r, `files/f${n}`), "x"); },
  ]) { const root = fixture(t); add(root); assert.throws(() => verifyArtifact(root, context, plan)); }
  const root = fixture(t); writeFileSync(join(root, "files/data"), "12345");
  assert.throws(() => verifyArtifact(root, context, plan, { maxBytes: 4 }), /bound/i);
  assert.throws(() => verifyArtifact(root, context, plan, { npmPackage: true }), /one packed/i);
});
test("tag reservation creates only the exact immutable ref and refuses collisions or wrong responses", async () => {
  const calls = [];
  const send = async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ ref: `refs/tags/v${plan.version}`,
    object: { type: "commit", sha: context.sha } }), { status: 201 }); };
  await reserveTag(context, plan.version, "token", send);
  assert.equal(calls[0].url, "https://api.github.com/repos/unset-sh/example/git/refs");
  assert.equal(calls[0].options.method, "POST"); assert.equal(calls[0].options.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].options.body), { ref: `refs/tags/v${plan.version}`, sha: context.sha });
  for (const response of [new Response("{}", { status: 422 }), new Response("{}", { status: 201 })]) {
    await assert.rejects(() => reserveTag(context, plan.version, "token", async () => response));
  }
});
