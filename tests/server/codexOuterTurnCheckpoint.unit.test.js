import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkpointSessionTurn } from "../../packages/vibe64-terminals/src/server/sessionTurnCheckpoint.js";

import {
  withCodexState
} from "../../packages/vibe64-terminals/src/server/codexConversationStorage.js";

test("terminal state preserves the stable outer turn independently of provider successor turns", async () => {
  const state = withCodexState({}, {
    sessionId: "session-1",
    metadata: {},
    agentRuns: [{
      id: "codex_app_server",
      outerTurnId: "client-message-1",
      providerThreadId: "provider-thread",
      providerTurnId: "provider-successor-turn",
      state: "active"
    }]
  });
  assert.equal(state.codexAgentTurn.outerTurnId, "client-message-1");
  assert.equal(state.codexAgentTurn.turnId, "provider-successor-turn");
});

test("a new chat turn claims its client message id and stable terminal outcomes checkpoint it", async () => {
  const source = await readFile(new URL(
    "../../packages/vibe64-terminals/src/server/sessionTurnCheckpoint.js",
    import.meta.url
  ), "utf8");
  // Native dispatch lives in the common driver; application checkpoint projection
  // lives in the shared checkpoint owner. Inspect each operation at its current owner.
  const driverSource = await readFile(new URL("./providers/codexDriver.js",
    import.meta.resolve("@jskit-ai/assistant-core/server/conversation")), "utf8");
  assert.match(driverSource, /owner\.dispatchMessage\(sessionId, input/u);
  assert.match(source, /checkpointCodexAppServerTurn\(sessionId/u);
  assert.match(source, /checkpointSessionTurn\(\{/u);
});

test("shared turn checkpoints preserve outcome and expose recovery failures", async () => {
  const session = { sessionId: "session-1", sourcePath: "/tmp/session-source", metadata: {} };
  const changes = [];
  const runtime = {
    getSession: async () => session,
    store: { writeBackgroundTaskEvent: async (_id, _task, { patch }) => { changes.push(patch); return patch; } }
  };
  const input = { runtime, session, sessionId: session.sessionId, projectService: { readCurrentProject: async () => ({}) },
    outerTurnId: "claude:conversation:turn", outcome: "interrupted" };
  let received;
  const created = await checkpointSessionTurn({ ...input, createCheckpoint: async (value) => {
    received = value;
    return { created: true, commit: "a".repeat(40) };
  } });
  assert.equal(created.ok, true);
  assert.equal(received.outerTurnId, input.outerTurnId);
  assert.equal(received.outcome, "interrupted");
  assert.equal(changes.at(-1).status, "ready");
  const failed = await checkpointSessionTurn({ ...input, outerTurnId: "opencode:conversation:turn",
    createCheckpoint: async () => { throw new Error("Disk reserve is too low"); } });
  assert.equal(failed.ok, false);
  assert.equal(changes.at(-1).status, "failed");
  assert.match(changes.at(-1).error, /Disk reserve/u);
});
