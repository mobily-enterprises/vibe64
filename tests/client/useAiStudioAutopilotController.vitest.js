import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  useAiStudioAutopilotController
} from "../../src/composables/useAiStudioAutopilotController.js";

describe("useAiStudioAutopilotController", () => {
  it("runs the server-selected command operation and lets the server advance", async () => {
    const context = createControllerContext({
      actions: [
        {
          enabled: true,
          id: "cmd_action",
          label: "Run command",
          type: "command"
        }
      ],
      operation: {
        actionId: "cmd_action",
        advanceOnSuccess: true,
        kind: "action",
        label: "Run command"
      }
    });

    await context.controller.start();

    expect(context.commandRunner.runCommandAction).toHaveBeenCalledWith(expect.objectContaining({
      action: expect.objectContaining({ id: "cmd_action" }),
      advanceOnSuccess: true,
      sessionId: "session-1"
    }));
    expect(context.session.value.currentStep).toBe("step_b");
  });

  it("runs a server-selected prompt action and waits for the step machine result", async () => {
    const context = createControllerContext({
      actions: [
        {
          enabled: true,
          id: "prompt_action",
          label: "Ask Codex",
          promptId: "prompt_action",
          type: "prompt"
        }
      ],
      operation: {
        actionId: "prompt_action",
        input: {
          request: "Make the change"
        },
        kind: "action",
        label: "Ask Codex"
      }
    });

    await context.controller.start();

    expect(context.actions.runAction).toHaveBeenCalledWith(expect.objectContaining({
      id: "prompt_action"
    }), {
      input: {
        request: "Make the change"
      }
    });
    expect(context.session.value.stepMachine.status).toBe("done");
    expect(context.controller.failure.value).toBe(null);
  });

  it("runs presented intents without knowing what the intent means", async () => {
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

    expect(context.actions.runIntent).toHaveBeenCalledWith(expect.objectContaining({
      id: "server_intent"
    }), {
      fields: {
        feedback: "Please adjust the copy."
      }
    });
  });

  it("does not invent progress when the server says to stop", async () => {
    const context = createControllerContext({
      operation: {
        kind: "stop",
        reason: "Waiting for a user decision"
      },
      screen: {
        kind: "decision",
        message: "Choose the next option.",
        title: "Decision"
      }
    });

    await context.controller.start();

    expect(context.actions.runAction).not.toHaveBeenCalled();
    expect(context.actions.goNext).not.toHaveBeenCalled();
    expect(context.commandRunner.runCommandAction).not.toHaveBeenCalled();
    expect(context.controller.screenState.value.kind).toBe("decision");
  });

  it("surfaces command failures and retries from the server operation", async () => {
    const context = createControllerContext({
      actions: [
        {
          enabled: true,
          id: "cmd_action",
          label: "Run command",
          type: "command"
        }
      ],
      commandFails: true,
      operation: {
        actionId: "cmd_action",
        advanceOnSuccess: true,
        kind: "action",
        label: "Run command"
      }
    });

    await context.controller.start();

    expect(context.controller.screenState.value.kind).toBe("command");
    expect(context.controller.commandResult.value.ok).toBe(false);

    context.commandFails.value = false;
    await context.controller.retry();

    expect(context.session.value.currentStep).toBe("step_b");
  });
});

function createControllerContext({
  actions = [],
  commandFails = false,
  enabled = true,
  intents = [],
  operation = {
    kind: "stop"
  },
  screen = {
    kind: "ready",
    title: "Ready"
  }
} = {}) {
  const commandFailsRef = ref(commandFails);
  const enabledRef = ref(enabled);
  const stepMachine = ref({
    status: "ready",
    stepId: "step_a"
  });
  const session = ref(sessionView({
    actions,
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

  function syncSession(values = {}) {
    session.value = sessionView({
      actions,
      intents,
      operation,
      screen,
      stepId: values.stepId || session.value.currentStep,
      stepMachine: stepMachine.value
    });
  }

  const actionSurface = {
    currentActions: computed(() => session.value.actions),
    currentNext: computed(() => session.value.next),
    goNext: vi.fn(async () => {
      syncSession({
        stepId: "step_b"
      });
    }),
    runAction: vi.fn(async (action = {}) => {
      if (action.type === "prompt") {
        stepMachine.value = {
          promptComplete: true,
          status: "done",
          stepId: session.value.currentStep
        };
        syncSession();
      }
    }),
    runIntent: vi.fn(async () => {
      syncSession();
    })
  };

  const commandRunner = {
    commandPreview,
    lastResult: commandResult,
    output: commandOutput,
    running: commandRunning,
    runCommandAction: vi.fn(async ({ action = {}, advanceOnSuccess = false } = {}) => {
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
        await actionSurface.goNext();
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

  const codexTerminal = {
    busy: ref(false),
    working: ref(false)
  };
  const controller = useAiStudioAutopilotController({
    actions: actionSurface,
    codexTerminal,
    commandRunner,
    enabled: enabledRef,
    refreshSessionData: async () => {
      syncSession();
    },
    session
  });

  return {
    actions: actionSurface,
    codexTerminal,
    commandFails: commandFailsRef,
    commandRunner,
    controller,
    session
  };
}

function sessionView({
  actions = [],
  intents = [],
  operation = {},
  screen = {},
  stepId = "step_a",
  stepMachine = null
} = {}) {
  const nextOperation = stepId === "step_a" && stepMachine?.status !== "done"
    ? operation
    : { kind: "stop" };
  const next = {
    enabled: true,
    label: "Next",
    stepId: "step_b",
    visible: true
  };
  return {
    actions,
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
        canResume: ["action", "advance", "intent"].includes(nextOperation.kind),
        canStart: ["action", "advance", "intent"].includes(nextOperation.kind),
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
    stepMachine
  };
}
