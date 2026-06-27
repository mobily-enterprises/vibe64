import { describe, expect, it } from "vitest";

import {
  passiveComposerAttachmentField,
  passiveComposerCanSteer,
  passiveComposerSteeringMode,
  passiveComposerShouldShow,
  passiveComposerSteerPayload
} from "../../src/lib/vibe64PassiveComposerSteer.js";
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

describe("Vibe64 passive composer steer state", () => {
  it("shows the passive composer during active Codex steer turns", () => {
    const steeringActive = passiveComposerCanSteer({
      codexSteerAvailable: true,
      selectedScreenControlVisible: false
    });

    expect(steeringActive).toBe(true);
    expect(passiveComposerShouldShow({
      composerInputLocked: true,
      selectedScreenControlVisible: false,
      steeringActive,
      stepInputFormVisible: false,
      workflowControlsAvailable: true
    })).toBe(true);
  });

  it("keeps an unsent steer draft visible during transient turn metadata gaps", () => {
    const steeringActive = passiveComposerCanSteer({
      codexSteerAvailable: false,
      selectedScreenControlVisible: false
    });
    const steeringMode = passiveComposerSteeringMode({
      codexSteerAvailable: false,
      selectedScreenControlVisible: false,
      steeringDraftActive: true
    });

    expect(steeringActive).toBe(false);
    expect(steeringMode).toBe(true);
    expect(passiveComposerShouldShow({
      composerInputLocked: true,
      selectedScreenControlVisible: false,
      steeringActive: steeringMode,
      stepInputFormVisible: false,
      workflowControlsAvailable: true
    })).toBe(true);
  });

  it("keeps the empty passive composer mounted but disabled while Codex turn metadata refreshes", () => {
    const steeringActive = passiveComposerCanSteer({
      codexSteerAvailable: false,
      selectedScreenControlVisible: false
    });
    const steeringMode = passiveComposerSteeringMode({
      codexInteractionLocked: true,
      codexSteerAvailable: false,
      selectedScreenControlVisible: false,
      steeringDraftActive: false
    });

    expect(steeringActive).toBe(false);
    expect(steeringMode).toBe(false);
    expect(passiveComposerShouldShow({
      composerInputLocked: true,
      selectedScreenControlVisible: false,
      steeringActive: steeringMode,
      stepInputFormVisible: false,
      workflowControlsAvailable: true
    })).toBe(true);
  });

  it("shows the passive composer over idle workflow choices", () => {
    expect(passiveComposerShouldShow({
      composerInputLocked: false,
      selectedScreenControlVisible: false,
      steeringActive: false,
      stepInputFormVisible: false,
      workflowControlsAvailable: true
    })).toBe(true);
  });

  it("keeps the passive composer visible while input is locked without steer mode", () => {
    expect(passiveComposerShouldShow({
      composerInputLocked: true,
      selectedScreenControlVisible: false,
      steeringActive: false,
      stepInputFormVisible: false,
      workflowControlsAvailable: true
    })).toBe(true);
  });

  it("keeps the passive composer mounted during local Codex handoff", () => {
    expect(passiveComposerShouldShow({
      composerInputLocked: true,
      handoffPending: true,
      selectedScreenControlVisible: false,
      steeringActive: false,
      stepInputFormVisible: false
    })).toBe(true);
  });

  it("does not steal the selected primary steer form", () => {
    const steeringActive = passiveComposerCanSteer({
      codexSteerAvailable: true,
      selectedScreenControlVisible: true
    });

    expect(steeringActive).toBe(false);
    expect(passiveComposerShouldShow({
      composerInputLocked: true,
      selectedScreenControlVisible: true,
      steeringActive,
      stepInputFormVisible: false
    })).toBe(false);
  });

  it("builds the existing Codex steer payload from passive composer text", () => {
    expect(passiveComposerSteerPayload("  Tighten the tests.  ")).toEqual({
      displayFields: {
        conversationRequest: "Tighten the tests."
      },
      fields: {
        conversationRequest: "Tighten the tests."
      },
      message: "Tighten the tests."
    });
    expect(passiveComposerSteerPayload("   ")).toBeNull();
  });

  it("adds passive composer attachment references to the Codex steer payload", () => {
    const attachments = [
      {
        containerPath: "/studio-attachments/session/screenshot.png",
        fileName: "screenshot.png",
        size: 2048
      }
    ];

    expect(passiveComposerAttachmentField({
      attachmentFields: {
        message: attachments
      }
    })).toEqual(attachments);
    expect(passiveComposerSteerPayload("Please inspect this.", {
      attachmentFields: {
        message: attachments
      }
    })).toEqual({
      displayFields: {
        conversationRequest: [
          "Please inspect this.",
          "",
          "screenshot.png"
        ].join("\n")
      },
      fields: {
        conversationRequest: [
          "Please inspect this.",
          "",
          "Attached files for Codex:",
          "- screenshot.png (2.0 KB): /studio-attachments/session/screenshot.png"
        ].join("\n")
      },
      message: [
        "Please inspect this.",
        "",
        "Attached files for Codex:",
        "- screenshot.png (2.0 KB): /studio-attachments/session/screenshot.png"
      ].join("\n")
    });
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
