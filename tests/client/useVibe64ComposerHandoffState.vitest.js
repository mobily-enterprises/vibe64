import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";

import {
  useVibe64ComposerHandoffState
} from "../../src/composables/vibe64-session/composer/useVibe64ComposerHandoffState.js";

function handoffStateTestHarness() {
  const createdAtMs = Date.now();
  const composerHandoff = ref(null);
  const optimisticComposerTurn = ref({
    createdAtMs,
    id: "local-submission",
    remote: false,
    status: "pending",
    text: "Local message"
  });
  const optimisticComposerSteers = ref([]);
  const remoteComposerSubmission = ref(null);
  const state = useVibe64ComposerHandoffState({
    composerHandoff,
    conversationComposerFallbackDraft: ref(""),
    optimisticComposerSteers,
    optimisticComposerTurn,
    remoteComposerSubmission
  });
  return {
    composerHandoff,
    createdAtMs,
    optimisticComposerSteers,
    optimisticComposerTurn,
    remoteComposerSubmission,
    state
  };
}

describe("useVibe64ComposerHandoffState", () => {
  it("keeps the local optimistic turn authoritative while another tab submits", () => {
    const harness = handoffStateTestHarness();

    expect(harness.state.applyRemoteComposerSubmissionStart({
      conversationRequest: "Remote message"
    }, {
      submissionId: "remote-submission",
      text: "Remote message",
      updatedAt: "2026-07-10T01:02:03.000Z"
    })).toBe(true);

    expect(harness.optimisticComposerTurn.value.id).toBe("local-submission");
    expect(harness.remoteComposerSubmission.value.optimisticTurn.id).toBe("remote-submission");
  });

  it("projects a pending remote turn after the server acknowledges the local turn", () => {
    const harness = handoffStateTestHarness();
    harness.state.applyRemoteComposerSubmissionStart({}, {
      submissionId: "remote-submission",
      text: "Remote message"
    });
    harness.composerHandoff.value = {
      canonical: true,
      submissionId: "local-submission"
    };

    expect(harness.state.clearLocalComposerSubmissionIfCanonical()).toBe(true);
    expect(harness.optimisticComposerTurn.value).toMatchObject({
      id: "remote-submission",
      remote: true,
      status: "pending"
    });
  });

  it("clears a server-acknowledged remote submission without touching a local turn", () => {
    const harness = handoffStateTestHarness();
    harness.state.applyRemoteComposerSubmissionStart({}, {
      submissionId: "remote-submission",
      text: "Remote message"
    });
    harness.composerHandoff.value = {
      canonical: true,
      submissionId: "remote-submission"
    };

    expect(harness.state.clearRemoteComposerSubmissionIfCanonical()).toBe(true);
    expect(harness.remoteComposerSubmission.value).toBeNull();
    expect(harness.optimisticComposerTurn.value.id).toBe("local-submission");
  });

  it("matches repeated optimistic text to canonical turns one-for-one", () => {
    const harness = handoffStateTestHarness();
    harness.optimisticComposerTurn.value.text = "Repeat this";
    harness.optimisticComposerSteers.value = [{
      createdAtMs: harness.createdAtMs + 1,
      id: "steer-submission",
      status: "pending",
      steering: true,
      text: "Repeat this"
    }];
    const canonicalTurn = {
      user: {
        at: new Date(harness.createdAtMs + 2).toISOString(),
        text: "Repeat this"
      }
    };

    expect(harness.state.reconcileOptimisticComposerSteers([canonicalTurn])).toBe(false);
    expect(harness.optimisticComposerSteers.value).toHaveLength(1);

    expect(harness.state.reconcileOptimisticComposerSteers([
      canonicalTurn,
      {
        user: {
          at: new Date(harness.createdAtMs + 3).toISOString(),
          text: "Repeat this"
        }
      }
    ])).toBe(true);
    expect(harness.optimisticComposerSteers.value).toEqual([]);
  });

  it("keeps a failed steer in chat and resends it through the live turn or a fresh turn", async () => {
    const submissionId = "composer:tab:message-2";
    const optimisticComposerTurn = ref(null);
    const optimisticComposerSteers = ref([
      {
        afterSubmissionId: "composer:tab:message-1",
        control: {
          id: "conversation_composer"
        },
        error: "",
        id: submissionId,
        options: {
          composerSubmissionId: submissionId,
          displayFields: {
            conversationRequest: "Please answer this too."
          },
          fields: {
            conversationRequest: "Please answer this too."
          },
          message: "Please answer this too."
        },
        status: "pending",
        steering: true,
        text: "Please answer this too.",
        values: {
          conversationRequest: "Please answer this too."
        }
      }
    ]);
    const runWorkflowControl = vi.fn(async () => true);
    const steerAgentTurn = vi.fn(async () => true);
    const steeringActive = ref(true);
    const state = useVibe64ComposerHandoffState({
      conversationComposerFallbackDraft: ref(""),
      newTurnControl: ref({
        id: "talk_to_codex"
      }),
      optimisticComposerSteers,
      optimisticComposerTurn,
      remoteComposerSubmission: ref(null),
      runWorkflowControl,
      steerAgentTurn,
      steeringActive
    });

    state.reconcileComposerControlOutcomes([
      {
        error: "Codex rejected the steer.",
        id: submissionId,
        state: "failed"
      }
    ]);
    expect(optimisticComposerSteers.value[0]).toMatchObject({
      error: "Codex rejected the steer.",
      id: submissionId,
      status: "failed"
    });

    expect(await state.resendOptimisticComposerTurn(submissionId)).toBe(true);
    expect(steerAgentTurn).toHaveBeenCalledWith({
      afterSubmissionId: "composer:tab:message-1",
      composerSubmissionId: submissionId,
      displayFields: {
        conversationRequest: "Please answer this too."
      },
      fields: {
        conversationRequest: "Please answer this too."
      },
      message: "Please answer this too."
    });
    expect(optimisticComposerSteers.value[0].status).toBe("pending");

    state.reconcileComposerControlOutcomes([
      {
        error: "The original turn ended.",
        id: submissionId,
        state: "failed"
      }
    ]);
    steeringActive.value = false;

    expect(await state.resendOptimisticComposerTurn(submissionId)).toBe(true);
    expect(runWorkflowControl).toHaveBeenCalledWith(
      {
        id: "talk_to_codex"
      },
      expect.objectContaining({
        composerSubmissionId: submissionId,
        message: "Please answer this too."
      })
    );
    expect(optimisticComposerSteers.value).toEqual([]);
    expect(optimisticComposerTurn.value).toMatchObject({
      error: "",
      id: submissionId,
      status: "pending",
      steering: false,
      text: "Please answer this too."
    });
  });

  it("rebuilds a failed steer from the durable server ledger after reload", async () => {
    const optimisticComposerSteers = ref([]);
    const steerAgentTurn = vi.fn(async () => true);
    const state = useVibe64ComposerHandoffState({
      composerHandoff: ref({
        submissionId: "composer:tab:message-1"
      }),
      conversationComposerFallbackDraft: ref(""),
      newTurnControl: ref({
        id: "talk_to_codex"
      }),
      optimisticComposerSteers,
      optimisticComposerTurn: ref(null),
      remoteComposerSubmission: ref(null),
      steerAgentTurn,
      steeringActive: ref(true)
    });

    expect(state.reconcileComposerControlOutcomes([
      {
        afterSubmissionId: "composer:tab:message-1",
        displayMessage: "Check the screenshot.",
        error: "The steer could not be delivered.",
        id: "composer:tab:message-2",
        kind: "steer",
        message: "Check the screenshot.\n\nAttached files:\n- image.png: /runtime/image.png",
        state: "failed",
        submittedAt: "2026-07-10T16:00:00.000Z"
      }
    ])).toBe(true);
    expect(optimisticComposerSteers.value[0]).toMatchObject({
      afterSubmissionId: "composer:tab:message-1",
      createdAt: "2026-07-10T16:00:00.000Z",
      error: "The steer could not be delivered.",
      id: "composer:tab:message-2",
      remote: true,
      status: "failed",
      text: "Check the screenshot."
    });

    expect(await state.resendOptimisticComposerTurn("composer:tab:message-2")).toBe(true);
    expect(steerAgentTurn).toHaveBeenCalledWith({
      afterSubmissionId: "composer:tab:message-1",
      composerSubmissionId: "composer:tab:message-2",
      displayFields: {
        conversationRequest: "Check the screenshot."
      },
      fields: {
        conversationRequest: "Check the screenshot.\n\nAttached files:\n- image.png: /runtime/image.png"
      },
      message: "Check the screenshot.\n\nAttached files:\n- image.png: /runtime/image.png"
    });
  });
});
