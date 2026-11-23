import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { preparePackage, prepareCheckout, verifyChannelPackage } from "./release-channel-package.mjs";
import { packedManifest, packageProblems } from "./release-package.mjs";
import { channelFailure } from "./release-channel-error.mjs";
import { packed, entry as file } from "../checks/tarball.mjs";
const tarball = (parts) => packed(...parts);

const staging = { channel: "staging", runId: "12345", runAttempt: "2" };
const stable = { ...staging, channel: "stable" };
const manifest = () => ({ name: "@unset-sh/example", version: "1.4.0", publishConfig: { registry: "https://npm.pkg.github.com" },
  dependencies: { "@unset-sh/brand": "0.1.0" }, devDependencies: { typescript: "6.0.0" } });
const lock = (m = manifest(), lockfileVersion = 3) => ({ name: m.name, version: m.version, lockfileVersion, requires: true,
  packages: { "": { name: m.name, version: m.version, dependencies: m.dependencies, devDependencies: m.devDependencies },
    "node_modules/@unset-sh/brand": { version: "0.1.0", resolved: "https://npm.pkg.github.com/a.tgz", integrity: "sha512-test" },
    "node_modules/typescript": { version: "6.0.0", resolved: "https://registry.npmjs.org/typescript/-/typescript-6.0.0.tgz", integrity: "sha512-test", dev: true } } });
const prepare = (m = manifest(), l = lock(m), context = staging) => preparePackage({ manifest: m, lock: l, context, npmPackage: true, install: true });

test("publish manifest refusals never expose arbitrary configuration keys or values", () => {
  const changed = { ...manifest(), publishConfig: { registry: "https://npm.pkg.github.com", SECRET7: "PRIVATE_VALUE" } };
  assert.throws(() => prepare(changed, lock(changed)), (error) => {
    const message = channelFailure(error);
    assert.match(message, /Invalid publishable manifest/);
    assert.doesNotMatch(message, /SECRET7|PRIVATE_VALUE/);
    return true;
  });
});

test("staging changes only the root package and root lock versions while preserving every selected dependency", () => {
  for (const version of [2, 3]) {
    const original = manifest(); const originalLock = lock(original, version);
    const result = prepare(original, originalLock);
    assert.equal(result.version, "1.4.0-staging.12345.2");
    assert.deepEqual(result.manifest, { ...original, version: "1.4.0-staging.12345.2" });
    assert.deepEqual(result.lock, { ...originalLock, version: "1.4.0-staging.12345.2", packages: {
      ...originalLock.packages, "": { ...originalLock.packages[""], version: "1.4.0-staging.12345.2" } } });
    assert.equal(original.version, "1.4.0"); assert.equal(originalLock.packages[""].version, "1.4.0");
  }
  assert.deepEqual(prepare(manifest(), lock(), stable).manifest, manifest());
});

test("staging can select exact organisation prereleases while stable refuses direct or transitive prereleases", () => {
  const m = manifest(); m.dependencies["@unset-sh/brand"] = "0.2.0-staging.987.1";
  const l = lock(m); l.packages["node_modules/@unset-sh/brand"].version = "0.2.0-staging.987.1";
  assert.doesNotThrow(() => prepare(m, l));
  assert.throws(() => prepare(m, l, stable), /dependency|prerelease/i);
  const transitive = lock(); transitive.packages["node_modules/typescript"].version = "6.0.0-rc.1";
  assert.throws(() => prepare(manifest(), transitive, stable), /lock|prerelease/i);
  for (const dependency of ["^1.0.0", "latest", "file:../other", "1.0.0\n", "1.0.0-staging.01.1"]) {
    const changed = manifest(); changed.dependencies["@unset-sh/brand"] = dependency;
    assert.throws(() => prepare(changed, lock(changed)), /dependency/i);
  }
  const thirdParty = manifest(); thirdParty.devDependencies.typescript = "6.0.0-staging.1.1";
  assert.throws(() => prepare(thirdParty, lock(thirdParty)), /dependency/i);
});

