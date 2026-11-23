import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { runBlocks } from "./repo.mjs";

const workflow = new URL("../workflows/shared/ci/branch-policy.yml", import.meta.url);
const repository = "unset-sh/example";

function pullRequest(base = "staging", head = "feature", headRepository = repository) {
  return { repository: { full_name: repository }, pull_request: {
    base: { ref: base, repo: { full_name: repository } },
    head: { ref: head, repo: { full_name: headRepository } },
  } };
}

function run(t, event, eventName = "pull_request", flow = "staged") {
  assert.ok(existsSync(workflow), "the reusable branch-policy workflow must exist");
  const [version, ...scripts] = runBlocks(readFileSync(workflow, "utf8"));
  assert.equal(version, 'test "$(bun --version)" = 1.4.4', "the policy runs on the pinned Bun, not the runner's latest");
  assert.ok(scripts[0].includes("const { readFileSync }"), "exercise the complete ordinary PR policy check");
  const folder = mkdtempSync(join(tmpdir(), "branch-policy-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const eventPath = join(folder, "event.json");
  writeFileSync(eventPath, typeof event === "string" ? event : JSON.stringify(event));
  // GitHub writes the step to a file and runs `bun {0}` on it, as this does.
  const script = join(folder, "policy");
  writeFileSync(script, scripts[0]);
  return spawnSync(process.execPath, [script], {
    cwd: folder, encoding: "utf8", env: {
      GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: eventName, GITHUB_REPOSITORY: repository,
      ...(flow === null ? {} : { FLOW: flow }),
    },
  });
}

test("feature work and fork contributions can target staging", (t) => {
  for (const headRepository of [repository, "contributor/example"]) {
    const result = run(t, pullRequest("staging", "feature", headRepository));
    assert.equal(result.status, 0, result.stderr);
  }
});

test("only same-repository staging can promote to main", (t) => {
  const accepted = run(t, pullRequest("main", "staging"));
  assert.equal(accepted.status, 0, accepted.stderr);
  for (const event of [pullRequest("main", "feature"), pullRequest("main", "staging", "contributor/example")]) {
    const result = run(t, event);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /same-repository staging/);
  }
});

test("the policy step reads its flow only from the workflow input, defaulting to staged", () => {
  const yaml = readFileSync(workflow, "utf8");
  assert.match(yaml, /\n      flow:\n(?:        #.*\n)*        type: string\n        default: staged\n/);
  assert.match(yaml, /\n        env:\n          FLOW: \$\{\{ inputs\.flow \}\}\n/);
});

test("main flow accepts feature, fork and staging heads into main only", (t) => {
  for (const [head, headRepository] of [["feature", repository], ["feature", "contributor/example"], ["staging", repository]]) {
    const result = run(t, pullRequest("main", head, headRepository), "pull_request", "main");
    assert.equal(result.status, 0, result.stderr);
  }
  for (const base of ["staging", "master", "release"]) {
    const result = run(t, pullRequest(base), "pull_request", "main");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must target main/);
  }
  assert.equal(run(t, pullRequest("main"), "push", "main").status, 1);
});

test("a missing or unknown flow fails closed", (t) => {
  for (const flow of [null, "", "Main", "staged ", "release"]) {
    for (const event of [pullRequest("staging"), pullRequest("main", "staging")]) {
      const result = run(t, event, "pull_request", flow);
      assert.equal(result.status, 1, String(flow));
      assert.match(result.stderr, /Unknown branch flow/);
    }
  }
});

test("unsupported PR bases and non-PR events cannot satisfy the check", (t) => {
  assert.equal(run(t, pullRequest("master")).status, 1);
  assert.equal(run(t, pullRequest("release")).status, 1);
  assert.equal(run(t, pullRequest(), "push").status, 1);
  assert.equal(run(t, pullRequest(), "pull_request_target").status, 1);
});

test("missing, malformed or mismatched PR metadata fails closed", (t) => {
  const invalid = [null, {}, "{", { repository: { full_name: repository } }];
  for (const field of ["base", "head"]) {
    for (const value of [null, {}, { ref: "staging" }, { ref: 5, repo: { full_name: repository } }]) {
      const event = pullRequest();
      event.pull_request[field] = value;
      invalid.push(event);
    }
  }
  const wrongBase = pullRequest();
  wrongBase.pull_request.base.repo.full_name = "other/example";
  invalid.push(wrongBase);
  const wrongRepository = pullRequest();
  wrongRepository.repository.full_name = "other/example";
  invalid.push(wrongRepository);
  for (const event of invalid) assert.equal(run(t, event).status, 1, JSON.stringify(event));
});

test("branch metadata is data, not executable shell text", (t) => {
  const result = run(t, pullRequest("staging", "$(exit 77);`exit 78`"));
  assert.equal(result.status, 0, result.stderr);
});

test("the anonymous dispatch loader refuses foreign identity before Git or any checkout", (t) => {
  const script = runBlocks(readFileSync(workflow, "utf8"))[2];
  const root = mkdtempSync(join(tmpdir(), "policy-loader-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const defaults = { PATH: process.env.PATH, GITHUB_REPOSITORY: "unset-sh/docs", GITHUB_REF: "refs/heads/automation/docs-tooling",
    GITHUB_SHA: "a".repeat(40), WORKFLOW_REPOSITORY: "unset-sh/tooling", WORKFLOW_SHA: "b".repeat(40),
    PULL_REQUEST: "12", EXPECTED_HEAD: "a".repeat(40), EXPECTED_BASE: "c".repeat(40), RUNNER_TEMP: root };
  for (const override of [{ WORKFLOW_REPOSITORY: "outside/tooling" }, { WORKFLOW_SHA: "main" }, { EXPECTED_HEAD: "main" },
    { GITHUB_REPOSITORY: "outside/docs" }, { GITHUB_REF: "refs/heads/feature" }, { PULL_REQUEST: "$(exit 77)" }, { GITHUB_SHA: "d".repeat(40) }]) {
    const result = spawnSync("bash", ["-c", script], { env: { ...defaults, ...override }, cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Invalid|Unsupported/);
  }
  assert.deepEqual(readdirSync(root), []);
});
