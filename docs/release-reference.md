---
title: "Release workflow reference"
description: "Inputs, permissions, approval gates, verification, and recovery for the shared release workflow."
weight: 30
type: docs
params:
  doc_kind: reference
  checked_source_revision: "c7a291f820c5fc7b8ceb732954e0141c8c31b2e3"
---

This reference describes `.github/workflows/releases-package.yml`, generated from `workflows/shared/releases/package.yml`, at `c7a291f820c5fc7b8ceb732954e0141c8c31b2e3`. The implementation is **unreleased, at version 0.0.0**. The workflow publishes nothing at that version. Its source checks do not establish that a complete GitHub release has run successfully.

## Trigger and ownership

The workflow is reusable through `workflow_call`. The consuming repository supplies a caller triggered by a push to `main` when `package.json` changes. The release workflow itself refuses any event other than a push to `refs/heads/main`.

`unset-sh/tooling` owns the implementation. The consumer owns its version, changelog, build commands, and artifacts. The jobs use the consumer's GitHub token; Alex, whose GitHub login is `Undefined6799`, approves publication through the consumer's protected `release` environment. The implementation is intended for public repositories and performs unauthenticated tag lookups.

## Prerequisites

Alex manages the first three settings before a repository adopts this workflow:

1. A `release` environment with `Undefined6799` as the only required reviewer, **Prevent self-review** off, administrator bypass off, and deployment limited to the single branch `main` under **Selected branches and tags**.
2. Release immutability enabled for future releases.
3. A ruleset protecting `main` with pull requests and the appropriate required checks.
4. A `package.json` version consisting of three numeric components. Keep `0.0.0` until the first release is approved.
5. A `CHANGELOG.md` entry headed `## v<version>` for the version being released.
6. A `.nvmrc` naming the Node version for the consumer's check and build.

An existing version tag without a corresponding GitHub release must be reconciled before adoption. The workflow refuses it. The environment validator also refuses absent or incompatible protection settings; the owner fixes those settings rather than bypassing the check.

## Inputs and outputs

| Input | Type | Default | Meaning |
| --- | --- | --- | --- |
| `install` | Boolean | `false` | Run `npm ci --ignore-scripts` before checking. |
| `check` | String | `npm run check` | Consumer command that must succeed before building. |
| `build` | String | Empty | Optional consumer command producing release files. |
| `files` | String | Empty | Repository-relative directory whose direct files are attached and attested. |
| `npm-package` | Boolean | `false` | Pack, attest, attach, and publish the npm package to GitHub Packages. |

| Output | Meaning |
| --- | --- |
| `version` | Version read from `package.json`. |
| `released` | The string `true` when the publish job completes successfully. Treat no other value as evidence of publication. |

With no artifact inputs, the result is a version tag and release page; there is no attached file to verify. With `files`, each accepted direct file becomes an attested release asset. With `npm-package: true`, the packed package is also an asset and is published to GitHub Packages.

The release-file collector accepts at most 50 direct, plainly named regular files, rejects subdirectories and symbolic links, and rejects duplicate names that differ only by case. The selected directory must stay inside the consumer repository and contain files.

An npm package must be named `@unset-sh/...`, use `https://npm.pkg.github.com` as its only `publishConfig` setting, and use released, exact dependency versions. The package validator accepts a restricted archive format and refuses unsafe paths, links, and `.git` content. These checks run before npm receives the artifact; npm can read configuration and other data from a packed package.

## Permissions and publication boundary

The caller grants `contents: write`, `packages: write`, `id-token: write`, `attestations: write`, and `actions: read`. The workflow narrows those permissions per job. `plan` and `build` have read access; only `publish` writes and enters the protected environment.

The consumer's commands run in `build`. The publish job checks out the central helper scripts at the called workflow's revision, rechecks the environment, validates the downloaded artifacts, and runs no consumer code. It uses no stored secret. These controls protect this publication path; they do not stop a person or another workflow with write permission from publishing by a different path.

## Example: release a new version

For an illustrative version `1.2.3`, a reviewed pull request changes `package.json` to `1.2.3` and adds a matching `## v1.2.3` changelog entry. Merging it to `main` starts the consumer's release caller.

