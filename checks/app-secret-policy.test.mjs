import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAppSecretBoundary } from "./app-secret-policy.mjs";
const path = ".github/workflows/automation-docs-import.yml";
const workflow = `on:
  workflow_call:
    secrets:
      automation-app-private-key:
        required: true
jobs:
  publish:
    steps:
      - id: token
        uses: actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510 # v3.3.0
        with:
          client-id: \${{ steps.app.outputs.client-id }}
          private-key: \${{ secrets.automation-app-private-key }}
          owner: unset-sh
          repositories: docs
          permission-contents: write
          permission-pull-requests: write
`;
test("the App key exception is limited to one named input of the fixed repository-scoped mint action", () => {
  assert.doesNotThrow(() => checkAppSecretBoundary(path, workflow));
  assert.doesNotThrow(() => checkAppSecretBoundary(".github/workflows/automation-org-map.yml", workflow.replace("repositories: docs", "repositories: .github")));
  for (const [name, source] of [[".github/workflows/arbitrary.yml", workflow],
    [path, workflow.replace("  publish:", "  prepare:")], [path, workflow.replace("required: true", "required: false")],
    [path, workflow.replace("repositories: docs", "repositories: docs,tooling")], [path, workflow.replace("owner: unset-sh", "owner: outside")],
    [path, workflow.replace("permission-contents: write", "permission-actions: write")],
    [path, workflow.replace("private-key: ${{ secrets.automation-app-private-key }}", "private-key: ${{ secrets.OTHER }}")],
    [path, workflow.replace("        with:", "        env:")], [path, workflow + "env:\n  LEAK: ${{ toJSON(secrets) }}\n"], [path, workflow + "env:\n  LEAK: ${{ format('}}{0}', toJSON(secrets)) }}\n"], [path, workflow + "env:\n  LEAK: ${{ secrets.automation-app-private-key }}\n"],
    [path, workflow.replace("permission-pull-requests: write", "permission-pull-requests: write\n          skip-token-revoke: true")]]) {
    assert.throws(() => checkAppSecretBoundary(name, source));
  }
});
