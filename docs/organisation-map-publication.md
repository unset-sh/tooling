---
title: "Publish the organisation map"
description: "Prepare and check a generated organisation-map pull request without promoting production."
weight: 28
type: docs
params:
  doc_kind: reference
  checked_source_revision: "c2517bded6ea28a6e9ab286c1382613e07fb0d4c"
---

`automation-org-map.yml` is the shared implementation for `unset-sh/.github`'s committed map and profile views.
Its source lives in `workflows/github/docs/map.yml`. Unlike the website's JSON-only map refresh runner, this
publisher has a fixed repository and accepts only `MAP.md` and `profile/README.md`. It has no caller-supplied
command, output path, repository or credential input.

The publisher creates PRs into `main` and requests supplemental validation. Dispatched jobs do not satisfy GitHub PR ruleset checks. With the current `GITHUB_TOKEN` publisher, a person must approve the ordinary PR workflow runs before their required results can unblock the PR.

## Register and call it

The consumer registers one map in `.github/maps.json`: id `organisation`, generator `scripts/map.mjs`, arguments
`["--write"]`, and outputs `["MAP.md", "profile/README.md"]`. This dedicated workflow validates that exact
registration. The generic `automation-maps-refresh.yml` still rejects Markdown and stages JSON under `data/` only.

Use a reviewed full commit pin for `.github/workflows/automation-org-map.yml`. The caller supplies main-push,
scheduled and manual events, serial concurrency, and maximum permissions of `contents: write`,
`pull-requests: write`, and `actions: write`. Generation has only `contents: read`. The publisher receives content
and PR writes; a third dispatch job receives only contents-read, PR-read and Actions-write. No writer runs consumer
code. All three jobs reject other repositories, refs and events before checkout.

Adopt this workflow together with the consumer's generated-PR dispatch adapters and the shared branch-policy
dispatch route. The initial fixed adapters are `.github`'s `org-map.yml`, `docs-export.yml` and `branch-policy.yml`.
Their `workflow_dispatch` inputs are `pull-request` (a positive numeric string), `expected-head` and `expected-base`
(full commit SHAs). They run on the bot branch, bind the real PR to those inputs, and retain the existing job names: `Check the organisation map`, `check / Check`, and `policy / Validate branch policy`. The `workflow_dispatch` results are supplemental even when their names match required contexts. A missing adapter fails
dispatch; the ordinary eligible-event checks are still required. These capabilities do not activate until the consumer's
reviewed caller changes land.

## What it verifies

1. Check out the exact source revision and this workflow's own pinned helpers with credentials disabled.
2. Regenerate the map and run the consumer's checks without a write token.
3. Verify that only the two registered generated files changed and stage bounded, regular UTF-8 files.
4. Download this run and attempt's named artifact in a separate job containing only trusted tooling code.
5. Validate the snapshot, current main revision and authored README text outside its unique marker pair.
6. If output changed, create or reuse `automation/map-<source-commit>` and an exact generated-only PR into `main`.
   Emit only its number, head and base to the separate dispatcher.
7. Re-read the actual open bot-owned PR and its immutable source/head trees. Require its sole source parent,
   unchanged files outside the two outputs, bounded regular files and preserved authored profile text.
8. Dispatch the three fixed workflows for supplemental validation with the same PR/head/base inputs. Confirm each returned run belongs
   to its expected workflow and head. Generated map validation must also prove regeneration leaves the committed
   `MAP.md` and `profile/README.md` unchanged; the dispatch must never enter the writable drift-report path.

Unchanged output creates no branch or PR. The result is an open PR into `main` and links to requested check runs.
Accepted dispatch does not prove validation succeeded, and successful dispatched jobs do not satisfy PR ruleset checks. No step merges, force-pushes, writes a protected ref, changes
protections, approves withheld workflow runs or sets a passing status for an unexecuted check. Normal independent
review and required checks apply, and a person merges the PR into main. `unset-sh/.github` has no staging
branch (org-0010).

## Example: a repository ownership change

