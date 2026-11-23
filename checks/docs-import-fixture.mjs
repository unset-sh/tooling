import { createHash } from "node:crypto";

export const sourceCommit = "a".repeat(40);
export const baseCommit = "b".repeat(40);
export const workflowCommit = baseCommit;
export const sourceTree = "d".repeat(40);
export const hash = (bytes, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");
export const blob = bytes => hash(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), "sha1");
export function importFixture() {
  const files = [
    { path: "LICENSE", bytes: Buffer.from("Fixture licence\n") },
    { path: "_index.md", bytes: Buffer.from("---\ntitle: Fixture\ntype: docs\ncascade:\n  type: docs\nmenus:\n  main:\n    weight: 30\n---\n\nA source page.\n") },
  ];
  const provenance = { schemaVersion: 1, repository: "unset-sh/tooling", revision: sourceCommit, directory: "docs", section: "tooling",
    files: files.map(({ path, bytes }) => ({ path, sha256: hash(bytes) })) };
  files.push({ path: "source.json", bytes: Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`) });
  const snapshot = { schemaVersion: 1, source: { key: "tooling", revision: sourceCommit, runId: 123 },
    target: { repository: "unset-sh/docs", base: "staging", baseCommit, workflowCommit },
    files: files.map(({ path, bytes }) => ({ path, content: bytes.toString("base64"), sha256: hash(bytes) })) };
  const run = { id: 123, event: "push", head_branch: "main", head_sha: sourceCommit, status: "completed", conclusion: "success",
    path: ".github/workflows/automation-docs-self.yml", repository: { full_name: "unset-sh/tooling" }, head_repository: { full_name: "unset-sh/tooling" } };
  const tree = { sha: sourceTree, truncated: false, tree: [
    { path: "LICENSE", mode: "100644", type: "blob", sha: blob(files[0].bytes), size: files[0].bytes.length },
    { path: "docs", mode: "040000", type: "tree", sha: "e".repeat(40) },
    { path: "docs/_index.md", mode: "100644", type: "blob", sha: blob(files[1].bytes), size: files[1].bytes.length },
  ] };
  return { snapshot, run, tree, files };
}
