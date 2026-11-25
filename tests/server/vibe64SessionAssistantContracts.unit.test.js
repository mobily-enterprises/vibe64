import assert from "node:assert/strict";
import test from "node:test";
import * as contracts from "../../packages/vibe64-sessions/src/server/assistantContracts.js";

const long = (length) => "x".repeat(length);
const strings = (keys, length = 5000) => Object.fromEntries(keys.map((key) => [key, long(length)]));

// A result with every projected field oversized: each tool must cut it to the
// limits its own output schema declares.
const oversized = {
  ok: false,
  ...strings(["sessionId", "sessionName", "status", "error", "code", "currentMode", "accessLabel", "repository", "targetBranch",
    "targetHead", "head", "mode", "branch", "saveCommit", "messageId", "reason", "historySnapshotCommit", "nextCursor", "commit", "parent"]),
  ahead: 1, behind: 2, totalCount: 3, offset: 0, hasMore: true, delivered: true,
  assistantSelection: strings(["engineId", "modelId", "modelProviderId", "agentId"]),
  purposes: { senior: { available: true, approvalRequired: false, ...strings(["role", "message"]), effectiveSelection: strings(["modelId"]) } },
  operation: strings(["operationId", "kind", "status", "error"]),
  cacheMaintenance: { status: long(5000), message: long(5000), retryable: false },
  pullRequest: { number: 1, ...strings(["title", "url", "baseBranch"], 9000) },
  turn: { id: long(5000), state: long(5000), active: true },
  renewal: { ...strings(["renewalId", "status"]), error: { code: long(5000), message: long(5000) } },
  versions: [{ ...strings(["commit", "author", "message"]), isMerge: false }],
  files: [{ path: long(5000), status: "M", added: 1, deleted: 2 }],
  pinsToRecord: [strings(["fullName", "commit"])]
};
oversized.sessions = [oversized];

const tools = {
  session: contracts.sessionTool("inspect"),
  assistantAccess: contracts.assistantAccessTool(),
  sessionWork: contracts.sessionWorkTool("inspect"),
  sessionPullRequest: contracts.sessionPullRequestTool(),
  conversationOperation: contracts.conversationOperationTool("send"),
  renewal: contracts.renewalTool("inspect"),
  repositoryHistory: contracts.repositoryHistoryTool(),
  repositoryVersionFiles: contracts.repositoryVersionFilesTool()
};

for (const [name, tool] of Object.entries(tools)) {
  test(`${name} projects an oversized result within its own output schema`, async () => {
    const output = tool.transformResult(oversized, { input: {} });
    const { errors } = await tool.output.schema.create(output);
    assert.deepEqual(errors, {});
    assert.equal(output.ok, false);
  });
}

test("projections copy only declared values of the declared type", () => {
  const output = tools.repositoryHistory.transformResult({ ok: true, code: 7, hasMore: "yes", nextCursor: "c" });
  assert.deepEqual(output, { ok: true, nextCursor: "c" });
  assert.equal(tools.sessionWork.transformResult({ ok: true, error: long(600) }).error.length, 512);
});

test("the work tool says which pins Save would record, as the session's answer names them", () => {
  const pin = { fullName: "example/mercbot", commit: "b".repeat(40) };
  // After Update moved a composition copy: work to save with no changed file, the pin is why.
  assert.deepEqual(tools.sessionWork.transformResult({ ok: true, changedPaths: [], pinsToRecord: [pin], unsaved: true }).pinsToRecord, [pin]);
  assert.equal(Object.hasOwn(tools.sessionWork.transformResult({ ok: true, pinsToRecord: [], unsaved: false }), "pinsToRecord"), false);
});

test("the work tools give Colleague the plain message for a session behind main, from its work or Save's refusal, and name Update, never a merge", () => {
  const savedAt = new Date(Date.now() - 12.5 * 60_000).toISOString();
  const newerSaved = { behind: 1, incomingFileCount: 2, incomingVersions: [{ commit: "d".repeat(40), committedAt: savedAt,
    savedBy: { savedAt, sessionId: "2026-1125-0811-passes", sessionName: "Passes" } }] };
  const message = "Main has 1 newer saved version (12 minutes ago, from the Passes session, 2 files). " +
    "Update this session to take it in (your unsaved work stays), then Save.";
  assert.equal(tools.sessionWork.transformResult({ ok: true, newerSaved, unsaved: true, updateAvailable: true }).newerSavedMessage, message);
  assert.equal(tools.sessionWork.transformResult({ ok: false, code: "vibe64_session_save_update_required", error: message,
    details: { newerSaved } }).newerSavedMessage, message);
  // A session with nothing unsaved is told to Update only.
  assert.match(tools.sessionWork.transformResult({ ok: true, newerSaved, unsaved: false, updateAvailable: true }).newerSavedMessage,
    /\. Update this session to take it in\.$/u);
  assert.equal(Object.hasOwn(tools.sessionWork.transformResult({ ok: true, unsaved: true, updateAvailable: false }), "newerSavedMessage"), false);
  for (const name of ["inspectSessionWork", "saveSessionWork"]) {
    assert.match(contracts.ASSISTANT_TOOL_DESCRIPTIONS[name], /newerSavedMessage/u, name);
    assert.match(contracts.ASSISTANT_TOOL_DESCRIPTIONS[name], /never offer a merge/u, name);
  }
});
