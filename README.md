# tooling

Shared developer tooling for unset.sh: reusable checks, protected releases, and documentation exports.
Each repository keeps a small caller with its own events, permissions, inputs, and project commands.

**Version 0.0.0 is unreleased.** Consumers adopt an approved release through a reviewed full-commit pin;
automatic update propagation is not implemented.

| Path | Maintained here |
| --- | --- |
| `workflows/shared/ci/` | Reusable checks |
| `workflows/shared/releases/` | Reusable protected package and release-asset publication |
| `workflows/shared/docs/` | Reusable documentation exports |
| `workflows/tooling/` | This repository's CI, documentation and release callers |
| `workflows/manifest.json` | Explicit source-to-entry-point mapping |
| `.github/workflows/` | Generated, flat entry points required by GitHub Actions |
| `scripts/` and `checks/` | Generators, shared helpers, and their checks |
| `docs/` | Human documentation exported to the `tooling/` section in `unset-sh/docs` |

Start with the [documentation overview](docs/_index.md), [caller guide](docs/use-workflows.md),
or [workflow layout](docs/workflow-layout.md). With the Bun version in `.bun-version`, run `bun run workflows`
after editing a source or its manifest mapping, then `bun run check`.

Repository-specific automation belongs under `workflows/<repository>/` when it is maintained here.
Only `tooling/` has such entries today; other repositories retain their own workflows until a reviewed migration.
The [workflow catalogue guide](docs/workflow-map.md) explains the automatically refreshed organisation map.
The [staged release guide](docs/release-channels.md) describes the separate staging/main publication contract
and its explicit activation prerequisites.

[unset-sh/.github](https://github.com/unset-sh/.github) owns the organisation profile, community defaults,
repository map, and native workflow-picker templates. [unset-sh/agent-kit](https://github.com/unset-sh/agent-kit)
owns shared agent instructions, working notes, and agent artifacts. [unset-sh/docs](https://github.com/unset-sh/docs)
owns the documentation renderer and publication.
