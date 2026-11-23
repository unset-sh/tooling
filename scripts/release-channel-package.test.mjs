import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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
// A bun.lock as Bun 1.4.4 writes it: the root under workspaces[""] without its version, and each package as
// ["<name>@<version>", "<tarball URL or empty>", { ...metadata }, "<integrity>"].
const lock = (m = manifest()) => ({ lockfileVersion: 2, configVersion: 1,
  workspaces: { "": { name: m.name, dependencies: m.dependencies, devDependencies: m.devDependencies } },
  packages: { "@unset-sh/brand": ["@unset-sh/brand@0.1.0", "", {}, "sha512-test"],
    typescript: ["typescript@6.0.0", "", { bin: { tsc: "bin/tsc" } }, "sha512-test"] } });
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

test("staging changes only the root package version, leaving the lock and every selected dependency as they are", () => {
  // bun.lock does not record the root's version, so the lock needs no change for the staging version.
  const original = manifest(); const originalLock = lock(original);
  const result = prepare(original, originalLock);
  assert.equal(result.version, "1.4.0-staging.12345.2");
  assert.deepEqual(result.manifest, { ...original, version: "1.4.0-staging.12345.2" });
  assert.deepEqual(result.lock, lock(original));
  assert.equal(original.version, "1.4.0");
  assert.deepEqual(prepare(manifest(), lock(), stable).manifest, manifest());
});

test("staging can select exact organisation prereleases while stable refuses direct or transitive prereleases", () => {
  const m = manifest(); m.dependencies["@unset-sh/brand"] = "0.2.0-staging.987.1";
  const l = lock(m); l.packages["@unset-sh/brand"][0] = "@unset-sh/brand@0.2.0-staging.987.1";
  assert.doesNotThrow(() => prepare(m, l));
  assert.throws(() => prepare(m, l, stable), /dependency|prerelease/i);
  const transitive = lock(); transitive.packages.typescript[0] = "typescript@6.0.0-rc.1";
  assert.throws(() => prepare(manifest(), transitive, stable), /lock|prerelease/i);
  for (const dependency of ["^1.0.0", "latest", "file:../other", "1.0.0\n", "1.0.0-staging.01.1"]) {
    const changed = manifest(); changed.dependencies["@unset-sh/brand"] = dependency;
    assert.throws(() => prepare(changed, lock(changed)), /dependency/i);
  }
  const thirdParty = manifest(); thirdParty.devDependencies.typescript = "6.0.0-staging.1.1";
  assert.throws(() => prepare(thirdParty, lock(thirdParty)), /dependency/i);
});

