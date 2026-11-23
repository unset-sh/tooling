---
title: "Adopt repository policy checks"
description: "Check declared dependency references, action pins, installed-kit integrity, and working-artifact paths without running consumer code."
weight: 13
type: docs
params:
  doc_kind: guide
  checked_source_revision: "cac06e938139f53192e9e2fa85805b62ebfe2856"
---

Add `ci-repository-policy.yml` to check mechanical repository rules on pull requests and pushes. The shared job reads the exact committed tree, applies the repository's explicit scope, and returns a check named **Repository policy**. Alex maintains the central implementation; each consuming repository owns its configuration, exceptions, and caller review.

This implementation is unreleased at version `0.0.0`. Tooling includes its own caller. Adding the shared workflow does not activate it elsewhere or make its status required by a ruleset.

## Before you start

Choose a reviewed full tooling commit and retain your existing application checks. The workflow needs GitHub Actions access to tooling and `contents: read`. It accepts no workflow inputs or stored secrets, installs no consumer dependencies, and executes no consumer scripts. Bun comes from the pinned tooling checkout, independently of the consumer's runtime.

Review all workflow and policy configuration changes. A pull request can change its own caller, exceptions, or inspected manifests; this check is not a tamper-proof server-side rule. Branch rules and independent review remain necessary.

## Declare the scope

Commit `.github/repository-policy.json` in the consuming repository. Every field below is required; an empty array explicitly selects no entries for that field. This illustrative configuration checks the root npm manifest and checks an installed kit when present:

```json
{
  "schemaVersion": 1,
  "dependencyManifests": ["package.json"],
  "actionDefinitions": [],
  "kit": "if-present",
  "artifactPaths": [],
  "exceptions": []
}
```

List each workspace's `package.json` explicitly in `dependencyManifests`. List local composite definitions such as `.github/actions/check/action.yml` in `actionDefinitions`; these are not discovered automatically. Every flat `.github/workflows/*.yml` or `.yaml` file is always inspected. Referenced external actions and workflows are checked for immutable references, without fetching or auditing their implementation.

Set `kit` to `required` when the repository must contain an installed kit. `if-present` permits an absent kit but rejects partial installations. The reserved paths are `.claude/agent-kit/`, `.claude/rules/org/`, `.claude/skills/org-<name>/`, and direct `.claude/agents/org-*` files, following agent-kit's installation schema.

The root `notes/` and `artifacts/` paths are forbidden outside `unset-sh/agent-kit`. Add repository-specific working directories as literal prefixes ending in `/`, for example `"artifactPaths": ["scratch/"]`. There is no wildcard matching. Maintained human documentation remains in the owning repository's `docs/` and follows its documentation rules.

## Add the caller

Create a workflow such as `.github/workflows/repository-policy.yml`. Replace `APPROVED_COMMIT_SHA` with the reviewed full 40-character commit. This example checks all pull requests and pushes to the organisation's staging and stable branches:

```yaml
name: repository-policy
on:
  pull_request:
  push:
    branches: [staging, main]
permissions: {}
jobs:
  policy:
    uses: unset-sh/tooling/.github/workflows/ci-repository-policy.yml@APPROVED_COMMIT_SHA
    permissions:
      contents: read
```

Avoid path filters when this is a required check. The shared workflow verifies its own repository and revision, checks out the consumer and central helpers at separate exact commits, installs the checksum-verified parser, and inspects committed Git blobs. Uncommitted files and local modifications do not affect the result. On a pull request, the inspected revision is GitHub's event commit, normally its proposed merge commit.

The job produces its conclusion and bounded diagnostics in the run log. It creates no repository changes, reports to external services, release, or deployment. Confirm the actual status label, expected as `policy / Repository policy` for this caller, before requiring it in a ruleset.

## What the check proves

| Check | Accepted declarations | Limit |
| --- | --- | --- |
| npm dependency pins | Exact semantic versions, exact `npm:` aliases, or supported GitHub Git references ending in a full lowercase 40-character SHA | Checks `dependencies`, `devDependencies`, and `optionalDependencies` only in declared manifests. Peer ranges describe compatibility and are excluded. Lockfile integrity, transitive dependencies, package provenance, release age, and other package managers need separate checks. |
| Workflow and action pins | Full Git commit pins for external action/reusable-workflow `uses`, digest pins for `docker://` action references, and local uses | Uses zizmor's parsed `unpinned-uses` findings and action-only `unpinned-images` findings. It does not check job/service image pins or establish that a referenced commit exists, is trusted, or meets the dependency waiting period. |
| Installed-kit integrity | Valid kit lock and exact SHA-256 matches for all listed owned files, with no unlisted owned files | Establishes consistency with the committed lock. It does not authenticate a release or stop a coordinated malicious change to both the lock and files. The consumer's `sync.mjs` is never executed. |
| Working-artifact paths | No tracked files under forbidden prefixes, except reasoned exact-path exceptions | Detects declared paths, not authorship or meaning. Review must still catch AI notes placed under unrelated names. |

