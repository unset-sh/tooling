import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const repository = "unset-sh/.github", base = "a".repeat(40), head = "b".repeat(40);
export const baseTree = "c".repeat(40), headTree = "d".repeat(40), other = "e".repeat(40);
export const branch = `automation/map-${base}`;
const marker = "<!-- org-map:start (generated from repos.json; edit that, then run npm run map) -->";
const oldReadme = `# Authored\n${marker}\nOld\n<!-- org-map:end -->\nFooter\n`;
export const newReadme = oldReadme.replace("Old", "New");
const hash = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
export const entry = (path, sha, mode = "100644", type = "blob") => ({ path, sha, mode, type });
export const context = { repository, event: "workflow_dispatch", ref: `refs/heads/${branch}`, sha: head };

export function server() {
  const objects = new Map(); const calls = [];
  const blob = value => {
    const bytes = Buffer.from(value), sha = hash(bytes);
    objects.set(`/git/blobs/${sha}`, { sha, size: bytes.length, encoding: "base64", content: bytes.toString("base64") });
    return sha;
  };
  const oldMap = blob("Old map\n"), newMap = blob("New map\n"), oldProfile = blob(oldReadme), newProfile = blob(newReadme);
  objects.set("/pulls/17", { number: 17, state: "open", draft: false,
    user: { login: "github-actions[bot]", id: 41898282, type: "Bot" },
    head: { sha: head, ref: branch, repo: { full_name: repository } },
    base: { sha: base, ref: "main", repo: { full_name: repository } } });
  objects.set("/git/ref/heads/main", { ref: "refs/heads/main", object: { type: "commit", sha: base } });
  objects.set(`/git/ref/heads/${branch}`, { ref: `refs/heads/${branch}`, object: { type: "commit", sha: head } });
  objects.set(`/git/commits/${base}`, { sha: base, tree: { sha: baseTree } });
  objects.set(`/git/commits/${head}`, { sha: head, tree: { sha: headTree }, parents: [{ sha: base }],
    message: "Refresh generated organisation map\n\nSigned-off-by: github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>" });
  for (const [tree, map, profile] of [[baseTree, oldMap, oldProfile], [headTree, newMap, newProfile]]) {
    objects.set(`/git/trees/${tree}?recursive=1`, { sha: tree, truncated: false, tree: [
      entry("MAP.md", map), entry("profile", other, "040000", "tree"), entry("profile/README.md", profile),
      entry("repos.json", other), entry("scripts/map.mjs", other),
    ] });
  }
  const api = async (repo, method, path) => {
    assert.equal(repo, repository); assert.equal(method, "GET"); calls.push(path);
    assert.ok(objects.has(path), `Unexpected ${path}`); return structuredClone(objects.get(path));
  };
  return { objects, calls, api, blob };
}
