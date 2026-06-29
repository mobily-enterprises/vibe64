import { nextTick, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";

vi.mock("vue-router", () => ({
  useRoute: () => ({
    params: {
      slug: "draft-test"
    }
  })
}));
vi.mock("@/components/studio/Vibe64FixCodexDialog.vue", () => ({
  default: {
    name: "Vibe64FixCodexDialog"
  }
}));
vi.mock("../../src/components/studio/Vibe64FixCodexDialog.vue", () => ({
  default: {
    name: "Vibe64FixCodexDialog"
  }
}));
vi.mock("@/components/common/Vibe64AsyncModuleState.vue", () => ({
  default: {
    name: "Vibe64AsyncModuleState"
  }
}));
vi.mock("@/composables/useVibe64ProjectScope.js", async () => {
  const {
    ref
  } = await import("vue");
  return {
    useVibe64ProjectSlug: () => ref("draft-test")
  };
});
vi.mock("@/composables/useVibe64AgentSettings.js", async () => {
  const {
    ref
  } = await import("vue");
  return {
    useVibe64AgentSettings: () => ({
      settings: ref({}),
      update: () => null
    })
  };
});
vi.mock("@/composables/useVibe64AutopilotController.js", async () => {
  const {
    computed,
    ref
  } = await import("vue");
  return {
    useVibe64AutopilotController: ({
      session
    } = {}) => ({
      canDispatchNextOperation: ref(false),
      clearFailure: () => null,
      commandOutput: ref(""),
      commandPreview: ref(""),
      commandResult: ref(null),
      commandRunning: ref(false),
      failure: ref(null),
      nextOperationKey: ref(""),
      recoverStuckStep: async () => false,
      retry: async () => false,
      runCommandAction: async () => false,
      runNextOperation: async () => false,
      runPresentedIntent: async () => false,
      running: ref(false),
      screenState: computed(() => {
        const screen = session?.value?.presentation?.screen || {};
        return {
          icon: screen.icon || "cog",
          input: null,
          kind: screen.kind || "idle",
          message: screen.message || "",
          primaryIntentId: screen.primaryIntentId || "",
          sections: [],
          showProgress: false,
          stopAction: "",
          title: screen.title || "Vibe64",
          variant: ""
        };
      }),
      stop: () => null,
      stopCommandAction: null,
      stuckRecoveryAvailable: ref(false),
      stuckRecoveryRunning: ref(false)
    })
  };
});
vi.mock("@/composables/useVibe64BackgroundTasks.js", async () => {
  const {
    ref
  } = await import("vue");
  return {
    useVibe64BackgroundTasks: () => ({
      backgroundTaskError: ref(""),
      retryBackgroundTask: async () => false,
      retryingTaskId: ref(""),
      retryingBackgroundTaskId: ref(""),
      visibleBackgroundTasks: ref([])
    })
  };
});
vi.mock("@/composables/useVibe64ClientControls.js", () => ({
  useVibe64ClientControls: () => ({
    runClientControl: async () => false
  })
}));
vi.mock("@/composables/useVibe64FixCodexDialog.js", async () => {
  const {
    ref
  } = await import("vue");
  return {
    useVibe64FixCodexDialog: () => ({
      fixDialogOpen: ref(false),
      fixJob: ref(null),
      fixTerminal: ref(null),
      openFixCodexDialog: () => null
    })
  };
});
vi.mock("@/composables/useVibe64TerminalFailureFixCommand.js", () => ({
  useVibe64TerminalFailureFixCommand: () => ({
    request: async () => null
  })
}));
vi.mock("@/composables/useVibe64StepInputForm.js", async () => {
  const {
    reactive
  } = await import("vue");
  return {
    useVibe64StepInputForm: () => reactive({
      canSubmit: false,
      displayFields: [],
      error: "",
      fields: [],
      interaction: null,
      prompt: "",
      saving: false,
      submit: async () => false,
      updateValue: () => null,
      values: {},
      visible: false
    })
  };
});

function conversationControl() {
  return {
    enabled: true,
    id: "talk_to_codex",
    inputFields: [
      {
        kind: "textarea",
        label: "Message",
        name: "conversationRequest",
        required: true,
        value: ""
      }
    ],
    label: "Send",
    style: "primary"
  };
}

function viewProps(overrides = {}) {
  return reactive({
    actions: {
      currentActions: []
    },
    active: true,
    automationEnabled: true,
    autopilotSteps: [],
    chatCollapsed: false,
    codexThinking: true,
    commandRunner: null,
    conversationLog: {
      turns: []
    },
    diff: {},
    humanInputResponsePreview: {},
    interruptCodexTurn: async () => false,
    page: {},
    projectPane: "preview",
    refreshSessionData: async () => null,
    reportPreview: {},
    review: {},
    rewindBusy: false,
    rewindToStep: null,
    session: {
      codexAgentTurn: {},
      codexTerminal: {
        commandPreview: "codex",
        id: "terminal-1",
        status: "running"
      },
      presentation: {
        intents: [
          conversationControl()
        ],
        screen: {
          primaryIntentId: "talk_to_codex",
          title: "Codex is working"
        }
      },
      sessionId: "session-1"
    },
    sessionAbandon: {},
    sessionSelectionClosed: false,
    sessionToolbar: {},
    sessionsApiPath: "",
    steerCodexTurn: async () => true,
    ...overrides
  });
}

describe("useVibe64AutopilotView composer draft ownership", () => {
  it("enables the session Config tool for pending bootstrap config before source materialization", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      projectContext: {
        projectConfig: {
          bootstrap: true
        }
      }
    });
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    const configTool = view.sessionToolControls.value.find((tool) => tool.id === "config");
    expect(view.sessionConfigSourceReady.value).toBe(false);
    expect(view.sessionConfigEditable.value).toBe(true);
    expect(configTool.disabled).toBe(false);
    expect(configTool.title).toBe("Edit pending seed config before the session source exists");
  });

  it("maps composer lock sources to user-visible reasons", async () => {
    const {
      composerInputDisabledReason
    } = await import("../../src/composables/useVibe64AutopilotView.js");

    expect(composerInputDisabledReason({
      pageBusy: true
    })).toBe("");
    expect(composerInputDisabledReason({
      disabled: true,
      pageBusy: true
    })).toBe("Loading session...");
    expect(composerInputDisabledReason({
      codexInteractionLocked: true,
      disabled: true,
      pageBusy: true
    })).toBe("Waiting for Codex.");
    expect(composerInputDisabledReason({
      disabled: true,
      localComposerSubmissionPending: true,
      pageBusy: true
    })).toBe("");
    expect(composerInputDisabledReason({
      disabled: true,
      localComposerSubmissionPending: true
    })).toBe("");
    expect(composerInputDisabledReason({
      disabled: true,
      stepInputSaving: true
    })).toBe("Saving response...");
    expect(composerInputDisabledReason({
      commandRunning: true,
      disabled: true
    })).toBe("Command is running.");
    expect(composerInputDisabledReason({
      codexInteractionLocked: true,
      disabled: true
    })).toBe("Waiting for Codex.");
    expect(composerInputDisabledReason({
      disabled: true
    })).toBe("Waiting for session controls.");
  });

  it("keeps one primary composer draft across selected steer and normal selected modes", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps();
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("selected_control");
    expect(view.selectedComposerControl.value.label).toBe("Steer");

    view.updateSelectedControlValue("conversationRequest", "Keep this draft.");
    expect(view.selectedControlValues.value.conversationRequest).toBe("Keep this draft.");

    props.codexThinking = false;
    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("selected_control");
    expect(view.selectedControlValues.value.conversationRequest).toBe("Keep this draft.");

    props.codexThinking = true;
    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("selected_control");
    expect(view.selectedComposerControl.value.label).toBe("Steer");
    expect(view.selectedControlValues.value.conversationRequest).toBe("Keep this draft.");
  });

  it("explains why the composer is locked while session data is loading", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      codexThinking: false,
      page: {
        busy: true
      }
    });
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.composerControlInputDisabled.value).toBe(true);
    expect(view.composerControlInputDisabledReason.value).toBe("Loading session...");
    expect(view.composerInlineInputDisabledReason.value).toBe("Loading session...");
  });

  it("shows waiting-for-controls status in the outer status lane", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      codexThinking: false
    });
    props.session.presentation.intents = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    expect(view.composerControlInputDisabled.value).toBe(true);
    expect(view.composerControlInputDisabledReason.value).toBe("Waiting for session controls.");
    expect(view.composerInlineInputDisabledReason.value).toBe("");
    expect(view.thinkingVisible.value).toBe(true);
    expect(view.thinkingLabel.value).toBe("Waiting for session controls.");
  });

  it("pastes composer menu templates into the selected draft without replacing typed text", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps();
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    view.updateSelectedControlValue("conversationRequest", "Keep this draft.");

    expect(await view.activateComposerMenuItem({
      kind: "template",
      text: "Deslop changes."
    })).toBe(true);
    expect(view.selectedControlValues.value.conversationRequest).toBe("Keep this draft.\n\nDeslop changes.");
  });

  it("submits selected primary steer with only the typed composer text", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const steerCodexTurn = vi.fn(async () => true);
    const props = viewProps({
      steerCodexTurn
    });
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("selected_control");
    expect(view.selectedComposerControl.value.label).toBe("Steer");

    view.updateSelectedControlValue("conversationRequest", "Keep the active steer focused.");

    expect(await view.submitScreenComposerControl()).toBe(true);
    expect(steerCodexTurn).toHaveBeenCalledWith({
      displayFields: {},
      fields: {
        conversationRequest: "Keep the active steer focused."
      },
      message: "Keep the active steer focused."
    });
  });

  it("submits a passive steer with only the typed composer text", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    let resolveSteer;
    const steerCodexTurn = vi.fn(() => new Promise((resolve) => {
      resolveSteer = resolve;
    }));
    const props = viewProps({
      steerCodexTurn
    });
    props.session.presentation.intents = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    view.updatePassiveComposer("message", "Keep the new draft focused.");

    const submitPromise = view.submitPassiveComposer();
    await nextTick();

    expect(view.chatTurns.value.at(-1)?.user?.text).toBe("Keep the new draft focused.");
    expect(view.passiveComposerValues.value.message).toBe("");

    resolveSteer(true);
    expect(await submitPromise).toBe(true);
    expect(view.passiveComposerValues.value.message).toBe("");

    expect(steerCodexTurn).toHaveBeenCalledWith({
      displayFields: {
        conversationRequest: "Keep the new draft focused."
      },
      fields: {
        conversationRequest: "Keep the new draft focused."
      },
      message: "Keep the new draft focused."
    });
  });

  it("allows passive steer typing before Codex exposes the active turn id", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      session: {
        codexAgentTurn: {},
        codexTerminal: {
          commandPreview: "codex",
          id: "terminal-1",
          status: "running"
        },
        presentation: {
          intents: [],
          screen: {
            primaryIntentId: "talk_to_codex",
            title: "Codex is working"
          }
        },
        sessionId: "session-1"
      }
    });
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    expect(view.passiveComposerFields.value[0].label).toBe("Steer Codex");
    expect(view.composerControlInputDisabled.value).toBe(false);
    expect(view.composerControlCanSubmit.value).toBe(false);
    expect(view.composerControlInlineSubmitLabelVisible.value).toBe(true);

    view.updatePassiveComposer("conversationRequest", "Typed while turn id loads.");
    expect(view.passiveComposerValues.value.conversationRequest).toBe("Typed while turn id loads.");
    expect(view.composerControlCanSubmit.value).toBe(true);

    props.session.codexAgentTurn = {
      threadId: "thread-1",
      turnId: "turn-1"
    };
    await nextTick();

    expect(view.composerControlInputDisabled.value).toBe(true);
    expect(view.composerControlCanSubmit.value).toBe(false);
    expect(view.passiveComposerValues.value.conversationRequest).toBe("Typed while turn id loads.");
  });

  it("keeps passive early typing when the primary composer control appears", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps();
    props.session.presentation.intents = [];
    props.session.presentation.screen.primaryIntentId = "talk_to_codex";
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    expect(view.passiveComposerFields.value[0].name).toBe("conversationRequest");
    expect(view.passiveComposerFields.value[0].label).toBe("Steer Codex");

    view.updatePassiveComposer("conversationRequest", "Typed before hydrate.");

    props.session.presentation.intents = [
      conversationControl()
    ];
    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("selected_control");
    expect(view.selectedControlValues.value.conversationRequest).toBe("Typed before hydrate.");
  });

  it("keeps the passive draft when a conversation control appears before primary metadata", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps();
    props.session.presentation.intents = [];
    props.session.presentation.screen.primaryIntentId = "";
    props.codexThinking = false;
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    view.updatePassiveComposer("conversationRequest", "r");

    props.session.presentation.intents = [
      conversationControl()
    ];
    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("selected_control");
    expect(view.selectedControlIsPrimary.value).toBe(false);
    expect(view.composerControlValues.value.conversationRequest).toBe("r");
    expect(view.selectedControlValues.value.conversationRequest).toBe("r");
  });

  it("uses the inline composer shell for secondary conversation controls", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps();
    props.codexThinking = false;
    props.session.presentation.screen.primaryIntentId = "";
    props.session.presentation.intents = [
      {
        ...conversationControl(),
        id: "request_review_tweak",
        label: "Tweak",
        style: "secondary"
      }
    ];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    expect(await view.activateWorkflowButtonControl(view.workflowButtonControls.value[0])).toBe(true);

    expect(view.controlSurfaceMode.value).toBe("selected_control");
    expect(view.selectedControlIsPrimary.value).toBe(false);
    expect(view.composerControlCancelVisible.value).toBe(true);
    expect(view.composerControlInlineSubmit.value).toBe(true);
  });

  it("restores passive steer text when the steer request is rejected", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    let resolveSteer;
    const steerCodexTurn = vi.fn(() => new Promise((resolve) => {
      resolveSteer = resolve;
    }));
    const props = viewProps({
      steerCodexTurn
    });
    props.session.presentation.intents = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    view.updatePassiveComposer("message", "Do not lose this steer.");

    const submitPromise = view.submitPassiveComposer();
    await nextTick();

    expect(view.passiveComposerValues.value.message).toBe("");
    expect(view.chatTurns.value.at(-1)?.user?.text).toBe("Do not lose this steer.");

    resolveSteer(false);
    expect(await submitPromise).toBe(false);
    await nextTick();

    expect(view.passiveComposerValues.value.message).toBe("Do not lose this steer.");
    expect(view.chatTurns.value.at(-1)?.user?.text).not.toBe("Do not lose this steer.");
  });

  it("submits passive steer attachment references with the typed composer text", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const steerCodexTurn = vi.fn(async () => true);
    const props = viewProps({
      steerCodexTurn
    });
    props.session.presentation.intents = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    view.updatePassiveComposer("message", "Please inspect this.");

    expect(await view.submitPassiveComposer({
      attachmentFields: {
        message: [
          {
            containerPath: "/studio-attachments/session/screenshot.png",
            fileName: "screenshot.png",
            size: 2048
          }
        ]
      }
    })).toBe(true);

    expect(steerCodexTurn).toHaveBeenCalledWith({
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

  it("pastes composer menu templates into the passive draft without replacing typed text", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps();
    props.session.presentation.intents = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    view.updatePassiveComposer("message", "Keep the new draft focused.");

    expect(await view.activateComposerMenuItem({
      kind: "template",
      text: "Deslop codebase."
    })).toBe(true);
    expect(view.passiveComposerValues.value.message).toBe("Keep the new draft focused.\n\nDeslop codebase.");
  });
});
