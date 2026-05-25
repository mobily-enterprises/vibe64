import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  useAiStudioAutopilotController
} from "../../src/composables/useAiStudioAutopilotController.js";

describe("useAiStudioAutopilotController", () => {
  it("dispatches a server-routed command operation without reading action metadata", async () => {
    const context = createControllerContext({
      operation: {
        actionId: "cmd_action",
        advanceOnSuccess: true,
        executable: true,
        id: "command-terminal:cmd_action",
        kind: "command",
        label: "Run command",
        route: "command-terminal"
      }
    });

    await context.controller.runNextOperation();

    expect(context.commandRunner.runCommandAction).toHaveBeenCalledWith(expect.objectContaining({
      action: {
        id: "cmd_action",
        label: "Run command"
      },
      advanceOnSuccess: true,
      sessionId: "session-1"
    }));
    expect(context.session.value.currentStep).toBe("step_b");
    expect(context.actions.advanceSession).not.toHaveBeenCalled();
  });

  it("dispatches prompt work as a normal server action request", async () => {
    const context = createControllerContext({
      operation: {
        actionId: "prompt_action",
        executable: true,
        id: "session-action:prompt_action",
        input: {
          request: "Make the change"
        },
        kind: "action",
        label: "Ask Codex",
        route: "session-action"
      },
      stepStatus: "some_future_status"
    });

    await context.controller.runNextOperation();

    expect(context.actions.runActionById).toHaveBeenCalledWith({
      actionId: "prompt_action",
      advanceOnSuccess: false,
      input: {
        request: "Make the change"
      },
      sessionId: "session-1"
    });
    expect(context.commandRunner.runCommandAction).not.toHaveBeenCalled();
    expect(context.controller.screenState.value.kind).toBe("codex_running");
  });

  it("runs presented intents by id without knowing what the intent means", async () => {
    const context = createControllerContext({
      intents: [
        {
          enabled: true,
          id: "server_intent",
          inputFields: [
            {
              kind: "textarea",
              label: "Feedback",
              name: "feedback"
            }
          ],
          label: "Server intent",
          style: "primary"
        }
      ],
      operation: {
        executable: false,
        kind: "stop",
        reason: "Waiting for user"
      },
      screen: {
        kind: "review",
        title: "Review"
      }
    });

    await context.controller.runPresentedIntent(context.session.value.intents[0], {
      fields: {
        feedback: "Please adjust the copy."
      },
      continueAfterCompletion: false
    });

    expect(context.actions.runIntentById).toHaveBeenCalledWith({
      fields: {
        feedback: "Please adjust the copy."
      },
      intentId: "server_intent",
      sessionId: "session-1",
      stepId: "step_a",
      stepStatus: "ready"
    });
  });

  it("renders the server screen instead of inventing a start screen", async () => {
    const context = createControllerContext({
      operation: {
        actionId: "server_action",
        executable: true,
        id: "session-action:server_action",
        kind: "action",
        label: "Server action",
        route: "session-action"
      },
      screen: {
        kind: "ready",
        title: "Server Ready"
      }
    });

    expect(context.controller.canDispatchNextOperation.value).toBe(true);
    expect(context.controller.screenState.value).toMatchObject({
      kind: "ready",
      title: "Server Ready"
    });
  });

  it("does not dispatch when the server operation is not executable", async () => {
    const context = createControllerContext({
      operation: {
        executable: false,
        kind: "stop",
        reason: "Waiting for a user decision"
      },
      screen: {
        kind: "decision",
        message: "Choose the next option.",
        title: "Decision"
      }
    });

    await context.controller.runNextOperation();

    expect(context.actions.runActionById).not.toHaveBeenCalled();
    expect(context.actions.advanceSession).not.toHaveBeenCalled();
    expect(context.commandRunner.runCommandAction).not.toHaveBeenCalled();
    expect(context.controller.screenState.value.kind).toBe("decision");
  });

  it("surfaces command failures and retries from the server operation", async () => {
    const context = createControllerContext({
      commandFails: true,
      operation: {
        actionId: "cmd_action",
        advanceOnSuccess: true,
        executable: true,
        id: "command-terminal:cmd_action",
        kind: "command",
        label: "Run command",
        route: "command-terminal"
      }
    });

    await context.controller.runNextOperation();

    expect(context.controller.screenState.value.kind).toBe("command");
    expect(context.controller.commandResult.value.ok).toBe(false);

    context.commandFails.value = false;
    await context.controller.retry();

    expect(context.session.value.currentStep).toBe("step_b");
    expect(context.actions.advanceSession).not.toHaveBeenCalled();
  });

  it("refreshes stale command-start conflicts instead of showing command failure", async () => {
    const context = createControllerContext({
      commandStartConflict: true,
      operation: {
        actionId: "cmd_action",
        advanceOnSuccess: true,
        executable: true,
        id: "command-terminal:cmd_action",
        kind: "command",
        label: "Run command",
        route: "command-terminal"
      }
    });

    await context.controller.runNextOperation();

    expect(context.commandRunner.runCommandAction).toHaveBeenCalledTimes(1);
    expect(context.commandRunner.clearResult).toHaveBeenCalledTimes(1);
    expect(context.session.value.currentStep).toBe("step_b");
    expect(context.controller.failure.value).toBe(null);
    expect(context.controller.commandResult.value).toBe(null);
    expect(context.controller.screenState.value.kind).toBe("ready");
  });

  it("keeps following server state when terminal transport fails after a command completed", async () => {
    const context = createControllerContext({
      commandTransportFailsAfterServerProgress: true,
      operation: {
        actionId: "cmd_action",
        executable: true,
        id: "command-terminal:cmd_action",
        kind: "command",
        label: "Run command",
        route: "command-terminal"
      }
    });

    await context.controller.runNextOperation();

    expect(context.commandRunner.runCommandAction).toHaveBeenCalledTimes(1);
    expect(context.commandRunner.clearResult).toHaveBeenCalledTimes(1);
    expect(context.actions.advanceSession).toHaveBeenCalledTimes(1);
    expect(context.session.value.currentStep).toBe("step_b");
    expect(context.controller.failure.value).toBe(null);
    expect(context.controller.commandResult.value).toBe(null);
  });

  it("continues through a server-provided follow-up operation after command success", async () => {
    const context = createControllerContext({
      commandCompletesWithServerAdvance: true,
      operation: {
        actionId: "cmd_action",
        executable: true,
        id: "command-terminal:cmd_action",
        kind: "command",
        label: "Run command",
        route: "command-terminal"
      }
    });

    await context.controller.runNextOperation();

    expect(context.commandRunner.runCommandAction).toHaveBeenCalledTimes(1);
    expect(context.actions.advanceSession).toHaveBeenCalledTimes(1);
    expect(context.session.value.currentStep).toBe("step_b");
    expect(context.controller.failure.value).toBe(null);
  });

  it("keeps refreshing after command success until attempting_execution clears", async () => {
    const context = createControllerContext({
      commandCompletesWithServerAdvance: true,
      commandCompletionStaleRefreshes: 2,
      operation: {
        actionId: "cmd_action",
        executable: true,
        id: "command-terminal:cmd_action",
        kind: "command",
        label: "Run command",
        route: "command-terminal"
      }
    });

    await context.controller.runNextOperation();

    expect(context.refreshSessionData).toHaveBeenCalledTimes(4);
    expect(context.actions.advanceSession).toHaveBeenCalledTimes(1);
    expect(context.session.value.currentStep).toBe("step_b");
    expect(context.controller.failure.value).toBe(null);
  });

  it("stops command completion polling when the server lifecycle says the result is committed", async () => {
    const context = createControllerContext({
      commandCompletionLifecyclePhase: "result_written",
      commandCompletionStaleRefreshes: 99,
      operation: {
        actionId: "cmd_action",
        executable: true,
        id: "command-terminal:cmd_action",
        kind: "command",
        label: "Run command",
        route: "command-terminal"
      }
    });

    await context.controller.runNextOperation();

    expect(context.refreshSessionData).toHaveBeenCalledTimes(1);
    expect(context.controller.stuckRecoveryAvailable.value).toBe(false);
    expect(context.controller.failure.value).toBe(null);
  });

  it("offers stuck-step recovery only after command completion refresh times out", async () => {
    const context = createControllerContext({
      commandCompletionRefreshAttempts: 2,
      commandCompletionStaleRefreshes: 99,
      operation: {
        actionId: "cmd_action",
        executable: true,
        id: "command-terminal:cmd_action",
        kind: "command",
        label: "Run command",
        route: "command-terminal"
      }
    });

    await context.controller.runNextOperation();

    expect(context.actions.recoverStuckStep).not.toHaveBeenCalled();
    expect(context.controller.stuckRecoveryAvailable.value).toBe(true);

    await context.controller.recoverStuckStep();

    expect(context.actions.recoverStuckStep).toHaveBeenCalledWith({
      sessionId: "session-1"
    });
    expect(context.controller.stuckRecoveryAvailable.value).toBe(false);
    expect(context.session.value.stepMachine.status).toBe("ready");
  });
});

