---
title: "How workflow sources become GitHub entry points"
description: "Find shared and repository-specific automation, then follow its manifest mapping to GitHub."
weight: 20
type: docs
params:
  doc_kind: explanation
  checked_source_revision: "50b5ae0db21922603e3dc74530589db49bed2700"
---

The repository separates shared implementations, repository-specific automation, and maintained human documentation. A manifest maps each authored workflow to its executable file in the flat `.github/workflows/` directory required by GitHub.

This page describes the **unreleased implementation at `50b5ae0db21922603e3dc74530589db49bed2700`**. It explains the source and execution boundaries; it does not imply that every organisation repository already calls these workflows.

## Authored sources and executable entry points

In `unset-sh/tooling`, `.github/workflows/` is the directory GitHub scans for executable workflows. The `workflows/` tree is the authoring location; GitHub does not run those files directly. The separate `unset-sh/.github` repository provides organisation metadata and native caller templates.

Open `workflows/` to see which automation is shared and which belongs to a particular repository:

```text
tooling/
├── docs/                         Human guides exported to the documentation site
├── workflows/
│   ├── manifest.json             Explicit source-to-entry-point mappings
│   ├── descriptions.json         Reviewed purposes, responsibilities, and results
│   ├── shared/
│   │   ├── ci/
│   │   │   ├── check.yml
│   │   │   ├── branch-policy.yml
│   │   │   ├── pr-policy.yml
│   │   │   └── repository-policy.yml
│   │   ├── docs/
│   │   │   ├── export.yml
│   │   │   └── maps.yml
│   │   ├── image/
│   │   │   └── staging.yml
│   │   └── releases/
│   │       ├── package.yml
│   │       └── channel.yml
│   ├── github/docs/map.yml
│   └── tooling/
│       ├── ci/
│       │   ├── self.yml
│       │   ├── branch-policy.yml
│       │   ├── pr-policy.yml
│       │   └── repository-policy.yml
│       ├── docs/self.yml
│       └── release/self.yml
└── .github/workflows/            Generated executable files
```

`workflows/shared/docs/` contains documentation automation reusable by any adopting repository. `workflows/docs/` contains automation specifically maintained here for the `unset-sh/docs` repository, including its timer for approved main site builds. `workflows/tooling/` contains tooling's callers; `workflows/github/` contains the organisation-map publisher maintained for `unset-sh/.github`. Other repositories retain their own workflows until a reviewed migration; empty placeholder folders would imply adoption that has not happened.