Supported Git dependency forms are `github:owner/repository#FULL_SHA` and `git+https://github.com/owner/repository.git#FULL_SHA`. Ranges, mutable tags, arbitrary URLs, `file:` and workspace references need an explicit reviewed exception. The gate makes no claim about licence compatibility or legal correctness.

The parser is [zizmor 1.32.0](https://github.com/zizmorcore/zizmor/releases/tag/v1.32.0), published on 2026-11-02 and selected after the seven-day dependency wait. CI verifies the fixed Linux archive's SHA-256 before extraction. Scanning is offline, ignores consumer scanner configuration and lockfiles, retains findings suppressed by comments, and fails on parsing or subprocess errors. Only the pin rules in the table affect this gate; other scanner audits are outside its scope. See the official [unpinned-uses audit](https://docs.zizmor.sh/audits/#unpinned-uses) and [CLI configuration](https://docs.zizmor.sh/configuration/).

## Review an exception

An exception permits one exact finding. It requires a reason and fails when unused, so removing the affected reference also requires removing its exception. There are no whole-check exclusions or exceptions for a damaged kit.

For an illustrative local workspace dependency, the following single entry allows exactly `dependencies.shared` in the root manifest to use `workspace:*`:

```json
{
  "kind": "dependency",
  "path": "package.json",
  "key": "dependencies.shared",
  "reference": "workspace:*",
  "reason": "This dependency is supplied by the same reviewed workspace and locked by its package manager."
}
```

Put it inside the configuration's `exceptions` array. A workflow exception uses `kind`, `path`, `reference`, and `reason`; it matches that exact `uses` reference anywhere in the named file. An artifact exception uses `kind`, `path`, and `reason`, and permits one exact file. Do not put credentials in references or reasons. Reasons record a review decision; the checker cannot judge whether the reason is sound.

## Verify and recover

For example, changing a declared dependency from `1.2.3` to `^1.2.3` produces a dependency violation for its manifest. Restore a reviewed exact version, or propose a justified exact exception through review. A floating action tag similarly fails even when its YAML includes a scanner ignore comment. Changing an installed kit file without its corresponding lock update fails integrity validation; restore the installation or update it through the reviewed kit process.

A configuration, parsing, missing-file, source-identity, or size failure stops the scan. It never produces a partial passing result. Review the committed config and inputs, rather than a dirty local copy. Diagnostics omit reference values, parser source snippets, and raw subprocess errors. If the scanner download fails, rerun after availability is restored; do not remove its checksum or ignore the failed job.

Bounds include 50,000 tracked tree entries; 200 manifests and 200 configured action definitions; 200 total scanned workflow/action files; 1 MiB per selected source, 8 MiB scanner input and 16 MiB total selected input; a 64 KiB config; and 500 exceptions. Configured paths use ASCII letters, digits, dots, underscores, hyphens and `/`, with no traversal, `.git`, links, or ambiguous case duplicates. A repository beyond these limits needs a reviewed extension, not a silent partial scan.

The source tests exercise exact exceptions, dirty-tree isolation, malformed inputs, symlinks, byte bounds and lock integrity. A separate run against the verified real parser checks quoted/flow YAML, ignore comments, reusable calls, Docker actions and malformed YAML. These tests establish local behaviour; verify the first actual consumer run before treating adoption as complete.

## Source and maintenance

This guide describes the unreleased implementation at `cac06e938139f53192e9e2fa85805b62ebfe2856`. Review the [shared workflow](https://github.com/unset-sh/tooling/blob/cac06e938139f53192e9e2fa85805b62ebfe2856/workflows/shared/ci/repository-policy.yml), [committed-source reader](https://github.com/unset-sh/tooling/blob/cac06e938139f53192e9e2fa85805b62ebfe2856/scripts/repository-policy.mjs), [data validators](https://github.com/unset-sh/tooling/blob/cac06e938139f53192e9e2fa85805b62ebfe2856/scripts/repository-policy-data.mjs), and [parser bridge tests](https://github.com/unset-sh/tooling/blob/cac06e938139f53192e9e2fa85805b62ebfe2856/scripts/repository-policy-scanner.test.mjs). Alex reviews this page with workflow changes and before releases, as specified in [the repository rules](https://github.com/unset-sh/tooling/blob/cac06e938139f53192e9e2fa85805b62ebfe2856/CLAUDE.md).
