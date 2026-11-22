// Prints the changelog entry of one version, for the approval page and the release page.
//
//   node scripts/release-notes.mjs <CHANGELOG.md> <version>
//
// An entry starts at a line "## v<version>" and runs to the next "## " line. A release with no entry, or an
// empty one, fails here, so no release goes out without saying what changes for whoever takes it.

import { readFileSync } from "node:fs";
import { startedAsScript } from "./cli.mjs";

export function notesFor(changelog, version) {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## v${version}`);
  if (start === -1) throw new Error(`the changelog has no entry "## v${version}"`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  if (body === "") throw new Error(`the changelog entry for v${version} is empty`);
  return `${body}\n`;
}

/** The versions that have an entry, newest first as written. */
export function versionsIn(changelog) {
  return changelog
    .split("\n")
    .filter((line) => /^## v\d/.test(line))
    .map((line) => line.trim().slice(4));
}

if (startedAsScript(import.meta.url)) {
  const [file, version] = process.argv.slice(2);
  if (file === undefined || version === undefined) {
    console.error("usage: node scripts/release-notes.mjs <CHANGELOG.md> <version>");
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(notesFor(readFileSync(file, "utf8"), version));
    } catch (error) {
      console.error(`release notes: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
