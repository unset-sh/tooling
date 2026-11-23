import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function run(t, event, eventName = "pull_request") {
  assert.ok(existsSync(workflow), "the reusable branch-policy workflow must exist");
  const scripts = runBlocks(readFileSync(workflow, "utf8"));
  assert.equal(scripts.length, 1, "exercise the complete inline policy check");
  const folder = mkdtempSync(join(tmpdir(), "branch-policy-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const eventPath = join(folder, "event.json");
  writeFileSync(eventPath, typeof event === "string" ? event : JSON.stringify(event));
  return spawnSync(process.execPath, ["--input-type=commonjs", "--eval", scripts[0]], {
    cwd: folder, encoding: "utf8", env: {
      GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: eventName, GITHUB_REPOSITORY: repository,
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
