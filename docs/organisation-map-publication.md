---
title: "Publish the organisation map"
description: "Prepare a generated organisation-map pull request whose ordinary PR checks run through a scoped GitHub App identity."
weight: 28
type: docs
params:
  doc_kind: reference
  checked_source_revision: "c2517bded6ea28a6e9ab286c1382613e07fb0d4c"
---

`automation-org-map.yml` is the shared implementation for `unset-sh/.github`'s committed map and profile views.
Its source lives in `workflows/github/docs/map.yml`. The publisher accepts only `MAP.md` and
`profile/README.md` in that fixed repository. It creates a generated-only PR into `main`; it never merges the PR
or writes a protected branch. The approved GitHub App creates the branch and PR so normal `pull_request` checks
can run without the approval required for PRs created with `GITHUB_TOKEN`.

## Register and call it

The consumer registers one map in `.github/maps.json`: id `organisation`, generator `scripts/map.mjs`, arguments
`["--write"]`, and outputs `["MAP.md", "profile/README.md"]`. This workflow validates that exact registration.
The website's generic `automation-maps-refresh.yml` still accepts JSON snapshots under `data/` only.

Use a reviewed full commit pin for `.github/workflows/automation-org-map.yml`. The caller supplies main-push,
scheduled and manual events, serial concurrency, `contents: read`, and exactly one named secret:
`automation-app-private-key`. Its value comes from the consumer's configured App key secret. Do not use
`secrets: inherit`, pass a pre-minted token, or configure an alternate owner, repository or command.

The shared public App configuration fixes its identity. Only the isolated publisher job reads the key. It uses the
pinned official `actions/create-github-app-token` action to mint a short-lived token for owner `unset-sh`, repository
`.github`, and only contents-write and pull-requests-write permissions. The built-in job token remains read-only.
The action attempts to revoke the App token in its post step; if cleanup fails, it expires within one hour. The token is a masked step output within the publisher. Keys and tokens are not exported between jobs or
included in artifacts or documentation.

Complete the separately approved main-only promotion, default-branch/rules migration and caller `flow: main`
cutover before repinning or activating this publisher. The App installation and repository secret must also be
configured. App
installation must not grant ruleset bypass or administrator permissions. Ordinary required checks and independent
review remain in force. A failed or missing App configuration fails publication; it does not fall back to the
built-in token.

## What it verifies

1. Check out the exact source revision and the running workflow's own pinned helpers with credentials disabled.
2. Regenerate the map and run repository checks with read-only permissions and no App credential.
3. Verify that only the two registered output files changed and stage bounded regular UTF-8 files.
4. Download the same run and attempt's artifact in a separate job containing only trusted tooling code.
5. Verify the fixed App identity and repository token scope, the immutable snapshot, current main revision, and
   authored README text outside its unique marker pair.
6. If output changed, create or reuse `automation/map-<source-commit>` with the exact generated tree and sole source
   parent, then open its App-owned PR into `main`. A retry refuses a foreign, legacy job-token, closed or modified PR.
7. Let GitHub's ordinary PR events run the existing checks. The publisher neither dispatches replacement checks nor
   grants itself Actions-write permission.

Unchanged output creates no branch or PR. Changed output produces an open PR URL. Creating the PR does not prove
its checks passed: inspect the PR checks and review the generated diff before merging. The publisher does not
approve runs, set synthetic passing statuses, force-push, merge, change protections or promote other repositories.
`unset-sh/.github` uses its main-only branch model (org-0010).

## Example: a repository ownership change

After a reviewed `repos.json` change reaches main, generation checks that exact revision and renders the views.
The publisher creates a branch with that source commit as its only parent and only the registered output changes.
The App's PR creation triggers the consumer's normal map, documentation and branch-policy checks. Required-check
names and branch protections remain unchanged. A person reviews and merges the generated PR normally.

The committed GitHub map and organisation profile do not change on main until that merge. The website's live JSON
maps use the separate [automatic map refresh](map-refresh.md#keep-the-docs-timer-on-main), which can collect from
public sources without merging this generated Markdown PR.

## Failures and limits

Generation and validation failures leave the published views unchanged. Observed changes to main stop publication;
regenerate from the new base instead of overwriting a branch. A retry can reuse a branch and PR only when their
parent, complete tree, author and head match the same validated snapshot. Closed or modified PRs are never silently
reopened or adopted. Schedules are best effort and older queued runs may refuse.

If PR creation fails after branch creation, inspect the existing branch before retrying. Publication reports an
open PR; it does not wait for checks or merge automatically. GitHub App authentication removes the special
job-token workflow-approval hurdle. It does not bypass required checks, independent review, merge conflicts or
branch rules. The App needs only the approved repositories and contents/PR permissions; a failed run is not a
reason to expand its access.

Older pinned implementations may still request supplemental `workflow_dispatch` validation. Those results do not
satisfy PR ruleset checks. Current callers use normal PR events instead. See GitHub's [token-trigger rules](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs)
and [required-check event restrictions](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#checks-from-some-workflow-jobs-are-not-evaluated).

The publisher does not rewrite `repos.json`, infer ownership or change authored explanations. Source metadata still
requires review; the separate drift report identifies differences from public GitHub metadata. Workflow maps continue
to extract committed YAML and call relationships through the catalogue collector.

Generated files are limited to 1 MiB each and the JSON snapshot to 3 MiB. API responses are bounded; errors omit
credentials and response bodies. Tests cover wrong App identity and scope, changed refs, foreign PRs, extra paths,
modified profile prose, unsafe blobs, and absence of merge/protected-ref mutations. Live App adoption and the first
ordinary PR check run require separate runtime evidence.

## Source and maintenance

Alex reviews this reference with workflow changes and before releases. The central source is
`workflows/github/docs/map.yml`; `scripts/generated-map-publication.mjs` owns the immutable publication proof,
and the common App helper owns identity and scope checks. The workflow permission tests and publisher tests cover
these boundaries. See the [repository rules](https://github.com/unset-sh/tooling/blob/c2517bded6ea28a6e9ab286c1382613e07fb0d4c/CLAUDE.md).
