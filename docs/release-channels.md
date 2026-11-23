---
title: "Release through staging and main"
description: "Publish immutable staging prereleases and promote an exact reviewed staging merge to a stable release."
weight: 31
type: docs
params:
  doc_kind: reference
  checked_source_revision: "42f07ecbfbe4e6106e7903fe2a5671db51232f7d"
---

`releases-channel.yml` is a separate, opt-in reusable workflow for staged delivery. A push to `staging` produces a uniquely versioned prerelease. A push to `main` must be the exact merge of a same-repository `staging` pull request; after its checks and build pass, publication proceeds automatically. The human decision is merging that promotion, with no second deployment approval.

The implementation is **unreleased, at version 0.0.0**. This change activates no consumer and creates no environment. No live staged or stable publication has been demonstrated. The existing [owner-approved release workflow](release-reference.md) keeps its current contract until a consumer deliberately migrates.

## Authority and ownership

The owner controls adoption, settings, and the human-only `staging` to `main` promotion. Agents may prepare and validate that pull request; they must not merge it. GitHub cannot distinguish a human from an agent using the same account. The workflow verifies repository, branch, merged pull request, exact merge SHA and both merge parents; it does not infer human intent from a login.

The merge's first parent must equal the push's `before` commit. Its second parent must equal the merged pull request's `head.sha`, from this repository's `staging` branch. Later changes to the current staging tip do not invalidate an earlier promotion. Squash, rebase, forked, direct, forced, branch-creation and non-push releases are refused.

Tooling owns the implementation. Each consumer owns its source version, changelog, build, callers, settings and required checks. This workflow supplies a publication path; it does not prevent another person or workflow with write access from publishing elsewhere.

## Set up before adoption

1. Use a public `unset-sh` repository with `staging` and `main`. Protect each exact branch with active pull-request, deletion, force-push and strict required-check rules. Required checks must identify the GitHub Actions integration. Main must allow merge commits only, without a conflicting linear-history rule. The organisation's settings audit must verify no bypass actors and the appropriate required checks and reviews.
2. Create `release-staging` and `release-stable` environments in advance. Each must use **Selected branches and tags**, with exactly one **branch** entry: `staging` or `main`, respectively. Set administrator bypass off. These automatic environments must have no required reviewers, wait timer or other protection rule besides the branch policy. An absent or incompatible setting, including a missing bypass field in the API response, stops the workflow. It never creates or widens an environment.
3. Enable GitHub release immutability for future releases. Permit the workflow token to publish the intended GitHub package. No stored publishing secret is used.
4. Keep a stable three-part source version in root `package.json`, such as `1.2.3`. Add a nonempty `## v1.2.3` entry to `CHANGELOG.md`. Version `0.0.0` skips release authority checks, build and publication.
5. Use a supported root package and lockfile, described below. Adapt checks and builds to the temporary staging version. Both jobs use the Bun version pinned in tooling's `.bun-version`, currently 1.4.4.
6. Review a full central commit pin and add the caller. Retire the legacy caller in the same coordinated change so two workflows cannot publish a stable version.

The read-only GitHub token can retrieve active branch rules, but GitHub [withholds ruleset bypass actors without ruleset write access](https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset). An omitted field is not proof that there are no bypasses. The workflow refuses visible bypass entries; the separate settings audit owns the no-bypass requirement. It adds no administrative credential to obtain that evidence.

## Caller contract

Use a caller triggered by every push to the two branches. Replace `REVIEWED_FULL_COMMIT` with the full approved central commit. This is an illustrative template, not an activated workflow:

```yaml
name: release
on:
  push:
    branches: [staging, main]
permissions: {}
jobs:
  release:
    uses: unset-sh/tooling/.github/workflows/releases-channel.yml@REVIEWED_FULL_COMMIT
    permissions:
      contents: write
      packages: write
      id-token: write
      attestations: write
      actions: read
      pull-requests: read
    with:
      install: true
      npm-package: true
```

Do not copy the callee's concurrency group into the caller. The callee serializes each repository/branch with cancellation disabled. GitHub concurrency can replace an older pending run; it is not a guaranteed queue of every staging push. [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

| Input | Default | Meaning |
| --- | --- | --- |
| `install` | `false` | Run `bun install --frozen-lockfile --ignore-scripts` after preparing the temporary root versions. |
| `check` | `bun run check` | Command that must succeed before building. |
| `build` | Empty | Optional build command. |
| `files` | Empty | Repository-relative directory of plain release files. |
| `npm-package` | `false` | Pack, attest, attach and publish the root package to GitHub Packages. |

| Output | Meaning |
| --- | --- |
| `version` | Derived channel version, or `0.0.0` when skipped. |
| `channel` | `staging` or `stable`, derived from the push branch. |
| `released` | String `true` only after publication and exact tag verification. |

## Version and dependency preparation

For source version `1.2.3`, run ID `123456` and attempt `2`:

| Branch | Published version | npm dist-tag | GitHub release |
| --- | --- | --- | --- |
| `staging` | `1.2.3-staging.123456.2` | Explicit `staging` | Prerelease, never marked latest |
| `main` | `1.2.3` | Explicit `latest` | Stable, marked latest |

The workflow changes only the root `package.json` version. `bun.lock` records the root's name and dependency declarations but not its version, so it is left as it is and `bun install --frozen-lockfile` still accepts it. The workflow writes the temporary `package.json` directly, without `bun pm version` or lifecycle scripts, and commits nothing. Dependency declarations and lock selections remain unchanged.

