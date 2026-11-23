// What the workflow files promise, checked on their text. Each test names the mistake it would catch.
import assert from "node:assert/strict";
import { test } from "node:test";
import { inputsOf, jobsOf, pinnedBun, readText, runBlocks, SETUP_BUN, topLevel, workflowFiles } from "./repo.mjs";

const REUSABLE = [".github/workflows/ci-check.yml", ".github/workflows/releases-package.yml", ".github/workflows/releases-channel.yml"];
const release = readText(".github/workflows/releases-package.yml");
const releaseJobs = jobsOf(release);

test("the generated workflows include the shared workflows and their callers", () => {
  assert.deepEqual(workflowFiles(), [
    ".github/workflows/automation-docs-export.yml",
    ".github/workflows/automation-docs-import.yml",
    ".github/workflows/automation-docs-map-schedule.yml",
    ".github/workflows/automation-docs-self.yml",
    ".github/workflows/automation-maps-refresh.yml",
    ".github/workflows/automation-org-map.yml",
    ".github/workflows/ci-branch-policy-self.yml",
    ".github/workflows/ci-branch-policy.yml",
    ".github/workflows/ci-check.yml",
    ".github/workflows/ci-pr-policy-self.yml",
    ".github/workflows/ci-pr-policy.yml",
    ".github/workflows/ci-repository-policy-self.yml",
    ".github/workflows/ci-repository-policy.yml",
    ".github/workflows/ci-self.yml",
    ".github/workflows/releases-channel.yml",
    ".github/workflows/releases-package.yml",
    ".github/workflows/releases-self.yml",
  ]);
});

test("every workflow starts from no permissions", () => {
  for (const path of workflowFiles()) {
    assert.match(readText(path), /^permissions: \{\}$/m, `${path} does not start from no permissions`);
  }
});

