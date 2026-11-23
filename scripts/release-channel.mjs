// Release authority is checked before building and again before privileged publication.
// GitHub's same-account identity cannot establish that a human performed a promotion.
// https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit
// https://docs.github.com/en/rest/deployments/environments#get-an-environment
// https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch (read 2026-11-23)

const matches = (pattern, value) => typeof value === "string" && pattern.exec(value)?.[0] === value;
export const stableVersion = (value) => matches(/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)/, value) && value.length <= 64 &&
  value.split(".").every((component) => Number.isSafeInteger(Number(component)));
export const fullCommit = (value) => matches(/[0-9a-f]{40}/, value);
const positive = (value) => matches(/[1-9][0-9]{0,19}/, value);
const insist = (condition, message) => { if (!condition) throw new Error(message); };

export function releaseContext({ event, eventName, repository, sha, ref, runId, runAttempt }) {
  insist(eventName === "push" && ["refs/heads/staging", "refs/heads/main"].includes(ref), "Release requires a push to staging or main");
  insist(matches(/unset-sh\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}/, repository) && event?.repository?.full_name === repository &&
    event.repository.private === false, "Release requires the same public organisation repository");
  insist(fullCommit(sha) && event.after === sha && event.ref === ref && fullCommit(event.before) && event.before !== "0".repeat(40) &&
    event.created === false && event.deleted === false && event.forced === false, "Release push identity is missing, forced or inconsistent");
  insist(positive(runId) && positive(runAttempt), "Release requires positive run identifiers");
  const branch = ref.slice(11);
  const channel = branch === "main" ? "stable" : "staging";
  return { repository, sha, before: event.before, branch, channel, environment: `release-${channel}`, runId, runAttempt };
}

export function channelVersion(version, context) {
  insist(stableVersion(version), "Source version must be three plain numbers");
  if (version === "0.0.0") return null;
  return context.channel === "stable" ? version : `${version}-staging.${context.runId}.${context.runAttempt}`;
}

/** Only the exact merge is relevant: staging is free to advance after promotion. */
export function requirePromotion(context, commit, pulls) {
  insist(context.channel === "stable" && commit?.sha === context.sha && Array.isArray(commit.parents) && commit.parents.length === 2 &&
    commit.parents[0]?.sha === context.before && fullCommit(commit.parents[1]?.sha), "Stable release requires the exact two-parent promotion merge");
  insist(Array.isArray(pulls) && pulls.length < 100, "Invalid or truncated promotion lookup");
  const matching = pulls.filter((pr) => Number.isSafeInteger(pr.number) && pr.number > 0 && pr.state === "closed" && pr.merged === true &&
    pr.merge_commit_sha === context.sha && pr.base?.ref === "main" && pr.base.repo?.full_name === context.repository &&
    pr.head?.ref === "staging" && pr.head.repo?.full_name === context.repository && pr.head.sha === commit.parents[1].sha);
  insist(matching.length === 1, "Stable release requires one exact merged same-repository staging promotion");
  return matching[0].number;
}

export function requireEnvironment(context, environment, policies) {
  const protections = environment?.protection_rules;
  const selection = environment?.deployment_branch_policy;
  const branches = policies?.branch_policies;
  insist(environment?.name === context.environment && environment.can_admins_bypass === false && Array.isArray(protections) &&
    protections.length === 1 && protections[0]?.type === "branch_policy" && selection?.protected_branches === false &&
    selection.custom_branch_policies === true && policies?.total_count === 1 && Array.isArray(branches) && branches.length === 1 &&
    branches[0]?.name === context.branch && branches[0]?.type === "branch",
  `Environment ${context.environment} must already exist, allow only branch ${context.branch}, and have no manual approval or administrator bypass`);
}

export function requireRules(context, rulesets) {
  insist(Array.isArray(rulesets) && rulesets.length > 0 && rulesets.length <= 20, "Release requires active branch rules");
  const protectedBranch = rulesets.some((set) => {
    const refs = set?.conditions?.ref_name;
    // GitHub omits bypass_actors without ruleset write access. Settings audit owns
    // the no-bypass requirement; omission here is not evidence of an empty list.
    if (set?.enforcement !== "active" || (set.bypass_actors !== undefined &&
        (!Array.isArray(set.bypass_actors) || set.bypass_actors.length !== 0)) ||
        !Array.isArray(refs?.include) || refs.include.length !== 1 || refs.include[0] !== `refs/heads/${context.branch}` ||
        !Array.isArray(refs.exclude) || refs.exclude.length !== 0 || !Array.isArray(set.rules)) return false;
    const rules = set.rules;
    const pr = rules.find((rule) => rule.type === "pull_request")?.parameters;
    const checks = rules.find((rule) => rule.type === "required_status_checks")?.parameters;
    const methods = pr?.allowed_merge_methods;
    return rules.some((rule) => rule.type === "deletion") && rules.some((rule) => rule.type === "non_fast_forward") &&
      Array.isArray(methods) && methods.length > 0 && methods.every((method) => ["squash", "merge"].includes(method)) &&
      (context.branch !== "main" || (methods.length === 1 && methods[0] === "merge" && !rules.some((rule) => rule.type === "required_linear_history"))) &&
      checks?.strict_required_status_checks_policy === true && Array.isArray(checks.required_status_checks) &&
      checks.required_status_checks.length > 0 && checks.required_status_checks.length <= 50 &&
      checks.required_status_checks.every((check) => typeof check.context === "string" && check.context.trim() === check.context &&
        check.context.length > 0 && check.context.length <= 200 && check.integration_id === 15368);
  });
  insist(protectedBranch, "Release requires exact-branch active PR/check rules without visible bypass or incompatible merge methods");
}
