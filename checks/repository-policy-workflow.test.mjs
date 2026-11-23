import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { BUN_VERSION_CHECK, jobsOf, pinnedBun, readText, runBlocks } from "./repo.mjs";

const workflow = readText(".github/workflows/ci-repository-policy.yml");
const job = jobsOf(workflow).policy;
test("repository policy is one stable read-only job without consumer execution or stored secrets", () => {
  assert.deepEqual(Object.keys(jobsOf(workflow)), ["policy"]);
  assert.match(job, /^ {4}name: Repository policy$/m);
  assert.match(job, /^ {4}permissions:\n {6}contents: read$/m);
  assert.doesNotMatch(workflow, /: write|secrets\.|secrets:|environment:|npm (ci|install)|bun (install|add)|run: .*sync\.mjs|continue-on-error/);
  assert.ok(job.includes(pinnedBun("tooling/.bun-version")), "Bun comes from the helper checkout's exact version");
  assert.match(job, /repository: \$\{\{ github\.repository \}\}\n {10}ref: \$\{\{ github\.sha \}\}\n {10}path: source\n {10}persist-credentials: false/);
  assert.match(job, /repository: \$\{\{ job\.workflow_repository \}\}\n {10}ref: \$\{\{ job\.workflow_sha \}\}\n {10}path: tooling\n {10}persist-credentials: false/);
  assert.match(job, /bun tooling\/scripts\/repository-policy\.mjs --root "\$GITHUB_WORKSPACE\/source" --revision "\$SOURCE_SHA" --repository "\$SOURCE_REPOSITORY" --scanner "\$RUNNER_TEMP\/repository-policy-tools\/zizmor"/);
});
test("central helper identity is checked before checkout and scanner installation uses a fixed archive checksum", () => {
  const [guard, version, install] = runBlocks(job);
  assert.equal(version, BUN_VERSION_CHECK);
  assert.ok(job.indexOf(guard) < job.indexOf("uses: actions/checkout@"));
  for (const [repository, sha, expected] of [["unset-sh/tooling", "a".repeat(40), 0], ["unset-sh/elsewhere", "a".repeat(40), 1], ["unset-sh/tooling", "staging", 1], ["unset-sh/tooling", `${"a".repeat(40)}\n`, 1]]) {
    assert.equal(spawnSync("bash", ["-eo", "pipefail", "-c", guard], { env: { PATH: process.env.PATH, WORKFLOW_REPOSITORY: repository, WORKFLOW_SHA: sha } }).status, expected);
  }
  assert.match(install, /https:\/\/github\.com\/zizmorcore\/zizmor\/releases\/download\/v1\.32\.0\/zizmor-x86_64-unknown-linux-gnu\.tar\.gz/);
  assert.match(install, /bb110cc765eca9cd7efb2e284a956be5974c60027b0970f16397d86208a9957b {2}zizmor\.tar\.gz/);
  assert.ok(install.indexOf("sha256sum --check --strict") < install.indexOf("tar --extract"));
  assert.match(install, /--max-time 120/);
});
test("tooling opts in without path filters and its explicit config has no policy bypasses", () => {
  const caller = readText(".github/workflows/ci-repository-policy-self.yml");
  assert.match(caller, /pull_request:\n {2}push:\n {4}branches: \[staging, main\]/);
  assert.doesNotMatch(caller, /paths:|if:/);
  assert.match(caller, /uses: \.\/\.github\/workflows\/ci-repository-policy.yml/);
  const config = JSON.parse(readText(".github/repository-policy.json"));
  assert.deepEqual(config.exceptions, []);
  assert.deepEqual(config.dependencyManifests, ["package.json"]);
});
