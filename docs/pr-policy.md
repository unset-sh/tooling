---
title: Pull-request policy checks
description: Require a purpose label and authored readiness, validation and documentation declarations without running pull-request code.
weight: 45
type: docs
params:
  doc_kind: guide
---

The reusable `ci-pr-policy.yml` check validates a pull request's current metadata. It requires exactly one
purpose label and completed readiness, validation and documentation fields. It never merges a PR or claims
that a declaration proves the implementation is correct.

The canonical [purpose labels](https://github.com/unset-sh/.github/pull/13) and
[readiness policy](https://github.com/unset-sh/agent-kit/pull/14) are being rolled out separately. This workflow
is opt-in. Tooling supplies its own caller and template; other consumers must provision the labels and
update their PR templates before making its result required.

## What it checks

- Exactly one of `kind:feature`, `kind:fix`, `kind:refactor`, `kind:docs` or `kind:maintenance` is applied to
  the PR. A label written only in the description does not count after enforcement is enabled.
- `## Readiness` has one checked `Independent` or `Dependent` choice, a `Prerequisites and order:` field
  and a `Tested combination:` field. Dependent work needs a written prerequisite description; `None` does
  not satisfy it.
- `## Validation` describes the checks and results or explicit verification limits.
- `## Documentation` names the updated source-owned pages or explains why no documentation change is
  needed. A placeholder, unchecked checklist or HTML template comment is not an answer.

The check ignores comments and code examples when reading the form. Duplicate headings, missing fields,
oversized metadata, unavailable GitHub responses and changed PR identities fail the check. It does not
check whether linked prerequisite releases exist, whether a claimed test ran or whether an explanation is
sufficient. Those decisions remain with the repository's integration checks and independent reviewer.

`kind:docs` grants no merge shortcut. Reviewers must distinguish maintained human documentation from
Markdown that changes agent behaviour. Every policy still applies to PRs created by automation.

## Add the caller

Save a small caller in the consuming repository's `.github/workflows/pr-policy.yml`. Replace the placeholder
with the full reviewed tooling commit. Reusable workflows remain directly under `.github/workflows/`;
their maintained source here is `workflows/shared/ci/pr-policy.yml`.

```yaml
name: pr-policy
on:
  pull_request:
    types: [opened, synchronize, reopened, edited, labeled, unlabeled, ready_for_review]
permissions: {}
concurrency:
  group: pr-policy-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  policy:
    uses: unset-sh/tooling/.github/workflows/ci-pr-policy.yml@FULL_REVIEWED_COMMIT
    permissions:
      contents: read
      pull-requests: read
```

The required result for this caller is `policy / PR policy`. Verify that exact name in a real run before
adding it to a ruleset. Avoid path filters or conditional skips on a required check. Metadata edits and
label changes must run the check again, even when no files changed.

The check fetches current PR metadata from GitHub and binds it to the event's repository, PR number and
head SHA. Its only checkout is tooling at the reusable workflow's exact implementation commit. It runs no
consumer code and needs no stored secret or write permission. Fork PRs may be inspected without checking
out their code; an unavailable read fails visibly.

Automated PR event handling follows GitHub's token restrictions. This workflow accepts `pull_request`
events only; it does not yet supply a manual-dispatch validation contract. Do not mark generated PRs ready
using a fabricated event or an unrelated successful run.

## Recover a failed check

Apply the correct label or fill in the named field and let the corresponding event run again. If the PR
head changed while metadata was read, rerun on its current head. An API failure is not an empty PR or a
passing policy check. Do not remove required checks to work around a failure.

References checked 2026-11-22:
[GitHub pull-request metadata](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request),
[pull-request events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request),
and [automatic token restrictions](https://docs.github.com/en/actions/concepts/security/github_token).
