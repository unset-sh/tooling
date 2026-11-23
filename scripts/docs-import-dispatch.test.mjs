import assert from "node:assert/strict";
import { test } from "node:test";
import { validateDocsImportDispatch } from "./docs-import-dispatch.mjs";

const head = "a".repeat(40), base = "b".repeat(40);
const context = { repository: "unset-sh/docs", event: "workflow_dispatch", ref: "refs/heads/automation/docs-tooling", sha: head };

test("dispatch cannot manufacture a PR identity for another repository, event, branch or head", async () => {
  const inputs = { context, number: "12", expectedHead: head, expectedBase: base, api: () => { throw new Error("API must not be reached"); } };
  for (const change of [
    value => { value.context.repository = "outside/docs"; },
    value => { value.context.event = "pull_request_target"; },
    value => { value.context.ref = "refs/heads/feature"; },
    value => { value.context.ref = "refs/heads/automation/docs-web"; },
    value => { value.context.sha = base; },
    value => { value.expectedHead = "main"; },
    value => { value.expectedBase = "staging"; },
    value => { value.number = "12\n"; },
    value => { value.number = "0"; },
    value => { value.number = "9007199254740992"; },
  ]) {
    const copy = { ...inputs, context: { ...context } }; change(copy);
    await assert.rejects(validateDocsImportDispatch(copy), error => !error.message.includes("API must not"));
  }
});

test("dispatch refuses real PR metadata that does not match its expected bot-owned staging import", async () => {
  for (const change of [
    value => { value.state = "closed"; },
    value => { value.head.sha = base; },
    value => { value.base.sha = head; },
    value => { value.base.ref = "main"; },
    value => { value.head.repo.full_name = "outside/docs"; },
    value => { value.user.login = "a-person"; },
    value => { value.changed_files = 0; },
    value => { value.changed_files = 513; },
  ]) {
    const pr = { number: 12, state: "open", changed_files: 3, user: { login: "github-actions[bot]", id: 41898282, type: "Bot" },
      head: { sha: head, ref: "automation/docs-tooling", repo: { full_name: "unset-sh/docs" } },
      base: { sha: base, ref: "staging", repo: { full_name: "unset-sh/docs" } } };
    change(pr);
    const api = async (repository, method, path) => {
      assert.equal(repository, "unset-sh/docs"); assert.equal(method, "GET"); assert.equal(path, "/pulls/12"); return pr;
    };
    await assert.rejects(validateDocsImportDispatch({ context, number: "12", expectedHead: head, expectedBase: base, api }));
  }
});
