// The receiver uses the same exporter contract as source jobs. All imported bytes
// remain data; no command, path, repository or destination comes from a source.
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, openSync, readSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { exportDocs } from "./export-docs.mjs";

const sources = Object.freeze({
  tooling: Object.freeze({ repository: "unset-sh/tooling", directory: "docs", section: "tooling", workflow: ".github/workflows/automation-docs-self.yml" }),
  github: Object.freeze({ repository: "unset-sh/.github", directory: "docs/site", section: "github", workflow: ".github/workflows/docs-export.yml" }),
});
export const importLimits = Object.freeze({ files: 256, fileBytes: 1024 * 1024, totalBytes: 8 * 1024 * 1024, snapshotBytes: 12 * 1024 * 1024 });
export class DocsImportError extends Error {}
export const refuseImport = message => { throw new DocsImportError(message); };
export const isCommit = value => typeof value === "string" && value.length === 40 && /^[a-f0-9]{40}$/.test(value);
export const exactKeys = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const gitBlobHash = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

export function importSource(key) {
  if (typeof key !== "string" || !Object.hasOwn(sources, key)) refuseImport("Unknown documentation source");
  return sources[key];
}

export function validateImportPaths(files) {
  const paths = new Map();
  let previous = "";
  for (const file of files) {
    const path = file.path;
    if (typeof path !== "string" || path.length > 1024 || path <= previous) refuseImport("Documentation paths must be unique and sorted");
    previous = path;
    const parts = path.split("/");
    if (parts.length > 12) refuseImport("Documentation path nesting exceeds its limit");
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(part) || part.length > 255 || part.endsWith(".")
        || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)) refuseImport("Unsafe documentation path");
      const name = parts.slice(0, index + 1).join("/");
      const kind = index === parts.length - 1 ? "file" : "directory";
      const existing = paths.get(name.toLowerCase());
      if (existing && (existing.name !== name || existing.kind !== kind || kind === "file")) refuseImport("Documentation path collision");
      paths.set(name.toLowerCase(), { name, kind });
    }
  }
}

export function decodeImportFiles(snapshot) {
  return new Map(snapshot.files.map(file => [file.path, Buffer.from(file.content, "base64")]));
}

export function validateDocsImport(snapshot) {
  if (!exactKeys(snapshot, ["schemaVersion", "source", "target", "files"]) || snapshot.schemaVersion !== 1
    || !exactKeys(snapshot.source, ["key", "revision", "runId"]) || !isCommit(snapshot.source.revision)
    || !Number.isSafeInteger(snapshot.source.runId) || snapshot.source.runId <= 0
    || !exactKeys(snapshot.target, ["repository", "base", "baseCommit", "workflowCommit"])
    || snapshot.target.repository !== "unset-sh/docs" || snapshot.target.base !== "staging"
    || !isCommit(snapshot.target.baseCommit) || snapshot.target.workflowCommit !== snapshot.target.baseCommit) refuseImport("Invalid documentation import identity");
  const source = importSource(snapshot.source.key);
  if (!Array.isArray(snapshot.files) || snapshot.files.length < 3 || snapshot.files.length > importLimits.files) refuseImport("Invalid documentation file count");
  let total = 0;
  for (const file of snapshot.files) {
    if (!exactKeys(file, ["path", "content", "sha256"]) || typeof file.content !== "string"
      || file.content.length > Math.ceil(importLimits.fileBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content)) {
      refuseImport("Invalid or oversized documentation file");
    }
    const bytes = Buffer.from(file.content, "base64");
    total += bytes.length;
    if (bytes.length > importLimits.fileBytes || total > importLimits.totalBytes || bytes.toString("base64") !== file.content
      || typeof file.sha256 !== "string" || sha256(bytes) !== file.sha256) refuseImport("Documentation hash or byte limit mismatch");
  }
  validateImportPaths(snapshot.files);
  const files = decodeImportFiles(snapshot);
  if (!files.has("LICENSE") || !files.get("LICENSE").length || !files.has("_index.md") || !files.get("_index.md").length
    || !files.has("source.json")) refuseImport("Documentation requires its licence, section index and provenance");
  let provenance;
  try { provenance = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(files.get("source.json"))); }
  catch { refuseImport("Invalid documentation provenance JSON"); }
  const expected = snapshot.files.filter(file => file.path !== "source.json").map(({ path, sha256 }) => ({ path, sha256 }));
  if (!exactKeys(provenance, ["schemaVersion", "repository", "revision", "directory", "section", "files"])
    || provenance.schemaVersion !== 1 || provenance.repository !== source.repository || provenance.revision !== snapshot.source.revision
    || provenance.directory !== source.directory || provenance.section !== source.section || !Array.isArray(provenance.files)
    || provenance.files.length !== expected.length || provenance.files.some((file, index) => !exactKeys(file, ["path", "sha256"])
      || file.path !== expected[index].path || file.sha256 !== expected[index].sha256)) refuseImport("Documentation provenance does not match the complete source section");
  if (Buffer.byteLength(JSON.stringify(snapshot)) > importLimits.snapshotBytes) refuseImport("Documentation snapshot exceeds its limit");
  return snapshot;
}

