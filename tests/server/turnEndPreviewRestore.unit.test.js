import assert from "node:assert/strict";
import test from "node:test";
import { createServiceTurnPublication } from "../../packages/vibe64-terminals/src/server/serviceTurnPublication.js";

// A browser test that replaced the person's Preview leaves it to be restored when the agent's turn ends
// (outputTargetPreviewTests.js): every engine's Main turn end and a temporary chat's turn end restore it, and nothing
// else in a turn does.

const SESSION = "2026-11-26_09-00-00";

function publication({ closing = false, restorePreviewAfterTurn } = {}) {
  const restored = [];
  const warnings = [];
  const work = [];
  const { publishAgentSessionChanged } = createServiceTurnPublication({
    afterRoutedTurn: async () => {},
    afterTemporaryTurn: async () => {},
    cancelGoalIfMainAiChanged: async () => false,
    continueGoalWhenLimitResets: async () => {},
    conversationTurns: { settled: async () => {} },
    finishInterruptedCloses: async () => {},
    restorePreviewAfterTurn: restorePreviewAfterTurn || ((sessionId) => { restored.push(sessionId); return null; }),
    summarizeTurnCommands: () => null,
    logger: { warn: (fields) => warnings.push(fields.event), info() {}, error() {}, debug() {} },
    providerUsage: { observe() {} },
    publishSessionChanged: { agentTerminal: async () => {} },
    resumeGoalAfterTurn: async () => false,
    state: { lifecycle: { closing }, trackShutdownWork: (promise) => { work.push(promise); return promise; } },
    workspacePreparation: { ensureWorkspacePrepared: async () => {} }
  });
  return {
    publish: async (reason) => {
      await publishAgentSessionChanged(SESSION, { reason });
      await Promise.all(work);
    },
    restored,
    warnings
  };
}

test("the end of a Main turn on any engine, or of a temporary chat's turn, restores a waiting Preview; other changes do not", async () => {
  const { publish, restored } = publication();
  for (const reason of ["claude-stream-turn-active", "agent-plan-usage", "codex-app-server-turn-active", ""]) await publish(reason);
  assert.deepEqual(restored, [], "a running turn may still repeat its test");
  for (const reason of ["claude-stream-turn-idle", "codex-app-server-turn-idle", "opencode-server-turn-idle", "temporary-agent-turn-idle"]) {
    await publish(reason);
  }
  assert.deepEqual(restored, [SESSION, SESSION, SESSION, SESSION]);

  const closing = publication({ closing: true });
  await closing.publish("claude-stream-turn-idle");
  assert.deepEqual(closing.restored, [], "a closing server restores nothing");
});

test("a turn-end restore that throws is logged, and the turn's other follow-ups still run", async () => {
  const { publish, warnings } = publication({ restorePreviewAfterTurn: async () => { throw new Error("terminal host gone"); } });
  await publish("claude-stream-turn-idle");
  assert.deepEqual(warnings, ["vibe64.preview_tests.restore_after_turn_failed"]);
});
