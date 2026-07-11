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
  const optimisticComposerMessages = ref([]);
  const remoteComposerSubmission = ref(null);
  const state = useVibe64ComposerHandoffState({
    composerHandoff,
    conversationComposerFallbackDraft: ref(""),
    optimisticComposerMessages,
    optimisticComposerTurn,
    remoteComposerSubmission
  });
  return {
    composerHandoff,
    createdAtMs,
    optimisticComposerMessages,
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
    harness.optimisticComposerMessages.value = [{
      createdAtMs: harness.createdAtMs + 1,
      id: "message-submission",
      messageDelivery: true,
      status: "pending",
      text: "Repeat this"
    }];
    const canonicalTurn = {
      user: {
        at: new Date(harness.createdAtMs + 2).toISOString(),
        text: "Repeat this"
      }
    };

    expect(harness.state.reconcileOptimisticComposerMessages([canonicalTurn])).toBe(false);
    expect(harness.optimisticComposerMessages.value).toHaveLength(1);

    expect(harness.state.reconcileOptimisticComposerMessages([
      canonicalTurn,
      {
        user: {
          at: new Date(harness.createdAtMs + 3).toISOString(),
          text: "Repeat this"
        }
      }
    ])).toBe(true);
    expect(harness.optimisticComposerMessages.value).toEqual([]);
  });

  it("keeps a failed message in chat and always resends the same server operation", async () => {
    const submissionId = "composer:tab:message-2";
    const optimisticComposerTurn = ref(null);
    const optimisticComposerMessages = ref([
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
        messageDelivery: true,
        status: "pending",
        text: "Please answer this too.",
        values: {
          conversationRequest: "Please answer this too."
        }
      }
    ]);
    const sendAgentMessage = vi.fn(async () => true);
    const state = useVibe64ComposerHandoffState({
      conversationComposerFallbackDraft: ref(""),
      optimisticComposerMessages,
      optimisticComposerTurn,
      remoteComposerSubmission: ref(null),
      sendAgentMessage
    });

    state.reconcileComposerMessageOutcomes([
      {
        error: "Codex rejected the steer.",
        id: submissionId,
        state: "failed"
      }
    ]);
    expect(optimisticComposerMessages.value[0]).toMatchObject({
      error: "Codex rejected the steer.",
      id: submissionId,
      status: "failed"
    });

    expect(await state.resendOptimisticComposerTurn(submissionId)).toBe(true);
    expect(sendAgentMessage).toHaveBeenCalledWith({
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
    expect(optimisticComposerMessages.value[0].status).toBe("pending");

    state.reconcileComposerMessageOutcomes([
      {
        error: "The original turn ended.",
        id: submissionId,
        state: "failed"
      }
    ]);
    expect(await state.resendOptimisticComposerTurn(submissionId)).toBe(true);
    expect(sendAgentMessage).toHaveBeenCalledTimes(2);
    expect(sendAgentMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      composerSubmissionId: submissionId,
      message: "Please answer this too."
    }));
    expect(optimisticComposerMessages.value[0]).toMatchObject({
      error: "",
      id: submissionId,
      status: "pending",
      text: "Please answer this too."
    });
  });

  it("cancels a failed message durably before removing its chat bubble", async () => {
    const submissionId = "composer:tab:message-cancel";
    const optimisticComposerMessages = ref([{
      error: "Message delivery failed.",
      id: submissionId,
      messageDelivery: true,
      status: "failed",
      text: "Do not send this"
    }]);
    const cancelAgentMessage = vi.fn(async () => true);
    const state = useVibe64ComposerHandoffState({
      cancelAgentMessage,
      conversationComposerFallbackDraft: ref(""),
      optimisticComposerMessages,
      optimisticComposerTurn: ref(null),
      remoteComposerSubmission: ref(null)
    });

    expect(await state.cancelOptimisticComposerTurn(submissionId)).toBe(true);
    expect(cancelAgentMessage).toHaveBeenCalledWith({
      messageId: submissionId
    });
    expect(optimisticComposerMessages.value).toEqual([]);
  });

  it("keeps a failed bubble recoverable when durable cancellation fails", async () => {
    const submissionId = "composer:tab:message-cancel-failed";
    const optimisticComposerMessages = ref([{
      error: "Message delivery failed.",
      id: submissionId,
      messageDelivery: true,
      status: "failed",
      text: "Keep this visible"
    }]);
    const state = useVibe64ComposerHandoffState({
      cancelAgentMessage: vi.fn(async () => false),
      conversationComposerFallbackDraft: ref(""),
      optimisticComposerMessages,
      optimisticComposerTurn: ref(null),
      remoteComposerSubmission: ref(null)
    });

    expect(await state.cancelOptimisticComposerTurn(submissionId)).toBe(false);
    expect(optimisticComposerMessages.value).toEqual([
      expect.objectContaining({
        id: submissionId,
        status: "failed"
      })
    ]);
    expect(state.reconcileComposerMessageOutcomes([{
      id: submissionId,
      state: "cancelled"
    }])).toBe(true);
    expect(optimisticComposerMessages.value).toEqual([]);
  });

  it("settles only the delivered optimistic message while its canonical chat turn catches up", () => {
    const optimisticComposerMessages = ref([
      {
        createdAtMs: Date.now(),
        id: "composer:tab:message-1",
        messageDelivery: true,
        status: "pending",
        text: "First message"
      },
      {
        createdAtMs: Date.now(),
        id: "composer:tab:message-2",
        messageDelivery: true,
        status: "pending",
        text: "Second message"
      }
    ]);
    const state = useVibe64ComposerHandoffState({
      conversationComposerFallbackDraft: ref(""),
      optimisticComposerMessages,
      optimisticComposerTurn: ref(null),
      remoteComposerSubmission: ref(null)
    });

    expect(state.reconcileComposerMessageOutcomes([
      {
        id: "composer:tab:message-1",
        state: "delivered"
      }
    ])).toBe(true);
    expect(optimisticComposerMessages.value).toEqual([
      expect.objectContaining({
        id: "composer:tab:message-1",
        status: "delivered"
      }),
      expect.objectContaining({
        id: "composer:tab:message-2",
        status: "pending"
      })
    ]);

    expect(state.reconcileOptimisticComposerMessages([{
      turnId: "000001",
      user: {
        at: new Date().toISOString(),
        text: "First message"
      }
    }])).toBe(true);
    expect(optimisticComposerMessages.value).toEqual([
      expect.objectContaining({
        id: "composer:tab:message-2",
        status: "pending"
      })
    ]);
  });

  it("rebuilds a failed message from the durable server ledger after reload", async () => {
    const optimisticComposerMessages = ref([]);
    const sendAgentMessage = vi.fn(async () => true);
    const state = useVibe64ComposerHandoffState({
      composerHandoff: ref({
        submissionId: "composer:tab:message-1"
      }),
      conversationComposerFallbackDraft: ref(""),
      optimisticComposerMessages,
      optimisticComposerTurn: ref(null),
      remoteComposerSubmission: ref(null),
      sendAgentMessage
    });

    expect(state.reconcileComposerMessageOutcomes([
      {
        afterSubmissionId: "composer:tab:message-1",
        displayMessage: "Check the screenshot.",
        error: "The steer could not be delivered.",
        id: "composer:tab:message-2",
        message: "Check the screenshot.\n\nAttached files:\n- image.png: /runtime/image.png",
        state: "failed",
        submittedAt: "2026-07-10T16:00:00.000Z"
      }
    ])).toBe(true);
    expect(optimisticComposerMessages.value[0]).toMatchObject({
      afterSubmissionId: "composer:tab:message-1",
      createdAt: "2026-07-10T16:00:00.000Z",
      error: "The steer could not be delivered.",
      id: "composer:tab:message-2",
      remote: true,
      status: "failed",
      text: "Check the screenshot."
    });

    expect(await state.resendOptimisticComposerTurn("composer:tab:message-2")).toBe(true);
    expect(sendAgentMessage).toHaveBeenCalledWith({
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
