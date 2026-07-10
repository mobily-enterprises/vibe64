import { describe, expect, it } from "vitest";

import {
  passiveComposerAttachmentField,
  passiveComposerCanSteer,
  passiveComposerSteeringMode,
  passiveComposerShouldShow,
  passiveComposerSteerPayload
} from "../../src/lib/vibe64PassiveComposerSteer.js";
import {
  sessionGithubCommandActor
} from "../../src/lib/vibe64GitCommandActor.js";
import {
  createRemoteComposerOptimisticTurn
} from "../../src/lib/vibe64ComposerOptimisticTurn.js";
import {
  createComposerSubmissionId,
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

describe("sessionGithubCommandActor", () => {
  it("shows the session GitHub command actor from server metadata", () => {
    expect(sessionGithubCommandActor({
      metadata: {
        session_git_command_actor_scope: "user",
        session_git_command_actor_user_key: "tonymobily"
      }
    })).toEqual({
      active: true,
      displayLabel: "tonymobily",
      label: "GitHub: tonymobily",
      title: "GitHub commands for this session run as tonymobily."
    });
  });

  it("shows the sticky GitHub actor without an active-turn flag", () => {
    expect(sessionGithubCommandActor({
      metadata: {
        session_git_command_actor_user_key: "dave"
      }
    })).toEqual({
      active: true,
      displayLabel: "dave",
      label: "GitHub: dave",
      title: "GitHub commands for this session run as dave."
    });
  });
});

describe("Vibe64 passive composer steer state", () => {
  it("shows the passive composer during active assistant steer turns", () => {
    const steeringActive = passiveComposerCanSteer({
      agentSteeringAvailable: true,
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
      agentSteeringAvailable: false,
      selectedScreenControlVisible: false
    });
    const steeringMode = passiveComposerSteeringMode({
      agentSteeringAvailable: false,
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

  it("enters passive steer mode while assistant turn metadata refreshes", () => {
    const steeringActive = passiveComposerCanSteer({
      agentSteeringAvailable: false,
      selectedScreenControlVisible: false
    });
    const steeringMode = passiveComposerSteeringMode({
      agentInteractionLocked: true,
      agentSteeringAvailable: false,
      selectedScreenControlVisible: false,
      steeringDraftActive: false
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

  it("keeps the passive composer mounted during a local assistant handoff", () => {
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
      agentSteeringAvailable: true,
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
        path: "/tmp/vibe64-attachments/session/screenshot.png",
        fileName: "screenshot.png",
        size: 2048
      }
    ];

    expect(passiveComposerAttachmentField({
      attachmentFields: {
        conversationRequest: attachments
      }
    })).toEqual(attachments);
    expect(passiveComposerSteerPayload("Please inspect this.", {
      attachmentFields: {
        conversationRequest: attachments
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
          "- screenshot.png (2.0 KB): /tmp/vibe64-attachments/session/screenshot.png"
        ].join("\n")
      },
      message: [
        "Please inspect this.",
        "",
        "Attached files for Codex:",
        "- screenshot.png (2.0 KB): /tmp/vibe64-attachments/session/screenshot.png"
      ].join("\n")
    });
  });
});

describe("vibe64 composer submission state", () => {
  it("does not expose assistant stop controls during browser-only handoff", () => {
    expect(vibe64ComposerSubmissionStatusState({
      localComposerSubmissionPending: true
    })).toEqual({
      agentStopEnabled: false,
      agentStopVisible: false,
      browserHandoffPending: true,
      handoffPending: true,
      thinkingLabel: "Sending to assistant..."
    });

    expect(vibe64ComposerSubmissionStatusState({
      remoteComposerSubmissionPending: true
    })).toEqual({
      agentStopEnabled: false,
      agentStopVisible: false,
      browserHandoffPending: true,
      handoffPending: true,
      thinkingLabel: "Sending to assistant..."
    });

    expect(vibe64ComposerSubmissionStatusState({
      agentHandoffLabel: "Connecting to assistant...",
      agentInterruptVisible: true,
      agentTurnActive: true,
      localComposerSubmissionPending: true
    })).toEqual({
      agentStopEnabled: true,
      agentStopVisible: true,
      browserHandoffPending: true,
      handoffPending: true,
      thinkingLabel: "Assistant is working..."
    });

    expect(vibe64ComposerSubmissionStatusState({
      agentInterruptBlocked: true,
      agentInterruptVisible: true,
      agentTurnActive: true
    })).toEqual({
      agentStopEnabled: false,
      agentStopVisible: true,
      browserHandoffPending: false,
      handoffPending: false,
      thinkingLabel: "Assistant is working..."
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

  it("creates submission ids that are unique within one browser origin", () => {
    const first = createComposerSubmissionId({
      now: 1234,
      originId: "tab:test",
      sequence: 1
    });
    const second = createComposerSubmissionId({
      now: 1234,
      originId: "tab:test",
      sequence: 2
    });

    expect(first).toBe("composer:tab:test:ya:1");
    expect(second).toBe("composer:tab:test:ya:2");
    expect(first).not.toBe(second);
  });
});
