// Isolated public fixture identity. Never writes a production identity file.
import { copyFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
export const appFixtureIdentity = { clientId: "Iv23fixture1234567890", appId: 123, slug: "fixture-automation", botId: 456, installationId: 789 };
export const appFixtureCredentials = { githubToken: "fixture-installation-token", appSlug: appFixtureIdentity.slug,
  installationId: String(appFixtureIdentity.installationId), fetchImpl: async () => new Response(JSON.stringify({ total_count: 1,
    repositories: [{ id: 321, full_name: "unset-sh/docs", owner: { login: "unset-sh", type: "Organization" } }] })) };
export async function appFixtureModules(cleanup) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "docs-app-fixture-")));
  cleanup(() => rmSync(root, { recursive: true, force: true }));
  const names = ["automation-app", "cli", "export-docs", "docs-import-data", "docs-import-github", "docs-import-publication", "docs-import-dispatch", "docs-import", "docs-import-send"];
  for (const name of names) copyFileSync(new URL(`../scripts/${name}.mjs`, import.meta.url), join(root, `${name}.mjs`));
  writeFileSync(join(root, "automation-app.json"), JSON.stringify(appFixtureIdentity));
  const modules = {};
  for (const name of ["automation-app", "docs-import-publication", "docs-import-dispatch"]) modules[name] = await import(pathToFileURL(join(root, `${name}.mjs`)));
  return { ...modules, root };
}
