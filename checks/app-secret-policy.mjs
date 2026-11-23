import assert from "node:assert/strict";
import { jobsOf, topLevel } from "./repo.mjs";

// The owner-approved private key exception is limited to two isolated publishers.
export function checkAppSecretBoundary(path, text) {
  assert.doesNotMatch(text, /secrets: inherit/);
  const references = [...text.matchAll(/\bsecrets\s*[.[]/g)];
  if (!references.length) return;
  const targets = { ".github/workflows/automation-docs-import.yml": "docs", ".github/workflows/automation-org-map.yml": ".github" };
  assert.ok(Object.hasOwn(targets, path), `${path} has no stored-secret exception`);
  assert.equal(references.length, 1, "Only the named App key may be referenced once");
  assert.match(topLevel(text, "on"), /^    secrets:\n      automation-app-private-key:\n        required: true$/m);
  const publish = jobsOf(text).publish;
  assert.ok(publish, "The key belongs only in the isolated publisher");
  const steps = publish.split(/^      - /m).slice(1);
  const mint = steps.find(step => step.includes("secrets."));
  assert.ok(mint, "The key must be an action input in the publisher");
  assert.match(mint, /uses: actions\/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3\.3\.0\n/);
  assert.doesNotMatch(mint, /^        (?:env|run|if|continue-on-error):/m);
  const withBlock = mint.slice(mint.indexOf("        with:\n") + 14).trimEnd();
  const expected = [
    "          client-id: ${{ steps.app.outputs.client-id }}",
    "          private-key: ${{ secrets.automation-app-private-key }}",
    "          owner: unset-sh", `          repositories: ${targets[path]}`,
    "          permission-contents: write", "          permission-pull-requests: write",
  ];
  assert.deepEqual(withBlock.split("\n").sort(), expected.sort(), "App token inputs must keep one repository and exact permissions");
}
