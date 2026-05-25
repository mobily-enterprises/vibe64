import { computed, nextTick, ref, watch } from "vue";
import {
  useAiStudioHeadlessCommandRunner
} from "@/composables/useAiStudioHeadlessCommandRunner.js";
import {
  aiStudioSessionDebugDurationMs,
  aiStudioSessionDebugError,
  aiStudioSessionDebugLog,
  aiStudioSessionDebugSummary
} from "@/lib/aiStudioSessionDebugLog.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

const OPERATION_ROUTES = Object.freeze({
  COMMAND_TERMINAL: "command-terminal",
  SESSION_ACTION: "session-action",
  SESSION_ADVANCE: "session-advance",
  SESSION_INTENT: "session-intent"
});
const STALE_COMMAND_START_CODES = Object.freeze(new Set([
  "ai_studio_action_disabled",
  "ai_studio_action_not_available",
  "ai_studio_step_input_state_changed",
  "ai_studio_step_not_ready"
]));
const COMMAND_COMPLETION_REFRESH_ATTEMPTS = 6;
const COMMAND_COMPLETION_REFRESH_DELAY_MS = 250;
const STUCK_EXECUTION_RECOVERY_MIN_AGE_MS = 30000;
const STEP_STATUS_ATTEMPTING_EXECUTION = "attempting_execution";
const COMMAND_LIFECYCLE_APPLYING_PHASES = Object.freeze(new Set([
  "starting",
  "started",
  "terminal_exited",
  "result_writing"
]));