function createControllerContext({
  commandCompletesWithServerAdvance = false,
  commandCompletionLifecyclePhase = "",
  commandCompletionRefreshAttempts = 6,
  commandCompletionStaleRefreshes = 0,
  commandStartConflict = false,
  commandFails = false,
  commandTransportFailsAfterServerProgress = false,
  enabled = true,
  intents = [],
  operation = {
    executable: false,
    kind: "stop"
  },
  screen = {
    kind: "ready",
    title: "Ready"
  },
  stepStatus = "ready"
} = {}) {
  const commandFailsRef = ref(commandFails);
  const enabledRef = ref(enabled);
  const stepMachine = ref({
    status: stepStatus,
    stepId: "step_a"
  });
  const session = ref(sessionView({
    intents,
    operation,
    screen,
    stepId: "step_a",
    stepMachine: stepMachine.value
  }));
  const commandRunning = ref(false);
  const commandOutput = ref("");
  const commandPreview = ref("");
  const commandResult = ref(null);
  const commandTransportFailureRefreshPending = ref(false);
  const commandLifecycle = ref(null);
  const commandCompletionStaleRefreshesRef = ref(commandCompletionStaleRefreshes);
  const serverCommandAdvancePending = ref(false);
  const staleCommandRefreshPending = ref(false);

  function syncSession(values = {}) {
    const currentPresentation = session.value?.presentation || {};
    session.value = sessionView({
      commandLifecycle: commandLifecycle.value,
      intents,
      operation: values.operation || currentPresentation.auto?.nextOperation || operation,
      screen: values.screen || currentPresentation.screen || screen,
      stepId: values.stepId || session.value.currentStep,
      stepMachine: stepMachine.value
    });
  }

  const actionSurface = {
    advanceSession: vi.fn(async () => {
      syncSession({
        stepId: "step_b"
      });
    }),
    currentActions: computed(() => session.value.actions),
    currentNext: computed(() => session.value.next),
    recoverStuckStep: vi.fn(async () => {
      stepMachine.value = {
        status: "ready",
        stepId: session.value.currentStep
      };
      syncSession({
        operation
      });
    }),
    runActionById: vi.fn(async () => {
      stepMachine.value = {
        status: "awaiting_agent_result",
        stepId: session.value.currentStep
      };
      syncSession({
        operation: {
          executable: false,
          kind: "wait",
          reason: "codex"
        },
        screen: {
          kind: "codex_running",
          showProgress: true,
          title: "Terminal is transmitting..."
        }
      });
    }),
    runIntentById: vi.fn(async () => {
      syncSession();
    })
  };

  const commandRunner = {
    commandPreview,
    lastResult: commandResult,
    output: commandOutput,
    running: commandRunning,
    clearResult: vi.fn(() => {
      commandResult.value = null;
      commandPreview.value = "";
      commandOutput.value = "";
      commandRunning.value = false;
    }),
    runCommandAction: vi.fn(async ({ action = {}, advanceOnSuccess = false } = {}) => {
      if (commandStartConflict) {
        staleCommandRefreshPending.value = true;
        commandResult.value = {
          actionId: action.id,
          actionLabel: action.label,
          code: "ai_studio_action_disabled",
          error: "This step is already complete.",
          ok: false,
          output: "",
          status: 409,
          terminalSessionId: ""
        };
        return commandResult.value;
      }
      if (commandTransportFailsAfterServerProgress) {
        commandTransportFailureRefreshPending.value = true;
        commandResult.value = {
          actionId: action.id,
          actionLabel: action.label,
          commandPreview: action.label || action.id,
          error: "Terminal stream closed before the command finished.",
          ok: false,
          output: "",
          status: null,
          terminalSessionId: "terminal-1"
        };
        return commandResult.value;
      }
      commandRunning.value = true;
      commandPreview.value = action.label || action.id;
      commandOutput.value = `${action.id} output`;
      commandRunning.value = false;
      if (commandFailsRef.value) {
        commandResult.value = {
          actionId: action.id,
          actionLabel: action.label,
          error: `${action.label} failed.`,
          exitCode: 1,
          ok: false,
          output: commandOutput.value
        };
        return commandResult.value;
      }
      if (advanceOnSuccess === true) {
        serverCommandAdvancePending.value = true;
      }
      commandResult.value = {
        actionId: action.id,
        actionLabel: action.label,
        exitCode: 0,
        ok: true,
        output: commandOutput.value
      };
      return commandResult.value;
    }),
    stopCommandAction: vi.fn()
  };
  const refreshSessionData = vi.fn(async () => {
    if (staleCommandRefreshPending.value) {
      staleCommandRefreshPending.value = false;
      syncSession({
        stepId: "step_b"
      });
      return;
    }
    if (commandTransportFailureRefreshPending.value) {
      commandTransportFailureRefreshPending.value = false;
      stepMachine.value = {
        status: "done",
        stepId: session.value.currentStep
      };
      syncSession({
        operation: {
          executable: true,
          id: "session-advance:step_b",
          kind: "advance",
          label: "Next step",
          route: "session-advance"
        },
        screen: {
          kind: "ready",
          title: "Command completed"
        }
      });
      return;
    }
    if (commandResult.value?.ok === true && commandCompletionStaleRefreshesRef.value > 0) {
      commandCompletionStaleRefreshesRef.value -= 1;
      stepMachine.value = {
        status: "attempting_execution",
        stepId: session.value.currentStep
      };
      commandLifecycle.value = commandCompletionLifecyclePhase
        ? {
            actionId: commandResult.value.actionId,
            id: `1-${commandResult.value.actionId}`,
            phase: commandCompletionLifecyclePhase,
            status: commandCompletionLifecyclePhase,
            stepId: session.value.currentStep,
            stepRevision: session.value.stepRevision
          }
        : null;
      syncSession({
        operation: {
          executable: false,
          kind: "wait",
          reason: "command applying"
        },
        screen: {
          kind: "command",
          title: "Command applying"
        }
      });
      return;
    }
    if (serverCommandAdvancePending.value && commandResult.value?.ok === true) {
      serverCommandAdvancePending.value = false;
      syncSession({
        stepId: "step_b"
      });
      return;
    }
    if (commandCompletesWithServerAdvance && commandResult.value?.ok === true) {
      stepMachine.value = {
        status: "done",
        stepId: session.value.currentStep
      };
      syncSession({
        operation: {
          executable: true,
          id: "session-advance:step_b",
          kind: "advance",
          label: "Next step",
          route: "session-advance"
        },
        screen: {
          kind: "ready",
          title: "Command completed"
        }
      });
      return;
    }
    syncSession();
  });
  const controller = useAiStudioAutopilotController({
    actions: actionSurface,
    commandCompletionRefreshAttempts,
    commandCompletionRefreshDelayMs: 0,
    commandRunner,
    enabled: enabledRef,
    refreshSessionData,
    session
  });

  return {
    actions: actionSurface,
    commandFails: commandFailsRef,
    commandRunner,
    controller,
    refreshSessionData,
    session
  };
}

function sessionView({
  commandLifecycle = null,
  intents = [],
  operation = {},
  screen = {},
  stepId = "step_a",
  stepMachine = null
} = {}) {
  const nextOperation = stepId === "step_a" ? operation : {
    executable: false,
    kind: "stop"
  };
  const next = {
    enabled: true,
    label: "Next step",
    stepId: "step_b",
    visible: true
  };
  return {
    actions: [],
    commandLifecycles: commandLifecycle ? [commandLifecycle] : [],
    currentCommandLifecycle: commandLifecycle,
    currentStep: stepId,
    currentStepDefinition: {
      id: stepId,
      label: "Current step"
    },
    intents,
    metadata: {},
    next,
    presentation: {
      auto: {
        nextOperation
      },
      intents,
      screen,
      step: {
        id: stepId,
        label: "Current step",
        status: stepMachine?.status || ""
      }
    },
    sessionId: "session-1",
    stepMachine,
    stepRevision: 1
  };
}
