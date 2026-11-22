import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startedAsScript } from "./cli.mjs";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const registryPath = "workflows/descriptions.json";
const outputPath = "docs/workflow-reference.md";
const maximumBytes = 1024 * 1024;
const fields = ["outputs", "path", "purpose", "repository", "reviewedCommit", "reviewedSha256", "steps"];
const matches = (pattern, value) => typeof value === "string" && pattern.exec(value)?.[0] === value;
const prose = (value) => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= 2000 &&
  !/[\u0000-\u001f\u007f]/.test(value);
const list = (value, maximum) => Array.isArray(value) && value.length > 0 && value.length <= maximum && value.every(prose);
const identity = ({ repository, path }) => `${repository}/${path}`;

/** Registry order selects the preferred fallback; exact source bytes always take precedence. */
export function validateWorkflowDescriptions(value) {
  if (!value || value.schemaVersion !== 1 || Object.keys(value).sort().join(",") !== "schemaVersion,workflows" ||
    !Array.isArray(value.workflows) || value.workflows.length < 1 || value.workflows.length > 1000) {
    throw new Error("Invalid workflow descriptions schema");
  }
  const seen = new Set();
  let bytes = 0;
  return value.workflows.map((record) => {
    if (!record || Object.keys(record).sort().join(",") !== fields.join(",") ||
      !matches(/^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/, record.repository) ||
      !matches(/^\.github\/workflows\/[^\\/\u0000-\u001f\u007f]{1,255}\.ya?ml$/, record.path) ||
      record.path.slice(18).length > 255 || !matches(/^[0-9a-f]{40}$/, record.reviewedCommit) ||
      !matches(/^[0-9a-f]{64}$/, record.reviewedSha256) || !prose(record.purpose) ||
      !list(record.steps, 20) || !list(record.outputs, 10)) throw new Error("Invalid workflow description record");
    const key = `${identity(record)}@${record.reviewedSha256}`;
    if (seen.has(key)) throw new Error("Duplicate workflow description source identity");
    seen.add(key);
    bytes += Buffer.byteLength(JSON.stringify(record));
    if (bytes > maximumBytes) throw new Error("Workflow descriptions size limit exceeded");
    return { ...record, steps: [...record.steps], outputs: [...record.outputs] };
  });
}

export function workflowDocumentation(workflow, records) {
  const candidates = records.filter((record) => identity(record) === identity(workflow));
  const selected = candidates.find(({ reviewedSha256 }) => reviewedSha256 === workflow.sha256) ?? candidates[0];
  if (!selected) return { status: "missing", purpose: null, steps: [], outputs: [], reviewedCommit: null, reviewedSha256: null };
  return { status: selected.reviewedSha256 === workflow.sha256 ? "current" : "review", purpose: selected.purpose,
    steps: [...selected.steps], outputs: [...selected.outputs], reviewedCommit: selected.reviewedCommit,
    reviewedSha256: selected.reviewedSha256 };
}

