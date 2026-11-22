// What a package.json must say before a release is planned from it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { REGISTRY, manifestProblems } from "../scripts/release-manifest.mjs";

function packageManifest(overrides = {}) {
  return {
    name: "@unset-sh/brand",
    version: "1.4.0",
    publishConfig: { registry: REGISTRY },
    dependencies: { "@unset-sh/tokens": "0.2.0" },
    ...overrides,
  };
}

test("a version of three plain numbers is accepted", () => {
  for (const version of ["0.0.0", "0.1.0", "1.4.0", "10.20.30"]) {
    assert.deepEqual(manifestProblems({ version }), [], version);
  }
});

test("a version that is missing, loose, or would make an odd tag is refused", () => {
  for (const version of [undefined, 1, "", "1.0", "v1.0.0", "1.0.0-rc.1", "1.0.0+build", "01.0.0", "1.0.0 ", "1.0.0\n", "1.0.0;id", "../1.0.0"]) {
    assert.match(manifestProblems({ version }).join("\n"), /three plain numbers/, JSON.stringify(version));
  }
});

test("something that is not a manifest is refused", () => {
  for (const manifest of [null, [], "1.0.0", 3]) {
    assert.deepEqual(manifestProblems(manifest), ["package.json is not an object"]);
  }
});

test("without --npm-package only the version is looked at", () => {
  assert.deepEqual(manifestProblems({ version: "1.0.0", private: true, dependencies: { left: "^1.0.0" } }), []);
});

test("a package in the organisation's scope, for GitHub Packages, with exact dependencies passes", () => {
  assert.deepEqual(manifestProblems(packageManifest(), { npmPackage: true }), []);
  assert.deepEqual(manifestProblems(packageManifest({ dependencies: undefined }), { npmPackage: true }), []);
});

test("a package outside the scope is refused", () => {
  for (const name of [undefined, "brand", "@other/brand", "@unset-sh/", "@unset-sh/Brand", "@unset-sh/a/b", "x@unset-sh/brand"]) {
    assert.match(manifestProblems(packageManifest({ name }), { npmPackage: true }).join("\n"), /scope/, String(name));
  }
});

test("a private package is refused", () => {
  assert.match(manifestProblems(packageManifest({ private: true }), { npmPackage: true }).join("\n"), /private/);
});

test("a package that could be published anywhere but GitHub Packages is refused", () => {
  for (const publishConfig of [undefined, {}, { registry: "https://registry.npmjs.org" }, { registry: `${REGISTRY}/` }]) {
    assert.match(manifestProblems(packageManifest({ publishConfig }), { npmPackage: true }).join("\n"), /publishConfig/);
  }
});

test("a package that sets anything but the registry under publishConfig is refused: npm reads it all as settings", () => {
  for (const extra of [{ "https-proxy": "http://127.0.0.1:18080" }, { "strict-ssl": false }, { ca: "x" }, { access: "public" }, { tag: "next" }]) {
    const problems = manifestProblems(packageManifest({ publishConfig: { registry: REGISTRY, ...extra } }), { npmPackage: true });
    assert.equal(problems.length, 1, JSON.stringify(extra));
    assert.match(problems[0], /may set only "registry"/);
    assert.ok(problems[0].includes(JSON.stringify(Object.keys(extra)[0])));
  }
  assert.deepEqual(manifestProblems({ version: "1.0.0", publishConfig: { proxy: "x" } }), [], "only looked at for a package");
});

test("a dependency that is not one released, exact version is refused", () => {
  for (const range of ["^1.0.0", "~1.0.0", "1.x", "*", "latest", ">=1.0.0", "github:unset-sh/brand#4e60b99", "file:../brand", "1.0.0-rc.1", 1]) {
    for (const field of ["dependencies", "optionalDependencies"]) {
      const problems = manifestProblems(packageManifest({ [field]: { left: range } }), { npmPackage: true });
      assert.match(problems.join("\n"), /left is .* not one released, exact version/, `${field} ${range}`);
    }
  }
});

test("dependencies that are not an object are refused, not skipped", () => {
  for (const dependencies of [null, [], "left"]) {
    assert.match(manifestProblems(packageManifest({ dependencies }), { npmPackage: true }).join("\n"), /"dependencies" is not an object/);
  }
});

test("development and peer dependencies may be ranges: a consumer's install does not resolve them from here", () => {
  const manifest = packageManifest({ devDependencies: { typescript: "^7.0.0" }, peerDependencies: { svelte: ">=5" } });
  assert.deepEqual(manifestProblems(manifest, { npmPackage: true }), []);
});
