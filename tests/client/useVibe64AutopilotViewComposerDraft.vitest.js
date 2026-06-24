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
      codexAgentTurn: {
        threadId: "thread-1",
        turnId: "turn-1"
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

    resolveSteer(true);
    expect(await submitPromise).toBe(true);

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
