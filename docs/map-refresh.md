---
title: "Refresh every published map"
description: "Register maps once, refresh them in a shared read-only job, and build from one validated snapshot."
weight: 26
type: docs
params:
  doc_kind: guide
  checked_source_revision: "be211937c3a939cca33d0cac251156392cd61a7e"
---

Use `automation-maps-refresh.yml` to refresh all maps before a documentation build. A consumer registers its generators and JSON outputs in one file. The shared job runs every generator and uploads one complete snapshot only after all outputs pass validation. The dependent build downloads that snapshot before checking and rendering the site.

Tooling owns the runner and reusable workflow; the consumer owns its generators, map schemas, triggers, checks, and publication. Alex maintains the tooling implementation described here, which remains unreleased at version `0.0.0`. Adding this workflow does not activate it in consumers: each consumer needs a reviewed caller pinned to a full tooling commit.

## Before you start

Work in the repository that renders the maps. Its reviewed generators must be JavaScript `.mjs` files under `scripts/`, compatible with tooling's pinned Bun 1.4.4. Each generator must validate its source data and map schema, write every declared output, and exit unsuccessfully if collection or validation fails. API collection must use public source data and avoid logging credentials or response bodies.

If a generator needs dependencies, commit the consumer's `package.json` and `bun.lock`. The shared job runs `bun install --frozen-lockfile --ignore-scripts`, and refuses a missing `bun.lock`, before making its temporary token available. Set `install: false` only when the generators need no installation.

Keep source timestamps and revisions in the map's data so readers can distinguish a fresh snapshot from a saved preview. Local and pull-request previews can keep using a committed snapshot without a live collection. This workflow does not update committed files.

## Register all maps

Create `.github/maps.json` in the consumer. The following illustrative registry registers an organisation map and a workflow map; those generator scripts and output schemas belong to the consumer.

```json
{
  "schemaVersion": 1,
  "maps": [
    {
      "id": "organisation",
      "generator": "scripts/update-map.mjs",
      "arguments": [],
      "outputs": [
        "data/org-map/repos.json",
        "data/org-map/source.json"
      ]
    },
    {
      "id": "workflows",
      "generator": "scripts/update-workflow-map.mjs",
      "arguments": [],
      "outputs": ["data/workflow-map/catalogue.json"]
    }
  ]
}
```

Every map needs a unique lowercase kebab-case `id`, a `generator`, an `arguments` array, and a nonempty `outputs` array. Unknown fields are rejected. Arguments reach Bun as literal strings after the script path; the runner does not evaluate a shell command. A generator can use `DOCS_GITHUB_TOKEN` for read-only GitHub API calls. The runner removes that variable from its own environment and passes it explicitly to generator processes.

The runner executes maps in registry order, then rereads and validates every output. Outputs must be regular UTF-8 JSON files under `data/`. The runner rejects symbolic links, hard-linked files, path traversal, hidden paths, reserved filenames, and duplicate or case-colliding output paths. It copies only declared files, preserving their repository-relative paths. Files outside `data/` cannot enter the artifact and replace scripts or repository configuration during download.

| Bound | Limit |
| --- | --- |
| Registry | 64 KiB, 1–100 maps |
| Generator | `.mjs` under `scripts/`, at most 1 MiB, two-minute execution timeout |
| Arguments | At most 32 strings of 2,048 characters each, without control characters |
| Paths | At most 240 ASCII characters, eight segments, 64 characters per segment |
| Declared outputs | 1–50 per map, at most 1,000 total |
| JSON snapshot | 8 MiB per file, 32 MiB total |

These are transport and file constraints. A JSON document can satisfy them while containing incorrect map data. Each generator and the consumer's build checks remain responsible for the semantic schema, provenance, and safe rendering.

## Connect refresh to the build

Add one shared refresh invocation to the consumer's publication workflow. The following excerpt is illustrative: replace `REVIEWED_TOOLING_COMMIT` with a reviewed 40-character tooling commit and retain the consumer's own build steps and action pins. It omits the checkout, Bun setup, dependency installation, and deployment jobs.

```yaml
permissions: {}

jobs:
  maps:
    if: github.ref == 'refs/heads/main'
    permissions:
      contents: read
    uses: unset-sh/tooling/.github/workflows/automation-maps-refresh.yml@REVIEWED_TOOLING_COMMIT

  build:
    needs: maps
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:
      # Keep the consumer's pinned checkout and setup steps before this step.
      - name: Download the complete map snapshot
        uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: ${{ needs.maps.outputs.artifact-name }}
          path: .
      # Run the consumer's map validation and site build after the download.
```

