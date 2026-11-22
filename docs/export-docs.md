---
title: "Export the public documentation"
description: "Create a documentation section from an exact committed revision for a reviewed import."
weight: 15
type: docs
params:
  doc_kind: guide
  checked_source_revision: "aad4a03c5db3d6d762c59543e1340744a941828a"
---

The documentation exporter packages a repository's selected public pages from an exact Git commit. Use it to prepare a reviewed import into `unset-sh/docs`, or download the equivalent artifact from a caller of the reusable documentation-export workflow.

This guide describes the **unreleased implementation at version 0.0.0**. The organisation documentation website is live, but creating an export does not publish a section. Import and deployment remain separate steps.

## Before you start

Work from the root of a checkout of `unset-sh/tooling`, with Git and Node 26.12.0 available. Select a reviewed source commit whose implementation and documentation have been checked. It must already contain the public pages under `docs/site/` and the root `LICENSE`; uncommitted edits are never copied into an export.

The output must be an absolute path to a directory that does not yet exist. Its parent directory must already exist. Choose a fresh destination for each export so the command cannot mix sections from different revisions.

## Export a committed revision

1. Run the source repository's checks against the intended revision. For tooling, run `npm run check`. Commit documentation changes before selecting the revision that will contain them.
2. Obtain the source's full 40-character lowercase commit identifier with `git rev-parse HEAD`, or use the full identifier of another checked commit already available in that checkout.
3. Replace `FULL_40_SHA` below with that identifier and `/absolute/fresh-output` with your fresh output path. Run from the tooling repository root:

```sh
npm run docs:export -- --revision FULL_40_SHA --out /absolute/fresh-output
```

The default source is the tooling checkout and the default repository is `unset-sh/tooling`. To export another source, pass its absolute checkout path and repository name. This illustrative command exports the organisation's `.github` documentation:

```sh
node scripts/export-docs.mjs --revision FULL_40_SHA --out /absolute/fresh-output \
  --root /absolute/github-checkout --repository unset-sh/.github
```

Here, `FULL_40_SHA` must name the checked commit in `/absolute/github-checkout`, not the tooling checkout. The repository argument identifies the source in provenance and determines the section name. Use the actual source repository; it is not a way to choose an arbitrary destination.

The exporter reads the selected commit's `docs/site/` tree and licence through Git. It does not copy the working directory, repository README, or unrelated Markdown files. A dirty checkout therefore cannot add unpublished edits to an export of a committed revision. The exporter refuses unsafe paths, symbolic links, reserved section names, and existing output destinations.

## Inspect the result

The default tooling export keeps the public pages, licence, and provenance together:

```text
fresh-output/
└── tooling/
    ├── _index.md
    ├── use-workflows.md
    ├── other public pages
    ├── LICENSE
    └── source.json
```

For other `unset-sh` repositories, the section is the lowercase repository slug, containing only letters, numbers, and separating hyphens. The explicit exception is `.github`, which exports as `github/` to avoid the documentation framework's reserved `.github` directory. Reserved framework section names are refused.

`source.json` records the repository, full revision, source directory, section, and per-file SHA-256 hashes. Confirm that its repository and revision match your selection and that `_index.md` and the intended pages are present. Provenance identifies what was exported; it does not prove that the documentation was reviewed or its examples executed.

If the command refuses an existing output directory, choose another fresh destination. If the selected commit predates the public pages, select a checked commit that contains them. If a recent edit is missing, check whether it was committed and whether you selected that commit.

## Use the workflow artifact

The [reusable documentation-export workflow](https://github.com/unset-sh/tooling/blob/aad4a03c5db3d6d762c59543e1340744a941828a/automation/docs-export.yml) accepts `workflow_call` only, with no inputs, stored secrets, or outputs. It uses `contents: read` and uploads a `docs-<commit>` artifact for 14 days, where the commit is the caller's `github.sha`. The artifact preserves the section directory shown above.

The workflow checks out the consumer at `github.sha` into `source/`. It checks out the central helper into `tooling/` at the called workflow's own repository and full commit, after validating that identity. Node comes from the tooling checkout's `.nvmrc`. This keeps export implementation tied to the caller's approved tooling pin while exporting the consumer's selected source revision.

The reusable workflow does not run consumer check or build commands. A caller must run its checks first and make export depend on that job. Tooling's [local documentation caller](https://github.com/unset-sh/tooling/blob/aad4a03c5db3d6d762c59543e1340744a941828a/automation/docs-self.yml) does this for pull requests, pushes to `main`, and manual dispatch. For example, a tooling pull request first runs the check job; only success permits export of that run's `github.sha`. A failed check prevents the artifact job, and a missing section index or licence fails export.

Inspect the downloaded artifact's `source.json` before preparing an import. A pull-request run's `github.sha` may be a test merge commit, so do not assume it is the pull request's head commit. The artifact is packaging evidence for its recorded revision. Neither this workflow nor the local caller pushes to `unset-sh/docs` or deploys the website.

## Import through a documentation pull request

Import only the exported section through a pull request in `unset-sh/docs`. Preserve its provenance and licence. Keep the renderer, its `.github` directory, and other repository sections intact.

The source mappings are `unset-sh/tooling:docs/site/` to `unset-sh/docs:tooling/` and `unset-sh/.github:docs/site/` to `unset-sh/docs:github/`. Verify the current framework contribution policy when reviewing an import, then run its documented checks and production build before merging. A successful source export and a successful website deployment are separate results.

## Source and evidence

The command is declared in [`package.json`](https://github.com/unset-sh/tooling/blob/aad4a03c5db3d6d762c59543e1340744a941828a/package.json) and implemented by [`scripts/export-docs.mjs`](https://github.com/unset-sh/tooling/blob/aad4a03c5db3d6d762c59543e1340744a941828a/scripts/export-docs.mjs). The checked workflow sources are [`automation/docs-export.yml`](https://github.com/unset-sh/tooling/blob/aad4a03c5db3d6d762c59543e1340744a941828a/automation/docs-export.yml) and [`automation/docs-self.yml`](https://github.com/unset-sh/tooling/blob/aad4a03c5db3d6d762c59543e1340744a941828a/automation/docs-self.yml). The instructions and illustrative commands were checked against that source; they do not claim an observed cross-repository publication or deployment.