test("inconsistent locks, workspaces, linked packages and unsupported lock formats fail before transformation", () => {
  const base = lock();
  for (const changed of [{ ...base, lockfileVersion: 1 }, { ...base, lockfileVersion: 3 }, { ...base, packages: [] },
    { ...base, workspaces: { "": { ...base.workspaces[""], name: "@unset-sh/other" } } },
    { ...base, workspaces: { ...base.workspaces, "packages/local": { name: "local" } } },
    { ...base, overrides: { typescript: "6.0.1" } }, { ...base, patchedDependencies: { "typescript@6.0.0": "patches/t.patch" } },
    { ...base, packages: { ...base.packages, local: ["local@workspace:packages/local", ""] } },
    { ...base, packages: { ...base.packages, linked: ["linked@link:../linked", ""] } },
    { ...base, packages: { ...base.packages, filed: ["filed@file:../filed.tgz", ""] } },
    { ...base, packages: { ...base.packages, gitted: ["gitted@github:owner/gitted#0123456", ""] } },
    { ...base, packages: { ...base.packages, renamed: ["other@1.0.0", "", {}, "sha512-test"] } },
    { ...base, packages: { ...base.packages, broken: { version: "1.0.0" } } }]) {
    assert.throws(() => prepare(manifest(), changed), /lock|linked/i, JSON.stringify(changed).slice(0, 160));
  }
  assert.doesNotThrow(() => prepare(manifest(), { ...base, packages: { ...base.packages, "typescript/nested": ["nested@1.0.0", "", {}, "sha512-test"], "a/b/nested": ["nested@1.0.1", "", {}, "sha512-test"] } }));
  assert.throws(() => prepare({ ...manifest(), workspaces: ["packages/*"] }), /workspace/i);
  assert.throws(() => prepare(manifest(), null), /lock/i);
  assert.throws(() => preparePackage({ manifest: manifest(), lock: null, context: stable, npmPackage: true }), /lock/i);
  assert.throws(() => prepare({ ...manifest(), bundleDependencies: ["@unset-sh/brand"] }), /bundl/i);
  const altered = lock(); altered.workspaces[""].dependencies = { "@unset-sh/brand": "0.2.0" };
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

/** Runs Bun without blocking, so a registry served from this process can answer it. */
function bunRun(args, options) {
  return new Promise((done) => {
    execFile(process.execPath, args, { ...options, encoding: "utf8" }, (error, stdout, stderr) => done({ status: error ? (error.code ?? 1) : 0, stdout, stderr }));
  });
}

test("real bun install and bun pm pack use the transformed version without invoking scripts", async (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "channel-package-"));
  // One released dependency, served from this machine, so Bun writes a lock with a real package entry.
  const dependency = tarball([file("package/package.json", JSON.stringify({ name: "left-pad", version: "1.3.0" }))]);
  const integrity = `sha512-${createHash("sha512").update(dependency).digest("base64")}`;
  const registry = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/left-pad/-/left-pad-1.3.0.tgz") return new Response(dependency);
    if (url.pathname !== "/left-pad") return new Response("not found", { status: 404 });
    return Response.json({ name: "left-pad", "dist-tags": { latest: "1.3.0" }, time: { "1.3.0": "2020-01-01T00:00:00.000Z" },
      versions: { "1.3.0": { name: "left-pad", version: "1.3.0", dist: { tarball: `${url.origin}/left-pad/-/left-pad-1.3.0.tgz`, integrity } } } });
  } });
  t.after(() => { registry.stop(true); rmSync(root, { recursive: true, force: true }); });
  const m = { name: "@unset-sh/example", version: "1.4.0", publishConfig: { registry: "https://npm.pkg.github.com" },
    dependencies: { "left-pad": "1.3.0" }, scripts: { preinstall: "exit 7", prepare: "exit 7", prepack: "exit 7", version: "exit 7" } };
  writeFileSync(join(root, "package.json"), JSON.stringify(m));
  const env = { PATH: process.env.PATH, HOME: root, BUN_INSTALL_CACHE_DIR: join(root, "cache"), BUN_CONFIG_REGISTRY: `http://127.0.0.1:${registry.port}/` };
  // The lock as Bun writes it, before the version changes.
  const locked = await bunRun(["install", "--ignore-scripts", "--lockfile-only"], { cwd: root, env });
  assert.equal(locked.status, 0, locked.stderr);
  const result = prepareCheckout(root, { context: staging, npmPackage: true, install: true });
  assert.deepEqual(result.lock.packages["left-pad"].slice(0, 1), ["left-pad@1.3.0"]);
  for (const args of [["install", "--frozen-lockfile", "--ignore-scripts"], ["pm", "pack", "--ignore-scripts", "--quiet"]]) {
    const run = await bunRun(args, { cwd: root, env });
    assert.equal(run.status, 0, run.stderr);
  }
  const bytes = readFileSync(join(root, "unset-sh-example-1.4.0-staging.12345.2.tgz"));
  assert.equal(packedManifest(bytes).version, "1.4.0-staging.12345.2");
  verifyChannelPackage(bytes, "unset-sh-example-1.4.0-staging.12345.2.tgz", result.manifest, staging);
});

test("checkout preparation refuses npm lockfiles and linked lock data without modifying source", (t) => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "channel-source-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest()));
  // bun.lock ends entries with commas, which plain JSON refuses; the reader takes them.
  writeFileSync(join(root, "bun.lock"), `${JSON.stringify(lock(), null, 2).replace(/\n(\s*)([}\]])/g, ",\n$1$2")}\n`);
  for (const file of ["npm-shrinkwrap.json", "package-lock.json", "bun.lockb"]) {
    writeFileSync(join(root, file), "{}");
    assert.throws(() => prepareCheckout(root, { context: staging, npmPackage: true, install: true }), /not supported by channel releases; use bun\.lock/i, file);
    assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).version, "1.4.0");
    rmSync(join(root, file));
  }
  assert.equal(prepareCheckout(root, { context: staging, npmPackage: true, install: true }).version, "1.4.0-staging.12345.2");
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest()));
  rmSync(join(root, "bun.lock"));
  mkdirSync(join(root, "other")); writeFileSync(join(root, "other/lock.json"), JSON.stringify(lock()));
  symlinkSync("other/lock.json", join(root, "bun.lock"));
  assert.throws(() => prepareCheckout(root, { context: staging, npmPackage: true, install: true }), /regular|link/i);
});
