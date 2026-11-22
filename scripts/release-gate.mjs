// Checks, before any release is built, that the `release` environment really holds the owner's approval.
//
//   node scripts/release-gate.mjs <environment.json> <branch-policies.json>
//
// GitHub creates an environment a workflow names if none exists, with no protection at all, so a missing or
// loosened environment would publish with no one's approval. The release workflow reads the environment and
// its branch policies from the REST API and stops here, before the approval wait, unless:
//   - the owner, and only the owner, is the required reviewer;
//   - self-review is allowed, because the owner is also who merges the version bump that starts the run;
//   - administrators cannot bypass the protection, because assistants act through the owner's account;
//   - only the branch main may deploy to it.
// Field names from https://docs.github.com/en/rest/deployments/environments ("Get an environment") and
// https://docs.github.com/en/rest/deployments/branch-policies ("List deployment branch policies"), read
// 2026-11-22. Neither page lists a field for the administrator bypass, but the environment response carries
// `can_admins_bypass` (read by google/go-github `master`, github/repos_environments.go). The gate requires
// it to be false and fails closed when GitHub does not say. Unverified against a live response until a first
// release run.
//
// First written for unset-sh/agent-kit and reviewed there by a separate thread before it moved here.

import { readFileSync } from "node:fs";
import { startedAsScript } from "./cli.mjs";

/** The one account that approves a release, in every repository of the organisation. */
export const OWNER = "Undefined6799";

/** Problems with the environment, in plain words. An empty list means it may hold a release. */
export function gateProblems(environment, branchPolicies) {
  const problems = [];
  const rules = Array.isArray(environment?.protection_rules) ? environment.protection_rules : [];
  const reviewRules = rules.filter((rule) => rule?.type === "required_reviewers");
  const reviewers = reviewRules.flatMap((rule) => (Array.isArray(rule.reviewers) ? rule.reviewers : []));
  const onlyOwner =
    reviewRules.length === 1 &&
    reviewers.length === 1 &&
    reviewers[0]?.type === "User" &&
    reviewers[0]?.reviewer?.login === OWNER;
  if (!onlyOwner) problems.push(`the required reviewer must be ${OWNER}, and no one else`);
  if (reviewRules.some((rule) => rule.prevent_self_review === true)) {
    problems.push(`"Prevent self-review" is on, so ${OWNER} could not approve a run that the owner's own merge started`);
  }
  if (environment?.can_admins_bypass !== false) {
    problems.push('"Allow administrators to bypass configured protection rules" must be off (or GitHub did not say)');
  }
  const policy = environment?.deployment_branch_policy;
  const names = Array.isArray(branchPolicies?.branch_policies) ? branchPolicies.branch_policies : [];
  const onlyMain =
    policy?.custom_branch_policies === true &&
    policy?.protected_branches === false &&
    names.length === 1 &&
    names[0]?.name === "main" &&
    (names[0]?.type === undefined || names[0]?.type === "branch");
  if (!onlyMain) problems.push('deployment must be limited to "Selected branches and tags" with the one branch main');
  return problems;
}

if (startedAsScript(import.meta.url)) {
  const [environmentFile, policiesFile] = process.argv.slice(2);
  const problems = gateProblems(
    JSON.parse(readFileSync(environmentFile, "utf8")),
    JSON.parse(readFileSync(policiesFile, "utf8")),
  );
  for (const problem of problems) console.error(`release environment: ${problem}`);
  if (problems.length > 0) {
    console.error("Nothing was built or published. The owner fixes the environment in Settings > Environments.");
    process.exitCode = 1;
  } else {
    console.log(`release environment: only ${OWNER} approves, and only from main.`);
  }
}