test("every action is pinned to a full commit, named by its version, and the same everywhere", () => {
  const pins = new Map();
  for (const path of workflowFiles()) {
    for (const [, target, comment] of readText(path).matchAll(/^\s*(?:- )?uses: (\S+)(.*)$/gm)) {
      if (target.startsWith("./")) {
        assert.match(target, /^\.\/\.github\/workflows\/[\w-]+\.yml$/, `${path}: ${target}`);
        continue;
      }
      const match = /^([\w.-]+\/[\w.-]+)@([0-9a-f]{40})$/.exec(target);
      assert.ok(match !== null, `${path}: ${target} is not pinned to a full commit`);
      assert.match(comment, /^ # v\d+\.\d+\.\d+$/, `${path}: ${target} does not name its version`);
      const pin = `${match[2]}${comment}`;
      assert.equal(pins.get(match[1]) ?? pin, pin, `${path}: ${match[1]} is pinned to two different commits`);
      pins.set(match[1], pin);
    }
  }
  assert.ok(pins.size > 0);
});

test("no checkout keeps its token", () => {
  for (const path of workflowFiles()) {
    const text = readText(path);
    const checkouts = [...text.matchAll(/uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n((?:\s+.*\n){0,6})/g)];
    for (const checkout of checkouts) {
      assert.match(checkout[1], /persist-credentials: false/, `${path}: a checkout keeps its token`);
    }
    assert.ok(!/persist-credentials: true/.test(text), `${path} keeps the checkout token`);
  }
});

test("no workflow reads a stored secret or runs with a fork's code and a writing token", () => {
  for (const path of workflowFiles()) {
    const text = readText(path);
    assert.doesNotMatch(text, /\bsecrets\./, `${path} reads a secret`);
    assert.doesNotMatch(text, /secrets: inherit/, `${path} passes every secret on`);
    assert.doesNotMatch(text, /pull_request_target|workflow_run/, `${path} uses a trigger that runs with more rights`);
  }
});

test("no value reaches a shell script except through the environment", () => {
  // An expression inside `run:` is pasted into the script before the shell reads it, so an input holding a
  // quote or a `$(...)` would run as code. Values go through `env:` and are read as "$NAME".
  for (const path of workflowFiles()) {
    for (const block of runBlocks(readText(path))) {
      assert.doesNotMatch(block, /\$\{\{/, `${path}: an expression inside a run script:\n${block}`);
    }
  }
});

test("the shipped workflows can only be called, never started on their own", () => {
  for (const path of [...REUSABLE, ".github/workflows/ci-branch-policy.yml", ".github/workflows/ci-repository-policy.yml", ".github/workflows/automation-docs-export.yml", ".github/workflows/automation-docs-import.yml", ".github/workflows/automation-maps-refresh.yml"]) {
    const on = topLevel(readText(path), "on");
    assert.match(on, /^on:\n {2}workflow_call:\n/, `${path} is not a called workflow`);
    const triggers = on.split("\n").filter((line) => /^ {2}\S/.test(line));
    assert.deepEqual(triggers, ["  workflow_call:"], `${path} has another trigger`);
  }
});

test("a release has three jobs, in order: plan, build, publish", () => {
  assert.deepEqual(Object.keys(releaseJobs), ["plan", "build", "publish"]);
  assert.match(releaseJobs.build, /^ {4}needs: plan$/m);
  assert.match(releaseJobs.build, /^ {4}if: needs\.plan\.outputs\.publish == 'true'$/m);
  assert.match(releaseJobs.publish, /^ {4}needs: \[plan, build\]$/m);
  assert.match(releaseJobs.publish, /^ {4}if: needs\.plan\.outputs\.publish == 'true'$/m);
});

test("the plan refuses any start but a push to main, before anything else", () => {
  const firstStep = releaseJobs.plan.slice(releaseJobs.plan.indexOf("    steps:\n")).split("\n      - ")[1];
  assert.match(firstStep, /^name: A release starts only from a push to main/);
  assert.match(firstStep, /\[ "\$EVENT" != push \] \|\| \[ "\$REF" != refs\/heads\/main \]/);
  assert.match(firstStep, /exit 1/);
});

test("the plan checks the release environment, the package and the changelog before anything is built", () => {
  assert.match(releaseJobs.plan, /bun workflows\/scripts\/release-gate\.mjs/);
  assert.match(releaseJobs.plan, /^ {10}name="\$\(bun workflows\/scripts\/release-manifest\.mjs repository\/package\.json --npm-package --name\)"$/m);
  assert.match(releaseJobs.plan, /bun workflows\/scripts\/release-notes\.mjs repository\/CHANGELOG\.md/);
});

test("every workflow runs on the exact Bun it names, with no Node and no npm command", () => {
  // The branch policy has no checkout to read a version file from, so it names the version itself, which is
  // held to this repository's .bun-version.
  const version = readText(".bun-version").trim();
  for (const path of workflowFiles()) {
    const text = readText(path);
    assert.doesNotMatch(text, /actions\/setup-node@|node-version|\.nvmrc|shell: node|\bnpm (ci|install|run|pack|publish|exec)\b|\bnpx\b/, path);
    const setups = [...text.matchAll(/^( *)- uses: oven-sh\/setup-bun@[^\n]*\n(?:\1 {2}.*\n)+/gm)];
    for (const [step, indent] of setups) {
      const file = /bun-version-file: (\S+)/.exec(step);
      if (file !== null) {
        assert.ok(text.includes(pinnedBun(file[1], indent.length)), `${path}: setup-bun for ${file[1]} is not followed by the version check`);
      } else {
        assert.equal(path, ".github/workflows/ci-branch-policy.yml", `${path}: setup-bun names no version file`);
        assert.match(step, new RegExp(`bun-version: ${version.replaceAll(".", "\\.")}\n`), path);
        assert.match(text, new RegExp(`run: test "\\$\\(bun --version\\)" = ${version.replaceAll(".", "\\.")}\n`), path);
      }
      assert.match(step, /no-cache: true/, path);
      assert.match(step, /token: ""/, path);
    }
    const uses = [...text.matchAll(/oven-sh\/setup-bun@\S+/g)].map(([use]) => use);
    for (const use of uses) assert.equal(`${use} # v2.2.0`, SETUP_BUN, path);
    assert.equal(uses.length, setups.length, path);
    if (/\bbun /.test(text)) assert.ok(setups.length > 0 || /uses: \.\/\.github\/workflows\//.test(text), `${path} runs Bun without installing it`);
  }
});

test("no step hides a failed command inside an echo", () => {
  // `echo "x=$(command)"` succeeds when the command fails, so a check written that way would pass on a refusal.
  for (const path of workflowFiles()) {
    for (const block of runBlocks(readText(path))) {
      for (const line of block.split("\n")) {
        if (/^\s*#/.test(line)) continue;
        assert.doesNotMatch(line, /\becho\b.*\$\((?:bun|node|git|gh|npm) /, `${path}: ${line.trim()}`);
      }
    }
  }
});

test("a tag is looked up by its whole name, in the plan and again before publishing", () => {
  // `git ls-remote <pattern>` also matches a longer name that ends the same way, such as x/refs/tags/v1.2.3.
  assert.doesNotMatch(release, /ls-remote --exit-code/);
  assert.match(releaseJobs.plan, /if \[ "\$ref" = "refs\/tags\/v\$version" \]; then tagged=true; fi/);
  assert.match(releaseJobs.publish, /if \[ "\$ref" = "refs\/tags\/v\$VERSION" \]; then\n\s+echo "::error::[^\n]*\n\s+exit 1/);
  assert.match(releaseJobs.publish, /gh api "repos\/\$GH_REPO\/commits\/tags\/v\$VERSION"/);
});

test("a release this run did not make stops the run when this push raised the version", () => {
  const plan = releaseJobs.plan;
  assert.match(plan, /BEFORE: \$\{\{ github\.event\.before \}\}/);
  assert.match(plan, /if \[ "\$previous" != "\$version" \]; then\n\s+echo "::error::[^\n]*\n\s+exit 1/);
  assert.ok(plan.indexOf('if [ "$previous" != "$version" ]') < plan.indexOf("is already released; nothing to do."), "the quiet path comes first");
});

test("only the publish job can write, and only it waits on the release environment", () => {
  for (const [name, job] of Object.entries(releaseJobs)) {
    if (name === "publish") continue;
    assert.doesNotMatch(job, /: write/, `${name} can write`);
    assert.doesNotMatch(job, /^\s*environment:/m, `${name} names an environment`);
  }
  assert.match(releaseJobs.publish, /^ {4}environment: release$/m);
  const permissions = releaseJobs.publish.slice(releaseJobs.publish.indexOf("    permissions:\n"), releaseJobs.publish.indexOf("    outputs:\n"));
  const granted = [...permissions.matchAll(/^ {6}([\w-]+): (\w+)/gm)].map(([, scope, level]) => `${scope}: ${level}`);
  assert.deepEqual(granted, ["contents: write", "packages: write", "id-token: write", "attestations: write", "actions: read"]);
});

test("the publish job reads the release environment again before it touches what was built", () => {
  // The wait for approval can last days, and "Re-run failed jobs" starts publish without plan.
  const publish = releaseJobs.publish;
  const gate = publish.indexOf("bun workflows/scripts/release-gate.mjs");
  assert.ok(gate !== -1, "publish does not check the environment");
  assert.ok(gate < publish.indexOf("actions/download-artifact@"), "publish downloads before it checks the environment");
});

test("a packed package is read again in the publish job, before it is attested or published", () => {
  // bun publish takes settings from the package.json inside the file it publishes, and the build job made that file.
  const publish = releaseJobs.publish;
  const check = publish.indexOf('bun workflows/scripts/release-package.mjs "release/files/$package" "$NAME" "$VERSION"');
  assert.ok(check !== -1, "publish does not read the packed package");
  assert.ok(check < publish.indexOf("actions/attest@"), "the package is attested before it is read");
  assert.match(publish, /NAME: \$\{\{ needs\.plan\.outputs\.name \}\}\n\s+VERSION: \$\{\{ needs\.plan\.outputs\.version \}\}/);
  assert.match(releaseJobs.plan, /^ {6}name: \$\{\{ steps\.package\.outputs\.name \}\}$/m);
  // Bun starts in a folder that holds that one file, named whole, and a package.json of `{}`: no glob, no
  // other release file or settings file beside it. HOME is that folder, so no settings file of the runner's
  // is read either, and it starts with three names in its environment and nothing else of the job's.
  assert.match(publish, /folder="\$\(mktemp -d\)"\n\s+cp "release\/files\/\$package" "\$folder\/"\n\s+printf '\{\}\\n' > "\$folder\/package\.json"\n\s+cd "\$folder"\n\s+env -i PATH="\$PATH" HOME="\$folder" NPM_CONFIG_TOKEN="\$NPM_CONFIG_TOKEN" \\\n\s+bun publish --ignore-scripts --registry https:\/\/npm\.pkg\.github\.com "\.\/\$package"\n/);
  assert.equal(publish.match(/bun publish/g).length, 1, "Bun publishes in one place");
  assert.match(publish, /^ {10}NPM_CONFIG_TOKEN: \$\{\{ github\.token \}\}$/m);
  // The build job makes the same check right after packing, so a refusal comes before the approval.
  assert.match(releaseJobs.build, /bun pm pack --ignore-scripts [^\n]*\n\s+bun \.\.\/workflows\/scripts\/release-package\.mjs "\$RUNNER_TEMP\/release\/files"\/\*\.tgz "\$NAME" "\$VERSION"\n/);
  assert.doesNotMatch(publish, /working-directory:/);
});

test("the publish job runs none of the calling repository's code", () => {
  const publish = releaseJobs.publish;
  assert.doesNotMatch(publish, /inputs\.(check|build|files|install)/, "publish reads an input that names a command or a path");
  assert.doesNotMatch(publish, /COMMAND/, "publish runs a passed-in command");
  assert.doesNotMatch(publish, /working-directory: repository|path: repository/, "publish checks out or enters the calling repository");
  const checkouts = [...publish.matchAll(/uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n((?:\s+.*\n){0,6})/g)];
  assert.equal(checkouts.length, 1);
  assert.match(checkouts[0][1], /repository: \$\{\{ job\.workflow_repository \}\}\n\s+ref: \$\{\{ job\.workflow_sha \}\}/);
  assert.match(publish, /bun publish --ignore-scripts /);
});

test("every job takes its scripts from this repository at the commit the workflow runs from", () => {
  for (const [name, job] of Object.entries(releaseJobs)) {
    assert.match(job, /repository: \$\{\{ job\.workflow_repository \}\}\n\s+ref: \$\{\{ job\.workflow_sha \}\}\n\s+path: workflows\n/, name);
  }
});

test("every job stops before any checkout when it cannot tell where its scripts are", () => {
  // An empty repository or ref makes actions/checkout fall back to the calling repository, whose files
  // would then stand in for the scripts, in the publish job with a token that can write.
  for (const [name, job] of Object.entries(releaseJobs)) {
    const guard = job.indexOf('if [ "$WORKFLOW_REPOSITORY" != unset-sh/tooling ] || ! [[ "$WORKFLOW_SHA" =~ ^[0-9a-f]{40}$ ]]; then');
    assert.ok(guard !== -1, `${name} does not check where it runs from`);
    assert.ok(guard < job.indexOf("uses: actions/checkout@"), `${name} checks out before it checks where it runs from`);
    assert.match(job.slice(guard), /^[^\n]*\n[^\n]*\n\s+exit 1\n/, `${name} does not stop`);
  }
});

test("the workflow creates its own tag at the commit it built, and refuses one that already exists", () => {
  const publish = releaseJobs.publish;
  assert.match(publish, /gh release create "v\$VERSION" "\$\{assets\[@\]\}" \\\n\s+--target "\$GITHUB_SHA"/);
  assert.doesNotMatch(release, /--verify-tag/);
  const order = ["The release environment is still the owner's", "Exactly what was built", "The packed package is the one main describes", "The tag does not exist yet", "actions/attest@", "bun publish", "gh release create", "The published tag points at this commit"];
  const positions = order.map((marker) => publish.indexOf(marker));
  assert.ok(positions.every((position) => position !== -1), `a publish step is missing: ${positions}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "the publish steps are out of order");
});

test("every file that is published is attested first, and nothing is attested when nothing is attached", () => {
  const attest = /      - uses: actions\/attest@[0-9a-f]{40}[^\n]*\n((?: {8}.*\n)+)/.exec(releaseJobs.publish);
  assert.ok(attest !== null, "the attest step is missing");
  assert.equal(attest[1], "        if: steps.files.outputs.count != '0'\n        with:\n          subject-path: release/files/*\n");
});

test("the verify command a run prints names this file as the signer, written out", () => {
  // Built from job.workflow_file_path it would print no file at all if that context were ever empty.
  assert.match(releaseJobs.publish, /echo " {2}--signer-workflow unset-sh\/tooling\/\.github\/workflows\/releases-package\.yml \\\\"/);
  assert.doesNotMatch(release, /workflow_file_path \}\}/);
  assert.ok(workflowFiles().includes(".github/workflows/releases-package.yml"));
});

test("this repository checks and releases itself through the workflows it ships", () => {
  const ci = readText(".github/workflows/ci-self.yml");
  assert.match(jobsOf(ci).check, /^ {4}uses: \.\/\.github\/workflows\/ci-check\.yml$/m);
  const self = readText(".github/workflows/releases-self.yml");
  assert.match(jobsOf(self).release, /^ {4}uses: \.\/\.github\/workflows\/releases-package\.yml$/m);
  // The workflow files are attached, so each release here carries an attestation a caller can verify.
  assert.match(jobsOf(self).release, /^ {4}with:\n {6}files: \.github\/workflows$/m);
  assert.equal(topLevel(self, "on"), "on:\n  push:\n    branches: [main]\n    paths: [package.json]\n");
  assert.match(self, /^concurrency:\n {2}group: release\n {2}cancel-in-progress: false$/m);
});

test("the public guides name every input of the shipped workflows", () => {
  const readme = readText("docs/use-workflows.md") + readText("docs/release-reference.md");
  for (const path of REUSABLE) {
    const inputs = inputsOf(readText(path));
    assert.ok(inputs.length > 0, `${path} declares no inputs`);
    for (const input of inputs) assert.ok(readme.includes(`\`${input}\``), `Public guides do not describe ${path}'s input ${input}`);
  }
});

test("the release reference shows callers the same permissions the release workflow asks for", () => {
  const readme = readText("docs/release-reference.md");
  for (const scope of ["contents: write", "packages: write", "id-token: write", "attestations: write", "actions: read"]) {
    assert.ok(readme.includes(scope), `Release reference does not show ${scope}`);
  }
});

test("the check runs Postgres only from an image pinned by digest, and points the check at it", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const text = readText(".github/workflows/ci-check.yml");
  // GitHub starts no service whose image is empty, so the default caller gets no database.
  assert.match(inputsOf(text).join(","), /postgres-image/);
  assert.match(text, /^ {6}postgres:\n {8}image: \$\{\{ inputs\.postgres-image \}\}$/m);
  assert.match(text, /^ {10}- 127\.0\.0\.1:5432:5432$/m, "the database is published on the runner's loopback only");
  const step = text.slice(text.indexOf("- name: The Postgres image is pinned by digest"));
  assert.match(step, /^ {8}if: inputs\.postgres-image != ''$/m);
  const script = runBlocks(step)[0];
  const digest = "a".repeat(64);
  const run = (image) => {
    const dir = mkdtempSync(join(tmpdir(), "pg-image-"));
    try {
      const env = join(dir, "env");
      const result = spawnSync("bash", ["-eo", "pipefail", "-c", script], {
        env: { PATH: process.env.PATH, POSTGRES_IMAGE: image, GITHUB_ENV: env }, encoding: "utf8",
      });
      let written = "";
      try { written = readFileSync(env, "utf8"); } catch {}
      return { status: result.status, written };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  for (const image of [`postgres:18.1@sha256:${digest}`, `docker.io/library/postgres:18-alpine@sha256:${digest}`]) {
    const { status, written } = run(image);
    assert.equal(status, 0, image);
    assert.equal(written, "PGHOST=127.0.0.1\nPGPORT=5432\nPGUSER=postgres\nPGDATABASE=postgres\n");
  }
  for (const image of ["postgres:18", "postgres:latest", `postgres@sha256:${digest}`, `evil/postgres:18@sha256:${digest}`,
    `postgres:18@sha256:${"A".repeat(64)}`, `postgres:18@sha256:${digest}\nPGHOST=evil`, `postgres:18@sha256:${digest} `]) {
    const { status, written } = run(image);
    assert.notEqual(status, 0, JSON.stringify(image));
    assert.equal(written, "", JSON.stringify(image));
  }
});
