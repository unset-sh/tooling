---
title: "Workflow reference"
description: "Reviewed purposes, responsibilities, and results of the organisation's workflows."
weight: 26
type: docs
params:
  doc_kind: reference
  generated_from: workflows/descriptions.json
---

These reviewed descriptions explain each workflow's purpose, main responsibilities, and results. The [live workflow map](https://docs.unset.sh/workflows/) compares source bytes with the reviewed version and marks changed or undocumented workflows for review.

The preferred record appears first for each workflow. Additional reviewed versions cover older implementations selected by pinned callers. These summaries describe responsibilities; declared events, job dependencies, permissions, and exact call relationships remain in the live map.

Maintain these descriptions in `workflows/descriptions.json` and run `npm run workflows:describe`. The [catalogue guide](workflow-map.md#maintain-reviewed-descriptions) explains the review process.

## .github

### .github/workflows/branch-policy.yml

Validate staging and main PR origins, and verify actual generated-map staging PRs requested through manual dispatch.

**What it does**

1. Run the shared policy on pull-request creation, updates, reopening, retargeting or readiness changes without branch or path filters.
2. For manual generated-map checks, require the pull-request number and exact expected head/base and pass them to the reviewed central real-PR verifier.
3. Retain the shared ordinary PR rules: feature or fork contributions may target staging, while main promotion must originate from staging in the same repository.

**Produces**

- The policy / Validate branch policy result. Ordinary PR runs can satisfy the required context; workflow\_dispatch results are supplemental. This workflow neither proves human intent nor approves, merges or promotes a PR.

[Reviewed source at aa0f429f9d68](https://github.com/unset-sh/.github/blob/aa0f429f9d6865ac57d5efc5446df4202bd2362c/.github/workflows/branch-policy.yml).

Source SHA-256: `335f8cedd87253ca4a74ca9c3ace6555dce68e27c49290ca53e92d0f054c754a`.

#### Additional reviewed version 1

Check that pull requests target staging and that promotions to main come from the same repository’s staging branch.

**What it does**

1. Run when a pull request opens, updates, reopens, is edited or becomes ready for review, without path or base-branch filters.
2. Call the pinned shared policy to check event metadata, accept staging or main as the target and require a same-repository staging head for main.
3. The shared job reads the event JSON with no checkout, token permissions or API calls; human-only promotion remains a separate operating rule.

**Produces**

- The nested policy / Validate branch policy result for repository branch protection; this workflow does not merge or publish changes.

[Reviewed source at ff0e35a129a5](https://github.com/unset-sh/.github/blob/ff0e35a129a52914cb0e6f0bb15465165032fed5/.github/workflows/branch-policy.yml).

Source SHA-256: `b269afcd8aafa0a054f7b607868f51171acfdb19e6012b0b93ed9e7ff3c93a2e`.

### .github/workflows/docs-export.yml

Check the organisation map and package maintained documentation, including fail-closed supplemental validation for generated-map dispatches.

**What it does**

1. Run on pull requests, staging or main pushes, and manual dispatches. Generated dispatch identities or generated branch refs first activate the central real-PR verifier.
2. Keep the existing check / Check context: run the shared map-regeneration and repository-check command after valid proof or an ordinary event; select only a fixed failing command with dependency installation disabled when generated proof fails.
3. After checks succeed, use the pinned exporter to package the committed docs/site pages and root licence with source revision and hashes.

**Produces**

- The check / Check result and a provenance-bearing docs-\<commit\> artifact retained for 14 days. Dispatch results are supplemental and cannot satisfy PR ruleset checks. This workflow neither writes the docs repository nor deploys the site.

[Reviewed source at aa0f429f9d68](https://github.com/unset-sh/.github/blob/aa0f429f9d6865ac57d5efc5446df4202bd2362c/.github/workflows/docs-export.yml).

Source SHA-256: `36f79b9eddc9e2c6e8a78300f6c0c4945396d361c51944e0fee28277b272d651`.

#### Additional reviewed version 1

Prepare the organisation’s maintained documentation for the central docs site after regenerating and checking the organisation map.

**What it does**

1. On pull requests, pushes to staging or main and manual runs, use shared CI to regenerate MAP.md and the profile map block from repos.json, then run the organisation’s tests and check the generated result.
2. After validation succeeds, export the committed docs/site pages and licence into the github section with source revision and file hashes.
3. Upload the isolated export for a later publishing step; regenerated map views are not committed or included as documentation sources by this workflow.

**Produces**

- A docs-\<commit\> artifact retained for 14 days, containing the github documentation section and provenance; this workflow does not publish to the docs repository.

[Reviewed source at ff0e35a129a5](https://github.com/unset-sh/.github/blob/ff0e35a129a52914cb0e6f0bb15465165032fed5/.github/workflows/docs-export.yml).

Source SHA-256: `0964f49eff7f993f64684dd8dc5ea8a703ec6a3f41f9872a60e464ed373cf3d6`.

#### Additional reviewed version 2

Prepare the organisation’s maintained documentation for the central docs site after regenerating and checking the organisation map.

**What it does**

1. Through the shared CI workflow, regenerate MAP.md and the profile map block from repos.json, then run the organisation’s tests and check the generated result.
2. After validation succeeds, export the committed docs/site pages and licence into the github section with source revision and file hashes.
3. Upload the isolated export for a later publishing step; regenerated map views are not committed or included as documentation sources by this workflow.

**Produces**

- A docs-\<commit\> artifact retained for 14 days, containing the github documentation section and provenance; this workflow does not publish to the docs repository.

[Reviewed source at fb4bfedf463f](https://github.com/unset-sh/.github/blob/fb4bfedf463f7cead362980c49843f774611cce3/.github/workflows/docs-export.yml).

Source SHA-256: `9e7ca1b8b2ff183c2da3d0bc9eab4a39c90b036b94d5813c2b5bb1e0f2a75ad4`.

#### Additional reviewed version 3

Prepare the organisation’s maintained documentation for the central docs site after the organisation checks pass.

**What it does**

1. Run the organisation’s tests and verify that its generated map matches repos.json through the shared CI workflow.
2. Export the committed docs/site pages and licence into the github section with source revision and file hashes.
3. Upload the isolated export for a later publishing step; this workflow does not write to the docs repository.

**Produces**

- A docs-\<commit\> artifact retained for 14 days, containing the github documentation section and provenance.

[Reviewed source at 36665552fe5d](https://github.com/unset-sh/.github/blob/36665552fe5d95005ddfdac1a8276333d479f103/.github/workflows/docs-export.yml).

Source SHA-256: `4993b718777f317c6e6f1b7e58b284068447b667edf4a576fcce6293fd90385d`.

### .github/workflows/map-publish.yml

Prepare and check generated organisation-map staging pull requests while preserving normal review and human promotion to main.

**What it does**

1. Run on relevant staging pushes, an hourly schedule or manual staging dispatch, serialising publication runs.
2. Call the reviewed tooling publisher with contents, pull-request and Actions write permissions at the caller boundary; the reusable implementation separates read-only generation, output-only publication and exact-head check dispatch.

**Produces**

- A generated-only staging PR and links to three supplemental validation runs when views change. Ordinary PR checks require human approval with GITHUB\_TOKEN; dispatched jobs do not satisfy PR ruleset checks. The workflow does not merge or promote main.

[Reviewed source at aa0f429f9d68](https://github.com/unset-sh/.github/blob/aa0f429f9d6865ac57d5efc5446df4202bd2362c/.github/workflows/map-publish.yml).

Source SHA-256: `2ef756167ac23630c44bb07893e539f04409fa8cf61f00c27c9fe27071b9c8a5`.

#### Additional reviewed version 1

Keep the committed organisation map and profile map block current after their source changes, using the reviewed shared publisher.

**What it does**

1. Run for relevant main-branch changes, on the hourly schedule and on demand; serialize publication runs without cancelling an active run.
2. Call the shared organisation-map publisher at a full reviewed commit, which regenerates and checks the registered outputs with read-only permissions.
3. Use its separate publisher to validate the same-run snapshot and preserve authored profile text, then prepare a generated-only pull request and request its exact-head squash merge.
4. Respect GitHub merge restrictions and stop on observed main movement; a successful current-main run recovers a view made stale by a concurrent base change.

**Produces**

- The shared publisher’s seven-day org-map-\<run-id\>-\<run-attempt\> artifact.
- Updated MAP.md and the generated profile/README.md block when output changed and GitHub permits the merge, or a prepared PR when the merge is refused; unchanged output creates no PR.

[Reviewed source at fb4bfedf463f](https://github.com/unset-sh/.github/blob/fb4bfedf463f7cead362980c49843f774611cce3/.github/workflows/map-publish.yml).

Source SHA-256: `bacf711d7076bd48ac08aa497df14d3fa86f3e6a101aaacba16c0807d8620064`.

### .github/workflows/org-map.yml

Validate the curated organisation map and report differences from public GitHub metadata, with a separate verified path for supplemental generated-map validation.

**What it does**

1. On ordinary pull requests and pushes, regenerate the map from repos.json and run the repository checks with read-only contents permission.
2. For generated manual dispatches, first verify the actual bot-owned staging PR and exact head/base through the central branch-policy workflow; fail the map validation job before checkout when proof fails.
3. For a verified generated dispatch, require regeneration to leave MAP.md and profile/README.md unchanged, proving the committed outputs are current.
4. On the daily schedule or an ordinary manual run, compare public repository metadata and maintain the org-map-drift issue. Generated dispatches cannot enter this writable drift job.

**Produces**

- The Check the organisation map result and regenerated workspace views; only eligible-event results can satisfy PR ruleset checks, while workflow\_dispatch results are supplemental. The job does not commit the views.
- A drift issue created, updated or closed according to the public metadata comparison.

[Reviewed source at aa0f429f9d68](https://github.com/unset-sh/.github/blob/aa0f429f9d6865ac57d5efc5446df4202bd2362c/.github/workflows/org-map.yml).

Source SHA-256: `bfbe97ab008b6e02472c44ddf3e5e427b7bf3056907d5b77bbf568e7975a0f41`.

#### Additional reviewed version 1

Validate the organisation map regenerated from its curated source and report differences between that source and public GitHub repositories.

**What it does**

1. On pull requests and pushes to staging or main, regenerate the map and profile from repos.json, then run tests and check the generated result without committing it.
2. On daily scheduled or manual runs, compare public repository names, descriptions, archive status and licences with the curated map; private entries are skipped.
3. Create or update one org-map-drift issue when differences appear, and close it when the comparison matches.
4. Leave ownership descriptions and source metadata to a reviewed source change; the drift job does not rewrite repos.json, while the separate publisher updates derived Markdown views.

**Produces**

- Validation results for the regenerated organisation map.
- An automatically maintained drift issue when public repository metadata differs.

[Reviewed source at ff0e35a129a5](https://github.com/unset-sh/.github/blob/ff0e35a129a52914cb0e6f0bb15465165032fed5/.github/workflows/org-map.yml).

Source SHA-256: `08ad77151af55bb31ae002471582d0b37776eb16b13e0928583d3d1b69583af7`.

#### Additional reviewed version 2

Validate the organisation map regenerated from its curated source and report differences between that source and public GitHub repositories.

**What it does**

1. On pull requests and main changes, regenerate the map and profile from repos.json, then run tests and check the generated result without committing it.
2. On daily scheduled or manual runs, compare public repository names, descriptions, archive status and licences with the curated map; private entries are skipped.
3. Create or update one org-map-drift issue when differences appear, and close it when the comparison matches.
4. Leave ownership descriptions and source metadata to a reviewed source change; the drift job does not rewrite repos.json, while the separate publisher updates derived Markdown views.

**Produces**

- Validation results for the regenerated organisation map.
- An automatically maintained drift issue when public repository metadata differs.

[Reviewed source at fb4bfedf463f](https://github.com/unset-sh/.github/blob/fb4bfedf463f7cead362980c49843f774611cce3/.github/workflows/org-map.yml).

Source SHA-256: `f9f81fc280358996016ae43859e05b5288336e6701085e57b58660904d4f6e1f`.

#### Additional reviewed version 3

Keep the curated organisation map consistent with its source and report differences between the map and public GitHub repositories.

**What it does**

1. On pull requests and main changes, run tests and check that the generated map and profile match repos.json.
2. On scheduled or manual runs, compare public repository names, descriptions, archive status and licences with the curated map; private entries are skipped.
3. Create or update one org-map-drift issue when differences appear, and close it when the comparison matches.
4. Leave ownership descriptions and map edits for a reviewed source change; the drift job does not rewrite repos.json.

**Produces**

- Validation results for the generated organisation map.
- An automatically maintained drift issue when public repository metadata differs.

[Reviewed source at 36665552fe5d](https://github.com/unset-sh/.github/blob/36665552fe5d95005ddfdac1a8276333d479f103/.github/workflows/org-map.yml).

Source SHA-256: `79f6770aad742dbbc4d2089cd3614f04f056d5ef4ceb12494fc7860e05b55696`.

## agent-kit

### .github/workflows/branch-policy.yml

Check that pull requests target staging and that promotions to main come from the same repository’s staging branch.

**What it does**

1. Run when a pull request opens, updates, reopens, is edited or becomes ready for review, without path or base-branch filters.
2. Call the pinned shared policy to check event metadata, accept staging or main as the target and require a same-repository staging head for main.
3. The shared job reads the event JSON with no checkout, token permissions or API calls; human-only promotion remains a separate operating rule.

**Produces**

- The nested policy / Validate branch policy result for repository branch protection; this workflow does not merge or publish changes.

[Reviewed source at 08c51e50526a](https://github.com/unset-sh/agent-kit/blob/08c51e50526aed44f84f6284a72dd8a8df173f3d/.github/workflows/branch-policy.yml).

Source SHA-256: `56fa8d0acc712a2e16ce28cfc651aafd08dca129c7facd38824099dbd22a1dd0`.

### .github/workflows/ci.yml

Check that the shared agent rules, skills and synchronisation tools can be distributed as a consistent bundle.

**What it does**

1. Run for pull requests targeting staging or main and for pushes to either branch.
2. Run the repository’s checks against the kit and its synchronisation behaviour.
3. Collect the shipped rules, skills, agents and sync.mjs into a deterministically ordered bundle.
4. Record the source commit, kit version and each shipped file’s SHA-256 in the bundle.

**Produces**

- A locally built dist/agent-kit.json and its checksum in the job log; CI does not upload or publish the bundle.

[Reviewed source at 08c51e50526a](https://github.com/unset-sh/agent-kit/blob/08c51e50526aed44f84f6284a72dd8a8df173f3d/.github/workflows/ci.yml).

Source SHA-256: `f1a9eb9d233f406b0eaea388e62d064b7d7f762e41df799db0856903999d278d`.

#### Additional reviewed version 1

Check that the shared agent rules, skills and synchronisation tools can be distributed as a consistent bundle.

**What it does**

1. Run the repository’s checks against the kit and its synchronisation behaviour.
2. Collect the shipped rules, skills, agents and sync.mjs into a deterministically ordered bundle.
3. Record the source commit, kit version and each shipped file’s SHA-256 in the bundle.

**Produces**

- A locally built dist/agent-kit.json and its checksum in the job log; CI does not upload or publish the bundle.

[Reviewed source at 5792624b2215](https://github.com/unset-sh/agent-kit/blob/5792624b2215f3d9d59ae6798b3d1df389af5b1a/.github/workflows/ci.yml).

Source SHA-256: `dd1651202aa972c3582463908e9a5defb834d5b7eccb682d35d6aa8bdd22659e`.

### .github/workflows/release.yml

Publish a tagged version of the agent kit so repositories can adopt a specific, verifiable bundle.

**What it does**

1. Require the tag to match package.json and its commit to be reachable from main.
2. Run the kit checks, build agent-kit.json, copy sync.mjs and extract the version’s release notes.
3. Pass those files through the release artifact to the publishing job, which uses the release environment.
4. Verify the artifact’s file set, attest the bundle and synchronisation script, and create the GitHub release from the existing tag.

**Produces**

- A GitHub release containing agent-kit.json and sync.mjs, with release notes.
- Attestations for the two downloadable files and a seven-day intermediate release artifact.

[Reviewed source at 5792624b2215](https://github.com/unset-sh/agent-kit/blob/5792624b2215f3d9d59ae6798b3d1df389af5b1a/.github/workflows/release.yml).

Source SHA-256: `451f57474f61c783f79cffff4ae19e0517c6dc953cb8b20bd0e441913542b074`.

## backend

### .github/workflows/branch-policy.yml

Check that pull requests target staging and that promotions to main come from the same repository’s staging branch.

**What it does**

1. Run when a pull request opens, updates, reopens, is edited or becomes ready for review, without path or base-branch filters.
2. Call the pinned shared policy to check event metadata, accept staging or main as the target and require a same-repository staging head for main.
3. The shared job reads the event JSON with no checkout, token permissions or API calls; human-only promotion remains a separate operating rule.

**Produces**

- The nested policy / Validate branch policy result for repository branch protection; this workflow does not merge or publish changes.

[Reviewed source at 19ea29a840bb](https://github.com/unset-sh/backend/blob/19ea29a840bb38cec37a5aa4626c5b6353eb43a9/.github/workflows/branch-policy.yml).

Source SHA-256: `e2c2752b510a0cf77a10670ff3a0efb901c3ea0a824f286a089741cab4445ba9`.

## brand

### .github/workflows/branch-policy.yml

Check that pull requests target staging and that promotions to main come from the same repository’s staging branch.

**What it does**

1. Run when a pull request opens, updates, reopens, is edited or becomes ready for review, without path or base-branch filters.
2. Call the pinned shared policy to check event metadata, accept staging or main as the target and require a same-repository staging head for main.
3. The shared job reads the event JSON with no checkout, token permissions or API calls; human-only promotion remains a separate operating rule.

**Produces**

- The nested policy / Validate branch policy result for repository branch protection; this workflow does not merge or publish changes.

[Reviewed source at a29c94293613](https://github.com/unset-sh/brand/blob/a29c94293613e119faf5cdd0eab0a6e18664b618/.github/workflows/branch-policy.yml).

Source SHA-256: `b269afcd8aafa0a054f7b607868f51171acfdb19e6012b0b93ed9e7ff3c93a2e`.

### .github/workflows/ci.yml

Check the brand contract and package, then verify that the brand site builds at both a domain root and a repository subpath.

**What it does**

1. Run on pull requests, including edits and ready-for-review events, and on pushes to staging or main.
2. Install the pinned dependencies and check that generated brand assets and syntax examples are current.
3. Run the brand and component-gallery tests.
4. Install the verified Hugo binary and build the site once at the root and once under /brand.

**Produces**

- Validation results for the brand package and two local site builds; this workflow does not publish them.

[Reviewed source at a29c94293613](https://github.com/unset-sh/brand/blob/a29c94293613e119faf5cdd0eab0a6e18664b618/.github/workflows/ci.yml).

Source SHA-256: `762b08d9112ee7cc295416df67f73718e5de66cfec07bcc1b59cfbcbd45d22e3`.

#### Additional reviewed version 1

Check the brand contract and package, then verify that the brand site builds at both a domain root and a repository subpath.

**What it does**

1. Install the pinned dependencies and check that generated brand assets and syntax examples are current.
2. Run the brand and component-gallery tests.
3. Install the verified Hugo binary and build the site once at the root and once under /brand.

**Produces**

- Validation results for the brand package and two local site builds; this workflow does not publish them.

[Reviewed source at 8c998a2990ae](https://github.com/unset-sh/brand/blob/8c998a2990ae477daf5ac1636028f6cbf379577b/.github/workflows/ci.yml).

Source SHA-256: `f8febc7f786e6bee4c0850977afd35432eaf2beb0c2ae1015ad86fa8b7c99f40`.

### .github/workflows/pages.yml

Build and publish the brand guidelines and component gallery on GitHub Pages.

**What it does**

1. Check out main, install the pinned dependencies and verified Hugo version, and run the brand checks.
2. Build the site using the base path and URL supplied by GitHub Pages.
3. Upload site/public as a Pages artifact.
4. Deploy that artifact in a separate job using the github-pages environment.

**Produces**

- The generated brand site as a Pages artifact and, after deployment succeeds, its published Pages URL.

[Reviewed source at 8c998a2990ae](https://github.com/unset-sh/brand/blob/8c998a2990ae477daf5ac1636028f6cbf379577b/.github/workflows/pages.yml).

Source SHA-256: `bc0d90376304b83e47a71c2e2464cd52d4808d3ee8037db7de36d35394c36c20`.

### .github/workflows/release.yml

Publish a checked, tagged brand package to GitHub Packages.

**What it does**

1. Require the tag to match package.json and the tagged commit to be reachable from main.
2. Install dependencies, run the brand checks and pack the package once without package lifecycle scripts.
3. Record its SHA-256 and retain the package artifact for the publishing job.
4. In the release environment, require exactly one package archive, attest it and publish that same archive to GitHub Packages.

**Produces**

- The @unset-sh/brand package and its artifact attestation.
- A seven-day package artifact and checksum summary; this workflow does not create a GitHub release page.

[Reviewed source at 8c998a2990ae](https://github.com/unset-sh/brand/blob/8c998a2990ae477daf5ac1636028f6cbf379577b/.github/workflows/release.yml).

Source SHA-256: `24afea339d625c6878c652a1139b28f5c8ba2d21eea1fe541a1be86c9c5c539f`.

## deployment

### .github/workflows/branch-policy.yml

Check that pull requests target staging and that promotions to main come from the same repository’s staging branch.

**What it does**

1. Run when a pull request opens, updates, reopens, is edited or becomes ready for review, without path or base-branch filters.
2. Call the pinned shared policy to check event metadata, accept staging or main as the target and require a same-repository staging head for main.
3. The shared job reads the event JSON with no checkout, token permissions or API calls; human-only promotion remains a separate operating rule.

**Produces**

- The nested policy / Validate branch policy result for repository branch protection; this workflow does not merge or publish changes.

[Reviewed source at 979b2bfb8895](https://github.com/unset-sh/deployment/blob/979b2bfb88953f1449fbfdc69ba8b4bb1f81c462/.github/workflows/branch-policy.yml).

Source SHA-256: `e2c2752b510a0cf77a10670ff3a0efb901c3ea0a824f286a089741cab4445ba9`.

## docs

### .github/workflows/branch-policy.yml

Apply the shared development and promotion branch policy to ordinary PRs and exact generated documentation import checks.

**What it does**

1. Run on PR opening, synchronization, reopening, metadata edits and readiness changes without branch or path filters.
2. Forward the three fixed generated-PR identity inputs on workflow dispatch to the pinned central branch-policy workflow.
3. Preserve the shared policy job’s name and permission-free validation; generated dispatches must prove the actual bot PR, current head/base and owned changes but remain supplemental.

**Produces**

- The stable policy / Validate branch policy result. Ordinary PR runs can satisfy the required context; generated workflow\_dispatch results cannot.

[Reviewed source at 9dc1178224bc](https://github.com/unset-sh/docs/blob/9dc1178224bc2f09fc7ac0aabf59a6620d864dbc/.github/workflows/branch-policy.yml).

Source SHA-256: `7dfa1a629a2ce51acaa8bb62d1c75dd6513df38bf71018d477a5402b87e8055b`.

#### Additional reviewed version 1

Check that pull requests target staging and that promotions to main come from the same repository’s staging branch.

**What it does**

1. Run when a pull request opens, updates, reopens, is edited or becomes ready for review, without path or base-branch filters.
2. Call the pinned shared policy to check event metadata, accept staging or main as the target and require a same-repository staging head for main.
3. The shared job reads the event JSON with no checkout, token permissions or API calls; human-only promotion remains a separate operating rule.

**Produces**

- The nested policy / Validate branch policy result for repository branch protection; this workflow does not merge or publish changes.

[Reviewed source at 1231232ba9f2](https://github.com/unset-sh/docs/blob/1231232ba9f2e6717908f706c4887fd7209f22a4/.github/workflows/branch-policy.yml).

Source SHA-256: `b269afcd8aafa0a054f7b607868f51171acfdb19e6012b0b93ed9e7ff3c93a2e`.

### .github/workflows/ci.yml

Validate the documentation framework and source pages on ordinary changes, and provide supplemental validation for verified generated import dispatches.

**What it does**

1. Run for relevant PR updates and pushes to staging or main; accept generated-import dispatches only with the fixed PR, expected head and expected base inputs.
2. For every dispatch, load a pinned central verifier and validate the actual bot PR, source provenance, current head/base and complete section-only proof before checking out consumer code.
3. Install the locked tooling without lifecycle scripts, run tests and workflow/map guards, check ordinary PR documentation impact, lint workflows, and build both real content and preview fixtures.

**Produces**

- The Validate documentation result and checked ordinary and preview site output. Eligible PR/push results can satisfy the required context; workflow\_dispatch results cannot. Malformed dispatch proof fails before consumer execution.

[Reviewed source at 9dc1178224bc](https://github.com/unset-sh/docs/blob/9dc1178224bc2f09fc7ac0aabf59a6620d864dbc/.github/workflows/ci.yml).

Source SHA-256: `75a1f53c1e4686c59eaf9df3f225819db23859d8651b4c76abbd57e397521ade`.

#### Additional reviewed version 1

Check documentation sources, publication safeguards and rendered pages before changes reach the documentation site.

**What it does**

1. Run on pull requests, including edits and ready-for-review events, and on pushes to staging or main.
2. Install the pinned tooling without lifecycle scripts and run the Node and Python checks, workflow guards and organisation-map integrity check.
3. For pull requests, check whether the changes have the required documentation impact.
4. Lint the workflow files with the pinned actionlint image.
5. Build the real documentation and a separate fixture preview, checking generated HTML, assets, links and navigation.

**Produces**

- Validation results and local builds of the real site and documentation fixtures; CI does not deploy them.

[Reviewed source at 1231232ba9f2](https://github.com/unset-sh/docs/blob/1231232ba9f2e6717908f706c4887fd7209f22a4/.github/workflows/ci.yml).

Source SHA-256: `bb4d65f74b734c3d1c1e966b77c1b478d583f39071aa87aa81c8b1b541a409dd`.

#### Additional reviewed version 2

Check documentation sources, publication safeguards and rendered pages before changes reach the documentation site.

**What it does**

1. Install the pinned tooling without lifecycle scripts and run the Node and Python checks, workflow guards and organisation-map integrity check.
2. For pull requests, check whether the changes have the required documentation impact.
3. Lint the workflow files with the pinned actionlint image.
4. Build the real documentation and a separate fixture preview, checking generated HTML, assets, links and navigation.

**Produces**

- Validation results and local builds of the real site and documentation fixtures; CI does not deploy them.

[Reviewed source at 02bfc33cbe6a](https://github.com/unset-sh/docs/blob/02bfc33cbe6a44f7f57f3e06dfc4012739899265/.github/workflows/ci.yml).

Source SHA-256: `4867727cb325e12ae20ec3ce21e5cd8a2f8bbb68fdfb3fb944e0375bdfdc9776`.

### .github/workflows/docs-import.yml

Keep the tooling and organisation documentation sections current through reviewed staging pull requests from exact stable source exports.

**What it does**

1. Run hourly and on demand only on the default staging branch, serialize runs without cancelling active work, and process the fixed tooling and github source keys independently.
2. Call the reviewed central documentation receiver at a full commit pin, with separate preparation, content-publication and Actions-dispatch permission scopes.
3. Leave ordinary PR run approval, required-check completion, merging and production promotion to the normal human review process.

**Produces**

- Bounded same-run import artifacts, generated staging PRs when content changes, and verified URLs for supplemental documentation and branch-policy runs. Ordinary PR checks require human approval with GITHUB\_TOKEN; dispatched jobs do not satisfy PR ruleset checks.

[Reviewed source at 9dc1178224bc](https://github.com/unset-sh/docs/blob/9dc1178224bc2f09fc7ac0aabf59a6620d864dbc/.github/workflows/docs-import.yml).

Source SHA-256: `7b8ce28ca3c3a007c97db4f38dd6564f8dcad9824944305ed32e832409aff5e1`.

### .github/workflows/site-refresh.yml

Refresh the published documentation maps hourly while staging remains the default branch and main remains the production source.

**What it does**

1. Run at minute 23 each hour or by manual dispatch on staging, with serial timer runs.
2. Call the reviewed tooling dispatcher with contents-read and Actions-write permissions to request only the existing main site workflow.

**Produces**

- A main site workflow run requested by the central dispatcher. The timer neither promotes staging content nor establishes that deployment succeeded.

[Reviewed source at f769d9e88ead](https://github.com/unset-sh/docs/blob/f769d9e88ead3b02afb5bd8dba174fb6562174e7/.github/workflows/site-refresh.yml).

Source SHA-256: `441b4836f74a8d28172511075231e4dc91d8f3b3286c4f11039d8adb22fc52c4`.

### .github/workflows/site.yml

Refresh supported upstream content and registered maps, build the organisation documentation site and publish it on GitHub Pages.

**What it does**

1. On main pushes or manual main runs, call the shared map workflow to refresh every registered map and return one validated snapshot; the separate default-branch timer requests hourly runs.
2. After the map refresh succeeds, resolve the latest compatible published brand release, install the pinned tooling without lifecycle scripts and download this run's validated map snapshot.
3. Run the source and publication guards, build the publication site with Hugo and check its rendered pages, navigation and workflow map.
4. Upload the public directory as a Pages artifact, then deploy it through the github-pages environment; only the deployment job receives Pages publication permissions.

**Produces**

- A validated map artifact for this run and a checked Pages artifact, followed by the published documentation site when deployment succeeds.
- Brand, organisation-map and workflow-map updates used by this build; the workflow does not commit these updates back to the repository.

[Reviewed source at f769d9e88ead](https://github.com/unset-sh/docs/blob/f769d9e88ead3b02afb5bd8dba174fb6562174e7/.github/workflows/site.yml).

Source SHA-256: `c8310eb5caef3343cdd08ca3d31bd325bf22322b0d6b193c4e532aff2ee2255e`.

#### Additional reviewed version 1

Refresh supported upstream content and registered maps, build the organisation documentation site and publish it on GitHub Pages.

**What it does**

1. On main-branch pushes, manual runs and the hourly schedule, call the pinned shared refresh workflow to generate and validate the registered organisation and workflow maps.
2. After the map refresh succeeds, resolve the latest compatible published brand release, install the pinned tooling without lifecycle scripts and download this run's validated map snapshot.
3. Run the source and publication guards, build the publication site with Hugo and check its rendered pages, navigation and workflow map.
4. Upload the public directory as a Pages artifact, then deploy it through the github-pages environment; only the deployment job receives Pages publication permissions.

**Produces**

- A validated map artifact for this run and a checked Pages artifact, followed by the published documentation site when deployment succeeds.
- Brand, organisation-map and workflow-map updates used by this build; the workflow does not commit these updates back to the repository.

[Reviewed source at af4cd59a83d7](https://github.com/unset-sh/docs/blob/af4cd59a83d70c8b505727d0a7b01c21786fb09c/.github/workflows/site.yml).

Source SHA-256: `5ca763e39e9c3201789eb62c827178a57458ad7475fafbd6fa11db20a8a2b781`.

#### Additional reviewed version 2

Refresh supported upstream content, build the organisation documentation site and publish it on GitHub Pages.

**What it does**

1. Resolve the latest compatible published brand release and refresh the organisation map from a fixed source revision.
2. Install the pinned tooling and run the source and publication guards.
3. Build the publication site with Hugo and verify the rendered output and required section landing pages.
4. Upload the public directory as a Pages artifact, then deploy it through the github-pages environment.

**Produces**

- A checked Pages artifact and, after deployment succeeds, the published documentation site.
- Brand and organisation-map updates used by this build; the workflow does not commit these updates back to the repository.

[Reviewed source at 02bfc33cbe6a](https://github.com/unset-sh/docs/blob/02bfc33cbe6a44f7f57f3e06dfc4012739899265/.github/workflows/site.yml).

Source SHA-256: `ce4a2ed1080f35985efed001cf67ce45bcc1ff864e53e52684d696106f63d612`.

## lexicons

### .github/workflows/branch-policy.yml

Check that pull requests target staging and that promotions to main come from the same repository’s staging branch.

**What it does**

1. Run when a pull request opens, updates, reopens, is edited or becomes ready for review, without path or base-branch filters.
2. Call the pinned shared policy to check event metadata, accept staging or main as the target and require a same-repository staging head for main.
3. The shared job reads the event JSON with no checkout, token permissions or API calls; human-only promotion remains a separate operating rule.

**Produces**

- The nested policy / Validate branch policy result for repository branch protection; this workflow does not merge or publish changes.

[Reviewed source at 27e6e5b573d4](https://github.com/unset-sh/lexicons/blob/27e6e5b573d49c8bc01171c6cf6d275382a5f07e/.github/workflows/branch-policy.yml).

Source SHA-256: `56fa8d0acc712a2e16ce28cfc651aafd08dca129c7facd38824099dbd22a1dd0`.

### .github/workflows/check.yml

Validate the AT Protocol lexicon schemas, examples and reference documentation together.

**What it does**

1. Run for pull requests targeting staging or main and for pushes to either branch.
2. Typecheck and lint the validation tooling, then run its tests.
3. Parse the schemas with the official AT Protocol libraries and build validators to resolve their references.
4. Validate authored examples and their coverage, and check generated reference documentation, local links and schema provenance hashes.

**Produces**

- A check result reporting schema, example, documentation, link or provenance problems; no release or documentation export is published.

[Reviewed source at 27e6e5b573d4](https://github.com/unset-sh/lexicons/blob/27e6e5b573d49c8bc01171c6cf6d275382a5f07e/.github/workflows/check.yml).

Source SHA-256: `3cafa0c4df5ca6b9db7a871884f7191db63045803fc3f900895bb439f91b3d22`.

#### Additional reviewed version 1

Validate the AT Protocol lexicon schemas, examples and reference documentation together.

**What it does**

1. Typecheck and lint the validation tooling, then run its tests.
2. Parse the schemas with the official AT Protocol libraries and build validators to resolve their references.
3. Validate authored examples and their coverage, and check generated reference documentation, local links and schema provenance hashes.

**Produces**

- A check result reporting schema, example, documentation, link or provenance problems; no release or documentation export is published.

[Reviewed source at 52cfb6990f38](https://github.com/unset-sh/lexicons/blob/52cfb6990f3833e4bdd260cd5bb520fc4446e122/.github/workflows/check.yml).

Source SHA-256: `9607e1b447520e271c49e21095ab76b8e9570270bcf92798b9da24aa7c8dab23`.

## pds

### .github/workflows/branch-policy.yml

Check that pull requests target staging and that promotions to main come from the same repository’s staging branch.

**What it does**

1. Run when a pull request opens, updates, reopens, is edited or becomes ready for review, without path or base-branch filters.
2. Call the pinned shared policy to check event metadata, accept staging or main as the target and require a same-repository staging head for main.
3. The shared job reads the event JSON with no checkout, token permissions or API calls; human-only promotion remains a separate operating rule.

**Produces**

- The nested policy / Validate branch policy result for repository branch protection; this workflow does not merge or publish changes.

[Reviewed source at 1ff1df8bdd9d](https://github.com/unset-sh/pds/blob/1ff1df8bdd9dfc5bf1260053df0e6f46d97b38cc/.github/workflows/branch-policy.yml).

Source SHA-256: `e2c2752b510a0cf77a10670ff3a0efb901c3ea0a824f286a089741cab4445ba9`.

## profile-recipes

### .github/workflows/branch-policy.yml

Check that pull requests target staging and that promotions to main come from the same repository’s staging branch.

**What it does**

1. Run when a pull request opens, updates, reopens, is edited or becomes ready for review, without path or base-branch filters.
2. Call the pinned shared policy to check event metadata, accept staging or main as the target and require a same-repository staging head for main.
3. The shared job reads the event JSON with no checkout, token permissions or API calls; human-only promotion remains a separate operating rule.

**Produces**

- The nested policy / Validate branch policy result for repository branch protection; this workflow does not merge or publish changes.

[Reviewed source at a6eadbb3e570](https://github.com/unset-sh/profile-recipes/blob/a6eadbb3e570e59b06cde65b0c9181c300b4cc39/.github/workflows/branch-policy.yml).

Source SHA-256: `b269afcd8aafa0a054f7b607868f51171acfdb19e6012b0b93ed9e7ff3c93a2e`.

### .github/workflows/dco.yml

Check that eligible pull-request commits carry a Developer Certificate of Origin sign-off.

**What it does**

1. Run when a pull request opens, updates, reopens, is edited or becomes ready for review.
2. Read the pull request’s base and head commits from the full checkout history.
3. Exempt the owner’s and bot-authored pull requests, and ignore merge commits.
4. Report each remaining commit that lacks a correctly formed Signed-off-by line.

**Produces**

- The DCO check result for the pull request.

[Reviewed source at a6eadbb3e570](https://github.com/unset-sh/profile-recipes/blob/a6eadbb3e570e59b06cde65b0c9181c300b4cc39/.github/workflows/dco.yml).

Source SHA-256: `ea93c82d7aa1f38b38f399a7976206b476b7a6d00f31a9dcdcc41e9db7f5e0c1`.

#### Additional reviewed version 1

Check that eligible pull-request commits carry a Developer Certificate of Origin sign-off.

**What it does**

1. Read the pull request’s base and head commits from the full checkout history.
2. Exempt the owner’s and bot-authored pull requests, and ignore merge commits.
3. Report each remaining commit that lacks a correctly formed Signed-off-by line.

**Produces**

- The DCO check result for the pull request.

[Reviewed source at 1e64c469f86d](https://github.com/unset-sh/profile-recipes/blob/1e64c469f86dd2ad6e9b26200d26e308d6d06f4e/.github/workflows/dco.yml).

Source SHA-256: `5ff26342bceb3b681b416fea6d98dc4b8ae14d61cc5adf961e270c0411223194`.

### .github/workflows/docs-mirror.yml

Publish the checked profile-recipe documentation into its owned section of the central docs repository.

**What it does**

1. Check out the current main branch, run typechecking, tests and recipe validation, and render the recipe catalogue.
2. Prepare an isolated profile-recipes export containing the guides, licences, example image and source hashes.
3. Require the configured publishing key and check out unset-sh/docs main.
4. Replace only profile-recipes/, verify that outgoing paths and files match the export, and commit and push changes without rewriting history; unchanged exports do not create a commit.

**Produces**

- An updated profile-recipes section in unset-sh/docs when publishing credentials are configured and the push succeeds.
- A source.json manifest identifying the recipe revision and exported file hashes.

[Reviewed source at 1e64c469f86d](https://github.com/unset-sh/profile-recipes/blob/1e64c469f86dd2ad6e9b26200d26e308d6d06f4e/.github/workflows/docs-mirror.yml).

Source SHA-256: `7830330dad74711b71af9d6af16fbfbb52d58192511d200dcaff1221541dee02`.

### .github/workflows/validate.yml

Check that profile recipes satisfy their schemas and can produce the showcase and documentation export.

**What it does**

1. Run on pull requests, including edits and ready-for-review events, and on pushes to staging or main.
2. Typecheck the tooling, run its tests and validate every recipe against the vendored upstream schemas.
3. Render the recipe showcase pages.
4. Prepare an isolated documentation export and check its source provenance without publishing it.

**Produces**

- Recipe-validation results, locally rendered showcase pages and a temporary documentation export.

[Reviewed source at a6eadbb3e570](https://github.com/unset-sh/profile-recipes/blob/a6eadbb3e570e59b06cde65b0c9181c300b4cc39/.github/workflows/validate.yml).

Source SHA-256: `9c154b37b606968c1d2254d69be1fe01fd744b5891d7a733974e140350e7f8c1`.

#### Additional reviewed version 1

Check that profile recipes satisfy their schemas and can produce the showcase and documentation export.

**What it does**

1. Typecheck the tooling, run its tests and validate every recipe against the vendored upstream schemas.
2. Render the recipe showcase pages.
3. Prepare an isolated documentation export and check its source provenance without publishing it.

**Produces**

- Recipe-validation results, locally rendered showcase pages and a temporary documentation export.

[Reviewed source at 1e64c469f86d](https://github.com/unset-sh/profile-recipes/blob/1e64c469f86dd2ad6e9b26200d26e308d6d06f4e/.github/workflows/validate.yml).

Source SHA-256: `91332579914d7c30380e42b16ead0076b874b5b2377c5e36fd079fb964a52e74`.

## rendering

### .github/workflows/branch-policy.yml

Check that pull requests target staging and that promotions to main come from the same repository’s staging branch.

**What it does**

1. Run when a pull request opens, updates, reopens, is edited or becomes ready for review, without path or base-branch filters.
2. Call the pinned shared policy to check event metadata, accept staging or main as the target and require a same-repository staging head for main.
3. The shared job reads the event JSON with no checkout, token permissions or API calls; human-only promotion remains a separate operating rule.

**Produces**

- The nested policy / Validate branch policy result for repository branch protection; this workflow does not merge or publish changes.

[Reviewed source at d47afdae9dcd](https://github.com/unset-sh/rendering/blob/d47afdae9dcd542dc2f343ba8254b85b650ae828/.github/workflows/branch-policy.yml).

Source SHA-256: `56fa8d0acc712a2e16ce28cfc651aafd08dca129c7facd38824099dbd22a1dd0`.

### .github/workflows/ci.yml

Check the image-rendering package and keep a visual gallery for reviewing its output.

**What it does**

1. Run for pull requests targeting staging or main and for pushes to either branch.
2. Install dependencies, then typecheck, lint, build the package and run its tests.
3. Attempt to draw the gallery even when an earlier check fails.
4. Upload any generated gallery output so reviewers can inspect the rendered images.

**Produces**

- A gallery artifact retained for 14 days when gallery files are available.
- Validation results and a local package build.

[Reviewed source at d47afdae9dcd](https://github.com/unset-sh/rendering/blob/d47afdae9dcd542dc2f343ba8254b85b650ae828/.github/workflows/ci.yml).

Source SHA-256: `2132298e8c7fd2e5a6b3566ca0773f436986f7df3699fad7e3aa777d9afebec1`.

#### Additional reviewed version 1

Check the image-rendering package and keep a visual gallery for reviewing its output.

**What it does**

1. Install dependencies, then typecheck, lint, build the package and run its tests.
2. Attempt to draw the gallery even when an earlier check fails.
3. Upload any generated gallery output so reviewers can inspect the rendered images.

**Produces**

- A gallery artifact retained for 14 days when gallery files are available.
- Validation results and a local package build.

[Reviewed source at f4597ce76500](https://github.com/unset-sh/rendering/blob/f4597ce765007c28c0fd0aadbd3f9f0333939229/.github/workflows/ci.yml).

Source SHA-256: `f2ebc78afa89bc8d12f478cf4613cab6419606c5ccc934696f85f71fb1ec38e0`.

### .github/workflows/release.yml

Publish a tagged image-rendering package after its release and dependency checks pass.

**What it does**

1. Require the tag to match package.json, its commit to be reachable from main, and every runtime dependency to use an exact released version.
2. Install dependencies, typecheck, lint, build and test the package.
3. Pack once without lifecycle scripts, record its checksum and pass the archive to the publishing job.
4. In the release environment, require exactly one archive, attest it and publish that same archive to GitHub Packages.

**Produces**

- The @unset-sh/presentation package and an artifact attestation when all release gates pass.
- A seven-day package artifact and checksum summary; this workflow does not create a GitHub release page.

[Reviewed source at f4597ce76500](https://github.com/unset-sh/rendering/blob/f4597ce765007c28c0fd0aadbd3f9f0333939229/.github/workflows/release.yml).

Source SHA-256: `868b1e24a3dca2c2eebdb33354c908e949d02fdaf6c0b19c9f57fb8b2f9adbc5`.

## tooling

### .github/workflows/automation-docs-export.yml

Provide a shared way to package committed public documentation with verifiable source information.

**What it does**

1. Check out the calling repository at its event commit and the helper scripts at this reusable workflow’s own commit.
2. Read tooling documentation from docs/ and other consumers’ documentation from docs/site/, together with the root licence.
3. Validate the committed files and export them into the repository’s owned section with a source revision and SHA-256 manifest.
4. Upload the export as an artifact for later consumption; this workflow does not publish to the docs repository or a site.

**Produces**

- A docs-\<commit\> artifact retained for 14 days, containing the documentation section, licence and source.json.

[Reviewed source at 36aaf03a55c6](https://github.com/unset-sh/tooling/blob/36aaf03a55c6009643d72f48b01b897a02eac289/.github/workflows/automation-docs-export.yml).

Source SHA-256: `be814aaf929a9bf939697b6022a5733bcb056ff1c78950733b162b16b07b87c0`.

#### Additional reviewed version 1

Provide a shared way to package committed public documentation with verifiable source information.

**What it does**

1. Check out the calling repository at its event commit and the helper scripts at this reusable workflow’s own commit.
2. Read tooling documentation from docs/ and other consumers’ documentation from docs/site/, together with the root licence.
3. Validate the committed files and export them into the repository’s owned section with a source revision and SHA-256 manifest.
4. Upload the export as an artifact for later consumption; this workflow does not publish to the docs repository or a site.

**Produces**

- A docs-\<commit\> artifact retained for 14 days, containing the documentation section, licence and source.json.

[Reviewed source at 22b6eb497c27](https://github.com/unset-sh/tooling/blob/22b6eb497c2782800523879a89a350c01cf1d2c1/.github/workflows/automation-docs-export.yml).

Source SHA-256: `f90f0e968a80c039aaa7791459c4ebeed1ca66f5da0b4a8a92c903e6efda57a6`.

#### Additional reviewed version 2

Provide a shared way to package committed public documentation with verifiable source information.

**What it does**

1. Check out the calling repository at its event commit and the helper scripts at this reusable workflow’s own commit.
2. Read the calling repository’s committed docs/site/ pages together with the root licence.
3. Validate the committed files and export them into the repository’s owned section with a source revision and SHA-256 manifest.
4. Upload the export as an artifact for later consumption; this workflow does not publish to the docs repository or a site.

**Produces**

- A docs-\<commit\> artifact retained for 14 days, containing the documentation section, licence and source.json.

[Reviewed source at 838a965d14d0](https://github.com/unset-sh/tooling/blob/838a965d14d0887291046c279422becb7b0228f3/.github/workflows/automation-docs-export.yml).

Source SHA-256: `2d1461df9ac798d9ff5c37e45339df30c3f80e14ff6da0a7a1a0f27c912e9c8f`.

### .github/workflows/automation-docs-import.yml

Prepare checked documentation imports into docs main from the two allowlisted stable source repositories, leaving the merge to a person.

**What it does**

1. Run only in unset-sh/docs on main. Resolve an exact main source revision with a successful same-repository export run, then re-export its committed documentation and licence with read-only permissions.
2. Validate a same-run bounded snapshot against immutable source Git objects and complete provenance before an isolated writer replaces only the owned section on its generated PR into main.
3. Use a separate Actions-writing job to verify the actual generated PR, dispatch the existing documentation and branch-policy checks on its exact head, and bind the returned run identities.

**Produces**

- A seven-day docs-import-\<source\>-\<run-id\>-\<run-attempt\> artifact and an opened, updated or pending section-only PR into main when content changes; valid unchanged content creates no PR.
- Verified requested run URLs for the two existing required checks; the workflow never merges a PR.

[Reviewed source at 36aaf03a55c6](https://github.com/unset-sh/tooling/blob/36aaf03a55c6009643d72f48b01b897a02eac289/.github/workflows/automation-docs-import.yml).

Source SHA-256: `d79b7009fa87783d532cb7b7d50a30610aea0edb5404b0655cf899885f16ccc2`.

#### Additional reviewed version 1

Prepare checked documentation imports into docs main from the two allowlisted stable source repositories, leaving the merge to a person.

**What it does**

1. Run only in unset-sh/docs on main. Resolve an exact main source revision with a successful same-repository export run, then re-export its committed documentation and licence with read-only permissions.
2. Validate a same-run bounded snapshot against immutable source Git objects and complete provenance before an isolated writer replaces only the owned section on its generated PR into main.
3. Use a separate Actions-writing job to verify the actual generated PR, dispatch the existing documentation and branch-policy checks on its exact head, and bind the returned run identities.

**Produces**

- A seven-day docs-import-\<source\>-\<run-id\>-\<run-attempt\> artifact and an opened, updated or pending section-only PR into main when content changes; valid unchanged content creates no PR.
- Verified requested run URLs for the two existing required checks; the workflow never merges a PR.

[Reviewed source at 064ddd23b6f6](https://github.com/unset-sh/tooling/blob/064ddd23b6f60db14d8dca8eb8babe1052e671d2/.github/workflows/automation-docs-import.yml).

Source SHA-256: `83eb61bfa42007d18d6ada817a4014b0fe08470f6b5a89012ccbf34d53ba2499`.

#### Additional reviewed version 2

Prepare checked staging documentation imports from the two allowlisted stable source repositories without automating production promotion.

**What it does**

1. Resolve an exact main source revision with a successful same-repository export run, then re-export its committed documentation and licence with read-only permissions.
2. Validate a same-run bounded snapshot against immutable source Git objects and complete provenance before an isolated writer replaces only the owned section on its generated staging PR.
3. Use a separate Actions-writing job to verify the actual generated PR, dispatch supplemental documentation and branch-policy validation on its exact head, and bind the returned run identities.

**Produces**

- A seven-day docs-import-\<source\>-\<run-id\>-\<run-attempt\> artifact and an opened, updated or pending section-only staging PR when content changes; valid unchanged content creates no PR.
- Verified requested run URLs for supplemental validation. Dispatched jobs do not satisfy PR ruleset checks; ordinary PR runs require human approval with GITHUB\_TOKEN. The workflow never merges a PR or promotes production.

[Reviewed source at 082e488ec410](https://github.com/unset-sh/tooling/blob/082e488ec41047ae79e5da2ba4327538d0e758c6/.github/workflows/automation-docs-import.yml).

Source SHA-256: `ea1aaa8901c6367c4c395f8173bcd4ed5f080f601b8518a00c549689f32c8962`.

### .github/workflows/automation-docs-map-schedule.yml

Keep the docs site’s approved main build refreshing every registered map from a timer on docs main.

**What it does**

1. Accept only scheduled or manual calls from unset-sh/docs on main, and run the central helper at the exact reusable-workflow commit.
2. Use the docs job token to request only site.yml on main through the fixed GitHub workflow-dispatch endpoint; no consumer code runs and no repository content is written.
3. Validate the returned run identity and print its URL so collection, build and deployment can be verified separately.

**Produces**

- A requested main site run. A successful dispatch is not proof that the map refresh or site deployment succeeded.

[Reviewed source at 36aaf03a55c6](https://github.com/unset-sh/tooling/blob/36aaf03a55c6009643d72f48b01b897a02eac289/.github/workflows/automation-docs-map-schedule.yml).

Source SHA-256: `8c34d934b68ccfab11cd466dd04111783307496f075fdf3590b91b4e61e0a07f`.

#### Additional reviewed version 1

Keep the docs site’s approved main build refreshing every registered map from a timer on docs main.

**What it does**

1. Accept only scheduled or manual calls from unset-sh/docs on main, and run the central helper at the exact reusable-workflow commit.
2. Use the docs job token to request only site.yml on main through the fixed GitHub workflow-dispatch endpoint; no consumer code runs and no repository content is written.
3. Validate the returned run identity and print its URL so collection, build and deployment can be verified separately.

**Produces**

- A requested main site run. A successful dispatch is not proof that the map refresh or site deployment succeeded.

[Reviewed source at 064ddd23b6f6](https://github.com/unset-sh/tooling/blob/064ddd23b6f60db14d8dca8eb8babe1052e671d2/.github/workflows/automation-docs-map-schedule.yml).

Source SHA-256: `268186d70018ca2763dd0b67baa78521356ee64a1bf204a0559aeecc9482b8ec`.

#### Additional reviewed version 2

Keep the docs site’s approved main build refreshing every registered map when staging is the default branch.

**What it does**

1. Accept only scheduled or manual calls from unset-sh/docs on staging, and run the central helper at the exact reusable-workflow commit.
2. Use the docs job token to request only site.yml on main through the fixed GitHub workflow-dispatch endpoint; no consumer code runs and no repository content is written.
3. Validate the returned run identity and print its URL so collection, build and deployment can be verified separately.

**Produces**

- A requested main site run. A successful dispatch is not proof that the map refresh or site deployment succeeded.

[Reviewed source at b0a4aa66e09d](https://github.com/unset-sh/tooling/blob/b0a4aa66e09dfdb05d4b94d70eec3896f96565f9/.github/workflows/automation-docs-map-schedule.yml).

Source SHA-256: `523025404ca31c72f229fd7f9f70f6bd642204ef73ce31512a95e4e756bcade6`.

### .github/workflows/automation-docs-self.yml

Check and package tooling’s own maintained documentation using the shared workflows it provides.

**What it does**

1. Run the shared Node checks under the distinct validate-docs / Check context on pull requests, main pushes and manual runs.
2. After validation succeeds, export the committed tooling docs and licence with source revision and file hashes.
3. Upload the provenance-bearing section for downstream import; this workflow does not write the docs repository or deploy the site.

**Produces**

- A docs-\<commit\> artifact retained for 14 days; publication is a separate step.

[Reviewed source at b0a4aa66e09d](https://github.com/unset-sh/tooling/blob/b0a4aa66e09dfdb05d4b94d70eec3896f96565f9/.github/workflows/automation-docs-self.yml).

Source SHA-256: `2ae97fb737faad6e46b9b524be7a88dbb82b8455ce7a2e1ab639457c2ce84b29`.

#### Additional reviewed version 1

Check and package tooling’s own maintained documentation using the shared workflows it provides.

**What it does**

1. Run tooling’s checks through the local reusable CI workflow.
2. After those checks pass, call the local documentation exporter.
3. Export the committed docs/ pages and licence into the tooling section with provenance.

**Produces**

- A docs-\<commit\> artifact retained for 14 days; publication is a separate step.

[Reviewed source at 22b6eb497c27](https://github.com/unset-sh/tooling/blob/22b6eb497c2782800523879a89a350c01cf1d2c1/.github/workflows/automation-docs-self.yml).

Source SHA-256: `0f99738da98b9862f3463795ec7ae14267d844b6d707f597acc58363a8fa8bba`.

### .github/workflows/automation-maps-refresh.yml

Refresh every map registered by a calling repository and hand its build one complete validated JSON snapshot.

**What it does**

1. Check out the caller at its event commit and the central helper at this reusable workflow’s own full commit.
2. Optionally install the caller’s locked dependencies with lifecycle scripts disabled, before passing a read-only token to generation.
3. Run each registered generator with the pinned Bun, in order, then validate every declared output as a bounded regular JSON file under data/.
4. Stage and upload only the complete snapshot; a generator or validation failure prevents upload and stops a dependent build.

**Produces**

- A maps-\<run-id\>-\<run-attempt\> artifact retained for seven days, preserving declared data/ paths.
- The artifact-name output for a dependent same-run download; this workflow does not commit files or publish a site.

[Reviewed source at 36aaf03a55c6](https://github.com/unset-sh/tooling/blob/36aaf03a55c6009643d72f48b01b897a02eac289/.github/workflows/automation-maps-refresh.yml).

Source SHA-256: `0a532bfd9f203c2ffc5e92a6cafef1a2bded0e0f0b2021bd1013e425a9024361`.

#### Additional reviewed version 1

Refresh every map registered by a calling repository and hand its build one complete validated JSON snapshot.

**What it does**

1. Check out the caller at its event commit and the central helper at this reusable workflow’s own full commit.
2. Optionally install the caller’s locked dependencies with lifecycle scripts disabled, before passing a read-only token to generation.
3. Run each registered Node generator in order, then validate every declared output as a bounded regular JSON file under data/.
4. Stage and upload only the complete snapshot; a generator or validation failure prevents upload and stops a dependent build.

**Produces**

- A maps-\<run-id\>-\<run-attempt\> artifact retained for seven days, preserving declared data/ paths.
- The artifact-name output for a dependent same-run download; this workflow does not commit files or publish a site.

[Reviewed source at be211937c3a9](https://github.com/unset-sh/tooling/blob/be211937c3a939cca33d0cac251156392cd61a7e/.github/workflows/automation-maps-refresh.yml).

Source SHA-256: `f5af37ae29d1678d846d3751390b38a2486d6509d6fc1d94419a09ae8962ca86`.

### .github/workflows/automation-org-map.yml

Prepare a generated-only organisation-map pull request into main and request its existing required checks without merging.

**What it does**

1. Run only for unset-sh/.github main pushes, schedules or manual calls; regenerate and check the exact source with read-only permissions.
2. Publish only MAP.md and the generated profile block through an isolated bot-owned PR into main, verifying exact source/head trees and preserving authored profile text.
3. Pass only the PR number, head and base to a separate Actions-write job that revalidates the real PR and dispatches the fixed organisation-map, documentation-check and branch-policy workflows at that exact head.

**Produces**

- An open generated PR into main when output changes, plus links to its three requested check runs. Successful dispatch does not prove those checks passed. No automatic merge occurs.

[Reviewed source at 36aaf03a55c6](https://github.com/unset-sh/tooling/blob/36aaf03a55c6009643d72f48b01b897a02eac289/.github/workflows/automation-org-map.yml).

Source SHA-256: `5e89758fab142d6d7be8addd3b3ee05ef3865819219472f4443ed45e5a127bd2`.

#### Additional reviewed version 1

Prepare a generated-only organisation-map pull request into main and request its existing required checks without merging.

**What it does**

1. Run only for unset-sh/.github main pushes, schedules or manual calls; regenerate and check the exact source with read-only permissions.
2. Publish only MAP.md and the generated profile block through an isolated bot-owned PR into main, verifying exact source/head trees and preserving authored profile text.
3. Pass only the PR number, head and base to a separate Actions-write job that revalidates the real PR and dispatches the fixed organisation-map, documentation-check and branch-policy workflows at that exact head.

**Produces**

- An open generated PR into main when output changes, plus links to its three requested check runs. Successful dispatch does not prove those checks passed. No automatic merge occurs.

[Reviewed source at 064ddd23b6f6](https://github.com/unset-sh/tooling/blob/064ddd23b6f60db14d8dca8eb8babe1052e671d2/.github/workflows/automation-org-map.yml).

Source SHA-256: `470ad5193645f3f38165b4f6b84aaedc8f079fd42421170c68cdc3c360c253d9`.

#### Additional reviewed version 2

Prepare a generated-only organisation-map staging PR and request supplemental validation without merging or promoting production.

**What it does**

1. Run only for unset-sh/.github staging pushes, schedules or manual calls; regenerate and check the exact source with read-only permissions.
2. Publish only MAP.md and the generated profile block through an isolated bot-owned staging PR, verifying exact source/head trees and preserving authored profile text.
3. Pass only the PR number, head and base to a separate Actions-write job that revalidates the real PR and dispatches the fixed organisation-map, documentation-check and branch-policy workflows at that exact head.

**Produces**

- An open generated staging PR when output changes, plus links to three supplemental runs. Dispatch does not satisfy PR ruleset checks; ordinary PR runs require human approval with GITHUB\_TOKEN. No automatic merge or main promotion occurs.

[Reviewed source at c2517bded6ea](https://github.com/unset-sh/tooling/blob/c2517bded6ea28a6e9ab286c1382613e07fb0d4c/.github/workflows/automation-org-map.yml).

Source SHA-256: `45c4846bebc27251e2bdfc3d0fc6a1073608d2271e867130e70ed5dac9afcb42`.

#### Additional reviewed version 3

Regenerate the organisation’s Markdown map and publish validated changes through a generated-only pull request.

**What it does**

1. Accept only unset-sh/.github main-branch push, scheduled or manual runs, and verify the reusable helper’s repository and full commit identity.
2. With read-only permissions, check out the exact source revision, regenerate and check the map, then stage only the two registered Markdown outputs in this run’s artifact.
3. In a separate job, check out only the pinned helper, download the same-run snapshot and give the write token only to the publisher.
4. Verify the source revision, fixed output paths and authored profile text, then create or reuse only a matching generated branch and bot-authored pull request with the bot sign-off.
5. Request a squash merge with the exact PR head, refusing observed main movement and respecting GitHub merge restrictions; a concurrent base change can leave a stale view until a successful current-main run.

**Produces**

- An org-map-\<run-id\>-\<run-attempt\> artifact retained for seven days.
- When output changes and GitHub permits the merge, updated MAP.md and the generated profile/README.md block; unchanged output creates no branch or PR.
- A prepared pull request when GitHub refuses the merge; source declarations and authored profile text remain unchanged.

[Reviewed source at 3b81a8a0196a](https://github.com/unset-sh/tooling/blob/3b81a8a0196a2c1e49131584bdd4355867f2ed4e/.github/workflows/automation-org-map.yml).

Source SHA-256: `6d99e6c599fce452189e7b370a6686b8a903efc248ca3ba14069533dcad549c5`.

### .github/workflows/ci-branch-policy-self.yml

Apply the shared PR branch policy to tooling itself.

**What it does**

1. Run on all pull requests, including retargeting and ready-for-review events, without path or base filters.
2. Call the branch-policy implementation from the same commit with no token permissions.

**Produces**

- The nested policy / Validate branch policy result; no merges, settings changes or releases.

[Reviewed source at 8adf511bed6a](https://github.com/unset-sh/tooling/blob/8adf511bed6a0f1627237d4e062056fe0c6e04fd/.github/workflows/ci-branch-policy-self.yml).

Source SHA-256: `b5ef9684b9ef797b2a6a91890793a14c0715e58362883cea4212d603a0433fe6`.

### .github/workflows/ci-branch-policy.yml

Validate normal pull-request branch relationships for staged or main-only repositories, and narrowly verified generated-PR dispatches, without granting the policy job token permissions.

**What it does**

1. For ordinary PR events, read GitHub event metadata without checkout. With the default flow staged, require staging or main as the base and only same-repository staging for main; with flow main, require main as the base from any branch or fork. An unknown flow fails.
2. For generated dispatches, refuse foreign repository, branch, head or helper identities before anonymously fetching the central validator at the running workflow commit.
3. Validate actual API PR metadata, current head/base and the complete generated-only change proof for docs imports or the organisation map before reporting the same required check.

**Produces**

- The stable Validate branch policy job result, failing on malformed events, an unknown flow, unsupported generated identities, source proof failures or ref movement.

[Reviewed source at 36aaf03a55c6](https://github.com/unset-sh/tooling/blob/36aaf03a55c6009643d72f48b01b897a02eac289/.github/workflows/ci-branch-policy.yml).

Source SHA-256: `734c4fc523415b08938f15d1d96871a2836866a471380cba87194228a0922246`.

#### Additional reviewed version 1

Validate normal pull-request branch relationships for staged or main-only repositories, and narrowly verified generated-PR dispatches, without granting the policy job token permissions.

**What it does**

1. For ordinary PR events, read GitHub event metadata without checkout. With the default flow staged, require staging or main as the base and only same-repository staging for main; with flow main, require main as the base from any branch or fork. An unknown flow fails.
2. For generated dispatches, refuse foreign repository, branch, head or helper identities before anonymously fetching the central validator at the running workflow commit.
3. Validate actual API PR metadata, current head/base and the complete generated-only change proof for docs imports or the organisation map before reporting the same required check.

**Produces**

- The stable Validate branch policy job result, failing on malformed events, an unknown flow, unsupported generated identities, source proof failures or ref movement.

[Reviewed source at 064ddd23b6f6](https://github.com/unset-sh/tooling/blob/064ddd23b6f60db14d8dca8eb8babe1052e671d2/.github/workflows/ci-branch-policy.yml).

Source SHA-256: `377811cb9f321bfdb2f1da5f987ccbd5bdab7f491d131490fb1badaf5d4c4e40`.

#### Additional reviewed version 2

Validate normal pull-request branch relationships and narrowly verified generated-PR dispatches without granting the policy job token permissions.

**What it does**

1. For ordinary PR events, read GitHub event metadata without checkout and require staging or main as the base; only same-repository staging may target main.
2. For generated dispatches, refuse foreign repository, branch, head or helper identities before anonymously fetching the central validator at the running workflow commit.
3. Validate actual API PR metadata, current head/base and the complete generated-only change proof for docs imports or the organisation map before reporting the same job result; workflow\_dispatch results remain supplemental.

**Produces**

- The stable Validate branch policy job result, failing on malformed events, unsupported generated identities, proof failures or ref movement. Its PR-event results can satisfy required checks; its workflow\_dispatch results cannot.

[Reviewed source at 082e488ec410](https://github.com/unset-sh/tooling/blob/082e488ec41047ae79e5da2ba4327538d0e758c6/.github/workflows/ci-branch-policy.yml).

Source SHA-256: `2365d1362d70ca9e830166d2cecdc7c8f6846d8f10186edc84d6459bb9cafd66`.

#### Additional reviewed version 3

Validate that feature work enters staging and only same-repository staging promotes to main.

**What it does**

1. Read the original pull-request event as JSON with no checkout, token permissions, repository code or API calls.
2. Reject missing or inconsistent metadata, non-PR events and bases other than staging or main.
3. Allow feature and fork PRs into staging; require a staging head from the same repository for main.
4. Report the branch-policy result without identifying a human, approving a PR or publishing anything.

**Produces**

- The Validate branch policy job conclusion, for callers to require alongside their product checks.

[Reviewed source at 8adf511bed6a](https://github.com/unset-sh/tooling/blob/8adf511bed6a0f1627237d4e062056fe0c6e04fd/.github/workflows/ci-branch-policy.yml).

Source SHA-256: `da74e0945258546204a5d88e780529643aafc3b55e46e77d0a4d2697ee923e8b`.

### .github/workflows/ci-check.yml

Provide a reusable Bun-based check job that each calling repository configures with its own validation command.

**What it does**

1. When the caller sets postgres-image, run that Postgres image as a service on the runner's loopback with trust authentication, refuse the job unless the image is postgres:\<tag\>@sha256:\<64 hex\>, and set PGHOST, PGPORT, PGUSER and PGDATABASE for the check; with it empty, start no service.
2. When the caller sets openfga-image, refuse the job unless the image is openfga/openfga:v\<version\>@sha256:\<64 hex\>, start it with run, in memory, on the runner's loopback with a preshared key made for the run and masked, wait up to 60 seconds for it to be healthy, and set FGA\_URL and FGA\_KEY for the check; with it empty, start nothing.
3. Check out the caller, install the exact Bun version its .bun-version names, and refuse any other version.
4. Optionally install dependencies from the committed bun.lock with bun install --frozen-lockfile --ignore-scripts, failing when bun.lock is missing; only that step holds the job’s package-read token, as GITHUB\_PACKAGES\_TOKEN, a name only the repository’s bunfig.toml reads, for @unset-sh packages on GitHub Packages.
5. Run the caller’s check command, defaulting to bun run check.
6. If the caller specifies an output path, attempt to retain it even when the check fails.

**Produces**

- The check result for the calling repository.
- An optional check-output artifact retained for 14 days when a path is configured and files are available.

[Reviewed source at 592ecac046d9](https://github.com/unset-sh/tooling/blob/592ecac046d97ca41158c00316b01fbb83c2101a/.github/workflows/ci-check.yml).

Source SHA-256: `a6e30593572f02aa8027b2a19b9c2ce40f81f0f776cd905ccda73f6808af6f1c`.

#### Additional reviewed version 1

Provide a reusable Bun-based check job that each calling repository configures with its own validation command.

**What it does**

1. When the caller sets postgres-image, run that Postgres image as a service on the runner's loopback with trust authentication, refuse the job unless the image is postgres:\<tag\>@sha256:\<64 hex\>, and set PGHOST, PGPORT, PGUSER and PGDATABASE for the check; with it empty, start no service.
2. Check out the caller, install the exact Bun version its .bun-version names, and refuse any other version.
3. Optionally install dependencies from the committed bun.lock with bun install --frozen-lockfile --ignore-scripts, failing when bun.lock is missing; only that step holds the job’s package-read token, as GITHUB\_PACKAGES\_TOKEN, a name only the repository’s bunfig.toml reads, for @unset-sh packages on GitHub Packages.
4. Run the caller’s check command, defaulting to bun run check.
5. If the caller specifies an output path, attempt to retain it even when the check fails.

**Produces**

- The check result for the calling repository.
- An optional check-output artifact retained for 14 days when a path is configured and files are available.

[Reviewed source at 919f5f3d83ef](https://github.com/unset-sh/tooling/blob/919f5f3d83ef997d5b6cd4507e3d2d0b531d4cc6/.github/workflows/ci-check.yml).

Source SHA-256: `c7ffe51aed9b153504547256f91d25d132300859e2670f95397794fc3ed7bee2`.

#### Additional reviewed version 2

Provide a reusable Bun-based check job that each calling repository configures with its own validation command.

**What it does**

1. When the caller sets postgres-image, run that Postgres image as a service on the runner's loopback with trust authentication, refuse the job unless the image is postgres:\<tag\>@sha256:\<64 hex\>, and set PGHOST, PGPORT, PGUSER and PGDATABASE for the check; with it empty, start no service.
2. Check out the caller, install the exact Bun version its .bun-version names, and refuse any other version.
3. Optionally install dependencies from the committed bun.lock with bun install --frozen-lockfile --ignore-scripts, failing when bun.lock is missing; only that step holds the job’s package-read token, as NPM\_CONFIG\_TOKEN, for @unset-sh packages on GitHub Packages.
4. Run the caller’s check command, defaulting to bun run check.
5. If the caller specifies an output path, attempt to retain it even when the check fails.

**Produces**

- The check result for the calling repository.
- An optional check-output artifact retained for 14 days when a path is configured and files are available.

[Reviewed source at b0ed87075ba4](https://github.com/unset-sh/tooling/blob/b0ed87075ba4a0c6502f72e668600eb2a169b979/.github/workflows/ci-check.yml).

Source SHA-256: `f4b7df4d6241b2852ecd32b68b61d83477c7fa1c82d1abf67f0be6b92343aeb0`.

#### Additional reviewed version 3

Provide a reusable Bun-based check job that each calling repository configures with its own validation command.

**What it does**

1. Check out the caller, install the exact Bun version its .bun-version names, and refuse any other version.
2. Optionally install dependencies from the committed bun.lock with bun install --frozen-lockfile --ignore-scripts, failing when bun.lock is missing; only that step holds the job’s package-read token, as NPM\_CONFIG\_TOKEN, for @unset-sh packages on GitHub Packages.
3. Run the caller’s check command, defaulting to bun run check.
4. If the caller specifies an output path, attempt to retain it even when the check fails.

**Produces**

- The check result for the calling repository.
- An optional check-output artifact retained for 14 days when a path is configured and files are available.

[Reviewed source at 21488c94f00f](https://github.com/unset-sh/tooling/blob/21488c94f00f1c68f32fc3b811615b6ea4ab353c/.github/workflows/ci-check.yml).

Source SHA-256: `21ce241f0a9ca446e1589273470ec04e1de75740282580ed007cf07bf01eeb05`.

#### Additional reviewed version 4

Provide a reusable Bun-based check job that each calling repository configures with its own validation command.

**What it does**

1. Check out the caller, install the exact Bun version its .bun-version names, and refuse any other version.
2. Optionally install dependencies from the committed bun.lock with bun install --frozen-lockfile --ignore-scripts, failing when bun.lock is missing.
3. Run the caller’s check command, defaulting to bun run check.
4. If the caller specifies an output path, attempt to retain it even when the check fails.

**Produces**

- The check result for the calling repository.
- An optional check-output artifact retained for 14 days when a path is configured and files are available.

[Reviewed source at 36aaf03a55c6](https://github.com/unset-sh/tooling/blob/36aaf03a55c6009643d72f48b01b897a02eac289/.github/workflows/ci-check.yml).

Source SHA-256: `06241779cfbc46a02f5c0b91cac33a2e218bf929ec5f26c75eb5f45d01fd09b1`.

#### Additional reviewed version 5

Provide a reusable Node-based check job that each calling repository configures with its own validation command.

**What it does**

1. Check out the caller and select the Node version from its .nvmrc.
2. Optionally install dependencies with npm ci --ignore-scripts.
3. Run the caller’s check command, defaulting to npm run check.
4. If the caller specifies an output path, attempt to retain it even when the check fails.

**Produces**

- The check result for the calling repository.
- An optional check-output artifact retained for 14 days when a path is configured and files are available.

[Reviewed source at 22b6eb497c27](https://github.com/unset-sh/tooling/blob/22b6eb497c2782800523879a89a350c01cf1d2c1/.github/workflows/ci-check.yml).

Source SHA-256: `7bcb733d8dff4194c32c26d427ab73cd3ffffaee1379c2bf0240553f3cfcd924`.

#### Additional reviewed version 6

Provide a reusable Node-based check job that each calling repository configures with its own validation command.

**What it does**

1. Check out the caller and select the Node version from its .nvmrc.
2. Optionally install dependencies with npm ci --ignore-scripts.
3. Run the caller’s check command, defaulting to npm run check.
4. If the caller specifies an output path, attempt to retain it even when the check fails.

**Produces**

- The check result for the calling repository.
- An optional check-output artifact retained for 14 days when a path is configured and files are available.

[Reviewed source at 838a965d14d0](https://github.com/unset-sh/tooling/blob/838a965d14d0887291046c279422becb7b0228f3/.github/workflows/ci-check.yml).

Source SHA-256: `b2fb5be2127833a3317b7a4102db2e1aa5be4ad829e731b980ee386ce29f90a9`.

### .github/workflows/ci-pr-policy-self.yml

Apply the shared pull-request metadata check to tooling changes when their code, description or labels change.

**What it does**

1. Run on opened, synchronized, reopened, edited, labeled, unlabeled and ready-for-review pull requests, without path filters.
2. Call tooling’s local reusable PR policy workflow with read-only contents and pull-request permissions, cancelling superseded runs for the same PR.
3. Use the repository’s purpose labels and PR template to make missing declarations actionable.

**Produces**

- The policy / PR policy check on tooling pull requests. Ruleset enforcement and adoption in other repositories are separate rollout steps.

[Reviewed source at c65eee545658](https://github.com/unset-sh/tooling/blob/c65eee545658a893d7f82b041757ccf2f58d4935/.github/workflows/ci-pr-policy-self.yml).

Source SHA-256: `8216cc1b806ec417eb5346f8814734d7e2ee22c767d136a3dc647ca873cf76ab`.

### .github/workflows/ci-pr-policy.yml

Validate current pull-request labels and readiness, validation and documentation declarations without executing pull-request code.

**What it does**

1. Require a real pull-request event, bind its repository, number and head to current metadata fetched from the fixed GitHub API endpoint, and refuse changed or unavailable identities.
2. Require exactly one supported purpose label, one readiness choice, prerequisite and tested-combination fields, and authored validation and documentation sections.
3. Ignore comments and code examples, reject duplicate sections and placeholders, and run only the central helper at the exact reusable-workflow commit with read-only permissions.

**Produces**

- A PR policy check result. This validates declarations, not their truth or sufficiency; it does not merge, release or grant a policy exception.

[Reviewed source at 36aaf03a55c6](https://github.com/unset-sh/tooling/blob/36aaf03a55c6009643d72f48b01b897a02eac289/.github/workflows/ci-pr-policy.yml).

Source SHA-256: `79a541be36a2646d47f9380a8b6f1b95e2605d095f95bcc62ad35102f7d7aa46`.

#### Additional reviewed version 1

Validate current pull-request labels and readiness, validation and documentation declarations without executing pull-request code.

**What it does**

1. Require a real pull-request event, bind its repository, number and head to current metadata fetched from the fixed GitHub API endpoint, and refuse changed or unavailable identities.
2. Require exactly one supported purpose label, one readiness choice, prerequisite and tested-combination fields, and authored validation and documentation sections.
3. Ignore comments and code examples, reject duplicate sections and placeholders, and run only the central helper at the exact reusable-workflow commit with read-only permissions.

**Produces**

- A PR policy check result. This validates declarations, not their truth or sufficiency; it does not merge, release or grant a policy exception.

[Reviewed source at c65eee545658](https://github.com/unset-sh/tooling/blob/c65eee545658a893d7f82b041757ccf2f58d4935/.github/workflows/ci-pr-policy.yml).

Source SHA-256: `045e38c5b7cc3f215daed8fa3c01ff11d01f56fad745a14b21daeeb1188acca6`.

### .github/workflows/ci-repository-policy-self.yml

Apply the shared repository policy checks to tooling pull requests and staging or main pushes.

**What it does**

1. Run on every pull request and pushes to staging or main without path filters.
2. Call the local reusable repository-policy workflow with read-only contents permission and tooling’s committed scope configuration.

**Produces**

- The policy / Repository policy check for tooling. Ruleset enforcement remains a separate setting.

[Reviewed source at cac06e938139](https://github.com/unset-sh/tooling/blob/cac06e938139f53192e9e2fa85805b62ebfe2856/.github/workflows/ci-repository-policy-self.yml).

Source SHA-256: `fe759f6e8612346fea735a0398fabb0cbb8fdb0190b82c560b8fee4da0f76529`.

#### Additional reviewed version 1

Apply the shared repository policy checks to tooling pull requests and main pushes.

**What it does**

1. Run on every pull request and pushes to main without path filters.
2. Call the local reusable repository-policy workflow with read-only contents permission and tooling’s committed scope configuration.

**Produces**

- The policy / Repository policy check for tooling. Ruleset enforcement remains a separate setting.

[Reviewed source at b5c9dec33c97](https://github.com/unset-sh/tooling/blob/b5c9dec33c97febe5563616862bdaadd789479e3/.github/workflows/ci-repository-policy-self.yml).

Source SHA-256: `398d8d5a8dc00bd8b88d99097ed297d406710d7fc25132d3e2397933e961d492`.

### .github/workflows/ci-repository-policy.yml

Check declared dependency and action pins, installed agent-kit integrity and forbidden working-artifact paths without executing consumer code.

**What it does**

1. Verify the central workflow identity and check out the consumer and tooling helpers at their exact event and workflow commits.
2. Install checksum-verified zizmor 1.32.0, parse committed workflow and configured action definitions offline, and fail on parser or scanner errors.
3. Read the committed policy configuration and npm manifests, compare installed-kit bytes with their lock, inspect forbidden path prefixes, and apply only reasoned exact exceptions.

**Produces**

- A Repository policy check result with bounded diagnostics. This does not establish semantic policy compliance, release authenticity, dependency age or licence correctness; other repositories must adopt it explicitly.

[Reviewed source at 36aaf03a55c6](https://github.com/unset-sh/tooling/blob/36aaf03a55c6009643d72f48b01b897a02eac289/.github/workflows/ci-repository-policy.yml).

Source SHA-256: `1b88b0cd7bd4c639d082e2f79218ca6ad58e539bb38e6830ca7dced27653552f`.

#### Additional reviewed version 1

Check declared dependency and action pins, installed agent-kit integrity and forbidden working-artifact paths without executing consumer code.

**What it does**

1. Verify the central workflow identity and check out the consumer and tooling helpers at their exact event and workflow commits.
2. Install checksum-verified zizmor 1.32.0, parse committed workflow and configured action definitions offline, and fail on parser or scanner errors.
3. Read the committed policy configuration and npm manifests, compare installed-kit bytes with their lock, inspect forbidden path prefixes, and apply only reasoned exact exceptions.

**Produces**

- A Repository policy check result with bounded diagnostics. This does not establish semantic policy compliance, release authenticity, dependency age or licence correctness; other repositories must adopt it explicitly.

[Reviewed source at cac06e938139](https://github.com/unset-sh/tooling/blob/cac06e938139f53192e9e2fa85805b62ebfe2856/.github/workflows/ci-repository-policy.yml).

Source SHA-256: `d791880f4d5be1a69e54ef17cef9500adca5e2010fdc2439f029d87da4210948`.

### .github/workflows/ci-self.yml

Verify tooling’s implementation and the executable workflows generated from its organised workflow sources.

**What it does**

1. Run for pull requests and pushes to staging or main.
2. Run the local reusable check workflow, which checks generated workflow files and runs tooling’s test suites.
3. Download the pinned actionlint release and verify its SHA-256.
4. Lint the executable workflow files, suppressing only the two documented job-context fields that the pinned linter does not recognise.

**Produces**

- Check and workflow-lint results; this workflow does not release or publish tooling.

[Reviewed source at 8adf511bed6a](https://github.com/unset-sh/tooling/blob/8adf511bed6a0f1627237d4e062056fe0c6e04fd/.github/workflows/ci-self.yml).

Source SHA-256: `cc13916e879cda827cbb19dc03ebd0a4af58e8543d5ca6d7a479abb81096dd65`.

#### Additional reviewed version 1

Verify tooling’s implementation and the executable workflows generated from its organised workflow sources.

**What it does**

1. Run the local reusable check workflow, which checks generated workflow files and runs tooling’s test suites.
2. Download the pinned actionlint release and verify its SHA-256.
3. Lint the executable workflow files, suppressing only the two documented job-context fields that the pinned linter does not recognise.

**Produces**

- Check and workflow-lint results; this workflow does not release or publish tooling.

[Reviewed source at 22b6eb497c27](https://github.com/unset-sh/tooling/blob/22b6eb497c2782800523879a89a350c01cf1d2c1/.github/workflows/ci-self.yml).

Source SHA-256: `f8e1112c8042f774f3810bea1989d396dc676ea08027915eb1671515192f430a`.

#### Additional reviewed version 2

Verify tooling’s implementation and the executable workflows generated from its organised workflow sources.

**What it does**

1. Run for pull requests and pushes to main.
2. Run the local reusable check workflow, which checks generated workflow files and runs tooling’s test suites.
3. Download the pinned actionlint release and verify its SHA-256.
4. Lint the executable workflow files, suppressing only the two documented job-context fields that the pinned linter does not recognise.

**Produces**

- Check and workflow-lint results; this workflow does not release or publish tooling.

[Reviewed source at b5c9dec33c97](https://github.com/unset-sh/tooling/blob/b5c9dec33c97febe5563616862bdaadd789479e3/.github/workflows/ci-self.yml).

Source SHA-256: `d77735374047b0225afa437b2d5c14e346ed8303bfa3e5be466d22a4dcc9a7d8`.

### .github/workflows/image-staging.yml

Build a repository's container image when a change merges into its staging branch, push it by digest to ghcr.io/unset-sh/staging/\<repository\>, and attest its build provenance, using only the run's own GITHUB\_TOKEN.

**What it does**

1. In both jobs, refuse any start but a push to refs/heads/staging of an unset-sh repository whose name is lower-case letters, digits and dashes, and stop unless the workflow's own repository and full commit are known before any checkout.
2. In the read-only build job, check out the caller at the pushed commit and refuse a context or Dockerfile outside the repository, or any image the Dockerfile pulls (FROM, COPY --from, RUN --mount from=, the syntax directive) that is not pinned by digest, before any caller code runs. The Dockerfile is read as BuildKit v0.35.0 reads it; a \#! first line, odd whitespace, an unknown instruction, a flag with a quote, backslash, backtick or non-ASCII character, and a '\<\<' outside the plain heredoc forms are refused.
3. Build for linux/amd64 or linux/arm64 on a runner of that architecture with BuildKit pinned by digest in a new builder: no cache, no BuildKit provenance or SBOM, SOURCE\_DATE\_EPOCH from the commit time with rewritten file timestamps, and source, revision and licence labels, the licence read from the caller's package.json. Write an OCI layout folder, push nothing, check it and upload it as a one-day artifact.
4. In the publish job, which runs no caller code, check the downloaded layout again: exactly one image manifest for the platform, every blob hashing to its name, no blob the image does not name, and this run's source and revision labels; refuse a digest that differs from the build job's.
5. Install crane v0.22.1 checked against a pinned SHA-256, sign in to ghcr.io with GITHUB\_TOKEN, push the image by digest with no tag of its own, read the stored manifest back and refuse a different digest, attest the digest with actions/attest and push-to-registry, without a storage record, then sign out.

**Produces**

- The digest output, sha256:\<64 hex\>, and the image output, ghcr.io/unset-sh/staging/\<repository\>@sha256:\<64 hex\>.
- An image with no tag of its own in ghcr.io/unset-sh/staging/\<repository\>, and a build provenance attestation for its digest, stored with GitHub and pushed beside the image under the OCI referrers tag sha256-\<image hex\>, because GHCR has no referrers API.
- A run summary listing the pinned images the Dockerfile pulls and the gh attestation verify command for the pushed image.

[Reviewed source at 449027b9b49d](https://github.com/unset-sh/tooling/blob/449027b9b49d5e0f29ab1c9a17191d47b6c8bcdb/.github/workflows/image-staging.yml).

Source SHA-256: `df432d1f59cdb0c4c6b9bdea1ba288fa0a8b5882a5361bc96b410531f2e22399`.

#### Additional reviewed version 1

Build a repository's container image when a change merges into its staging branch, push it by digest to ghcr.io/unset-sh/staging/\<repository\>, and attest its build provenance, using only the run's own GITHUB\_TOKEN.

**What it does**

1. In both jobs, refuse any start but a push to refs/heads/staging of an unset-sh repository whose name is lower-case letters, digits and dashes, and stop unless the workflow's own repository and full commit are known before any checkout.
2. In the read-only build job, check out the caller at the pushed commit and refuse a context or Dockerfile outside the repository, or any image the Dockerfile pulls (FROM, COPY --from, RUN --mount from=, the syntax directive) that is not pinned by digest, before any caller code runs. The Dockerfile is read as BuildKit v0.35.0 reads it; a \#! first line, odd whitespace, an unknown instruction, a flag with a quote, backslash, backtick or non-ASCII character, and a '\<\<' outside the plain heredoc forms are refused.
3. Build for linux/amd64 or linux/arm64 on a runner of that architecture with BuildKit pinned by digest in a new builder: no cache, no BuildKit provenance or SBOM, SOURCE\_DATE\_EPOCH from the commit time with rewritten file timestamps, and source, revision and licence labels, the licence read from the caller's package.json. Pass no build argument, and no secret unless the caller sets read-packages: then the run's token, which holds contents: read and packages: read in this job, goes to the build as the BuildKit secret github\_packages\_token. Write an OCI layout folder, push nothing, check it and upload it as a one-day artifact.
4. In the publish job, which runs no caller code, check the downloaded layout again: exactly one image manifest for the platform, every blob hashing to its name, no blob the image does not name, and this run's source and revision labels; refuse a digest that differs from the build job's.
5. Install crane v0.22.1 checked against a pinned SHA-256, sign in to ghcr.io with GITHUB\_TOKEN, push the image by digest with no tag of its own, read the stored manifest back and refuse a different digest, attest the digest with actions/attest and push-to-registry, without a storage record, then sign out.

**Produces**

- The digest output, sha256:\<64 hex\>, and the image output, ghcr.io/unset-sh/staging/\<repository\>@sha256:\<64 hex\>.
- An image with no tag of its own in ghcr.io/unset-sh/staging/\<repository\>, and a build provenance attestation for its digest, stored with GitHub and pushed beside the image under the OCI referrers tag sha256-\<image hex\>, because GHCR has no referrers API.
- A run summary listing the pinned images the Dockerfile pulls and the gh attestation verify command for the pushed image.

[Reviewed source at 56f4557926e6](https://github.com/unset-sh/tooling/blob/56f4557926e68d77f7b6561249ba9f31970ad82c/.github/workflows/image-staging.yml).

Source SHA-256: `65aae0a374d865d516e349c1911a4b4a646200277634971d189f7ff195f5d96a`.

### .github/workflows/releases-channel.yml

Publish separate staging prereleases and stable releases from an exact same-repository staging promotion, without changing the legacy owner-approved release path.

**What it does**

1. Validate the public push identity, immutable package and changelog, active branch rules and pre-existing channel environment; stable requires the exact merged staging pull request and both merge parents.
2. Prepare only supported root manifest and lock versions, then run consumer checks, build and script-free packing with read-only permissions; only the install step holds a package-read token for @unset-sh dependencies.
3. Recheck authority and committed source, bind same-run artifacts to repository, commit, channel, version and attempt, and validate plain files and strict package archives before attestation.
4. Atomically reserve a new tag, publish with bun publish, an explicit registry and the staging or latest tag, from an empty folder and stripped environment, create the prerelease or stable release page, and verify the tag again.

**Produces**

- Derived version and channel, with released=true only after successful publication and exact tag verification; source version 0.0.0 skips publication.
- Immutable version tags, release pages and optional attested assets and GitHub Packages versions; no caller adoption or environment changes.
- Refusal on unavailable evidence, invalid promotion, incompatible protections, unsupported package/lock data, artifact mismatch or reused version. Hidden ruleset bypasses and human intent require separate settings and process controls.

[Reviewed source at 919f5f3d83ef](https://github.com/unset-sh/tooling/blob/919f5f3d83ef997d5b6cd4507e3d2d0b531d4cc6/.github/workflows/releases-channel.yml).

Source SHA-256: `4ead8d58f792eecc943069851e62dc969fc098a16a87e0a884bc678bb93d4e34`.

#### Additional reviewed version 1

Publish separate staging prereleases and stable releases from an exact same-repository staging promotion, without changing the legacy owner-approved release path.

**What it does**

1. Validate the public push identity, immutable package and changelog, active branch rules and pre-existing channel environment; stable requires the exact merged staging pull request and both merge parents.
2. Prepare only supported root manifest and lock versions, then run consumer checks, build and script-free packing with read-only permissions; only the install step holds a package-read token for @unset-sh dependencies.
3. Recheck authority and committed source, bind same-run artifacts to repository, commit, channel, version and attempt, and validate plain files and strict package archives before attestation.
4. Atomically reserve a new tag, publish with bun publish, an explicit registry and the staging or latest tag, from an empty folder and stripped environment, create the prerelease or stable release page, and verify the tag again.

**Produces**

- Derived version and channel, with released=true only after successful publication and exact tag verification; source version 0.0.0 skips publication.
- Immutable version tags, release pages and optional attested assets and GitHub Packages versions; no caller adoption or environment changes.
- Refusal on unavailable evidence, invalid promotion, incompatible protections, unsupported package/lock data, artifact mismatch or reused version. Hidden ruleset bypasses and human intent require separate settings and process controls.

[Reviewed source at 21488c94f00f](https://github.com/unset-sh/tooling/blob/21488c94f00f1c68f32fc3b811615b6ea4ab353c/.github/workflows/releases-channel.yml).

Source SHA-256: `967afbacef017f8ee1f7a3fdbb7171fbe512c103dd8f68c097c07ae9c5165eb6`.

#### Additional reviewed version 2

Publish separate staging prereleases and stable releases from an exact same-repository staging promotion, without changing the legacy owner-approved release path.

**What it does**

1. Validate the public push identity, immutable package and changelog, active branch rules and pre-existing channel environment; stable requires the exact merged staging pull request and both merge parents.
2. Prepare only supported root manifest and lock versions, then run consumer checks, build and script-free packing with read-only permissions.
3. Recheck authority and committed source, bind same-run artifacts to repository, commit, channel, version and attempt, and validate plain files and strict package archives before attestation.
4. Atomically reserve a new tag, publish with bun publish, an explicit registry and the staging or latest tag, from an empty folder and stripped environment, create the prerelease or stable release page, and verify the tag again.

**Produces**

- Derived version and channel, with released=true only after successful publication and exact tag verification; source version 0.0.0 skips publication.
- Immutable version tags, release pages and optional attested assets and GitHub Packages versions; no caller adoption or environment changes.
- Refusal on unavailable evidence, invalid promotion, incompatible protections, unsupported package/lock data, artifact mismatch or reused version. Hidden ruleset bypasses and human intent require separate settings and process controls.

[Reviewed source at 36aaf03a55c6](https://github.com/unset-sh/tooling/blob/36aaf03a55c6009643d72f48b01b897a02eac289/.github/workflows/releases-channel.yml).

Source SHA-256: `d3d8e6d9918ecc56580db4f9fc2c20c79cf6999f882838a0b73d4cbf78cd766f`.

#### Additional reviewed version 3

Publish separate staging prereleases and stable releases from an exact same-repository staging promotion, without changing the legacy owner-approved release path.

**What it does**

1. Validate the public push identity, immutable package and changelog, active branch rules and pre-existing channel environment; stable requires the exact merged staging pull request and both merge parents.
2. Prepare only supported root manifest and lock versions, then run consumer checks, build and script-free packing with read-only permissions.
3. Recheck authority and committed source, bind same-run artifacts to repository, commit, channel, version and attempt, and validate plain files and strict package archives before attestation.
4. Atomically reserve a new tag, publish npm with an explicit registry and staging or latest tag from an isolated environment, create the prerelease or stable release page, and verify the tag again.

**Produces**

- Derived version and channel, with released=true only after successful publication and exact tag verification; source version 0.0.0 skips publication.
- Immutable version tags, release pages and optional attested assets and GitHub Packages versions; no caller adoption or environment changes.
- Refusal on unavailable evidence, invalid promotion, incompatible protections, unsupported package/lock data, artifact mismatch or reused version. Hidden ruleset bypasses and human intent require separate settings and process controls.

[Reviewed source at 42f07ecbfbe4](https://github.com/unset-sh/tooling/blob/42f07ecbfbe4e6106e7903fe2a5671db51232f7d/.github/workflows/releases-channel.yml).

Source SHA-256: `8b2b1785233c21dab5cbfcd0288e9a43cb51a75365733b6b3aab9cf143c80611`.

### .github/workflows/releases-package.yml

Provide a shared release pipeline that builds once and publishes a new main-branch version through the owner’s release approval.

**What it does**

1. Accept only a push to main, inspect package.json and existing tags, and skip version 0.0.0 or an unchanged version that is already released.
2. Before building, validate the release environment’s owner-only review and main-only branch policy, plus the package manifest and changelog.
3. Run the caller’s checks and optional build, with only the install step holding a package-read token for @unset-sh dependencies, collect configured release files and optionally pack the package with bun pm pack, then show their checksums and notes for review.
4. After the release environment permits publication, recheck its protections and validate the downloaded artifacts without running the caller’s source code.
5. Attest the files, optionally publish the packed archive to GitHub Packages with bun publish from an empty folder and stripped environment, create the tag and GitHub release, and verify that the tag names the intended commit.

**Produces**

- A version tag and GitHub release with configured assets and release notes, plus attestations for attached files.
- An optional GitHub Packages release and a seven-day intermediate release artifact.
- The version and released workflow outputs for the caller.

[Reviewed source at 919f5f3d83ef](https://github.com/unset-sh/tooling/blob/919f5f3d83ef997d5b6cd4507e3d2d0b531d4cc6/.github/workflows/releases-package.yml).

Source SHA-256: `0d5c2e2158302e394e29b2fe66c5c2b163937a11a68e74791071a1df3d5038de`.

#### Additional reviewed version 1

Provide a shared release pipeline that builds once and publishes a new main-branch version through the owner’s release approval.

**What it does**

1. Accept only a push to main, inspect package.json and existing tags, and skip version 0.0.0 or an unchanged version that is already released.
2. Before building, validate the release environment’s owner-only review and main-only branch policy, plus the package manifest and changelog.
3. Run the caller’s checks and optional build, with only the install step holding a package-read token for @unset-sh dependencies, collect configured release files and optionally pack the package with bun pm pack, then show their checksums and notes for review.
4. After the release environment permits publication, recheck its protections and validate the downloaded artifacts without running the caller’s source code.
5. Attest the files, optionally publish the packed archive to GitHub Packages with bun publish from an empty folder and stripped environment, create the tag and GitHub release, and verify that the tag names the intended commit.

**Produces**

- A version tag and GitHub release with configured assets and release notes, plus attestations for attached files.
- An optional GitHub Packages release and a seven-day intermediate release artifact.
- The version and released workflow outputs for the caller.

[Reviewed source at 21488c94f00f](https://github.com/unset-sh/tooling/blob/21488c94f00f1c68f32fc3b811615b6ea4ab353c/.github/workflows/releases-package.yml).

Source SHA-256: `708208b8ebd8a57dc4a3773f599ee292cee5174d5fc3179689f4615afc14ea7c`.

#### Additional reviewed version 2

Provide a shared release pipeline that builds once and publishes a new main-branch version through the owner’s release approval.

**What it does**

1. Accept only a push to main, inspect package.json and existing tags, and skip version 0.0.0 or an unchanged version that is already released.
2. Before building, validate the release environment’s owner-only review and main-only branch policy, plus the package manifest and changelog.
3. Run the caller’s checks and optional build, collect configured release files and optionally pack the package with bun pm pack, then show their checksums and notes for review.
4. After the release environment permits publication, recheck its protections and validate the downloaded artifacts without running the caller’s source code.
5. Attest the files, optionally publish the packed archive to GitHub Packages with bun publish from an empty folder and stripped environment, create the tag and GitHub release, and verify that the tag names the intended commit.

**Produces**

- A version tag and GitHub release with configured assets and release notes, plus attestations for attached files.
- An optional GitHub Packages release and a seven-day intermediate release artifact.
- The version and released workflow outputs for the caller.

[Reviewed source at 36aaf03a55c6](https://github.com/unset-sh/tooling/blob/36aaf03a55c6009643d72f48b01b897a02eac289/.github/workflows/releases-package.yml).

Source SHA-256: `1dd89a6624c1ae6e374c472c7aa6a1038611fc9ea1b5bb8546418e8be2b7d994`.

#### Additional reviewed version 3

Provide a shared release pipeline that builds once and publishes a new main-branch version through the owner’s release approval.

**What it does**

1. Accept only a push to main, inspect package.json and existing tags, and skip version 0.0.0 or an unchanged version that is already released.
2. Before building, validate the release environment’s owner-only review and main-only branch policy, plus the package manifest and changelog.
3. Run the caller’s checks and optional build, collect configured release files and optionally pack an npm package, then show their checksums and notes for review.
4. After the release environment permits publication, recheck its protections and validate the downloaded artifacts without running the caller’s source code.
5. Attest the files, optionally publish the npm archive to GitHub Packages, create the tag and GitHub release, and verify that the tag names the intended commit.

**Produces**

- A version tag and GitHub release with configured assets and release notes, plus attestations for attached files.
- An optional GitHub Packages release and a seven-day intermediate release artifact.
- The version and released workflow outputs for the caller.

[Reviewed source at 22b6eb497c27](https://github.com/unset-sh/tooling/blob/22b6eb497c2782800523879a89a350c01cf1d2c1/.github/workflows/releases-package.yml).

Source SHA-256: `d2b79e06931d0f3a001678488d32c5830017805915275090c80dc2a613f92e2b`.

### .github/workflows/releases-self.yml

Release tooling itself through its shared release pipeline, attaching the executable workflows so consumers can verify a chosen version.

**What it does**

1. Start when package.json changes on main and call the local shared release workflow.
2. Run tooling’s checks and collect the executable files directly under .github/workflows as release assets.
3. Use the shared release environment checks and approval before attesting the workflow files and creating the version tag and release page.
4. At the reviewed source revision, package.json is still version 0.0.0, so the shared planner skips publication.

**Produces**

- For a releasable version, a GitHub release containing attested workflow files; no npm package is requested.

[Reviewed source at 22b6eb497c27](https://github.com/unset-sh/tooling/blob/22b6eb497c2782800523879a89a350c01cf1d2c1/.github/workflows/releases-self.yml).

Source SHA-256: `2d0f50374b978546520a36cc5f4decd4ffb443a6a9f9395274b2dfe2701763ac`.

## web

### .github/workflows/branch-policy.yml

Check that pull requests target staging and that promotions to main come from the same repository’s staging branch.

**What it does**

1. Run when a pull request opens, updates, reopens, is edited or becomes ready for review, without path or base-branch filters.
2. Call the pinned shared policy to check event metadata, accept staging or main as the target and require a same-repository staging head for main.
3. The shared job reads the event JSON with no checkout, token permissions or API calls; human-only promotion remains a separate operating rule.

**Produces**

- The nested policy / Validate branch policy result for repository branch protection; this workflow does not merge or publish changes.

[Reviewed source at 8239c4ac2405](https://github.com/unset-sh/web/blob/8239c4ac24059c236524aef1433f1582255d2d25/.github/workflows/branch-policy.yml).

Source SHA-256: `e2c2752b510a0cf77a10670ff3a0efb901c3ea0a824f286a089741cab4445ba9`.