1. `plan` checks the triggering event, version, existing tag/release, environment, and changelog. An unchanged, already-released version stops without publishing.
2. `build` runs the check and optional build command once, gathers the artifacts, and retains them for seven days. Its summary describes the commit, changes, file hashes, and release notes. That summary comes from the job running consumer code; it is not independent proof of those artifacts.
3. `publish` waits for Alex's approval. It then rechecks the environment and artifacts, attests files, publishes the package when requested, creates the release and tag, and checks that the tag names the expected commit.

The intended outputs are the consumer repository's `v1.2.3` release and tag, its requested attached files, and optionally its GitHub Packages version. This is a source-based example, not an observed release run.

## Failure and recovery

Before approval, a failed check, invalid artifact, missing changelog, or refused environment blocks publication. Fix the source or owner-managed setting and run the checks again. If approval takes longer than the seven-day artifact retention, rerun all jobs to rebuild before approving.

After approval, publication can partially succeed. For example, a package may publish before release creation fails. Raise the version and release again; do not move a tag or reuse the package version. Rerunning a completed release stops because its tag already exists.

## Verify a released file

On a machine with authenticated `gh`, replace `RELEASE_FILE` with a downloaded asset path and `CONSUMER_REPOSITORY` with its repository name:

```sh
gh attestation verify RELEASE_FILE --repo unset-sh/CONSUMER_REPOSITORY \
  --signer-workflow unset-sh/tooling/.github/workflows/releases-package.yml \
  --source-ref refs/heads/main
```

The signer path identifies the central release workflow. The source ref restricts the consumer's source to `main`. Add `--signer-digest APPROVED_COMMIT_SHA` when the verification policy must require a particular central workflow commit.

Installing a package with npm does not run this verification. Automatic verification of each consumed `@unset-sh/*` package against its lockfile integrity and attestation is not implemented here.

## Verify a workflow version

Before updating a consumer pin, download `releases-package.yml` from the selected release of `unset-sh/tooling`. In the directory containing that download, replace `APPROVED_COMMIT_SHA` with the full commit proposed by the update:

```sh
gh attestation verify releases-package.yml --repo unset-sh/tooling \
  --signer-workflow unset-sh/tooling/.github/workflows/releases-package.yml \
  --source-ref refs/heads/main \
  --source-digest APPROVED_COMMIT_SHA
```

This is the intended verification contract, pending the first approved central release. Checking that a commit is an ancestor of `main` proves ancestry only; it does not prove review, approval, or release.

## What still needs a live run

The initial approved run must establish that the environment fields are available to the job token, that the called workflow waits on the consumer's environment, and that its `job.workflow_repository` and `job.workflow_sha` identify the central scripts. It must also verify the signer and source claims, package publication under the restricted environment, release creation outside a checkout, tag lookup and verification, and rejection of callers with insufficient permissions.

The ability of an assistant's token to approve a waiting deployment remains an open permission question. If its GitHub App has deployment-write access, the human-approval expectation needs additional enforcement. Local tests do not settle that question.

## Source and evidence

The contract was checked against [`workflows/shared/releases/package.yml`](https://github.com/unset-sh/tooling/blob/c7a291f820c5fc7b8ceb732954e0141c8c31b2e3/workflows/shared/releases/package.yml), [`release-gate.mjs`](https://github.com/unset-sh/tooling/blob/c7a291f820c5fc7b8ceb732954e0141c8c31b2e3/scripts/release-gate.mjs), [`release-files.mjs`](https://github.com/unset-sh/tooling/blob/c7a291f820c5fc7b8ceb732954e0141c8c31b2e3/scripts/release-files.mjs), and [`release-package.mjs`](https://github.com/unset-sh/tooling/blob/c7a291f820c5fc7b8ceb732954e0141c8c31b2e3/scripts/release-package.mjs). The repository pins Node 26.12.0 and npm 11.20.0 for its release helpers; their [checks](https://github.com/unset-sh/tooling/tree/c7a291f820c5fc7b8ceb732954e0141c8c31b2e3/checks) include refused environments and hostile package archives. Run `npm run check` from this repository's root to exercise the local checks.

GitHub's [reusable workflow reference](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations) describes the caller context and permission ceiling. Its [attestation guidance](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/increase-security-rating) explains verification with an expected signer workflow.
