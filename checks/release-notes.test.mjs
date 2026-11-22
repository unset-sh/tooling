// The release notes are one version's changelog entry, and a release without one does not go out.
import assert from "node:assert/strict";
import { test } from "node:test";
import { notesFor, versionsIn } from "../scripts/release-notes.mjs";

const changelog = "# Changelog\n\n## Unreleased\n\nNext.\n\n## v0.2.0\n\nSecond.\n\n### Detail\n\nMore.\n\n## v0.1.0\n\nFirst.\n\n## v0.0.1\n\n";

test("the notes are the entry of that version, up to the next entry", () => {
  assert.equal(notesFor(changelog, "0.2.0"), "Second.\n\n### Detail\n\nMore.\n");
  assert.equal(notesFor(changelog, "0.1.0"), "First.\n");
});

test("a version with no entry, or an empty one, is an error", () => {
  assert.throws(() => notesFor(changelog, "0.3.0"), /no entry/);
  assert.throws(() => notesFor(changelog, "0.0.1"), /is empty/);
  assert.throws(() => notesFor(changelog, "0.2"), /no entry/);
  assert.throws(() => notesFor("", "0.1.0"), /no entry/);
});

test("the unreleased section is never a version's notes", () => {
  assert.throws(() => notesFor(changelog, "Unreleased"), /no entry/);
});

test("the versions with an entry are listed newest first, as written", () => {
  assert.deepEqual(versionsIn(changelog), ["0.2.0", "0.1.0", "0.0.1"]);
});
