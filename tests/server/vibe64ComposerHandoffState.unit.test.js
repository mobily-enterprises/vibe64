import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPOSER_CONTROL_KINDS,
  COMPOSER_HANDOFF_AGENT_RUN_ID,
  COMPOSER_HANDOFF_STATES,
  acceptComposerControl,
  composerControlRequests,
  composerHandoffSnapshot,
  composerPromptHandoffForState,
  pendingComposerControls,
  settleComposerControl,
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
          events: [
            ...previous.events,
            {
              ...event,
              at: event.at || patch.updatedAt || new Date().toISOString()
            }
          ],
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

test("composer handoff state keeps ordered controls accepted before provider activation", async () => {
  const runtime = testRuntime();
  const first = await acceptComposerControl(runtime, runtime.session.sessionId, {
    afterSubmissionId: "initial-submission",
    controlRequestId: "steer-1",
    displayFields: {
      conversationRequest: "First follow-up"
    },
    fields: {
      conversationRequest: "First follow-up"
    },
    kind: COMPOSER_CONTROL_KINDS.STEER,
    message: "First follow-up",
    originId: "browser-1"
  });
  await acceptComposerControl(runtime, runtime.session.sessionId, {
    afterSubmissionId: "initial-submission",
    controlRequestId: "interrupt-1",
    kind: COMPOSER_CONTROL_KINDS.INTERRUPT,
    originId: "browser-1",
    reason: "user_interrupt"
  });
  await acceptComposerControl(runtime, runtime.session.sessionId, {
    afterSubmissionId: "initial-submission",
    controlRequestId: "steer-2",
    kind: COMPOSER_CONTROL_KINDS.STEER,
    message: "Second follow-up",
    originId: "browser-1"
  });

  assert.equal(composerHandoffSnapshot(runtime.session), null);
  assert.equal(first.state, "accepted");
  assert.deepEqual(
    pendingComposerControls(runtime.session).map((request) => request.controlRequestId),
    ["steer-1", "interrupt-1", "steer-2"]
  );

  await transitionComposerHandoff(runtime, runtime.session.sessionId, {
    handoff: promptHandoff(),
    providerId: "future-provider",
    state: COMPOSER_HANDOFF_STATES.ACCEPTED,
    submissionId: "initial-submission",
    transportId: "future-transport"
  });
  await settleComposerControl(runtime, runtime.session.sessionId, "steer-1", {
    state: "delivered"
  });

  assert.deepEqual(
    pendingComposerControls(runtime.session, "initial-submission")
      .map((request) => request.controlRequestId),
    ["interrupt-1", "steer-2"]
  );
  assert.deepEqual(
    composerControlRequests(runtime.session).map(({ controlRequestId, kind, state }) => ({
      controlRequestId,
      kind,
      state
    })),
    [
      {
        controlRequestId: "steer-1",
        kind: "steer",
        state: "delivered"
      },
      {
        controlRequestId: "interrupt-1",
        kind: "interrupt",
        state: "accepted"
      },
      {
        controlRequestId: "steer-2",
        kind: "steer",
        state: "accepted"
      }
    ]
  );
});
