// The scripts are started by the release workflow as commands, so they are tested as commands: by real path
// and through a symbolic link, where a script that compares paths as typed does nothing and exits 0.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { REGISTRY } from "../scripts/release-manifest.mjs";
import { rootPath } from "./repo.mjs";
import { entry, packed } from "./tarball.mjs";

const scripts = join(rootPath, "scripts");

function scratch() {
  return realpathSync(mkdtempSync(join(tmpdir(), "cli-")));
}

function run(script, args, { through = scripts } = {}) {
  return spawnSync(process.execPath, [join(through, script), ...args], { encoding: "utf8" });
}

/** The scripts folder, reached through a symbolic link. */
function linkedScripts() {
  const link = join(scratch(), "linked");
  symlinkSync(scripts, link);
  return link;
}

function write(name, value) {
  const file = join(scratch(), name);
  writeFileSync(file, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value));
  return file;
}

const bareEnvironment = write("environment.json", { name: "release", protection_rules: [], deployment_branch_policy: null });
const noPolicies = write("policies.json", {});

test("release-gate exits 1 on an unprotected environment, also through a link", () => {
  for (const through of [scripts, linkedScripts()]) {
    const result = run("release-gate.mjs", [bareEnvironment, noPolicies], { through });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /required reviewer/);
    assert.match(result.stderr, /Nothing was built or published/);
  }
});

test("release-gate exits 0 only on the owner's environment", () => {
  const environment = write("environment.json", {
    protection_rules: [{ type: "required_reviewers", prevent_self_review: false, reviewers: [{ type: "User", reviewer: { login: "Undefined6799" } }] }],
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    can_admins_bypass: false,
  });
  const policies = write("policies.json", { branch_policies: [{ name: "main", type: "branch" }] });
  const result = run("release-gate.mjs", [environment, policies]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /only Undefined6799 approves/);
});

test("release-gate fails on a file that is missing or not JSON", () => {
  assert.notEqual(run("release-gate.mjs", [join(scratch(), "absent.json"), noPolicies]).status, 0);
  assert.notEqual(run("release-gate.mjs", [write("broken.json", "{"), noPolicies]).status, 0);
  assert.notEqual(run("release-gate.mjs", []).status, 0);
});

test("release-manifest prints the version and nothing else, also through a link", () => {
  const manifest = write("package.json", { name: "@unset-sh/brand", version: "1.4.0" });
  for (const through of [scripts, linkedScripts()]) {
    const result = run("release-manifest.mjs", [manifest], { through });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "1.4.0\n");
  }
});

test("release-manifest exits 1 and prints no version when the manifest may not be released", () => {
  const loose = write("package.json", { name: "@unset-sh/brand", version: "1.4.0-rc.1" });
  const result = run("release-manifest.mjs", [loose]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  const notAPackage = write("package.json", { name: "@unset-sh/brand", version: "1.4.0", private: true });
  assert.equal(run("release-manifest.mjs", [notAPackage]).status, 0);
  const asPackage = run("release-manifest.mjs", [notAPackage, "--npm-package"]);
  assert.equal(asPackage.status, 1);
  assert.equal(asPackage.stdout, "");
  assert.match(asPackage.stderr, /private/);
  assert.notEqual(run("release-manifest.mjs", [join(scratch(), "absent.json")]).status, 0);
});

test("release-manifest --name prints a package's name, and only when it is checked as a package", () => {
  const manifest = write("package.json", { name: "@unset-sh/brand", version: "1.4.0", publishConfig: { registry: REGISTRY } });
  for (const through of [scripts, linkedScripts()]) {
    const result = run("release-manifest.mjs", [manifest, "--npm-package", "--name"], { through });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "@unset-sh/brand\n");
  }
  const unchecked = run("release-manifest.mjs", [manifest, "--name"]);
  assert.equal(unchecked.status, 1);
  assert.equal(unchecked.stdout, "");
  const proxied = write("package.json", { name: "@unset-sh/brand", version: "1.4.0", publishConfig: { registry: REGISTRY, proxy: "http://127.0.0.1" } });
  const refused = run("release-manifest.mjs", [proxied, "--npm-package", "--name"]);
  assert.equal(refused.status, 1);
  assert.equal(refused.stdout, "");
  assert.match(refused.stderr, /may set only "registry"/);
  assert.equal(run("release-manifest.mjs", []).status, 1);
  assert.equal(run("release-manifest.mjs", [manifest, manifest]).status, 1);
});

