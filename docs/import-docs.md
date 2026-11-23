---
title: "Import reviewed documentation"
description: "Keep source-owned documentation current through checked pull requests into docs main."
weight: 16
type: docs
params:
  doc_kind: guide
  checked_source_revision: "082e488ec41047ae79e5da2ba4327538d0e758c6"
---

The shared documentation receiver prepares a pull request in `unset-sh/docs` when an allowlisted source's stable documentation changes. Source pages remain maintained in their owning repository. The receiver replaces one mirrored section, runs the existing required checks through explicit dispatch, and leaves merging to the normal review process.

This is an unreleased capability at version 0.0.0. Consumer adoption and a successful live generated-PR dispatch must be verified separately from the local tests described below.

## Source and destination

| Source key | Stable source | Source directory | Docs section | Required successful source workflow |
| --- | --- | --- | --- | --- |
| `tooling` | `unset-sh/tooling:main` | `docs/` | `tooling/` | `.github/workflows/automation-docs-self.yml` |
| `github` | `unset-sh/.github:main` | `docs/site/` | `github/` | `.github/workflows/docs-export.yml` |

These mappings are fixed in the reviewed central helper. The `.github` alias cannot overwrite the documentation framework's `.github/` directory. Adding another source requires a reviewed helper and caller change; an input cannot select an arbitrary repository, directory, branch, or destination.

The docs-owned caller runs hourly at minute 41 and on demand from its default `main` branch (docs has no staging branch, org-0010), with non-cancelling concurrency. Each source is processed independently. The source must have a successful, completed `push` export run on `main` for the exact resolved source commit. A successful pull-request export does not make that revision eligible.

## Follow an import

1. **Prepare with read-only permissions.** The receiver resolves source `main` once, checks the successful source run, and checks out that exact revision. The pinned tooling exporter reads committed documentation and the root licence through Git. It runs no source commands, package installation, hooks, or build scripts. The snapshot records the exact docs main base and is uploaded as `docs-import-<source>-<run-id>-<run-attempt>` for seven days.
2. **Validate before writing.** A separate job loads only the pinned central helper and the same-run snapshot. It checks the fixed mapping, complete file set, licence, index, paths, file hashes and provenance. It compares every document's Git blob identity with the immutable source tree and verifies the successful export run again. Source `main` and docs `main` must still match their selected commits.
3. **Prepare an owned PR.** The writer replaces only that source's section using Git objects. It uses `automation/docs-tooling` or `automation/docs-github` and targets `main`. An existing branch must contain a verifiable generated import and no changes outside its section. The writer rechecks both source and destination before updating the ref without force.
4. **Request the existing checks.** A separate Actions-writing job validates the actual bot PR and requests only docs `ci.yml` and `branch-policy.yml` on its exact branch. Each request passes the PR number, expected head and expected main base. It binds GitHub's returned run ID to the required workflow, repository, event and commit. Follow those run URLs to see their results; an accepted request is not a passed check.
5. **Review and merge to main.** Both dispatched adapters independently verify the actual open, non-draft bot PR, current head/base, complete section-only diff and source proof before satisfying the required check. The documentation job then runs the existing test, workflow-lint, ordinary-build and preview-build gates. The receiver never merges a PR. A person merges it into `main`, which publishes the site.

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

The receiver uses only the temporary job token, sent only to fixed `api.github.com/repos/unset-sh/docs` endpoints. Source metadata remains public and unauthenticated. Existing section files use exact-commit `raw.githubusercontent.com/unset-sh/docs` URLs without credentials or redirects; their sizes and Git blob hashes must match the API tree. The source exporter never receives a writing token. No stored cross-repository credential or source-owned publishing key is required.

Snapshots allow at most 256 files, 1 MiB per file, 8 MiB of decoded content and 12 MiB of snapshot JSON. Paths are portable, bounded and collision-free. Symlinks, submodules, hard-linked snapshots, incomplete Git trees and unexpected payload fields are refused. Prior section sizes are checked before any prior file is downloaded.

Immutable metadata is cached within each job. Anonymous REST requests have a per-helper budget of 48; public GitHub quotas also apply across requests sharing an egress address. The hourly schedule limits routine polling, but quota exhaustion, API errors, missing source exports and GitHub dispatch refusals still fail closed. Retry after the underlying condition is resolved. Do not add a credential or weaken a check to hide a failing run.

## Adopt or update the receiver

The implementation source is `workflows/shared/docs/import.yml`; its stable reusable entry point is `.github/workflows/automation-docs-import.yml`. Input `source` is required and accepts only the two keys above. Use a full reviewed tooling commit in the docs caller, its CI helper checkout, and its branch-policy caller. Preserve the exact existing required contexts: `Validate documentation` and `policy / Validate branch policy`.

Both docs required workflows need the three required string dispatch inputs `pull-request`, `expected-head`, and `expected-base`. Docs CI validates every manual dispatch before consumer checkout. Branch policy validates generated dispatches through the central router, limited to the docs import and organisation map families. Ordinary PR branch checks keep their existing event-metadata behavior. Do not replace failed proof with a skipped required job.

GitHub-created bot PR events may wait for approval. The explicit dispatch path supplies independently verified checks without trusting a fabricated PR event. Keep protection rules and review requirements in place. If docs adopts the separate PR-metadata policy later, first add a reviewed generated-PR dispatch adapter and narrowly scoped purpose-label handling; the receiver currently adds no issue-writing permission or additional required context.

Before enabling a caller, confirm that Actions may create PRs in docs and that both adapted workflows exist on the default branch. Merge the central implementation first, update all three consumer pins, run consumer checks, then perform one receiver run and verify the actual resulting PR and both required check runs. Production promotion remains a separate owner-reviewed action.

## Source and verification

The [shared workflow](https://github.com/unset-sh/tooling/blob/082e488ec41047ae79e5da2ba4327538d0e758c6/workflows/shared/docs/import.yml), [receiver CLI](https://github.com/unset-sh/tooling/blob/082e488ec41047ae79e5da2ba4327538d0e758c6/scripts/docs-import.mjs), [publication helper](https://github.com/unset-sh/tooling/blob/082e488ec41047ae79e5da2ba4327538d0e758c6/scripts/docs-import-publication.mjs), and [dispatch verifier](https://github.com/unset-sh/tooling/blob/082e488ec41047ae79e5da2ba4327538d0e758c6/scripts/docs-import-dispatch.mjs) define this contract. `npm run check` covers source substitution, path and hash refusal, token destinations, API failures, ref races, old-provenance validation, bounded reads, dispatch identity and workflow permissions. A real Git fixture verifies that advancing staging and updating an existing import produces a section-only three-dot diff with the expected parents.

The transport follows GitHub's [repository-scoped token rules](https://docs.github.com/en/actions/concepts/security/github_token), [artifact access requirements](https://docs.github.com/en/rest/actions/artifacts#download-an-artifact), and [workflow dispatch response contract](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event). Local tests establish implementation behavior; record live run URLs during adoption before calling the automation operational.
