---
title: "Import reviewed documentation"
description: "Keep source-owned documentation current through checked pull requests into docs main."
weight: 16
type: docs
params:
  doc_kind: guide
  checked_source_revision: "082e488ec41047ae79e5da2ba4327538d0e758c6"
---

The shared documentation receiver prepares a pull request in `unset-sh/docs` when an allowlisted source's stable documentation changes. Source pages remain maintained in their owning repository. An isolated publisher uses the organisation's scoped GitHub App to open or update the PR, which starts ordinary pull-request checks. The receiver never merges.

This capability remains unreleased at version 0.0.0. Activation requires the owner-managed main-only branch cutover, verified App installation identity, and manually stored key described in [Set up the automation App](../automation-app/). Local tests do not establish live PR-check eligibility; verify that during adoption.

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
3. **Prepare an owned PR.** The writer replaces only that source's section using Git objects. It uses `automation/docs-app-tooling` or `automation/docs-app-github` and targets `main`. An existing branch must contain a verifiable generated import and no changes outside its section. The writer rechecks both source and destination before updating the ref without force.
4. **Run ordinary PR checks.** The App-created PR or actual head update starts the existing `pull_request` workflows. Documentation CI runs tests, workflow lint and both site builds. Branch policy checks the real PR event. Confirm the required contexts `Validate documentation` and `policy / Validate branch policy` appear in the PR checks section and pass for its current revision.
5. **Review and merge.** A person reviews and merges the checked PR into `main`, which publishes the site. The receiver neither approves withheld runs nor merges. Title or body edits alone are not a head synchronization and are not used to restart checks.

An unchanged section creates no PR. When the document bytes match, the receiver retains valid older `source.json` provenance after checking its hashes and immutable source tree; unrelated source commits do not produce provenance-only churn. Missing or malformed provenance is repaired through a PR. A network or source-proof failure stops the import instead of treating provenance as valid.

## Branch history and concurrent changes

An initial import commit has the current docs main base as its parent. A source update on the same base appends to the existing import head. If docs main advances, the next import commit has two parents: the previous import head, then the new main base. Its tree preserves the current framework and every other section. This keeps GitHub's three-dot PR diff limited to the imported section while retaining a fast-forward update of the automation branch.

The new App branch namespace is separate from the earlier `automation/docs-tooling` and `automation/docs-github` job-token branches. Existing docs PR10 must be resolved by the owner as part of the main-only cutover; the App does not adopt, retarget or alter it.

The receiver refuses a foreign branch, a closed unmerged import, an ambiguous PR history, or observed ref movement. It never adopts hand-edited changes on its automation branch. Review and resolve such changes before retrying. If a base changes during validation, rerun the receiver from current docs main; retrying the old run keeps its old `github.sha` and cannot bypass the revision check.

## Permissions and limits

| Job | Job permissions | Executed code |
| --- | --- | --- |
| Prepare | `contents: read` | Pinned central exporter and validators; source files are data |
| Publish | Built-in token: `contents: read`; App token: Contents/Pull requests write in docs only | Pinned central Git/PR publisher only |
| Docs CI | `contents: read` | Ordinary PR documentation checks |
| Branch policy | No permissions in the shared job | Inline normal PR policy |

The App private key is the explicit `automation-app-private-key` reusable-workflow secret. Only the pinned `actions/create-github-app-token` step in the publisher receives it. The owner creates and stores it manually; agents never generate, read or place the key. The action mints for owner `unset-sh` and repository `docs` with only Contents/Pull requests write. The helper verifies the fixed public App slug and installation ID returned by the action, then requires the token's repository listing to contain exactly `unset-sh/docs`. Token cleanup attempts revocation; normal expiry within one hour is the fallback if cleanup fails.

The App token reaches only fixed GitHub API endpoints for docs and its installation scope check. Public source metadata remains unauthenticated. Existing section files use exact-commit `raw.githubusercontent.com/unset-sh/docs` URLs without credentials or redirects, verified by size and Git blob hash. No source code executes with the App token. The private key never enters a shell environment, and the CLI removes token environment values before any exporter subprocess.

Snapshots allow at most 256 files, 1 MiB per file, 8 MiB of decoded content and 12 MiB of snapshot JSON. Paths are portable, bounded and collision-free. Symlinks, submodules, hard-linked snapshots, incomplete Git trees and unexpected payload fields are refused. Prior section sizes are checked before any prior file is downloaded.

Immutable metadata is cached within each job. Anonymous REST requests have a per-helper budget of 48; public GitHub quotas also apply across requests sharing an egress address. The hourly schedule limits routine polling, but quota exhaustion, API errors, missing source exports and App authentication refusals still fail closed. Retry after the underlying condition is resolved. Do not widen token permissions or weaken a check to hide a failing run.

## Adopt or update the receiver

The implementation source is `workflows/shared/docs/import.yml`; its stable reusable entry point is `.github/workflows/automation-docs-import.yml`. Input `source` accepts only the two keys above. The caller grants the built-in token only `contents: read` and explicitly maps repository secret `UNSET_AUTOMATION_APP_PRIVATE_KEY` to `automation-app-private-key`. Never use `secrets: inherit`.

Use a full reviewed tooling commit in the docs receiver and branch-policy caller. CI and branch policy keep ordinary PR events; remove the previous generated-dispatch inputs and CI bootstrap adapter. Preserve both required context names. This version has no automatic dispatch job or Actions-writing token.

Complete the [owner setup and branch prerequisites](../automation-app/) before merging the caller. Run consumer checks, then perform one approved receiver run. Verify the generated App-owned PR, an ordinary `pull_request` run at its current revision, and the PR-visible required contexts. Successful standalone workflow runs are insufficient evidence.

The previous `GITHUB_TOKEN` publisher created approval-required PR runs. Its supplemental `workflow_dispatch` jobs could succeed while GitHub excluded them from PR ruleset evaluation, as observed on [docs PR10](https://github.com/unset-sh/docs/pull/10). This version uses an independent App token for the eligible PR event. See GitHub's [token-trigger rules](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs) and [required-check event restrictions](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#checks-from-some-workflow-jobs-are-not-evaluated). Historical supplemental helpers remain for older pins; they are not part of this receiver's automatic path.

If docs later adopts PR-metadata policy, its purpose labels and eligible-event checks need explicit integration. The receiver currently adds no issue-writing permission or extra required context.

## Source and verification

The [shared workflow](https://github.com/unset-sh/tooling/blob/082e488ec41047ae79e5da2ba4327538d0e758c6/workflows/shared/docs/import.yml), [receiver CLI](https://github.com/unset-sh/tooling/blob/082e488ec41047ae79e5da2ba4327538d0e758c6/scripts/docs-import.mjs), and [publication helper](https://github.com/unset-sh/tooling/blob/082e488ec41047ae79e5da2ba4327538d0e758c6/scripts/docs-import-publication.mjs) define the import contract. `npm run check` exercises source substitution, path/hash refusal, App identity and repository scope, token destinations, real CLI credential removal, API failures, ref races, provenance and bounded reads. A real Git fixture proves that advancing main and updating the import preserves its section-only three-dot diff and reconciliation parents.

The App action is pinned to [v3.3.0](https://github.com/actions/create-github-app-token/tree/64ab729a6294000f5aa4a4bc0b73d1f32bc45510), including its token revocation behavior. Installation scope follows GitHub's [repository listing contract](https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-app-installation). Local verification covers implementation behavior; live eligible-check verification remains an adoption prerequisite.
