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
  files: [{ path: long(5000), status: "M", added: 1, deleted: 2 }]
};
oversized.sessions = [oversized];

const tools = {
  session: contracts.sessionTool("inspect"),
  assistantAccess: contracts.assistantAccessTool(),
  incomingContribution: contracts.incomingContributionTool("inspect"),
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
