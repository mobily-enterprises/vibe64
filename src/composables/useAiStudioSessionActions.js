import { computed, ref, unref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import {
  normalizeActionInputFields
} from "@/lib/aiStudioActionInputModel.js";
import {
  aiStudioActionIcon as actionIcon,
  commandMessage,
  currentStepDisabledReason as resolveCurrentStepDisabledReason
} from "@/lib/aiStudioSessionPanelModel.js";
import {
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  aiStudioActionPath,
  aiStudioIntentPath,
  aiStudioSessionPath,
  commandInputFromContext
} from "@/lib/aiStudioSessionRequestConfig.js";
import {
  aiStudioSessionWorktreePath
} from "@/lib/aiStudioSessionPaths.js";
import {
  readRefOrGetterBoolean
} from "@/lib/vueRefOrGetterValue.js";

function displayableActionResultMessage(result = {}) {
  const message = String(result?.message || "");
  return /^Rendered\b/u.test(message) ? "" : message;
}

function intentInputFromContext(context = {}) {
  return {
    fields: context?.fields && typeof context.fields === "object" && !Array.isArray(context.fields)
      ? context.fields
      : {},
    stepId: String(context?.stepId || ""),
    stepStatus: String(context?.stepStatus || "")
  };
}

function useAiStudioSessionActions({
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

  const runActionCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildRawPayload: (_model, { context }) => commandInputFromContext(context),
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: aiStudioActionPath(sessionsApiPath.value, context?.sessionId, context?.actionId)
    }),
    fallbackRunError: "AI Studio action could not run.",
    messages: {
      error: "AI Studio action could not run.",
      success: "AI Studio action completed."
    },
    onRunSuccess: async (response, { context } = {}) => {
      if (actionShouldAdvance(response, context)) {
        await advanceCommand.run({
          sessionId: context.sessionId
        });
        return;
      }
      await refreshSessionData();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.sessions.action",
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "POST"
  });

  const runIntentCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildRawPayload: (_model, { context }) => intentInputFromContext(context),
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: aiStudioIntentPath(sessionsApiPath.value, context?.sessionId, context?.intentId)
    }),
    fallbackRunError: "AI Studio intent could not run.",
    messages: {
      error: "AI Studio intent could not run.",
      success: "AI Studio intent completed."
    },
    onRunSuccess: async (response, { context } = {}) => {
      void response;
      void context;
      await refreshSessionData();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.sessions.intent",
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "POST"
  });

  const advanceCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: aiStudioSessionPath(sessionsApiPath.value, context?.sessionId, "/advance")
    }),
    fallbackRunError: "AI Studio session could not advance.",
    messages: {
      error: "AI Studio session could not advance.",
      success: "AI Studio session advanced."
    },
    onRunSuccess: async () => {
      await refreshSessionData();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.sessions.advance",
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "POST"
  });

  const rewindCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildRawPayload: (_model, { context }) => ({
      stepId: String(context?.stepId || "")
    }),
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: aiStudioSessionPath(sessionsApiPath.value, context?.sessionId, "/rewind")
    }),
    fallbackRunError: "AI Studio session could not rewind.",
    messages: {
      error: "AI Studio session could not rewind.",
      success: "AI Studio session rewound."
    },
    onRunSuccess: async () => {
      onRewindSuccess();
      await refreshSessionData();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.sessions.rewind",
    surfaceId: AI_STUDIO_SURFACE_ID,
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
  const worktreeReady = computed(() => Boolean(aiStudioSessionWorktreePath(selectedSession.value || {})));
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
  const waitingForPromptedArtifact = computed(() => {
    return false;
  });
  const acceptChangesUtilitiesVisible = computed(() => {
    const intents = Array.isArray(selectedSession.value?.intents) ? selectedSession.value.intents : [];
    return intents.some((intent) => intent.clientAction === "open_diff" && intent.enabled !== false);
  });
  const busy = computed(() => Boolean(
    runActionCommand.isRunning ||
    runIntentCommand.isRunning ||
    advanceCommand.isRunning ||
    rewindCommand.isRunning
  ));
  const error = computed(() => {
    return commandMessage(runActionCommand, "error") ||
      commandMessage(runIntentCommand, "error") ||
      commandMessage(advanceCommand, "error") ||
      commandMessage(rewindCommand, "error") ||
      "";
  });

  function actionShouldAdvance(response = {}, context = {}) {
    return context.advanceOnSuccess === true &&
      response.actionResult?.status === "completed" &&
      response.next?.visible === true &&
      response.next?.enabled === true;
  }

  function clear() {
    activeActionId.value = "";
  }

  async function runAction(action = {}, options = {}) {
    if (!unref(selectedSessionId) || !action.id || readRefOrGetterBoolean(commandBusy) || action.enabled !== true) {
      return;
    }
    clearCopyStatus();
    const providedInput = options.input && typeof options.input === "object" && !Array.isArray(options.input)
      ? options.input
      : null;
    if (!providedInput && normalizeActionInputFields(action.inputFields).length > 0) {
      openInputDialog(action);
      return;
    }
    if (action.type === "link") {
      openActionLink(action);
      return;
    }
    if (action.type === "command") {
      commandTerminal.start(action);
      return;
    }
    activeActionId.value = action.id;
    try {
      const input = providedInput || {};
      return await runActionCommand.run({
        actionId: action.id,
        advanceOnSuccess: action.advanceOnSuccess === true,
        input,
        sessionId: unref(selectedSessionId)
      });
    } finally {
      activeActionId.value = "";
    }
  }

  async function runIntent(intent = {}, options = {}) {
    if (!unref(selectedSessionId) || !intent.id || readRefOrGetterBoolean(commandBusy) || intent.enabled !== true) {
      return;
    }
    if (intent.clientAction === "open_diff") {
      return;
    }
    clearCopyStatus();
    activeActionId.value = intent.id;
    try {
      return await runIntentCommand.run({
        fields: options.fields && typeof options.fields === "object" && !Array.isArray(options.fields)
          ? options.fields
          : {},
        intentId: intent.id,
        sessionId: unref(selectedSessionId),
        stepId: selectedSession.value?.currentStep || "",
        stepStatus: selectedSession.value?.stepMachine?.status || ""
      });
    } finally {
      activeActionId.value = "";
    }
  }

  function openActionLink(action = {}) {
    const metadataName = String(action.hrefMetadata || "").trim();
    const href = metadataName ? String(selectedSession.value?.metadata?.[metadataName] || "") : "";
    if (href && typeof window !== "undefined") {
      window.open(href, "_blank", "noopener");
    }
  }

  async function goNext() {
    if (!unref(selectedSessionId) || readRefOrGetterBoolean(commandBusy) || currentNext.value?.enabled !== true) {
      return;
    }
    await advanceCommand.run({
      sessionId: unref(selectedSessionId)
    });
    commandTerminal.clear();
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
    advanceCommand,
    busy,
    clear,
    currentActions,
    currentNext,
    currentStepDisabledReason,
    error,
    goNext,
    rewindCommand,
    rewindToStep,
    runAction,
    runActionCommand,
    runIntent,
    runIntentCommand,
    waitingForPromptedArtifact,
    worktreeReady
  };
}

export {
  useAiStudioSessionActions
};
