// What the staging image workflow promises, checked on its text and by running its guard scripts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inputsOf, jobsOf, readText, runBlocks, topLevel } from "./repo.mjs";

const PATH = ".github/workflows/image-staging.yml";
const workflow = readText(PATH);
const jobs = jobsOf(workflow);

/** The steps of a job, split where each step starts. */
const steps = (job) => job.slice(job.indexOf("    steps:\n")).split("\n      - ").slice(1);
const granted = (job) => {
  const block = /^ {4}permissions:\n((?: {6}.*\n)+)/m.exec(job)?.[1] ?? "";
  return [...block.matchAll(/^ {6}([\w-]+): (\w+)/gm)].map(([, scope, level]) => `${scope}: ${level}`);
};

test("the workflow can only be called, and its inputs leave the registry path out", () => {
  assert.equal(topLevel(workflow, "on").split("\n").filter((line) => /^ {2}\S/.test(line)).join(), "  workflow_call:");
  assert.deepEqual(inputsOf(workflow), ["context", "dockerfile", "platform", "read-packages", "timeout-minutes"]);
  assert.match(workflow, /^permissions: \{\}$/m);
});

test("two jobs: build holds a read-only token, and publish, after it, holds exactly the approved permissions", () => {
  assert.deepEqual(Object.keys(jobs), ["build", "publish"]);
  assert.deepEqual(granted(jobs.build), ["contents: read", "packages: read"]);
  assert.doesNotMatch(jobs.build, /: write/);
  assert.match(jobs.publish, /^ {4}needs: build$/m);
  assert.doesNotMatch(jobs.publish, /^ {4}if:/m, "publish runs only when build succeeded");
  assert.deepEqual(granted(jobs.publish), ["contents: read", "packages: write", "id-token: write", "attestations: write"]);
  assert.doesNotMatch(workflow, /^\s*environment:/m);
});

test("the publish job runs none of the calling repository's code", () => {
  const publish = jobs.publish;
  assert.doesNotMatch(publish, /inputs\.(context|dockerfile)/, "publish reads an input that names a path of the repository");
  assert.doesNotMatch(publish, /path: repository|working-directory:|docker (buildx|build|run)/);
  const checkouts = [...publish.matchAll(/uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n((?:\s+.*\n){0,6})/g)];
  assert.equal(checkouts.length, 1);
  assert.match(checkouts[0][1], /repository: \$\{\{ job\.workflow_repository \}\}\n\s+ref: \$\{\{ job\.workflow_sha \}\}\n\s+path: workflows\n/);
});

test("each job refuses a foreign start, then checks where its scripts are, before any checkout", () => {
  for (const [name, job] of Object.entries(jobs)) {
    const [first, second] = steps(job);
    assert.match(first, /^name: An image is (built|pushed) only from a push to staging in the organisation/, name);
    assert.match(second, /^name: This workflow knows where its own scripts are/, name);
    assert.ok(job.indexOf("uses: actions/checkout@") > job.indexOf(second), name);
    assert.match(second, /if \[ "\$WORKFLOW_REPOSITORY" != unset-sh\/tooling \] \|\| ! \[\[ "\$WORKFLOW_SHA" =~ \^\[0-9a-f\]\{40\}\$ \]\]; then\n[^\n]*\n\s+exit 1\n/, name);
  }
});

