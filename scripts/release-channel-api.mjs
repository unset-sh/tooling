// Only fixed-origin, bounded GitHub reads. Never resolve a mutable branch for release source.
// Git trees preserve file modes; Contents API can silently follow a repository symlink.
// https://docs.github.com/en/rest/git/trees#get-a-tree
// https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset (read 2026-11-23)
import { createHash } from "node:crypto";
import { channelVersion, fullCommit, requireEnvironment, requirePromotion, requireRules } from "./release-channel.mjs";
import { preparePackage } from "./release-channel-package.mjs";
import { notesFor } from "./release-notes.mjs";

const insist = (condition, message) => { if (!condition) throw new Error(message); };
const MAX_SOURCE = 1024 * 1024;

export function githubClient({ token, fetchImpl = fetch, maxRequests = 40, maxBytes = 2 * 1024 * 1024 } = {}) {
  insist(typeof token === "string" && token.length > 0, "GitHub token is required");
  let requests = 0;
  return async (path, { missing = false } = {}) => {
    insist(typeof path === "string" && /^\/repos\/unset-sh\/[A-Za-z0-9_.-]+(?:[/?][A-Za-z0-9_./?=&-]*)?$/.exec(path)?.[0] === path &&
      !path.includes(".."), "Invalid GitHub API path");
    insist(++requests <= maxRequests, "GitHub request bound exceeded");
    const response = await fetchImpl(`https://api.github.com${path}`, { method: "GET", redirect: "error",
      signal: AbortSignal.timeout(15000), headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2026-03-10" } });
    if (missing && response.status === 404) { await response.body?.cancel(); return null; }
    if (response.status !== 200) { await response.body?.cancel(); throw new Error(`GitHub read failed (${response.status}); release refuses unavailable evidence`); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length; insist(size <= maxBytes, "GitHub response byte bound exceeded"); chunks.push(chunk);
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new Error("Invalid GitHub JSON response"); }
  };
}

export async function sourceAt(get, context) {
  const base = `/repos/${context.repository}`;
  const commit = await get(`${base}/git/commits/${context.sha}`);
  insist(commit?.sha === context.sha && fullCommit(commit.tree?.sha), "Git commit identity differs from release source");
  const tree = await get(`${base}/git/trees/${commit.tree.sha}`);
  insist(tree?.sha === commit.tree.sha && tree.truncated === false && Array.isArray(tree.tree) && tree.tree.length <= 10000,
    "Invalid or truncated source tree");
  const read = async (path, optional = false) => {
    const entries = tree.tree.filter((entry) => entry.path === path);
    if (optional && entries.length === 0) return null;
    insist(entries.length === 1, "Missing or ambiguous source file");
    const entry = entries[0];
    insist(entry.type === "blob" && ["100644", "100755"].includes(entry.mode) && fullCommit(entry.sha) &&
      Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= MAX_SOURCE, "Source must be a bounded regular Git file");
    const blob = await get(`${base}/git/blobs/${entry.sha}`);
    insist(blob?.sha === entry.sha && blob.size === entry.size && blob.encoding === "base64" && typeof blob.content === "string",
      "Invalid Git blob identity");
    const encoded = blob.content.replaceAll("\n", ""); const bytes = Buffer.from(encoded, "base64");
    insist(bytes.toString("base64") === encoded && bytes.length === entry.size &&
      createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") === entry.sha, "Git blob digest differs from source tree");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  };
  const manifest = JSON.parse(await read("package.json"));
  if (channelVersion(manifest?.version, context) === null) return { commit, manifest, lock: null, changelog: null };
  insist(!tree.tree.some((entry) => entry.path === "npm-shrinkwrap.json"), "npm-shrinkwrap.json is not supported by channel releases");
  const lock = await read("package-lock.json", true);
  return { commit, manifest, lock: lock === null ? null : JSON.parse(lock), changelog: await read("CHANGELOG.md") };
}

export async function inspectRelease(get, context, options = {}) {
  const source = await sourceAt(get, context);
  const prepared = preparePackage({ ...options, ...source, context });
  if (prepared.version === null) return { publish: false, version: "0.0.0", channel: context.channel, environment: context.environment };
  const base = `/repos/${context.repository}`;
  const repository = await get(base);
  insist(repository?.full_name === context.repository && repository.private === false, "Source must remain the same public repository");
  const active = await get(`${base}/rules/branches/${context.branch}?per_page=100&page=1`);
  insist(Array.isArray(active) && active.length > 0 && active.length < 100, "Missing or truncated active branch rules");
  const ids = [...new Set(active.map((rule) => rule.ruleset_id))];
  insist(ids.length <= 20 && ids.every((id) => Number.isSafeInteger(id) && id > 0), "Invalid or excessive branch rulesets");
  const rulesets = [];
  for (const id of ids) {
    const ruleset = await get(`${base}/rulesets/${id}`);
    insist(ruleset?.id === id && ruleset.target === "branch", "Branch ruleset identity mismatch"); rulesets.push(ruleset);
  }
  requireRules(context, rulesets);
  requireEnvironment(context, await get(`${base}/environments/${context.environment}`),
    await get(`${base}/environments/${context.environment}/deployment-branch-policies?per_page=100&page=1`));
  let promotion = null;
  if (context.channel === "stable") {
    const associated = await get(`${base}/commits/${context.sha}/pulls?per_page=100&page=1`);
    insist(Array.isArray(associated) && associated.length > 0 && associated.length <= 10, "Missing or excessive promotion candidates");
    const numbers = associated.map((pr) => pr.number);
    insist(new Set(numbers).size === numbers.length && numbers.every((n) => Number.isSafeInteger(n) && n > 0), "Invalid promotion candidate identity");
    const pulls = [];
    for (const number of numbers) pulls.push(await get(`${base}/pulls/${number}`));
    promotion = requirePromotion(context, source.commit, pulls);
  }
  const tag = `v${prepared.version}`;
  insist(await get(`${base}/git/ref/tags/${tag}`, { missing: true }) === null &&
    await get(`${base}/releases/tags/${tag}`, { missing: true }) === null, "Release version already exists; never reuse a tag or release");
  return { publish: true, version: prepared.version, channel: context.channel, environment: context.environment,
    distTag: context.channel === "staging" ? "staging" : "latest", promotion, manifest: prepared.manifest,
    notes: notesFor(source.changelog, source.manifest.version) };
}
