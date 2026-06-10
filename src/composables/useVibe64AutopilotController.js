import { computed, getCurrentInstance, nextTick, ref, watch } from "vue";
import {
  useShellWebErrorRuntime
} from "@jskit-ai/shell-web/client/error";
import {
  VIBE64_OPERATION_ROUTES as OPERATION_ROUTES
} from "@local/vibe64-core/shared";
import {
  useVibe64HeadlessCommandRunner
} from "@/composables/useVibe64HeadlessCommandRunner.js";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
} from "@/lib/vibe64SessionDebugLog.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

const COMMAND_COMPLETION_REFRESH_ATTEMPTS = 6;
const COMMAND_COMPLETION_REFRESH_DELAY_MS = 250;
const FAILURE_TEXT_LIMIT = 1200;

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

function agentSettingsRequestOptions(agentSettings = null) {
  return agentSettings && typeof agentSettings === "object" && !Array.isArray(agentSettings)
    ? {
        agentSettings
      }
    : {};
}

function displayFieldsRequestOptions(displayFields = null) {
  return displayFields && typeof displayFields === "object" && !Array.isArray(displayFields) &&
    Object.keys(displayFields).length > 0
    ? {
        displayFields
      }
    : {};
}

function currentCommandPresentation(session = {}) {
  const command = currentPresentation(session).command;
  return command && typeof command === "object" && !Array.isArray(command)
    ? command
    : {};
}

function currentRecoveryPresentation(session = {}) {
  const recovery = currentPresentation(session).recovery || currentCommandPresentation(session).recovery;
  return recovery && typeof recovery === "object" && !Array.isArray(recovery)
    ? recovery
    : {};
}