The [manifest](https://github.com/unset-sh/tooling/blob/50b5ae0db21922603e3dc74530589db49bed2700/workflows/manifest.json) records these exact mappings:

| Authored source | Generated entry point | Responsibility |
| --- | --- | --- |
| `workflows/docs/pages/schedule.yml` | `.github/workflows/automation-docs-map-schedule.yml` | Request the approved main site refresh from the docs main timer |
| `workflows/shared/ci/check.yml` | `.github/workflows/ci-check.yml` | Shared check |
| `workflows/tooling/ci/self.yml` | `.github/workflows/ci-self.yml` | This repository's check caller |
| `workflows/shared/ci/branch-policy.yml` | `.github/workflows/ci-branch-policy.yml` | Validate PR origins for staged or main-only repositories |
| `workflows/tooling/ci/branch-policy.yml` | `.github/workflows/ci-branch-policy-self.yml` | This repository's branch-policy caller |
| `workflows/shared/ci/pr-policy.yml` | `.github/workflows/ci-pr-policy.yml` | Validate current PR purpose labels and readiness, validation and documentation declarations |
| `workflows/tooling/ci/pr-policy.yml` | `.github/workflows/ci-pr-policy-self.yml` | This repository's PR-metadata caller |
| `workflows/shared/ci/repository-policy.yml` | `.github/workflows/ci-repository-policy.yml` | Read-only dependency/action pins, kit integrity and working-artifact path checks |
| `workflows/tooling/ci/repository-policy.yml` | `.github/workflows/ci-repository-policy-self.yml` | This repository's repository-policy caller |
| `workflows/shared/releases/channel.yml` | `.github/workflows/releases-channel.yml` | Separate immutable staging prereleases and stable publication from exact human promotions |
| `workflows/shared/releases/package.yml` | `.github/workflows/releases-package.yml` | Protected package and release-asset publication |
| `workflows/tooling/release/self.yml` | `.github/workflows/releases-self.yml` | This repository's release caller |
| `workflows/shared/image/staging.yml` | `.github/workflows/image-staging.yml` | Build a container image on a push to staging, push it by digest to `ghcr.io/unset-sh/staging/<repository>` and attest it |
| `workflows/shared/docs/export.yml` | `.github/workflows/automation-docs-export.yml` | Reusable export of a consumer's committed public documentation |
| `workflows/shared/docs/maps.yml` | `.github/workflows/automation-maps-refresh.yml` | Refresh every registered map and upload one complete validated JSON snapshot |
| `workflows/tooling/docs/self.yml` | `.github/workflows/automation-docs-self.yml` | This repository's check and documentation-export caller |
| `workflows/github/docs/map.yml` | `.github/workflows/automation-org-map.yml` | Publish validated generated organisation-map views through a bounded pull request |

The executable names remain stable for existing callers, including the `automation-docs-` filenames. New responsibilities, such as a shared deployment, need a concrete implementation, contract, and manifest entry before they appear here. Native picker templates are maintained directly in [`unset-sh/.github/workflow-templates/`](https://github.com/unset-sh/.github/tree/db0d794cf1761644ebc379fb2a36e50571f199a7/workflow-templates); they are not generated by tooling.

For the organisation-wide executable inventory and actual caller relationships, use the [workflow map](https://docs.unset.sh/workflows/). Its [collector reference](workflow-map.md) explains exact pinned targets, the refresh boundary, and what cannot be inferred from YAML alone.

The [workflow reference](workflow-reference.md) supplies the maintained explanation of what each reviewed workflow does and produces. Its source is `workflows/descriptions.json`; `bun run workflows:describe` regenerates the human page, and the live map flags descriptions when workflow bytes change. To add a map to automatic collection, follow [Refresh every published map](map-refresh.md).

## From source to a run

The arrows below mean “produces” for generation and “calls” for runtime:

```text
Authored source: workflows/shared/ci/check.yml
    | bun run workflows produces
    v
Committed entry point: .github/workflows/ci-check.yml
    ^ a pinned caller calls
    |
Consumer repository: .github/workflows/ci.yml
    | its pull request or push starts
    v
Run checks against that consumer's code
```

The central repository owns job orchestration, helper scripts, and workflow tests. The consumer owns its triggers, input values, build/test commands, and required checks. A shared workflow runs with the consumer's GitHub context and the permissions its caller grants. Placing it centrally does not automatically trigger every repository.

## Example: change the shared check

Suppose the shared check needs a different artifact-retention setting. Edit `workflows/shared/ci/check.yml` in a checkout of `unset-sh/tooling`. With Bun 1.4.4, run these commands from the repository root:

```sh
bun run workflows
bun run check
```

Commit the source, any manifest change, and generated entry point together. Generation adds a source-and-destination comment and preserves the YAML body; it does not interpret or rewrite workflow expressions. A consumer still uses its existing pinned revision until a reviewed caller update selects the new one.

If someone edits the generated file directly, the freshness check reports the mismatch. Move the intended change into the authored source and regenerate. The generator refuses missing or unmapped sources, duplicate destinations, links, and collisions with unmanaged files. A source move requires an explicit manifest change; folder names do not determine executable names.

## Keep dependency pins current

The [Renovate configuration](https://github.com/unset-sh/tooling/blob/50b5ae0db21922603e3dc74530589db49bed2700/.github/renovate.json) includes authored category YAML in `github-actions.managerFilePatterns` alongside the manager's default generated-workflow matching. This lets update proposals reach the source pins as well as their executable copies. Before accepting an update, regenerate from the category sources and run `bun run check`; a bot edit does not replace the generation-freshness gate.

## Why keep generated copies

The shared and repository namespaces make ownership visible as the catalogue grows. GitHub requires executable YAML in a flat directory, so this choice also creates committed copies. The [generator tests](https://github.com/unset-sh/tooling/blob/50b5ae0db21922603e3dc74530589db49bed2700/scripts/workflows.test.mjs) and `bun run check` catch missing, stale, and orphaned generated output. Review still needs to assess each workflow's behaviour and permissions.

## Source and related guidance

The implementation is [`scripts/workflows.mjs`](https://github.com/unset-sh/tooling/blob/50b5ae0db21922603e3dc74530589db49bed2700/scripts/workflows.mjs), with commands in [`package.json`](https://github.com/unset-sh/tooling/blob/50b5ae0db21922603e3dc74530589db49bed2700/package.json). The relevant GitHub rules cover [reusable workflow locations](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) and [organisation starter templates](https://docs.github.com/en/actions/how-tos/reuse-automations/create-workflow-templates).

To use these entry points, follow [Prepare a repository to use shared workflows](use-workflows.md). The [documentation export guide](export-docs.md) follows `workflows/shared/docs/export.yml` from a checked commit to an artifact. For the package and release-asset publication boundary, read the [release reference](release-reference.md). Moving implementation here does not activate an organisation-wide run or update a consumer pin; [automatic adoption remains planned](use-workflows.md#planned-automatic-adoption).
