import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { channelVersion, fullCommit } from "./release-channel.mjs";
import { listed } from "./release-files.mjs";
import { regularJson, verifyChannelPackage } from "./release-channel-package.mjs";
import { insist } from "./release-channel-error.mjs";


export function receiptFor(context, version) {
  return { schemaVersion: 1, repository: context.repository, commit: context.sha, channel: context.channel,
    version, runId: context.runId, runAttempt: context.runAttempt };
}

export function verifyArtifact(root, context, plan, { npmPackage = false, maxBytes = 512 * 1024 * 1024 } = {}) {
  insist(isAbsolute(root) && realpathSync(root) === resolve(root) && lstatSync(root).isDirectory(), "Artifact root must be a regular directory");
  insist(isDeepStrictEqual(readdirSync(root).sort(), ["files", "receipt.json"]), "Unexpected release artifact root entries");
  insist(isDeepStrictEqual(regularJson(join(root, "receipt.json"), 16384), receiptFor(context, plan.version)), "Artifact receipt differs from this release run");
  const folder = join(root, "files"); const stat = lstatSync(folder);
  insist(stat.isDirectory() && !stat.isSymbolicLink(), "Artifact files must be a regular directory");
  const names = listed(folder); let total = 0;
  for (const name of names) {
    const file = lstatSync(join(folder, name));
    insist(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.exec(name)?.[0] === name && file.nlink === 1, "Artifact filename or hard link refused");
    total += file.size; insist(file.size <= 128 * 1024 * 1024 && total <= maxBytes, "Release artifact byte bound exceeded");
  }
  const packages = names.filter((name) => name.endsWith(".tgz"));
  let packageName = null;
  if (npmPackage) {
    insist(packages.length === 1, "Expected exactly one packed npm package"); packageName = packages[0];
    verifyChannelPackage(readFileSync(join(folder, packageName)), packageName, plan.manifest, context);
  }
  return { names, packageName };
}

/** Atomic create refuses an existing tag; never PATCH, force, delete, or reuse one. */
export async function reserveTag(context, version, token, fetchImpl = fetch) {
  insist(/^unset-sh\/(?:\.github|[A-Za-z0-9_][A-Za-z0-9_.-]{0,99})$/.exec(context.repository)?.[0] === context.repository && fullCommit(context.sha) &&
    channelVersion(version.split("-staging.")[0], context) === version && version !== "0.0.0" && typeof token === "string" && token.length > 0,
    "Invalid tag reservation identity");
  const ref = `refs/tags/v${version}`;
  const response = await fetchImpl(`https://api.github.com/repos/${context.repository}/git/refs`, { method: "POST", redirect: "error",
    signal: AbortSignal.timeout(15000), headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`,
      "content-type": "application/json", "X-GitHub-Api-Version": "2026-03-10" }, body: JSON.stringify({ ref, sha: context.sha }) });
  if (response.status !== 201) { await response.body?.cancel(); throw new Error(`Tag reservation refused (${response.status}); nothing will overwrite an existing tag`); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; insist(size <= 65536, "Tag response byte bound exceeded"); chunks.push(chunk); }
  const created = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  insist(created.ref === ref && created.object?.type === "commit" && created.object.sha === context.sha, "Reserved tag has unexpected identity");
}
