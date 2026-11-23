import { createHash } from "node:crypto";

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).sort().join(",") === [...expected].sort().join(",");
const matches = (pattern, value) => typeof value === "string" && pattern.exec(value)?.[0] === value;
const text = (value, maximum = 2048) => typeof value === "string" && value.trim() === value && value.length > 0 &&
  value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
const fail = message => { throw new Error(message); };
export const policyPath = value => text(value, 240) && value.split("/").length <= 12 && value.split("/").every(part =>
  matches(/^[A-Za-z0-9._-]+$/, part) && ![".", "..", ".git"].includes(part.toLowerCase()));
const identity = ({ kind, path, key, reference }) => JSON.stringify([kind, path, key ?? null, reference ?? null]);
const list = (value, validator, maximum) => Array.isArray(value) && value.length <= maximum && value.every(validator) &&
  new Set(value.map(item => item.toLowerCase())).size === value.length;
const manifestPath = value => policyPath(value) && (value === "package.json" || value.endsWith("/package.json"));
const actionPath = value => policyPath(value) && /(?:^|\/)action\.ya?ml$/.test(value);

export function validatePolicyConfig(value) {
  if (!keys(value, ["schemaVersion", "dependencyManifests", "actionDefinitions", "kit", "artifactPaths", "exceptions"]) ||
    value.schemaVersion !== 1 || !list(value.dependencyManifests, manifestPath, 200) ||
    !list(value.actionDefinitions, actionPath, 200) || !["if-present", "required"].includes(value.kit) ||
    !list(value.artifactPaths, path => typeof path === "string" && path.endsWith("/") && policyPath(path.slice(0, -1)), 50) ||
    !Array.isArray(value.exceptions) || value.exceptions.length > 500 || Buffer.byteLength(JSON.stringify(value)) > 64 * 1024) {
    fail("Invalid repository policy configuration");
  }
  const seen = new Set();
  for (const exception of value.exceptions) {
    const fields = exception?.kind === "artifact" ? ["kind", "path", "reason"] : exception?.kind === "workflow" ?
      ["kind", "path", "reference", "reason"] : exception?.kind === "dependency" ?
        ["kind", "path", "key", "reference", "reason"] : [];
    if (!fields.length || !keys(exception, fields) || !policyPath(exception.path) || !text(exception.reason, 1000) ||
      (exception.kind !== "artifact" && !text(exception.reference)) ||
      (exception.kind === "dependency" && (!manifestPath(exception.path) || !text(exception.key) ||
        !/^(dependencies|devDependencies|optionalDependencies)\.[@A-Za-z0-9_./-]+$/.test(exception.key)))) {
      fail("Invalid repository policy exception configuration");
    }
    const id = identity(exception);
    if (seen.has(id)) fail("Duplicate repository policy exception");
    seen.add(id);
  }
  return structuredClone(value);
}

function exactVersion(value) {
  const match = typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?(?:\+([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*))?$/.exec(value);
  return Boolean(match && match[0] === value && (!match[4] || match[4].split(".").every(part => !/^0\d+$/.test(part))));
}

function pinnedDependency(value) {
  if (exactVersion(value)) return true;
  const alias = /^npm:((?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+)@(.+)$/.exec(value);
  if (alias && alias[0] === value) return exactVersion(alias[2]);
  return matches(/^(?:github:|git\+https:\/\/github\.com\/)[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+(?:\.git)?#[0-9a-f]{40}$/, value);
}

export function dependencyFindings(path, manifest) {
  if (!object(manifest)) fail("Invalid dependency manifest");
  const findings = [];
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const values = Object.hasOwn(manifest, field) ? manifest[field] : {};
    if (!object(values) || Object.keys(values).length > 2000) fail("Invalid dependency manifest field");
    for (const [name, reference] of Object.entries(values)) {
      if (!text(name, 214) || !text(reference)) fail("Invalid dependency manifest reference");
      if (!pinnedDependency(reference)) findings.push({ kind: "dependency", path, key: `${field}.${name}`, reference });
    }
  }
  return findings;
}

export function artifactFindings(paths, repository, additional) {
  const prefixes = [...(repository === "unset-sh/agent-kit" ? [] : ["notes/", "artifacts/"]), ...additional];
  return paths.filter(path => prefixes.some(prefix => path.startsWith(prefix)))
    .map(path => ({ kind: "artifact", path }));
}

export function applyPolicyExceptions(findings, exceptions) {
  const used = new Set();
  const remaining = findings.filter(finding => {
    const index = exceptions.findIndex(exception => identity(exception) === identity(finding));
    if (index < 0) return true;
    used.add(index);
    return false;
  });
  if (used.size !== exceptions.length) fail("Unused repository policy exception; remove stale exceptions");
  return remaining;
}

// Lock schema and reserved paths follow agent-kit sync.mjs; this checker never executes that consumer file.
// https://github.com/unset-sh/agent-kit/blob/a98152cd5391ffd84776dc7c5eee7ff3994d5e57/sync.mjs
export function kitOwnedPath(path) {
  const parts = path.split("/");
  const orgName = name => /^org-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name ?? "");
  return parts[0] === ".claude" && ((parts[1] === "agent-kit" && parts.length >= 3) ||
    (parts[1] === "rules" && parts[2] === "org" && parts.length >= 4) ||
    (parts[1] === "skills" && orgName(parts[2]) && parts.length >= 4) ||
    (parts[1] === "agents" && parts.length === 3 && parts[2].startsWith("org-")));
}

export function kitFindings(files, mode) {
  const owned = [...files.keys()].filter(kitOwnedPath).sort();
  const lockPath = ".claude/agent-kit/lock.json";
  if (mode === "if-present" && !owned.length) return [];
  const bytes = files.get(lockPath);
  if (!bytes || bytes.length > 1024 * 1024) fail("Missing or oversized installed kit lock");
  let lock;
  try { lock = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { fail("Invalid installed kit lock JSON"); }
  if (!keys(lock, ["kit", "version", "commit", "bundleSha256", "files"]) || lock.kit !== "unset-sh/agent-kit" ||
    !matches(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, lock.version) ||
    !matches(/^[0-9a-f]{40}$/, lock.commit) || !matches(/^[0-9a-f]{64}$/, lock.bundleSha256) ||
    !object(lock.files) || Object.keys(lock.files).length > 500 || !Object.hasOwn(lock.files, ".claude/agent-kit/sync.mjs")) {
    fail("Invalid installed kit lock schema");
  }
  const findings = [];
  let total = 0;
  for (const [path, hash] of Object.entries(lock.files).sort(([a], [b]) => a.localeCompare(b))) {
    if (!policyPath(path) || !kitOwnedPath(path) || path === lockPath || !matches(/^[0-9a-f]{64}$/, hash)) fail("Invalid installed kit lock file");
    const source = files.get(path);
    if (!source) findings.push({ kind: "kit", path, key: "missing" });
    else {
      total += source.length;
      if (source.length > 1024 * 1024 || total > 8 * 1024 * 1024) fail("Installed kit lock size limit exceeded");
      if (createHash("sha256").update(source).digest("hex") !== hash) findings.push({ kind: "kit", path, key: "changed" });
    }
  }
  for (const path of owned) if (path !== lockPath && !Object.hasOwn(lock.files, path)) findings.push({ kind: "kit", path, key: "unlisted" });
  return findings;
}
