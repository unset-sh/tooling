// Root-only version preparation; never invoke npm version or lifecycle scripts.
// npm 11 lockfiles v2/v3 describe the root in both top-level fields and packages[""].
// https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/ (read 2026-11-23)
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { channelVersion, stableVersion } from "./release-channel.mjs";
import { manifestProblems } from "./release-manifest.mjs";
import { packedManifest, packedName } from "./release-package.mjs";
import { insist } from "./release-channel-error.mjs";

const DEPENDENCIES = ["dependencies", "optionalDependencies", "devDependencies", "peerDependencies"];
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const stagingVersion = (value) => typeof value === "string" && value.length <= 128 &&
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-staging\.[1-9]\d{0,19}\.[1-9]\d{0,19}$/.exec(value)?.[0] === value;

function dependencies(manifest, context) {
  insist(manifest.bundleDependencies === undefined && manifest.bundledDependencies === undefined, "Bundled dependencies are not supported by channel releases");
  for (const field of DEPENDENCIES) {
    if (manifest[field] === undefined) continue;
    insist(object(manifest[field]), `Invalid dependency block ${field}`);
    for (const [name, version] of Object.entries(manifest[field])) {
      insist(stableVersion(version) || (context.channel === "staging" && name.startsWith("@unset-sh/") && stagingVersion(version)),
        `Invalid or prerelease dependency selection in ${field}`);
    }
  }
}

function packageIdentity(manifest, context, expectedVersion) {
  insist(object(manifest) && manifest.version === expectedVersion, "Package version differs from reviewed source");
  insist(manifest.workspaces === undefined, "Workspace packages are not supported by channel releases");
  dependencies(manifest, context);
  // Reuse legacy package/registry guards without broadening their accepted versions.
  const normalized = structuredClone(manifest);
  normalized.version = expectedVersion.split("-staging.")[0];
  for (const field of ["dependencies", "optionalDependencies"]) {
    if (normalized[field]) for (const name of Object.keys(normalized[field])) normalized[field][name] = normalized[field][name].split("-staging.")[0];
  }
  const problems = manifestProblems(normalized, { npmPackage: true });
  insist(problems.length === 0, "Invalid publishable manifest; check package identity and registry settings");
}

export function preparePackage({ manifest, lock, context, npmPackage = false, install = false }) {
  insist(object(manifest), "Invalid source manifest");
  const version = channelVersion(manifest.version, context);
  if (version === null) return { version: null, manifest, lock };
  insist(manifest.workspaces === undefined, "Workspace packages are not supported by channel releases");
  dependencies(manifest, context);
  if (npmPackage) packageIdentity(manifest, context, manifest.version);
  if (install || (npmPackage && DEPENDENCIES.some((field) => Object.keys(manifest[field] ?? {}).length > 0))) {
    insist(lock !== null && lock !== undefined, "Installation or package dependencies require a root package lock");
  }
  if (lock !== null && lock !== undefined) {
    insist(object(lock) && [2, 3].includes(lock.lockfileVersion) && lock.name === manifest.name && lock.version === manifest.version &&
      object(lock.packages) && object(lock.packages[""]) && lock.packages[""].name === manifest.name &&
      lock.packages[""].version === manifest.version && lock.packages[""].workspaces === undefined, "Inconsistent or unsupported root package lock");
    for (const field of DEPENDENCIES) insist(isDeepStrictEqual(lock.packages[""][field], manifest[field]), "Root lock dependency declarations differ from source");
    const entries = Object.entries(lock.packages);
    insist(entries.length <= 10000, "Package lock has too many entries");
    for (const [path, entry] of entries) {
      insist(object(entry) && !entry.link && (path === "" || path.startsWith("node_modules/")), "Unsupported linked or workspace package lock entry");
      if (path === "") continue;
      insist(stableVersion(entry.version) || (context.channel === "staging" &&
        /(?:^|\/)node_modules\/@unset-sh\/[^/]+$/.test(path) && stagingVersion(entry.version)), "Package lock selects an invalid or prerelease dependency");
    }
  }
  const transformed = structuredClone(manifest);
  transformed.version = version;
  const transformedLock = lock == null ? null : structuredClone(lock);
  if (transformedLock) { transformedLock.version = version; transformedLock.packages[""].version = version; }
  return { version, manifest: transformed, lock: transformedLock };
}

export function regularJson(path, limit = 1024 * 1024, missing = false) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat && missing) return null;
  insist(stat?.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= limit, "Expected bounded regular unlinked JSON file");
  const bytes = readFileSync(path);
  insist(bytes.length <= limit, "JSON file exceeds size bound");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("Invalid UTF-8 JSON data"); }
}

export function prepareCheckout(root, options) {
  insist(isAbsolute(root) && realpathSync(root) === resolve(root), "Checkout root must not have symbolic link ancestors");
  insist(!lstatSync(join(root, "npm-shrinkwrap.json"), { throwIfNoEntry: false }), "npm-shrinkwrap.json is not supported by channel releases");
  const result = preparePackage({ ...options, manifest: regularJson(join(root, "package.json")),
    lock: regularJson(join(root, "package-lock.json"), 16 * 1024 * 1024, true) });
  if (result.version === null) return result;
  writeFileSync(join(root, "package.json"), `${JSON.stringify(result.manifest, null, 2)}\n`);
  if (result.lock) writeFileSync(join(root, "package-lock.json"), `${JSON.stringify(result.lock, null, 2)}\n`);
  return result;
}

export function verifyChannelPackage(bytes, filename, expected, context) {
  const actual = packedManifest(bytes, { checkEntry(path) {
    const parts = path.toLowerCase().split("/");
    insist(!parts.includes("npm-shrinkwrap.json") && !parts.includes("node_modules"), "Packed shrinkwrap or bundled dependencies are not supported");
  } });
  packageIdentity(actual, context, expected.version);
  insist(isDeepStrictEqual(actual, expected), "Packed package manifest differs from the committed source and channel version");
  insist(filename === packedName(expected.name, expected.version), "Packed package filename differs from its identity");
  return actual;
}