/** Runs the first step's script with the given context, returning its status and what it wrote as outputs. */
function guard(job, values) {
  const script = runBlocks(steps(job)[0])[0];
  const dir = mkdtempSync(join(tmpdir(), "image-guard-"));
  try {
    const output = join(dir, "output");
    const env = { PATH: process.env.PATH, GITHUB_OUTPUT: output, EVENT: "push", REF: "refs/heads/staging", OWNER: "unset-sh", REPOSITORY: "unset-sh/backend", PLATFORM: "linux/amd64", ...values };
    const result = spawnSync("bash", ["-eo", "pipefail", "-c", script], { env, encoding: "utf8" });
    let written = "";
    try { written = readFileSync(output, "utf8"); } catch {}
    return { status: result.status, written };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("only a push to staging of a plainly named unset-sh repository builds or pushes, and the path says staging", () => {
  for (const job of [jobs.build, jobs.publish]) {
    assert.equal(guard(job, {}).status, 0);
    for (const values of [{ EVENT: "pull_request" }, { EVENT: "workflow_dispatch" }, { REF: "refs/heads/main" }, { REF: "refs/tags/staging" },
      { REF: "refs/heads/staging-x" }, { OWNER: "someone" }, { REPOSITORY: "someone/backend" }, { REPOSITORY: "unset-sh/Backend" },
      { REPOSITORY: "unset-sh/back.end" }, { REPOSITORY: "unset-sh/back_end" }, { REPOSITORY: "unset-sh/-backend" }, { REPOSITORY: "unset-sh/" },
      { REPOSITORY: "unset-sh/a/b" }, { REPOSITORY: "unset-sh/backend\nx" }]) {
      const { status, written } = guard(job, values);
      assert.notEqual(status, 0, JSON.stringify(values));
      assert.equal(written, "", JSON.stringify(values));
    }
  }
  for (const platform of ["linux/arm64"]) assert.equal(guard(jobs.build, { PLATFORM: platform }).status, 0);
  for (const platform of ["", "linux/arm/v7", "windows/amd64", "linux/amd64 "]) assert.notEqual(guard(jobs.build, { PLATFORM: platform }).status, 0);
  assert.equal(guard(jobs.publish, { REPOSITORY: "unset-sh/web-2" }).written, "repository=ghcr.io/unset-sh/staging/web-2\n");
});

test("nothing is tagged, nothing is pushed from the build, and no path outside staging is written", () => {
  for (const block of runBlocks(workflow)) {
    assert.doesNotMatch(block, /--push|push=true|type=image|type=registry|docker push|crane (tag|copy|cp|mutate|append)|--tag\b| -t /, block);
    for (const [reference] of block.matchAll(/ghcr\.io\/\S*/g)) {
      assert.match(reference, /^ghcr\.io\/unset-sh\/staging\/\$\{REPOSITORY#unset-sh\/\}"$|^ghcr\.io$/, block);
    }
  }
  assert.doesNotMatch(workflow, /:latest|staging-\$\{\{|staging-<sha>/);
  assert.match(jobs.publish, /"\$crane" push "\$RUNNER_TEMP\/image" "\$REPOSITORY@\$DIGEST" --image-refs /);
});

test("the build checks the Dockerfile before it builds, with a pinned BuildKit, no cache and no BuildKit attestations", () => {
  const build = jobs.build;
  assert.match(build, /- name: Check out the repository at the pushed commit\n\s+uses: actions\/checkout@\S+ # v\S+\n\s+with:\n\s+ref: \$\{\{ github\.sha \}\}\n/);
  const check = build.indexOf("bun workflows/scripts/image-staging.mjs dockerfile repository");
  assert.ok(check !== -1 && check < build.indexOf("docker buildx build"));
  assert.match(build, /BUILDKIT_IMAGE: moby\/buildkit:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}\n/);
  assert.match(build, /--driver docker-container --driver-opt "image=\$BUILDKIT_IMAGE"/);
  for (const flag of ["--no-cache", "--provenance=false", "--sbom=false", '--output "type=oci,dest=$out,tar=false,rewrite-timestamp=true"']) {
    assert.ok(build.includes(flag), flag);
  }
  assert.doesNotMatch(build, /--build-arg|--ssh|--cache-from|--cache-to|--build-context|--allow/);
  // One secret, the package token, and only when the caller asked for it.
  assert.equal(build.match(/--secret/g)?.length, 1);
  assert.ok(build.includes('if [ -n "$PACKAGES_TOKEN" ]; then secret=(--secret id=github_packages_token,env=PACKAGES_TOKEN); fi'));
  assert.ok(build.includes("PACKAGES_TOKEN: ${{ inputs.read-packages && github.token || '' }}"));
  assert.equal(build.match(/github\.token/g)?.length, 1, "the token reaches only the build step, and only by that line");
  assert.match(build, /SOURCE_DATE_EPOCH: \$\{\{ steps\.labels\.outputs\.epoch \}\}/);
  for (const label of ["source=$GITHUB_SERVER_URL/$GITHUB_REPOSITORY", "revision=$GITHUB_SHA", "licenses=$LICENSE"]) {
    assert.ok(build.includes(`--label "org.opencontainers.image.${label}"`), label);
  }
  assert.match(build, /name: image-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}\n/);
});

test("the publish job checks the download, installs a checksummed crane, then pushes, reads back, attests and signs out", () => {
  const publish = jobs.publish;
  const order = ["actions/download-artifact@", "image-staging.mjs layout", 'if [ "$digest" != "$BUILT" ]', "sha256sum --check --strict",
    "docker login ghcr.io", '"$crane" push', '"$crane" manifest', 'if [ "$stored" != "$DIGEST" ]', "actions/attest@", "docker logout ghcr.io"];
  const positions = order.map((marker) => publish.indexOf(marker));
  assert.ok(positions.every((position) => position !== -1), `a publish step is missing: ${positions}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "the publish steps are out of order");
  assert.match(publish, /BUILT: \$\{\{ needs\.build\.outputs\.digest \}\}/);
  assert.match(publish, /CRANE_URL: https:\/\/github\.com\/google\/go-containerregistry\/releases\/download\/v\d+\.\d+\.\d+\/go-containerregistry_Linux_x86_64\.tar\.gz\n\s+CRANE_SHA256: [0-9a-f]{64}\n/);
  assert.match(publish, /--password-stdin <<< "\$TOKEN"/, "the token is never an argument");
  assert.match(publish, /- name: Sign out of ghcr.io\n\s+if: always\(\)\n/);
  const attest = /      - uses: actions\/attest@[0-9a-f]{40}[^\n]*\n((?: {8}.*\n)+)/.exec(publish);
  assert.ok(attest !== null);
  assert.match(attest[1], /subject-name: \$\{\{ steps\.image\.outputs\.repository \}\}\n/);
  assert.match(attest[1], /subject-digest: \$\{\{ steps\.pushed\.outputs\.digest \}\}\n/);
  assert.match(attest[1], /push-to-registry: true\n/);
  assert.match(attest[1], /create-storage-record: false\n/);
  assert.match(publish, /echo " {2}--signer-workflow unset-sh\/tooling\/\.github\/workflows\/image-staging\.yml \\\\"/);
  assert.match(publish, /echo " {2}--source-ref refs\/heads\/staging \\\\"/);
});