test("release-package exits 0 only on the package main describes, also through a link", () => {
  const good = { name: "@unset-sh/brand", version: "1.4.0", publishConfig: { registry: REGISTRY } };
  const file = write("unset-sh-brand-1.4.0.tgz", packed(entry("package/package.json", good)));
  for (const through of [scripts, linkedScripts()]) {
    const result = run("release-package.mjs", [file, "@unset-sh/brand", "1.4.0"], { through });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /@unset-sh\/brand@1\.4\.0/);
    const other = run("release-package.mjs", [file, "@unset-sh/brand", "1.4.1"], { through });
    assert.equal(other.status, 1);
    assert.equal(other.stdout, "");
    assert.match(other.stderr, /version is 1\.4\.0, but package\.json on main says 1\.4\.1/);
    assert.match(other.stderr, /Nothing was published/);
  }
});

test("release-package exits 1 on settings in the package, a wrong file name, a broken archive and a missing argument", () => {
  const proxied = { name: "@unset-sh/brand", version: "1.4.0", publishConfig: { registry: REGISTRY, "https-proxy": "http://127.0.0.1:18080", "strict-ssl": false } };
  const settings = run("release-package.mjs", [write("unset-sh-brand-1.4.0.tgz", packed(entry("package/package.json", proxied))), "@unset-sh/brand", "1.4.0"]);
  assert.equal(settings.status, 1);
  assert.match(settings.stderr, /"https-proxy", "strict-ssl"/);
  const good = packed(entry("package/package.json", { ...proxied, publishConfig: { registry: REGISTRY } }));
  const renamed = run("release-package.mjs", [write("brand.tgz", good), "@unset-sh/brand", "1.4.0"]);
  assert.equal(renamed.status, 1);
  assert.match(renamed.stderr, /not named unset-sh-brand-1\.4\.0\.tgz/);
  const broken = run("release-package.mjs", [write("unset-sh-brand-1.4.0.tgz", "not an archive"), "@unset-sh/brand", "1.4.0"]);
  assert.equal(broken.status, 1);
  assert.match(broken.stderr, /not one gzip stream/);
  const file = write("unset-sh-brand-1.4.0.tgz", good);
  assert.equal(run("release-package.mjs", [join(scratch(), "absent.tgz"), "@unset-sh/brand", "1.4.0"]).status, 1);
  assert.equal(run("release-package.mjs", [file, "@unset-sh/brand"]).status, 1);
  assert.equal(run("release-package.mjs", [file, "@unset-sh/brand", "1.4.0", "extra"]).status, 1);
  assert.equal(run("release-package.mjs", []).status, 1);
});

test("release-notes prints the entry, and exits 1 with no output when there is none", () => {
  const changelog = write("CHANGELOG.md", "# Changelog\n\n## v0.1.0\n\nFirst.\n");
  for (const through of [scripts, linkedScripts()]) {
    const result = run("release-notes.mjs", [changelog, "0.1.0"], { through });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "First.\n");
  }
  const missing = run("release-notes.mjs", [changelog, "0.2.0"]);
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, "");
  assert.equal(run("release-notes.mjs", [changelog]).status, 1);
  assert.equal(run("release-notes.mjs", [join(scratch(), "absent.md"), "0.1.0"]).status, 1);
});

test("release-files exits 1 on a bad folder or a wrong command, also through a link", () => {
  const base = scratch();
  for (const through of [scripts, linkedScripts()]) {
    assert.equal(run("release-files.mjs", ["collect", base, "absent", join(base, "out")], { through }).status, 1);
    assert.equal(run("release-files.mjs", ["list", join(base, "absent")], { through }).status, 1);
    assert.equal(run("release-files.mjs", ["list"], { through }).status, 1);
    assert.equal(run("release-files.mjs", [], { through }).status, 1);
  }
  const empty = run("release-files.mjs", ["list", base]);
  assert.equal(empty.status, 0);
  assert.equal(empty.stdout, "");
});
