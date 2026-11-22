// Reads the version a release would publish from a repository's package.json, and says what stops it.
//
//   node scripts/release-manifest.mjs <package.json> [--npm-package [--name]]
//
// Prints the version. The version becomes the tag v<version>, so only three plain numbers are accepted: no
// pre-release or build suffix until a repository needs one.
//
// With --npm-package the manifest is also checked as a package for GitHub Packages, and --name prints the
// package's name in place of the version:
//   - it is named in the organisation's scope and is not private;
//   - it names GitHub Packages as its registry and sets nothing else under "publishConfig". npm reads every
//     key there as one of its own settings when it publishes (npm 11.20.0 lib/commands/publish.js), a proxy
//     or a certificate included, so a publish can go nowhere else and through nothing else;
//   - every dependency a consumer would install is one released, exact version. A range, a tag or a commit
//     would let the same release resolve differently later, and the organisation's repositories meet only
//     through pinned versions.

import { readFileSync } from "node:fs";
import { startedAsScript } from "./cli.mjs";

export const SCOPE = "@unset-sh";
export const REGISTRY = "https://npm.pkg.github.com";

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Problems with the manifest, in plain words. An empty list means it may be released. */
export function manifestProblems(manifest, { npmPackage = false } = {}) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["package.json is not an object"];
  }
  const problems = [];
  if (typeof manifest.version !== "string" || !VERSION.test(manifest.version)) {
    problems.push('"version" must be three plain numbers, such as 1.4.0');
  }
  if (!npmPackage) return problems;
  if (typeof manifest.name !== "string" || !/^@unset-sh\/[a-z0-9][a-z0-9._-]*$/.test(manifest.name)) {
    problems.push(`"name" must be a package in the ${SCOPE} scope`);
  }
  if (manifest.private === true) problems.push('"private" is true, so npm would refuse to publish it');
  if (manifest.publishConfig?.registry !== REGISTRY) {
    problems.push(`"publishConfig.registry" must be ${REGISTRY}`);
  } else {
    const others = Object.keys(manifest.publishConfig).filter((key) => key !== "registry");
    if (others.length > 0) {
      problems.push(`"publishConfig" may set only "registry"; npm would read ${others.map((key) => JSON.stringify(key)).join(", ")} as its own settings`);
    }
  }
  for (const field of ["dependencies", "optionalDependencies"]) {
    const entries = manifest[field] === undefined ? {} : manifest[field];
    if (entries === null || typeof entries !== "object" || Array.isArray(entries)) {
      problems.push(`"${field}" is not an object`);
      continue;
    }
    for (const [name, range] of Object.entries(entries)) {
      if (typeof range !== "string" || !VERSION.test(range)) {
        problems.push(`${field}: ${name} is "${range}", not one released, exact version`);
      }
    }
  }
  return problems;
}

if (startedAsScript(import.meta.url)) {
  const args = process.argv.slice(2);
  const npmPackage = args.includes("--npm-package");
  const name = args.includes("--name");
  const files = args.filter((arg) => arg !== "--npm-package" && arg !== "--name");
  if (files.length !== 1 || (name && !npmPackage)) {
    // The name is only checked as a package's name, so it is only printed for one.
    console.error("usage: release-manifest.mjs <package.json> [--npm-package [--name]]");
    process.exitCode = 1;
  } else {
    const manifest = JSON.parse(readFileSync(files[0], "utf8"));
    const problems = manifestProblems(manifest, { npmPackage });
    for (const problem of problems) console.error(`package.json: ${problem}`);
    if (problems.length > 0) {
      process.exitCode = 1;
    } else {
      console.log(name ? manifest.name : manifest.version);
    }
  }
}