The workflow accepts `registry`, defaulting to `.github/maps.json`, and `install`, defaulting to `true`. Its `artifact-name` output is `maps-<run-id>-<run-attempt>`. Invoke it once per workflow run and put all maps in the registry, so parallel invocations do not compete for the same artifact name. Download from the same run without selecting an unrelated run ID or token. GitHub documents [reusable workflow outputs](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows#using-outputs-from-a-reusable-workflow) and [passing artifacts between jobs](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-what-your-workflow-does/storing-and-sharing-data-from-a-workflow#passing-data-between-jobs-in-a-workflow).

The caller chooses push, manual, and scheduled triggers. Add the schedule to its default-branch workflow; GitHub schedules are best effort and can be delayed or dropped under load. Use a minute away from the start of the hour, following [GitHub's schedule behaviour](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). A new map joins the existing refresh by adding its generator and registry entry, without adding another schedule or shared workflow.

## Follow a successful run

### Keep the docs timer on main

GitHub schedules run only on the default branch. `unset-sh/docs` works directly on `main`, with no staging
branch (org-0010), so its default-branch timer and the approved site workflow both live on `main`. The
timer calls `automation-docs-map-schedule.yml` at a reviewed full tooling commit. The maintained
implementation is `workflows/docs/pages/schedule.yml`; it is specific to the docs repository.

The dispatcher accepts scheduled and manual calls from docs on `main` only. It runs the exact central
helper with `contents: read` and `actions: write`, then requests `unset-sh/docs:site.yml` with `ref: main`.
It has no input for choosing another repository, workflow or branch, runs no consumer code, and cannot
write repository content or deploy Pages. No stored token is needed. This uses GitHub's documented
[workflow-dispatch exception for GITHUB_TOKEN](https://docs.github.com/en/actions/concepts/security/github_token)
and [dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event),
checked on 2026-11-22 against REST version `2026-03-10`.

The requested main run refreshes every registered map, checks and builds the approved site, and uses the
existing Pages deployment gate. The timer changes no repository content. New map generators reach the live
build only after a person merges them into main; collection can still observe current public repository
metadata without committing that data.

The dispatch response supplies the created run's URL. A successful timer means GitHub accepted that run,
not that collection or publication succeeded. Follow the linked site run to verify deployment. If a
request times out or its response cannot be confirmed, inspect existing site runs before retrying because
GitHub may already have created one. Schedules remain best effort; the docs timer also supports manual
dispatch on main. Remove the old schedule from the site workflow when adopting this timer, while
retaining its main push and manual triggers.

For the illustrative registry above, the organisation generator writes two files and the workflow generator writes one. The runner reads all three after both generators finish, checks their paths and JSON bytes, and builds a fresh snapshot under the runner's temporary directory. The upload step publishes only that snapshot and retains it for seven days. The build then overlays those three `data/` files on its own checkout and validates the site before publication.

The source checkout is the caller's exact `github.sha`. Central scripts and the Bun version come from the reusable workflow's own full commit, checked out at `source/.build/tooling`. The workflow refuses an unknown helper repository or non-commit revision before either checkout. Both checkouts disable credential persistence; the job grants only `contents: read`, with no deployment permission, stored secret, or write token.

## Verify and recover

Run the generators' schema tests and the consumer's normal build checks. For a local runner check, use tooling's pinned Bun version, an absolute path to the consumer, and a fresh output directory outside that checkout. This illustrative command assumes the consumer is the current directory and tooling is checked out beside it:

```sh
bun ../tooling/scripts/refresh-maps.mjs --root "$PWD" --out "$(bun -p 'require("node:fs").realpathSync(require("node:os").tmpdir())')/map-refresh-check"
```

The command resolves the temporary directory's real path so aliases do not become symbolic-link ancestors. The final `map-refresh-check` directory must not already exist. A successful run of the three-file example prints `Refreshed 2 maps; staged 3 JSON files.` Check that the output contains only the three registered files, then run the normal build using those files. A generator needing GitHub authentication must receive a read-only `DOCS_GITHUB_TOKEN` through the environment; do not put a credential in the registry or command arguments.

If the workflow-map generator fails after the organisation map succeeds, no artifact is uploaded and the dependent build does not run. A publication job that depends on that build therefore leaves the previous deployed site available. The runner never overwrites an existing artifact directory, even when it contains a previous valid snapshot. This boundary does not undo files a generator wrote in its disposable source checkout.

Generator output is captured rather than printed, because it can contain tokens or API responses. A failure identifies the map ID; reproduce that generator locally without publishing its raw output, inspect its schema tests and source revisions, and fix the cause through review. After a transient API failure, rerun the caller. Do not suppress the failure or upload only the maps that succeeded.

## Source and verification

This guide describes the [shared workflow](https://github.com/unset-sh/tooling/blob/be211937c3a939cca33d0cac251156392cd61a7e/workflows/shared/docs/maps.yml) and [runner](https://github.com/unset-sh/tooling/blob/be211937c3a939cca33d0cac251156392cd61a7e/scripts/refresh-maps.mjs) at the checked revision. [Runner tests](https://github.com/unset-sh/tooling/blob/be211937c3a939cca33d0cac251156392cd61a7e/scripts/refresh-maps.test.mjs) exercise ordered collection, literal arguments, credential redaction, linked files, unsafe paths, incomplete output, and whole-snapshot failure. [Workflow checks](https://github.com/unset-sh/tooling/blob/be211937c3a939cca33d0cac251156392cd61a7e/checks/maps-refresh-workflow.test.mjs) verify the identity guard, read-only permissions, token scope, and artifact contract. Local checks do not establish a successful live consumer run.

For map-specific collection and provenance, read [Maintain the workflow catalogue](workflow-map.md). For source organisation, read [How workflow sources become GitHub entry points](workflow-layout.md). Human documentation remains in the owning repository's `docs/`; agent working notes and artifacts remain in `unset-sh/agent-kit`.
