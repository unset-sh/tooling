import { appendFileSync } from "node:fs";
import { startedAsScript } from "./cli.mjs";
import { docsBase, importSource, isCommit, readDocsImport, refuseImport, stageDocsImport } from "./docs-import-data.mjs";
import { createDocsApi, readImportRef, resolveImportSource, verifyImportSource } from "./docs-import-github.mjs";
import { publishDocsImport } from "./docs-import-publication.mjs";
import { dispatchDocsImportChecks } from "./docs-import-send.mjs";

export function receiverContext(environment) {
  if (environment.GITHUB_REPOSITORY !== "unset-sh/docs" || environment.GITHUB_REF !== `refs/heads/${docsBase}`
    || !["schedule", "workflow_dispatch"].includes(environment.GITHUB_EVENT_NAME) || !isCommit(environment.GITHUB_SHA)) refuseImport("Documentation imports run only in docs on main");
  return environment.GITHUB_SHA;
}

export async function runDocsImport({ args, environment = process.env, api, publicationCredentials, output = () => {} }) {
  const base = receiverContext(environment);
  const [command, ...rest] = args, values = {};
  const allowed = { resolve: ["source"], stage: ["source", "revision", "run-id", "root", "out"], publish: ["source", "snapshot"],
    dispatch: ["pull-request", "expected-head", "expected-base", "branch"] }[command];
  if (!allowed || rest.length !== allowed.length * 2) refuseImport("Invalid documentation import command");
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index].slice(2);
    if (!rest[index].startsWith("--") || !allowed.includes(key) || !rest[index + 1] || Object.hasOwn(values, key)) refuseImport("Invalid documentation import arguments");
    values[key] = rest[index + 1];
  }
  if (await readImportRef(api, "unset-sh/docs", docsBase) !== base) refuseImport("Docs main moved before import");
  if (command === "resolve") {
    const source = importSource(values.source), selection = await resolveImportSource({ source: values.source, api });
    output({ repository: source.repository, revision: selection.revision, "run-id": selection.runId });
    return selection;
  }
  if (command === "stage") {
    if (!/^[1-9][0-9]*$/.test(values["run-id"])) refuseImport("Invalid export run ID");
    stageDocsImport({ root: values.root, source: values.source, revision: values.revision, runId: Number(values["run-id"]), baseCommit: base, workflowCommit: base, out: values.out });
    const snapshot = readDocsImport(values.out);
    await verifyImportSource({ snapshot, api });
    return { status: "prepared" };
  }
  if (command === "publish") {
    const snapshot = readDocsImport(values.snapshot);
    if (snapshot.source.key !== values.source) refuseImport("Snapshot belongs to another source");
    if (snapshot.target.baseCommit !== base) refuseImport("Snapshot belongs to another docs revision");
    const result = await publishDocsImport({ snapshot, api, ...publicationCredentials });
    if (result.status !== "unchanged") output({ changed: "true", "pull-request": result.number, "expected-head": result.head, "expected-base": base, branch: result.branch });
    else output({ changed: "false" });
    return result;
  }
  if (values["expected-base"] !== base) refuseImport("Dispatch belongs to another docs revision");
  return dispatchDocsImportChecks({ number: values["pull-request"], expectedHead: values["expected-head"], expectedBase: base, branch: values.branch, api });
}

export function takeImportCredentials(environment, command) {
  const jobToken = environment.DOCS_GITHUB_TOKEN, appToken = environment.DOCS_APP_TOKEN;
  const appSlug = environment.AUTOMATION_APP_SLUG, installationId = environment.AUTOMATION_APP_INSTALLATION_ID;
  for (const key of ["DOCS_GITHUB_TOKEN", "DOCS_APP_TOKEN", "AUTOMATION_APP_SLUG", "AUTOMATION_APP_INSTALLATION_ID"]) delete environment[key];
  if (command === "publish") {
    if (!appToken || jobToken || !appSlug || !installationId) refuseImport("The publisher requires only its scoped App token");
    return { githubToken: appToken, publicationCredentials: { githubToken: appToken, appSlug, installationId } };
  }
  if (appToken || appSlug || installationId) refuseImport("App credentials belong only in the publisher");
  return { githubToken: jobToken };
}

async function main() {
  const credentials = takeImportCredentials(process.env, process.argv[2]);
  // The exporter invokes isolated Git; neither token remains in subprocess env.
  const result = await runDocsImport({ args: process.argv.slice(2), api: createDocsApi({ githubToken: credentials.githubToken }), publicationCredentials: credentials.publicationCredentials, output: values => {
    if (!process.env.GITHUB_OUTPUT) refuseImport("Missing Actions output channel");
    for (const [key, value] of Object.entries(values)) {
      if (!/^[a-z-]+$/.test(key) || !/^[A-Za-z0-9_./-]+$/.test(String(value))) refuseImport("Invalid import output");
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    }
  } });
  console.log(JSON.stringify(result));
}

if (startedAsScript(import.meta.url)) main().catch(() => {
  console.error("Documentation import refused; check source export, exact docs main revision, generated PR ownership and API availability");
  process.exitCode = 1;
});
