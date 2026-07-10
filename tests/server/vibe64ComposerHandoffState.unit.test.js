import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPOSER_HANDOFF_AGENT_RUN_ID,
  COMPOSER_HANDOFF_STATES,
  composerHandoffSnapshot,
  composerPromptHandoffForState,
  transitionComposerHandoff
} from "../../packages/vibe64-sessions/src/server/composer/handoffState.js";

function testRuntime() {
  const session = {
    actionResults: [],
    agentRuns: [],
    currentStep: "conversation",
    sessionId: "composer-handoff-test",
    stepMachine: {
      status: "awaiting_agent_result"
    }
  };
  return {
    async getSession() {
      return session;
    },
    session,
    store: {
      async writeAgentRunEvent(_sessionId, runId, {
        event = {},
        patch = {}
      } = {}) {
        const previous = session.agentRuns.find((run) => run.id === runId) || {
          events: [],
          id: runId
        };
        const terminal = ["completed", "failed", "interrupted"].includes(patch.state);
        const next = {
          ...previous,
          ...patch,
          active: !terminal,
          events: [...previous.events, event],
          id: runId
        };
        session.agentRuns = session.agentRuns.filter((run) => run.id !== runId).concat(next);
        return next;
      }
    }
  };
}

function promptHandoff(id = "handoff-1") {
  return {
    handoffId: id,
    kind: "agent_prompt_handoff",
    promptId: "conversation",
    terminalInput: "Please inspect the project."
  };
}

test("composer handoff state persists accepted, connecting, delivered, and active transitions", async () => {
  const runtime = testRuntime();

  const accepted = await transitionComposerHandoff(runtime, runtime.session.sessionId, {
    agentSettings: {
      providerId: "codex"
    },
    handoff: promptHandoff(),
    providerId: "codex",
    state: COMPOSER_HANDOFF_STATES.ACCEPTED,
    submissionId: "optimistic-composer-1",
    transportId: "codex_app_server"
  });
  assert.equal(accepted.state, "accepted");
  assert.equal(accepted.pending, true);
  assert.equal(accepted.submissionId, "optimistic-composer-1");

  const connecting = await transitionComposerHandoff(runtime, runtime.session.sessionId, {
    connectionReused: false,
    handoffId: accepted.id,
    state: COMPOSER_HANDOFF_STATES.CONNECTING
  });
  assert.equal(connecting.state, "connecting");
  assert.equal(connecting.connectionReused, false);

  const delivered = await transitionComposerHandoff(runtime, runtime.session.sessionId, {
    handoffId: accepted.id,
    state: COMPOSER_HANDOFF_STATES.DELIVERED,
    threadId: "thread-1",
    turnId: "turn-1"
  });
  assert.equal(delivered.state, "delivered");
  assert.equal(delivered.threadId, "thread-1");
  assert.equal(delivered.turnId, "turn-1");

  const active = await transitionComposerHandoff(runtime, runtime.session.sessionId, {
    handoffId: accepted.id,
    state: COMPOSER_HANDOFF_STATES.ACTIVE
  });
  assert.equal(active.state, "active");
  assert.equal(active.pending, false);
  const run = runtime.session.agentRuns.find((candidate) => candidate.id === COMPOSER_HANDOFF_AGENT_RUN_ID);
  assert.equal(run.state, "completed");
  assert.equal(run.active, false);
  assert.ok(active.acceptedAt);
  assert.ok(active.connectingAt);
  assert.ok(active.deliveredAt);
  assert.ok(active.activeAt);
});

test("warm composer handoffs may move directly from accepted to delivered", async () => {
  const runtime = testRuntime();
  await transitionComposerHandoff(runtime, runtime.session.sessionId, {
    handoff: promptHandoff(),
    providerId: "codex",
    state: COMPOSER_HANDOFF_STATES.ACCEPTED,
    transportId: "codex_app_server"
  });
  const delivered = await transitionComposerHandoff(runtime, runtime.session.sessionId, {
    connectionReused: true,
    handoffId: "handoff-1",
    state: COMPOSER_HANDOFF_STATES.DELIVERED,
    threadId: "thread-warm",
    turnId: "turn-warm"
  });
  assert.equal(delivered.connectingAt, "");
  assert.equal(delivered.connectionReused, true);
});

test("composer handoff state rejects skipped and overlapping transitions", async () => {
  const runtime = testRuntime();
  await transitionComposerHandoff(runtime, runtime.session.sessionId, {
    handoff: promptHandoff(),
    providerId: "codex",
    state: COMPOSER_HANDOFF_STATES.ACCEPTED,
    transportId: "codex_app_server"
  });
  await assert.rejects(
    transitionComposerHandoff(runtime, runtime.session.sessionId, {
      handoffId: "handoff-1",
      state: COMPOSER_HANDOFF_STATES.ACTIVE
    }),
    (error) => error?.code === "vibe64_composer_handoff_transition_invalid"
  );
  await assert.rejects(
    transitionComposerHandoff(runtime, runtime.session.sessionId, {
      handoff: promptHandoff("handoff-2"),
      providerId: "codex",
      state: COMPOSER_HANDOFF_STATES.ACCEPTED,
      transportId: "codex_app_server"
    }),
    (error) => error?.code === "vibe64_composer_handoff_transition_invalid"
  );
});

test("composer handoff state finds the private persisted prompt by canonical id", async () => {
  const runtime = testRuntime();
  runtime.session.actionResults.push({
    actionId: "talk_to_codex",
    agentPromptHandoff: promptHandoff()
  });
  await transitionComposerHandoff(runtime, runtime.session.sessionId, {
    handoff: promptHandoff(),
    providerId: "codex",
    state: COMPOSER_HANDOFF_STATES.ACCEPTED,
    transportId: "codex_app_server"
  });

  assert.equal(composerPromptHandoffForState(runtime.session)?.terminalInput, "Please inspect the project.");
  assert.equal(composerHandoffSnapshot(runtime.session)?.id, "handoff-1");
});
