// The release gate is what stops a release when the `release` environment is missing or loosened, so each
// way it can be loosened has a case here.
import assert from "node:assert/strict";
import { test } from "node:test";
import { OWNER, gateProblems } from "../scripts/release-gate.mjs";

function environment(overrides = {}, reviewRule = {}) {
  return {
    name: "release",
    protection_rules: [
      {
        type: "required_reviewers",
        prevent_self_review: false,
        reviewers: [{ type: "User", reviewer: { login: OWNER } }],
        ...reviewRule,
      },
    ],
    deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    can_admins_bypass: false,
    ...overrides,
  };
}

const mainOnly = { total_count: 1, branch_policies: [{ id: 1, name: "main" }] };

test("an environment where only the owner approves, only from main, passes", () => {
  assert.deepEqual(gateProblems(environment(), mainOnly), []);
  assert.deepEqual(gateProblems(environment(), { branch_policies: [{ name: "main", type: "branch" }] }), []);
});

test("an environment GitHub created on its own, with no protection, is refused", () => {
  const bare = { name: "release", protection_rules: [], deployment_branch_policy: null };
  assert.equal(gateProblems(bare, {}).length, 3);
});

test("a reviewer other than the owner, or one beside the owner, is refused", () => {
  for (const reviewers of [
    [],
    [{ type: "User", reviewer: { login: "someone-else" } }],
    [{ type: "Team", reviewer: { slug: OWNER } }],
    [
      { type: "User", reviewer: { login: OWNER } },
      { type: "User", reviewer: { login: "someone-else" } },
    ],
  ]) {
    assert.match(gateProblems(environment({}, { reviewers }), mainOnly).join("\n"), /required reviewer/);
  }
});

test("self-review turned off is refused, because the owner's merge starts the run", () => {
  assert.match(gateProblems(environment({}, { prevent_self_review: true }), mainOnly).join("\n"), /Prevent self-review/);
});

test("an administrator bypass that is on, or not reported, is refused", () => {
  for (const can_admins_bypass of [true, undefined, "false"]) {
    assert.match(gateProblems(environment({ can_admins_bypass }), mainOnly).join("\n"), /bypass/, String(can_admins_bypass));
  }
});

test("deployment from any branch or tag other than main is refused", () => {
  const cases = [
    [{ deployment_branch_policy: null }, mainOnly],
    [{ deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } }, mainOnly],
    [{}, {}],
    [{}, { branch_policies: [{ name: "main" }, { name: "release/*" }] }],
    [{}, { branch_policies: [{ name: "*" }] }],
    [{}, { branch_policies: [{ name: "main", type: "tag" }] }],
  ];
  for (const [overrides, policies] of cases) {
    assert.match(gateProblems(environment(overrides), policies).join("\n"), /the one branch main/, JSON.stringify(policies));
  }
});
