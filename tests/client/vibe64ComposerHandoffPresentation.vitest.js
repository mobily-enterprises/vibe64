import { describe, expect, it } from "vitest";
import {
  canonicalHandoffAcknowledgesOptimisticTurn
} from "../../src/composables/vibe64-session/composer/useVibe64ComposerHandoffState.js";
import {
  composerHandoffPresentation
} from "../../src/composables/vibe64-session/composer/useVibe64ComposerHandoffPresentation.js";

describe("composer handoff presentation", () => {
  it("clears browser optimism only for the exact server-acknowledged submission", () => {
    const optimistic = {
      id: "optimistic-composer-4"
    };

    expect(canonicalHandoffAcknowledgesOptimisticTurn({
      canonical: true,
      submissionId: "optimistic-composer-4"
    }, optimistic)).toBe(true);
    expect(canonicalHandoffAcknowledgesOptimisticTurn({
      canonical: true,
      submissionId: "optimistic-composer-3"
    }, optimistic)).toBe(false);
  });

  it("projects each canonical server phase without inventing connection state", () => {
    expect(composerHandoffPresentation({ state: "accepted" })).toMatchObject({
      label: "Sending to assistant...",
      pending: true
    });
    expect(composerHandoffPresentation({ state: "connecting" })).toMatchObject({
      label: "Connecting to assistant...",
      pending: true
    });
    expect(composerHandoffPresentation({ state: "delivered" })).toMatchObject({
      label: "Starting assistant...",
      pending: true
    });
    expect(composerHandoffPresentation({ state: "active" })).toMatchObject({
      label: "",
      pending: false
    });
  });

  it("projects durable server failures", () => {
    expect(composerHandoffPresentation({
      error: "Provider could not connect.",
      state: "failed"
    })).toMatchObject({
      error: "Provider could not connect.",
      pending: false
    });
  });
});
