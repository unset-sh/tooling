---
title: "Prepare a repository to use shared workflows"
description: "Configure a pinned caller while preserving repository checks and release requirements."
weight: 10
type: docs
params:
  doc_kind: guide
  checked_source_revision: "c7a291f820c5fc7b8ceb732954e0141c8c31b2e3"
---

A small workflow in your repository can call the shared implementation in `unset-sh/tooling`. Your pull requests and pushes still trigger runs in your repository, and their check results appear there.

The implementation described here is **unreleased, at version 0.0.0**. Use this guide to prepare adoption. Do not install a caller with the placeholder below or substitute a moving branch such as `main`.

## Before you start

You need write access to the consuming repository, a `.bun-version` naming its exact Bun version, and a check command that runs from its root. GitHub Actions settings must allow the shared workflow. Before replacing an existing workflow, record its required check names, extra build steps, reports, and dependency-installation requirements.

The shared check grants `contents: read` and `packages: read` and accepts no stored secrets. Its optional install runs `bun install --frozen-lockfile --ignore-scripts` with the job's read-only token in `GITHUB_PACKAGES_TOKEN`, for that step only, so `@unset-sh` packages can be read from GitHub Packages when the repository's `bunfig.toml` names it for that scope:

```toml
[install.scopes]
"@unset-sh" = { url = "https://npm.pkg.github.com", token = "$GITHUB_PACKAGES_TOKEN" }
```

The package must also grant the repository Actions access. Do not name `$NPM_CONFIG_TOKEN` there, and do not set that variable for an install: Bun also sends it to the default registry, so the token would reach registry.npmjs.org (Bun 1.4.4 `docs/pm/npmrc.mdx`). The check command never sees the token. A repository that needs dependency lifecycle scripts needs a reviewed workflow adaptation before switching.

## Configure the check caller

