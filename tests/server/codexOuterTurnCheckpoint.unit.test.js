import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { checkpointSessionTurn } from "../../packages/vibe64-terminals/src/server/sessionTurnCheckpoint.js";

import {
  createCodexTerminalController
} from "../../packages/vibe64-terminals/src/server/codexTerminal.js";

test("terminal state preserves the stable outer turn independently of provider successor turns", async () => {
  const controller = createCodexTerminalController({
    projectService: {
      createSessionStore() {
        return {
          async readAgentRun() {
            return {
              id: "codex_app_server",
              outerTurnId: "client-message-1",
              providerThreadId: "provider-thread",
              providerTurnId: "provider-successor-turn",
              state: "active"
            };
          },
          async readMetadataValue() {
            return "";
          },
          async readSessionSourceDescriptor() {
            return {
              metadata: {},
              sessionId: "session-1"
            };
          }
        };
      }
    }
  });

  const state = await controller.terminalState("session-1");
  assert.equal(state.codexAgentTurn.outerTurnId, "client-message-1");
  assert.equal(state.codexAgentTurn.turnId, "provider-successor-turn");
});

test("a new chat turn claims its client message id and stable terminal outcomes checkpoint it", async () => {
  const source = await readFile(new URL(
    "../../packages/vibe64-terminals/src/server/codexTerminal.js",
    import.meta.url
  ), "utf8");

  assert.match(source, /claimCodexAppServerTurnStart\(runtime, sessionId, messageId\)/u);
  assert.match(source, /outerTurnId: normalizedOuterTurnId/u);
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
