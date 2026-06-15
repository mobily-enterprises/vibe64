import { computed, ref, unref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import {
  VIBE64_ACTION_DISPATCH_ROUTES as ACTION_DISPATCH_ROUTES
} from "@local/vibe64-core/shared";
import {
  normalizeActionInputFields
} from "@/lib/vibe64ActionInputModel.js";
import {
  vibe64ActionIcon as actionIcon,
  commandMessage,
  currentStepDisabledReason as resolveCurrentStepDisabledReason
} from "@/lib/vibe64SessionPanelModel.js";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64ActionPath,
  vibe64IntentPath,
  vibe64SessionPath,
  agentSettingsInputFromContext,
  commandInputFromContext
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  vibe64SessionWorktreePath
} from "@/lib/vibe64SessionPaths.js";
import {
  readRefOrGetterBoolean,
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  VIBE64_CLIENT_CONTROL_ACTIONS,
  controlHasClientAction,
  controlUsesClientAction
} from "@/lib/vibe64PresentationControls.js";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
} from "@/lib/vibe64SessionDebugLog.js";

function displayableActionResultMessage(result = {}) {
  const message = String(result?.message || "");
  return /^Rendered\b/u.test(message) ? "" : message;
}

function intentInputFromContext(context = {}) {
  const displayFields = context?.displayFields && typeof context.displayFields === "object" && !Array.isArray(context.displayFields)
    && Object.keys(context.displayFields).length > 0
    ? {
        displayFields: context.displayFields
      }
    : {};
  return {
    ...agentSettingsInputFromContext(context),
    ...displayFields,
    fields: context?.fields && typeof context.fields === "object" && !Array.isArray(context.fields)
      ? context.fields
      : {},
    stepId: String(context?.stepId || ""),
    stepStatus: String(context?.stepStatus || "")
  };
}

function actionDispatchRoute(action = {}) {
  return String(action.dispatchRoute || ACTION_DISPATCH_ROUTES.SESSION_ACTION).trim();
}

function staleAdvanceError(error = {}) {
  return error?.refreshRecommended === true ||
    String(error?.operationOutcome || "") === "stale_operation";
}

function staleAdvanceResult(error = {}) {
  return {
    code: String(error?.code || ""),
    ok: false,
    stale: true,
    status: error?.status ?? null
  };
}

function sessionStatus(session = {}) {
  return String(session?.stepMachine?.status || session?.presentation?.step?.status || "").trim();
}

function runActionSuccessShouldRefreshSession(response = {}, session = {}) {
  if (
    String(response?.actionResult?.status || "").trim() === "prompt_ready" &&
    sessionStatus(session) === "awaiting_agent_result"
  ) {
    return false;
  }
  return true;
}

