# CLAUDE.md: unset-sh/tooling

## Where this repository fits

This is `unset-sh/tooling`: the maintained developer tooling for the organisation's repositories.

- **Belongs here:** shared check, release and documentation-export implementations, supporting scripts and tests.
  Repository-specific helpers also belong here; consumers retain their build/test commands and small event callers.
- **Lives elsewhere:** organisation metadata, community defaults and directly authored starter templates in
  `unset-sh/.github`; product code, documentation and assets in the repository that owns them.

## Rules

- Use Node 26 (`.nvmrc`), no dependencies, and `node:test`. Actions are pinned by full commit SHA.
- Reusable implementations live in `workflows/shared/<purpose>/`; repository-specific automation lives in
  `workflows/<repository>/<purpose>/`. Add a folder with its first implementation, not as a placeholder.
  Register every source and its stable executable path in `workflows/manifest.json`, then run `npm run workflows`.
  Commit generated `.github/workflows/` files, never edit them. A source move must preserve consumer entry points.
  There are no starter templates here. The generator retains optional template support for its isolated fixtures.
- `npm run check` checks generation freshness, the release scripts, docs exporter and workflow security invariants.
  Preserve every release refusal when moving code. Inputs, outputs, check names and signer paths are external contracts.
- AI plans, migration notes and review artifacts live in `unset-sh/agent-kit` under `notes/` and `artifacts/`, never
  in ad hoc Markdown files here. Maintained human documentation belongs in `docs/`, follows agent-kit's
  org-documentation standard, and exports to `unset-sh/docs:tooling/`. Alex owns these pages; review them with each
  workflow change and before each release. Update the relevant guide/reference in the same PR, or state a reviewed
  no-change reason. Exports read a full committed revision, include provenance and licence, and never write another
  repository automatically. Do not add deploy credentials to the exporter.
- The release workflow is security-sensitive. Trigger, permission, environment, reviewer and publish behaviour
  changes require the owner's decision. Alex approved hosting the shared tooling in `unset-sh/tooling` on
  2026-11-22; that authorizes the repository/signer path migration, not weakening an approval or verification gate.
- The release `publish` job runs no consuming-repository code and treats all build output as untrusted. Only that
  job writes and uses the protected `release` environment. Check and documentation-export jobs are read-only.
- No stored secrets in shared workflows. Use job-scoped permissions, disable persisted checkout credentials, and
  pass expression values through `env`, never interpolate them into shell scripts. Central helper checkouts must
  fail closed unless their repository and full commit identity match the running workflow.
- Raising Node also raises npm. Re-read npm's publish/archive handling before changing the pinned version; hostile
  archive comparisons in `checks/release-package.test.mjs` must pass against its bundled npm.
- Record caller-visible changes in `CHANGELOG.md`. Keep version `0.0.0` until the first approved release. Consumer
  calls use full reviewed commit pins. Automatic adoption and automatic merging need their own implementation.
- Never commit on `main`, a shared branch or a detached HEAD. Use your own `claude/<task>` or `cursor/<task>` branch.
  Land through a PR; do not merge your own implementation PR. Release setup and approval remain the owner's action;
  document what has not run rather than treating local tests as proof of live release behaviour.
- The owner is named only as Alex or by the GitHub login `Undefined6799`; their surname never appears.
