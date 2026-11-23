// The owner registers the App and places its private key by hand. This file reads
// public identity only; the pinned token action receives the key directly.
// https://github.com/actions/create-github-app-token/tree/v3.3.0
// https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-app-installation
import { appendFileSync, readFileSync } from "node:fs";
import { startedAsScript } from "./cli.mjs";

const fail = message => { throw new Error(`Automation App ${message}`); };
const positive = value => Number.isSafeInteger(value) && value > 0;
function identity() {
  try {
    const bytes = readFileSync(new URL("./automation-app.json", import.meta.url));
    if (bytes.length > 4096) return null;
    const value = JSON.parse(bytes);
    if (!value || Object.keys(value).sort().join(",") !== "appId,botId,clientId,installationId,slug"
      || !positive(value.appId) || !positive(value.botId) || !positive(value.installationId)
      || typeof value.clientId !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(value.clientId)
      || typeof value.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) || value.slug.length > 80) return null;
    const bot = Object.freeze({ login: `${value.slug}[bot]`, id: value.botId, type: "Bot" });
    return Object.freeze({ ...value, bot, signoff: `Signed-off-by: ${bot.login} <${bot.id}+${bot.login}@users.noreply.github.com>` });
  } catch { return null; }
}

// A missing identity is deliberately dormant, so read-only preparation can still
// load this module. Publication and client-id output fail closed until configured.
export const automationApp = identity();

export async function assertAutomationAppToken({ githubToken, repository, appSlug, installationId, fetchImpl = fetch }) {
  if (!automationApp || !["unset-sh/docs", "unset-sh/.github"].includes(repository)
    || appSlug !== automationApp.slug || String(automationApp.installationId) !== installationId
    || typeof githubToken !== "string" || !githubToken || githubToken.length > 4096 || /[\r\n]/.test(githubToken)) fail("identity or token scope is invalid");
  let response;
  try {
    response = await fetchImpl("https://api.github.com/installation/repositories?per_page=100", {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", Authorization: `Bearer ${githubToken}` },
    });
  } catch { fail("repository verification failed"); }
  if (response.status !== 200) { await response.body?.cancel().catch(() => {}); fail("repository verification was refused"); }
  const reader = response.body?.getReader();
  if (!reader) fail("repository response is empty");
  const chunks = []; let size = 0, result;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 128 * 1024) { await reader.cancel(); fail("repository response exceeds its limit"); }
      chunks.push(value);
    }
    result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { fail("repository response is invalid"); }
  finally { reader.releaseLock(); }
  const selected = result?.repositories?.[0];
  if (result?.total_count !== 1 || !Array.isArray(result.repositories) || result.repositories.length !== 1
    || !positive(selected?.id) || selected.full_name !== repository
    || selected.owner?.login !== "unset-sh" || selected.owner.type !== "Organization") fail("token must cover exactly its selected repository");
}

if (startedAsScript(import.meta.url)) {
  try {
    if (process.argv.length !== 2 || !automationApp || !process.env.GITHUB_OUTPUT) fail("public identity is not configured");
    appendFileSync(process.env.GITHUB_OUTPUT, `client-id=${automationApp.clientId}\n`);
  } catch { console.error("Automation App public identity is not configured"); process.exitCode = 1; }
}
