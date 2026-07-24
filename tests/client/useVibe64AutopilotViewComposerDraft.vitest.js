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

function agentSessionState({
  active = true,
  terminal = {
    commandPreview: "codex",
    id: "terminal-1",
    status: "running"
  },
  threadId = "thread-1",
  turnId = "turn-1"
} = {}) {
  return {
    providerId: "codex",
    terminal,
    thread: {
      id: threadId
    },
    transportId: "codex_app_server",
    turn: active ? {
      active: true,
      id: turnId,
      state: "active",
      status: "inProgress",
      threadId
    } : {}
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
    commandRunner: null,
    conversationLog: {
      turns: []
    },
    diff: {},
    humanInputResponsePreview: {},
    interruptAgentTurn: async () => false,
    page: {},
    projectPane: "preview",
    refreshSessionData: async () => null,
    reportPreview: {},
    review: {},
    rewindBusy: false,
    rewindToStep: null,
    session: {
      agentSession: agentSessionState({
        active: overrides.agentThinking !== false
      }),
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
    sendAgentMessage: async () => true,
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
  it("keeps Finish visible and loading until the server action closes the session", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const finishAction = {
      enabled: true,
      id: "finish_session",
      label: "Finish",
      type: "finish"
    };
    let resolveFinish;
    const finishResponse = new Promise((resolve) => {
      resolveFinish = resolve;
    });
    const actions = reactive({
      activeActionId: "",
      currentActions: [finishAction],
      runAction: async () => {
        actions.activeActionId = finishAction.id;
        actions.runActionCommand.isRunning = true;
        try {
          return await finishResponse;
        } finally {
          actions.activeActionId = "";
          actions.runActionCommand.isRunning = false;
        }
      },
      runActionCommand: {
        isRunning: false
      }
    });
    const props = viewProps({
      actions,
      agentThinking: false
    });
    props.session.presentation.intents = [
      {
        actionId: "finish_session",
        enabled: true,
        id: "archive_session",
        label: "Finish",
        style: "secondary"
      }
    ];
    props.session.presentation.screen.primaryIntentId = "";
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    const finishing = view.activateWorkflowButtonControl(view.workflowButtonControls.value[0]);
    await nextTick();

    expect(view.workflowButtonControls.value).toHaveLength(1);
    expect(view.workflowButtonControls.value[0]).toMatchObject({
      disabled: true,
      id: "archive_session",
      label: "Finish",
      loading: true
    });

    resolveFinish({
      clientRefresh: {
        includeList: true
      },
      ok: true,
      sessionId: "session-1",
      status: "finished"
    });

    expect(await finishing).toBe(true);
  });

  it("finishes through the server action and refreshes the open-session list", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const finishAction = {
      enabled: true,
      id: "finish_session",
      label: "Finish",
      type: "finish"
    };
    const runAction = vi.fn(async () => ({
      clientRefresh: {
        includeList: true
      },
      ok: true,
      sessionId: "session-1",
      status: "finished"
    }));
    const refreshSessionData = vi.fn(async () => null);
    const props = viewProps({
      actions: {
        currentActions: [finishAction],
        runAction
      },
      agentThinking: false,
      refreshSessionData
    });
    props.session.status = "active";
    props.session.presentation.intents = [
      {
        actionId: "finish_session",
        enabled: true,
        id: "archive_session",
        label: "Finish",
        style: "secondary"
      }
    ];
    props.session.presentation.screen.primaryIntentId = "";
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.workflowButtonControls.value).toHaveLength(1);
    expect(await view.activateWorkflowButtonControl(view.workflowButtonControls.value[0])).toBe(true);
    expect(runAction).toHaveBeenCalledWith(finishAction, expect.objectContaining({
      input: {}
    }));
    expect(refreshSessionData).toHaveBeenCalledWith({
      includeList: true,
      reason: "server-requested-list-refresh"
    });
  });

  it("does not acknowledge Finish unless the server actually closes the session", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const finishAction = {
      enabled: true,
      id: "finish_session",
      label: "Finish",
      type: "finish"
    };
    const props = viewProps({
      actions: {
        currentActions: [finishAction],
        runAction: vi.fn(async () => ({
          ok: true,
          sessionId: "session-1",
          status: "active"
        }))
      },
      agentThinking: false
    });
    props.session.presentation.intents = [
      {
        actionId: "finish_session",
        enabled: true,
        id: "archive_session",
        label: "Finish",
        style: "secondary"
      }
    ];
    props.session.presentation.screen.primaryIntentId = "";
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(await view.activateWorkflowButtonControl(view.workflowButtonControls.value[0])).toBe(false);
  });

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
      agentInteractionLocked: true,
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
      agentInteractionLocked: true,
      disabled: true
    })).toBe("");
    expect(composerInputDisabledReason({
      disabled: true
    })).toBe("");
  });

  it("does not claim an active assistant is working while its connection is unverified", async () => {
    const {
      agentConnectionThinkingLabel
    } = await import("../../src/composables/useVibe64AutopilotView.js");

    expect(agentConnectionThinkingLabel({
      active: true,
      status: "disconnected"
    })).toBe("Connection lost — assistant status unknown.");
    expect(agentConnectionThinkingLabel({
      active: true,
      status: "reconciling"
    })).toBe("Checking assistant status...");
    expect(agentConnectionThinkingLabel({
      active: true,
      status: "unknown"
    })).toBe("Assistant status could not be verified.");
    expect(agentConnectionThinkingLabel({
      active: true,
      status: "connected"
    })).toBe("");
    expect(agentConnectionThinkingLabel({
      active: false,
      status: "disconnected"
    })).toBe("");
  });

  it("keeps one primary composer draft while active work switches to the steering composer", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps();
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    expect(view.passiveComposerFields.value[0].label).toBe("Steer assistant");

    view.updateComposerControlValue("conversationRequest", "Keep this draft.");
    expect(view.composerControlValues.value.conversationRequest).toBe("Keep this draft.");

    props.session.agentSession = agentSessionState({
      active: false
    });
    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("selected_control");
    expect(view.selectedControlValues.value.conversationRequest).toBe("Keep this draft.");

    props.session.agentSession = agentSessionState();
    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    expect(view.passiveComposerFields.value[0].label).toBe("Steer assistant");
    expect(view.composerControlValues.value.conversationRequest).toBe("Keep this draft.");
  });

  it("keeps the conversation draft when interrupt recovery replaces the current control", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps();
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    view.updateComposerControlValue("conversationRequest", "Draft survives Stop.");
    expect(view.passiveComposerValues.value.conversationRequest).toBe("Draft survives Stop.");

    props.session.presentation.intents = [];
    props.session.agentSession = agentSessionState({
      active: false
    });
    await nextTick();

    expect(view.passiveComposerValues.value.conversationRequest).toBe("Draft survives Stop.");

    props.session.presentation.intents = [conversationControl()];
    await nextTick();

    expect(view.selectedControlValues.value.conversationRequest).toBe("Draft survives Stop.");
  });

  it("keeps the ready primary composer submit target after local selection state clears", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      agentThinking: false
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

      view.updateComposerControlValue("conversationRequest", "Trace me.");
      await nextTick();

      const entries = sessionDebugEntries(infoSpy);
      const changedEntry = entries.find((entry) => (
        entry.event === "client.autopilot.composerInput.changed" &&
        entry.valueAfter === "Trace me."
      ));
      expect(changedEntry).toMatchObject({
        accepted: true,
        changed: true,
        agentInteractionLocked: true,
        agentSteeringAvailable: true,
        agentTerminalRunning: true,
        composerControlCanSubmit: true,
        composerControlInputDisabled: false,
        composerControlTarget: "passive_composer",
        controlSurfaceMode: "passive_composer",
        event: "client.autopilot.composerInput.changed",
        fieldName: "conversationRequest",
        privateField: false,
        projectSlug: "draft-test",
        sessionId: "session-1",
        source: "passive_composer",
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

  it("keeps the passive message composer usable while session data refreshes", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      agentThinking: false,
      page: {
        busy: true
      }
    });
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.composerControlInputDisabled.value).toBe(false);
    expect(view.composerControlInputDisabledReason.value).toBe("");
    expect(view.composerInlineInputDisabledReason.value).toBe("");
  });

  it("keeps the steer composer editable while the initial send request is still busy", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      page: {
        busy: true
      }
    });
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.passiveComposerSteeringModeActive.value).toBe(true);
    expect(view.composerControlInputDisabled.value).toBe(false);
    expect(view.composerControlInputDisabledReason.value).toBe("");
  });

  it("shows waiting-for-controls status in the outer status lane", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      agentThinking: false,
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
      agentThinking: false
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

  it("submits active-turn steering only through the passive composer", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const sendAgentMessage = vi.fn(async () => true);
    const props = viewProps({
      sendAgentMessage
    });
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    expect(view.passiveComposerFields.value[0].label).toBe("Steer assistant");

    view.updatePassiveComposer("conversationRequest", "Keep the active steer focused.");

    expect(await view.submitPassiveComposer()).toBe(true);
    expect(sendAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      composerSubmissionId: expect.stringMatching(/^composer:/u),
      displayFields: {
        conversationRequest: "Keep the active steer focused."
      },
      fields: {
        conversationRequest: "Keep the active steer focused."
      },
      message: "Keep the active steer focused."
    }));
  });

  it("submits empty selected prompt templates immediately without writing to the draft", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const sendAgentMessage = vi.fn(async () => true);
    const props = viewProps({
      sendAgentMessage
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
    expect(sendAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      composerSubmissionId: expect.stringMatching(/^composer:/u),
      displayFields: {
        conversationRequest: "Prompt: Deslop"
      },
      fields: {
        conversationRequest: "[Prompt: Deslop]\nFull deslop prompt."
      },
      message: "[Prompt: Deslop]\nFull deslop prompt."
    }));
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

  it("starts focused task menu items without injecting their prompt into main chat", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const requestAgentTask = vi.fn(async () => true);
    const sendAgentMessage = vi.fn(async () => true);
    const props = viewProps({
      requestAgentTask,
      sendAgentMessage
    });
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(await view.activateComposerMenuItem({
      id: "core.sync_with_remote",
      kind: "task",
      label: "Sync code with GitHub",
      text: "Full synchronization prompt."
    })).toBe(true);
    expect(requestAgentTask).toHaveBeenCalledWith(
      "start",
      {
        agentSettings: {},
        taskId: "core.sync_with_remote"
      }
    );
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(view.selectedControlValues.value.conversationRequest).toBe("");
  });

  it("keeps focused task prompt text available for explicit main-chat insertion", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps();
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();
    view.updateSelectedControlValue("conversationRequest", "Discuss this first.");

    expect(view.insertComposerMenuItemText({
      kind: "task",
      label: "Sync code with GitHub",
      text: "Full synchronization prompt."
    })).toBe(true);
    expect(view.selectedControlValues.value.conversationRequest).toBe(
      "Discuss this first.\n\nFull synchronization prompt."
    );
  });

  it("renders and continues a focused task in the existing chat panel", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const requestAgentTask = vi.fn(async () => true);
    const props = viewProps({
      requestAgentTask
    });
    props.session.agentTask = {
      id: "task-1",
      label: "Sync code with GitHub",
      state: "waiting",
      turns: [{
        at: "2026-07-16T01:00:00.000Z",
        id: "0001",
        role: "user",
        text: "Sync code with GitHub"
      }, {
        at: "2026-07-16T01:01:00.000Z",
        id: "0002",
        role: "assistant",
        text: "The branches diverged. Choose merge or rebase."
      }]
    };
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.agentTaskActive.value).toBe(true);
    expect(view.chatTurns.value).toEqual([expect.objectContaining({
      assistant: expect.objectContaining({
        text: "The branches diverged. Choose merge or rebase."
      }),
      user: expect.objectContaining({
        text: "Sync code with GitHub"
      })
    })]);
    view.updateAgentTaskDraft("message", "Use a normal merge.");
    expect(await view.submitAgentTaskMessage()).toBe(true);
    expect(requestAgentTask).toHaveBeenCalledWith(
      "message",
      {
        message: "Use a normal merge."
      }
    );
    expect(view.agentTaskValues.value.message).toBe("");
  });

  it("keeps Send cosmetic until the AI layer becomes steerable and accepts a queued follow-up", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    let resolveRunAction;
    const runAction = vi.fn(() => new Promise((resolve) => {
      resolveRunAction = resolve;
    }));
    const interruptAgentTurn = vi.fn(async () => true);
    const sendAgentMessage = vi.fn(async () => true);
    const props = viewProps({
      interruptAgentTurn,
      sendAgentMessage
    });
    props.agentThinking = false;
    props.session.composerHandoff = {
      canonical: true,
      id: "previous-handoff",
      state: "active",
      submissionId: "previous-submission"
    };
    props.actions.currentActions = [
      {
        enabled: true,
        id: "define_seed_application",
        inputFields: conversationControl().inputFields,
        label: "Send to assistant"
      }
    ];
    props.actions.runAction = runAction;
    props.session.agentSession.turn = {
      active: false,
      state: "idle",
      status: "completed"
    };
    props.session.agentSession.terminal = {};
    props.session.presentation.intents = [
      {
        ...conversationControl(),
        actionId: "define_seed_application"
      }
    ];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("selected_control");
    view.updateSelectedControlValue("conversationRequest", "Start the work.");

    const submitPromise = view.submitScreenComposerControl();
    await nextTick();

    expect(runAction).toHaveBeenCalledTimes(1);
    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    expect(view.selectedScreenControlVisible.value).toBe(false);
    expect(view.passiveComposerVisible.value).toBe(true);
    expect(view.passiveComposerFields.value[0].label).toBe("Message");
    expect(view.composerControlInputDisabled.value).toBe(false);
    expect(view.composerControlSelectedControl.value.id).toBe("conversation_composer");

    const handoffSubmissionId = view.chatTurns.value.at(-1)?.optimistic?.id;
    expect(handoffSubmissionId).toMatch(/^composer:/u);
    expect(view.composerControlInterruptVisible.value).toBe(true);
    expect(view.composerControlInterruptDisabled.value).toBe(false);
    expect(await view.requestAgentInterrupt()).toBe(true);
    expect(interruptAgentTurn).toHaveBeenCalledWith({
      afterSubmissionId: handoffSubmissionId,
      reason: "user_interrupt"
    });

    view.updateComposerControlValue("conversationRequest", "Also check the tests.");
    expect(view.composerControlCanSubmit.value).toBe(true);
    expect(await view.submitComposerControl()).toBe(true);

    const steerSubmissionId = view.chatTurns.value.at(-1)?.optimistic?.id;
    expect(steerSubmissionId).toMatch(/^composer:/u);
    expect(steerSubmissionId).not.toBe(handoffSubmissionId);
    expect(view.chatTurns.value.map((turn) => turn.user?.text)).toEqual([
      "Start the work.",
      "Also check the tests."
    ]);
    expect(sendAgentMessage).toHaveBeenCalledWith({
      afterSubmissionId: handoffSubmissionId,
      composerSubmissionId: steerSubmissionId,
      displayFields: {
        conversationRequest: "Also check the tests."
      },
      fields: {
        conversationRequest: "Also check the tests."
      },
      message: "Also check the tests."
    });
    expect(view.composerControlInputDisabled.value).toBe(false);

    resolveRunAction(true);
    expect(await submitPromise).toBe(true);
  });

  it("routes the selected agent conversation through the durable message operation", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const runAction = vi.fn(async () => true);
    const sendAgentMessage = vi.fn(async () => true);
    const props = viewProps({
      agentThinking: false,
      sendAgentMessage
    });
    props.actions.currentActions = [
      {
        dispatchRoute: "session-message",
        enabled: true,
        id: "agent_conversation",
        inputFields: conversationControl().inputFields,
        label: "Talk to Codex"
      }
    ];
    props.actions.runAction = runAction;
    props.session.agentSession.turn = {
      active: false,
      state: "idle",
      status: "completed"
    };
    props.session.agentSession.terminal = {};
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

    expect(view.thinkingLabel.value).toBe("Sending to assistant...");
    const submissionId = view.chatTurns.value.at(-1)?.optimistic?.id;
    expect(submissionId).toMatch(/^composer:/u);
    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    expect(view.passiveComposerFields.value[0].label).toBe("Message");
    expect(view.composerControlInputDisabled.value).toBe(false);
    expect(view.composerControlInterruptVisible.value).toBe(true);

    view.updatePassiveComposer("conversationRequest", "And answer this immediately after.");
    expect(await view.submitPassiveComposer()).toBe(true);
    const followUpSubmissionId = view.chatTurns.value.at(-1)?.optimistic?.id;
    expect(followUpSubmissionId).toMatch(/^composer:/u);
    expect(followUpSubmissionId).not.toBe(submissionId);

    expect(await submitPromise).toBe(true);
    expect(sendAgentMessage).toHaveBeenNthCalledWith(1, {
      agentSettings: {},
      composerSubmissionId: submissionId,
      displayFields: {
        conversationRequest: "This is stuck."
      },
      fields: {
        conversationRequest: "This is stuck."
      },
      message: "This is stuck."
    });
    expect(sendAgentMessage).toHaveBeenNthCalledWith(2, {
      afterSubmissionId: submissionId,
      composerSubmissionId: followUpSubmissionId,
      displayFields: {
        conversationRequest: "And answer this immediately after."
      },
      fields: {
        conversationRequest: "And answer this immediately after."
      },
      message: "And answer this immediately after."
    });
    expect(runAction).not.toHaveBeenCalled();
    props.session.composerMessages = [
      {
        id: submissionId,
        message: "This is stuck.",
        state: "accepted"
      },
      {
        afterSubmissionId: submissionId,
        id: followUpSubmissionId,
        message: "And answer this immediately after.",
        state: "accepted"
      }
    ];
    await nextTick();

    expect(view.thinkingLabel.value).toBe("Sending to assistant...");
    expect(view.chatTurns.value.at(-1)?.optimistic?.status).toBe("pending");

    props.session.composerMessages = props.session.composerMessages.map((message) => ({
      ...message,
      state: "delivered"
    }));
    await nextTick();

    expect(view.thinkingLabel.value).toBe("");
    expect(view.chatTurns.value.slice(-2).map((turn) => turn.optimistic?.status)).toEqual([
      "delivered",
      "delivered"
    ]);
  });

  it("submits a passive steer with only the typed composer text", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    let resolveSteer;
    const sendAgentMessage = vi.fn(() => new Promise((resolve) => {
      resolveSteer = resolve;
    }));
    const props = viewProps({
      sendAgentMessage
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

    expect(sendAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      composerSubmissionId: expect.stringMatching(/^composer:/u),
      displayFields: {
        conversationRequest: "Keep the new draft focused."
      },
      fields: {
        conversationRequest: "Keep the new draft focused."
      },
      message: "Keep the new draft focused."
    }));
  });

  it("never clears a new draft when an earlier message request finishes", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    let resolveMessage;
    const sendAgentMessage = vi.fn(() => new Promise((resolve) => {
      resolveMessage = resolve;
    }));
    const props = viewProps({
      sendAgentMessage
    });
    props.session.presentation.intents = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();
    view.updatePassiveComposer("conversationRequest", "Message already sent.");
    const submission = view.submitPassiveComposer();
    await nextTick();

    view.updatePassiveComposer("conversationRequest", "New draft typed during delivery.");
    resolveMessage(true);
    expect(await submission).toBe(true);
    await nextTick();

    expect(view.passiveComposerValues.value.conversationRequest).toBe("New draft typed during delivery.");
  });

  it("keeps passive send available before the browser observes an active turn", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      session: {
        agentSession: agentSessionState({
          active: false,
          terminal: {
          commandPreview: "codex",
          id: "terminal-1",
          status: "running"
          }
        }),
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
    expect(view.passiveComposerFields.value[0].label).toBe("Message");
    expect(view.composerControlInputDisabled.value).toBe(false);
    expect(view.composerControlCanSubmit.value).toBe(false);
    expect(view.composerControlInlineSubmitLabelVisible.value).toBe(false);

    view.updatePassiveComposer("conversationRequest", "Typed while turn id loads.");
    expect(view.passiveComposerValues.value.conversationRequest).toBe("Typed while turn id loads.");
    expect(view.composerControlCanSubmit.value).toBe(true);

    props.session.agentSession.turn = {
      active: true,
      threadId: "thread-1",
      turnId: "turn-1"
    };
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
    expect(view.passiveComposerFields.value[0].label).toBe("Steer assistant");
    expect(view.composerControlSelectedControl.value.id).toBe("conversation_composer");

    view.updatePassiveComposer("conversationRequest", "Do not lose this draft.");

    props.agentThinking = false;
    props.session.agentSession.turn = {};
    props.session.agentSession.terminal = {};
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
      agentThinking: false,
      sessionDetailState: {
        label: "Loading session controls...",
        sessionId: "session-1",
        state: "detailLoading",
        suppressPassiveComposer: true
      }
    });
    props.session.agentSession.turn = {};
    props.session.agentSession.terminal = {};
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
      agentThinking: false,
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
      label: "",
      refreshing: true,
      sessionId: "session-1",
      state: "detailReady",
      suppressPassiveComposer: false
    };
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
    expect(view.runtimeNoticeMessages.value).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "session-controls-refresh"
      })
    ]));

    props.sessionDetailState = {
      label: "",
      sessionId: "session-1",
      state: "detailReady",
      suppressPassiveComposer: false
    };
    await nextTick();

    expect(view.composerControlCanSubmit.value).toBe(true);
  });

  it("explains why the passive composer is disabled when selected controls are unavailable", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      agentThinking: false,
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
      agentThinking: false,
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

  it("submits passive text through the single assistant message operation", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const runAction = vi.fn(async () => true);
    const sendAgentMessage = vi.fn(async () => true);
    const action = {
      enabled: true,
      id: "agent_conversation",
      inputFields: conversationControl().inputFields,
      label: "Talk to Codex",
      visible: true
    };
    const props = viewProps({
      agentThinking: false,
      sendAgentMessage
    });
    props.actions.currentActions = [action];
    props.actions.runAction = runAction;
    props.session.agentSession.turn = {
      active: false,
      state: "idle",
      status: "completed"
    };
    props.session.agentSession.terminal = {};
    props.session.presentation.intents = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    expect(view.composerControlSelectedControl.value.id).toBe("conversation_composer");
    expect(view.composerControlCanSubmit.value).toBe(false);

    view.updatePassiveComposer("conversationRequest", "Continue from here.");
    await nextTick();

    expect(view.composerControlCanSubmit.value).toBe(true);
    expect(await view.submitPassiveComposer()).toBe(true);

    expect(sendAgentMessage).toHaveBeenCalledWith({
      composerSubmissionId: expect.stringMatching(/^composer:/u),
      displayFields: {
        conversationRequest: "Continue from here."
      },
      fields: {
        conversationRequest: "Continue from here."
      },
      message: "Continue from here."
    });
    expect(runAction).not.toHaveBeenCalled();
    expect(view.passiveComposerValues.value.conversationRequest).toBe("");
  });

  it("does not reinterpret passive text as a secondary workflow action", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const runAction = vi.fn(async () => true);
    const sendAgentMessage = vi.fn(async () => true);
    const props = viewProps({
      agentThinking: false,
      sendAgentMessage
    });
    props.actions.currentActions = [
      {
        enabled: true,
        id: "request_review_tweak",
        inputFields: conversationControl().inputFields,
        label: "Tweak",
        style: "secondary",
        visible: true
      }
    ];
    props.actions.runAction = runAction;
    props.session.agentSession.turn = {
      active: false,
      state: "idle",
      status: "completed"
    };
    props.session.agentSession.terminal = {};
    props.session.presentation.intents = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    view.updatePassiveComposer("conversationRequest", "Do not pick a secondary action implicitly.");

    expect(view.composerControlCanSubmit.value).toBe(true);
    expect(await view.submitPassiveComposer()).toBe(true);
    expect(sendAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: "Do not pick a secondary action implicitly."
    }));
    expect(runAction).not.toHaveBeenCalled();
  });

  it("prioritizes active command status over unavailable session controls", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      agentThinking: false,
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

  it("does not surface background detail refresh as foreground status", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      agentThinking: false,
      sessionDetailState: {
        label: "",
        refreshing: true,
        sessionId: "session-1",
        state: "detailReady",
        suppressPassiveComposer: false
      }
    });
    props.session.__commandRunningForTest = true;
    props.session.agentSession.turn = {};
    props.session.agentSession.terminal = {};
    props.session.presentation.intents = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();

    expect(view.thinkingVisible.value).toBe(true);
    expect(view.thinkingLabel.value).toBe("Running command...");
    expect(view.runtimeNoticeMessages.value).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "session-controls-refresh"
      })
    ]));
  });

  it("does not treat stale presentation text as active assistant truth", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const props = viewProps({
      session: {
        agentSession: agentSessionState({
          active: false,
          terminal: {}
        }),
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
    expect(view.passiveComposerFields.value[0].label).toBe("Message");
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
    const sendAgentMessage = vi.fn(async () => true);
    const props = viewProps({
      sendAgentMessage,
      session: {
        agentSession: agentSessionState({
          terminal: {}
        }),
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
    expect(view.passiveComposerFields.value[0].label).toBe("Steer assistant");
    expect(view.composerControlInputDisabled.value).toBe(false);
    expect(view.composerControlCanSubmit.value).toBe(false);

    view.updatePassiveComposer("conversationRequest", "Steer the active app-server turn.");

    expect(view.composerControlCanSubmit.value).toBe(true);
    expect(await view.submitPassiveComposer()).toBe(true);
    expect(sendAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      composerSubmissionId: expect.stringMatching(/^composer:/u),
      displayFields: {
        conversationRequest: "Steer the active app-server turn."
      },
      fields: {
        conversationRequest: "Steer the active app-server turn."
      },
      message: "Steer the active app-server turn."
    }));
  });

  it("keeps a durable steer failure in chat and resends the same message id", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const sendAgentMessage = vi.fn(async () => true);
    const props = viewProps({
      sendAgentMessage
    });
    props.session.composerHandoff = {
      canonical: true,
      state: "active",
      submissionId: "composer:tab:initial"
    };
    props.session.composerMessages = [];
    const view = useVibe64AutopilotView(props, vi.fn());

    await nextTick();
    view.updatePassiveComposer("conversationRequest", "Do not lose this follow-up.");
    expect(await view.submitPassiveComposer()).toBe(true);

    const submissionId = view.chatTurns.value.at(-1)?.optimistic?.id;
    expect(submissionId).toMatch(/^composer:/u);
    props.session.composerMessages = [
      {
        error: "Codex rejected the steer.",
        id: submissionId,
        state: "failed"
      }
    ];
    await nextTick();

    expect(view.chatTurns.value.at(-1)?.optimistic).toEqual({
      error: "Codex rejected the steer.",
      id: submissionId,
      status: "failed"
    });
    expect(await view.resendOptimisticComposerTurn(submissionId)).toBe(true);
    expect(sendAgentMessage).toHaveBeenCalledTimes(2);
    expect(sendAgentMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      afterSubmissionId: "composer:tab:initial",
      composerSubmissionId: submissionId,
      message: "Do not lose this follow-up."
    }));

    props.session.composerMessages = [
      {
        error: "",
        id: submissionId,
        state: "accepted"
      }
    ];
    await nextTick();
    expect(view.chatTurns.value.at(-1)?.optimistic?.status).toBe("pending");
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
    expect(view.passiveComposerFields.value[0].label).toBe("Steer assistant");

    view.updatePassiveComposer("conversationRequest", "Typed before hydrate.");

    props.session.presentation.intents = [
      conversationControl()
    ];
    await nextTick();

    expect(view.controlSurfaceMode.value).toBe("passive_composer");
    expect(view.composerControlValues.value.conversationRequest).toBe("Typed before hydrate.");

    props.session.agentSession = agentSessionState({
      active: false
    });
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
    props.session.agentSession = agentSessionState({
      active: false
    });
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
    props.session.agentSession = agentSessionState({
      active: false
    });
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
    props.session.agentSession = agentSessionState({
      active: false
    });
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
    const sendAgentMessage = vi.fn(() => new Promise((resolve) => {
      resolveSteer = resolve;
    }));
    const props = viewProps({
      sendAgentMessage
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
    expect(view.chatTurns.value.at(-1)).toMatchObject({
      optimistic: {
        status: "failed"
      },
      user: {
        text: "Do not lose this steer."
      }
    });
  });

  it("submits passive steer attachment references with the typed composer text", async () => {
    const {
      useVibe64AutopilotView
    } = await import("../../src/composables/useVibe64AutopilotView.js");
    const sendAgentMessage = vi.fn(async () => true);
    const props = viewProps({
      sendAgentMessage
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
            path: "/tmp/vibe64-attachments/session/screenshot.png",
            fileName: "screenshot.png",
            size: 2048
          }
        ]
      }
    })).toBe(true);

    expect(sendAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      composerSubmissionId: expect.stringMatching(/^composer:/u),
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
    }));
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
    const sendAgentMessage = vi.fn(async () => true);
    const props = viewProps({
      sendAgentMessage
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

    expect(sendAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      composerSubmissionId: expect.stringMatching(/^composer:/u),
      displayFields: {
        conversationRequest: "Keep the new draft focused.\n\n[Deslop]"
      },
      fields: {
        conversationRequest: "Keep the new draft focused.\n\n[Prompt: Deslop]\nFull deslop prompt."
      },
      message: "Keep the new draft focused.\n\n[Prompt: Deslop]\nFull deslop prompt."
    }));
  });
});
