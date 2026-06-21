import { describe, expect, it } from "vitest";

import {
  createRemoteComposerOptimisticTurn
} from "../../src/lib/vibe64ComposerOptimisticTurn.js";
import {
  localComposerSubmissionCanClear,
  optimisticComposerTurnIsLocalPending,
  vibe64ComposerSubmissionStatusState
} from "../../src/lib/vibe64ComposerSubmissionState.js";

describe("createRemoteComposerOptimisticTurn", () => {
  it("builds a remote pending chat turn from a submit-start payload", () => {
    const turn = createRemoteComposerOptimisticTurn({
      control: {
        id: "talk_to_codex"
      },
      fields: {
        conversationRequest: "This is a test"
      },
      id: "remote-composer-1",
      payload: {
        updatedAt: "2026-06-16T02:03:04.000Z"
      },
      text: "This is a test"
    });

    expect(turn).toEqual({
      control: {
        id: "talk_to_codex"
      },
      createdAt: "2026-06-16T02:03:04.000Z",
      createdAtMs: Date.parse("2026-06-16T02:03:04.000Z"),
      error: "",
      id: "remote-composer-1",
      options: {
        fields: {
          conversationRequest: "This is a test"
        }
      },
      remote: true,
      status: "pending",
      text: "This is a test",
      values: {
        conversationRequest: "This is a test"
      }
    });
  });

  it("does not create a remote pending turn without visible text", () => {
    expect(createRemoteComposerOptimisticTurn({
      fields: {
        conversationRequest: ""
      }
    })).toBeNull();
  });
});

describe("vibe64 composer submission state", () => {
  it("does not expose Stop Codex during local handoff", () => {
    expect(vibe64ComposerSubmissionStatusState({
      localComposerSubmissionPending: true
    })).toEqual({
      codexHandoffPending: true,
      codexStopEnabled: false,
      codexStopVisible: false,
      thinkingLabel: "Sending to Codex..."
    });

    expect(vibe64ComposerSubmissionStatusState({
      codexInterruptVisible: true,
      localComposerSubmissionPending: true
    })).toEqual({
      codexHandoffPending: false,
      codexStopEnabled: true,
      codexStopVisible: true,
      thinkingLabel: "Thinking..."
    });

    expect(vibe64ComposerSubmissionStatusState({
      codexInterruptBlocked: true,
      codexInterruptVisible: true
    })).toEqual({
      codexHandoffPending: false,
      codexStopEnabled: false,
      codexStopVisible: true,
      thinkingLabel: "Thinking..."
    });
  });

  it("treats only local pending optimistic turns as local submissions", () => {
    expect(optimisticComposerTurnIsLocalPending({
      status: "pending",
      text: "Build it."
    })).toBe(true);
    expect(optimisticComposerTurnIsLocalPending({
      remote: true,
      status: "pending",
      text: "Build it."
    })).toBe(false);
    expect(optimisticComposerTurnIsLocalPending({
      status: "failed",
      text: "Build it."
    })).toBe(false);
  });

  it("clears a local pending submission only after canonical acknowledgement and takeover", () => {
    const optimisticTurn = {
      status: "pending",
      text: "Build the smallest useful version."
    };

    expect(localComposerSubmissionCanClear({
      optimisticTurn,
      codexHandoffComplete: true,
      submittedText: ""
    })).toBe(false);
    expect(localComposerSubmissionCanClear({
      optimisticTurn,
      codexHandoffComplete: false,
      submittedText: "Build the smallest useful version."
    })).toBe(false);
    expect(localComposerSubmissionCanClear({
      optimisticTurn,
      serverBusy: true,
      submittedText: "Build the smallest useful version."
    })).toBe(false);
    expect(localComposerSubmissionCanClear({
      optimisticTurn,
      codexHandoffComplete: true,
      submittedText: "Build the smallest useful version."
    })).toBe(true);
    expect(localComposerSubmissionCanClear({
      assistantReplyText: "What should we build next?",
      optimisticTurn,
      submittedText: "Build the smallest useful version."
    })).toBe(true);
  });
});
