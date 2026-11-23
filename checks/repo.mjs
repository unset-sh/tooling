// Shared by the checks: where the repository is, how to read it, and how to take a workflow file apart
// without a YAML parser (the repository has no dependencies).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const root = new URL("../", import.meta.url);
export const rootPath = fileURLToPath(root);

export function readText(path) {
  return readFileSync(new URL(path, root), "utf8");
}

/** Repository-relative paths of the workflow files, sorted. */
export function workflowFiles() {
  return readdirSync(new URL(".github/workflows/", root))
    .filter((name) => statSync(new URL(`.github/workflows/${name}`, root)).isFile())
    .map((name) => `.github/workflows/${name}`)
    .sort();
}

/** The text of a workflow between its top-level key `key:` and the next top-level key. */
export function topLevel(text, key) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === `${key}:` || line.startsWith(`${key}: `));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^[A-Za-z]/.test(line));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n");
}

/** The jobs of a workflow, as { name: text of that job }. Jobs sit two spaces in, under `jobs:`. */
export function jobsOf(text) {
  const jobs = {};
  let current;
  for (const line of topLevel(text, "jobs").split("\n").slice(1)) {
    const start = /^ {2}([A-Za-z][\w-]*):\s*$/.exec(line);
    if (start !== null) {
      current = start[1];
      jobs[current] = "";
    } else if (current !== undefined) {
      jobs[current] += `${line}\n`;
    }
  }
  return jobs;
}

/** The shell text of every `run:` in a piece of workflow, one string per step. */
export function runBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)(?:- )?run: (.*)$/.exec(lines[index]);
    if (match === null) continue;
    if (!/^[|>][+-]?$/.test(match[2])) {
      blocks.push(match[2]);
      continue;
    }
    const indent = match[1].length;
    const body = [];
    while (index + 1 < lines.length && (lines[index + 1].trim() === "" || /^\s*/.exec(lines[index + 1])[0].length > indent)) {
      index += 1;
      body.push(lines[index]);
    }
    blocks.push(body.join("\n"));
  }
  return blocks;
}

/** The names of the inputs a reusable workflow declares. */
export function inputsOf(text) {
  const on = topLevel(text, "on");
  const start = on.indexOf("\n    inputs:\n");
  if (start === -1) return [];
  const names = [];
  for (const line of on.slice(start + "\n    inputs:\n".length).split("\n")) {
    if (/^ {4}\S/.test(line)) break;
    const match = /^ {6}([a-z][\w-]*):$/.exec(line);
    if (match !== null) names.push(match[1]);
  }
  return names;
}

/** The action every workflow installs Bun with, pinned. */
export const SETUP_BUN = "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0";

/**
 * The two steps that install the Bun a version file names and then refuse any other: setup-bun falls back to
 * the latest release when it cannot read the file (src/index.ts at the pinned commit). No cache is restored
 * and the action is given no token: an exact version needs no API call (src/download-url.ts).
 */
export function pinnedBun(versionFile, indent = 6) {
  const step = " ".repeat(indent);
  const field = " ".repeat(indent + 2);
  const value = " ".repeat(indent + 4);
  return [
    `${step}- uses: ${SETUP_BUN}`,
    `${field}with:`,
    `${value}bun-version-file: ${versionFile}`,
    `${value}no-cache: true # never restore a runner from a cache another run wrote`,
    `${value}token: "" # an exact version needs no API call, so the action gets no token`,
    `${step}- name: Bun is the exact version ${versionFile} names`,
    `${field}env:`,
    `${value}BUN_VERSION_FILE: ${versionFile}`,
    `${field}# setup-bun falls back to the latest release when the file is missing or unreadable; this refuses that.`,
    `${field}run: test "$(bun --version)" = "$(cat "$BUN_VERSION_FILE")"`,
    "",
  ].join("\n");
}

/** The shell text of the version check `pinnedBun` adds, as `runBlocks` returns it. */
export const BUN_VERSION_CHECK = 'test "$(bun --version)" = "$(cat "$BUN_VERSION_FILE")"';
