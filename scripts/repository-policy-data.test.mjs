import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { validatePolicyConfig, dependencyFindings, kitFindings, artifactFindings, applyPolicyExceptions } from "./repository-policy-data.mjs";

const config = (extra = {}) => ({ schemaVersion: 1, dependencyManifests: ["package.json"], actionDefinitions: [],
  kit: "if-present", artifactPaths: [], exceptions: [], ...extra });
const reason = "Reviewed local workspace dependency.";

test("configuration has explicit scope and refuses ambiguous paths or broad exceptions", () => {
  assert.deepEqual(validatePolicyConfig(config()), config());
  for (const value of [null, {}, config({ extra: true }), config({ schemaVersion: 2 }), config({ kit: "off" }),
    config({ dependencyManifests: ["../package.json"] }), config({ dependencyManifests: ["package.json", "package.json"] }),
    config({ actionDefinitions: ["scripts/a.js"] }), config({ artifactPaths: ["notes"] }),
    config({ exceptions: [{ kind: "dependency", path: "*", key: "*", reference: "*", reason }] })]) {
    assert.throws(() => validatePolicyConfig(value), /policy|configuration/i);
  }
});

test("dependencies require exact versions or immutable supported references while peer ranges remain compatibility declarations", () => {
  const pinned = ["1.2.3", "0.0.0", "1.2.3-staging.12", "1.2.3+build.1", "npm:@unset-sh/brand@1.2.3",
    `github:unset-sh/brand#${"a".repeat(40)}`, `git+https://github.com/unset-sh/brand.git#${"b".repeat(40)}`];
  for (const reference of pinned) assert.deepEqual(dependencyFindings("package.json", {
    dependencies: { brand: reference }, devDependencies: { test: reference }, optionalDependencies: { helper: reference },
    peerDependencies: { react: ">=19" },
  }), []);
  for (const reference of ["^1.2.3", "~1.2.3", "latest", "workspace:*", "file:../local", "1.2", "1.2.3-staging.01",
    "01.2.3", "github:unset-sh/brand#main", "npm:brand@^1.2.3", `https://secret@example.invalid/file.tgz`]) {
    assert.deepEqual(dependencyFindings("package.json", { dependencies: { brand: reference } }),
      [{ kind: "dependency", path: "package.json", key: "dependencies.brand", reference }]);
  }
  for (const manifest of [null, [], { dependencies: [] }, { dependencies: null },
    { dependencies: { brand: "1.2.3\n" } }, { dependencies: { brand: null } }]) {
    assert.throws(() => dependencyFindings("package.json", manifest), /manifest/i);
  }
});

test("working artifact path checks are explicit and keep agent-kit as their permitted owner", () => {
  const files = ["README.md", "docs/reference.md", "notes/task/plan.md", "artifacts/task/result.json", "scratch/plan.md"];
  assert.deepEqual(artifactFindings(files, "unset-sh/web", ["scratch/"]), [
    { kind: "artifact", path: "notes/task/plan.md" }, { kind: "artifact", path: "artifacts/task/result.json" },
    { kind: "artifact", path: "scratch/plan.md" },
  ]);
  assert.deepEqual(artifactFindings(files, "unset-sh/agent-kit", []), []);
});

test("exceptions match one exact reference and stale or duplicate exceptions fail", () => {
  const issue = { kind: "dependency", path: "package.json", key: "dependencies.local", reference: "workspace:*" };
  const exception = { ...issue, reason };
  assert.deepEqual(applyPolicyExceptions([issue], [exception]), []);
  assert.deepEqual(applyPolicyExceptions([{ ...issue, reference: "file:../local" }], []), [{ ...issue, reference: "file:../local" }]);
  assert.throws(() => applyPolicyExceptions([], [exception]), /unused|stale/i);
  assert.throws(() => validatePolicyConfig(config({ exceptions: [exception, exception] })), /duplicate/i);
  assert.throws(() => validatePolicyConfig(config({ exceptions: [{ ...exception, reason: "" }] })), /configuration/i);
});

function installedKit() {
  const files = new Map([[".claude/agent-kit/sync.mjs", Buffer.from("throw new Error('must never execute');")],
    [".claude/rules/org/working.md", Buffer.from("Reviewed kit rule.\n")]]);
  const lock = { kit: "unset-sh/agent-kit", version: "0.1.0", commit: "a".repeat(40), bundleSha256: "b".repeat(64),
    files: Object.fromEntries([...files].map(([path, bytes]) => [path, createHash("sha256").update(bytes).digest("hex")])) };
  files.set(".claude/agent-kit/lock.json", Buffer.from(JSON.stringify(lock)));
  return { files, lock, save: () => files.set(".claude/agent-kit/lock.json", Buffer.from(JSON.stringify(lock))) };
}

test("installed kit integrity reads its declared lock without executing the sync helper", () => {
  const { files } = installedKit();
  assert.deepEqual(kitFindings(files, "required"), []);
  files.set(".claude/rules/org/working.md", Buffer.from("Modified rule."));
  assert.deepEqual(kitFindings(files, "required"), [{ kind: "kit", path: ".claude/rules/org/working.md", key: "changed" }]);
  files.delete(".claude/rules/org/working.md");
  assert.deepEqual(kitFindings(files, "required"), [{ kind: "kit", path: ".claude/rules/org/working.md", key: "missing" }]);
});

test("partial kit installations, unlisted files and malformed locks fail closed", () => {
  assert.deepEqual(kitFindings(new Map(), "if-present"), []);
  assert.throws(() => kitFindings(new Map(), "required"), /lock/i);
  assert.throws(() => kitFindings(new Map([[".claude/skills/org-example/SKILL.md", Buffer.from("rule")]]), "if-present"), /lock/i);
  const { files } = installedKit();
  files.set(".claude/agents/org-extra.md", Buffer.from("Unlisted rule."));
  assert.deepEqual(kitFindings(files, "if-present"), [{ kind: "kit", path: ".claude/agents/org-extra.md", key: "unlisted" }]);
  for (const mutate of [lock => { lock.commit = "main"; }, lock => { lock.kit = "elsewhere/kit"; },
    lock => { lock.extra = true; }, lock => { lock.files["../outside"] = "b".repeat(64); },
    lock => { lock.files[".claude/agent-kit/lock.json"] = "b".repeat(64); },
    lock => { delete lock.files[".claude/agent-kit/sync.mjs"]; }]) {
    const kit = installedKit(); mutate(kit.lock); kit.save();
    assert.throws(() => kitFindings(kit.files, "required"), /lock/i);
  }
});

test("configuration and installed kit byte bounds cannot be bypassed with extra entries", () => {
  assert.throws(() => validatePolicyConfig(config({ dependencyManifests: Array.from({ length: 201 }, (_, i) => `p${i}/package.json`) })), /configuration/i);
  assert.throws(() => kitFindings(new Map([[".claude/agent-kit/lock.json", Buffer.alloc(1024 * 1024 + 1)]]), "required"), /lock/i);
  const { files } = installedKit();
  files.set(".claude/agent-kit/sync.mjs", Buffer.alloc(1024 * 1024 + 1));
  assert.throws(() => kitFindings(files, "required"), /size limit/i);
});
