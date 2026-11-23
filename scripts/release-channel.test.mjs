import assert from "node:assert/strict";
import { test } from "node:test";
import { channelVersion, releaseContext, requirePromotion, requireEnvironment, requireRules } from "./release-channel.mjs";

const sha = (c) => c.repeat(40);
const repository = "unset-sh/example";
const event = (ref = "refs/heads/staging") => ({ ref, before: sha("a"), after: sha("b"), created: false,
  deleted: false, forced: false, repository: { full_name: repository, private: false } });
const context = (ref = "refs/heads/staging") => releaseContext({ event: event(ref), eventName: "push", repository,
  sha: sha("b"), ref, runId: "12345", runAttempt: "2" });
const promotion = () => ({ number: 17, state: "closed", merged: true, merge_commit_sha: sha("b"),
  base: { ref: "main", repo: { full_name: repository } },
  head: { ref: "staging", sha: sha("c"), repo: { full_name: repository } } });
const merge = () => ({ sha: sha("b"), parents: [{ sha: sha("a") }, { sha: sha("c") }] });
const environment = (branch = "staging") => ({ name: `release-${branch === "main" ? "stable" : "staging"}`,
  can_admins_bypass: false, protection_rules: [{ type: "branch_policy" }],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } });
const policies = (branch = "staging") => ({ total_count: 1, branch_policies: [{ name: branch, type: "branch" }] });
const rules = (branch = "staging") => ({ enforcement: "active", bypass_actors: [],
  conditions: { ref_name: { include: [`refs/heads/${branch}`], exclude: [] } },
  rules: [{ type: "deletion" }, { type: "non_fast_forward" },
    { type: "pull_request", parameters: { allowed_merge_methods: branch === "main" ? ["merge"] : ["squash", "merge"] } },
    { type: "required_status_checks", parameters: { strict_required_status_checks_policy: true,
      required_status_checks: [{ context: "Check", integration_id: 15368 }] } }] });

test("staging derives an immutable prerelease while stable retains its reviewed source version", () => {
  assert.equal(channelVersion("1.4.0", context()), "1.4.0-staging.12345.2");
  assert.equal(channelVersion("1.4.0", context("refs/heads/main")), "1.4.0");
  assert.equal(channelVersion("0.0.0", context()), null);
  assert.equal(channelVersion("0.0.0", context("refs/heads/main")), null);
  for (const version of ["1.0.0-rc.1", "01.0.0", "1.0.0\n", "1.0.0+build", "../v1", "1.0", "9007199254740992.0.0"]) {
    assert.throws(() => channelVersion(version, context()), /version/i);
  }
});

test("a release context refuses non-push, forked, private, forced, created, deleted and mismatched events", () => {
  assert.deepEqual(context(), { repository, sha: sha("b"), before: sha("a"), branch: "staging", channel: "staging",
    environment: "release-staging", runId: "12345", runAttempt: "2" });
  const valid = { event: event(), eventName: "push", repository, sha: sha("b"), ref: "refs/heads/staging", runId: "12345", runAttempt: "2" };
  assert.equal(releaseContext({ ...valid, repository: "unset-sh/.github",
    event: { ...event(), repository: { full_name: "unset-sh/.github", private: false } } }).repository, "unset-sh/.github");
  for (const change of [{ eventName: "workflow_dispatch" }, { ref: "refs/tags/v1.0.0" }, { sha: sha("c") },
    { repository: "other/example" }, { runId: "01" }, { runAttempt: "0" }, { runId: "1\n" },
    ...["created", "deleted", "forced"].map((key) => ({ event: { ...event(), [key]: true } })),
    { event: { ...event(), repository: { full_name: "fork/example", private: false } } },
    { event: { ...event(), repository: { full_name: repository, private: true } } },
    { event: { ...event(), before: "0".repeat(40) } }]) {
    assert.throws(() => releaseContext({ ...valid, ...change }));
  }
});

test("stable requires the exact merged same-repository staging head as the merge second parent", () => {
  assert.equal(requirePromotion(context("refs/heads/main"), merge(), [promotion()]), 17);
  for (const change of [{ merged: false }, { state: "open" }, { merge_commit_sha: sha("d") },
    { head: { ...promotion().head, ref: "feature" } }, { head: { ...promotion().head, sha: sha("d") } },
    { head: { ...promotion().head, repo: { full_name: "fork/example" } } },
    { base: { ref: "staging", repo: { full_name: repository } } }]) {
    assert.throws(() => requirePromotion(context("refs/heads/main"), merge(), [{ ...promotion(), ...change }]), /promotion/i);
  }
  for (const changed of [{ ...merge(), sha: sha("e") }, { ...merge(), parents: [{ sha: sha("c") }] },
    { ...merge(), parents: [{ sha: sha("c") }, { sha: sha("a") }] }]) {
    assert.throws(() => requirePromotion(context("refs/heads/main"), changed, [promotion()]), /merge|promotion/i);
  }
  assert.throws(() => requirePromotion(context("refs/heads/main"), merge(), []), /promotion/i);
  assert.throws(() => requirePromotion(context("refs/heads/main"), merge(), [promotion(), { ...promotion(), number: 18 }]), /promotion/i);
});

test("automatic channel environments must already restrict exactly one branch without bypass or approvals", () => {
  for (const branch of ["main", "staging"]) assert.doesNotThrow(() => requireEnvironment(context(`refs/heads/${branch}`), environment(branch), policies(branch)));
  for (const changed of [null, {}, { ...environment(), can_admins_bypass: true }, { ...environment(), can_admins_bypass: undefined },
    { ...environment(), name: "release" }, { ...environment(), protection_rules: [] },
    { ...environment(), protection_rules: [{ type: "branch_policy" }, { type: "required_reviewers", reviewers: [] }] },
    { ...environment(), protection_rules: [{ type: "branch_policy" }, { type: "wait_timer", wait_timer: 1 }] },
    { ...environment(), deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } }]) {
    assert.throws(() => requireEnvironment(context(), changed, policies()), /environment/i);
  }
  for (const changed of [{ total_count: 0, branch_policies: [] }, policies("main"),
    { total_count: 2, branch_policies: [...policies().branch_policies, { name: "*", type: "branch" }] },
    { total_count: 1, branch_policies: [{ name: "staging", type: "tag" }] }]) {
    assert.throws(() => requireEnvironment(context(), environment(), changed), /environment/i);
  }
});

test("release authority refuses disabled, visibly bypassable, permissive or incomplete branch rules", () => {
  for (const branch of ["main", "staging"]) assert.doesNotThrow(() => requireRules(context(`refs/heads/${branch}`), [rules(branch)]));
  assert.doesNotThrow(() => requireRules(context(), [{ ...rules(), bypass_actors: undefined }]));
  for (const changed of [{ ...rules(), enforcement: "disabled" }, { ...rules(), enforcement: "evaluate" },
    { ...rules(), bypass_actors: [{ actor_type: "OrganizationAdmin", bypass_mode: "always" }] },
    { ...rules(), conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } } },
    ...rules().rules.map((entry) => ({ ...rules(), rules: rules().rules.filter((x) => x.type !== entry.type) }))]) {
    assert.throws(() => requireRules(context(), [changed]), /rules/i);
  }
  assert.throws(() => requireRules(context(), []), /rules/i);
  const unsafe = rules("main"); unsafe.rules[2].parameters.allowed_merge_methods = ["merge", "squash"];
  assert.throws(() => requireRules(context("refs/heads/main"), [unsafe]), /rules/i);
});
