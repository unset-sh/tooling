import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { validatePolicyConfig, policyPath, dependencyFindings, artifactFindings, applyPolicyExceptions, kitOwnedPath, kitFindings } from "./repository-policy-data.mjs";
import { scanActionPins } from "./repository-policy-scanner.mjs";

const fail = message => { throw new Error(message); };
const fullSha = value => typeof value === "string" && /^[0-9a-f]{40}$/.exec(value)?.[0] === value;
const decode = bytes => { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("Invalid repository policy input encoding"); } };
const json = bytes => { try { return JSON.parse(decode(bytes)); } catch { fail("Invalid repository policy input JSON"); } };

export function inspectRepositoryPolicy({ root, revision, repository, scanner, scan = scanActionPins }) {
  if (!fullSha(revision) || typeof repository !== "string" ||
    /^unset-sh\/[A-Za-z0-9_.-]{1,100}$/.exec(repository)?.[0] !== repository) fail("Invalid repository policy source identity");
  root = realpathSync(root);
  const git = args => {
    const result = spawnSync("git", ["--no-pager", "--no-replace-objects", "-c", "core.fsmonitor=false", ...args], {
      cwd: root, timeout: 30000, maxBuffer: 16 * 1024 * 1024,
      env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    });
    if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) fail("Repository policy cannot read the committed Git source");
    return result.stdout;
  };
  if (decode(git(["rev-parse", "--show-toplevel"])).trim() !== root ||
    decode(git(["rev-parse", "--verify", "HEAD^{commit}"])).trim() !== revision ||
    decode(git(["rev-parse", "--verify", `${revision}^{commit}`])).trim() !== revision) fail("Repository policy source revision does not match checkout");
  const tree = new Map();
  const listing = decode(git(["ls-tree", "-r", "-z", "-l", revision]));
  if (!listing.endsWith("\0")) fail("Empty or invalid repository policy tree");
  for (const entry of listing.slice(0, -1).split("\0")) {
    const match = /^(\d{6}) (blob|commit) ([0-9a-f]{40}) +([0-9]+|-)\t([^\0]+)$/.exec(entry);
    if (!match || tree.has(match[5]) || tree.size >= 50000) fail("Invalid or oversized repository policy tree");
    tree.set(match[5], { mode: match[1], type: match[2], sha: match[3], size: Number(match[4]) });
  }
  const loaded = new Map();
  let total = 0;
  const read = (path, maximum = 1024 * 1024) => {
    if (loaded.has(path)) return loaded.get(path);
    const entry = tree.get(path);
    if (!policyPath(path) || !entry || !["100644", "100755"].includes(entry.mode) || entry.type !== "blob" ||
      !Number.isSafeInteger(entry.size) || entry.size > maximum || (total += entry.size) > 16 * 1024 * 1024) fail("Missing, unsafe or oversized repository policy input");
    const bytes = git(["cat-file", "blob", entry.sha]);
    if (bytes.length !== entry.size || createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== entry.sha) fail("Repository policy input identity mismatch");
    loaded.set(path, bytes);
    return bytes;
  };
  const config = validatePolicyConfig(json(read(".github/repository-policy.json", 64 * 1024)));
  const findings = artifactFindings([...tree.keys()], repository, config.artifactPaths);
  for (const path of config.dependencyManifests) findings.push(...dependencyFindings(path, json(read(path))));
  const kit = new Map();
  for (const path of tree.keys()) if (kitOwnedPath(path)) kit.set(path, read(path));
  findings.push(...kitFindings(kit, config.kit));
  const workflows = new Map();
  for (const path of tree.keys()) if (path.startsWith(".github/workflows/") && /\.ya?ml$/i.test(path)) {
    if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) fail("Nested or unsupported repository policy workflow path");
    workflows.set(path, read(path));
  }
  for (const path of config.actionDefinitions) workflows.set(path, read(path));
  findings.push(...scan(workflows, { binary: scanner }));
  return { revision, files: tree.size, workflows: workflows.size,
    findings: applyPolicyExceptions(findings, config.exceptions).sort((a, b) =>
      JSON.stringify([a.kind, a.path, a.key, a.line]).localeCompare(JSON.stringify([b.kind, b.path, b.key, b.line]))) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: Object.fromEntries(["root", "revision", "repository", "scanner"].map(key => [key, { type: "string" }])), strict: true });
    if (Object.keys(values).length !== 4) throw new Error("Missing arguments");
    const result = inspectRepositoryPolicy(values);
    for (const item of result.findings) console.error(`Repository policy: ${item.kind} at ${JSON.stringify(item.path)}${item.line ? `:${item.line}` : ""}`);
    if (result.findings.length) process.exitCode = 1;
    else console.log(`Repository policy passed for ${result.revision}; ${result.workflows} workflow/action definitions inspected.`);
  } catch {
    // Never echo malformed JSON, scanner source snippets, credentials or arbitrary subprocess errors.
    console.error("Repository policy could not complete. Verify committed configuration, source identity, input bounds and the pinned scanner.");
    process.exitCode = 1;
  }
}
