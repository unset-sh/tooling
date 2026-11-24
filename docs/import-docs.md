---
title: "Import reviewed documentation"
description: "Keep source-owned documentation current through checked pull requests into docs main."
weight: 16
type: docs
params:
  doc_kind: guide
  checked_source_revision: "082e488ec41047ae79e5da2ba4327538d0e758c6"
---

The shared documentation receiver prepares a pull request in `unset-sh/docs` when an allowlisted source's stable documentation changes. Source pages remain maintained in their owning repository. The receiver replaces one mirrored section and requests supplemental validation through explicit dispatch. Those dispatched runs do not satisfy GitHub PR ruleset checks. With the current job-token publisher, a person must approve the ordinary PR workflow runs before the PR can satisfy its required checks.

This is an unreleased capability at version 0.0.0. PR creation and supplemental validation are implemented; unattended completion of required PR checks is not. Merging and production promotion remain separate review decisions.

## Source and destination

| Source key | Stable source | Source directory | Docs section | Required successful source workflow |
| --- | --- | --- | --- | --- |
| `tooling` | `unset-sh/tooling:main` | `docs/` | `tooling/` | `.github/workflows/automation-docs-self.yml` |
| `github` | `unset-sh/.github:main` | `docs/site/` | `github/` | `.github/workflows/docs-export.yml` |
| `brand` | `unset-sh/brand:main` | `docs/site/` | `brand/` | `.github/workflows/docs-export.yml` |
| `rendering` | `unset-sh/rendering:main` | `docs/site/` | `rendering/` | `.github/workflows/docs-export.yml` |
| `lexicons` | `unset-sh/lexicons:main` | `docs/` | `lexicons/` | `.github/workflows/docs-export.yml` |
| `agent-kit` | `unset-sh/agent-kit:main` | `docs/` | `agent-kit/` | `.github/workflows/docs-export.yml` |
| `web` | `unset-sh/web:main` | `docs/site/` | `web/` | `.github/workflows/docs-export.yml` |
| `backend` | `unset-sh/backend:main` | `docs/site/` | `backend/` | `.github/workflows/docs-export.yml` |
| `deployment` | `unset-sh/deployment:main` | `docs/site/` | `deployment/` | `.github/workflows/docs-export.yml` |
| `pds` | `unset-sh/pds:main` | `docs/site/` | `pds/` | `.github/workflows/docs-export.yml` |
| `modules` | `unset-sh/modules:main` | `docs/site/` | `modules/` | `.github/workflows/docs-export.yml` |

These mappings are fixed in the reviewed central helper. A source is imported only once docs lists its key in the receiver's matrix and the source's `main` has a successful export; repositories that use a staging branch publish only after promotion to `main`. The `.github` alias cannot overwrite the documentation framework's `.github/` directory. Adding another source requires a reviewed helper and caller change; an input cannot select an arbitrary repository, directory, branch, or destination.

The docs-owned caller runs hourly at minute 41 and on demand from its default `main` branch (docs has no staging branch, org-0010), with non-cancelling concurrency. Each source is processed independently. The source must have a successful, completed `push` export run on `main` for the exact resolved source commit. A successful pull-request export does not make that revision eligible.

## Follow an import

1. **Prepare with read-only permissions.** The receiver resolves source `main` once, checks the successful source run, and checks out that exact revision. The pinned tooling exporter reads committed documentation and the root licence through Git. It runs no source commands, package installation, hooks, or build scripts. The snapshot records the exact docs main base and is uploaded as `docs-import-<source>-<run-id>-<run-attempt>` for seven days.
2. **Validate before writing.** A separate job loads only the pinned central helper and the same-run snapshot. It checks the fixed mapping, complete file set, licence, index, paths, file hashes and provenance. It compares every document's Git blob identity with the immutable source tree and verifies the successful export run again. Source `main` and docs `main` must still match their selected commits.
3. **Prepare an owned PR.** The writer replaces only that source's section using Git objects. It uses `automation/docs-<source key>` (for example `automation/docs-tooling`) and targets `main`. An existing branch must contain a verifiable generated import and no changes outside its section. The writer rechecks both source and destination before updating the ref without force.
4. **Request supplemental validation.** A separate Actions-writing job validates the actual bot PR and requests only docs `ci.yml` and `branch-policy.yml` on its exact branch. Each request passes the PR number, expected head and expected main base. It binds GitHub's returned run ID to the intended workflow, repository, event and commit. Both adapters verify the actual open bot PR, head/base, section-only diff and source proof before running validation. The documentation job runs tests, workflow lint and both site builds. Follow the run URLs for these results; even successful dispatched runs do not clear PR ruleset requirements.
5. **Run the eligible PR checks before review and merge.** A user with write access can select **Approve workflows to run** on the generated PR to start its ordinary `pull_request` runs. Confirm that those required checks appear in the PR checks section and pass for its current revision. The receiver does not approve withheld runs, or merge a PR. A person merges it into `main`, which publishes the site.

An unchanged section creates no PR. When the document bytes match, the receiver retains valid older `source.json` provenance after checking its hashes and immutable source tree; unrelated source commits do not produce provenance-only churn. Missing or malformed provenance is repaired through a PR. A network or source-proof failure stops the import instead of treating provenance as valid.

## Branch history and concurrent changes

An initial import commit has the current docs main base as its parent. A source update on the same base appends to the existing import head. If docs main advances, the next import commit has two parents: the previous import head, then the new main base. Its tree preserves the current framework and every other section. This keeps GitHub's three-dot PR diff limited to the imported section while retaining a fast-forward update of the automation branch.

