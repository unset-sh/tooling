// Publish only the organisation map's two generated Markdown outputs.
// GitHub REST contracts reviewed 2026-11-22:
// https://docs.github.com/en/rest/git/blobs#create-a-blob
// https://docs.github.com/en/rest/git/trees#create-a-tree
// https://docs.github.com/en/rest/git/commits#create-a-commit
// https://docs.github.com/en/rest/git/refs#create-a-reference
// https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { startedAsScript } from "./cli.mjs";

const repositoryName = "unset-sh/.github";
const paths = ["MAP.md", "profile/README.md"];
const maximumFile = 1024 * 1024;
const maximumSnapshot = 3 * 1024 * 1024;
const profileStart = "<!-- org-map:start (generated from repos.json; edit that, then run npm run map) -->";
const profileEnd = "<!-- org-map:end -->";
const shaPattern = /^[a-f0-9]{40}$/;
class PublicationError extends Error {}
const refuse = (message) => { throw new PublicationError(message); };
const isSha = (value) => typeof value === "string" && value.length === 40 && shaPattern.test(value);
const exactKeys = (value, keys) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const blobHash = (text) => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");

export function validateSnapshot(snapshot) {
  if (!exactKeys(snapshot, ["schemaVersion", "repository", "commit", "files"]) || snapshot.schemaVersion !== 1 ||
      snapshot.repository !== repositoryName || !isSha(snapshot.commit) || !exactKeys(snapshot.files, paths)) {
    refuse("Invalid generated map snapshot shape, repository, commit or paths");
  }
  for (const path of paths) {
    const value = snapshot.files[path];
    if (typeof value !== "string" || !value.isWellFormed() || Buffer.byteLength(value) > maximumFile) {
      refuse("Generated map outputs must be valid UTF-8 strings of at most 1 MiB");
    }
  }
  if (Buffer.byteLength(JSON.stringify(snapshot)) > maximumSnapshot) refuse("Generated map snapshot exceeds 3 MiB");
  return snapshot;
}

function directory(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path.split(/[\\/]/).includes("..")) refuse("Expected an absolute directory without traversal");
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (!lstatSync(current, { throwIfNoEntry: false })?.isDirectory()) refuse("Expected an existing directory without symbolic links");
  }
  return absolute;
}

function fileBytes(path, maximum) {
  directory(dirname(path));
  let descriptor;
  try {
    const before = lstatSync(path);
    if (!before.isFile() || before.nlink !== 1) refuse("Expected a regular unlinked file");
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > maximum) {
      refuse("File changed or exceeds its limit");
    }
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, length);
      if (count === 0) break;
      length += count;
    }
    if (length > maximum || fstatSync(descriptor).nlink !== 1) refuse("File changed or exceeds its limit");
    return buffer.subarray(0, length);
  } catch {
    refuse("Cannot read bounded regular unlinked file");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function utf8(bytes) {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { refuse("Invalid UTF-8 in generated map data"); }
}

function parseJson(bytes) {
  try { return JSON.parse(utf8(bytes)); }
  catch { refuse("Invalid generated map JSON"); }
}

function registeredMap(bytes) {
  const registry = parseJson(bytes);
  const map = registry?.maps?.[0];
  if (!exactKeys(registry, ["schemaVersion", "maps"]) || registry.schemaVersion !== 1 ||
      !Array.isArray(registry.maps) || registry.maps.length !== 1 ||
      !exactKeys(map, ["id", "generator", "arguments", "outputs"]) || map.id !== "organisation" ||
      map.generator !== "scripts/map.mjs" || JSON.stringify(map.arguments) !== '["--write"]' ||
      JSON.stringify(map.outputs) !== JSON.stringify(paths)) refuse("Invalid fixed organisation map registry");
}

export function stageGeneratedMap({ root, out, repository, commit }) {
  if (repository !== repositoryName || !isSha(commit)) refuse("Invalid staging repository or commit");
  root = directory(root);
  if (typeof out !== "string" || !isAbsolute(out) || out.split(/[\\/]/).includes("..")) refuse("Expected an absolute fresh output path");
  out = resolve(out);
  directory(dirname(out));
  const distance = relative(root, out);
  if (distance === "" || (!isAbsolute(distance) && distance !== ".." && !distance.startsWith(`..${sep}`))) refuse("Snapshot must be outside the source checkout");
  if (lstatSync(out, { throwIfNoEntry: false })) refuse("Output already exists");
  const git = (...args) => {
    try {
      return execFileSync("git", ["-c", "core.fsmonitor=false", ...args], {
        cwd: root, env: { PATH: process.env.PATH, LANG: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000, maxBuffer: maximumSnapshot,
      });
    } catch { refuse("Cannot verify source checkout"); }
  };
  const checkSource = () => {
    if (git("rev-parse", "--show-toplevel").trim() !== root || git("rev-parse", "HEAD").trim() !== commit) refuse("Source checkout commit moved");
    const changes = [
      git("diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", "HEAD", "--"),
      git("diff", "--cached", "--no-ext-diff", "--no-textconv", "--name-only", "-z", "--"),
      git("ls-files", "--others", "--exclude-standard", "-z"),
    ].flatMap((value) => value.split("\0").filter(Boolean));
    if (changes.some((path) => !paths.includes(path))) refuse("Source checkout has changes outside generated map outputs");
  };
  checkSource();
  const registry = fileBytes(join(root, ".github/maps.json"), 64 * 1024);
  registeredMap(registry);
  if (utf8(registry) !== git("show", `${commit}:.github/maps.json`)) refuse("Map registry differs from the immutable source commit");
  const snapshot = validateSnapshot({ schemaVersion: 1, repository, commit, files: Object.fromEntries(paths.map((path) => [path, utf8(fileBytes(join(root, path), maximumFile))])) });
  checkSource();
  try { writeFileSync(out, JSON.stringify(snapshot), { flag: "wx", mode: 0o600 }); }
  catch { refuse("Cannot create fresh generated map snapshot"); }
  return { status: "staged" };
}

function authoredReadme(text) {
  if (text.split("<!-- org-map:start").length !== 2 || text.split("<!-- org-map:end").length !== 2) refuse("README requires one unique generated marker pair");
  const start = text.indexOf(profileStart);
  const end = text.indexOf(profileEnd);
  if (start < 0 || end < start + profileStart.length) refuse("README generated markers are missing or broken");
  return [text.slice(0, start + profileStart.length), text.slice(end)];
}

async function responseJson(response) {
  const reader = response.body?.getReader();
  if (!reader) refuse("GitHub returned an empty response");
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 8 * 1024 * 1024) { await reader.cancel(); refuse("GitHub response exceeds its limit"); }
      chunks.push(value);
    }
    return parseJson(Buffer.concat(chunks));
  } catch { refuse("Cannot read bounded GitHub response"); }
  finally { reader.releaseLock(); }
}

