---
title: "Developer tooling"
description: "Use and maintain the shared checks, protected releases, and documentation exports for unset.sh."
weight: 50
type: docs
cascade:
  type: docs
menus:
  main:
    weight: 50
params:
  doc_kind: overview
  checked_source_revision: "aad4a03c5db3d6d762c59543e1340744a941828a"
---

`unset-sh/tooling` maintains the shared GitHub Actions implementations and supporting scripts used by unset.sh repositories. A consumer keeps a small workflow that selects its events, permissions, and inputs, then calls an approved central commit. Its tests and build commands remain in that consumer.

The implementation described here is **unreleased, at version 0.0.0**. No consumer adoption or automatic update pipeline is implied by moving the shared code here.

## Where it fits

| Repository | Responsibility |
| --- | --- |
| `unset-sh/tooling` | Shared checks, protected releases, documentation-export helpers, and their tests |
| `unset-sh/.github` | Organisation profile, community defaults, repository map, and native workflow-picker templates |
| Each consumer | Events, permissions, pinned callers, project checks, build commands, and release approval |
| `unset-sh/agent-kit` | Shared agent instructions and agent working notes and artifacts |
| `unset-sh/docs` | Documentation rendering and publication |

This repository owns the public pages under `docs/site/`. Its exporter packages those pages as the `tooling/` section for a reviewed import into `unset-sh/docs`. Exporting an artifact does not deploy the website.

## Learn and use

- [Prepare a repository to use shared workflows](use-workflows.md): preserve the repository's checks while adding a pinned caller.
- [Release workflow reference](release-reference.md): inspect inputs, approval requirements, publication boundaries, and verification.
- [Export the public documentation](export-docs.md): package an exact source revision for a reviewed import.
- [Manage a documentation publishing key](manage-docs-publishing-key.md): operate the separate credential used by an existing source publisher.

## Understand and contribute

- [How workflow sources become GitHub entry points](workflow-layout.md): follow authored category files through generation and consumer execution.
- [Release workflow reference](release-reference.md#permissions-and-publication-boundary): understand the separation between consumer builds and protected publication.
- [Export the public documentation](export-docs.md#use-the-workflow-artifact): understand the consumer checkout, central helper revision, and artifact boundary.
- [Prepare a repository to use shared workflows](use-workflows.md#planned-automatic-adoption): distinguish a reviewed pin update from the proposed automatic adoption pipeline.

## Source and version

The [source repository](https://github.com/unset-sh/tooling) contains the maintained implementation. These pages describe the [checked source revision](https://github.com/unset-sh/tooling/tree/aad4a03c5db3d6d762c59543e1340744a941828a); individual pages link to the relevant helpers and tests. The organisation's [native caller templates](https://github.com/unset-sh/.github/tree/db0d794cf1761644ebc379fb2a36e50571f199a7/workflow-templates) are maintained separately in `.github`.