function delay(ms = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readSession(session) {
  return readRefOrGetterValue(session) || null;
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
    : { executable: false, kind: "stop" };
}

function operationInput(operation = {}) {
  const input = operation.input || operation.fields;
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function operationCanDispatch(operation = {}) {
  return operation.executable === true &&
    Object.values(OPERATION_ROUTES).includes(String(operation.route || ""));
}

function operationKey(operation = {}) {
  return [
    operation.route || "",
    operation.id || "",
    operation.kind || "",
    operation.actionId || "",
    operation.intentId || "",
    operation.label || "",
    operation.executable === true ? "1" : "0"
  ].join(":");
}

function operationDebugSummary(operation = {}) {
  return {
    operationActionId: String(operation.actionId || ""),
    operationExecutable: operation.executable === true,
    operationId: String(operation.id || ""),
    operationIntentId: String(operation.intentId || ""),
    operationKey: operationKey(operation),
    operationKind: String(operation.kind || ""),
    operationLabel: String(operation.label || ""),
    operationRoute: String(operation.route || "")
  };
}

function missingOperationFailure(operation = {}) {
  return {
    actionId: String(operation.actionId || operation.intentId || ""),
    actionLabel: String(operation.label || "Autopilot"),
    error: `${operation.label || operation.actionId || operation.intentId || "The next operation"} is not dispatchable.`,
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

function commandStartWasRejectedAsStale(result = {}) {
  if (result?.ok === true || result?.terminalSessionId) {
    return false;
  }
  const code = String(result?.code || "");
  if (STALE_COMMAND_START_CODES.has(code)) {
    return true;
  }
  return Number(result?.status || 0) === 409;
}

function commandLifecyclePhase(lifecycle = {}) {
  return String(lifecycle?.phase || lifecycle?.status || "").trim();
}

function commandLifecycleMatchesCurrentStep(session = {}, lifecycle = {}) {
  if (!lifecycle || typeof lifecycle !== "object" || Array.isArray(lifecycle)) {
    return false;
  }
  return String(lifecycle.stepId || "") === String(session?.currentStep || "") &&
    Number(lifecycle.stepRevision || 0) === Number(session?.stepRevision || 0);
}

function currentCommandLifecycle(session = {}) {
  if (commandLifecycleMatchesCurrentStep(session, session?.currentCommandLifecycle)) {
    return session.currentCommandLifecycle;
  }
  const lifecycles = Array.isArray(session?.commandLifecycles) ? session.commandLifecycles : [];
  return lifecycles
    .filter((lifecycle) => commandLifecycleMatchesCurrentStep(session, lifecycle))
    .at(-1) || null;
}

function sessionStillApplyingCommand(session = {}) {
  if (String(session?.stepMachine?.status || "") !== STEP_STATUS_ATTEMPTING_EXECUTION) {
    return false;
  }
  const lifecycle = currentCommandLifecycle(session);
  if (!lifecycle) {
    return true;
  }
  const phase = commandLifecyclePhase(lifecycle);
  return !phase || COMMAND_LIFECYCLE_APPLYING_PHASES.has(phase);
}

function stepMachineStateAgeMs(session = {}, nowMs = Date.now()) {
  const stateAtMs = Date.parse(String(session?.stepMachine?.at || ""));
  return Number.isFinite(stateAtMs) ? Math.max(0, nowMs - stateAtMs) : 0;
}

function serverMovedPastCommandOperation(previousOperation = {}, nextOperation = {}) {
  if (!operationCanDispatch(nextOperation)) {
    return true;
  }
  if (String(nextOperation.route || "") !== OPERATION_ROUTES.COMMAND_TERMINAL) {
    return true;
  }
  return operationKey(nextOperation) !== operationKey(previousOperation);
}

function useAiStudioAutopilotController({
  actions = {},
  commandCompletionRefreshAttempts = COMMAND_COMPLETION_REFRESH_ATTEMPTS,
  commandCompletionRefreshDelayMs = COMMAND_COMPLETION_REFRESH_DELAY_MS,
  commandRunner = useAiStudioHeadlessCommandRunner(),
  enabled = true,
  refreshSessionData = async () => null,
  session
} = {}) {
  const active = ref(false);
  const activeStage = ref("");
  const failure = ref(null);
  const lastCommandResult = ref(null);
  const lastDispatchedOperationKey = ref("");
  const recoveryOfferedAfterTimeout = ref(false);
  const recoveryRunning = ref(false);

  let autopilotPromise = null;
  let rerunRequested = false;
  let stopRequested = false;

  const autopilotEnabled = computed(() => readRefOrGetterValue(enabled) !== false);
  const currentSession = computed(() => readSession(session));
  const nextOperation = computed(() => currentOperation(currentSession.value));
  const commandOutput = computed(() => String(readRefOrGetterValue(commandRunner.output) || ""));
  const commandPreview = computed(() => String(readRefOrGetterValue(commandRunner.commandPreview) || ""));
  const commandResult = computed(() => readRefOrGetterValue(commandRunner.lastResult) || lastCommandResult.value || null);
  const commandRunning = computed(() => readRefOrGetterValue(commandRunner.running) === true);
  const commandFailed = computed(() => commandResult.value?.ok === false);
  const running = computed(() => active.value || commandRunning.value);
  const nextOperationKey = computed(() => operationKey(nextOperation.value));
  const nextOperationDispatchKey = computed(() => [
    currentSession.value?.sessionId || "",
    nextOperationKey.value
  ].join("::"));
  const canDispatchNextOperation = computed(() => Boolean(
    autopilotEnabled.value &&
    currentSession.value?.sessionId &&
    operationCanDispatch(nextOperation.value) &&
    nextOperationDispatchKey.value !== lastDispatchedOperationKey.value &&
    !running.value &&
    !failure.value &&
    !commandFailed.value
  ));
  const stuckRecoveryAvailable = computed(() => Boolean(
    autopilotEnabled.value &&
    currentSession.value?.sessionId &&
    sessionStillApplyingCommand(currentSession.value) &&
    !running.value &&
    !commandRunning.value &&
    (
      recoveryOfferedAfterTimeout.value ||
      stepMachineStateAgeMs(currentSession.value) >= STUCK_EXECUTION_RECOVERY_MIN_AGE_MS
    )
  ));
  const screenState = computed(() => {
    if (commandRunning.value || commandFailed.value) {
      return {
        icon: "none",
        kind: "command",
        showProgress: false,
        title: commandRunning.value ? "Command running." : "Command needs attention."
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
    const screen = currentScreen(currentSession.value);
    return {
      icon: screen.icon || "cog",
      input: screen.input && typeof screen.input === "object" && !Array.isArray(screen.input)
        ? screen.input
        : null,
      kind: screen.kind || "idle",
      message: screen.message || "",
      primaryIntentId: screen.primaryIntentId || "",
      sections: Array.isArray(screen.sections) ? screen.sections : [],
      showProgress: screen.showProgress === true,
      stopAction: screen.stopAction || "",
      title: screen.title || "AI Studio",
      variant: screen.variant || ""
    };
  });

  function clearFailure() {
    failure.value = null;
    lastCommandResult.value = null;
  }

  function stopWithFailure(result = {}) {
    aiStudioSessionDebugLog("client.autopilot.failure", {
      actionId: String(result.actionId || ""),
      actionLabel: String(result.actionLabel || result.actionId || "Action"),
      error: String(result.error || "Autopilot action failed."),
      exitCode: result.exitCode ?? null,
      sessionId: String(currentSession.value?.sessionId || ""),
      source: String(result.source || "")
    });
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

  async function runNextOperation() {
    if (!canDispatchNextOperation.value) {
      aiStudioSessionDebugLog("client.autopilot.runNextOperation.skipped", {
        ...aiStudioSessionDebugSummary(currentSession.value || {}),
        ...operationDebugSummary(nextOperation.value),
        commandFailed: commandFailed.value,
        enabled: autopilotEnabled.value,
        failure: Boolean(failure.value),
        running: running.value
      });
      return;
    }
    stopRequested = false;
    clearFailure();
    aiStudioSessionDebugLog("client.autopilot.runNextOperation.start", {
      ...aiStudioSessionDebugSummary(currentSession.value || {}),
      ...operationDebugSummary(nextOperation.value)
    });
    await runUntilStopPoint();
  }

  async function retry() {
    if (!autopilotEnabled.value || running.value) {
      aiStudioSessionDebugLog("client.autopilot.retry.skipped", {
        enabled: autopilotEnabled.value,
        running: running.value,
        sessionId: String(currentSession.value?.sessionId || "")
      });
      return;
    }
    aiStudioSessionDebugLog("client.autopilot.retry.start", {
      ...aiStudioSessionDebugSummary(currentSession.value || {})
    });
    stopRequested = false;
    lastDispatchedOperationKey.value = "";
    clearFailure();
    await runUntilStopPoint();
  }

  function stop() {
    aiStudioSessionDebugLog("client.autopilot.stop.requested", {
      commandRunning: commandRunning.value,
      sessionId: String(currentSession.value?.sessionId || "")
    });
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

  async function recoverStuckStep() {
    if (!stuckRecoveryAvailable.value || recoveryRunning.value) {
      aiStudioSessionDebugLog("client.autopilot.recoverStuckStep.skipped", {
        ...aiStudioSessionDebugSummary(currentSession.value || {}),
        available: stuckRecoveryAvailable.value,
        recoveryRunning: recoveryRunning.value
      });
      return false;
    }
    const startedAtMs = Date.now();
    recoveryRunning.value = true;
    aiStudioSessionDebugLog("client.autopilot.recoverStuckStep.start", {
      ...aiStudioSessionDebugSummary(currentSession.value || {})
    });
    try {
      await actions.recoverStuckStep?.({
        sessionId: currentSession.value?.sessionId || ""
      });
      recoveryOfferedAfterTimeout.value = false;
      lastDispatchedOperationKey.value = "";
      if (typeof commandRunner.clearResult === "function") {
        commandRunner.clearResult();
      }
      await refreshSessionData();
      await nextTick();
      aiStudioSessionDebugLog("client.autopilot.recoverStuckStep.done", {
        ...aiStudioSessionDebugSummary(currentSession.value || {}),
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs)
      });
      return true;
    } catch (error) {
      aiStudioSessionDebugLog("client.autopilot.recoverStuckStep.error", {
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
        error: aiStudioSessionDebugError(error),
        sessionId: String(currentSession.value?.sessionId || "")
      });
      stopWithFailure({
        actionId: "recover_stuck_step",
        actionLabel: "Recover step",
        error: String(error?.message || error || "AI Studio session step could not be recovered."),
        source: "recovery"
      });
      return false;
    } finally {
      recoveryRunning.value = false;
    }
  }

  async function runUntilStopPoint() {
    if (autopilotPromise) {
      rerunRequested = true;
      aiStudioSessionDebugLog("client.autopilot.runUntilStopPoint.rerunRequested", {
        ...aiStudioSessionDebugSummary(currentSession.value || {}),
        ...operationDebugSummary(nextOperation.value)
      });
      return autopilotPromise;
    }
    const startedAtMs = Date.now();
    aiStudioSessionDebugLog("client.autopilot.runUntilStopPoint.start", {
      ...aiStudioSessionDebugSummary(currentSession.value || {}),
      ...operationDebugSummary(nextOperation.value)
    });
    do {
      rerunRequested = false;
      autopilotPromise = executeAutopilot();
      try {
        await autopilotPromise;
      } finally {
        autopilotPromise = null;
      }
    } while ((rerunRequested || canDispatchNextOperation.value) && !stopRequested);
    aiStudioSessionDebugLog("client.autopilot.runUntilStopPoint.done", {
      ...aiStudioSessionDebugSummary(currentSession.value || {}),
      durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
      failure: Boolean(failure.value),
      stopRequested
    });
  }

  async function executeAutopilot() {
    const startedAtMs = Date.now();
    active.value = true;
    try {
      const sessionNow = currentSession.value;
      if (!autopilotEnabled.value || stopRequested || !sessionNow?.sessionId) {
        aiStudioSessionDebugLog("client.autopilot.execute.skipped", {
          enabled: autopilotEnabled.value,
          hasSession: Boolean(sessionNow?.sessionId),
          stopRequested
        });
        return;
      }
      const operation = currentOperation(sessionNow);
      if (!operationCanDispatch(operation)) {
        aiStudioSessionDebugLog("client.autopilot.execute.noDispatchableOperation", {
          ...aiStudioSessionDebugSummary(sessionNow),
          ...operationDebugSummary(operation)
        });
        return;
      }
      lastDispatchedOperationKey.value = [
        sessionNow.sessionId,
        operationKey(operation)
      ].join("::");
      aiStudioSessionDebugLog("client.autopilot.execute.dispatch", {
        ...aiStudioSessionDebugSummary(sessionNow),
        ...operationDebugSummary(operation),
        dispatchKey: lastDispatchedOperationKey.value
      });
      await dispatchOperation(operation);
      aiStudioSessionDebugLog("client.autopilot.execute.done", {
        ...aiStudioSessionDebugSummary(currentSession.value || {}),
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs)
      });
    } catch (error) {
      aiStudioSessionDebugLog("client.autopilot.execute.error", {
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
        error: aiStudioSessionDebugError(error),
        sessionId: String(currentSession.value?.sessionId || "")
      });
      throw error;
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function dispatchOperation(operation = {}) {
    const startedAtMs = Date.now();
    activeStage.value = String(operation.label || operation.actionId || operation.intentId || "Autopilot");
    aiStudioSessionDebugLog("client.autopilot.operation.start", {
      ...aiStudioSessionDebugSummary(currentSession.value || {}),
      ...operationDebugSummary(operation)
    });
    if (!operationCanDispatch(operation)) {
      aiStudioSessionDebugLog("client.autopilot.operation.blocked", {
        ...aiStudioSessionDebugSummary(currentSession.value || {}),
        ...operationDebugSummary(operation),
        reason: "not_dispatchable"
      });
      stopWithFailure(missingOperationFailure(operation));
      return;
    }

    const route = String(operation.route || "");
    try {
      if (route === OPERATION_ROUTES.SESSION_ADVANCE) {
        await actions.advanceSession?.({
          sessionId: currentSession.value?.sessionId || ""
        });
        await refreshSessionData();
        await nextTick();
      } else if (route === OPERATION_ROUTES.SESSION_INTENT) {
        await actions.runIntentById?.({
          fields: operationInput(operation),
          intentId: operation.intentId,
          sessionId: currentSession.value?.sessionId || "",
          stepId: operation.stepId || currentSession.value?.currentStep || "",
          stepStatus: operation.stepStatus || currentSession.value?.stepMachine?.status || ""
        });
        await refreshSessionData();
        await nextTick();
      } else if (route === OPERATION_ROUTES.SESSION_ACTION) {
        await actions.runActionById?.({
          actionId: operation.actionId,
          advanceOnSuccess: operation.advanceOnSuccess === true,
          input: operationInput(operation),
          sessionId: currentSession.value?.sessionId || ""
        });
        await refreshSessionData();
        await nextTick();
      } else if (route === OPERATION_ROUTES.COMMAND_TERMINAL) {
        await runCommandTerminalOperation(operation);
      }
      aiStudioSessionDebugLog("client.autopilot.operation.done", {
        ...aiStudioSessionDebugSummary(currentSession.value || {}),
        ...operationDebugSummary(operation),
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs)
      });
    } catch (error) {
      aiStudioSessionDebugLog("client.autopilot.operation.error", {
        ...operationDebugSummary(operation),
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
        error: aiStudioSessionDebugError(error),
        sessionId: String(currentSession.value?.sessionId || "")
      });
      throw error;
    }
  }

  async function runPresentedIntent(intent = {}, {
    continueAfterCompletion = true,
    fields = {}
  } = {}) {
    if (!autopilotEnabled.value || running.value && !active.value || intent.enabled !== true) {
      return false;
    }
    clearFailure();
    active.value = true;
    activeStage.value = intent.label || "Run intent";
    try {
      await actions.runIntentById?.({
        fields,
        intentId: intent.id,
        sessionId: currentSession.value?.sessionId || "",
        stepId: currentSession.value?.currentStep || "",
        stepStatus: currentSession.value?.stepMachine?.status || ""
      });
      await refreshSessionData();
      await nextTick();
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

  async function runCommandTerminalOperation(operation = {}) {
    const startedAtMs = Date.now();
    aiStudioSessionDebugLog("client.autopilot.commandTerminal.start", {
      ...aiStudioSessionDebugSummary(currentSession.value || {}),
      ...operationDebugSummary(operation)
    });
    lastCommandResult.value = null;
    const result = await commandRunner.runCommandAction({
      action: {
        id: String(operation.actionId || ""),
        label: String(operation.label || operation.actionId || "Command")
      },
      advanceOnSuccess: operation.advanceOnSuccess === true,
      input: operationInput(operation),
      sessionId: currentSession.value?.sessionId || ""
    });
    if (commandStartWasRejectedAsStale(result)) {
      aiStudioSessionDebugLog("client.autopilot.commandTerminal.staleStartRejected", {
        ...operationDebugSummary(operation),
        code: String(result?.code || ""),
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
        sessionId: String(currentSession.value?.sessionId || ""),
        status: result?.status ?? null
      });
      lastCommandResult.value = null;
      if (typeof commandRunner.clearResult === "function") {
        commandRunner.clearResult();
      }
      await refreshSessionData();
      await nextTick();
      return;
    }
    await refreshSessionData();
    await nextTick();
    if (result?.ok !== true) {
      if (serverMovedPastCommandOperation(operation, currentOperation(currentSession.value))) {
        aiStudioSessionDebugLog("client.autopilot.commandTerminal.serverMovedPastFailure", {
          ...aiStudioSessionDebugSummary(currentSession.value || {}),
          ...operationDebugSummary(operation),
          durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
          resultError: String(result?.error || "")
        });
        lastCommandResult.value = null;
        if (typeof commandRunner.clearResult === "function") {
          commandRunner.clearResult();
        }
        return;
      }
      lastCommandResult.value = result;
      aiStudioSessionDebugLog("client.autopilot.commandTerminal.failed", {
        ...operationDebugSummary(operation),
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
        error: String(result?.error || ""),
        exitCode: result?.exitCode ?? null,
        sessionId: String(currentSession.value?.sessionId || "")
      });
      stopWithFailure(result);
      return;
    }
    await waitForCommandCompletionRefresh({
      operation,
      startedAtMs
    });
    lastCommandResult.value = result;
    aiStudioSessionDebugLog("client.autopilot.commandTerminal.done", {
      ...aiStudioSessionDebugSummary(currentSession.value || {}),
      ...operationDebugSummary(operation),
      durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
      exitCode: result?.exitCode ?? null
    });
  }

  async function waitForCommandCompletionRefresh({
    operation = {},
    startedAtMs = Date.now()
  } = {}) {
    const maxAttempts = Math.max(0, Number(commandCompletionRefreshAttempts) || 0);
    const baseDelayMs = Math.max(0, Number(commandCompletionRefreshDelayMs) || 0);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (!sessionStillApplyingCommand(currentSession.value)) {
        return true;
      }
      const delayMs = baseDelayMs * attempt;
      aiStudioSessionDebugLog("client.autopilot.commandTerminal.waitForState", {
        ...aiStudioSessionDebugSummary(currentSession.value || {}),
        ...operationDebugSummary(operation),
        attempt,
        delayMs,
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs)
      });
      if (delayMs > 0) {
        await delay(delayMs);
      }
      await refreshSessionData();
      await nextTick();
    }
    aiStudioSessionDebugLog("client.autopilot.commandTerminal.waitForState.timeout", {
      ...aiStudioSessionDebugSummary(currentSession.value || {}),
      ...operationDebugSummary(operation),
      attempts: maxAttempts,
      durationMs: aiStudioSessionDebugDurationMs(startedAtMs)
    });
    if (sessionStillApplyingCommand(currentSession.value)) {
      recoveryOfferedAfterTimeout.value = true;
    }
    return !sessionStillApplyingCommand(currentSession.value);
  }

  watch(() => [
    currentSession.value?.sessionId || "",
    currentSession.value?.currentStep || "",
    currentSession.value?.stepMachine?.status || ""
  ].join(":"), () => {
    if (!sessionStillApplyingCommand(currentSession.value)) {
      recoveryOfferedAfterTimeout.value = false;
    }
  });

  watch(nextOperationDispatchKey, (key) => {
    if (key !== lastDispatchedOperationKey.value) {
      aiStudioSessionDebugLog("client.autopilot.dispatchKey.reset", {
        lastDispatchedOperationKey: lastDispatchedOperationKey.value,
        nextOperationDispatchKey: key,
        sessionId: String(currentSession.value?.sessionId || "")
      });
      lastDispatchedOperationKey.value = "";
    }
  });

  return {
    canDispatchNextOperation,
    clearFailure,
    commandOutput,
    commandPreview,
    commandResult,
    commandRunning,
    failure,
    nextOperation,
    nextOperationKey,
    recoverStuckStep,
    retry,
    runNextOperation,
    runPresentedIntent,
    running,
    screenState,
    stuckRecoveryAvailable,
    stuckRecoveryRunning: recoveryRunning,
    stop,
    stopCommandAction
  };
}

export {
  useAiStudioAutopilotController
};