function operationCanDispatch(operation = {}) {
  const route = String(operation.route || "");
  const operationExecutable = operation.executable === true;
  const routeCanDispatch = Object.values(OPERATION_ROUTES).includes(route);

  return operationExecutable && routeCanDispatch;
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

function truncatedText(value = "", limit = FAILURE_TEXT_LIMIT) {
  const text = String(value || "");
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...`;
}

function currentBrowserLocation() {
  const location = typeof window === "object" ? window.location : null;
  if (!location) {
    return "";
  }
  return `${location.pathname || ""}${location.search || ""}${location.hash || ""}`;
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

function commandStartNeedsRefresh(result = {}) {
  if (result?.ok === true || result?.terminalSessionId) {
    return false;
  }
  return result?.refreshRecommended === true ||
    String(result?.operationOutcome || "") === "stale_operation";
}

function sessionStillApplyingCommand(session = {}) {
  return currentCommandPresentation(session).applying === true;
}

function serverNoLongerPresentsCommand(previousOperation = {}, session = {}) {
  const nextOperation = currentOperation(session);
  if (!operationCanDispatch(nextOperation)) {
    return true;
  }
  if (String(nextOperation.route || "") !== OPERATION_ROUTES.COMMAND_TERMINAL) {
    return true;
  }
  return operationKey(nextOperation) !== operationKey(previousOperation);
}

function serverPresentsCommandFailureInput(session = {}) {
  return String(currentScreen(session).input?.kind || "") === "command_failure_response";
}

function resultSessionId(result = {}) {
  return String(result?.sessionId || "").trim();
}

function actionResultTime(result = {}) {
  const time = new Date(result.at || "").getTime();
  return Number.isFinite(time) ? time : 0;
}

function persistedCommandFailureResult(session = {}) {
  if (!serverPresentsCommandFailureInput(session)) {
    return null;
  }
  const currentStep = String(session?.currentStep || "").trim();
  const failedResult = (Array.isArray(session?.actionResults) ? session.actionResults : [])
    .filter((result) => String(result?.actionType || "") === "command")
    .filter((result) => String(result?.status || "") === "blocked")
    .filter((result) => !currentStep || String(result?.stepId || "") === currentStep)
    .slice()
    .sort((left, right) => actionResultTime(left) - actionResultTime(right))
    .at(-1);
  if (!failedResult) {
    return null;
  }
  return {
    actionId: String(failedResult.actionId || ""),
    actionLabel: String(failedResult.actionLabel || failedResult.actionId || "Command"),
    attemptedCommand: String(failedResult.attemptedCommand || ""),
    commandPreview: String(failedResult.commandPreview || ""),
    error: String(failedResult.message || `${failedResult.actionLabel || failedResult.actionId || "Command"} failed.`),
    exitCode: failedResult.exitCode ?? null,
    ok: false,
    output: String(failedResult.output || ""),
    sessionId: String(session?.sessionId || ""),
    source: "action_result",
    terminalSessionId: String(failedResult.terminalSessionId || "")
  };
}

function useVibe64AutopilotController({
  actions = {},
  agentSettings = null,
  commandCompletionRefreshAttempts = COMMAND_COMPLETION_REFRESH_ATTEMPTS,
  commandCompletionRefreshDelayMs = COMMAND_COMPLETION_REFRESH_DELAY_MS,
  commandRunner = useVibe64HeadlessCommandRunner(),
  enabled = true,
  refreshSessionData = async () => null,
  session
} = {}) {
  const errorRuntime = getCurrentInstance() ? useShellWebErrorRuntime() : null;
  const active = ref(false);
  const activeStage = ref("");
  const failure = ref(null);
  const activeCommandSessionId = ref("");
  const lastCommandResult = ref(null);
  const lastDispatchedOperationKey = ref("");
  const recoveryRunning = ref(false);

  let autopilotPromise = null;
  let rerunRequested = false;
  let stopRequested = false;

  const autopilotEnabled = computed(() => readRefOrGetterValue(enabled) !== false);
  const currentAgentSettings = computed(() => {
    const value = readRefOrGetterValue(agentSettings);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  });
  const currentSession = computed(() => readSession(session));
  const nextOperation = computed(() => currentOperation(currentSession.value));
  const currentSessionId = computed(() => String(currentSession.value?.sessionId || ""));
  const rawCommandResult = computed(() => readRefOrGetterValue(commandRunner.lastResult) || lastCommandResult.value || null);
  const rawCommandResultForCurrentSession = computed(() => {
    const result = rawCommandResult.value;
    if (!result) {
      return null;
    }
    const resultId = resultSessionId(result);
    return !resultId || resultId === currentSessionId.value ? result : null;
  });
  const serverCommandResult = computed(() => persistedCommandFailureResult(currentSession.value));
  const effectiveCommandResult = computed(() => rawCommandResultForCurrentSession.value || serverCommandResult.value || null);
  const rawCommandRunning = computed(() => readRefOrGetterValue(commandRunner.running) === true);
  const commandSessionId = computed(() => (
    resultSessionId(effectiveCommandResult.value) ||
    String(readRefOrGetterValue(commandRunner.activeSessionId) || activeCommandSessionId.value || "")
  ));
  const commandVisibleForCurrentSession = computed(() => Boolean(
    commandSessionId.value &&
    commandSessionId.value === currentSessionId.value
  ));
  const commandOutput = computed(() => commandVisibleForCurrentSession.value
    ? String(readRefOrGetterValue(commandRunner.output) || effectiveCommandResult.value?.output || "")
    : "");
  const commandPreview = computed(() => commandVisibleForCurrentSession.value
    ? String(readRefOrGetterValue(commandRunner.commandPreview) || effectiveCommandResult.value?.commandPreview || "")
    : "");
  const commandResult = computed(() => commandVisibleForCurrentSession.value ? effectiveCommandResult.value : null);
  const commandRunning = computed(() => rawCommandRunning.value && commandVisibleForCurrentSession.value);
  const commandFailed = computed(() => commandResult.value?.ok === false);
  const visibleFailure = computed(() => {
    if (!failure.value) {
      return null;
    }
    const failedSessionId = String(failure.value.sessionId || "");
    return !failedSessionId || failedSessionId === currentSessionId.value ? failure.value : null;
  });
  const running = computed(() => active.value || rawCommandRunning.value);
  const nextOperationKey = computed(() => operationKey(nextOperation.value));
  const nextOperationDispatchKey = computed(() => [
    currentSessionId.value,
    nextOperationKey.value
  ].join("::"));
  const canDispatchNextOperation = computed(() => {
    const hasCurrentSession = Boolean(currentSession.value?.sessionId);
    const nextOperationReady = operationCanDispatch(nextOperation.value);
    const dispatchKeyIsNew = nextOperationDispatchKey.value !== lastDispatchedOperationKey.value;
    const controllerIdle = !running.value;
    const noAutopilotFailure = !visibleFailure.value;
    const noCommandFailure = !commandFailed.value;

    return Boolean(
      autopilotEnabled.value &&
      hasCurrentSession &&
      nextOperationReady &&
      dispatchKeyIsNew &&
      controllerIdle &&
      noAutopilotFailure &&
      noCommandFailure
    );
  });
  const stuckRecoveryAvailable = computed(() => {
    const hasCurrentSession = Boolean(currentSession.value?.sessionId);
    const recoveryPresented = currentRecoveryPresentation(currentSession.value).available === true;
    const controllerIdle = !running.value;
    const commandIdle = !commandRunning.value;

    return Boolean(
      autopilotEnabled.value &&
      hasCurrentSession &&
      recoveryPresented &&
      controllerIdle &&
      commandIdle
    );
  });
  const screenState = computed(() => {
    if (commandRunning.value || commandFailed.value) {
      return {
        icon: "none",
        kind: "command",
        showProgress: false,
        title: commandRunning.value ? "Command running." : "Command needs attention."
      };
    }
    if (visibleFailure.value) {
      return {
        icon: "warning",
        kind: "failure",
        message: String(visibleFailure.value.error || ""),
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
      title: screen.title || "Vibe64",
      variant: screen.variant || ""
    };
  });

  function clearFailure({
    clearCommandResult = false
  } = {}) {
    failure.value = null;
    lastCommandResult.value = null;
    if (clearCommandResult && !rawCommandRunning.value && typeof commandRunner.clearResult === "function") {
      commandRunner.clearResult();
    }
  }

  function selectedSessionIs(sessionId = "") {
    return Boolean(sessionId) && currentSessionId.value === sessionId;
  }

  function currentSessionFor(sessionId = "") {
    return selectedSessionIs(sessionId) ? currentSession.value : null;
  }

  function reportFailureTrail({
    cause = null,
    event = "client.autopilot.failure",
    result = {}
  } = {}) {
    const failedSessionId = resultSessionId(result) || currentSessionId.value;
    const errorDetails = vibe64SessionDebugError(cause || result?.cause || result?.error || result?.message || result);
    const details = {
      actionId: String(result.actionId || ""),
      actionLabel: String(result.actionLabel || result.actionId || "Action"),
      commandPreview: truncatedText(result.commandPreview || ""),
      error: errorDetails,
      exitCode: result.exitCode ?? null,
      location: currentBrowserLocation(),
      output: truncatedText(result.output || ""),
      sessionId: failedSessionId,
      source: String(result.source || "")
    };
    vibe64SessionDebugLog(event, details);

    try {
      console.error("[VIBE64_AUTOPILOT_FAILURE]", {
        ...details,
        message: String(result.error || result.message || errorDetails.message || "Autopilot action failed.")
      });
      if (cause) {
        console.error("[VIBE64_AUTOPILOT_FAILURE_CAUSE]", cause);
      }
    } catch {
      // Console diagnostics must never interfere with session state updates.
    }

    try {
      errorRuntime?.report({
        source: "vibe64.autopilot.failure",
        channel: "silent",
        message: String(result.error || result.message || errorDetails.message || "Autopilot action failed."),
        cause: cause || result?.cause || null,
        severity: "error",
        dedupeKey: [
          "vibe64.autopilot.failure",
          failedSessionId,
          result.actionId || "",
          result.source || "",
          String(result.error || result.message || errorDetails.message || "")
        ].join(":"),
        dedupeWindowMs: 1000,
        details
      });
    } catch (reportError) {
      vibe64SessionDebugLog("client.autopilot.failure.jskitReport.error", {
        error: vibe64SessionDebugError(reportError),
        sessionId: failedSessionId
      });
    }
  }

  function stopWithFailure(result = {}) {
    const failedSessionId = resultSessionId(result) || currentSessionId.value;
    reportFailureTrail({
      cause: result?.cause || null,
      result
    });
    failure.value = {
      actionId: String(result.actionId || ""),
      actionLabel: String(result.actionLabel || result.actionId || "Action"),
      commandPreview: String(result.commandPreview || ""),
      error: String(result.error || "Autopilot action failed."),
      exitCode: result.exitCode ?? null,
      output: String(result.output || ""),
      sessionId: failedSessionId,
      source: String(result.source || "")
    };
  }

  async function runNextOperation() {
    if (!canDispatchNextOperation.value) {
      vibe64SessionDebugLog("client.autopilot.runNextOperation.skipped", {
        ...vibe64SessionDebugSummary(currentSession.value || {}),
        ...operationDebugSummary(nextOperation.value),
        commandFailed: commandFailed.value,
        enabled: autopilotEnabled.value,
        failure: Boolean(visibleFailure.value),
        running: running.value
      });
      return;
    }
    stopRequested = false;
    clearFailure();
    vibe64SessionDebugLog("client.autopilot.runNextOperation.start", {
      ...vibe64SessionDebugSummary(currentSession.value || {}),
      ...operationDebugSummary(nextOperation.value)
    });
    await runUntilStopPoint();
  }

  async function retry() {
    if (!autopilotEnabled.value || running.value) {
      vibe64SessionDebugLog("client.autopilot.retry.skipped", {
        enabled: autopilotEnabled.value,
        running: running.value,
        sessionId: String(currentSession.value?.sessionId || "")
      });
      return;
    }
    vibe64SessionDebugLog("client.autopilot.retry.start", {
      ...vibe64SessionDebugSummary(currentSession.value || {})
    });
    stopRequested = false;
    lastDispatchedOperationKey.value = "";
    clearFailure({
      clearCommandResult: true
    });
    await runUntilStopPoint();
  }

  function stop() {
    vibe64SessionDebugLog("client.autopilot.stop.requested", {
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
      vibe64SessionDebugLog("client.autopilot.recoverStuckStep.skipped", {
        ...vibe64SessionDebugSummary(currentSession.value || {}),
        available: stuckRecoveryAvailable.value,
        recoveryRunning: recoveryRunning.value
      });
      return false;
    }
    const startedAtMs = Date.now();
    recoveryRunning.value = true;
    vibe64SessionDebugLog("client.autopilot.recoverStuckStep.start", {
      ...vibe64SessionDebugSummary(currentSession.value || {})
    });
    try {
      await actions.recoverStuckStep?.({
        sessionId: currentSession.value?.sessionId || ""
      });
      lastDispatchedOperationKey.value = "";
      if (typeof commandRunner.clearResult === "function") {
        commandRunner.clearResult();
      }
      await refreshSessionData();
      await nextTick();
      vibe64SessionDebugLog("client.autopilot.recoverStuckStep.done", {
        ...vibe64SessionDebugSummary(currentSession.value || {}),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs)
      });
      return true;
    } catch (error) {
      vibe64SessionDebugLog("client.autopilot.recoverStuckStep.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        sessionId: String(currentSession.value?.sessionId || "")
      });
      stopWithFailure({
        actionId: "recover_stuck_step",
        actionLabel: "Recover step",
        cause: error,
        error: String(error?.message || error || "Vibe64 session step could not be recovered."),
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
      vibe64SessionDebugLog("client.autopilot.runUntilStopPoint.rerunRequested", {
        ...vibe64SessionDebugSummary(currentSession.value || {}),
        ...operationDebugSummary(nextOperation.value)
      });
      return autopilotPromise;
    }
    const startedAtMs = Date.now();
    const runSessionId = currentSessionId.value;
    vibe64SessionDebugLog("client.autopilot.runUntilStopPoint.start", {
      ...vibe64SessionDebugSummary(currentSession.value || {}),
      ...operationDebugSummary(nextOperation.value)
    });
    do {
      rerunRequested = false;
      autopilotPromise = executeAutopilot();
      try {
        await autopilotPromise;
      } catch (error) {
        stopWithFailure({
          actionId: String(nextOperation.value.actionId || nextOperation.value.intentId || ""),
          actionLabel: String(activeStage.value || nextOperation.value.label || "Autopilot"),
          cause: error,
          error: String(error?.message || error || "Autopilot action failed."),
          source: "autopilot"
        });
        return;
      } finally {
        autopilotPromise = null;
      }
    } while (shouldContinueAutopilotLoop(runSessionId));
    vibe64SessionDebugLog("client.autopilot.runUntilStopPoint.done", {
      ...vibe64SessionDebugSummary(currentSession.value || {}),
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      failure: Boolean(visibleFailure.value),
      stopRequested
    });
  }

  function shouldContinueAutopilotLoop(runSessionId = "") {
    const rerunWasRequested = rerunRequested;
    const nextOperationReady = canDispatchNextOperation.value;
    const stopWasRequested = stopRequested;
    const sameSessionIsSelected = !runSessionId || currentSessionId.value === runSessionId;

    return sameSessionIsSelected && (rerunWasRequested || nextOperationReady) && !stopWasRequested;
  }

  async function executeAutopilot() {
    const startedAtMs = Date.now();
    active.value = true;
    try {
      const sessionNow = currentSession.value;
      if (!autopilotEnabled.value || stopRequested || !sessionNow?.sessionId) {
        vibe64SessionDebugLog("client.autopilot.execute.skipped", {
          enabled: autopilotEnabled.value,
          hasSession: Boolean(sessionNow?.sessionId),
          stopRequested
        });
        return;
      }
      const operation = currentOperation(sessionNow);
      if (!operationCanDispatch(operation)) {
        vibe64SessionDebugLog("client.autopilot.execute.noDispatchableOperation", {
          ...vibe64SessionDebugSummary(sessionNow),
          ...operationDebugSummary(operation)
        });
        return;
      }
      lastDispatchedOperationKey.value = [
        sessionNow.sessionId,
        operationKey(operation)
      ].join("::");
      vibe64SessionDebugLog("client.autopilot.execute.dispatch", {
        ...vibe64SessionDebugSummary(sessionNow),
        ...operationDebugSummary(operation),
        dispatchKey: lastDispatchedOperationKey.value
      });
      await dispatchOperation(operation);
      vibe64SessionDebugLog("client.autopilot.execute.done", {
        ...vibe64SessionDebugSummary(currentSession.value || {}),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs)
      });
    } catch (error) {
      vibe64SessionDebugLog("client.autopilot.execute.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
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
    vibe64SessionDebugLog("client.autopilot.operation.start", {
      ...vibe64SessionDebugSummary(currentSession.value || {}),
      ...operationDebugSummary(operation)
    });
    if (!operationCanDispatch(operation)) {
      vibe64SessionDebugLog("client.autopilot.operation.blocked", {
        ...vibe64SessionDebugSummary(currentSession.value || {}),
        ...operationDebugSummary(operation),
        reason: "not_dispatchable"
      });
      stopWithFailure(missingOperationFailure(operation));
      return;
    }

    const route = String(operation.route || "");
    try {
      await dispatchOperationRoute(route, operation);
      vibe64SessionDebugLog("client.autopilot.operation.done", {
        ...vibe64SessionDebugSummary(currentSession.value || {}),
        ...operationDebugSummary(operation),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs)
      });
    } catch (error) {
      vibe64SessionDebugLog("client.autopilot.operation.error", {
        ...operationDebugSummary(operation),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        sessionId: String(currentSession.value?.sessionId || "")
      });
      throw error;
    }
  }

  async function dispatchOperationRoute(route = "", operation = {}) {
    const dispatchers = operationDispatchers();
    const dispatcher = dispatchers[route];
    if (typeof dispatcher !== "function") {
      stopWithFailure(missingOperationFailure(operation));
      return;
    }
    await dispatcher(operation);
  }

  function operationDispatchers() {
    return {
      [OPERATION_ROUTES.COMMAND_TERMINAL]: runCommandTerminalOperation,
      [OPERATION_ROUTES.SESSION_ACTION]: dispatchSessionActionOperation,
      [OPERATION_ROUTES.SESSION_ADVANCE]: dispatchSessionAdvanceOperation,
      [OPERATION_ROUTES.SESSION_INTENT]: dispatchSessionIntentOperation
    };
  }

  async function refreshAfterServerOperation() {
    await refreshSessionData();
    await nextTick();
  }

  async function dispatchSessionAdvanceOperation(operation = {}) {
    await actions.advanceSession?.({
      sessionId: currentSession.value?.sessionId || "",
      stepId: operation.stepId || currentSession.value?.currentStep || "",
      stepStatus: operation.stepStatus || currentSession.value?.stepMachine?.status || ""
    });
    await refreshAfterServerOperation();
  }

  async function dispatchSessionIntentOperation(operation = {}) {
    await actions.runIntentById?.({
      ...agentSettingsRequestOptions(currentAgentSettings.value),
      fields: operationInput(operation),
      intentId: operation.intentId,
      sessionId: currentSession.value?.sessionId || "",
      stepId: operation.stepId || currentSession.value?.currentStep || "",
      stepStatus: operation.stepStatus || currentSession.value?.stepMachine?.status || ""
    });
    await refreshAfterServerOperation();
  }

  async function dispatchSessionActionOperation(operation = {}) {
    await actions.runActionById?.({
      ...agentSettingsRequestOptions(currentAgentSettings.value),
      actionId: operation.actionId,
      advanceOnSuccess: operation.advanceOnSuccess === true,
      input: operationInput(operation),
      sessionId: currentSession.value?.sessionId || ""
    });
    await refreshAfterServerOperation();
  }

  async function runPresentedIntent(intent = {}, {
    agentSettings: requestedAgentSettings = null,
    continueAfterCompletion = true,
    displayFields = {},
    fields = {}
  } = {}) {
    if (!canRunPresentedIntent(intent)) {
      return false;
    }
    clearFailure();
    active.value = true;
    activeStage.value = intent.label || "Run intent";
    try {
      const response = await actions.runIntentById?.({
        ...agentSettingsRequestOptions(requestedAgentSettings || currentAgentSettings.value),
        ...displayFieldsRequestOptions(displayFields),
        fields,
        intentId: intent.id,
        sessionId: currentSession.value?.sessionId || "",
        stepId: currentSession.value?.currentStep || "",
        stepStatus: currentSession.value?.stepMachine?.status || ""
      });
      await refreshSessionData();
      await nextTick();
      const actionResultStatus = String(response?.actionResult?.status || "");
      if (actionResultStatus === "blocked" || actionResultStatus === "failed") {
        return false;
      }
      if (visibleFailure.value) {
        return false;
      }
      if (continueAfterCompletion) {
        await runUntilStopPoint();
      }
      return !visibleFailure.value;
    } catch (error) {
      stopWithFailure({
        actionId: intent.id,
        actionLabel: intent.label,
        cause: error,
        error: String(error?.message || error || `${intent.label || intent.id} failed.`)
      });
      return false;
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function runCommandAction(action = {}) {
    if (!autopilotEnabled.value || running.value) {
      vibe64SessionDebugLog("client.autopilot.runCommandAction.skipped", {
        actionId: String(action.id || ""),
        enabled: autopilotEnabled.value,
        running: running.value,
        sessionId: String(currentSession.value?.sessionId || "")
      });
      return false;
    }
    clearFailure({
      clearCommandResult: true
    });
    stopRequested = false;
    active.value = true;
    activeStage.value = String(action.label || action.id || "Command");
    try {
      await runCommandTerminalOperation({
        actionId: String(action.id || ""),
        advanceOnSuccess: action.advanceOnSuccess === true,
        id: `manual-command:${String(action.id || "")}`,
        kind: "action",
        label: String(action.label || action.id || "Command"),
        route: OPERATION_ROUTES.COMMAND_TERMINAL
      });
      return !visibleFailure.value;
    } catch (error) {
      vibe64SessionDebugLog("client.autopilot.runCommandAction.error", {
        actionId: String(action.id || ""),
        error: vibe64SessionDebugError(error),
        sessionId: String(currentSession.value?.sessionId || "")
      });
      stopWithFailure({
        actionId: String(action.id || ""),
        actionLabel: String(action.label || action.id || "Command"),
        cause: error,
        error: String(error?.message || error || "Command action failed."),
        source: "manual_command"
      });
      return false;
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  function canRunPresentedIntent(intent = {}) {
    const autopilotCanRun = autopilotEnabled.value;
    const intentIsEnabled = intent.enabled === true;
    const controllerAlreadyActive = active.value;
    const nothingElseRunning = !running.value;
    const intentDispatchSlotAvailable = nothingElseRunning || controllerAlreadyActive;

    return autopilotCanRun &&
      intentDispatchSlotAvailable &&
      intentIsEnabled;
  }

  async function runCommandTerminalOperation(operation = {}) {
    const startedAtMs = Date.now();
    const commandSession = currentSession.value || {};
    const launchedSessionId = String(commandSession.sessionId || "");
    activeCommandSessionId.value = launchedSessionId;
    vibe64SessionDebugLog("client.autopilot.commandTerminal.start", {
      ...vibe64SessionDebugSummary(commandSession),
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
      sessionId: launchedSessionId
    });
    if (commandStartNeedsRefresh(result)) {
      vibe64SessionDebugLog("client.autopilot.commandTerminal.startNeedsRefresh", {
        ...operationDebugSummary(operation),
        code: String(result?.code || ""),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        operationOutcome: String(result?.operationOutcome || ""),
        refreshRecommended: result?.refreshRecommended === true,
        sessionId: launchedSessionId,
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
      if (
        selectedSessionIs(launchedSessionId) &&
        serverNoLongerPresentsCommand(operation, currentSession.value) &&
        !serverPresentsCommandFailureInput(currentSession.value)
      ) {
        vibe64SessionDebugLog("client.autopilot.commandTerminal.serverNoLongerPresentsCommand", {
          ...vibe64SessionDebugSummary(currentSession.value || {}),
          ...operationDebugSummary(operation),
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          resultError: String(result?.error || "")
        });
        lastCommandResult.value = null;
        if (typeof commandRunner.clearResult === "function") {
          commandRunner.clearResult();
        }
        return;
      }
      lastCommandResult.value = result;
      vibe64SessionDebugLog("client.autopilot.commandTerminal.failed", {
        ...operationDebugSummary(operation),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: String(result?.error || ""),
        exitCode: result?.exitCode ?? null,
        sessionId: launchedSessionId
      });
      stopWithFailure(result);
      return;
    }
    await waitForCommandCompletionRefresh({
      operation,
      sessionId: launchedSessionId,
      startedAtMs
    });
    lastCommandResult.value = result;
    vibe64SessionDebugLog("client.autopilot.commandTerminal.done", {
      ...vibe64SessionDebugSummary(currentSessionFor(launchedSessionId) || commandSession),
      ...operationDebugSummary(operation),
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      exitCode: result?.exitCode ?? null
    });
  }

  async function waitForCommandCompletionRefresh({
    operation = {},
    sessionId = "",
    startedAtMs = Date.now()
  } = {}) {
    const maxAttempts = Math.max(0, Number(commandCompletionRefreshAttempts) || 0);
    const baseDelayMs = Math.max(0, Number(commandCompletionRefreshDelayMs) || 0);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (!selectedSessionIs(sessionId) || !sessionStillApplyingCommand(currentSession.value)) {
        return true;
      }
      const delayMs = baseDelayMs * attempt;
      vibe64SessionDebugLog("client.autopilot.commandTerminal.waitForState", {
        ...vibe64SessionDebugSummary(currentSessionFor(sessionId) || {}),
        ...operationDebugSummary(operation),
        attempt,
        delayMs,
        durationMs: vibe64SessionDebugDurationMs(startedAtMs)
      });
      if (delayMs > 0) {
        await delay(delayMs);
      }
      await refreshSessionData();
      await nextTick();
    }
    vibe64SessionDebugLog("client.autopilot.commandTerminal.waitForState.timeout", {
      ...vibe64SessionDebugSummary(currentSession.value || {}),
      ...operationDebugSummary(operation),
      attempts: maxAttempts,
      durationMs: vibe64SessionDebugDurationMs(startedAtMs)
    });
    return !selectedSessionIs(sessionId) || !sessionStillApplyingCommand(currentSession.value);
  }

  watch(nextOperationDispatchKey, (key) => {
    if (key !== lastDispatchedOperationKey.value) {
      vibe64SessionDebugLog("client.autopilot.dispatchKey.reset", {
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
    failure: visibleFailure,
    nextOperation,
    nextOperationKey,
    recoverStuckStep,
    retry,
    runCommandAction,
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
  useVibe64AutopilotController
};
