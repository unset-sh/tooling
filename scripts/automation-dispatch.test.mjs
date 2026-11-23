import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAutomationDispatch } from "./automation-dispatch.mjs";

test("shared dispatch validation cannot be borrowed by arbitrary repositories or branch families", async () => {
  for (const repository of ["outside/docs", "unset-sh/tooling", "unset-sh/brand", "unset-sh/docs\n"]) {
    await assert.rejects(validateAutomationDispatch({ context: { repository }, api: () => { throw new Error("unreachable API"); } }), /unsupported|repository/i);
  }
  for (const repository of ["unset-sh/docs", "unset-sh/.github"]) {
    await assert.rejects(validateAutomationDispatch({ context: { repository, event: "push" }, api: () => { throw new Error("unreachable API"); } }), error => !error.message.includes("unreachable"));
  }
});
