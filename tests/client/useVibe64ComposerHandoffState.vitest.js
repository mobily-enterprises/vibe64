import { ref } from "vue";
import { describe, expect, it } from "vitest";

import {
  useVibe64ComposerHandoffState
} from "../../src/composables/vibe64-session/composer/useVibe64ComposerHandoffState.js";

function handoffStateTestHarness() {
  const composerHandoff = ref(null);
  const optimisticComposerTurn = ref({
    id: "local-submission",
    remote: false,
    status: "pending",
    text: "Local message"
  });
  const remoteComposerSubmission = ref(null);
  const state = useVibe64ComposerHandoffState({
    composerHandoff,
    conversationComposerFallbackDraft: ref(""),
    optimisticComposerTurn,
    remoteComposerSubmission
  });
  return {
    composerHandoff,
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
});
