// Root-only version preparation; never invoke `bun pm version` or lifecycle scripts.
// bun.lock (lockfileVersion 2, as Bun 1.4.4 writes it) is JSON with trailing commas. It names the root under
// workspaces[""] with its name and dependency blocks but not its version, so raising the root version leaves
// the lock as it is and `bun install --frozen-lockfile` still accepts it (seen with Bun 1.4.4). Each entry of
// "packages" is an array whose first item is "<name>@<resolution>".
// https://bun.com/docs/install/lockfile (read 2026-11-23)
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

const LOCK_FIELDS = new Set(["lockfileVersion", "configVersion", "workspaces", "packages"]);

/** Refuses a bun.lock that is not the root's own, links or patches anything, or selects a version it may not. */
function checkLock(lock, manifest, context) {
  insist(object(lock) && lock.lockfileVersion === 2 && Object.keys(lock).every((field) => LOCK_FIELDS.has(field)) &&
    object(lock.workspaces) && Object.keys(lock.workspaces).length === 1 && object(lock.workspaces[""]) &&
    lock.workspaces[""].name === manifest.name && object(lock.packages), "Inconsistent or unsupported root package lock");
  for (const field of DEPENDENCIES) insist(isDeepStrictEqual(lock.workspaces[""][field], manifest[field]), "Root lock dependency declarations differ from source");
  const entries = Object.entries(lock.packages);
  insist(entries.length <= 10000, "Package lock has too many entries");
  for (const [key, entry] of entries) {
    insist(Array.isArray(entry) && typeof entry[0] === "string", "Unsupported linked or workspace package lock entry");
    const at = entry[0].lastIndexOf("@");
    const name = entry[0].slice(0, at);
    const selected = entry[0].slice(at + 1);
    insist(at > 0 && (key === name || key.endsWith(`/${name}`)), "Unsupported linked or workspace package lock entry");
    // A link, file, git or workspace resolution is not a version, so it fails here as well.
    insist(stableVersion(selected) || (context.channel === "staging" && name.startsWith("@unset-sh/") && stagingVersion(selected)),
      "Package lock selects an invalid or prerelease dependency");
  }
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
  if (lock !== null && lock !== undefined) checkLock(lock, manifest, context);
  const transformed = structuredClone(manifest);
  transformed.version = version;
  return { version, manifest: transformed, lock };
}

export function regularJson(path, limit = 1024 * 1024, missing = false, { trailingCommas = false } = {}) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat && missing) return null;
  insist(stat?.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= limit, "Expected bounded regular unlinked JSON file");
  const bytes = readFileSync(path);
  insist(bytes.length <= limit, "JSON file exceeds size bound");
  // bun.lock ends its entries with commas; Bun.JSONC reads that, and comments, and nothing else differs.
  try { const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); return trailingCommas ? Bun.JSONC.parse(text) : JSON.parse(text); }
  catch { throw new Error("Invalid UTF-8 JSON data"); }
}

export function prepareCheckout(root, options) {
  insist(isAbsolute(root) && realpathSync(root) === resolve(root), "Checkout root must not have symbolic link ancestors");
  for (const file of ["npm-shrinkwrap.json", "package-lock.json", "bun.lockb"]) {
    insist(!lstatSync(join(root, file), { throwIfNoEntry: false }), `${file} is not supported by channel releases; use bun.lock`);
  }
  const result = preparePackage({ ...options, manifest: regularJson(join(root, "package.json")),
    lock: regularJson(join(root, "bun.lock"), 16 * 1024 * 1024, true, { trailingCommas: true }) });
  if (result.version === null) return result;
  writeFileSync(join(root, "package.json"), `${JSON.stringify(result.manifest, null, 2)}\n`);
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
