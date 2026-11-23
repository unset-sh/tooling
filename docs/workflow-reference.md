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

### .github/workflows/docs-export.yml

Prepare the organisation’s maintained documentation for the central docs site after regenerating and checking the organisation map.

**What it does**

1. Through the shared CI workflow, regenerate MAP.md and the profile map block from repos.json, then run the organisation’s tests and check the generated result.
2. After validation succeeds, export the committed docs/site pages and licence into the github section with source revision and file hashes.
3. Upload the isolated export for a later publishing step; regenerated map views are not committed or included as documentation sources by this workflow.

**Produces**

- A docs-\<commit\> artifact retained for 14 days, containing the github documentation section and provenance; this workflow does not publish to the docs repository.

[Reviewed source at fb4bfedf463f](https://github.com/unset-sh/.github/blob/fb4bfedf463f7cead362980c49843f774611cce3/.github/workflows/docs-export.yml).

Source SHA-256: `9e7ca1b8b2ff183c2da3d0bc9eab4a39c90b036b94d5813c2b5bb1e0f2a75ad4`.

#### Additional reviewed version 1

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

#### Additional reviewed version 1

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

### .github/workflows/ci.yml

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

## brand

### .github/workflows/ci.yml

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

## docs

### .github/workflows/ci.yml

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

### .github/workflows/site.yml

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

#### Additional reviewed version 1

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

### .github/workflows/check.yml

Validate the AT Protocol lexicon schemas, examples and reference documentation together.

**What it does**

1. Typecheck and lint the validation tooling, then run its tests.
2. Parse the schemas with the official AT Protocol libraries and build validators to resolve their references.
3. Validate authored examples and their coverage, and check generated reference documentation, local links and schema provenance hashes.

**Produces**

- A check result reporting schema, example, documentation, link or provenance problems; no release or documentation export is published.

[Reviewed source at 52cfb6990f38](https://github.com/unset-sh/lexicons/blob/52cfb6990f3833e4bdd260cd5bb520fc4446e122/.github/workflows/check.yml).

Source SHA-256: `9607e1b447520e271c49e21095ab76b8e9570270bcf92798b9da24aa7c8dab23`.

## profile-recipes

### .github/workflows/dco.yml

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

1. Typecheck the tooling, run its tests and validate every recipe against the vendored upstream schemas.
2. Render the recipe showcase pages.
3. Prepare an isolated documentation export and check its source provenance without publishing it.

**Produces**

- Recipe-validation results, locally rendered showcase pages and a temporary documentation export.

[Reviewed source at 1e64c469f86d](https://github.com/unset-sh/profile-recipes/blob/1e64c469f86dd2ad6e9b26200d26e308d6d06f4e/.github/workflows/validate.yml).

Source SHA-256: `91332579914d7c30380e42b16ead0076b874b5b2377c5e36fd079fb964a52e74`.

## rendering

### .github/workflows/ci.yml

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

[Reviewed source at 22b6eb497c27](https://github.com/unset-sh/tooling/blob/22b6eb497c2782800523879a89a350c01cf1d2c1/.github/workflows/automation-docs-export.yml).

Source SHA-256: `f90f0e968a80c039aaa7791459c4ebeed1ca66f5da0b4a8a92c903e6efda57a6`.

#### Additional reviewed version 1

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

### .github/workflows/automation-docs-self.yml

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
3. Run each registered Node generator in order, then validate every declared output as a bounded regular JSON file under data/.
4. Stage and upload only the complete snapshot; a generator or validation failure prevents upload and stops a dependent build.

**Produces**

- A maps-\<run-id\>-\<run-attempt\> artifact retained for seven days, preserving declared data/ paths.
- The artifact-name output for a dependent same-run download; this workflow does not commit files or publish a site.

[Reviewed source at be211937c3a9](https://github.com/unset-sh/tooling/blob/be211937c3a939cca33d0cac251156392cd61a7e/.github/workflows/automation-maps-refresh.yml).

Source SHA-256: `f5af37ae29d1678d846d3751390b38a2486d6509d6fc1d94419a09ae8962ca86`.

### .github/workflows/automation-org-map.yml

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

### .github/workflows/ci-check.yml

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

#### Additional reviewed version 1

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

### .github/workflows/ci-self.yml

Verify tooling’s implementation and the executable workflows generated from its organised workflow sources.

**What it does**

1. Run the local reusable check workflow, which checks generated workflow files and runs tooling’s test suites.
2. Download the pinned actionlint release and verify its SHA-256.
3. Lint the executable workflow files, suppressing only the two documented job-context fields that the pinned linter does not recognise.

**Produces**

- Check and workflow-lint results; this workflow does not release or publish tooling.

[Reviewed source at 22b6eb497c27](https://github.com/unset-sh/tooling/blob/22b6eb497c2782800523879a89a350c01cf1d2c1/.github/workflows/ci-self.yml).

Source SHA-256: `f8e1112c8042f774f3810bea1989d396dc676ea08027915eb1671515192f430a`.

### .github/workflows/releases-package.yml

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
