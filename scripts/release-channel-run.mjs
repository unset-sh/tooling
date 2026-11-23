// Small CLI adapter. Only plan/verify/reserve/confirm hold a GitHub token; prepare/receipt run read-only.
import { appendFileSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { startedAsScript } from "./cli.mjs";
import { channelVersion, releaseContext } from "./release-channel.mjs";
import { githubClient, inspectRelease } from "./release-channel-api.mjs";
import { receiptFor, reserveTag, verifyArtifact } from "./release-channel-artifact.mjs";
import { prepareCheckout, regularJson } from "./release-channel-package.mjs";

const insist = (condition, message) => { if (!condition) throw new Error(message); };
function boolean(value) { insist(["true", "false"].includes(value), "Expected explicit boolean release option"); return value === "true"; }
function output(env, values) {
  for (const [name, value] of Object.entries(values)) {
    insist(!String(value).includes("\n") && !String(value).includes("\r"), "Unsafe workflow output");
    appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

export async function runChannel(command, env = process.env) {
  insist(["plan", "prepare", "receipt", "verify", "reserve", "confirm"].includes(command), "Unknown release channel command");
  const context = releaseContext({ event: regularJson(env.GITHUB_EVENT_PATH, 4 * 1024 * 1024), eventName: env.GITHUB_EVENT_NAME,
    repository: env.GITHUB_REPOSITORY, sha: env.GITHUB_SHA, ref: env.GITHUB_REF, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT });
  const options = { npmPackage: boolean(env.NPM_PACKAGE), install: boolean(env.INSTALL) };
  const version = env.VERSION;
  if (command !== "plan") insist(typeof version === "string" && version !== "0.0.0" &&
    channelVersion(version.split("-staging.")[0], context) === version, "Release version differs from this channel/run");
  if (command === "prepare") {
    const prepared = prepareCheckout(resolve(env.SOURCE_DIRECTORY), { context, ...options });
    insist(prepared.version === version, "Prepared source version differs from release plan"); return;
  }
  if (command === "receipt") {
    const root = resolve(env.ARTIFACT_DIRECTORY); mkdirSync(join(root, "files"), { recursive: true });
    writeFileSync(join(root, "receipt.json"), `${JSON.stringify(receiptFor(context, version))}\n`); return;
  }
  const get = githubClient({ token: env.GH_TOKEN });
  if (command === "confirm") {
    const tag = await get(`/repos/${context.repository}/git/ref/tags/v${version}`);
    insist(tag?.ref === `refs/tags/v${version}` && tag.object?.type === "commit" && tag.object.sha === context.sha,
      "Published tag differs from the exact source commit");
    output(env, { released: true }); return;
  }
  const plan = await inspectRelease(get, context, options);
  if (command === "plan") {
    output(env, { publish: plan.publish, version: plan.version, channel: plan.channel, environment: plan.environment }); return;
  }
  insist(plan.publish === true && plan.version === version, "Release plan changed before publication");
  if (command === "reserve") { await reserveTag(context, version, env.GH_TOKEN); return; }
  const root = resolve(env.ARTIFACT_DIRECTORY);
  // Artifact upload does not retain empty directories. Creating the absent files folder is safe;
  // an existing link or any unexpected root entry is refused by verifyArtifact.
  if (!lstatSync(join(root, "files"), { throwIfNoEntry: false })) mkdirSync(join(root, "files"));
  const verified = verifyArtifact(root, context, plan, options);
  writeFileSync(join(env.RUNNER_TEMP, "channel-names.txt"), verified.names.length ? `${verified.names.join("\n")}\n` : "");
  writeFileSync(join(env.RUNNER_TEMP, "channel-package.txt"), verified.packageName ?? "");
  const provenance = `\nSource: https://github.com/${context.repository}/commit/${context.sha}\nChannel: ${context.channel}\n` +
    (plan.promotion ? `Promotion: https://github.com/${context.repository}/pull/${plan.promotion}\n` : "");
  writeFileSync(join(env.RUNNER_TEMP, "channel-notes.md"), plan.notes + provenance);
  output(env, { count: verified.names.length, dist_tag: plan.distTag });
}

if (startedAsScript(import.meta.url)) {
  try { await runChannel(process.argv[2]); }
  catch (error) { console.error(`release channel: ${error.message}`); process.exitCode = 1; }
}
