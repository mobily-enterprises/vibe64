import { ref } from "vue";
import { describe, expect, it } from "vitest";

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
});