function useVibe64SessionActions({
  clearCopyStatus = () => null,
  commandBusy = () => false,
  commandTerminal,
  onRewindSuccess = () => null,
  openInputDialog = () => null,
  refreshSessionData,
  selectedSession,
  selectedSessionId,
  sessionsApiPath
} = {}) {
  const activeActionId = ref("");
  const resolvedSessionsApiPath = computed(() => String(readRefOrGetterValue(sessionsApiPath) || ""));

  const runActionCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildRawPayload: (_model, { context }) => commandInputFromContext(context),
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64ActionPath(resolvedSessionsApiPath.value, context?.sessionId, context?.actionId)
    }),
    fallbackRunError: "Vibe64 action could not run.",
    messages: {
      error: "Vibe64 action could not run."
    },
    onRunSuccess: async (response, { context }) => {
      vibe64SessionDebugLog("client.sessionActions.runAction.success", {
        ...vibe64SessionDebugSummary(response || {}),
        actionId: String(context?.actionId || ""),
        actionResultStatus: String(response?.actionResult?.status || ""),
        advanceOnSuccess: context?.advanceOnSuccess === true
      });
      if (runActionSuccessShouldRefreshSession(response, selectedSession.value || {})) {
        await refreshSessionData();
      }
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.action",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const runIntentCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildRawPayload: (_model, { context }) => intentInputFromContext(context),
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64IntentPath(resolvedSessionsApiPath.value, context?.sessionId, context?.intentId)
    }),
    fallbackRunError: "Vibe64 intent could not run.",
    messages: {
      error: "Vibe64 intent could not run."
    },
    onRunSuccess: async (response, { context }) => {
      vibe64SessionDebugLog("client.sessionActions.runIntent.success", {
        ...vibe64SessionDebugSummary(response || {}),
        actionResultStatus: String(response?.actionResult?.status || ""),
        intentId: String(context?.intentId || ""),
        requestedStepId: String(context?.stepId || ""),
        requestedStepStatus: String(context?.stepStatus || "")
      });
      await refreshSessionData();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.intent",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const advanceCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildRawPayload: (_model, { context }) => ({
      stepId: String(context?.stepId || ""),
      stepStatus: String(context?.stepStatus || "")
    }),
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64SessionPath(resolvedSessionsApiPath.value, context?.sessionId, "/advance")
    }),
    fallbackRunError: "Vibe64 session could not advance.",
    messages: {
      error: "Vibe64 session could not advance.",
      success: "Vibe64 session advanced."
    },
    onRunError: async (error, { context }) => {
      if (!staleAdvanceError(error)) {
        return;
      }
      vibe64SessionDebugLog("client.sessionActions.advanceCommand.stale", {
        ...vibe64SessionDebugSummary(selectedSession.value || {}),
        code: String(error?.code || ""),
        error: vibe64SessionDebugError(error),
        selectedSessionId: String(unref(selectedSessionId) || ""),
        sessionId: String(context?.sessionId || ""),
        status: error?.status ?? null
      });
      await refreshSessionData();
      throw staleAdvanceResult(error);
    },
    onRunSuccess: async (response) => {
      vibe64SessionDebugLog("client.sessionActions.advanceCommand.success", {
        ...vibe64SessionDebugSummary(response || selectedSession.value || {}),
        selectedSessionId: String(unref(selectedSessionId) || "")
      });
      await refreshSessionData();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.advance",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
  const recoverStuckStepCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64SessionPath(resolvedSessionsApiPath.value, context?.sessionId, "/recover-stuck-step")
    }),
    fallbackRunError: "Vibe64 session step could not be recovered.",
    messages: {
      error: "Vibe64 session step could not be recovered.",
      success: "Vibe64 session step recovered."
    },
    onRunSuccess: async (response) => {
      vibe64SessionDebugLog("client.sessionActions.recoverStuckStepCommand.success", {
        ...vibe64SessionDebugSummary(response || selectedSession.value || {}),
        selectedSessionId: String(unref(selectedSessionId) || "")
      });
      await refreshSessionData();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.recover-stuck-step",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const rewindCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildRawPayload: (_model, { context }) => ({
      stepId: String(context?.stepId || "")
    }),
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64SessionPath(resolvedSessionsApiPath.value, context?.sessionId, "/rewind")
    }),
    fallbackRunError: "Vibe64 session could not rewind.",
    messages: {
      error: "Vibe64 session could not rewind.",
      success: "Vibe64 session rewound."
    },
    onRunSuccess: async () => {
      onRewindSuccess();
      await refreshSessionData();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.rewind",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const baseCurrentActions = computed(() => {
    return Array.isArray(selectedSession.value?.actions)
      ? selectedSession.value.actions.filter((action) => action.visible !== false)
      : [];
  });
  const currentNext = computed(() => selectedSession.value?.next || null);
  const currentActions = computed(() => {
    return baseCurrentActions.value;
  });
  const worktreeReady = computed(() => Boolean(vibe64SessionWorktreePath(selectedSession.value || {})));
  const latestActionResult = computed(() => {
    if (selectedSession.value?.actionResult) {
      return selectedSession.value.actionResult;
    }
    const actionResults = Array.isArray(selectedSession.value?.actionResults)
      ? selectedSession.value.actionResults
      : [];
    return actionResults
      .filter((result) => result.stepId === selectedSession.value?.currentStep)
      .slice()
      .sort((left, right) => String(left.at || "").localeCompare(String(right.at || "")))
      .at(-1) || null;
  });
  const actionResultMessage = computed(() => displayableActionResultMessage(latestActionResult.value));
  const actionResultType = computed(() => {
    const status = String(latestActionResult.value?.status || "");
    if (status === "completed") {
      return "success";
    }
    if (status === "blocked" || status === "failed") {
      return "warning";
    }
    return "info";
  });
  const currentStepDisabledReason = computed(() => {
    return resolveCurrentStepDisabledReason(currentActions.value, currentNext.value);
  });
  const acceptChangesUtilitiesVisible = computed(() => {
    const intents = Array.isArray(selectedSession.value?.intents) ? selectedSession.value.intents : [];
    return intents.some((intent) => (
      controlUsesClientAction(intent, VIBE64_CLIENT_CONTROL_ACTIONS.OPEN_DIFF) &&
      intent.enabled !== false
    ));
  });
  const busy = computed(() => Boolean(
    runActionCommand.isRunning ||
    runIntentCommand.isRunning ||
    advanceCommand.isRunning ||
    recoverStuckStepCommand.isRunning ||
    rewindCommand.isRunning
  ));
  const error = computed(() => {
    return commandMessage(runActionCommand, "error") ||
      commandMessage(runIntentCommand, "error") ||
      commandMessage(advanceCommand, "error") ||
      commandMessage(recoverStuckStepCommand, "error") ||
      commandMessage(rewindCommand, "error") ||
      "";
  });

  function clear() {
    activeActionId.value = "";
    clearSessionCommandMessages();
  }

  function clearSessionCommandMessages() {
    for (const command of [
      runActionCommand,
      runIntentCommand,
      advanceCommand,
      recoverStuckStepCommand,
      rewindCommand
    ]) {
      command.message = "";
    }
  }

  async function runActionById({
    actionId = "",
    advanceOnSuccess = false,
    agentSettings = null,
    displayInput = null,
    input = {},
    sessionId = unref(selectedSessionId)
  } = {}) {
    const normalizedActionId = String(actionId || "").trim();
    const normalizedSessionId = String(sessionId || "").trim();
    const busy = readRefOrGetterBoolean(commandBusy);
    if (!normalizedSessionId || !normalizedActionId || busy) {
      vibe64SessionDebugLog("client.sessionActions.runActionById.skipped", {
        actionId: normalizedActionId,
        busy,
        reason: !normalizedSessionId ? "missing_session" : !normalizedActionId ? "missing_action" : "busy",
        sessionId: normalizedSessionId
      });
      return;
    }
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("client.sessionActions.runActionById.start", {
      ...vibe64SessionDebugSummary(selectedSession.value || {}),
      actionId: normalizedActionId,
      advanceOnSuccess: advanceOnSuccess === true,
      inputKeys: Object.keys(input && typeof input === "object" && !Array.isArray(input) ? input : {}).sort(),
      sessionId: normalizedSessionId
    });
    clearCopyStatus();
    activeActionId.value = normalizedActionId;
    try {
      const response = await runActionCommand.run({
        actionId: normalizedActionId,
        advanceOnSuccess: advanceOnSuccess === true,
        agentSettings,
        displayInput,
        input: input && typeof input === "object" && !Array.isArray(input) ? input : {},
        sessionId: normalizedSessionId
      });
      vibe64SessionDebugLog("client.sessionActions.runActionById.done", {
        ...vibe64SessionDebugSummary(response || {}),
        actionId: normalizedActionId,
        actionResultStatus: String(response?.actionResult?.status || ""),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        ok: response?.ok !== false,
        sessionId: normalizedSessionId
      });
      return response;
    } catch (error) {
      vibe64SessionDebugLog("client.sessionActions.runActionById.error", {
        actionId: normalizedActionId,
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        sessionId: normalizedSessionId
      });
      throw error;
    } finally {
      activeActionId.value = "";
    }
  }

  async function recoverStuckStep({
    sessionId = unref(selectedSessionId)
  } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    const busy = readRefOrGetterBoolean(commandBusy);
    if (!normalizedSessionId || busy) {
      vibe64SessionDebugLog("client.sessionActions.recoverStuckStep.skipped", {
        ...vibe64SessionDebugSummary(selectedSession.value || {}),
        busy,
        reason: !normalizedSessionId ? "missing_session" : "busy",
        sessionId: normalizedSessionId
      });
      return null;
    }
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("client.sessionActions.recoverStuckStep.start", {
      ...vibe64SessionDebugSummary(selectedSession.value || {}),
      sessionId: normalizedSessionId
    });
    try {
      const response = await recoverStuckStepCommand.run({
        sessionId: normalizedSessionId
      });
      vibe64SessionDebugLog("client.sessionActions.recoverStuckStep.done", {
        ...vibe64SessionDebugSummary(response || selectedSession.value || {}),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        ok: response?.ok !== false,
        sessionId: normalizedSessionId
      });
      commandTerminal.clear();
      return response;
    } catch (error) {
      vibe64SessionDebugLog("client.sessionActions.recoverStuckStep.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        sessionId: normalizedSessionId
      });
      throw error;
    }
  }

  async function runIntentById({
    agentSettings = null,
    displayFields = null,
    fields = {},
    intentId = "",
    sessionId = unref(selectedSessionId),
    stepId = selectedSession.value?.currentStep || "",
    stepStatus = selectedSession.value?.stepMachine?.status || ""
  } = {}) {
    const normalizedIntentId = String(intentId || "").trim();
    const normalizedSessionId = String(sessionId || "").trim();
    const busy = readRefOrGetterBoolean(commandBusy);
    if (!normalizedSessionId || !normalizedIntentId || busy) {
      vibe64SessionDebugLog("client.sessionActions.runIntentById.skipped", {
        busy,
        intentId: normalizedIntentId,
        reason: !normalizedSessionId ? "missing_session" : !normalizedIntentId ? "missing_intent" : "busy",
        sessionId: normalizedSessionId
      });
      return;
    }
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("client.sessionActions.runIntentById.start", {
      ...vibe64SessionDebugSummary(selectedSession.value || {}),
      fieldKeys: Object.keys(fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {}).sort(),
      intentId: normalizedIntentId,
      sessionId: normalizedSessionId,
      stepId: String(stepId || ""),
      stepStatus: String(stepStatus || "")
    });
    clearCopyStatus();
    activeActionId.value = normalizedIntentId;
    try {
      const response = await runIntentCommand.run({
        agentSettings,
        displayFields,
        fields: fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {},
        intentId: normalizedIntentId,
        sessionId: normalizedSessionId,
        stepId,
        stepStatus
      });
      vibe64SessionDebugLog("client.sessionActions.runIntentById.done", {
        ...vibe64SessionDebugSummary(response || {}),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        intentId: normalizedIntentId,
        ok: response?.ok !== false,
        sessionId: normalizedSessionId
      });
      return response;
    } catch (error) {
      vibe64SessionDebugLog("client.sessionActions.runIntentById.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        intentId: normalizedIntentId,
        sessionId: normalizedSessionId
      });
      throw error;
    } finally {
      activeActionId.value = "";
    }
  }

  async function advanceSession({
    sessionId = unref(selectedSessionId),
    stepId = "",
    stepStatus = ""
  } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    const busy = readRefOrGetterBoolean(commandBusy);
    if (!normalizedSessionId || busy || currentNext.value?.enabled !== true) {
      vibe64SessionDebugLog("client.sessionActions.advanceSession.skipped", {
        ...vibe64SessionDebugSummary(selectedSession.value || {}),
        busy,
        nextDisabledReason: String(currentNext.value?.disabledReason || ""),
        reason: !normalizedSessionId ? "missing_session" : busy ? "busy" : "next_disabled",
        sessionId: normalizedSessionId
      });
      return;
    }
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("client.sessionActions.advanceSession.start", {
      ...vibe64SessionDebugSummary(selectedSession.value || {}),
      sessionId: normalizedSessionId
    });
    try {
      const response = await advanceCommand.run({
        sessionId: normalizedSessionId,
        stepId,
        stepStatus
      });
      vibe64SessionDebugLog("client.sessionActions.advanceSession.done", {
        ...vibe64SessionDebugSummary(response || selectedSession.value || {}),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        ok: response?.ok !== false,
        sessionId: normalizedSessionId
      });
      if (response?.stale !== true) {
        commandTerminal.clear();
      }
      return response;
    } catch (error) {
      if (error?.stale === true) {
        return error;
      }
      vibe64SessionDebugLog("client.sessionActions.advanceSession.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        sessionId: normalizedSessionId
      });
      throw error;
    }
  }

  async function runAction(action = {}, options = {}) {
    const busy = readRefOrGetterBoolean(commandBusy);
    if (!unref(selectedSessionId) || !action.id || busy || action.enabled !== true) {
      vibe64SessionDebugLog("client.sessionActions.runAction.skipped", {
        actionId: String(action.id || ""),
        actionEnabled: action.enabled === true,
        busy,
        reason: !unref(selectedSessionId) ? "missing_session" : !action.id ? "missing_action" : busy ? "busy" : "action_disabled",
        sessionId: String(unref(selectedSessionId) || "")
      });
      return;
    }
    const providedInput = options.input && typeof options.input === "object" && !Array.isArray(options.input)
      ? options.input
      : null;
    if (!providedInput && normalizeActionInputFields(action.inputFields).length > 0) {
      openInputDialog(action);
      return;
    }
    if (actionDispatchRoute(action) === ACTION_DISPATCH_ROUTES.EXTERNAL_LINK) {
      openActionLink(action);
      return;
    }
    if (actionDispatchRoute(action) === ACTION_DISPATCH_ROUTES.COMMAND_TERMINAL) {
      vibe64SessionDebugLog("client.sessionActions.runAction.commandTerminal.start", {
        actionId: String(action.id || ""),
        sessionId: String(unref(selectedSessionId) || "")
      });
      commandTerminal.start(action);
      return;
    }
    return runActionById({
      actionId: action.id,
      advanceOnSuccess: action.advanceOnSuccess === true,
      agentSettings: options.agentSettings,
      displayInput: options.displayInput,
      input: providedInput || {}
    });
  }

  async function runIntent(intent = {}, options = {}) {
    const busy = readRefOrGetterBoolean(commandBusy);
    if (!unref(selectedSessionId) || !intent.id || busy || intent.enabled !== true) {
      vibe64SessionDebugLog("client.sessionActions.runIntent.skipped", {
        busy,
        intentEnabled: intent.enabled === true,
        intentId: String(intent.id || ""),
        reason: !unref(selectedSessionId) ? "missing_session" : !intent.id ? "missing_intent" : busy ? "busy" : "intent_disabled",
        sessionId: String(unref(selectedSessionId) || "")
      });
      return;
    }
    if (controlHasClientAction(intent)) {
      return;
    }
    return runIntentById({
      agentSettings: options.agentSettings,
      displayFields: options.displayFields,
      fields: options.fields,
      intentId: intent.id
    });
  }

  function openActionLink(action = {}) {
    const metadataName = String(action.hrefMetadata || "").trim();
    const href = metadataName ? String(selectedSession.value?.metadata?.[metadataName] || "") : "";
    if (href && typeof window !== "undefined") {
      window.open(href, "_blank", "noopener");
    }
  }

  async function goNext() {
    await advanceSession();
  }

  async function rewindToStep(step = {}) {
    const stepId = String(step.rewindStepId || step.id || "");
    if (!unref(selectedSessionId) || readRefOrGetterBoolean(commandBusy) || step.canRewind !== true || !stepId) {
      return;
    }
    await rewindCommand.run({
      sessionId: unref(selectedSessionId),
      stepId
    });
  }

  return {
    acceptChangesUtilitiesVisible,
    actionIcon,
    actionResultMessage,
    actionResultType,
    activeActionId,
    advanceSession,
    advanceCommand,
    busy,
    clear,
    currentActions,
    currentNext,
    currentStepDisabledReason,
    error,
    goNext,
    recoverStuckStep,
    recoverStuckStepCommand,
    rewindCommand,
    rewindToStep,
    runAction,
    runActionById,
    runActionCommand,
    runIntent,
    runIntentById,
    runIntentCommand,
    worktreeReady
  };
}

export {
  runActionSuccessShouldRefreshSession,
  useVibe64SessionActions
};
