# Changelog

Each entry describes changes for a repository calling these workflows. Unreleased changes stay below until an
approved release raises `package.json` and renames the heading to that version.

## Unreleased

- **Generated map staging PRs:** the organisation-map publisher now prepares a generated-only PR into staging
  without merging. A separate Actions-write job revalidates its exact base, head, two-file tree and authored profile
  boundary, then dispatches the three existing required workflows with those identities. Consumer dispatch adapters
  and the shared branch-policy route must be adopted together; committed main views still require human promotion.
- Restore the docs site's map refresh timer after moving the default branch to staging. A constrained
  dispatcher requests only the existing main site workflow; it does not promote staging content.
- Give tooling's documentation validation the distinct `validate-docs / Check` context, preserving
  `check / Check` for required CI and keeping export dependent on successful validation.

- **Repository policy:** `ci-repository-policy.yml` adds an opt-in `Repository policy` check for declared npm
  dependency pins, parsed workflow/action references, installed agent-kit lock integrity, and forbidden working-artifact
  paths. It reads an exact committed tree without running consumer code. Configuration and reasoned exact exceptions
  live in `.github/repository-policy.json`; stale exceptions and incomplete scans fail. Other consumers need adoption.
- Add an opt-in read-only PR metadata check for purpose labels, readiness, validation and documentation declarations.

- **PR branch policy:** `ci-branch-policy.yml` validates PR event metadata without a checkout or token.
  Feature and fork PRs may target `staging`; only same-repository `staging` may target stable `main`.
  Its job is named `Validate branch policy`. Tooling calls it on every PR and checks pushes to both branches.
  Human promotion authority remains an instruction; release, environment and deployment gates are unchanged.
- **Organisation map publication:** a repository-specific shared workflow regenerates and validates the two
  committed Markdown views with read-only permissions. Its isolated publisher accepts only those outputs,
  preserves authored profile text, and uses a generated-only PR with an exact-head squash merge. It never changes
  source declarations or repository protections. Consumer adoption and Actions PR permissions remain explicit.
- **Description data updates:** live collection reads the reviewed registry from the exact tooling default-branch
  commit already resolved for the snapshot and records its commit and SHA-256 separately from the executable pin.
  Metadata reviews can land without repeatedly changing caller workflow hashes. Missing or invalid remote metadata
  fails collection; the collector never falls back to a local registry.
- **Shared map refresh:** `automation-maps-refresh.yml` runs every generator registered in a consumer's
  `.github/maps.json` with a temporary read-only token, validates the complete JSON snapshot, and uploads it as
  `maps-<run-id>-<run-attempt>`. Inputs are `registry` and `install`; output `artifact-name` connects a dependent
  build to that same-run artifact. A failed generator or invalid output prevents upload. Consumers own their
  trigger schedule, semantic map validation, and publication; the shared workflow commits and deploys nothing.
- **Workflow descriptions:** the catalogue joins reviewed purposes, responsibilities and results from a bounded,
  versioned registry. Exact source hashes retain descriptions for historical callers; changed and undocumented
  workflows show explicit review or missing states. The same registry generates the human workflow reference,
  and `npm run check` checks its freshness. Runtime workflow behaviour is unchanged.
- **Workflow catalogue:** a read-only collector discovers public organisation repositories, documents their
  declared triggers and jobs, and resolves reusable calls at their exact commits. The documentation site supplies
  its YAML parser and refresh schedule. Collection runs no repository code and requires no new credentials.
- **Source layout:** reusable implementations live in `workflows/shared/`, repository-specific automation in
  `workflows/<repository>/`, and maintained human guides in `docs/`. An explicit manifest keeps all six existing
  executable filenames stable. Only tooling's own callers have moved into the repository-specific namespace.

Shared developer tooling now lives in `unset-sh/tooling`. Manifest-selected sources generate the committed, flat
`.github/workflows/` entry points. Organisation defaults and starter templates remain in `unset-sh/.github`.
Consumers use full reviewed commit pins; automatic adoption and merging are not part of this migration.

- **`ci-check.yml`** runs a consumer's check with its pinned Node version and a read-only token. Inputs are
  `install`, `command`, `keep`, and `timeout-minutes`.
- **`releases-package.yml`** starts from a raised version on `main`, checks the protected `release` environment,
  builds once, waits for the owner's approval, verifies the output again, attests it, and publishes it. Inputs are
  `install`, `check`, `build`, `files`, and `npm-package`. The approval, permission and hostile-output refusals are
  preserved from the earlier implementation. Verification names
  `unset-sh/tooling/.github/workflows/releases-package.yml` as the signer.
- **`automation-docs-export.yml`** exports only committed public documentation and the root licence, using the
  central helper at the workflow's own full commit. It accepts no inputs, runs no consumer build code, and uploads
  a read-only artifact named `docs-<commit>`. Callers gate export on their own checks. The CLI/API also accepts a
  validated `unset-sh/<repository>` name, defaulting to `unset-sh/tooling`; sections match repository slugs except
  `.github`, which exports to `github/`. Tooling exports its `docs/` tree; other consumers retain their existing
  `docs/site/` source contract. Framework and generated documentation sections are reserved.

The check and release workflows target public repositories. Release environment setup and the first release still
require the owner's action; version remains `0.0.0`. The public guides in `docs/` describe caller setup,
verification and documentation export. The exporter does not push to another repository or deploy a site.
