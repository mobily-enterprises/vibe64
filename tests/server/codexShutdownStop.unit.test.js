import assert from "node:assert/strict";
import test from "node:test";
import { createCodexSessionAgentProvider } from "../fixtures/codexProviderAdapter.js";
import {
  createCodexDeferredTurnCheckpoint,
  shutdownStoppedRun
} from "../../packages/vibe64-terminals/src/server/sessionTurnCheckpoint.js";
import { createTemporaryConversationRecords } from "../../packages/vibe64-terminals/src/server/temporaryConversationRecords.js";

const SESSION_ID = "session-1";
const CHAT_ID = "chat-1";
const THREAD_ID = "thread-1";
const OUTER_TURN_ID = `codex:${THREAD_ID}:turn-1`;
const ENDING = { outerTurnId: OUTER_TURN_ID, threadId: THREAD_ID, turnId: "turn-1" };

// A session store whose turn checkpoints are observed, not made: the project
// cannot be read, so each checkpoint is recorded as attempted without a Git snapshot.
function fixture() {
  const records = new Map([
    ["chat-0", { conversationId: "chat-0", providerConversationId: "thread-0", createdAt: "2026-11-05T00:00:00.000Z" }],
    [CHAT_ID, { conversationId: CHAT_ID, providerConversationId: THREAD_ID, status: "inProgress", createdAt: "2026-11-05T00:01:00.000Z" }]
  ]);
  const checkpoints = [];
  const session = { sessionId: SESSION_ID, sourcePath: "/sessions/session-1", metadata: {} };
  const store = {
    async readSessionConversation(_sessionId, id) { return records.get(id) || null; },
    async listSessionConversations() { return [...records.values()]; },
    async writeSessionConversation(_sessionId, id, patch) {
      const record = { ...records.get(id), ...patch, conversationId: id };
      records.set(id, record);
      return record;
    },
    async writeBackgroundTaskEvent(_sessionId, _taskId, { patch }) {
      checkpoints.push({ checkpointTurnId: patch.checkpointTurnId, checkpointOutcome: patch.checkpointOutcome });
      return patch;
    }
  };
  const runtime = { store, async getSessionWithoutSource() { return session; } };
  const project = {
    async createRuntimeWithoutSource() { return runtime; },
    async readCurrentProject() { throw new Error("This test makes no Git snapshot."); }
  };
  const publishSessionChanged = async () => {};
  const deferCheckpoint = createCodexDeferredTurnCheckpoint({ project });
  const provider = createCodexSessionAgentProvider({
    controller: {},
    shutdownStoppedRun: (context, stop) => shutdownStoppedRun({ project, publishSessionChanged }, context, stop)
  });
  const chatRecords = createTemporaryConversationRecords({ sessionAgent: {}, publishConversation: async () => {} });
  // The chat's read, as the next server makes it: Codex receives the record's mark.
  function readMark(method = "readConversation") {
    const context = { sessionId: SESSION_ID, runtime: null, session: null, routingConversationId: CHAT_ID };
    return provider.prepareConversationRequest(method, context, chatRecords.providerInput(records.get(CHAT_ID))).input.stoppedByShutdown;
  }
  return { records, checkpoints, deferCheckpoint, readMark };
}

test("a Codex chat turn stopped by shutdown leaves its checkpoint to the chat's next read, which makes it once", async () => {
  const f = fixture();
  await f.deferCheckpoint(SESSION_ID, { ...ENDING, status: "interrupted", turnOutcome: "service_restart" });
  assert.deepEqual(f.checkpoints, [], "shutdown made no checkpoint");
  assert.deepEqual(f.records.get(CHAT_ID).stoppedByShutdown,
    { runId: "turn-1", checkpointTurnId: OUTER_TURN_ID, routingConversationId: CHAT_ID, outcome: "interrupted" });
  assert.equal(f.records.get("chat-0").stoppedByShutdown, undefined, "only the turn's own chat is marked");

  const mark = f.readMark();
  assert.equal(mark.runId, "turn-1");
  await mark.ended();
  assert.deepEqual(f.checkpoints, [{ checkpointTurnId: OUTER_TURN_ID, checkpointOutcome: "interrupted" }]);
  assert.deepEqual(f.records.get(CHAT_ID).stoppedByShutdown, { runId: "turn-1", routingConversationId: CHAT_ID },
    "the run stays marked as interrupted, and its checkpoint is no longer owed");

  const later = f.readMark();
  assert.equal(later.runId, "turn-1");
  await later.ended();
  assert.equal(f.checkpoints.length, 1, "a later read makes no second checkpoint");
});

test("a Codex chat turn that ends on its own while the server stops leaves its own outcome's checkpoint to the next read", async () => {
  const f = fixture();
  await f.deferCheckpoint(SESSION_ID, { ...ENDING, status: "completed", turnOutcome: "" });
  assert.deepEqual(f.checkpoints, []);
  assert.equal(f.records.get(CHAT_ID).stoppedByShutdown.outcome, "completed");
  await f.readMark().ended();
  assert.deepEqual(f.checkpoints, [{ checkpointTurnId: OUTER_TURN_ID, checkpointOutcome: "completed" }]);
});

test("a Codex turn without a chat record leaves nothing, and an unmarked chat's read carries no mark", async () => {
  const f = fixture();
  await f.deferCheckpoint(SESSION_ID, { ...ENDING, threadId: "thread-unknown", status: "interrupted", turnOutcome: "service_restart" });
  assert.equal([...f.records.values()].some(record => record.stoppedByShutdown), false);
  assert.equal(f.readMark(), undefined);
  await f.deferCheckpoint(SESSION_ID, { ...ENDING, status: "interrupted", turnOutcome: "service_restart" });
  assert.equal(f.readMark("deleteConversation").ended, undefined, "only a read records the stopped run");
});
