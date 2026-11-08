import assert from "node:assert/strict";
import test from "node:test";
import { createOpenCodeConversationEvents } from "../../packages/vibe64-terminals/src/server/openCodeConversationEvents.js";
import { createOpenCodeScopedPreparation } from "../../packages/vibe64-terminals/src/server/openCodeScopedPreparation.js";
import { createTemporaryConversationRecords } from "../../packages/vibe64-terminals/src/server/temporaryConversationRecords.js";

const SESSION_ID = "session-1";
const CHAT_ID = "chat-1";
const OUTER_TURN_ID = "opencode:ses_chat:msg_run";

// A session store whose turn checkpoints are observed, not made: the project
// cannot be read, so each checkpoint is recorded as attempted without a Git snapshot.
function fixture() {
  const records = new Map([[CHAT_ID, { conversationId: CHAT_ID, providerConversationId: "ses_chat", runId: "msg_run", status: "inProgress" }]]);
  const checkpoints = [];
  const runs = [];
  const session = { sessionId: SESSION_ID, sourcePath: "/sessions/session-1", metadata: {} };
  const store = {
    async readSessionConversation(_sessionId, id) { return records.get(id) || null; },
    async writeSessionConversation(_sessionId, id, patch) {
      const record = { ...records.get(id), ...patch, conversationId: id };
      records.set(id, record);
      return record;
    },
    async writeBackgroundTaskEvent(_sessionId, _taskId, { patch }) {
      checkpoints.push({ checkpointTurnId: patch.checkpointTurnId, checkpointOutcome: patch.checkpointOutcome });
      return patch;
    },
    async writeAgentRunEvent(_sessionId, _runId, { patch }) { runs.push(patch); return patch; },
    async mutateSession(_sessionId, operation) { return operation(); },
    clearConversationStream() { return null; }
  };
  const runtime = { store, async getSessionWithoutSource() { return session; } };
  const context = { sessionId: SESSION_ID, key: `project\0${SESSION_ID}`, runtime, session,
    selection: { modelId: "model", modelProviderId: "provider" }, assistantScope: null };
  const project = { async readCurrentProject() { throw new Error("This test makes no Git snapshot."); } };
  const publishSessionChanged = async () => {};
  const scoped = createOpenCodeScopedPreparation({
    project,
    contextFor: async () => context,
    hostPreparation: {
      async prepareProcess() { return {}; },
      sharedRoots: () => ({ workdir: "/shared" }),
      promptContext: () => null,
      async writeSessionEnvironmentRegistry() {}
    },
    events: { detachedObservationProjection: () => ({}) },
    publishSessionChanged,
    trackShutdownWork: work => work,
    prepareSessionCleanup: async () => null,
    logger: { warn() {}, info() {} }
  });
  const events = createOpenCodeConversationEvents({ project, publishSessionChanged, trackShutdownWork: work => work,
    sharedRuntime: { turns: new Map(), temporaryConversations: new Map() }, presentation: {} });
  const chatRecords = createTemporaryConversationRecords({ sessionAgent: {}, publishConversation: async () => {} });
  async function turnEnd() {
    const prepared = await scoped.prepareDetachedChatTurn(SESSION_ID, { prompt: "Fix it", persistent: true, messageId: "m1" },
      { routingConversationId: CHAT_ID });
    return prepared.turn({ conversationId: "ses_chat", tracked: { inputMessageId: "msg_run" } }).options.completion.afterClose;
  }
  // The chat's read, as the next server makes it: OpenCode receives the record's mark.
  async function readMark() {
    const existing = await scoped.prepareExistingDetachedTarget(SESSION_ID, chatRecords.providerInput(records.get(CHAT_ID)), {});
    return existing.messages.stoppedByShutdown;
  }
  return { records, checkpoints, runs, context, events, turnEnd, readMark };
}

test("an OpenCode chat turn stopped by shutdown leaves its checkpoint to the chat's next read, which makes it once", async () => {
  const f = fixture();
  await (await f.turnEnd())({ stopped: true, outcome: "interrupted", stoppedByShutdown: true });
  assert.deepEqual(f.checkpoints, [], "shutdown made no checkpoint");
  assert.deepEqual(f.records.get(CHAT_ID).stoppedByShutdown,
    { runId: "msg_run", checkpointTurnId: OUTER_TURN_ID, routingConversationId: CHAT_ID });
  assert.equal(f.records.get(CHAT_ID).status, "inProgress", "the turn's end is left to the next server");

  const mark = await f.readMark();
  assert.equal(mark.runId, "msg_run");
  await mark.ended();
  assert.deepEqual(f.checkpoints, [{ checkpointTurnId: OUTER_TURN_ID, checkpointOutcome: "interrupted" }]);
  assert.deepEqual(f.records.get(CHAT_ID).stoppedByShutdown, { runId: "msg_run", routingConversationId: CHAT_ID },
    "the run stays marked as interrupted, and its checkpoint is no longer owed");

  const later = await f.readMark();
  assert.equal(later.runId, "msg_run");
  await later.ended();
  assert.equal(f.checkpoints.length, 1, "a later read makes no second checkpoint");
});

test("outside shutdown an OpenCode chat turn's end still makes its checkpoint at once, and an unmarked chat has no mark", async () => {
  const f = fixture();
  await (await f.turnEnd())({ stopped: true, outcome: "failed", stoppedByShutdown: false });
  assert.deepEqual(f.checkpoints, [{ checkpointTurnId: OUTER_TURN_ID, checkpointOutcome: "failed" }]);
  assert.equal(f.records.get(CHAT_ID).stoppedByShutdown, undefined);
  assert.equal(await f.readMark(), null);
});

test("an OpenCode main run keeps the shutdown's mark while active, and its recorded end makes the interrupted checkpoint", async () => {
  const f = fixture();
  const turn = { id: "msg_main", threadId: "ses_main", startedAt: "2026-11-05T00:00:00.000Z", stoppedByShutdown: true };
  await f.events.writeRun(f.context, turn, "active", "");
  assert.deepEqual(f.checkpoints, [], "the shutdown's write makes no checkpoint");
  assert.deepEqual({ state: f.runs[0].state, stoppedByShutdown: f.runs[0].stoppedByShutdown }, { state: "active", stoppedByShutdown: true });
  await f.events.writeRun(f.context, { ...turn, updatedAt: "2026-11-05T00:01:00.000Z" }, "interrupted", "");
  assert.deepEqual(f.checkpoints, [{ checkpointTurnId: "opencode:ses_main:msg_main", checkpointOutcome: "interrupted" }]);
  await f.events.writeRun(f.context, { id: "msg_next", threadId: "ses_main" }, "active", "");
  assert.equal(f.runs.at(-1).stoppedByShutdown, false, "a new turn carries no mark");
});
