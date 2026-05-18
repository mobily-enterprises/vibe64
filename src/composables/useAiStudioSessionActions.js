import { computed, ref, unref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import {
  useAiStudioIssueFileStep
} from "@/composables/useAiStudioIssueFileStep.js";
import {
  latestAiStudioActionResult
} from "@/lib/aiStudioActionResults.js";
import {
  PULL_REQUEST_ARTIFACT
} from "@/lib/aiStudioArtifactNames.js";
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
  aiStudioSessionPath,
  commandInputFromContext
} from "@/lib/aiStudioSessionRequestConfig.js";

const CREATE_PULL_REQUEST_FILE_ACTION_ID = "create_pr_file";
const PULL_REQUEST_FILE_STEP_ID = "pr_file_created";

function booleanValue(value) {
  return typeof value === "function" ? Boolean(value()) : Boolean(unref(value));
}

function displayableActionResultMessage(result = {}) {
  const message = String(result?.message || "");
  return /^Rendered\b/u.test(message) ? "" : message;
}

function useAiStudioSessionActions({
  clearCopyStatus = () => null,
  codexHandoff,
  commandBusy = () => false,
  commandTerminal,
  onRewindSuccess = () => null,
  openDraftEditor = async () => null,
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
      if (await codexHandoff.startFromActionResponse(response, context)) {
        return;
      }
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
      codexHandoff.clearPromptOverride();
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
  const issueFileStep = useAiStudioIssueFileStep({
    activeActionId,
    clearCopyStatus,
    commandBusy,
    runActionCommand,
    selectedSession,
    selectedSessionId
  });
  const currentActions = computed(() => {
    return issueFileStep.visibleActions(baseCurrentActions.value);
  });
  const worktreeReady = computed(() => Boolean(selectedSession.value?.metadata?.worktree_path));
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
    if (issueFileStep.formVisible.value) {
      return "";
    }
    return resolveCurrentStepDisabledReason(currentActions.value, currentNext.value);
  });
  const waitingForPullRequestFile = computed(() => {
    return selectedSession.value?.currentStep === PULL_REQUEST_FILE_STEP_ID &&
      Boolean(latestAiStudioActionResult(selectedSession.value, CREATE_PULL_REQUEST_FILE_ACTION_ID)) &&
      selectedSession.value?.artifactReadiness?.[PULL_REQUEST_ARTIFACT]?.nonEmpty !== true;
  });
  const waitingForPromptedArtifact = computed(() => {
    return issueFileStep.waitingForFiles.value || waitingForPullRequestFile.value;
  });
  const acceptChangesUtilitiesVisible = computed(() => {
    return selectedSession.value?.currentStep === "changes_accepted" && !issueFileStep.formVisible.value;
  });
  const busy = computed(() => Boolean(
    runActionCommand.isRunning ||
    advanceCommand.isRunning ||
    rewindCommand.isRunning
  ));
  const error = computed(() => {
    return commandMessage(runActionCommand, "error") ||
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

  async function runAction(action = {}) {
    if (!unref(selectedSessionId) || !action.id || booleanValue(commandBusy) || action.enabled !== true) {
      return;
    }
    clearCopyStatus();
    if (normalizeActionInputFields(action.inputFields).length > 0) {
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
    if (action.type === "editor") {
      await openDraftEditor(action);
      return;
    }

    activeActionId.value = action.id;
    try {
      await runActionCommand.run({
        actionId: action.id,
        advanceOnSuccess: action.advanceOnSuccess === true,
        input: issueFileStep.inputForAction(action),
        sessionId: unref(selectedSessionId)
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
    if (!unref(selectedSessionId) || booleanValue(commandBusy) || currentNext.value?.enabled !== true) {
      return;
    }
    await advanceCommand.run({
      sessionId: unref(selectedSessionId)
    });
    commandTerminal.clear();
  }

  async function rewindToStep(step = {}) {
    const stepId = String(step.rewindStepId || step.id || "");
    if (!unref(selectedSessionId) || booleanValue(commandBusy) || step.canRewind !== true || !stepId) {
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
    issueRequest: {
      canSubmit: issueFileStep.canSubmit,
      error: issueFileStep.requestError,
      formVisible: issueFileStep.formVisible,
      sendPrompt: issueFileStep.sendPrompt,
      submitting: issueFileStep.submitting,
      submitTitle: issueFileStep.submitTitle,
      text: issueFileStep.requestText
    },
    rewindCommand,
    rewindToStep,
    runAction,
    runActionCommand,
    waitingForPromptedArtifact,
    worktreeReady
  };
}

export {
  useAiStudioSessionActions
};
