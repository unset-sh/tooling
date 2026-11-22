# Changelog

Each entry describes changes for a repository calling these workflows. Unreleased changes stay below until an
approved release raises `package.json` and renames the heading to that version.

## Unreleased

- **Workflow catalogue:** a read-only collector discovers public organisation repositories, documents their
  declared triggers and jobs, and resolves reusable calls at their exact commits. The documentation site supplies
  its YAML parser and refresh schedule. Collection runs no repository code and requires no new credentials.

Shared developer tooling now lives in `unset-sh/tooling`. Category sources generate the committed, flat
`.github/workflows/` entry points. Organisation defaults and starter templates remain in `unset-sh/.github`.
Consumers use full reviewed commit pins; automatic adoption and merging are not part of this migration.

- **`ci-check.yml`** runs a consumer's check with its pinned Node version and a read-only token. Inputs are
  `install`, `command`, `keep`, and `timeout-minutes`.
- **`releases-package.yml`** starts from a raised version on `main`, checks the protected `release` environment,
  builds once, waits for the owner's approval, verifies the output again, attests it, and publishes it. Inputs are
  `install`, `check`, `build`, `files`, and `npm-package`. The approval, permission and hostile-output refusals are
  preserved from the earlier implementation. Verification names
  `unset-sh/tooling/.github/workflows/releases-package.yml` as the signer.
- **`automation-docs-export.yml`** exports only committed `docs/site/` files and the root licence, using the
  central helper at the workflow's own full commit. It accepts no inputs, runs no consumer build code, and uploads
  a read-only artifact named `docs-<commit>`. Callers gate export on their own checks. The CLI/API also accepts a
  validated `unset-sh/<repository>` name, defaulting to `unset-sh/tooling`; sections match repository slugs except
  `.github`, which exports to `github/`. Framework and generated documentation sections are reserved.

The check and release workflows target public repositories. Release environment setup and the first release still
require the owner's action; version remains `0.0.0`. The public guides in `docs/site/` describe caller setup,
verification and documentation export. The exporter does not push to another repository or deploy a site.