function statOrMissing(path) {
  try { return lstatSync(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function directory(root, relative) {
  if (!isAbsolute(root)) throw new Error("Workflow descriptions require an absolute root");
  for (const path of [root, join(root, relative)]) {
    const stat = statOrMissing(path);
    if (!stat) return false;
    if (stat.isSymbolicLink()) throw new Error("Workflow description directories cannot be symbolic links");
    if (!stat.isDirectory()) throw new Error("Workflow descriptions require directories");
  }
  return true;
}

function readRegular(path, limit) {
  const stat = statOrMissing(path);
  if (!stat) return null;
  if (stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("Workflow description files cannot be links");
  if (!stat.isFile() || stat.size > limit) throw new Error("Workflow descriptions require bounded regular files");
  const bytes = readFileSync(path);
  if (bytes.length > limit) throw new Error("Workflow descriptions size limit exceeded");
  return bytes;
}

/** Load local authoring data for reference generation; live collection reads immutable remote Git data. */
export function loadWorkflowDescriptions(root = defaultRoot) {
  if (!directory(root, "workflows")) throw new Error("Missing workflow descriptions directory");
  const bytes = readRegular(join(root, registryPath), maximumBytes);
  if (bytes === null) throw new Error("Missing workflow descriptions registry");
  let value;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("Invalid workflow descriptions JSON"); }
  return validateWorkflowDescriptions(value);
}

const frontmatter = `---
title: "Workflow reference"
description: "Reviewed purposes, responsibilities, and results of the organisation's workflows."
weight: 26
type: docs
params:
  doc_kind: reference
  generated_from: workflows/descriptions.json
---
`;
const escape = (value) => value.replace(/[\\\x60*_{}\[\]<>#]/g, "\\$&");
const segment = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

function reference(records) {
  const lines = [frontmatter,
    "These reviewed descriptions explain each workflow's purpose, main responsibilities, and results. The [live workflow map](https://docs.unset.sh/workflows/) compares source bytes with the reviewed version and marks changed or undocumented workflows for review.", "",
    "The preferred record appears first for each workflow. Additional reviewed versions cover older implementations selected by pinned callers. These summaries describe responsibilities; declared events, job dependencies, permissions, and exact call relationships remain in the live map.", "",
    "Maintain these descriptions in `workflows/descriptions.json` and run `npm run workflows:describe`. The [catalogue guide](workflow-map.md#maintain-reviewed-descriptions) explains the review process.", ""];
  const groups = new Map();
  for (const record of records) {
    const key = identity(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  let repository;
  for (const key of [...groups.keys()].sort()) {
    const versions = groups.get(key);
    if (repository !== versions[0].repository) {
      repository = versions[0].repository;
      lines.push(`## ${escape(repository)}`, "");
    }
    lines.push(`### ${escape(versions[0].path)}`, "");
    for (const [index, record] of versions.entries()) {
      if (index > 0) lines.push(`#### Additional reviewed version ${index}`, "");
      const url = `https://github.com/unset-sh/${segment(repository)}/blob/${record.reviewedCommit}/${record.path.split("/").map(segment).join("/")}`;
      lines.push(escape(record.purpose), "", "**What it does**", "",
        ...record.steps.map((step, i) => `${i + 1}. ${escape(step)}`), "", "**Produces**", "",
        ...record.outputs.map((output) => `- ${escape(output)}`), "",
        `[Reviewed source at ${record.reviewedCommit.slice(0, 12)}](${url}).`, "",
        `Source SHA-256: \`${record.reviewedSha256}\`.`, "");
    }
  }
  const output = lines.join("\n");
  if (Buffer.byteLength(output) > 4 * maximumBytes) throw new Error("Workflow reference size limit exceeded");
  return output;
}

/** Return whether the committed reference differs; check mode performs no filesystem writes. */
export function generateWorkflowReference({ root = defaultRoot, write = false } = {}) {
  const output = reference(loadWorkflowDescriptions(root));
  const hasDirectory = directory(root, "docs");
  const existing = hasDirectory ? readRegular(join(root, outputPath), 4 * maximumBytes) : null;
  if (existing && !existing.toString("utf8").startsWith(frontmatter)) {
    throw new Error("Workflow reference output is unmanaged; refusing to overwrite it");
  }
  const changed = existing === null || !existing.equals(Buffer.from(output));
  if (write && changed) {
    if (!hasDirectory) mkdirSync(join(root, "docs"));
    writeFileSync(join(root, outputPath), output);
  }
  return changed;
}

if (process.argv[1] && process.argv[1] !== "-" && startedAsScript(import.meta.url)) {
  try {
    const [mode, flag, root, ...extra] = process.argv.slice(2);
    if (!["--check", "--write"].includes(mode) || extra.length ||
      (flag !== undefined && (flag !== "--root" || !root || !isAbsolute(root)))) {
      throw new Error("Usage: workflow-descriptions.mjs --check|--write [--root <absolute-root>]");
    }
    const changed = generateWorkflowReference({ root, write: mode === "--write" });
    if (changed && mode === "--check") throw new Error("Workflow reference is stale; run npm run workflows:describe");
    if (changed) console.log(outputPath);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