The supported lock is a regular, unlinked `bun.lock` in Bun 1.4.4's text format (`lockfileVersion` 2), with one root workspace whose name and dependency declarations match `package.json`, and no overrides or patches. A lock is mandatory for installation or for a package declaring dependencies, including development and peer dependencies. Workspaces, linked, file and Git packages, `package-lock.json`, `npm-shrinkwrap.json`, the binary `bun.lockb` and bundled dependencies are refused explicitly. Publishing also rejects a build-created shrinkwrap or `node_modules` tree inside the tarball.

Every declared dependency must use an exact version. Staging may select an exact `@unset-sh/*` version using the same `-staging.<run-id>.<attempt>` format. Stable rejects every prerelease among direct declarations and selected lock entries, including development, peer and transitive entries. Replace staging dependency pins with released stable versions before promotion. Ranges, aliases, tags, Git/file references and unrelated prerelease formats are unsupported. These checks cover committed declarations and locks, not the contents or later behavior of external packages.

Packages must retain the `@unset-sh/` scope and use `https://npm.pkg.github.com` as their only `publishConfig` entry. The complete packed manifest must equal the committed manifest with only the calculated root version changed. Consumer commands cannot substitute a different name, dependency declaration, script or publishing setting in the artifact.

## Execution and publication boundary

`plan` reads immutable Git objects at the event's exact SHA, validates the package and changelog, checks active rules and pre-existing environment settings, verifies stable promotion ancestry, and refuses any existing version tag or release. It runs no consumer code.

`build` checks out that exact consumer commit, prepares root versions, optionally installs without lifecycle scripts, then runs the consumer's check and build commands. It packs without lifecycle scripts and uploads `channel-<run-id>-<run-attempt>` for seven days. This job has only read permissions; its install step alone gets a package-read token in `NPM_CONFIG_TOKEN` for `@unset-sh` dependencies.

`publish` downloads the same-run artifact and runs only pinned central helpers, actions, Bun and GitHub CLI. It rechecks source and settings and validates the receipt's repository, source SHA, channel, version, run ID and attempt. Plain files and strict package archives are checked before attestation. Release notes are rebuilt from committed source; build-supplied notes are never published. After attestation, authority is checked again and a new exact tag is created atomically. An existing tag is never reused or moved.

Only this job has write permissions and enters the verified environment. `bun publish` runs in a new directory containing only the checked tarball and a `{}` package.json, which is also its HOME, with a stripped environment, explicit registry and dist-tag, and lifecycle scripts disabled. It cannot inherit the job's identity-token request variables. The release page uses the reserved tag with `--verify-tag` and is followed by another exact tag check.

Git reads use fixed GitHub API URLs, no redirects, a 15-second timeout, at most 40 requests and 2 MiB per response. Source files are limited to 1 MiB each; lockfiles to 10,000 package entries; rule lookup to fewer than 100 active rules and at most 20 rulesets; promotion lookup to 10 candidates. Truncated, unavailable or excessive data fails rather than producing a partial decision. Artifacts allow at most 50 plain, unique files, 128 MiB per file and 512 MiB total; strict tar expansion is capped at 512 MiB. Symbolic links, hard links, unexpected roots and ambiguous archive paths are refused.

## Failure and recovery

A failed check, changed manifest, unsupported lock, missing changelog, invalid promotion or incompatible protection stops publication. Fix source or owner-managed settings; do not bypass a refusal. Every stable promotion needs a new unreleased source version. A later promotion that retains an already-published version fails instead of quietly implying it was released.

Staging retries use a new run attempt and therefore a different version. Rerun **all jobs**: rerunning only failed jobs cannot reuse the prior attempt's artifact receipt. If the retained artifact expires, rebuild through a new complete run.

Publication can partially succeed after the atomic tag reservation: the tag may exist without a package or release page, or the package may publish before page creation fails. Stable recovery requires a new source version and another human promotion. Never delete or move the reserved tag or reuse the package version. There is no rollback or automatic cleanup that weakens immutability.

## Verify and review

For a downloaded asset, replace `FILE`, `REPOSITORY` and `CENTRAL_COMMIT` with the expected values:

```sh
gh attestation verify FILE --repo unset-sh/REPOSITORY \
  --signer-workflow unset-sh/tooling/.github/workflows/releases-channel.yml \
  --signer-digest CENTRAL_COMMIT \
  --source-ref refs/heads/main
```

Use `refs/heads/staging` for a staging artifact. Installing the package with Bun or npm does not itself run this attestation check. An attestation verifies the workflow and source boundary, not that the same-account merger was human.

The [workflow source](https://github.com/unset-sh/tooling/blob/42f07ecbfbe4e6106e7903fe2a5671db51232f7d/workflows/shared/releases/channel.yml), [authority implementation](https://github.com/unset-sh/tooling/blob/42f07ecbfbe4e6106e7903fe2a5671db51232f7d/scripts/release-channel-api.mjs) and [package tests](https://github.com/unset-sh/tooling/blob/42f07ecbfbe4e6106e7903fe2a5671db51232f7d/scripts/release-channel-package.test.mjs) describe the checked implementation. Validate changes with Bun 1.4.4 using `bun run workflows`, `bun run workflows:describe`, `bun run check`, and actionlint. Local refusal tests and Bun packing and publishing to a local registry are evidence for source behavior; live publication and activation require separate evidence.
