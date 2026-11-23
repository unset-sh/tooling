import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { policyPath } from "./repository-policy-data.mjs";

export const SCANNER_VERSION = "1.32.0";
const fail = () => { throw new Error("Action pin scanner failed or returned invalid diagnostics"); };
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

// JSON-v1 is the scanner's parsed representation, not a text search through YAML.
// https://github.com/zizmorcore/zizmor/blob/v1.32.0/crates/zizmor/src/output/json/v1.rs
export function normalizePinFindings(value, paths) {
  if (!Array.isArray(value) || value.length > 10000) fail();
  const findings = [];
  for (const item of value) {
    if (!object(item) || typeof item.ident !== "string") fail();
    if (!["unpinned-uses", "unpinned-images"].includes(item.ident)) continue;
    if (!Array.isArray(item.locations) || item.locations.length > 100) fail();
    const primary = item.locations.filter(location => location?.symbolic?.kind === "Primary");
    if (primary.length !== 1) fail();
    const { symbolic, concrete } = primary[0];
    const route = symbolic.route?.route;
    if (!Array.isArray(route) || !route.length || route.length > 30 || route.some(part => !object(part) ||
      Object.keys(part).length !== 1 || !(typeof part.Key === "string" || Number.isSafeInteger(part.Index)))) fail();
    // Container images are a separate policy; docker:// action references are in this scope.
    if (item.ident === "unpinned-images" && route.at(-1).Key !== "uses") continue;
    const path = paths.get(symbolic.key?.Local?.verbatim_path);
    const raw = symbolic.feature_kind?.Subfeature?.fragment?.Raw;
    const row = concrete?.location?.start_point?.row;
    if (!path || route.at(-1).Key !== "uses" || typeof raw !== "string" || !raw.length ||
      raw.length > 2048 || /[\u0000-\u001f\u007f]/.test(raw) || !Number.isSafeInteger(row) || row < 0 || row > 1000000) fail();
    findings.push({ kind: "workflow", path, reference: item.ident === "unpinned-images" ? `docker://${raw}` : raw, line: row + 1 });
  }
  return findings;
}

export function scanActionPins(files, { binary, run = spawnSync }) {
  if (typeof binary !== "string" || !isAbsolute(binary) || files.size > 200) fail();
  if (!files.size) return [];
  const root = mkdtempSync(join(tmpdir(), "repository-policy-scan-"));
  try {
    const paths = new Map();
    let total = 0;
    for (const [path, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
      if (!policyPath(path) || !Buffer.isBuffer(bytes) || bytes.length > 1024 * 1024 || (total += bytes.length) > 8 * 1024 * 1024) fail();
      const staged = join(root, path);
      mkdirSync(dirname(staged), { recursive: true });
      writeFileSync(staged, bytes, { flag: "wx", mode: 0o600 });
      paths.set(staged, path);
    }
    const options = { cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024,
      env: { PATH: "/usr/bin:/bin", HOME: root, XDG_CONFIG_HOME: root, NO_COLOR: "1" } };
    const version = run(binary, ["--version"], options);
    if (version.error || version.status !== 0 || version.stdout?.trim() !== `zizmor ${SCANNER_VERSION}`) {
      throw new Error("Action pin scanner version verification failed");
    }
    const result = run(binary, ["--offline", "--no-config", "--no-ignores", "--ignore-lockfile", "--strict-collection",
      "--persona", "auditor", "--format", "json-v1", "--no-exit-codes", ...paths.keys()], options);
    if (result.error || result.status !== 0 || typeof result.stdout !== "string" || Buffer.byteLength(result.stdout) > 8 * 1024 * 1024) fail();
    let parsed;
    try { parsed = JSON.parse(result.stdout); } catch { fail(); }
    return normalizePinFindings(parsed, paths);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
