import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const identity = { clientId: "Iv23fixture1234567890", appId: 123, slug: "fixture-automation", botId: 456, installationId: 789 };
const repository = "unset-sh/docs", token = "fixture-installation-token";
async function fixture(t, config = identity) {
  const root = mkdtempSync(join(tmpdir(), "automation-app-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  copyFileSync(new URL("./automation-app.mjs", import.meta.url), join(root, "automation-app.mjs"));
  copyFileSync(new URL("./cli.mjs", import.meta.url), join(root, "cli.mjs"));
  if (config !== null) writeFileSync(join(root, "automation-app.json"), JSON.stringify(config));
  return { root, module: await import(pathToFileURL(join(root, "automation-app.mjs"))) };
}
const response = (target = repository) => new Response(JSON.stringify({ total_count: 1,
  repositories: [{ id: 321, full_name: target, owner: { login: "unset-sh", type: "Organization" } }] }), { status: 200 });
const options = fetchImpl => ({ githubToken: token, repository, appSlug: identity.slug, installationId: String(identity.installationId), fetchImpl });

test("the fixed App identity bounds a one-repository token request and emits only its public client ID", async t => {
  const { root, module } = await fixture(t);
  let calls = 0;
  await module.assertAutomationAppToken(options(async (url, init) => {
    calls++;
    assert.equal(url, "https://api.github.com/installation/repositories?per_page=100");
    assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, `Bearer ${token}`); assert.ok(init.signal);
    return response();
  }));
  assert.equal(calls, 1);
  assert.deepEqual(module.automationApp.bot, { login: "fixture-automation[bot]", id: 456, type: "Bot" });
  assert.equal(module.automationApp.signoff, "Signed-off-by: fixture-automation[bot] <456+fixture-automation[bot]@users.noreply.github.com>");
  const output = join(root, "output");
  assert.equal(execFileSync(process.execPath, [join(root, "automation-app.mjs")], { env: { GITHUB_OUTPUT: output }, encoding: "utf8" }), "");
  const { readFileSync } = await import("node:fs");
  assert.equal(readFileSync(output, "utf8"), `client-id=${identity.clientId}\n`);
});

test("wrong action identity, missing token or an unapproved repository is rejected before network", async t => {
  const { module } = await fixture(t);
  for (const changes of [{ appSlug: "foreign" }, { installationId: "790" }, { installationId: "0789" },
    { repository: "unset-sh/tooling" }, { repository: "unset-sh/docs/../tooling" }, { githubToken: "" }, { githubToken: "x\ny" }]) {
    await assert.rejects(module.assertAutomationAppToken({ ...options(() => assert.fail("network must not run")), ...changes }), /App/);
  }
});

test("broader, wrong-owner, malformed or oversized repository lists are refused without credential diagnostics", async t => {
  const { module } = await fixture(t);
  const good = { total_count: 1, repositories: [{ id: 321, full_name: repository, owner: { login: "unset-sh", type: "Organization" } }] };
  for (const data of [{ ...good, total_count: 2 }, { ...good, repositories: [...good.repositories, ...good.repositories] },
    { ...good, repositories: [{ ...good.repositories[0], full_name: "unset-sh/.github" }] },
    { ...good, repositories: [{ ...good.repositories[0], owner: { login: "other", type: "Organization" } }] },
    { ...good, repositories: [{ ...good.repositories[0], id: -1 }] }, { secret: token }, "x".repeat(131073)]) {
    await assert.rejects(module.assertAutomationAppToken(options(async () => new Response(JSON.stringify(data)))), error => {
      assert.match(error.message, /App/); assert.ok(!error.message.includes(token)); return true;
    });
  }
  for (const fetchImpl of [async () => { throw new Error(token); }, async () => new Response(token, { status: 403 }),
    async () => new Response('{broken'), async () => new Response(null, { status: 200 })]) {
    await assert.rejects(module.assertAutomationAppToken(options(fetchImpl)), error => !error.message.includes(token));
  }
});

test("a missing or malformed production identity stays dormant and never performs token reads", async t => {
  for (const config of [null, { ...identity, clientId: "unsafe\noutput" }, { ...identity, botId: 0 }, { ...identity, slug: "../other" }, { ...identity, arbitrary: true }]) {
    const { module } = await fixture(t, config);
    await assert.rejects(module.assertAutomationAppToken(options(() => assert.fail("network must not run"))), /App/);
  }
});
