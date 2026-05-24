import { computed, nextTick, ref } from "vue";
import {
  useAiStudioHeadlessCommandRunner
} from "@/composables/useAiStudioHeadlessCommandRunner.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

const MAX_AUTOPILOT_OPERATIONS = 40;
const CODEX_TURN_RESULT = Object.freeze({
  COMPLETE: "complete",
  INCOMPLETE: "incomplete",
  WAITING_FOR_INPUT: "waiting_for_input"
});
const STEP_STATUS = Object.freeze({
  ATTEMPTING_EXECUTION: "attempting_execution",
  AWAITING_AGENT_RESULT: "awaiting_agent_result",
  CONFIRM_FILES: "confirm_files",
  DONE: "done",
  FAILED: "failed",
  WAITING_FOR_INPUT: "waiting_for_input",
  READY: "ready"
});

function readSession(session) {
  return readRefOrGetterValue(session) || null;
}

function readActions(actions = {}) {
  const currentActions = readRefOrGetterValue(actions.currentActions);
  return Array.isArray(currentActions) ? currentActions : [];
}

function currentPresentation(session = {}) {
  const presentation = session?.presentation;
  return presentation && typeof presentation === "object" && !Array.isArray(presentation)
    ? presentation
    : {};
}

function currentScreen(session = {}) {
  const screen = currentPresentation(session).screen;
  return screen && typeof screen === "object" && !Array.isArray(screen)
    ? screen
    : {};
}

function currentOperation(session = {}) {
  const operation = currentPresentation(session).auto?.nextOperation;
  return operation && typeof operation === "object" && !Array.isArray(operation)
    ? operation
    : { kind: "stop" };
}

function readIntents(session = {}) {
  return Array.isArray(session?.intents) ? session.intents : [];
}

function actionById(actions = [], actionId = "") {
  return actions.find((action) => action.id === actionId) || null;
}

function intentById(session = {}, intentId = "") {
  return readIntents(session).find((intent) => intent.id === intentId) || null;
}

function actionForIntent(actions = [], intent = {}) {
  return intent.actionId ? actionById(actions, intent.actionId) : null;
}

function stepMachineStatus(session = {}) {
  return String(session?.stepMachine?.status || "");
}

function stepMachineIsPendingPrompt(session = {}) {
  return [
    STEP_STATUS.ATTEMPTING_EXECUTION,
    STEP_STATUS.AWAITING_AGENT_RESULT
  ].includes(stepMachineStatus(session));
}

function stepMachineNeedsInput(session = {}) {
  return [
    STEP_STATUS.CONFIRM_FILES,
    STEP_STATUS.FAILED,
    STEP_STATUS.WAITING_FOR_INPUT
  ].includes(stepMachineStatus(session));
}

function operationCanRun(operation = {}) {
  return ["action", "advance", "intent"].includes(operation.kind);
}

function disabledActionFailure(action = {}, label = "Action") {
  return {
    actionId: String(action.id || ""),
    actionLabel: String(action.label || label),
    error: String(action.disabledReason || `${action.label || label} is disabled.`),
    exitCode: null,
    ok: false,
    output: ""
  };
}

function missingOperationFailure(operation = {}) {
  return {
    actionId: String(operation.actionId || operation.intentId || ""),
    actionLabel: String(operation.label || "Autopilot"),
    error: `${operation.label || operation.actionId || operation.intentId || "The next operation"} is not available.`,
    exitCode: null,
    ok: false,
    output: ""
  };
}

function autopilotStoppedFailure() {
  return {
    actionId: "",
    actionLabel: "Autopilot",
    error: "Autopilot stopped. Use Inspect to continue manually.",
    exitCode: null,
    ok: false,
    output: ""
  };
}

