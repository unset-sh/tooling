// Run a consumer's registered map generators, then stage one complete data-only snapshot.
import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { startedAsScript } from "./cli.mjs";

const usage = "Usage: bun scripts/refresh-maps.mjs --root <repository> --out <fresh-directory> [--registry .github/maps.json]";
const limits = { registry: 64 * 1024, generator: 1024 * 1024, output: 8 * 1024 * 1024, total: 32 * 1024 * 1024 };
const fullMatch = (pattern, value) => typeof value === "string" && pattern.exec(value)?.[0] === value;

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function safePath(value, kind) {
  if (typeof value !== "string" || value.length > 240 || value.length === 0) throw new Error(`Invalid ${kind} path`);
  const parts = value.split("/");
  if (parts.length > 8 || parts.some((part, index) => {
    if (kind === "registry" && index === 0 && part === ".github") return false;
    return !fullMatch(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/, part) || part.endsWith(".") ||
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part);
  })) throw new Error(`Invalid ${kind} path`);
  if (kind === "generator" && (parts[0] !== "scripts" || parts.length < 2 || !value.endsWith(".mjs"))) {
    throw new Error("Generators must be .mjs files under scripts/");
  }
  if (kind === "output" && (parts[0] !== "data" || parts.length < 2 || !value.endsWith(".json"))) {
    throw new Error("Map outputs must be JSON files under data/");
  }
  if (kind === "registry" && !value.endsWith(".json")) throw new Error("Registry must be a JSON file");
  return value;
}

function directory(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path.split(/[\\/]/).includes("..")) {
    throw new Error("Directories must be absolute paths without traversal");
  }
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink()) throw new Error("Directory has a symbolic link ancestor");
    if (!stat?.isDirectory()) throw new Error("Directory must already exist");
  }
  return absolute;
}