After a reviewed `repos.json` change reaches main, the caller checks that exact revision and produces new map
views. The publisher prepares a branch whose only parent is that main revision and whose only possible changes
are the generated outputs. The isolated dispatcher requests supplemental validation at the new branch's exact head. A
reviewer can inspect those results, then approve the ordinary PR workflow runs. Confirm that the PR checks section shows the required results passing before a person merges it.

The committed GitHub map and organisation profile do not change on main until a person merges that PR. The website's
live JSON maps use the separate [automatic map refresh](map-refresh.md#keep-the-docs-timer-on-main)
and can refresh from their configured public sources without merging this generated Markdown PR. These are distinct
publication paths.

## Failures and limits

Generation and validation failures retain the previous published views. Observed changes to main stop publication
or dispatch; regenerate from the new base instead of overwriting a branch. A retry can reuse its existing branch
and PR only when their parent, complete tree and head match the same validated snapshot. Closed or modified PRs are
not silently reopened or adopted. Schedules are best effort and queued runs from older revisions may refuse.

If dispatch fails partway through, inspect the existing check runs before retrying because some may already exist.
Run URLs are validated and reported, but the publisher does not wait for completion or merge automatically. A late
base change makes dispatched verification fail; strict required checks and normal review still apply before merge.

Actions must be permitted to create PRs. GitHub creates approval-required `pull_request` runs when `GITHUB_TOKEN` opens, synchronizes or reopens a PR. A user with write access can select **Approve workflows to run**. The bounded dispatch path verifies the actual generated PR before consumer execution, but it does not approve these ordinary PR runs or satisfy their ruleset requirements. GitHub explicitly excludes `workflow_dispatch` job results from PR ruleset checks, even when they pass at the correct head and use the required names. See the [token-trigger rules](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs) and [required-check event restrictions](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#checks-from-some-workflow-jobs-are-not-evaluated).

Unattended ordinary PR runs require a separately approved publisher authentication design using a scoped GitHub App installation token. That integration is not implemented here. Until then, preserve manual approval, required checks and normal review. Successful supplemental run URLs alone are not evidence that a PR can merge.

The publisher does not rewrite `repos.json`, infer ownership or change authored explanations. Source metadata
must still describe the intended relationships; the separate drift report identifies missing public facts.
Workflow maps continue to extract actual YAML and call relationships through the existing catalogue collector.

The verifier caps complete trees at 10,000 entries and each generated file at 1 MiB. Snapshot staging retains its
3 MiB JSON limit. API data is bounded, errors omit response bodies and credentials, and every source file identity
is tied to an immutable Git object. The tests cover changed refs, forged PRs, extra paths, modified profile prose,
unsafe blobs, returned-run identity mismatches, and the absence of merge or protected-ref mutations. Actual adapter
adoption and first-run evidence must be checked separately from these local tests.

Required-check and token-trigger references checked on 2026-11-22. API references: GitHub REST [Git database](https://docs.github.com/en/rest/git) and
[workflow dispatch](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

## Source and maintenance

This reference describes the unreleased implementation at `c2517bded6ea28a6e9ab286c1382613e07fb0d4c`. See the [workflow](https://github.com/unset-sh/tooling/blob/c2517bded6ea28a6e9ab286c1382613e07fb0d4c/workflows/github/docs/map.yml), [publication and PR verifier](https://github.com/unset-sh/tooling/blob/c2517bded6ea28a6e9ab286c1382613e07fb0d4c/scripts/generated-map-publication.mjs), [isolated dispatcher](https://github.com/unset-sh/tooling/blob/c2517bded6ea28a6e9ab286c1382613e07fb0d4c/scripts/generated-map-checks.mjs), and [dispatch tests](https://github.com/unset-sh/tooling/blob/c2517bded6ea28a6e9ab286c1382613e07fb0d4c/scripts/generated-map-checks.test.mjs). Alex reviews this page with workflow changes and before releases, following the [repository rules](https://github.com/unset-sh/tooling/blob/c2517bded6ea28a6e9ab286c1382613e07fb0d4c/CLAUDE.md).