function useAiStudioAutopilotController({
  actions = {},
  commandRunner = useAiStudioHeadlessCommandRunner(),
  enabled = true,
  refreshSessionData = async () => null,
  session
} = {}) {
  const active = ref(false);
  const activeStage = ref("");
  const failure = ref(null);
  const lastCommandResult = ref(null);

  let autopilotPromise = null;
  let stopRequested = false;

  const autopilotEnabled = computed(() => readRefOrGetterValue(enabled) !== false);
  const currentSession = computed(() => readSession(session));
  const presentation = computed(() => currentPresentation(currentSession.value));
  const commandOutput = computed(() => String(readRefOrGetterValue(commandRunner.output) || ""));
  const commandPreview = computed(() => String(readRefOrGetterValue(commandRunner.commandPreview) || ""));
  const commandResult = computed(() => readRefOrGetterValue(commandRunner.lastResult) || lastCommandResult.value || null);
  const commandRunning = computed(() => readRefOrGetterValue(commandRunner.running) === true);
  const codexBlocksAutopilot = computed(() => Boolean(
    stepMachineIsPendingPrompt(currentSession.value)
  ));
  const running = computed(() => active.value || commandRunning.value);
  const waitingForCodex = computed(() => Boolean(
    autopilotEnabled.value &&
    !failure.value &&
    stepMachineIsPendingPrompt(currentSession.value) &&
    currentSession.value?.sessionId
  ));
  const canStart = computed(() => Boolean(
    autopilotEnabled.value &&
    currentSession.value?.sessionId &&
    presentation.value?.auto?.canStart === true &&
    operationCanRun(currentOperation(currentSession.value)) &&
    !running.value &&
    !codexBlocksAutopilot.value &&
    !failure.value
  ));
  const canResume = computed(() => Boolean(
    autopilotEnabled.value &&
    currentSession.value?.sessionId &&
    presentation.value?.auto?.canResume === true &&
    operationCanRun(currentOperation(currentSession.value)) &&
    !running.value &&
    !codexBlocksAutopilot.value &&
    !waitingForCodex.value &&
    !failure.value
  ));
  const screenState = computed(() => {
    if (commandRunning.value || commandResult.value?.ok === false) {
      return {
        icon: "none",
        kind: "command",
        showProgress: false,
        title: commandRunning.value ? "Command running." : "Command needs attention."
      };
    }
    if (waitingForCodex.value) {
      return {
        icon: "progress",
        kind: "codex_running",
        showProgress: true,
        stopAction: "autopilot",
        title: activeStage.value ? `Executing: ${activeStage.value}` : "Codex is working..."
      };
    }
    if (running.value) {
      return {
        icon: "progress",
        kind: "running",
        showProgress: true,
        title: `Executing: ${activeStage.value || currentScreen(currentSession.value).title || "Autopilot"}`
      };
    }
    if (failure.value) {
      return {
        icon: "warning",
        kind: "failure",
        message: String(failure.value.error || ""),
        showProgress: false,
        title: "Attention required"
      };
    }
    if (canStart.value) {
      return {
        buttonLabel: "Let's start",
        icon: "cog",
        kind: "start",
        showProgress: false,
        title: currentScreen(currentSession.value).title || "Ready to run"
      };
    }
    if (canResume.value) {
      return {
        buttonLabel: "Continue Autopilot",
        icon: "cog",
        kind: "resume",
        showProgress: false,
        title: currentScreen(currentSession.value).title || "Ready to continue"
      };
    }
    return {
      icon: currentScreen(currentSession.value).icon || "cog",
      kind: currentScreen(currentSession.value).kind || "idle",
      message: currentScreen(currentSession.value).message || "",
      primaryIntentId: currentScreen(currentSession.value).primaryIntentId || "",
      sections: Array.isArray(currentScreen(currentSession.value).sections)
        ? currentScreen(currentSession.value).sections
        : [],
      showProgress: currentScreen(currentSession.value).showProgress === true,
      title: currentScreen(currentSession.value).title || "AI Studio"
    };
  });
  const statusText = computed(() => screenState.value.title);

  function clearFailure() {
    failure.value = null;
    lastCommandResult.value = null;
  }

  function stopWithFailure(result = {}) {
    failure.value = {
      actionId: String(result.actionId || ""),
      actionLabel: String(result.actionLabel || result.actionId || "Action"),
      commandPreview: String(result.commandPreview || ""),
      error: String(result.error || "Autopilot action failed."),
      exitCode: result.exitCode ?? null,
      output: String(result.output || ""),
      source: String(result.source || "")
    };
  }

  async function start() {
    if (!canStart.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    await runUntilStopPoint();
  }

  async function resume() {
    if (!canResume.value && !operationCanRun(currentOperation(currentSession.value))) {
      return;
    }
    stopRequested = false;
    clearFailure();
    await runUntilStopPoint();
  }

  async function retry() {
    if (!autopilotEnabled.value || running.value || codexBlocksAutopilot.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    await runUntilStopPoint();
  }

  function stop() {
    stopRequested = true;
    if (commandRunning.value && typeof commandRunner.stopCommandAction === "function") {
      commandRunner.stopCommandAction();
      return;
    }
    active.value = false;
    activeStage.value = "";
    stopWithFailure(autopilotStoppedFailure());
  }

  function stopCommandAction() {
    if (!commandRunning.value || typeof commandRunner.stopCommandAction !== "function") {
      return false;
    }
    stopRequested = true;
    return commandRunner.stopCommandAction();
  }

  async function runUntilStopPoint() {
    if (autopilotPromise) {
      return autopilotPromise;
    }
    autopilotPromise = executeAutopilot();
    try {
      return await autopilotPromise;
    } finally {
      autopilotPromise = null;
    }
  }

  async function executeAutopilot() {
    active.value = true;
    try {
      for (let operationCount = 0; operationCount < MAX_AUTOPILOT_OPERATIONS; operationCount += 1) {
        const sessionNow = currentSession.value;
        if (!autopilotEnabled.value || stopRequested || !sessionNow?.sessionId || codexBlocksAutopilot.value) {
          return;
        }
        const operation = currentOperation(sessionNow);
        if (operation.kind === "wait" || operation.kind === "stop" || !operationCanRun(operation)) {
          return;
        }
        await runOperation(operation);
        if (failure.value || stopRequested) {
          return;
        }
      }
      stopWithFailure({
        actionLabel: "Autopilot",
        error: "Autopilot stopped because the session did not make progress."
      });
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function runOperation(operation = {}) {
    activeStage.value = String(operation.label || operation.actionId || operation.intentId || "Autopilot");
    if (operation.kind === "advance") {
      await actions.goNext?.();
      await refreshSessionData();
      await nextTick();
      return;
    }
    if (operation.kind === "intent") {
      const intent = intentById(currentSession.value, operation.intentId);
      if (!intent) {
        stopWithFailure(missingOperationFailure(operation));
        return;
      }
      await runPresentedIntent(intent, {
        fields: operation.input || {},
        continueAfterCompletion: false
      });
      return;
    }
    if (operation.kind === "action") {
      const action = actionById(readActions(actions), operation.actionId);
      if (!action) {
        stopWithFailure(missingOperationFailure(operation));
        return;
      }
      await runPresentedAction(action, {
        continueAfterCompletion: false,
        fields: operation.input || {},
        label: operation.label || action.label,
        terminalAdvanceOnSuccess: operation.advanceOnSuccess === true
      });
    }
  }

  async function runPresentedIntent(intent = {}, {
    continueAfterCompletion = true,
    fields = {}
  } = {}) {
    if (!autopilotEnabled.value || running.value && !active.value || codexBlocksAutopilot.value || intent.enabled !== true) {
      return false;
    }
    clearFailure();
    active.value = true;
    activeStage.value = intent.label || "Run intent";
    try {
      const beforeStepId = currentSession.value?.currentStep || "";
      const promptAction = actionForIntent(readActions(actions), intent);
      const response = await actions.runIntent?.(intent, {
        fields
      });
      await refreshSessionData();
      await nextTick();
      const promptResult = await waitForPromptResponseIfNeeded({
        beforeStepId,
        label: intent.label,
        response,
        shouldWait: promptAction?.type === "prompt" || stepMachineIsPendingPrompt(currentSession.value)
      });
      if (promptResult === CODEX_TURN_RESULT.WAITING_FOR_INPUT) {
        return false;
      }
      if (failure.value) {
        return false;
      }
      if (continueAfterCompletion) {
        await runUntilStopPoint();
      }
      return !failure.value;
    } catch (error) {
      stopWithFailure({
        actionId: intent.id,
        actionLabel: intent.label,
        error: String(error?.message || error || `${intent.label || intent.id} failed.`)
      });
      return false;
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function runPresentedAction(action = {}, {
    continueAfterCompletion = true,
    fields = {},
    label = "",
    terminalAdvanceOnSuccess = true
  } = {}) {
    if (!autopilotEnabled.value || running.value && !active.value || codexBlocksAutopilot.value) {
      return false;
    }
    if (action.enabled !== true) {
      stopWithFailure(disabledActionFailure(action, label || action.label));
      return false;
    }

    clearFailure();
    active.value = true;
    activeStage.value = label || action.label || "Run action";
    try {
      if (action.type === "command") {
        await runTerminalAction(currentSession.value, action, {
          advanceOnSuccess: terminalAdvanceOnSuccess
        });
      } else if (action.type === "prompt") {
        const result = await runPromptAction(action, {
          input: fields,
          label: activeStage.value
        });
        if (result === CODEX_TURN_RESULT.WAITING_FOR_INPUT) {
          return false;
        }
      } else {
        await actions.runAction?.(action, {
          input: fields
        });
        await refreshSessionData();
        await nextTick();
      }

      if (failure.value) {
        return false;
      }
      if (continueAfterCompletion) {
        await runUntilStopPoint();
      }
      return !failure.value;
    } catch (error) {
      stopWithFailure({
        actionId: action.id,
        actionLabel: action.label,
        error: String(error?.message || error || `${action.label || action.id} failed.`),
        source: action.type === "prompt" ? "codex" : ""
      });
      return false;
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function waitForPromptResponseIfNeeded({
    beforeStepId = "",
    label = "",
    response = {},
    shouldWait = false
  } = {}) {
    if (!shouldWait && response?.actionResult?.actionType !== "prompt" && response?.codex?.mode !== "inject_prompt") {
      return CODEX_TURN_RESULT.COMPLETE;
    }
    const actionId = String(response?.actionResult?.actionId || response?.actionResult?.id || "");
    return waitForStepMachinePrompt({
      action: {
        id: actionId,
        label
      },
      label,
      startedAt: Date.now(),
      startingStep: currentSession.value?.currentStep || beforeStepId
    });
  }

  async function runPromptAction(action = {}, {
    input = {},
    label = ""
  } = {}) {
    const startingStep = currentSession.value?.currentStep || "";
    try {
      await actions.runAction?.(action, {
        input
      });
      await refreshSessionData();
      await nextTick();
      return waitForStepMachinePrompt({
        action,
        label: label || action.label,
        startedAt: Date.now(),
        startingStep
      });
    } catch (error) {
      stopWithFailure({
        actionId: action.id,
        actionLabel: action.label,
        error: String(error?.message || error || `${action.label || action.id} failed.`),
        source: "codex"
      });
      return CODEX_TURN_RESULT.INCOMPLETE;
    }
  }

  async function waitForStepMachinePrompt({
    action = {},
    label = "",
    startingStep = ""
  } = {}) {
    void label;
    while (autopilotEnabled.value && !stopRequested && currentSession.value?.currentStep === startingStep) {
      await refreshSessionData();
      await nextTick();
      const status = stepMachineStatus(currentSession.value);
      if (status === STEP_STATUS.READY && currentSession.value?.stepMachine?.promptComplete === true) {
        return CODEX_TURN_RESULT.COMPLETE;
      }
      if (status === STEP_STATUS.CONFIRM_FILES || status === STEP_STATUS.WAITING_FOR_INPUT) {
        return CODEX_TURN_RESULT.WAITING_FOR_INPUT;
      }
      if (status === STEP_STATUS.DONE) {
        return CODEX_TURN_RESULT.COMPLETE;
      }
      void action;
      await waitForCodexOrTimer();
    }
    return CODEX_TURN_RESULT.COMPLETE;
  }

  function waitForCodexOrTimer() {
    return new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
  }

  async function runTerminalAction(sessionNow = {}, action = {}, {
    advanceOnSuccess = true
  } = {}) {
    lastCommandResult.value = null;
    const result = await commandRunner.runCommandAction({
      action,
      advanceOnSuccess,
      input: {},
      sessionId: sessionNow.sessionId
    });
    lastCommandResult.value = result;
    await refreshSessionData();
    await nextTick();
    if (result.ok !== true && !stepMachineNeedsInput(currentSession.value)) {
      stopWithFailure(result);
    }
  }

  return {
    canStart,
    canResume,
    clearFailure,
    commandOutput,
    commandPreview,
    commandResult,
    commandRunning,
    failure,
    readyForAgentConversation: computed(() => currentScreen(currentSession.value).kind === "conversation"),
    retry,
    resume,
    runPresentedAction,
    runPresentedIntent,
    running,
    screenState,
    start,
    statusText,
    stop,
    stopCommandAction,
    waitingForCodex
  };
}

export {
  useAiStudioAutopilotController
};