function safeParent(filename, fresh = true) {
  if (typeof filename !== "string" || !isAbsolute(filename) || filename.split(/[\\/]/).includes("..")) refuseImport("Expected an absolute fresh output path");
  const parent = dirname(filename);
  let current = parse(parent).root;
  for (const part of parent.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (!lstatSync(current, { throwIfNoEntry: false })?.isDirectory()) refuseImport("Output parent must be an existing directory without links");
  }
  if (fresh && lstatSync(filename, { throwIfNoEntry: false })) refuseImport("Output already exists");
}

export function readDocsImport(filename) {
  safeParent(filename, false);
  const fd = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > importLimits.snapshotBytes) refuseImport("Import snapshot must be a bounded regular file");
    const storage = Buffer.alloc(stat.size + 1); let length = 0;
    while (length < storage.length) {
      const count = readSync(fd, storage, length, storage.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length !== stat.size || fstatSync(fd).size !== stat.size) refuseImport("Import snapshot changed while reading");
    const bytes = storage.subarray(0, length);
    let snapshot;
    try { snapshot = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { refuseImport("Invalid import snapshot JSON"); }
    return validateDocsImport(snapshot);
  } finally { closeSync(fd); }
}

export function stageDocsImport({ root, source: key, revision, runId, baseCommit, workflowCommit, out }) {
  const source = importSource(key);
  if (!isCommit(revision) || !isCommit(baseCommit) || !isCommit(workflowCommit) || !Number.isSafeInteger(runId) || runId <= 0) refuseImport("Invalid import source or destination revision");
  safeParent(out);
  const distance = relative(resolve(root), out);
  if (distance === "" || (!isAbsolute(distance) && distance !== ".." && !distance.startsWith(`..${sep}`))) refuseImport("Import output must be outside the source repository");
  const temporary = mkdtempSync(join(dirname(out), ".docs-import-"));
  try {
    const exported = join(temporary, "export");
    exportDocs({ root, repository: source.repository, revision, out: exported });
    const files = []; let total = 0;
    const visit = (directory, prefix = "") => {
      for (const name of readdirSync(directory).sort()) {
        const filename = join(directory, name);
        const stat = lstatSync(filename);
        const path = prefix ? `${prefix}/${name}` : name;
        if (stat.isDirectory()) { visit(filename, path); continue; }
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > importLimits.fileBytes || files.length >= importLimits.files) refuseImport("Export contains an unsafe or oversized file");
        total += stat.size;
        if (total > importLimits.totalBytes) refuseImport("Export exceeds its total byte limit");
        const bytes = readFileSync(filename);
        files.push({ path, content: bytes.toString("base64"), sha256: sha256(bytes) });
      }
    };
    visit(join(exported, source.section));
    files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    const snapshot = validateDocsImport({ schemaVersion: 1, source: { key, revision, runId },
      target: { repository: "unset-sh/docs", base: "staging", baseCommit, workflowCommit }, files });
    safeParent(out);
    writeFileSync(out, `${JSON.stringify(snapshot)}\n`, { flag: "wx", mode: 0o600 });
    return { source: key, files: files.length };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
