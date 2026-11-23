---
title: "Publish the organisation map"
description: "Update the organisation's committed Markdown views from checked source data."
weight: 28
type: docs
params:
  doc_kind: reference
---

`automation-org-map.yml` is the shared implementation for `unset-sh/.github`'s committed map and profile views.
Its source lives in `workflows/github/docs/map.yml`. Unlike the website's JSON-only map refresh runner, this
publisher has a fixed repository and accepts only `MAP.md` and `profile/README.md`. It has no caller-supplied
command, output path, repository or credential input.

## Register and call it

The consumer registers one map in `.github/maps.json`: id `organisation`, generator `scripts/map.mjs`, arguments
`["--write"]`, and outputs `["MAP.md", "profile/README.md"]`. This dedicated workflow validates that exact
registration. The generic `automation-maps-refresh.yml` still rejects Markdown and stages JSON under `data/` only.

Use a reviewed full commit pin for `.github/workflows/automation-org-map.yml`. The caller supplies main-push,
scheduled and manual events, serial concurrency, and the `contents: write` and `pull-requests: write` maximum
permissions. The reusable workflow restricts generation to `contents: read` and gives writing permissions only
to its isolated publisher. Both jobs reject other repositories, refs and events before checkout.

## What it verifies

1. Check out the exact source revision and this workflow's own pinned helpers with credentials disabled.
2. Regenerate the map and run the consumer's checks without a write token.
3. Verify that only the two registered generated files changed and stage bounded, regular UTF-8 files.
4. Download this run and attempt's named artifact in a separate job containing only trusted tooling code.
5. Validate the snapshot, current main revision and authored README text outside its unique marker pair.
6. If output changed, create a branch and generated-only PR, then request a squash merge for the exact head.
   Recheck main immediately before the merge request. GitHub still enforces its merge restrictions.

Unchanged output creates no branch or PR. No step force-pushes, writes main directly, changes protections,
approves workflow runs or sets a passing status for unexecuted checks. The update needs no additional owner
review for generated content. Changes to source declarations or publisher code follow their normal review.

## Failures and limits

Generation and validation failures retain the previous published views. Observed changes to main stop publication.
GitHub's merge API protects the PR head, not the base atomically: a source change after the last check can leave
a temporarily stale view. A successful current-main hourly or manual run restores it; schedules can be delayed,
and queued runs from older revisions may refuse. A retry can reuse its existing
branch and PR only when their parent, complete tree and head match the same validated snapshot. Merge refusals
leave the prepared PR and report a failure.

Actions must be permitted to create PRs, and repository protections may require additional checks. This workflow
does not bypass those requirements. `GITHUB_TOKEN` writes do not generally trigger new runs; bot-created PR
checks may await permission. The authoritative validation for this narrowly generated update is the read-only
generation job, not an assumed later bot-PR run.

The publisher does not rewrite `repos.json`, infer ownership or change authored explanations. Source metadata
must still describe the intended relationships; the separate drift report identifies missing public facts.
Workflow maps continue to extract actual YAML and call relationships through the existing catalogue collector.

References checked on 2026-11-22: GitHub REST [Git database](https://docs.github.com/en/rest/git),
[pull-request merging](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request), and
[workflow triggering](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
