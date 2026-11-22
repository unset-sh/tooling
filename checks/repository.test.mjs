// What this repository promises about itself: its CLAUDE.md, its changelog and its manifest.
import assert from "node:assert/strict";
import { test } from "node:test";
import { manifestProblems } from "../scripts/release-manifest.mjs";
import { notesFor, versionsIn } from "../scripts/release-notes.mjs";
import { readText } from "./repo.mjs";

const manifest = JSON.parse(readText("package.json"));

test("CLAUDE.md opens with where the repository fits", () => {
  const first = readText("CLAUDE.md").split("\n").find((line) => line.startsWith("## "));
  assert.equal(first, "## Where this repository fits");
});

test("the repository has no dependencies and is never published as a package", () => {
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    assert.equal(manifest[field], undefined, `package.json has ${field}`);
  }
  assert.equal(manifest.private, true);
});

test("the version is one the release workflow accepts", () => {
  assert.deepEqual(manifestProblems(manifest), []);
});

test("the newest changelog entry is the package version and says something", () => {
  // 0.0.0 means nothing is released yet, so there is no versioned entry to match.
  const changelog = readText("CHANGELOG.md");
  if (manifest.version === "0.0.0") {
    assert.deepEqual(versionsIn(changelog), []);
    return;
  }
  assert.equal(versionsIn(changelog)[0], manifest.version);
  assert.ok(notesFor(changelog, manifest.version).length > 40);
});

test("unreleased changes sit in one section above the released versions", () => {
  const headings = readText("CHANGELOG.md").split("\n").filter((line) => line.startsWith("## "));
  const unreleased = headings.filter((line) => line === "## Unreleased");
  assert.ok(unreleased.length <= 1, "one Unreleased section at most");
  if (unreleased.length === 1) assert.equal(headings[0], "## Unreleased", "Unreleased comes first");
});
