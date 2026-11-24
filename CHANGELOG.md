# Changelog

Each entry describes changes for a repository calling these workflows. Unreleased changes stay below until an
approved release raises `package.json` and renames the heading to that version.

## Unreleased

- **Docs imports read their sources with the job token:** source reads were anonymous, so they shared the
  runner's per-address quota and GitHub refused them with HTTP 403 (docs-import run 45302302882). The importer and
  verifier now send the docs job token on every `api.github.com` request for the allowlisted repositories. Writes
  stay docs-only, and raw section reads stay unauthenticated. Callers move their pins to take it.
- **Docs imports wait for GitHub to show a pushed head:** GitHub applies a head push to its pull request
  asynchronously, so the PR update right after moving an import branch could still report the old head, and the
  publisher refused its own PR (docs PR 15, run 45301633681). It now re-reads the PR up to 10 times, 2 seconds
  apart, and still refuses a PR that never shows the new head. Callers move their pins to take it.
- **Docs import refusals name their reason:** the importer and the generated-PR verifier printed one generic
  line for every refusal, so a failed run could not say whether the PR, a hash or a GitHub request (and its HTTP
  status) was at fault. They now add `Reason: <message>` for the importer's own refusals, whose messages are fixed
  text with at most an HTTP status. Other errors stay hidden. Callers move their pins to take it.
- **Docs imports survive a moved docs `main`:** an open import PR keeps GitHub's `base.sha` from when it was opened
  or last pushed, so after docs `main` advanced, the publisher refused the PR as foreign and the import stalled
  (docs PR 15). The publisher now also accepts the base recorded in the import branch's own verified head, then
  reconciles as before. Dispatch still requires the current base. Callers move their docs-import pin to take it.
- **A Postgres service for the check:** `ci-check.yml` takes an optional `postgres-image`, a Postgres image pinned
  by digest (`postgres:<tag>@sha256:<64 hex>`). When it is set, the job runs that image as a service on the
  runner's loopback with no password, refuses any image not in that form, and sets `PGHOST`, `PGPORT`, `PGUSER`
  and `PGDATABASE` for the check. Empty, the default, starts nothing, so existing callers are unchanged. First
  caller: `unset-sh/backend`, whose tests need a real database.
- **Bun replaces Node (Alex, 2026-11-23):** every workflow installs Bun 1.4.4 (1.4.5, released 2026-11-19, is still inside the 7-day wait) with `oven-sh/setup-bun` v2.2.0 at a
  full commit, with no cache and no token, and then refuses any other version. A caller now needs a `.bun-version`
  naming an exact Bun version in place of `.nvmrc`, and a committed `bun.lock` in place of `package-lock.json` when
  `install` is on; a missing `bun.lock` fails the job. `install` runs `bun install --frozen-lockfile
  --ignore-scripts`, and the default `command`/`check` is `bun run check`. Input, output, job and check names are
  unchanged. Callers pinned to older commits are unaffected until they move their pin.
- **Releases pack and publish with Bun:** `releases-package.yml` and `releases-channel.yml` pack with `bun pm pack`,
  attest that exact file, and publish it with `bun publish` from an empty folder that is also its HOME, with only
  `PATH`, `HOME` and `NPM_CONFIG_TOKEN` in its environment and an explicit registry. The packed-package reader now
  accepts only the header form `bun pm pack` writes and keeps every earlier refusal; its tests pack, publish to a
  local registry and install with the Bun that runs them. Channel releases read `bun.lock` and refuse
  `package-lock.json`, `npm-shrinkwrap.json` and `bun.lockb`. Live publication to GitHub Packages with Bun has not
  run yet.
- **Installing `@unset-sh` packages:** with `install` on, `ci-check.yml`, `releases-package.yml` and
  `releases-channel.yml` now give the install step alone `NPM_CONFIG_TOKEN`, the job's token with `packages: read`,
  so a repository whose `bunfig.toml` names `$NPM_CONFIG_TOKEN` for the `@unset-sh` scope can install from GitHub
  Packages. The check and build commands never see it. A `ci-check.yml` caller must now grant `packages: read`
  as well as `contents: read`, or GitHub refuses the run; release callers already grant `packages: write`. The
  package must also give the calling repository read access under its **Manage Actions access** setting.

- **Main-only repositories (org-0010):** `ci-branch-policy.yml` adds a `flow` input. The default `staged` keeps
  today's rules; `main` accepts pull requests from any branch or fork into `main` and refuses every other base. An
  unknown value fails the check. The documentation import (`automation-docs-import.yml`), the docs site timer
  (`automation-docs-map-schedule.yml`) and the organisation-map publisher (`automation-org-map.yml`) now run on
  and target `main` in `unset-sh/docs` and `unset-sh/.github`, which no longer have staging branches. Callers in
  those two repositories must re-pin only after their default branch is `main`; callers pinned to older commits
  are unaffected.

- **Documentation imports:** a docs-owned hourly receiver re-exports allowlisted exact stable revisions, validates complete provenance against Git objects, and prepares section-only staging PRs. Writing and dispatch permissions are isolated; supplemental dispatched validation verifies the actual generated PR before executing consumer code. These dispatched results do not satisfy PR ruleset checks; ordinary PR runs require human approval with the current job-token publisher. No PR merge or production promotion is automated. Shared branch policy adds a narrow generated-dispatch path for docs imports and organisation maps while retaining its permission-free ordinary PR mode.

- **Generated map staging PRs:** the organisation-map publisher now prepares a generated-only PR into staging
  without merging. A separate Actions-write job revalidates its exact base, head, two-file tree and authored profile
  boundary, then dispatches the three fixed validation workflows with those identities. These runs are supplemental;
  ordinary PR checks remain approval-required with GITHUB_TOKEN. Unattended PR checks need a separately approved
  GitHub App authentication design. Consumer adapters and the shared branch-policy route must be adopted together;
  committed main views still require human promotion.
- **Staged release channels:** the separate `releases-channel.yml` entry point derives immutable staging
  prereleases and publishes stable versions only from an exact merged same-repository staging promotion.
  It prepares supported root manifests and locks without changing dependency selections, rechecks active
  rules and pre-existing channel environments, validates artifacts against committed source, and reserves
  tags without overwriting them. The legacy approved release path remains unchanged. No caller or environment
  is activated; human promotion and settings audits remain separate responsibilities.
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
