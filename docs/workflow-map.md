---
title: "Maintain the workflow catalogue"
description: "Understand the public workflow inventory, exact reusable-call relationships, and safe refresh boundary."
weight: 25
type: docs
params:
  doc_kind: reference
  checked_source_revision: "4c46364843ff30b8cb3ff2c78d6d99a9407ad3bc"
---

The [organisation workflow map](https://docs.unset.sh/workflows/) documents the GitHub Actions configuration in public `unset-sh` repositories. Its catalogue comes from workflow YAML and exact Git revisions. Tooling owns collection; the documentation site owns parsing, the saved snapshot, rendering, and publication.

Use the map to find a workflow, inspect its declared triggers and jobs, and trace a reusable call to the implementation the caller actually selects. It describes configuration. It does not establish that a run succeeded, that GitHub Actions is enabled, or that an environment has the required approval settings.

## What the catalogue contains

Every discovered public repository has an entry, including archived repositories, empty repositories, and repositories without workflows. Executable files are the regular `.yml` and `.yaml` files directly inside `.github/workflows/`; category sources and starter templates are not executable inventory.

| Record | Included information |
| --- | --- |
| Repository | Name, default branch, resolved commit, archived state, current workflow identities |
| Workflow | Name, path, exact commit, source SHA-256, declared events and selected filters, permissions, jobs, reviewed purpose and responsibilities |
| Job | Name, `needs`, condition, declared permissions, environment name, reusable-workflow reference |
| Reusable call | Caller and job, original reference, resolution type, exact target identity or unresolved status |
| Snapshot | Collection time, schema version, collector repository and full commit, description-data commit and source hash |

Event filters include branches, tags, paths, activity types, workflow names, and schedule expressions. The catalogue omits step commands, action steps, environment variables, secret mappings, and input defaults. It never evaluates workflow expressions or runs consumer code. Matrix expansion and runtime job results are outside this map.

## Read the relationships correctly

A `needs` relationship orders jobs inside one workflow. A job-level `uses` relationship calls a reusable workflow. A step-level action such as `actions/checkout` is not a reusable-workflow edge.

Each workflow identity includes its repository, path, and full commit. A caller pinned to an older implementation therefore points to a separate historical node, even when the same path exists on the default branch. Nested local calls continue at that older commit. Both `./.github/workflows/...` and GitHub.com's `$/` syntax select the caller's commit. A named tag takes precedence over an identically named branch, following [GitHub's reuse rules](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows#calling-a-reusable-workflow).

The collector follows calls only into repositories present in the public organisation inventory. References outside that inventory remain visible as external calls. Missing revisions or files appear as missing calls; malformed references and targets without `workflow_call` appear as invalid calls. Repeated calls share an identity, and call cycles terminate through deduplication.

Artifact transfers, package consumption, release approvals, and human handoffs need their own maintained explanations. The collector does not guess those relationships from shell commands. The repository ownership map is also separate: a repository dependency does not establish a workflow call.

## Maintain reviewed descriptions

The [workflow reference](workflow-reference.md) explains each reviewed workflow's purpose, what it does, and what it produces. These descriptions come from [`workflows/descriptions.json`](https://github.com/unset-sh/tooling/blob/4c46364843ff30b8cb3ff2c78d6d99a9407ad3bc/workflows/descriptions.json) at the exact tooling default-branch commit resolved for the current catalogue. They are reviewed prose, never inferred automatically from commands or job names.

Description data advances independently of the pinned collector code. The snapshot's `collector.commit` identifies the executable helper; `descriptions.commit` identifies the tooling revision supplying the registry, and `descriptions.sha256` identifies its original bytes. The description-data revision always equals the tooling repository's current commit in that same snapshot. Reading new metadata does not run code from that revision.

Each registry record identifies a repository, executable path, full reviewed commit, and SHA-256 of the exact workflow bytes. It supplies one purpose, an ordered list of responsibilities, and a list of results. The collector adds a `documentation` object to every workflow:

| Status | Meaning |
| --- | --- |
| `current` | The collected workflow bytes match a reviewed SHA-256, even if its commit has advanced |
| `review` | A description exists for the path, but the collected bytes have changed; the earlier explanation remains visible and requires review |
| `missing` | No description exists for the path; purpose and reviewed identity are null, and the responsibility and result lists are empty |

Exact byte matches take precedence across reviewed versions. Keep the preferred explanation first for each repository and path, then retain older records needed by pinned callers. A new workflow revision without an exact match uses that first explanation with `review` status. These statuses describe documentation freshness, not workflow run success or operational approval.

When adding or changing a workflow:

1. Read the executable YAML and the helpers it calls at a full reviewed commit. Describe its purpose, main responsibilities, and resulting artifacts or effects in plain language. Do not copy secret values, environment settings, or shell bodies.
2. Compute the SHA-256 of the original executable file bytes at that commit, including any byte-order mark and line endings. For generated workflows, hash the committed `.github/workflows/` file, including its provenance header.
3. Add or update the matching record in `workflows/descriptions.json`. Use the repository's short name and flat executable path, and keep historical records when consumers still select those versions.
4. Run `npm run workflows:describe`, then `npm run check`. Commit the registry and regenerated `docs/workflow-reference.md` together. The freshness check refuses a stale reference.
5. Merge the reviewed registry change to tooling's default branch. The next successful collection adopts it automatically without changing the collector's executable pin, and reports any remaining review or missing states. Export the regenerated human reference through the normal documentation publishing process.

The [`workflow-descriptions.mjs` helper](https://github.com/unset-sh/tooling/blob/4c46364843ff30b8cb3ff2c78d6d99a9407ad3bc/scripts/workflow-descriptions.mjs) validates the registry and generates the reference. The registry accepts at most 1,000 records and 1 MiB. Purpose, responsibility, and result text must be trimmed, nonempty single lines of at most 2,000 characters; each record has 1–20 responsibilities and 1–10 results. Duplicate repository/path/SHA-256 records, extra fields, malformed identities, and linked files are refused. The generator escapes prose as literal Markdown text and only replaces its own generated reference.

The source-byte check watches workflow YAML. A supporting script or remote action can change behaviour without changing that YAML; reviewers must assess those implementation changes too. A matching hash proves which workflow text was reviewed, not that a prose explanation is complete or correct.

For example, changing the documentation site's workflow to select a new collector commit changes that workflow's bytes. Review the resulting committed workflow, then record its exact digest in tooling. That metadata-only change is adopted on the next collection; it does not require another caller pin change. The generated human reference is a reviewed export, while the live map uses the metadata revision shown in its snapshot.

## Collection interface

`scripts/workflow-catalogue.mjs` exports `collectWorkflowCatalogue(options)` and returns a schema-versioned JSON object. It writes no files. The documentation adapter is responsible for validating and replacing its snapshot only after collection succeeds.

| Option | Contract |
| --- | --- |
| `parseYaml` | Required synchronous parser returning plain objects, arrays and scalar values; malformed input must throw |
| `collectorCommit` | Required full 40-character commit identifying the reviewed collector checkout |
| `githubToken` | Optional read-only GitHub token; omitted for unauthenticated requests |
| `fetchImpl` | Optional fetch-compatible function; defaults to Node's `fetch` |
| `now` | Optional clock returning a `Date`; defaults to the current time |

Tooling uses Node 26 and has no package dependencies. The documentation site supplies its existing pinned YAML parser, rejects ambiguous or malformed documents, and bounds alias expansion. Installing another parser in tooling would create a second parsing policy to maintain.

Requests use only `api.github.com`, with REST API version `2026-03-10`. The collector requests public repositories, resolves each default branch once, then reads immutable commit, tree and blob objects. Blob bytes must match their Git identity and declared size. The source SHA-256 preserves a UTF-8 byte-order mark and original line endings. API-provided URLs are never followed, redirects are refused, and errors omit response bodies and parser details. The [API version policy](https://docs.github.com/en/rest/about-the-rest-api/api-versions), [Git tree API](https://docs.github.com/en/rest/git/trees#get-a-tree), and [Git blob API](https://docs.github.com/en/rest/git/blobs#get-a-blob) define this boundary.

The registry is read through the same immutable Git objects at tooling's already resolved default-branch commit. It must be a regular, bounded UTF-8 JSON blob under `workflows/`. A missing or empty public tooling repository, missing registry, invalid schema, source identity mismatch, or API error fails the refresh. Collection never falls back to the collector checkout's local registry. Local reference generation still reads the author's checkout so proposed metadata and generated prose can be reviewed together.

Collection is bounded to 200 repositories, 2,000 workflow versions, 256 jobs per workflow, and 10,000 call edges. Each workflow source is at most 1 MiB; API responses and the completed catalogue are at most 4 MiB. Each request has a 15-second timeout. Exceeding a limit fails collection rather than truncating the map.

## Refresh and recover

The documentation site's production build refreshes the catalogue on its existing main-branch, manual, and hourly publication runs. Local previews and pull-request checks use the committed snapshot without contacting GitHub. The saved timestamp and source commits show what was collected; the hourly schedule is best effort, because [GitHub may delay or drop scheduled runs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

An API failure, truncated tree, source identity mismatch, invalid YAML, or invalid job dependency graph fails the refresh. The publication job must stop, leaving the previously published site available. Do not replace an unavailable repository with an empty workflow list. An empty repository is recorded only when GitHub reports it as empty or supplies no default branch.

When a refresh fails, inspect the failing documentation workflow step, compare the relevant workflow source with its last recorded commit, and correct the source or collector through review. If the public inventory changed during collection, retry against a fresh inventory. For rate limits or service failures, wait for recovery and rerun publication. A successful collection is required before replacing the snapshot; passing offline checks does not prove a live refresh succeeded.

## Change and verify the collector

Change the implementation in `scripts/workflow-catalogue.mjs` and its behavioural tests together. Run `npm run check` with the pinned Node version. Tests cover exact pinned and local calls, annotated tags, pagination, malformed configuration, bounded data, Git identity checks, and credential routing. The injected-parser tests use JSON documents, a valid YAML subset; the documentation repository separately exercises actual YAML syntax with its pinned parser.

Select a reviewed full tooling commit in the documentation site's helper checkout, then validate a live refresh and the normal and publication builds. Consumer workflow pins do not change when the collector changes. The collector remains part of the unreleased tooling implementation at version `0.0.0`.

The checked implementation is [`workflow-catalogue.mjs`](https://github.com/unset-sh/tooling/blob/4c46364843ff30b8cb3ff2c78d6d99a9407ad3bc/scripts/workflow-catalogue.mjs), with [collector tests](https://github.com/unset-sh/tooling/blob/4c46364843ff30b8cb3ff2c78d6d99a9407ad3bc/scripts/workflow-catalogue.test.mjs). For authored workflow locations, read [How workflow sources become GitHub entry points](workflow-layout.md). For delivery of these maintained guides, follow [Export the public documentation](export-docs.md).
