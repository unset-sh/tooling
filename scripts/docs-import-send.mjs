// GITHUB_TOKEN-created PRs need explicit validation runs. Request only these two
// docs workflows, and bind REST 2026-03-10's returned run to the verified PR head.
// A requested run is not evidence that its checks completed or passed.
// https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
// https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run (read 2026-11-23)
import { refuseImport } from "./docs-import-data.mjs";
import { validateDocsImportTarget } from "./docs-import-dispatch.mjs";

const repository = "unset-sh/docs";
const workflowNames = Object.freeze(["ci.yml", "branch-policy.yml"]);
const positive = value => Number.isSafeInteger(value) && value > 0;

export async function dispatchDocsImportChecks({ number, expectedHead, expectedBase, branch, api }) {
  const target = { number, expectedHead, expectedBase, branch, api };
  await validateDocsImportTarget(target);
  const workflows = [];
  // Preflight both workflows before dispatching either: a disabled second check
  // must not create a knowingly incomplete pair of validation requests.
  for (const name of workflowNames) {
    const workflow = await api(repository, "GET", `/actions/workflows/${name}`);
    if (!positive(workflow?.id) || workflow.state !== "active" || workflow.path !== `.github/workflows/${name}`
      || workflows.some(item => item.id === workflow.id)) refuseImport("Required documentation check workflow is unavailable or changed");
    workflows.push({ name, id: workflow.id, path: workflow.path });
  }
  const requested = [];
  for (const workflow of workflows) {
    await validateDocsImportTarget(target);
    const response = await api(repository, "POST", `/actions/workflows/${workflow.name}/dispatches`, {
      ref: branch, inputs: { "pull-request": number, "expected-head": expectedHead, "expected-base": expectedBase },
    }, [200]);
    const id = response?.workflow_run_id;
    const runUrl = `https://api.github.com/repos/${repository}/actions/runs/${id}`;
    const url = `https://github.com/${repository}/actions/runs/${id}`;
    if (!positive(id) || response.run_url !== runUrl || response.html_url !== url || requested.some(run => run.id === id)) {
      refuseImport("Documentation check dispatch did not return a valid unique run identity; inspect existing runs before retrying");
    }
    // Never follow a response-supplied URL. The API call uses the checked numeric ID.
    const run = await api(repository, "GET", `/actions/runs/${id}`);
    if (run?.id !== id || run.url !== runUrl || run.html_url !== url || run.workflow_id !== workflow.id
      || run.path !== workflow.path || run.event !== "workflow_dispatch" || run.head_branch !== branch || run.head_sha !== expectedHead
      || run.repository?.full_name !== repository || run.head_repository?.full_name !== repository) {
      refuseImport("Requested documentation check run does not match the verified workflow and pull request head");
    }
    await validateDocsImportTarget(target);
    requested.push({ workflow: workflow.name, id, url });
  }
  return requested;
}
