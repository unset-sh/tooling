// Dispatch only reviewed generated-map PR checks. No consumer checkout or merge.
// https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
import { startedAsScript } from "./cli.mjs";
import { validateGeneratedMapPullRequest } from "./generated-map-publication.mjs";

const repository = "unset-sh/.github";
const workflows = ["org-map.yml", "docs-export.yml", "branch-policy.yml"];
const fail = message => { throw new Error(message); };

export async function dispatchGeneratedMapChecks({ context, number, expectedHead, expectedBase, githubToken, fetchImpl = fetch }) {
  if (context?.repository !== repository || context.ref !== "refs/heads/staging" || context.sha !== expectedBase ||
      !["push", "schedule", "workflow_dispatch"].includes(context.event)) fail("Invalid generated map dispatcher context");
  if (typeof githubToken !== "string" || !githubToken || /[\r\n]/.test(githubToken)) fail("Invalid map dispatcher token");
  const api = async (repo, method, path, body) => {
    if (repo !== repository || !["GET", "POST"].includes(method) || typeof path !== "string" ||
        !/^\/[A-Za-z0-9_./?=&-]+$/.test(path) || path.includes("..") || path.startsWith("//") ||
        (method === "POST" && !workflows.some(name => path === `/actions/workflows/${name}/dispatches`))) fail("Invalid map dispatcher request");
    let response;
    try {
      response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
        method, redirect: "error", signal: AbortSignal.timeout(30000),
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2026-03-10", "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { fail("Generated map check request failed"); }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      fail("Generated map check request was not confirmed");
    }
    const reader = response.body?.getReader();
    if (!reader) fail("Empty map check response");
    const chunks = []; let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 8 * 1024 * 1024) { await reader.cancel(); fail("limit"); }
        chunks.push(value);
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    } catch { fail("Cannot read bounded map check response"); }
    finally { reader.releaseLock(); }
  };
  const proof = await validateGeneratedMapPullRequest({ number, expectedHead, expectedBase, api });
  const runs = [];
  for (const workflow of workflows) {
    for (const [name, sha] of [["staging", proof.base], [proof.branch, proof.head]]) {
      const ref = await api(repository, "GET", `/git/ref/heads/${name}`);
      if (ref?.ref !== `refs/heads/${name}` || ref.object?.type !== "commit" || ref.object.sha !== sha) fail("Generated map ref moved before check dispatch");
    }
    const result = await api(repository, "POST", `/actions/workflows/${workflow}/dispatches`, {
      ref: proof.branch, inputs: { "pull-request": String(proof.number), "expected-head": proof.head, "expected-base": proof.base },
    });
    const id = result?.workflow_run_id;
    if (!Number.isSafeInteger(id) || id <= 0 || result.run_url !== `https://api.github.com/repos/${repository}/actions/runs/${id}` ||
        result.html_url !== `https://github.com/${repository}/actions/runs/${id}`) fail("Invalid generated map check run identity");
    const run = await api(repository, "GET", `/actions/runs/${id}`);
    if (run?.id !== id || run.event !== "workflow_dispatch" || run.head_sha !== proof.head || run.head_branch !== proof.branch ||
        run.path !== `.github/workflows/${workflow}` || run.repository?.full_name !== repository || run.head_repository?.full_name !== repository) {
      fail("Generated map check did not start at the expected workflow and commit");
    }
    runs.push({ workflow, id, url: result.html_url });
  }
  return { number: proof.number, head: proof.head, base: proof.base, runs };
}

if (startedAsScript(import.meta.url)) {
  try {
    const githubToken = process.env.GH_TOKEN;
    delete process.env.GH_TOKEN;
    const result = await dispatchGeneratedMapChecks({ context: { repository: process.env.GITHUB_REPOSITORY,
      ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA, event: process.env.GITHUB_EVENT_NAME },
    number: process.env.MAP_PR_NUMBER, expectedHead: process.env.MAP_PR_HEAD, expectedBase: process.env.MAP_PR_BASE, githubToken });
    for (const run of result.runs) console.log(`Requested ${run.workflow}: ${run.url}`);
    console.log("The staging PR remains open. Follow each run and complete normal review before merging; main promotion is separate.");
  } catch {
    console.error("Generated map checks could not be confirmed. Inspect existing runs before retrying; a request may already have created a run.");
    process.exitCode = 1;
  }
}