test("inconsistent locks, workspaces, linked packages and unsupported lock formats fail before transformation", () => {
  for (const changed of [{ ...lock(), version: "1.5.0" }, { ...lock(), name: "@unset-sh/other" },
    { ...lock(), lockfileVersion: 1 }, { ...lock(), packages: {} },
    { ...lock(), packages: { ...lock().packages, "": { ...lock().packages[""], version: "1.3.0" } } },
    { ...lock(), packages: { ...lock().packages, "node_modules/local": { link: true, resolved: "packages/local" } } }]) {
    assert.throws(() => prepare(manifest(), changed), /lock|linked/i);
  }
  assert.throws(() => prepare({ ...manifest(), workspaces: ["packages/*"] }), /workspace/i);
  assert.throws(() => prepare(manifest(), null), /lock/i);
  assert.throws(() => preparePackage({ manifest: manifest(), lock: null, context: stable, npmPackage: true }), /lock/i);
  assert.throws(() => prepare({ ...manifest(), bundleDependencies: ["@unset-sh/brand"] }), /bundl/i);
  const altered = lock(); altered.packages[""].dependencies = { "@unset-sh/brand": "0.2.0" };
  assert.throws(() => prepare(manifest(), altered), /lock/i);
});

test("channel package validation preserves hostile archive and npm configuration refusals", () => {
  const expected = prepare().manifest;
  const good = tarball([file("package/package.json", JSON.stringify(expected))]);
  assert.doesNotThrow(() => verifyChannelPackage(good, "unset-sh-example-1.4.0-staging.12345.2.tgz", expected, staging));
  assert.ok(packageProblems(expected, { name: expected.name, version: expected.version }).length > 0, "Legacy validation still refuses prereleases");
  for (const changed of [{ ...expected, version: "1.4.0" }, { ...expected, name: "@unset-sh/other" },
    { ...expected, publishConfig: { ...expected.publishConfig, proxy: "https://bad.invalid" } },
    { ...expected, dependencies: { "@unset-sh/brand": "9.9.9" } }]) {
    assert.throws(() => verifyChannelPackage(tarball([file("package/package.json", JSON.stringify(changed))]),
      "unset-sh-example-1.4.0-staging.12345.2.tgz", expected, staging));
  }
  assert.throws(() => verifyChannelPackage(tarball([file("package/package.json", JSON.stringify(expected)),
    file("other/package.json", "{}")]), "unset-sh-example-1.4.0-staging.12345.2.tgz", expected, staging));
  assert.throws(() => verifyChannelPackage(good, "other.tgz", expected, staging), /name/i);
  for (const path of ["package/npm-shrinkwrap.json", "package/node_modules/hidden/package.json"]) {
    const bytes = tarball([file("package/package.json", JSON.stringify(expected)), file(path, "{}")]);
    assert.deepEqual(packedManifest(bytes), expected, "Legacy tar behavior is unchanged");
    assert.throws(() => verifyChannelPackage(bytes, "unset-sh-example-1.4.0-staging.12345.2.tgz", expected, staging), /shrinkwrap|bundl/i);
  }
});

test("real npm ci and pack use the transformed version without invoking scripts", (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "channel-package-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const m = { name: "@unset-sh/example", version: "1.4.0", publishConfig: { registry: "https://npm.pkg.github.com" },
    scripts: { preinstall: "exit 7", prepare: "exit 7", prepack: "exit 7", version: "exit 7" } };
  writeFileSync(join(root, "package.json"), JSON.stringify(m));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ name: m.name, version: m.version, lockfileVersion: 3,
    requires: true, packages: { "": { name: m.name, version: m.version } } }));
  const result = prepareCheckout(root, { context: staging, npmPackage: true, install: true });
  const env = { PATH: process.env.PATH, HOME: root, npm_config_cache: join(root, "cache"), npm_config_audit: "false", npm_config_fund: "false" };
  for (const args of [["ci", "--ignore-scripts"], ["pack", "--ignore-scripts", "--json"]]) {
    const run = spawnSync("npm", args, { cwd: root, env, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
  }
  const bytes = readFileSync(join(root, "unset-sh-example-1.4.0-staging.12345.2.tgz"));
  assert.equal(packedManifest(bytes).version, "1.4.0-staging.12345.2");
  verifyChannelPackage(bytes, "unset-sh-example-1.4.0-staging.12345.2.tgz", result.manifest, staging);
});

test("checkout preparation refuses shrinkwrap and linked manifest data without modifying source", (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "channel-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest()));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock()));
  writeFileSync(join(root, "npm-shrinkwrap.json"), "{}");
  assert.throws(() => prepareCheckout(root, { context: staging, npmPackage: true, install: true }), /shrinkwrap/i);
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).version, "1.4.0");
  rmSync(join(root, "npm-shrinkwrap.json"));
  rmSync(join(root, "package-lock.json"));
  mkdirSync(join(root, "other")); writeFileSync(join(root, "other/lock.json"), JSON.stringify(lock()));
  symlinkSync("other/lock.json", join(root, "package-lock.json"));
  assert.throws(() => prepareCheckout(root, { context: staging, npmPackage: true, install: true }), /regular|link/i);
});
