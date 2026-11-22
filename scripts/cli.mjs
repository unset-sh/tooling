// Tells a script whether it was started from the command line or imported by a test.
//
// Comparing `import.meta.url` with `process.argv[1]` as typed is wrong through any symbolic link (macOS `/tmp`,
// a linked folder): Node resolves the entry module to its real path but leaves `process.argv[1]` alone, so the
// script would do nothing and exit 0. Both sides are resolved here, and an error resolving them is not caught:
// a script that cannot tell must fail, never pass quietly. (Found in the agent-kit review of 2026-11-22.)

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function startedAsScript(moduleUrl) {
  if (process.argv[1] === undefined) return false;
  return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(moduleUrl));
}
