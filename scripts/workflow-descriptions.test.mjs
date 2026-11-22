import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { generateWorkflowReference, loadWorkflowDescriptions, validateWorkflowDescriptions, workflowDocumentation } from "./workflow-descriptions.mjs";

const hash = "a".repeat(64);
const previousHash = "b".repeat(64);
const revision = "c".repeat(40);
const previousRevision = "d".repeat(40);
const record = (overrides = {}) => ({
  repository: "tooling", path: ".github/workflows/ci-check.yml", reviewedCommit: revision,
  reviewedSha256: hash, purpose: "Check a consuming repository before changes land.",
  steps: ["Check out the caller's commit.", "Run its configured check command."],
  outputs: ["A check result on the consuming repository."], ...overrides,
});
const catalogue = (workflows = [record()]) => ({ schemaVersion: 1, workflows });
const cli = fileURLToPath(new URL("./workflow-descriptions.mjs", import.meta.url));

function fixture(t, data = catalogue()) {
  const root = mkdtempSync(join(tmpdir(), "workflow-descriptions-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "workflows"));
  writeFileSync(join(root, "workflows/descriptions.json"), JSON.stringify(data));
  return root;
}

test("description status follows source bytes rather than the current commit label", () => {
  const descriptions = validateWorkflowDescriptions(catalogue());
  const result = workflowDocumentation({ repository: "tooling", path: record().path, commit: "e".repeat(40), sha256: hash }, descriptions);
  assert.deepEqual(result, {
    status: "current", purpose: record().purpose, steps: record().steps, outputs: record().outputs,
    reviewedCommit: revision, reviewedSha256: hash,
  });
});

test("changed and undocumented workflows remain visible without fabricated descriptions", () => {
  const descriptions = validateWorkflowDescriptions(catalogue());
  const changed = workflowDocumentation({ repository: "tooling", path: record().path, sha256: previousHash }, descriptions);
  assert.equal(changed.status, "review");
  assert.equal(changed.purpose, record().purpose);
  assert.equal(changed.reviewedSha256, hash);
  assert.deepEqual(workflowDocumentation({ repository: "web", path: ".github/workflows/ci.yml", sha256: hash }, descriptions), {
    status: "missing", purpose: null, steps: [], outputs: [], reviewedCommit: null, reviewedSha256: null,
  });
});

test("an exact historical description takes precedence over the preferred review fallback", () => {
  const previous = record({ reviewedCommit: previousRevision, reviewedSha256: previousHash,
    purpose: "Check a consumer using the earlier implementation." });
  const descriptions = validateWorkflowDescriptions(catalogue([record(), previous]));
  const historical = workflowDocumentation({ repository: "tooling", path: record().path, sha256: previousHash }, descriptions);
  assert.equal(historical.status, "current");
  assert.equal(historical.reviewedCommit, previousRevision);
  assert.equal(historical.purpose, previous.purpose);
  const changed = workflowDocumentation({ repository: "tooling", path: record().path, sha256: "f".repeat(64) }, descriptions);
  assert.equal(changed.purpose, record().purpose);
  assert.equal(changed.status, "review");
});

test("invalid identities, multiline prose, missing fields and excessive description data are refused", () => {
  for (const invalid of [null, [], {}, { schemaVersion: 2, workflows: [record()] }, catalogue([]),
    { ...catalogue(), extra: true }, catalogue(Array.from({ length: 1001 }, () => record()))]) {
    assert.throws(() => validateWorkflowDescriptions(invalid), /schema/);
  }
  const invalid = [
    { repository: "../web" }, { repository: "web\n" }, { path: ".github/workflows/nested/ci.yml" },
    { path: ".github/workflows/ci.yml\n" }, { reviewedCommit: "main" }, { reviewedSha256: "a".repeat(63) },
    { purpose: " " }, { purpose: "first\nsecond" }, { purpose: "x".repeat(2001) },
    { steps: [] }, { steps: [null] }, { steps: Array(21).fill("Step") }, { outputs: [] },
    { outputs: Array(11).fill("Result") }, { extra: "field" },
  ];
  for (const override of invalid) assert.throws(() => validateWorkflowDescriptions(catalogue([record(override)])), /record/);
  assert.throws(() => validateWorkflowDescriptions(catalogue([record(), record({ reviewedCommit: previousRevision })])), /Duplicate/);
  assert.throws(() => validateWorkflowDescriptions(catalogue(Array.from({ length: 30 }, (_, index) => record({
    repository: `repo-${index}`, purpose: "x".repeat(2000), steps: Array(20).fill("x".repeat(2000)),
  })))), /size/);
});

test("description loading is bounded and refuses symbolic or hard links", (t) => {
  const root = fixture(t);
  assert.deepEqual(loadWorkflowDescriptions(root), [record()]);
  const file = join(root, "workflows/descriptions.json");
  writeFileSync(file, "x".repeat(1024 * 1024 + 1));
  assert.throws(() => loadWorkflowDescriptions(root), /bounded|large|size/);
  writeFileSync(file, "{");
  assert.throws(() => loadWorkflowDescriptions(root), /JSON/);
  writeFileSync(file, Buffer.from([0xff]));
  assert.throws(() => loadWorkflowDescriptions(root), /JSON/);
  rmSync(file);
  const target = join(root, "outside.json");
  writeFileSync(target, JSON.stringify(catalogue()));
  symlinkSync(target, file);
  assert.throws(() => loadWorkflowDescriptions(root), /link/);
  rmSync(file);
  linkSync(target, file);
  assert.throws(() => loadWorkflowDescriptions(root), /link/);
});

test("reference generation contains reviewed purposes, steps, outputs and immutable source links", (t) => {
  const previous = record({ reviewedCommit: previousRevision, reviewedSha256: previousHash, purpose: "Earlier implementation." });
  const root = fixture(t, catalogue([record(), previous]));
  assert.equal(generateWorkflowReference({ root }), true);
  assert.equal(existsSync(join(root, "docs")), false);
  assert.equal(generateWorkflowReference({ root, write: true }), true);
  const markdown = readFileSync(join(root, "docs/workflow-reference.md"), "utf8");
  assert.match(markdown, /doc_kind: reference/);
  assert.ok(markdown.includes(record().purpose));
  assert.ok(markdown.includes(`1. ${record().steps[0]}`));
  assert.ok(markdown.includes(`- ${record().outputs[0]}`));
  assert.ok(markdown.includes(`https://github.com/unset-sh/tooling/blob/${revision}/.github/workflows/ci-check.yml`));
  assert.ok(markdown.includes(previousRevision));
  assert.ok(markdown.includes("Additional reviewed version"));
  assert.equal(generateWorkflowReference({ root, write: true }), false);
  assert.equal(generateWorkflowReference({ root }), false);
  const changed = catalogue([record({ purpose: "Check the exact consumer revision." })]);
  writeFileSync(join(root, "workflows/descriptions.json"), JSON.stringify(changed));
  assert.equal(generateWorkflowReference({ root }), true);
  assert.equal(readFileSync(join(root, "docs/workflow-reference.md"), "utf8"), markdown);
});

test("reference output escapes prose syntax and refuses unowned files or linked output paths", (t) => {
  const root = fixture(t, catalogue([record({ purpose: "<script>Read [a link](https://example.invalid).</script>" })]));
  generateWorkflowReference({ root, write: true });
  const path = join(root, "docs/workflow-reference.md");
  assert.doesNotMatch(readFileSync(path, "utf8"), /<script>|\[a link\]\(https/);
  writeFileSync(path, "Maintained by someone else.\n");
  assert.throws(() => generateWorkflowReference({ root, write: true }), /unmanaged|owned/);
  rmSync(path);
  const outside = join(root, "outside.md");
  writeFileSync(outside, "Keep this document.\n");
  symlinkSync(outside, path);
  assert.throws(() => generateWorkflowReference({ root, write: true }), /link/);
  assert.equal(readFileSync(outside, "utf8"), "Keep this document.\n");
  rmSync(path);
  linkSync(outside, path);
  assert.throws(() => generateWorkflowReference({ root, write: true }), /link/);
  assert.equal(readFileSync(outside, "utf8"), "Keep this document.\n");
});

test("linked registry and output directories cannot redirect reads or generated documentation", (t) => {
  const root = fixture(t);
  const outside = fixture(t);
  symlinkSync(outside, join(root, "docs"));
  assert.throws(() => generateWorkflowReference({ root, write: true }), /link/);
  rmSync(join(root, "workflows"), { recursive: true });
  symlinkSync(join(outside, "workflows"), join(root, "workflows"));
  assert.throws(() => loadWorkflowDescriptions(root), /link/);
});

test("immutable source URLs encode unusual flat filenames without creating Markdown syntax", (t) => {
  const root = fixture(t, catalogue([record({ path: ".github/workflows/a (test)[x]é.yml" })]));
  generateWorkflowReference({ root, write: true });
  assert.ok(readFileSync(join(root, "docs/workflow-reference.md"), "utf8")
    .includes("/.github/workflows/a%20%28test%29%5Bx%5D%C3%A9.yml"));
});

test("reference CLI reports stale output, writes it, and imports safely from stdin", (t) => {
  const root = fixture(t);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, "--root", root], { encoding: "utf8" });
  assert.equal(run("--check").status, 1);
  const generated = run("--write");
  assert.equal(generated.status, 0, generated.stderr);
  assert.equal(run("--check").status, 0);
  assert.equal(run("--unknown").status, 1);
  const imported = spawnSync(process.execPath, ["--input-type=module", "-"], {
    input: `await import(${JSON.stringify(new URL("./workflow-descriptions.mjs", import.meta.url).href)});`, encoding: "utf8",
  });
  assert.equal(imported.status, 0, imported.stderr);
});
