# tooling

Shared developer tooling for unset.sh: reusable checks, protected releases, and documentation exports.
Each repository keeps a small caller with its own events, permissions, inputs, and project commands.

**Version 0.0.0 is unreleased.** Consumers adopt an approved release through a reviewed full-commit pin;
automatic update propagation is not implemented.

| Path | Maintained here |
| --- | --- |
| `ci/` | Shared Node checks and this repository's check caller |
| `releases/` | Protected package and release-asset publication, plus this repository's caller |
| `automation/` | Committed-tree documentation exports and this repository's export caller |
| `.github/workflows/` | Generated, flat entry points required by GitHub Actions |
| `scripts/` and `checks/` | Generators, shared helpers, and their checks |
| `docs/site/` | Human documentation exported to the `tooling/` section in `unset-sh/docs` |

Start with the [documentation overview](docs/site/_index.md), [caller guide](docs/site/use-workflows.md),
or [workflow layout](docs/site/workflow-layout.md). With the Node version in `.nvmrc`, run `npm run workflows`
after editing a category source, then `npm run check`.

[unset-sh/.github](https://github.com/unset-sh/.github) owns the organisation profile, community defaults,
repository map, and native workflow-picker templates. [unset-sh/agent-kit](https://github.com/unset-sh/agent-kit)
owns shared agent instructions, working notes, and agent artifacts. [unset-sh/docs](https://github.com/unset-sh/docs)
owns the documentation renderer and publication.
