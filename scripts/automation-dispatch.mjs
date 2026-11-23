import { startedAsScript } from "./cli.mjs";
import { createDocsApi } from "./docs-import-github.mjs";
import { validateDocsImportDispatch } from "./docs-import-dispatch.mjs";
import { validateGeneratedMapDispatch } from "./generated-map-publication.mjs";

export async function validateAutomationDispatch(options) {
  if (options.context?.repository === "unset-sh/docs") return validateDocsImportDispatch(options);
  if (options.context?.repository === "unset-sh/.github") return validateGeneratedMapDispatch(options);
  throw new Error("Unsupported automation dispatch repository");
}

async function main() {
  const token = process.env.DOCS_GITHUB_TOKEN;
  delete process.env.DOCS_GITHUB_TOKEN;
  const args = process.argv.slice(2), values = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!["--pull-request", "--expected-head", "--expected-base"].includes(args[index]) || !args[index + 1] || Object.hasOwn(values, args[index])) throw new Error("Invalid dispatch validator arguments");
    values[args[index]] = args[index + 1];
  }
  if (Object.keys(values).length !== 3) throw new Error("Dispatch validator requires PR, expected head and expected base");
  const result = await validateAutomationDispatch({ context: { repository: process.env.GITHUB_REPOSITORY, event: process.env.GITHUB_EVENT_NAME,
    ref: process.env.GITHUB_REF, sha: process.env.GITHUB_SHA }, number: values["--pull-request"], expectedHead: values["--expected-head"],
    expectedBase: values["--expected-base"], api: createDocsApi({ githubToken: token }) });
  console.log(`Verified generated pull request ${result.number} at ${result.head}`);
}

if (startedAsScript(import.meta.url)) main().catch(() => {
  console.error("Generated pull request dispatch validation failed; check the PR identity, current head/base and API availability");
  process.exitCode = 1;
});
