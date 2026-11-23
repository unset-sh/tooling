import { docsBase, importSource, isCommit, refuseImport } from "./docs-import-data.mjs";
import { readImportRef } from "./docs-import-github.mjs";
import { validateImportPr, verifyDocsImportHead } from "./docs-import-publication.mjs";

/** Verify a real bot PR and its exact source/base before a dispatched check executes repository code. */
export async function validateDocsImportDispatch({ context, number, expectedHead, expectedBase, api }) {
  const match = typeof context?.ref === "string" && /^refs\/heads\/automation\/docs-(tooling|github)$/.exec(context.ref);
  if (context?.repository !== "unset-sh/docs" || context.event !== "workflow_dispatch" || !match
    || !isCommit(expectedHead) || !isCommit(expectedBase) || expectedHead === expectedBase || context.sha !== expectedHead
    || typeof number !== "string" || !/^[1-9][0-9]*$/.test(number) || number.length > 16
    || String(Number(number)) !== number || !Number.isSafeInteger(Number(number))) refuseImport("Invalid documentation dispatch identity");
  return validateDocsImportTarget({ number, expectedHead, expectedBase, branch: `automation/docs-${match[1]}`, api });
}

export async function validateDocsImportTarget({ number, expectedHead, expectedBase, branch, api }) {
  const match = typeof branch === "string" && /^automation\/docs-(tooling|github)$/.exec(branch);
  if (!match || !isCommit(expectedHead) || !isCommit(expectedBase) || expectedHead === expectedBase
    || typeof number !== "string" || !/^[1-9][0-9]*$/.test(number) || number.length > 16
    || String(Number(number)) !== number || !Number.isSafeInteger(Number(number))) refuseImport("Invalid documentation target identity");
  const repository = "unset-sh/docs", source = importSource(match[1]);
  const readPr = async () => {
    const pr = validateImportPr(await api(repository, "GET", `/pulls/${number}`), branch, expectedHead, expectedBase);
    if (pr.number !== Number(number) || pr.draft !== false || !Number.isSafeInteger(pr.changed_files) || pr.changed_files < 1 || pr.changed_files > 512) refuseImport("Invalid documentation PR change count or draft state");
    return pr;
  };
  const pr = await readPr();
  const names = new Set();
  for (let page = 1; names.size < pr.changed_files; page++) {
    if (page > 6) refuseImport("Documentation PR diff exceeds its limit");
    const files = await api(repository, "GET", `/pulls/${number}/files?per_page=100&page=${page}`);
    if (!Array.isArray(files) || !files.length || files.length > 100) refuseImport("Incomplete documentation PR diff");
    for (const file of files) {
      if (typeof file.filename !== "string" || !file.filename.startsWith(`${source.section}/`) || names.has(file.filename)
        || (file.previous_filename !== undefined && (typeof file.previous_filename !== "string" || !file.previous_filename.startsWith(`${source.section}/`)))) refuseImport("Documentation PR changes another section or framework path");
      names.add(file.filename);
    }
    if (names.size > pr.changed_files) refuseImport("Documentation PR diff count changed");
  }
  await verifyDocsImportHead({ api, key: match[1], head: expectedHead, base: expectedBase });
  await readPr();
  if (await readImportRef(api, repository, docsBase) !== expectedBase || await readImportRef(api, repository, branch) !== expectedHead) refuseImport("Documentation dispatch base or head moved");
  return { number: Number(number), head: expectedHead, base: expectedBase, branch, repository };
}
