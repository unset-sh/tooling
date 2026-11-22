---
title: "Manage a documentation publishing key"
description: "Set up, verify, rotate and retire the credential a source uses to publish its documentation section."
weight: 16
type: docs
params:
  doc_kind: guide
---

Alex owns the credential lifecycle and may explicitly authorize another person or an agent to perform specific
setup, rotation or retirement steps. That authorization does not permit exposing private key material. This guide
uses the `profile-recipes` publisher as the concrete example. Its [source runbook](https://github.com/unset-sh/profile-recipes/blob/1e64c469f86dd2ad6e9b26200d26e308d6d06f4e/.github/DOCS-PUBLISHING.md)
defines the exporter, path checks and recovery behavior; keep those implementation details there.

## Know which credential you are setting up

| Operation | Credential | Where it belongs |
| --- | --- | --- |
| Source pushes its generated `profile-recipes/` section to `unset-sh/docs` | Dedicated SSH deploy key | Public half on `unset-sh/docs`; private half in the source's `docs-mirror` environment |
| Docs builds and publishes its own GitHub Pages site | GitHub's workflow token and OIDC identity, with `pages: write` and `id-token: write` | The docs deployment job and its `github-pages` environment |
| Tooling's [reusable documentation export](https://github.com/unset-sh/tooling/blob/aad4a03c5db3d6d762c59543e1340744a941828a/automation/docs-export.yml), at unreleased version 0.0.0 | Read-only workflow token | The export job; preparing an artifact does not require the source publishing key |

The deploy key is for a Git push across repositories. It is not needed to enable Pages or HTTPS. A write deploy key
grants repository access, not a server-enforced folder boundary; the reviewed publisher checks that it changes only
its section. See [GitHub deploy keys](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
and [Pages workflow permissions](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## 1. Prepare the source environment

Use an authenticated account with Alex's authorization and the required access to both repositories. In **unset-sh/profile-recipes → Settings →
Environments**, create or inspect `docs-mirror`. Under **Deployment branches and tags**, select **Selected branches
and tags** and allow the **branch** `main` only. Preserve the owner's required-reviewer policy. Configure this before
adding the private key; a repository-wide secret would not have this environment boundary.

Confirm that the reviewed publisher requires `refs/heads/main`, uses this environment, validates before key use and
checks out current `main`. The environment and the job guard are separate checks. GitHub documents the
[environment protection and secret rules](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

## 2. Create the key on your Mac

In Terminal, with shell tracing off, create a dedicated key in a new private directory. Keep this Terminal session
open until verification and cleanup; `docs_key_dir` identifies only this new directory.

```sh
docs_key_dir="$(mktemp -d)"
chmod 700 "$docs_key_dir"
ssh-keygen -t ed25519 -N '' -C 'profile-recipes docs-mirror' -f "$docs_key_dir/docs-mirror"
ssh-keygen -lf "$docs_key_dir/docs-mirror.pub"
```

The empty passphrase permits the unattended publisher to use the key. The `.pub` file and its fingerprint are public.
The file without `.pub` is private: do not display it, paste it into a chat, commit it or include it in logs. Use a
separate key per source so access can be retired independently; do not use a personal account key.

## 3. Install each half in the right repository

Copy only the public half to the Mac clipboard:

```sh
pbcopy < "$docs_key_dir/docs-mirror.pub"
```

In **unset-sh/docs → Settings → Deploy keys**, add it with a descriptive title such as **profile-recipes docs-mirror**
and enable **Allow write access**. Record its title, ID and public fingerprint for later rotation. Confirm the target's
rules allow this publisher to push `main`; do not loosen unrelated protections.

Use the authenticated GitHub CLI to put the private half directly into the source environment, without printing it
or placing its contents in command arguments:

```sh
gh secret set DOCS_DEPLOY_KEY --repo unset-sh/profile-recipes --env docs-mirror < "$docs_key_dir/docs-mirror"
```

The result is **public → destination deploy key; private → source environment secret**. Confirm the secret's name and
environment, not its value. GitHub does not return the private key from a saved Actions secret.

An explicitly owner-approved reuse of an existing destination key is an exception: the owner must already possess
its private half. Do not add that public key twice, and do not revoke the shared destination key while the new source
still uses it. Remove the retiring source's secret and every remaining route to that credential instead.

## 4. Verify the first real export

After the reviewed source change reaches `main`, inspect its `docs-mirror` run. If a manual run is needed, select
`main`. A green dry export proves packaging; this check must include the authenticated push.

1. Verify the destination commit changes only `profile-recipes/`, preserving the framework and other sections.
2. Check that `profile-recipes/source.json` names the exact source commit checked by the job. Compare its file hashes
   with the generated files and source bytes; retain the licence notices.
3. Render that section against the reviewed docs framework and inspect the examples and links. Then verify the docs
   build and Pages deployment separately. A successful source push does not establish that the website is live.

Record the run URL, checked source SHA, destination SHA and result in the review. Never record the private key. The
first observed source run on 2026-11-22 is [45041327167](https://github.com/unset-sh/profile-recipes/actions/runs/45041327167),
which pushed [743ebacc](https://github.com/unset-sh/docs/commit/743ebaccb944e766d9759102f409d3bcedd0ca91). The separate
framework cutover completed in [site run 45042839474](https://github.com/unset-sh/docs/actions/runs/45042839474) from
[5033b9b](https://github.com/unset-sh/docs/commit/5033b9b7f2d1a3aade4e024c052aca876046254a), after the old mirror's
write access was retired. The live site was verified over HTTPS with the profile-recipes section at source
`1e64c469f86dd2ad6e9b26200d26e308d6d06f4e`. These are distinct source-publication and website-deployment checks.

## 5. Retire old access before the framework merge

Replacing a mirror requires retiring its write access **before merging the new docs framework**. An old publisher
can replace framework files or restore out-of-scope content if it still holds a writable credential. Deleting its
workflow from current `main` does not remove historical runs: GitHub reruns retain the original event's SHA and ref.
See [GitHub's rerun behavior](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).

Disable the old workflow and cancel its queued, waiting and running jobs. Remove its secret from every applicable
scope, including any organisation-secret access. With a dedicated replacement key, revoke the old target deploy key
after identifying its other uses. With an explicitly reused target key, retain that target key for the new source,
but remove the old source's credential access and confirm no in-flight job retains it.

Verify retirement using workflow state, run state and credential metadata. Do not rerun the old publishing job as a
test. Leave the current working publisher intact, and do not merge the framework while old write access is uncertain.

## Rotate and clean up

For rotation, repeat the key creation and installation steps with a new dedicated key. Replace the source environment
secret, verify a successful run using the replacement, then revoke the previous destination key. Record fingerprints
and results, never secret values. If a key is compromised, revoke it immediately and pause publication until the
replacement is verified.

After verification, remove the temporary local files from the same Terminal session if they are not retained in the
owner's approved secret store:

```sh
: "${docs_key_dir:?Use the original Terminal session}"
rm -- "$docs_key_dir/docs-mirror" "$docs_key_dir/docs-mirror.pub"
rmdir -- "$docs_key_dir"
unset docs_key_dir
```

These commands name only the newly created files. Deleting them does not revoke GitHub access; deleting a deploy key
does. If the private half is later unavailable, generate a replacement rather than trying to retrieve the secret.

## Recover without restoring the old mirror

If setup or rotation fails, pause the new publisher and inspect environment scope, key registration and target rules.
Keep the last successful site deployment serving. Do not expose credentials or substitute a broader token to debug.
For a failed framework cutover, restore the last approved site through the docs repository's reviewed process while
preserving current source provenance. Re-enable the verified publisher after checks pass; do not restore the retired
app mirror or its old write access as an automatic fallback.

The source [publisher](https://github.com/unset-sh/profile-recipes/blob/1e64c469f86dd2ad6e9b26200d26e308d6d06f4e/.github/workflows/docs-mirror.yml)
and [runbook](https://github.com/unset-sh/profile-recipes/blob/1e64c469f86dd2ad6e9b26200d26e308d6d06f4e/.github/DOCS-PUBLISHING.md)
are the checked implementation references. Shared automation now belongs in [unset-sh/tooling](https://github.com/unset-sh/tooling).
Its [artifact exporter](export-docs.md) is separate from this source's authenticated publisher. This guide does not
claim that tooling has released its shared workflows or that `profile-recipes` has adopted them.