The receiver refuses a foreign branch, a closed unmerged import, an ambiguous PR history, or observed ref movement. It never adopts hand-edited changes on its automation branch. Review and resolve such changes before retrying. If a base changes during validation, rerun the receiver from current docs main; retrying the old run keeps its old `github.sha` and cannot bypass the revision check.

## Permissions and limits

| Job | Job permissions | Executed code |
| --- | --- | --- |
| Prepare | `contents: read` | Pinned central exporter and validators; source files are data |
| Publish | `contents: write`, `pull-requests: write` | Pinned central Git/PR publisher only |
| Dispatch | `contents: read`, `pull-requests: read`, `actions: write` | Pinned central target verifier and fixed check dispatcher only |
| Docs CI | `contents: read`, `pull-requests: read` | Pinned verifier first, then the verified docs revision |
| Branch policy | No permissions | Inline normal PR policy, or anonymously fetched exact central verifier for owned generated dispatches |

The receiver uses only the temporary job token. It is sent only to `api.github.com`, for `unset-sh/docs` and the allowlisted public source repositories; only docs endpoints accept writes. Source metadata is read with that token so the reads use its quota instead of the runner's shared anonymous one, which GitHub refused with HTTP 403 (decided by Alex, 2026-11-24). Existing section files use exact-commit `raw.githubusercontent.com/unset-sh/docs` URLs without credentials or redirects; their sizes and Git blob hashes must match the API tree. The source exporter never receives a writing token. No stored cross-repository credential or source-owned publishing key is required.

Snapshots allow at most 256 files, 1 MiB per file, 8 MiB of decoded content and 12 MiB of snapshot JSON. Paths are portable, bounded and collision-free. Symlinks, submodules, hard-linked snapshots, incomplete Git trees and unexpected payload fields are refused. Prior section sizes are checked before any prior file is downloaded.

Immutable metadata is cached within each job. Without a job token, REST requests are anonymous and have a per-helper budget of 48; public GitHub quotas then apply across requests sharing an egress address. The hourly schedule limits routine polling, but quota exhaustion, API errors, missing source exports and GitHub dispatch refusals still fail closed. Retry after the underlying condition is resolved. Do not add a credential or weaken a check to hide a failing run.

## Adopt or update the receiver

The implementation source is `workflows/shared/docs/import.yml`; its stable reusable entry point is `.github/workflows/automation-docs-import.yml`. Input `source` is required and accepts only the two keys above. Use a full reviewed tooling commit in the docs caller, its CI helper checkout, and its branch-policy caller. Preserve the exact existing required contexts: `Validate documentation` and `policy / Validate branch policy`.

The supplemental dispatch adapters require the three string inputs `pull-request`, `expected-head`, and `expected-base`. Docs CI validates every manual dispatch before consumer checkout. Branch policy validates generated dispatches through the central router, limited to the docs import and organisation map families. Ordinary PR branch checks keep their existing event-metadata behavior. Do not replace failed proof with a skipped required job.

GitHub creates approval-required `pull_request` runs when `GITHUB_TOKEN` opens, synchronizes or reopens a PR. Its `workflow_dispatch` exception starts supplemental runs, but GitHub explicitly excludes jobs from that event when evaluating PR ruleset checks. Matching the required job name and head SHA does not change this. See the [token-trigger rules](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs) and [required-check event restrictions](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#checks-from-some-workflow-jobs-are-not-evaluated).

For unattended ordinary PR runs, the publisher needs a separately approved authentication design using a scoped GitHub App installation token. That integration is not implemented here. Until then, retain human approval of the ordinary PR runs. Do not approve them automatically, manufacture status results or weaken protections. If docs later adopts PR-metadata policy, its purpose labels and eligible-event checks also need explicit integration; the receiver currently adds no issue-writing permission or additional required context.

Before enabling a caller, confirm that Actions may create PRs in docs and that both adapted workflows exist on the default branch. Merge the central implementation first, update all three consumer pins, run consumer checks, then perform one receiver run and verify its generated PR and supplemental runs. Separately confirm that the ordinary PR runs can be approved and that GitHub evaluates their results against the required contexts. Production promotion remains a separate owner-reviewed action.

## Source and verification

The [shared workflow](https://github.com/unset-sh/tooling/blob/082e488ec41047ae79e5da2ba4327538d0e758c6/workflows/shared/docs/import.yml), [receiver CLI](https://github.com/unset-sh/tooling/blob/082e488ec41047ae79e5da2ba4327538d0e758c6/scripts/docs-import.mjs), [publication helper](https://github.com/unset-sh/tooling/blob/082e488ec41047ae79e5da2ba4327538d0e758c6/scripts/docs-import-publication.mjs), and [dispatch verifier](https://github.com/unset-sh/tooling/blob/082e488ec41047ae79e5da2ba4327538d0e758c6/scripts/docs-import-dispatch.mjs) define this contract. `bun run check` covers source substitution, path and hash refusal, token destinations, API failures, ref races, old-provenance validation, bounded reads, dispatch identity and workflow permissions. A real Git fixture verifies that advancing staging and updating an existing import produces a section-only three-dot diff with the expected parents.

The transport follows GitHub's [repository-scoped token rules](https://docs.github.com/en/actions/concepts/security/github_token), [artifact access requirements](https://docs.github.com/en/rest/actions/artifacts#download-an-artifact), and [workflow dispatch response contract](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event). Local tests establish implementation behavior; verify PR-visible required-check eligibility as well as successful run URLs during adoption. In the [first verified import PR](https://github.com/unset-sh/docs/pull/10), both dispatched jobs passed on 2026-11-22, while GitHub excluded them from the PR checks section and kept the PR blocked. That observation confirms supplemental execution, not unattended required-check completion.
