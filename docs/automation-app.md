---
title: "Set up the automation App"
description: "Owner-managed credentials and activation prerequisites for generated documentation and map pull requests."
weight: 17
type: docs
params:
  doc_kind: guide
  checked_source_revision: "f79febcdb09e51a5e7b2ca29bca430726799418a"
---

The organisation's private `unset-sh-automation` GitHub App publishes generated documentation and organisation-map pull requests. Its installation token lets the ordinary PR workflows start without the job-token approval restriction. It never merges, administers repositories or writes check results.

## Owner setup

The owner performs these steps in the [organisation App settings](https://github.com/organizations/unset-sh/settings/apps/unset-sh-automation). The [organisation key rule](https://github.com/unset-sh/agent-kit/blob/main/rules/org.md) states: “Assistants never create, read, copy, place or rotate a deploy key, a private key or a token that can write.” Agents may verify public identity and repository settings, but must never generate, read, download, copy or place a private key. Do not paste a key into a chat, issue, source file or log.

1. Register the private organisation App with Contents **read and write**, Pull requests **read and write**, and the required Metadata **read** permission. Grant no Actions, Checks, Administration, Issues or workflow-file permission. No webhook events are needed.
2. Install it only on `unset-sh/docs` and `unset-sh/.github`. Review the public App ID, client ID, slug, bot user ID and installation ID. Commit those verified public values in `scripts/automation-app.json` through the normal review process. An absent or invalid identity keeps publication disabled.
3. Generate the private key manually in the App settings. Store it as the Actions repository secret `UNSET_AUTOMATION_APP_PRIVATE_KEY` in each of the two selected repositories. Keep it out of tooling, source-export jobs and local worktrees. The reusable callers explicitly map that secret to `automation-app-private-key`.
4. Complete the owner-managed main-only cutover for docs and `.github` before enabling their new callers. Resolve existing staging PRs, promote the reviewed state, and apply the approved default-branch/ruleset changes. The App migration does not perform these steps or adopt the old docs PR10.
5. Merge the reviewed central implementation, pin each consumer to its full commit, and run the consumer checks. Perform one approved publication run for each capability. Confirm the PR author is the fixed App bot, its diff contains only the allowed generated content, and ordinary `pull_request` runs supply the required PR-visible checks. Review and merge remain human actions.

The public App identity is not a credential. A later installation or App identity change requires an explicit reviewed configuration update. Do not replace a missing identity with a fixture value or widen token scope to make a run pass.

## Credential boundary

Only the isolated publisher loads the key into the pinned [create-github-app-token action](https://github.com/actions/create-github-app-token/tree/64ab729a6294000f5aa4a4bc0b73d1f32bc45510). Each invocation requests exactly one target repository and Contents/Pull requests write. The built-in job token remains read-only. The shared helper checks the returned public identity and requires the token's repository list to match that single target.

Source preparation executes pinned central validators with read-only access; source files and artifacts remain data. No consumer command runs with the App token. The token action attempts revocation after the job; the installation token normally expires within one hour if cleanup fails. The owner handles key rotation and secret replacement manually.

GitHub documents independent App tokens as the route for [automatic PR workflows](https://docs.github.com/en/actions/concepts/security/github_token#when-github_token-triggers-workflow-runs). Matching successful `workflow_dispatch` jobs do not satisfy [PR ruleset check eligibility](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#checks-from-some-workflow-jobs-are-not-evaluated). Do not approve withheld runs automatically, manufacture statuses or weaken protections as a substitute.

Alex owns this guide. Review it with the publisher implementation and each App permission or credential change.

The reviewed [identity verifier](https://github.com/unset-sh/tooling/blob/f79febcdb09e51a5e7b2ca29bca430726799418a/scripts/automation-app.mjs) and [publisher workflow](https://github.com/unset-sh/tooling/blob/f79febcdb09e51a5e7b2ca29bca430726799418a/workflows/shared/docs/import.yml) enforce this boundary.