1. Select a reviewed release of `unset-sh/tooling` and verify its commit using the [release reference](release-reference.md#verify-a-workflow-version). No first release is available in the implementation described here.
2. Start from the [check caller template](https://github.com/unset-sh/.github/blob/db0d794cf1761644ebc379fb2a36e50571f199a7/workflow-templates/check.yml). Put the caller in your repository's `.github/workflows/ci.yml`.
3. Replace `APPROVED_COMMIT_SHA` with that release's full 40-character commit. Set the branch and inputs for your repository. GitHub's picker substitutes `$default-branch`; replace it yourself if you copy the template as a file.

This illustrative caller checks pull requests and pushes to `main`. It assumes a committed `bun.lock` and dependencies that can be installed without lifecycle scripts:

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
permissions: {}
jobs:
  check:
    uses: unset-sh/tooling/.github/workflows/ci-check.yml@APPROVED_COMMIT_SHA
    permissions:
      contents: read
      packages: read # the install step reads @unset-sh packages
    with:
      install: true
```

The shared workflow checks out the consuming repository, takes Bun from its `.bun-version`, refuses any other version, optionally installs dependencies, and runs its check command. The shared source supplies the job implementation; it does not replace your repository's tests.

## Check inputs

| Input | Default | Effect |
| --- | --- | --- |
| `install` | `false` | Run `bun install --frozen-lockfile --ignore-scripts` before checking. Leave false for a dependency-free repository. |
| `command` | `bun run check` | Command that must succeed, run from the repository root. |
| `keep` | Empty | Retain files at this path as the `check-output` artifact for 14 days, including after a check failure. Missing files produce a warning. |
| `timeout-minutes` | `10` | Maximum duration of the check job. |
| `postgres-image` | Empty | A Postgres image pinned by digest, `postgres:<tag>@sha256:<64 hex>`, run as a service beside the check. It listens on the runner's loopback with no password (`POSTGRES_HOST_AUTH_METHOD=trust`), and the check sees `PGHOST`, `PGPORT`, `PGUSER` and `PGDATABASE` for it. Any other value fails the job. Empty starts no service. |
| `openfga-image` | Empty | An OpenFGA image pinned by digest, `openfga/openfga:v<version>@sha256:<64 hex>`, started before the check with `run`, keeping its data in memory and listening on the runner's loopback only. The check sees `FGA_URL` and `FGA_KEY`, a preshared key made for that run and masked in the log. Any other value fails the job. Empty starts nothing. |
| `valkey-image` | Empty | A Valkey image pinned by digest, `valkey/valkey:<tag>@sha256:<64 hex>`, started before the check as `valkey-server` with a password, keeping its data in memory only and listening on the runner's loopback only. The check sees `VALKEY_URL` (`redis://127.0.0.1:6379`, no credentials) and `VALKEY_PASSWORD`, made for that run and masked in the log. Any other value fails the job. Empty starts nothing. |
| `garage-image` | Empty | A Garage image pinned by digest, `dxflrs/garage:v<version>@sha256:<64 hex>`, started before the check with Garage's own single-node start (`garage server --single-node --default-bucket`), as an unprivileged user with a read-only filesystem, its data in memory, and only its S3 port on the runner's loopback. The check sees `S3_ENDPOINT` (`http://127.0.0.1:3900`), `S3_REGION` (`garage`), `S3_BUCKET` (`check`), and `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, made for that run, the secret masked in the log. Any other value fails the job. Empty starts nothing. |
| `rustfs-image` | Empty | A RustFS image pinned by digest, `rustfs/rustfs:<version>@sha256:<64 hex>`, started before the check with its data in memory and only its S3 port on the runner's loopback. The console, the update check and the other protocol listeners are off. The check sees `S3_ENDPOINT` (`http://127.0.0.1:9000`), `S3_REGION` (`us-east-1`), `S3_BUCKET` (`check`), and `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, made for that run, the secret masked in the log. Any other value fails the job. Empty starts nothing. Do not set this and `garage-image` together; both write those `S3_*` variables. |

## Verify the result

Open a pull request containing the caller change. Check that the run uses the intended central commit and that every previous required test or report still runs. With the caller job named `check` and the shared job named `Check`, the expected check label is `check / Check`; confirm the actual label before changing repository rulesets.

When using `rustfs-image`, the check waits for the bucket-creation log before exporting the S3 settings.
It consumes the complete log snapshot, so a successful match cannot interrupt Docker's output with SIGPIPE;
a missing creation event or a Docker error still fails readiness.

A failed check command must fail the run. If you set `keep`, inspect the retained report as well as the job status. The workflow adds no result outputs; consumers use its job conclusion and optional artifact.

## Recover from an adoption problem

If installation fails, compare the repository's previous installation policy with `bun install --frozen-lockfile --ignore-scripts`, and check that `bun.lock` is committed; do not hide the failure. If a required check remains pending, inspect the actual check name and the caller's event filters. Retain the existing checks until the replacement is verified.

An upgrade is a reviewed change to the pinned commit. Reverting that caller change restores the previous implementation, provided its input contract still matches. This does not undo anything already published by a release.

## Add releases separately

Prepare the owner-managed environment and repository settings in the [release reference](release-reference.md#prerequisites), then adapt the [release caller template](https://github.com/unset-sh/.github/blob/db0d794cf1761644ebc379fb2a36e50571f199a7/workflow-templates/release.yml). A successful check migration alone does not establish that publication or attestation verification works.

## Validate staging and main pull requests

The reusable `ci-branch-policy.yml` needs no token permissions. It reads the original `pull_request` event
without checking out or executing consumer code. Its `flow` input names the repository's branch model:

| `flow` | For | Accepted pull requests |
| --- | --- | --- |
| `staged` (default) | Repositories with `staging` and stable `main` | Feature branches or forks into `staging`; only `staging` from the same repository into `main` |
| `main` | Repositories that work directly on `main` (org-0010: tooling, agent-kit, .github, docs) | Any branch or fork into `main`; every other base fails |

Missing event metadata, another base branch, a non-PR event or an unknown `flow` value fails the check. The
generated-dispatch path for documentation imports and the organisation map does not read `flow`.

Install a small caller with a reviewed full tooling commit:

```yaml
name: branch-policy
on:
  pull_request:
    types: [opened, synchronize, reopened, edited, ready_for_review]
permissions: {}
jobs:
  policy:
    uses: unset-sh/tooling/.github/workflows/ci-branch-policy.yml@APPROVED_COMMIT_SHA
    permissions: {}
    # with:
    #   flow: main  # only in a repository with no staging branch
```

Switch a repository to `flow: main` only after its default branch is `main` and its staging branch rules are
gone; until then the staged rules keep refusing feature PRs into `main`. `flow` lives in the caller, and a
`pull_request` run uses the caller from the PR's own merge ref, so a PR in a staged repository that adds
`flow: main` passes its own check. Review any change to that line as a branch-policy change.

Do not add path or base-branch filters: all PRs need the check, including retargeted PRs. The reusable job
name is `Validate branch policy`; with caller job `policy`, expect `policy / Validate branch policy` and
confirm the actual run before requiring that status. Keep application checks required alongside it.

This check does not identify a human, approve or merge a PR, change branch settings, or publish anything.
The rule that only a human merges into main still applies, including when agents share that account.
Repository rules must separately prevent direct updates and require this check. A `pull_request` workflow
can itself be modified by a PR; review workflow and caller changes as policy changes rather than treating
this status as a tamper-proof server-side rule. The staging release and deployment transition remains separate.

## Planned automatic adoption

Automatic propagation of tooling updates is **not implemented**. The intended sequence is an owner-approved tooling release, a consumer pull request updating the full commit pin, required consumer checks, eligible automatic merging, and the consumer's delivery workflow. Release publication retains its owner approval.

A dependency updater can propose a reusable-workflow pin change, but that alone does not connect this sequence. An implementation must define who creates the pull request, which checks permit merging, and which token or explicit event starts downstream delivery. GitHub suppresses most new workflow runs caused by a repository's `GITHUB_TOKEN`; the [triggering-workflows rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow) must be accounted for. Until that pipeline is reviewed and implemented, maintainers update pins through the normal pull-request process.

## Source and evidence

This guide was checked against [`workflows/shared/ci/check.yml`](https://github.com/unset-sh/tooling/blob/c7a291f820c5fc7b8ceb732954e0141c8c31b2e3/workflows/shared/ci/check.yml), the caller templates, and the [workflow contract checks](https://github.com/unset-sh/tooling/blob/c7a291f820c5fc7b8ceb732954e0141c8c31b2e3/checks/workflows.test.mjs). The example is a configuration template checked against that source, not an observed consumer run. GitHub documents [calling reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) and their [caller context and permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations).
