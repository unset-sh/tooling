---
title: "Build staging images"
description: "Build a repository's container image on every merge into staging, push it by digest, and verify where it came from."
weight: 35
type: docs
params:
  doc_kind: guide
  checked_source_revision: "449027b9b49d5e0f29ab1c9a17191d47b6c8bcdb"
---

Use `.github/workflows/image-staging.yml` when a repository ships a container image that `unset-sh/deployment` runs on staging. Each push to the repository's `staging` branch, which is a merged pull request, builds the image, pushes it to `ghcr.io/unset-sh/staging/<repository>` and attests where it came from. Deployment then pins the image by digest and verifies the attestation before it runs it.

The implementation is **unreleased, at version 0.0.0**, generated from [`workflows/shared/image/staging.yml`](https://github.com/unset-sh/tooling/blob/449027b9b49d5e0f29ab1c9a17191d47b6c8bcdb/workflows/shared/image/staging.yml). Its checks run in this repository's tests, but **no image has been pushed or attested by it yet**: that first happens when a caller merges into staging. Production images are not part of this workflow; they will go to `ghcr.io/unset-sh/<repository>` through a separate release workflow with its own approval.

## What Alex decided

On 2026-11-23 Alex decided: one shared workflow in tooling, with a thin caller in each repository pinned to a full tooling commit; it runs on a push to `staging` and never on a pull request; images go to `ghcr.io/unset-sh/staging/<repository>`, so the path says the channel; consumers use the digest, so the workflow gives the image no tag, neither `latest` nor `staging-<sha>`; it attests build provenance; and the run's own `GITHUB_TOKEN` is its only credential, with `contents: read`, `packages: write`, `id-token: write` and `attestations: write`.

## Before you start

- **The repository is public.** On the Free, Pro and Team plans GitHub offers artifact attestations for public repositories only; a private or internal repository needs GitHub Enterprise Cloud ([GitHub's plan note](https://github.com/github/docs/blob/main/data/reusables/gated-features/attestations.md), read 2026-11-24). `unset-sh/backend` and `unset-sh/web` were public on 2026-11-24.
- **The repository's name is lower-case letters, digits and dashes.** It becomes the image name; anything else stops the run.
- **Every image the Dockerfile pulls is pinned by digest**: `FROM name:tag@sha256:<64 hex>` or `FROM name@sha256:<64 hex>`, and the same for `COPY --from=`, `RUN --mount=...,from=` and a `# syntax=` directive. Earlier stages and `scratch` need no digest. An image named through a build argument (`FROM ${BASE}`) is refused, because its value is not in the file. Downloads made by `RUN` or `ADD` are not checked.
- **The Dockerfile is written plainly.** The check reads the file as BuildKit v0.35.0 does and refuses what it cannot read the same way: a `#!` first line, whitespace other than spaces and tabs, a flag (`--from=`, `--mount=` and the rest) holding a quote, backslash, backtick or non-ASCII character, and `<<` on a `RUN`, `COPY` or `ADD` line other than a plain heredoc (`<<NAME`, `<<-NAME`, `<<"NAME"`, `<<'NAME'`) on a line with no other quote, backslash, backtick or `$`. Put such commands inside the heredoc or a script. A stage is named by its `AS` name; only `COPY --from=` also takes its number.
- **`package.json` has a `license` field** holding a plain SPDX expression, such as `AGPL-3.0-only` for a product repository. It becomes the `org.opencontainers.image.licenses` label.
- **The build needs no credential.** The build job has no package token and passes no build argument or secret, so a Dockerfile cannot install `@unset-sh` packages from GitHub Packages yet. Adding that is a reviewed change to this workflow.
- **The organisation's Actions policy allows this workflow.** If it lists allowed actions and reusable workflows, add `unset-sh/tooling/.github/workflows/image-staging.yml` at the reviewed commit.

## Add the caller

1. Pick a reviewed commit of `unset-sh/tooling` `main` that contains `.github/workflows/image-staging.yml`.
2. Add `.github/workflows/image-staging.yml` to the repository, with that commit's full 40-character SHA:

   ```yaml
   name: staging image
   on:
     push:
       branches: [staging]
   permissions: {}
   jobs:
     image:
       uses: unset-sh/tooling/.github/workflows/image-staging.yml@<full tooling commit> # <version or note>
       permissions:
         contents: read
         packages: write
         id-token: write
         attestations: write
   ```

3. Add `with:` only for an input whose default does not fit. Do not add a `pull_request` trigger: the workflow refuses every event but a push to `refs/heads/staging`.
4. Merge the caller through the repository's normal pull request into `staging`. That merge is the first run.

## Inputs

| Input | Default | Effect |
| --- | --- | --- |
| `context` | `.` | The build context, a folder of the repository. |
| `dockerfile` | `Dockerfile` | The Dockerfile, as a path from the repository root. |
| `platform` | `linux/amd64` | The one platform built: `linux/amd64` on `ubuntu-24.04`, or `linux/arm64` on `ubuntu-24.04-arm`. Anything else fails. |
| `timeout-minutes` | `30` | How long the build job may run. |

There is no input for the registry, the path or a tag: the path is fixed by Alex's decision. Paths must be plain relative paths inside the repository, reached without a symbolic link.

## Permissions the caller grants

| Permission | Job | Why |
| --- | --- | --- |
| `contents: read` | `build`, `publish` | Check out the repository at the pushed commit, and tooling's own scripts. |
| `packages: write` | `publish` | Push the image and the attestation to `ghcr.io/unset-sh/staging/<repository>`. |
| `id-token: write` | `publish` | Sign the attestation with a short-lived Sigstore certificate. |
| `attestations: write` | `publish` | Store the attestation with GitHub. |

The caller grants the four; each job takes only what its row shows. `build` runs the repository's code, because a Dockerfile's `RUN` steps are its commands, so it holds a read-only token and pushes nothing. `publish` runs no code of the repository: it checks what `build` wrote, then pushes and attests it. `actions/attest` can also write an artifact storage record, which needs `artifact-metadata: write`; Alex did not approve that permission, so the workflow turns the record off.

## What a run produces

- An image with no tag of its own in `ghcr.io/unset-sh/staging/<repository>`, built from the pushed commit with BuildKit pinned by digest in a new builder with no cache. Its times are the commit time (`SOURCE_DATE_EPOCH`, with file times rewritten), and it carries the labels `org.opencontainers.image.source`, `.revision` and `.licenses`. A second run of the same commit should produce the same digest when the Dockerfile's own steps are reproducible; that is not enforced.
- A build provenance attestation for the image's digest, stored with GitHub and pushed beside the image. GHCR has no referrers API, so `actions/attest` pushes it under the tag `sha256-<image hex>`, the fallback in the OCI distribution spec's [referrers tag schema](https://github.com/opencontainers/distribution-spec/blob/main/spec.md#referrers-tag-schema) (`@sigstore/oci` in `actions/attest` v4.2.2, read 2026-11-24). That tag names an index of the image's attestations, not the image, and it changes when another attestation for the same digest is pushed, for example when publish runs again. Nothing pins or checks that tag: the verify command below reads GitHub's attestation API. Whether to keep the registry copy at all is open with Alex.
- The outputs `digest` (`sha256:<64 hex>`) and `image` (`ghcr.io/unset-sh/staging/<repository>@sha256:<64 hex>`), and a run summary listing the images the Dockerfile pulled and the verify command below.

## Set the package up after the first push

The first push with the run's token creates the package `staging/<repository>` in the organisation. GitHub's docs say a package published from a workflow with `GITHUB_TOKEN` is linked to the repository that contains the workflow, and that new organisation packages start private ([working with the Container registry](https://github.com/github/docs/blob/main/content/packages/working-with-a-github-packages-registry/working-with-the-container-registry.md) and [access control and visibility](https://github.com/github/docs/blob/main/content/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility.md), read 2026-11-24). Which repository a reusable workflow's push links is not stated; the token and the source label both belong to the calling repository, so expect that one. This is unverified until the first run.

Alex sets these by hand on the package's settings page; assistants do not change package settings:

1. **Repository link.** Check the package shows the calling repository, such as `unset-sh/backend`. If it does not, connect it under **Connect repository**.
2. **Manage Actions access.** The calling repository needs the **Write** role, and no other repository should have it. A package that inherits access from its linked repository gives that repository's writers push access too; remove inheritance if only the workflow should push.
3. **Visibility.** The package starts private. Make it public if the source is public and anyone may pull the image, or keep it private and give the deployment's pull credential read access. A public package cannot be made private again.

GitHub also says `GITHUB_TOKEN` cannot push to a package of the same name that was pushed before without being connected to the repository. If the first run fails with a permission error, check for an existing `staging/<repository>` package before anything else.

## Verify the result

On the run page, both jobs pass and the summary names `ghcr.io/unset-sh/staging/<repository>@sha256:<digest>`. The package page lists a version with that digest and no tag, and the attestation's version tagged `sha256-<digest>`. Then check the attestation as deployment will:

```sh
gh attestation verify oci://ghcr.io/unset-sh/staging/backend@sha256:<digest> \
  --repo unset-sh/backend \
  --signer-workflow unset-sh/tooling/.github/workflows/image-staging.yml \
  --signer-digest <tooling commit the caller pins> \
  --source-ref refs/heads/staging \
  --source-digest <backend commit> \
  --deny-self-hosted-runners
```

Each flag closes a gap (GitHub CLI v2.105.0 `pkg/cmd/attestation/verify/policy.go`, read 2026-11-24; Fulcio [OID reference](https://github.com/sigstore/fulcio/blob/main/docs/oid-info.md)):

- `--repo` requires the source repository to be `unset-sh/backend`. `--owner unset-sh` alone would accept an attestation made for any repository of the organisation.
- `--signer-workflow` requires the signer to be this file, and `--signer-digest` the tooling commit that ran it, from the certificate's Build Signer Digest. Without the digest, any commit of tooling on any branch matches. Versions of `gh` before the one read here matched the file name only as a prefix.
- `--source-ref refs/heads/staging` requires the run to have started from a push to the repository's `staging` branch, and `--source-digest`, when deployment knows the commit, that exact commit.
- `--deny-self-hosted-runners` requires a GitHub-hosted runner.

A pull by the same digest gets exactly the image that was verified: `docker pull ghcr.io/unset-sh/staging/backend@sha256:<digest>`.

## If it fails

- **"A staging image is built only from a push to staging"**: the caller started on another event or branch. Fix the caller's trigger.
- **"is not pinned by digest"** with a line number: pin that image, for example with the digest `crane digest <image:tag>` or `docker buildx imagetools inspect <image:tag>` prints, and keep the tag for readers.
- **"has no plain SPDX expression in 'license'"**: add the licence to `package.json`.
- **"The downloaded image is ..., but the build job reported ..."** or **"The registry holds ..."**: the bytes changed between build and push. Nothing was attested; rerun all jobs and tell Alex if it repeats.
- **Re-running only `publish`**: use **Re-run all jobs**. **Re-run failed jobs** cannot work for `publish` alone, because the artifact's name carries the run attempt and the new attempt looks for a name the earlier build never uploaded.
- **"may not contain a quote"**, **"plain form"**, **"#! line"**, **"whitespace"** or **"is not a Dockerfile instruction"**: rewrite the line as the note on a plainly written Dockerfile above says.
- **Denied on push**: check the package's **Manage Actions access** and repository link above.

A pushed image cannot be taken back by this workflow, and it deletes nothing. Because the image has no tag of its own, an image nobody pins is inert; deleting old versions is a package setting for Alex.

## Source and evidence

Checked against [`workflows/shared/image/staging.yml`](https://github.com/unset-sh/tooling/blob/449027b9b49d5e0f29ab1c9a17191d47b6c8bcdb/workflows/shared/image/staging.yml), [`scripts/image-staging.mjs`](https://github.com/unset-sh/tooling/blob/449027b9b49d5e0f29ab1c9a17191d47b6c8bcdb/scripts/image-staging.mjs) and their tests in `scripts/image-staging.test.mjs` and `checks/image-staging-workflow.test.mjs`. Behaviour of the tools was read, all on 2026-11-24, in BuildKit v0.35.0 (`frontend/dockerfile/parser/parser.go`, `directives.go`, `split_command.go`, `instructions/commands_runmount.go`, `instructions/bflag.go`), `actions/attest` v4.2.2 (`README.md`, `src/attest.ts`, `dist/index.js`), go-containerregistry v0.22.1 (`cmd/crane/cmd/push.go`), BuildKit's [`docs/build-repro.md`](https://github.com/moby/buildkit/blob/master/docs/build-repro.md) and Docker's [OCI exporter page](https://github.com/docker/docs/blob/main/content/manuals/build/exporters/oci-docker.md). A local build with BuildKit v0.35.0 and a push by digest to a local registry with crane v0.22.1 confirmed the layout shape, the same digest on a second build, and that crane created no tag (the attestation's `sha256-` tag comes from `actions/attest`, which did not run locally). Each Dockerfile shape the check refuses was built with that BuildKit, which tried to pull the unpinned image. The push to GHCR, its package creation and the attestation have not run.