export async function publishGeneratedMap({ snapshot, githubToken, fetchImpl = fetch }) {
  snapshot = structuredClone(validateSnapshot(snapshot));
  if (typeof githubToken !== "string" || githubToken.length === 0 || /[\r\n]/.test(githubToken)) refuse("A GitHub token is required");
  const api = async (method, path, body, statuses = [200]) => {
    let response;
    try {
      response = await fetchImpl(`https://api.github.com/repos/unset-sh/.github${path}`, {
        method, redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${githubToken}`, "X-GitHub-Api-Version": "2026-03-10", "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { refuse("GitHub request failed"); }
    if (!statuses.includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      refuse(`GitHub request refused (HTTP ${Number.isInteger(response.status) ? response.status : "unknown"})`);
    }
    if (response.status >= 400) { await response.body?.cancel().catch(() => {}); return { status: response.status }; }
    return { status: response.status, data: await responseJson(response) };
  };
  const checkMain = async () => {
    const { data } = await api("GET", "/git/ref/heads/main");
    if (data?.ref !== "refs/heads/main" || data.object?.type !== "commit" || data.object.sha !== snapshot.commit) refuse("Source main branch moved; regenerate the map");
  };
  await checkMain();
  const { data: base } = await api("GET", `/git/commits/${snapshot.commit}`);
  if (base?.sha !== snapshot.commit || !isSha(base.tree?.sha)) refuse("Invalid immutable base commit");
  const { data: tree } = await api("GET", `/git/trees/${base.tree.sha}?recursive=1`);
  if (tree?.sha !== base.tree.sha || tree.truncated !== false || !Array.isArray(tree.tree)) refuse("Invalid or truncated immutable base tree");
  const entries = paths.map((path) => {
    const matches = tree.tree.filter((item) => item.path === path);
    if (matches.length !== 1 || matches[0].mode !== "100644" || matches[0].type !== "blob" || !isSha(matches[0].sha)) refuse("Generated map base paths must be regular Markdown files");
    return matches[0];
  });
  const { data: readme } = await api("GET", `/git/blobs/${entries[1].sha}`);
  if (readme?.sha !== entries[1].sha || readme.encoding !== "base64" || typeof readme.content !== "string" ||
      !Number.isInteger(readme.size) || readme.size < 0 || readme.size > maximumFile ||
      !/^[A-Za-z0-9+/=\r\n]*$/.test(readme.content)) refuse("Invalid immutable README blob");
  const bytes = Buffer.from(readme.content, "base64");
  const original = utf8(bytes);
  if (bytes.length !== readme.size || blobHash(original) !== entries[1].sha) refuse("Immutable README blob does not match its hash");
  if (JSON.stringify(authoredReadme(original)) !== JSON.stringify(authoredReadme(snapshot.files[paths[1]]))) refuse("Generated snapshot changes authored README content");
  const changed = paths.filter((path, index) => blobHash(snapshot.files[path]) !== entries[index].sha);
  if (changed.length === 0) return { status: "unchanged" };
  const branch = `automation/map-${snapshot.commit}`;
  const existing = await api("GET", `/git/ref/heads/${branch}`, undefined, [200, 404]);
  if (existing.status === 200 && (existing.data?.ref !== `refs/heads/${branch}` ||
      existing.data.object?.type !== "commit" || !isSha(existing.data.object.sha))) refuse("Invalid existing publication branch");
  await checkMain();
  const updated = [];
  for (const path of changed) {
    const { data } = await api("POST", "/git/blobs", { content: snapshot.files[path], encoding: "utf-8" }, [201]);
    if (data?.sha !== blobHash(snapshot.files[path])) refuse("GitHub returned an unexpected generated blob");
    updated.push({ path, mode: "100644", type: "blob", sha: data.sha });
  }
  const { data: newTree } = await api("POST", "/git/trees", { base_tree: base.tree.sha, tree: updated }, [201]);
  if (!isSha(newTree?.sha)) refuse("GitHub returned an invalid generated tree");
  const title = "Refresh generated organisation map";
  // The workflow uses only github.token. Use its documented bot identity for DCO,
  // while GitHub retains the authenticated actor as author and committer:
  // https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/README.md#push-a-commit-using-the-built-in-token
  const signoff = "Signed-off-by: github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>";
  const message = `${title}\n\n${signoff}`;
  // Creating the tree from the immutable base and only these blobs proves all
  // other paths are unchanged. A retry may reuse that exact tree and sole parent.
  const { data: commit } = existing.status === 200
    ? await api("GET", `/git/commits/${existing.data.object.sha}`)
    : await api("POST", "/git/commits", { message, tree: newTree.sha, parents: [snapshot.commit] }, [201]);
  if (!isSha(commit?.sha) || commit.tree?.sha !== newTree.sha || commit.parents?.length !== 1 ||
      commit.parents[0].sha !== snapshot.commit || (existing.status === 200 && commit.sha !== existing.data.object.sha)) {
    refuse("Invalid generated or existing publication commit; expected exact tree and sole source parent");
  }
  if (commit.message !== message) refuse("Generated publication commit lacks the expected bot sign-off");
  if (existing.status === 404) {
    const { data: ref } = await api("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: commit.sha }, [201]);
    if (ref?.ref !== `refs/heads/${branch}` || ref.object?.sha !== commit.sha || ref.object.type !== "commit") refuse("GitHub returned an unexpected publication branch");
  }
  const { data: prs } = await api("GET", `/pulls?state=all&head=unset-sh%3Aautomation%2Fmap-${snapshot.commit}&per_page=100`);
  if (!Array.isArray(prs) || prs.length > 1) refuse("Invalid or ambiguous existing publication pull requests");
  const pr = prs.length === 1 ? prs[0] : (await api("POST", "/pulls", {
    title, head: branch, base: "main", body: "Refresh the generated organisation map from validated repos.json. Only MAP.md and the generated profile map block may change.",
  }, [201])).data;
  if (!Number.isSafeInteger(pr?.number) || pr.number <= 0 || pr.state !== "open" || pr.head?.sha !== commit.sha ||
      pr.head.ref !== branch || pr.head.repo?.full_name !== repositoryName || pr.base?.ref !== "main" ||
      pr.base.sha !== snapshot.commit || pr.base.repo?.full_name !== repositoryName) refuse("GitHub returned an unexpected existing or new publication pull request");
  const url = `https://github.com/unset-sh/.github/pull/${pr.number}`;
  await checkMain();
  // The merge endpoint enforces the expected PR head and repository protections.
  // No direct main ref update, required status, approval, or bypass is ever written.
  const merged = await api("PUT", `/pulls/${pr.number}/merge`, { sha: commit.sha, merge_method: "squash", commit_title: title, commit_message: signoff }, [200, 403, 405, 409, 422]);
  return { status: merged.data?.merged === true ? "merged" : "pending", url };
}

async function main() {
  const githubToken = process.env.GH_TOKEN;
  delete process.env.GH_TOKEN;
  const [mode, ...args] = process.argv.slice(2);
  const allowed = mode === "stage" ? ["--root", "--out", "--commit"] : mode === "publish" ? ["--snapshot"] : [];
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.includes(args[index]) || options[args[index]] !== undefined || !args[index + 1]) refuse("Invalid generated map command arguments");
    options[args[index]] = args[index + 1];
  }
  if (allowed.length === 0 || Object.keys(options).length !== allowed.length) refuse("Invalid generated map command arguments");
  let result;
  if (mode === "stage") result = stageGeneratedMap({ root: options["--root"], out: options["--out"], commit: options["--commit"], repository: process.env.GITHUB_REPOSITORY });
  else {
    const snapshot = validateSnapshot(parseJson(fileBytes(resolve(options["--snapshot"]), maximumSnapshot)));
    if (process.env.GITHUB_REPOSITORY !== repositoryName || process.env.GITHUB_SHA !== snapshot.commit ||
        process.env.GITHUB_REF !== "refs/heads/main" || !["push", "schedule", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME)) {
      refuse("Generated map workflow context does not match the snapshot");
    }
    result = await publishGeneratedMap({ snapshot, githubToken });
  }
  console.log(`${result.status}${result.url ? ` ${result.url}` : ""}`);
  if (result.status === "pending") process.exitCode = 1;
}

if (startedAsScript(import.meta.url)) main().catch((error) => {
  console.error(error instanceof PublicationError ? error.message : "Generated map publication failed");
  process.exitCode = 1;
});