function fileBytes(root, path, maximum) {
  directory(dirname(join(root, path)));
  const target = join(root, path);
  const stat = lstatSync(target, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.nlink !== 1) throw new Error(`Expected a regular unlinked file: ${path}`);
  let descriptor;
  try {
    // NOFOLLOW and fstat re-check the opened file; NONBLOCK prevents a raced FIFO from hanging.
    descriptor = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== stat.dev || opened.ino !== stat.ino) {
      throw new Error("File changed while opening");
    }
    if (opened.size > maximum) throw new Error("File exceeds its size limit");
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, length);
      if (count === 0) break;
      length += count;
    }
    if (length > maximum || fstatSync(descriptor).nlink !== 1) throw new Error("File exceeds its limit or was linked");
    return Buffer.from(buffer.subarray(0, length));
  } catch {
    throw new Error(`Cannot read bounded regular file: ${path}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function json(bytes, label) {
  try {
    // Keep the BOM rather than silently stripping it; JSON itself must be valid.
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  } catch {
    throw new Error(`${label} must contain valid UTF-8 JSON`);
  }
}

function registeredMaps(root, registry) {
  safePath(registry, "registry");
  const value = json(fileBytes(root, registry, limits.registry), "Registry");
  if (!exactKeys(value, ["schemaVersion", "maps"]) || value.schemaVersion !== 1 ||
      !Array.isArray(value.maps) || value.maps.length < 1 || value.maps.length > 100) {
    throw new Error("Registry must have schemaVersion 1 and between 1 and 100 maps");
  }
  const ids = new Set();
  const names = new Map();
  let count = 0;
  for (const map of value.maps) {
    if (!exactKeys(map, ["id", "generator", "arguments", "outputs"]) ||
        !fullMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, map.id) || map.id.length > 64 || ids.has(map.id)) {
      throw new Error("Each map must have a unique kebab-case id, generator, arguments and outputs");
    }
    ids.add(map.id);
    safePath(map.generator, "generator");
    if (!Array.isArray(map.arguments) || map.arguments.length > 32 || map.arguments.some((arg) =>
      typeof arg !== "string" || arg.length > 2048 || /[\u0000-\u001f\u007f]/.test(arg))) {
      throw new Error(`Map ${map.id} requires at most 32 bounded string arguments without control characters`);
    }
    if (!Array.isArray(map.outputs) || map.outputs.length < 1 || map.outputs.length > 50) {
      throw new Error(`Map ${map.id} must declare between 1 and 50 outputs`);
    }
    for (const output of map.outputs) {
      safePath(output, "output");
      if (++count > 1000) throw new Error("A registry can declare at most 1000 outputs");
      const parts = output.split("/");
      for (let i = 0; i < parts.length; i++) {
        const name = parts.slice(0, i + 1).join("/");
        const kind = i === parts.length - 1 ? "file" : "directory";
        const previous = names.get(name.toLowerCase());
        if (previous && (previous.name !== name || previous.kind !== kind || kind === "file")) {
          throw new Error("Map output paths collide, including filename case");
        }
        names.set(name.toLowerCase(), { name, kind });
      }
    }
    // Preflight every script before executing any, then check it again immediately before execution.
    fileBytes(root, map.generator, limits.generator);
  }
  return value.maps;
}

function freshOutput(out, root) {
  if (typeof out !== "string" || !isAbsolute(out) || out.split(/[\\/]/).includes("..")) {
    throw new Error("Output must be an absolute path without traversal");
  }
  const destination = resolve(out);
  const fromRoot = relative(root, destination);
  if (fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot))) {
    throw new Error("Output must be outside the source repository");
  }
  directory(dirname(destination));
  if (lstatSync(destination, { throwIfNoEntry: false })) throw new Error("Output already exists; use a fresh directory");
  return destination;
}

/** Generators validate their map schema; this runner validates and stages only their declared JSON files. */
export function refreshMaps({ root = process.cwd(), registry = ".github/maps.json", out, githubToken = process.env.DOCS_GITHUB_TOKEN } = {}) {
  delete process.env.DOCS_GITHUB_TOKEN;
  const source = directory(root);
  const destination = freshOutput(out, source);
  const maps = registeredMaps(source, registry);
  const env = { ...process.env };
  // Runtime flags belong to this workflow's pinned Node, never to consumer configuration.
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  if (githubToken) env.DOCS_GITHUB_TOKEN = githubToken;
  for (const map of maps) {
    fileBytes(source, map.generator, limits.generator);
    try {
      execFileSync(process.execPath, [join(source, map.generator), ...map.arguments], {
        cwd: source, env, stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, maxBuffer: 1024 * 1024,
      });
    } catch {
      // Child stdout/stderr may include credentials or private API responses. Never print either.
      throw new Error(`Generator failed for map ${map.id}; inspect its validation locally`);
    }
  }
  delete env.DOCS_GITHUB_TOKEN;
  const files = [];
  let total = 0;
  for (const map of maps) {
    for (const path of map.outputs) {
      const bytes = fileBytes(source, path, limits.output);
      json(bytes, `Output ${path}`);
      total += bytes.length;
      if (total > limits.total) throw new Error("Map snapshot exceeds 32 MiB");
      files.push({ path, bytes });
    }
  }
  // No output is created until every generator and every output has succeeded.
  freshOutput(destination, source);
  const staging = mkdtempSync(join(dirname(destination), ".map-refresh-"));
  try {
    for (const { path, bytes } of files) {
      const target = join(staging, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: "wx", mode: 0o644 });
    }
    freshOutput(destination, source);
    renameSync(staging, destination);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return { maps: maps.length, files: files.length };
}

function argumentsFor(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!["--root", "--out", "--registry"].includes(key) || !value || value.startsWith("--") || Object.hasOwn(options, key.slice(2))) {
      throw new Error(usage);
    }
    options[key.slice(2)] = value;
  }
  if (!options.root || !options.out) throw new Error(usage);
  return options;
}

if (startedAsScript(import.meta.url)) {
  const githubToken = process.env.DOCS_GITHUB_TOKEN;
  delete process.env.DOCS_GITHUB_TOKEN;
  try {
    const result = refreshMaps({ ...argumentsFor(process.argv.slice(2)), githubToken });
    console.log(`Refreshed ${result.maps} maps; staged ${result.files} JSON files.`);
  } catch (error) {
    console.error(`Map refresh failed: ${error.message}`);
    process.exitCode = 1;
  }
}
