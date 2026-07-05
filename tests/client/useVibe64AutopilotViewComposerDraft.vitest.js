import { nextTick, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";

const routerMock = vi.hoisted(() => ({
  push: vi.fn()
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({
    path: "/app/project/draft-test/development",
    params: {
      slug: "draft-test"
    }
  }),
  useRouter: () => routerMock
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
      commandRunning: computed(() => session?.value?.__commandRunningForTest === true),
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
      codexAgentTurn: {
        active: true,
        state: "active",
        status: "inProgress",
        threadId: "thread-1",
        turnId: "turn-1"
      },
      codexAgentTurnActive: true,
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

function sessionDebugEntries(infoSpy) {
  return infoSpy.mock.calls
    .map(([message]) => String(message || ""))
    .filter((message) => message.startsWith("[VIBE64_SESSION_DEBUG] "))
    .map((message) => JSON.parse(message.replace(/^\[VIBE64_SESSION_DEBUG\]\s+/u, "")));
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
    })).toBe("");
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
    })).toBe("");
    expect(composerInputDisabledReason({
      disabled: true
    })).toBe("");
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

  it("keeps the ready primary composer submit target after local selection state clears", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      codexThinking: false
    });
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("selected_control");
    expect(view.composerControlInputDisabled.value).toBe(false);
    expect(view.composerControlCanSubmit.value).toBe(false);

    view.clearSelectedControl();
    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("selected_control");
    expect(view.composerControlSelectedControl.value.id).toBe("talk_to_codex");
    expect(view.composerControlInputDisabled.value).toBe(false);
    view.updateComposerControlValue("conversationRequest", "Continue from the completed turn.");
    await nextTick();

    expect(view.composerControlValues.value.conversationRequest).toBe("Continue from the completed turn.");
    expect(view.composerControlCanSubmit.value).toBe(true);
  });

  it("logs exact composer input state through the session debug logger", async () => {
    const previousDebug = process.env.VIBE64_SESSION_DEBUG;
    process.env.VIBE64_SESSION_DEBUG = "1";
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      const {
        useVibe64AutopilotView
      } = await import("../../src/composables/useVibe64AutopilotView.js");
      const props = viewProps();
      const view = useVibe64AutopilotView(props, vi.fn());

      await nextTick();

      view.updateSelectedControlValue("conversationRequest", "Trace me.");
      await nextTick();

      const entries = sessionDebugEntries(infoSpy);
      const changedEntry = entries.find((entry) => (
        entry.event === "client.autopilot.composerInput.changed" &&
        entry.valueAfter === "Trace me."
      ));
      expect(changedEntry).toMatchObject({
        accepted: true,
        changed: true,
        codexInteractionLocked: true,
        codexSteerDraftAvailable: true,
        codexSteerSubmitAvailable: true,
        codexTerminalRunning: true,
        composerControlCanSubmit: true,
        composerControlInputDisabled: false,
        composerControlTarget: "selected_control",
        controlSurfaceMode: "selected_control",
        event: "client.autopilot.composerInput.changed",
        fieldName: "conversationRequest",
        privateField: false,
        projectSlug: "draft-test",
        sessionId: "session-1",
        source: "selected_control",
        valueAfter: "Trace me.",
        valueAfterLength: 9,
        valueBefore: "",
        valueBeforeLength: 0,
        valueRequested: "Trace me.",
        valueRequestedLength: 9
      });

      const stateEntry = entries.find((entry) => (
        entry.event === "client.autopilot.composerInput.stateChanged" &&
        entry.nextState?.composerControlFields?.some((field) => (
          field.name === "conversationRequest" &&
          field.value === "Trace me." &&
          field.valueLength === 9
        ))
      ));
      expect(stateEntry).toBeTruthy();
    } finally {
      if (previousDebug === undefined) {
        delete process.env.VIBE64_SESSION_DEBUG;
      } else {
        process.env.VIBE64_SESSION_DEBUG = previousDebug;
      }
      infoSpy.mockRestore();
    }
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
      codexThinking: false,
      sessionDetailState: {
        label: "Waiting for session controls.",
        sessionId: "session-1",
        state: "summaryOnly",
        suppressPassiveComposer: true
      }
    });
    props.session.presentation.intents = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("hidden");
    expect(view.composerControlInputDisabledReason.value).toBe("");
    expect(view.composerInlineInputDisabledReason.value).toBe("");
    expect(view.thinkingVisible.value).toBe(true);
    expect(view.thinkingLabel.value).toBe("Waiting for session controls.");
  });

  it("does not show waiting-for-controls status when prompt buttons are visible", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      codexThinking: false
    });
    props.session.presentation.intents = [
      {
        enabled: true,
        id: "show_diff",
        label: "Diff",
        style: "secondary"
      },
      {
        enabled: true,
        id: "accept_review",
        label: "All good",
        style: "primary"
      },
      {
        enabled: true,
        id: "tweak_review",
        label: "Tweak",
        style: "secondary"
      }
    ];
    props.session.presentation.screen.primaryIntentId = "";
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    expect(view.workflowButtonControls.value.map((control) => control.label)).toEqual([
      "Diff",
      "All good",
      "Tweak"
    ]);
    expect(view.composerControlInputDisabled.value).toBe(false);
    expect(view.composerControlInputDisabledReason.value).toBe("");
    expect(view.composerInlineInputDisabledReason.value).toBe("");
    expect(view.thinkingVisible.value).toBe(false);
    expect(view.thinkingLabel.value).not.toBe("Waiting for session controls.");
  });

  it("adds composer menu prompts to the selected draft as compact references", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps();
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    view.updateSelectedControlValue("conversationRequest", "Keep this draft.");

    expect(await view.activateComposerMenuItem({
      kind: "template",
      label: "Deslop",
      text: "Deslop changes."
    })).toBe(true);
    expect(view.selectedControlValues.value.conversationRequest).toBe("Keep this draft.\n\n[Deslop]");
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

  it("expands selected compact prompt references only for the Codex payload", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const steerCodexTurn = vi.fn(async () => true);
    const props = viewProps({
      steerCodexTurn
    });
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    view.updateSelectedControlValue("conversationRequest", "Please review this.");

    expect(await view.activateComposerMenuItem({
      id: "deslop",
      kind: "template",
      label: "Deslop",
      text: "Full deslop prompt."
    })).toBe(true);
    expect(view.selectedControlValues.value.conversationRequest).toBe("Please review this.\n\n[Deslop]");

    expect(await view.submitScreenComposerControl()).toBe(true);
    expect(steerCodexTurn).toHaveBeenCalledWith({
      displayFields: {
        conversationRequest: "Please review this.\n\n[Deslop]"
      },
      fields: {
        conversationRequest: "Please review this.\n\n[Prompt: Deslop]\nFull deslop prompt."
      },
      message: "Please review this.\n\n[Prompt: Deslop]\nFull deslop prompt."
    });
  });

  it("submits empty selected prompt templates immediately without writing to the draft", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const steerCodexTurn = vi.fn(async () => true);
    const props = viewProps({
      steerCodexTurn
    });
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(await view.activateComposerMenuItem({
      id: "deslop",
      kind: "template",
      label: "Deslop",
      text: "Full deslop prompt."
    })).toBe(true);
    expect(view.selectedControlValues.value.conversationRequest).toBe("");
    expect(steerCodexTurn).toHaveBeenCalledWith({
      displayFields: {
        conversationRequest: "Prompt: Deslop"
      },
      fields: {
        conversationRequest: "[Prompt: Deslop]\nFull deslop prompt."
      },
      message: "[Prompt: Deslop]\nFull deslop prompt."
    });
  });

  it("can still insert full prompt text into the selected draft explicitly", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps();
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    view.updateSelectedControlValue("conversationRequest", "Keep this draft.");

    expect(view.insertComposerMenuItemText({
      kind: "template",
      label: "Deslop",
      text: "Full deslop prompt."
    })).toBe(true);
    expect(view.selectedControlValues.value.conversationRequest).toBe("Keep this draft.\n\nFull deslop prompt.");
  });

  it("keeps the selected composer visible while its Codex handoff is pending", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    let resolveRunAction;
    const runAction = vi.fn(() => new Promise((resolve) => {
      resolveRunAction = resolve;
    }));
    const props = viewProps();
    props.codexThinking = false;
    props.actions.currentActions = [
      {
        enabled: true,
        id: "define_seed_application",
        inputFields: conversationControl().inputFields,
        label: "Send to Codex"
      }
    ];
    props.actions.runAction = runAction;
    props.session.codexAgentTurn = {
      active: false,
      state: "idle",
      status: "completed"
    };
    props.session.codexAgentTurnActive = false;
    props.session.codexTerminal = {};
    props.session.presentation.intents = [
      {
        ...conversationControl(),
        actionId: "define_seed_application"
      }
    ];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("selected_control");
    view.updateSelectedControlValue("conversationRequest", "This is a test");

    const submitPromise = view.submitScreenComposerControl();
    await nextTick();

    expect(runAction).toHaveBeenCalledTimes(1);
    expect(view.controlSurfaceMode.value).toBe("selected_control");
    expect(view.selectedScreenControlVisible.value).toBe(true);
    expect(view.passiveComposerVisible.value).toBe(false);
    expect(view.composerControlInputDisabled.value).toBe(true);
    expect(view.composerControlSelectedControl.value.id).toBe("talk_to_codex");

    resolveRunAction(true);
    expect(await submitPromise).toBe(true);
  });

  it("cancels a stuck selected composer handoff", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    let resolveRunAction;
    const runAction = vi.fn(() => new Promise((resolve) => {
      resolveRunAction = resolve;
    }));
    const props = viewProps();
    props.codexThinking = false;
    props.actions.currentActions = [
      {
        enabled: true,
        id: "agent_conversation",
        inputFields: conversationControl().inputFields,
        label: "Talk to Codex"
      }
    ];
    props.actions.runAction = runAction;
    props.session.codexAgentTurn = {
      active: false,
      state: "idle",
      status: "completed"
    };
    props.session.codexAgentTurnActive = false;
    props.session.codexTerminal = {};
    props.session.presentation.intents = [
      {
        ...conversationControl(),
        actionId: "agent_conversation"
      }
    ];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    view.updateSelectedControlValue("conversationRequest", "This is stuck.");
    const submitPromise = view.submitScreenComposerControl();
    await nextTick();

    expect(view.thinkingLabel.value).toBe("Sending to Codex...");
    expect(view.codexHandoffCancelVisible.value).toBe(true);

    expect(view.cancelCodexHandoff()).toBe(true);
    await nextTick();

    expect(view.codexHandoffCancelVisible.value).toBe(false);
    expect(view.thinkingLabel.value).not.toBe("Sending to Codex...");
    expect(view.composerControlValues.value.conversationRequest).toBe("This is stuck.");

    resolveRunAction(true);
    expect(await submitPromise).toBe(true);
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
    view.updatePassiveComposer("conversationRequest", "Keep the new draft focused.");

    const submitPromise = view.submitPassiveComposer();
    await nextTick();

    expect(view.chatTurns.value.at(-1)?.user?.text).toBe("Keep the new draft focused.");
    expect(view.passiveComposerValues.value.conversationRequest).toBe("");

    resolveSteer(true);
    expect(await submitPromise).toBe(true);
    expect(view.passiveComposerValues.value.conversationRequest).toBe("");

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

  it("allows passive steer before Codex exposes the active turn id to the browser", async () => {
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
            primaryIntentId: "",
            title: "Codex is working"
          }
        },
        sessionId: "session-1"
      }
    });
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.composerControlSelectedControl.value.id).toBe("conversation_composer");
    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    expect(view.passiveComposerFields.value[0].label).toBe("Steer Codex");
    expect(view.composerControlInputDisabled.value).toBe(false);
    expect(view.composerControlCanSubmit.value).toBe(false);
    expect(view.composerControlInlineSubmitLabelVisible.value).toBe(true);

    view.updatePassiveComposer("conversationRequest", "Typed while turn id loads.");
    expect(view.passiveComposerValues.value.conversationRequest).toBe("Typed while turn id loads.");
    expect(view.composerControlCanSubmit.value).toBe(true);

    props.session.codexAgentTurn = {
      active: true,
      threadId: "thread-1",
      turnId: "turn-1"
    };
    props.session.codexAgentTurnActive = true;
    await nextTick();

    expect(view.composerControlInputDisabled.value).toBe(false);
    expect(view.composerControlCanSubmit.value).toBe(true);
    expect(view.composerControlSelectedControl.value.id).toBe("conversation_composer");
    expect(view.passiveComposerValues.value.conversationRequest).toBe("Typed while turn id loads.");
  });

  it("keeps passive conversation text when steer mode becomes message mode", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps();
    props.session.presentation.intents = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    expect(view.passiveComposerFields.value[0].label).toBe("Steer Codex");
    expect(view.composerControlSelectedControl.value.id).toBe("conversation_composer");

    view.updatePassiveComposer("conversationRequest", "Do not lose this draft.");

    props.codexThinking = false;
    props.session.codexAgentTurn = {};
    props.session.codexAgentTurnActive = false;
    props.session.codexTerminal = {};
    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    expect(view.passiveComposerFields.value[0].label).toBe("Message");
    expect(view.composerControlSelectedControl.value.id).toBe("conversation_composer");
    expect(view.passiveComposerValues.value.conversationRequest).toBe("Do not lose this draft.");
    expect(view.composerControlValues.value.conversationRequest).toBe("Do not lose this draft.");
  });

  it("suppresses the passive composer while selected session detail is loading", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      codexThinking: false,
      sessionDetailState: {
        label: "Loading session controls...",
        sessionId: "session-1",
        state: "detailLoading",
        suppressPassiveComposer: true
      }
    });
    props.session.codexAgentTurn = {};
    props.session.codexAgentTurnActive = false;
    props.session.codexTerminal = {};
    props.session.presentation.intents = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.passiveComposerVisible.value).toBe(false);
    expect(view.controlSurfaceMode.value).toBe("hidden");
    expect(view.thinkingVisible.value).toBe(true);
    expect(view.thinkingLabel.value).toBe("Loading session controls...");
  });

  it("keeps the composer visible and submit-ready while selected session detail refreshes", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      codexThinking: false,
      sessionDetailState: {
        label: "",
        sessionId: "session-1",
        state: "detailReady",
        suppressPassiveComposer: false
      }
    });
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.selectedScreenControlVisible.value).toBe(true);
    expect(view.controlSurfaceMode.value).toBe("selected_control");
    expect(view.composerControlCanSubmit.value).toBe(false);

    props.sessionDetailState = {
      label: "Refreshing session controls...",
      sessionId: "session-1",
      state: "detailRestoring",
      suppressPassiveComposer: true
    };
    props.session.presentation.intents = [
      {
        ...conversationControl(),
        enabled: false
      }
    ];
    await nextTick();

    expect(view.selectedScreenControlVisible.value).toBe(true);
    expect(view.controlSurfaceMode.value).toBe("selected_control");
    expect(view.composerControlFormVisible.value).toBe(true);
    expect(view.composerControlInputDisabled.value).toBe(false);

    view.updateComposerControlValue("conversationRequest", "Keep the composer stable.");
    await nextTick();

    expect(view.composerControlValues.value.conversationRequest).toBe("Keep the composer stable.");
    expect(view.selectedControlValues.value.conversationRequest).toBe("Keep the composer stable.");
    expect(view.composerControlCanSubmit.value).toBe(true);
    expect(view.thinkingVisible.value).toBe(false);
    expect(view.runtimeNoticeMessages.value).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "session-controls-refresh",
        text: "Refreshing session controls...",
        tone: "info"
      })
    ]));

    props.sessionDetailState = {
      label: "",
      sessionId: "session-1",
      state: "detailReady",
      suppressPassiveComposer: false
    };
    await nextTick();

    expect(view.composerControlCanSubmit.value).toBe(false);
  });

  it("explains why the passive composer is disabled when selected controls are unavailable", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      codexThinking: false,
      sessionDetailState: {
        label: "Session controls could not load.",
        sessionId: "session-1",
        state: "summaryOnly",
        suppressPassiveComposer: false
      }
    });
    props.session.presentation.intents = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.passiveComposerVisible.value).toBe(true);
    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    expect(view.composerControlInputDisabled.value).toBe(true);
    expect(view.composerControlInputDisabledReason.value).toBe("");
    expect(view.composerInlineInputDisabledReason.value).toBe("");
    expect(view.thinkingVisible.value).toBe(true);
    expect(view.thinkingLabel.value).toBe("Session controls could not load.");
  });

  it("enables the passive composer when selected controls are ready", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      codexThinking: false,
      sessionDetailState: {
        label: "",
        sessionId: "session-1",
        state: "detailReady",
        suppressPassiveComposer: false
      }
    });
    props.session.presentation.intents = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.passiveComposerVisible.value).toBe(true);
    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    expect(view.composerControlInputDisabled.value).toBe(false);
    expect(view.composerControlInputDisabledReason.value).toBe("");
    expect(view.thinkingLabel.value).not.toBe("Waiting for session controls.");
  });

  it("prioritizes active command status over unavailable session controls", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      codexThinking: false,
      sessionDetailState: {
        label: "Session controls could not load.",
        sessionId: "session-1",
        state: "detailError",
        suppressPassiveComposer: false
      }
    });
    props.session.__commandRunningForTest = true;
    props.session.presentation.intents = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.composerControlInputDisabled.value).toBe(true);
    expect(view.composerInlineInputDisabledReason.value).toBe("");
    expect(view.thinkingVisible.value).toBe(true);
    expect(view.thinkingLabel.value).toBe("Running command...");
  });

  it("keeps detail refresh out of the foreground command status", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      codexThinking: false,
      sessionDetailState: {
        label: "Refreshing session controls...",
        sessionId: "session-1",
        state: "detailRestoring",
        suppressPassiveComposer: true
      }
    });
    props.session.__commandRunningForTest = true;
    props.session.codexAgentTurn = {};
    props.session.codexAgentTurnActive = false;
    props.session.codexTerminal = {};
    props.session.presentation.intents = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.thinkingVisible.value).toBe(true);
    expect(view.thinkingLabel.value).toBe("Running command...");
    expect(view.runtimeNoticeMessages.value).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "session-controls-refresh",
        text: "Refreshing session controls...",
        tone: "info"
      })
    ]));
  });

  it("allows passive steer from the high-level Codex lock before terminal state hydrates", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      session: {
        codexAgentTurn: {},
        codexTerminal: {},
        presentation: {
          intents: [],
          screen: {
            primaryIntentId: "",
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

    view.updatePassiveComposer("conversationRequest", "Typed before terminal state hydrates.");

    expect(view.passiveComposerValues.value.conversationRequest).toBe("Typed before terminal state hydrates.");
    expect(view.composerControlCanSubmit.value).toBe(true);
  });

  it("allows passive app-server Codex steering without terminal state", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const steerCodexTurn = vi.fn(async () => true);
    const props = viewProps({
      steerCodexTurn,
      session: {
        codexAgentTurn: {
          active: true,
          state: "active",
          status: "inProgress",
          threadId: "thread-1",
          turnId: "turn-1"
        },
        codexAgentTurnActive: true,
        codexTerminal: {},
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

    view.updatePassiveComposer("conversationRequest", "Steer the active app-server turn.");

    expect(view.composerControlCanSubmit.value).toBe(true);
    expect(await view.submitPassiveComposer()).toBe(true);
    expect(steerCodexTurn).toHaveBeenCalledWith({
      displayFields: {
        conversationRequest: "Steer the active app-server turn."
      },
      fields: {
        conversationRequest: "Steer the active app-server turn."
      },
      message: "Steer the active app-server turn."
    });
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

  it("makes a promoted passive draft submit-ready before the next render tick", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps();
    props.session.presentation.intents = [];
    props.session.presentation.screen.primaryIntentId = "";
    props.codexThinking = false;
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    view.updatePassiveComposer("conversationRequest", "Draft promoted from reload.");

    props.session.presentation.intents = [
      conversationControl()
    ];

    expect(view.controlSurfaceMode.value).toBe("selected_control");
    expect(view.composerControlValues.value.conversationRequest).toBe("Draft promoted from reload.");
    expect(view.selectedControlValues.value.conversationRequest).toBe("Draft promoted from reload.");
    expect(view.composerControlCanSubmit.value).toBe(true);
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

    view.updatePassiveComposer("conversationRequest", "Do not lose this steer.");

    const submitPromise = view.submitPassiveComposer();
    await nextTick();

    expect(view.passiveComposerValues.value.conversationRequest).toBe("");
    expect(view.chatTurns.value.at(-1)?.user?.text).toBe("Do not lose this steer.");

    resolveSteer(false);
    expect(await submitPromise).toBe(false);
    await nextTick();

    expect(view.passiveComposerValues.value.conversationRequest).toBe("Do not lose this steer.");
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
    view.updatePassiveComposer("conversationRequest", "Please inspect this.");

    expect(await view.submitPassiveComposer({
      attachmentFields: {
        conversationRequest: [
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

  it("adds composer menu prompts to the passive draft as compact references", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps();
    props.session.presentation.intents = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    view.updatePassiveComposer("conversationRequest", "Keep the new draft focused.");

    expect(await view.activateComposerMenuItem({
      kind: "template",
      label: "Deslop",
      text: "Deslop codebase."
    })).toBe(true);
    expect(view.passiveComposerValues.value.conversationRequest).toBe("Keep the new draft focused.\n\n[Deslop]");
  });

  it("expands passive compact prompt references only for the Codex payload", async () => {
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

    view.updatePassiveComposer("conversationRequest", "Keep the new draft focused.");

    expect(await view.activateComposerMenuItem({
      id: "deslop",
      kind: "template",
      label: "Deslop",
      text: "Full deslop prompt."
    })).toBe(true);
    expect(await view.submitPassiveComposer()).toBe(true);

    expect(steerCodexTurn).toHaveBeenCalledWith({
      displayFields: {
        conversationRequest: "Keep the new draft focused.\n\n[Deslop]"
      },
      fields: {
        conversationRequest: "Keep the new draft focused.\n\n[Prompt: Deslop]\nFull deslop prompt."
      },
      message: "Keep the new draft focused.\n\n[Prompt: Deslop]\nFull deslop prompt."
    });
  });
});
