import { computed, nextTick, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useList } from "@jskit-ai/users-web/client/composables/useList";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { useAiStudioCodexCommands } from "@/composables/useAiStudioCodexCommands.js";
import {
  ISSUE_BODY_ARTIFACT,
  ISSUE_TITLE_ARTIFACT,
  PULL_REQUEST_ARTIFACT
} from "@/lib/aiStudioArtifactNames.js";
import {
  useAiStudioIssueFileStep
} from "@/composables/useAiStudioIssueFileStep.js";
import { useAiStudioSessionArtifacts } from "@/composables/useAiStudioSessionArtifacts.js";
import { useStoredSelection } from "@/composables/useStoredSelection.js";
import {
  latestAiStudioActionResult
} from "@/lib/aiStudioActionResults.js";
import { writeClipboardText } from "@/lib/clipboard.js";
import {
  isClosedAiStudioSession,
  aiStudioSessionDisplayTitle,
  aiStudioSessionStatusColor,
  aiStudioSessionStatusLabel
} from "@/lib/aiStudioSessionViewModel.js";
import {
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  SELECTED_SESSION_STORAGE_KEY,
  aiStudioActionPath,
  aiStudioSessionPath,
  aiStudioSessionsQueryKey,
  commandInputFromContext
} from "@/lib/aiStudioSessionRequestConfig.js";
import {
  aiStudioActionIcon as actionIcon,
  aiStudioPromptHandoffFromSession,
  aiStudioSessionFacts,
  aiStudioSessionLimits,
  buildAiStudioTimelineSteps,
  commandMessage,
  currentStepDisabledReason as resolveCurrentStepDisabledReason,
  enrichAiStudioSessionForDisplay,
  shortAiStudioSessionId as shortSessionId,
  visibleAiStudioSessions
} from "@/lib/aiStudioSessionPanelModel.js";
function resolveResponseErrorMessage(response = {}, fallback = "AI Studio request failed.") {
  return String(response?.errors?.[0]?.message || response?.error || fallback);
}

const CREATE_PULL_REQUEST_FILE_ACTION_ID = "create_pr_file";
const PULL_REQUEST_FILE_STEP_ID = "pr_file_created";

function useAiStudioSessions({
  onTitleChange = null
} = {}) {
  const notifyTitleChange = typeof onTitleChange === "function" ? onTitleChange : () => null;
  const paths = usePaths();
  const sessionSelection = useStoredSelection({
    storageKey: SELECTED_SESSION_STORAGE_KEY
  });

  const selectedSessionId = sessionSelection.selectedId;
  const activeActionId = ref("");
  const abandonDialogOpen = ref(false);
  const abandonDialogSessionId = ref("");
  const abandonDialogSessionTitle = ref("");
  const copyStatus = ref("");
  const codexPromptInjectionKey = ref("");
  const codexPromptOverride = ref("");
  const codexTerminalBusy = ref(false);
  const commandTerminalAction = ref(null);
  const commandTerminalRunning = ref(false);
  const commandTerminalStartKey = ref("");
  const draftEditorBody = ref("");
  const draftEditorError = ref("");
  const draftEditorIssueTitle = ref("");
  const draftEditorKind = ref("issue");
  const draftEditorLoading = ref(false);
  const draftEditorOpen = ref(false);
  const draftEditorSaving = ref(false);
  const pendingCommandAdvanceOnSuccess = ref(false);
  const pendingCommandStartedAt = ref(0);
  let artifactReadinessRefreshInFlight = false;
  const codexCommands = useAiStudioCodexCommands();
  const sessionArtifacts = useAiStudioSessionArtifacts();

  const sessionsApiPath = computed(() => paths.api(AI_STUDIO_SESSIONS_API_SUFFIX, {
    surface: AI_STUDIO_SURFACE_ID
  }));

  const sessionList = useList({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    fallbackLoadError: "AI Studio sessions could not be loaded.",
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.sessions.list",
    queryKeyFactory: aiStudioSessionsQueryKey,
    selectItems: (payload) => Array.isArray(payload?.sessions) ? payload.sessions : [],
    surfaceId: AI_STUDIO_SURFACE_ID
  });

  const createSessionCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildCommandOptions: () => ({
      options: LOCAL_STUDIO_COMMAND_OPTIONS
    }),
    fallbackRunError: "AI Studio session could not be created.",
    messages: {
      error: "AI Studio session could not be created.",
      success: "AI Studio session created."
    },
    onRunSuccess: async (response) => {
      if (response?.sessionId) {
        sessionSelection.select(response.sessionId);
      }
      await refreshSessionData();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.sessions.create",
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "POST"
  });

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
      const promptHandoff = aiStudioPromptHandoffFromSession(response);
      if (promptHandoff?.prompt) {
        codexPromptOverride.value = promptHandoff.terminalInput || promptHandoff.prompt;
        codexTerminalBusy.value = true;
        codexPromptInjectionKey.value = `${context.sessionId}:${context.actionId}:${Date.now()}`;
        await refreshSessionData();
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
      codexPromptOverride.value = "";
      await refreshSessionData();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.sessions.advance",
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "POST"
  });

  const abandonCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: aiStudioSessionPath(sessionsApiPath.value, context?.sessionId, "/abandon")
    }),
    fallbackRunError: "AI Studio session could not be abandoned.",
    messages: {
      error: "AI Studio session could not be abandoned.",
      success: "AI Studio session abandoned."
    },
    onRunSuccess: async (_response, { context } = {}) => {
      if (!context?.sessionId || context.sessionId === selectedSessionId.value) {
        sessionSelection.clear();
      }
      abandonDialogOpen.value = false;
      abandonDialogSessionId.value = "";
      abandonDialogSessionTitle.value = "";
      codexPromptOverride.value = "";
      await sessionList.reload();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.sessions.abandon",
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "POST"
  });

  const sessions = computed(() => visibleAiStudioSessions(sessionList.items || []));
  const selectedListSession = computed(() => {
    return sessions.value.find((session) => session.sessionId === selectedSessionId.value) || null;
  });
  const selectedSession = computed(() => enrichAiStudioSessionForDisplay(selectedListSession.value));
  const baseCurrentActions = computed(() => {
    return Array.isArray(selectedSession.value?.actions)
      ? selectedSession.value.actions.filter((action) => action.visible !== false)
      : [];
  });
  const currentNext = computed(() => selectedSession.value?.next || null);
  const isSelectedSessionClosed = computed(() => isClosedAiStudioSession(selectedSession.value || {}));
  const commandBusy = computed(() => Boolean(
    createSessionCommand.isRunning ||
    runActionCommand.isRunning ||
    advanceCommand.isRunning ||
    abandonCommand.isRunning ||
    codexTerminalBusy.value ||
    commandTerminalRunning.value ||
    draftEditorLoading.value ||
    draftEditorSaving.value
  ));
  const issueFileStep = useAiStudioIssueFileStep({
    activeActionId,
    clearCopyStatus() {
      copyStatus.value = "";
    },
    commandBusy,
    runActionCommand,
    selectedSession,
    selectedSessionId
  });
  const currentActions = computed(() => {
    return issueFileStep.visibleActions(baseCurrentActions.value);
  });
  const commandTerminalVisible = computed(() => Boolean(commandTerminalAction.value || commandTerminalRunning.value));
  const pageLoading = computed(() => Boolean(sessionList.isLoading));
  const pageError = computed(() => {
    return sessionList.loadError ||
      commandMessage(createSessionCommand, "error") ||
      commandMessage(runActionCommand, "error") ||
      commandMessage(advanceCommand, "error") ||
      commandMessage(abandonCommand, "error") ||
      "";
  });
  const limits = computed(() => aiStudioSessionLimits({
    payloadLimits: sessionList.pages?.[0]?.limits || {},
    sessions: sessions.value
  }));
  const canCreateSession = computed(() => limits.value.openSessionCount < limits.value.maxOpenSessions);
  const createSessionTitle = computed(() => {
    return canCreateSession.value
      ? "Create a new AI Studio session"
      : `Studio allows up to ${limits.value.maxOpenSessions} active sessions.`;
  });
  const selectedSessionTitle = computed(() => {
    return aiStudioSessionDisplayTitle(selectedSession.value || {}) ||
      `Session ${shortSessionId(selectedSessionId.value)}`;
  });
  const timelineSteps = computed(() => buildAiStudioTimelineSteps(selectedSession.value));
  const sessionFacts = computed(() => aiStudioSessionFacts(selectedSession.value || {}));
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
  const actionResultMessage = computed(() => String(latestActionResult.value?.message || ""));
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

  async function refreshSessionData() {
    await sessionList.reload();
  }

  const waitingForPullRequestFile = computed(() => {
    return selectedSession.value?.currentStep === PULL_REQUEST_FILE_STEP_ID &&
      Boolean(latestAiStudioActionResult(selectedSession.value, CREATE_PULL_REQUEST_FILE_ACTION_ID)) &&
      selectedSession.value?.artifactReadiness?.[PULL_REQUEST_ARTIFACT]?.nonEmpty !== true;
  });
  const waitingForPromptedArtifact = computed(() => {
    return issueFileStep.waitingForFiles.value || waitingForPullRequestFile.value;
  });

  async function refreshPromptedArtifactReadiness() {
    if (!waitingForPromptedArtifact.value || artifactReadinessRefreshInFlight) {
      return;
    }
    artifactReadinessRefreshInFlight = true;
    try {
      await refreshSessionData();
    } finally {
      artifactReadinessRefreshInFlight = false;
    }
  }

  function clearCommandTerminal() {
    commandTerminalAction.value = null;
    commandTerminalRunning.value = false;
    commandTerminalStartKey.value = "";
  }

  function actionShouldAdvance(response = {}, context = {}) {
    return context.advanceOnSuccess === true &&
      response.actionResult?.status === "completed" &&
      response.next?.visible === true &&
      response.next?.enabled === true;
  }

  async function refreshAfterCommandTerminalSettled({
    actionId = "",
    exitCode = null
  } = {}) {
    commandTerminalRunning.value = false;
    activeActionId.value = "";
    await refreshSessionData();
    await nextTick();

    const result = latestAiStudioActionResult(selectedSession.value, actionId, {
      since: pendingCommandStartedAt.value
    });
    const commandSucceeded = Number(exitCode) === 0 || result?.status === "completed";
    if (
      commandSucceeded &&
      pendingCommandAdvanceOnSuccess.value &&
      currentNext.value?.visible === true &&
      currentNext.value?.enabled === true
    ) {
      pendingCommandAdvanceOnSuccess.value = false;
      pendingCommandStartedAt.value = 0;
      clearCommandTerminal();
      await goNext();
      return;
    }

    pendingCommandAdvanceOnSuccess.value = false;
    pendingCommandStartedAt.value = 0;
  }

  function selectSession(sessionId = "") {
    activeActionId.value = "";
    abandonDialogOpen.value = false;
    abandonDialogSessionId.value = "";
    abandonDialogSessionTitle.value = "";
    codexPromptInjectionKey.value = "";
    codexPromptOverride.value = "";
    codexTerminalBusy.value = false;
    clearCommandTerminal();
    draftEditorOpen.value = false;
    pendingCommandAdvanceOnSuccess.value = false;
    pendingCommandStartedAt.value = 0;
    sessionSelection.select(sessionId);
  }

  async function runAction(action = {}) {
    if (!selectedSessionId.value || !action.id || commandBusy.value || action.enabled !== true) {
      return;
    }
    copyStatus.value = "";
    if (action.type === "command") {
      const commandStartedAt = Date.now();
      commandTerminalAction.value = action;
      pendingCommandAdvanceOnSuccess.value = action.advanceOnSuccess === true;
      pendingCommandStartedAt.value = commandStartedAt;
      commandTerminalStartKey.value = `${selectedSessionId.value}:${action.id}:${commandStartedAt}`;
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
        sessionId: selectedSessionId.value
      });
    } finally {
      activeActionId.value = "";
    }
  }

  async function openDraftEditor(action = {}) {
    draftEditorKind.value = action.id === "edit_pr" ? "pull-request" : "issue";
    draftEditorError.value = "";
    draftEditorOpen.value = true;
    draftEditorLoading.value = true;
    try {
      const response = await sessionArtifacts.readArtifacts(selectedSessionId.value);
      if (response?.ok === false) {
        draftEditorError.value = resolveResponseErrorMessage(response, "Draft could not be loaded.");
        return;
      }
      const draftArtifacts = response.artifacts || {};
      draftEditorIssueTitle.value = String(draftArtifacts[ISSUE_TITLE_ARTIFACT] || "");
      draftEditorBody.value = draftEditorKind.value === "issue"
        ? String(draftArtifacts[ISSUE_BODY_ARTIFACT] || "")
        : String(draftArtifacts[PULL_REQUEST_ARTIFACT] || "");
    } catch (error) {
      draftEditorError.value = String(error?.message || error || "Draft could not be loaded.");
    } finally {
      draftEditorLoading.value = false;
    }
  }

  async function saveDraftEditor() {
    if (!selectedSessionId.value || draftEditorSaving.value) {
      return;
    }
    draftEditorError.value = "";
    draftEditorSaving.value = true;
    try {
      const response = draftEditorKind.value === "issue"
        ? await sessionArtifacts.saveArtifacts(selectedSessionId.value, {
            [ISSUE_BODY_ARTIFACT]: draftEditorBody.value,
            [ISSUE_TITLE_ARTIFACT]: draftEditorIssueTitle.value
          })
        : await sessionArtifacts.saveArtifacts(selectedSessionId.value, {
            [PULL_REQUEST_ARTIFACT]: draftEditorBody.value
          });
      if (response?.ok === false) {
        draftEditorError.value = resolveResponseErrorMessage(response, "Draft could not be saved.");
        return;
      }
      copyStatus.value = "Draft saved.";
      await refreshSessionData();
    } catch (error) {
      draftEditorError.value = String(error?.message || error || "Draft could not be saved.");
    } finally {
      draftEditorSaving.value = false;
    }
  }

  async function goNext() {
    if (!selectedSessionId.value || commandBusy.value || currentNext.value?.enabled !== true) {
      return;
    }
    await advanceCommand.run({
      sessionId: selectedSessionId.value
    });
    clearCommandTerminal();
  }

  function handleCommandTerminalClosed() {
    clearCommandTerminal();
  }

  function requestAbandonSelectedSession() {
    if (!selectedSessionId.value || commandBusy.value || isSelectedSessionClosed.value) {
      return;
    }
    abandonDialogSessionId.value = selectedSessionId.value;
    abandonDialogSessionTitle.value = selectedSessionTitle.value;
    abandonDialogOpen.value = true;
  }

  function cancelAbandonSession() {
    if (abandonCommand.isRunning) {
      return;
    }
    abandonDialogOpen.value = false;
    abandonDialogSessionId.value = "";
    abandonDialogSessionTitle.value = "";
  }

  async function confirmAbandonSession() {
    if (!abandonDialogSessionId.value || commandBusy.value || abandonCommand.isRunning) {
      return;
    }
    await abandonCommand.run({
      sessionId: abandonDialogSessionId.value
    });
  }

  async function copyText(value, label = "Value") {
    try {
      await writeClipboardText(value);
      copyStatus.value = `${label} copied.`;
    } catch (error) {
      copyStatus.value = String(error?.message || error || "Copy failed.");
    }
  }

  async function handleCommandTerminalFinished(event = {}) {
    if (event.sessionId && event.sessionId !== selectedSessionId.value) {
      return;
    }
    await refreshAfterCommandTerminalSettled({
      actionId: event.actionId,
      exitCode: event.exitCode
    });
  }

  async function handleCommandTerminalRunningChanged(running) {
    const wasRunning = commandTerminalRunning.value;
    commandTerminalRunning.value = Boolean(running);
    if (commandTerminalRunning.value || !wasRunning) {
      return;
    }
    await refreshAfterCommandTerminalSettled({
      actionId: commandTerminalAction.value?.id || ""
    });
  }

  async function handleCodexPromptInjected(event = {}) {
    const sessionId = String(event.sessionId || selectedSessionId.value || "");
    codexTerminalBusy.value = true;
    if (sessionId) {
      await codexCommands.savePromptHandoff(sessionId, {
        outputStart: Number(event.outputStart || 0),
        signature: `${sessionId}:${Date.now()}`
      }).catch(() => null);
    }
    copyStatus.value = "Prompt sent to Codex.";
  }

  function handleCodexPromptInjectionFailed(event = {}) {
    codexTerminalBusy.value = false;
    copyStatus.value = String(event.error || "Prompt injection failed.");
  }

  async function handleCodexTerminalBusyChanged(event = {}) {
    if (event.sessionId && event.sessionId !== selectedSessionId.value) {
      return;
    }
    const wasBusy = codexTerminalBusy.value;
    const isBusy = event.busy === true;
    if (!wasBusy || isBusy || !waitingForPromptedArtifact.value) {
      codexTerminalBusy.value = isBusy;
      return;
    }

    try {
      await refreshPromptedArtifactReadiness();
    } finally {
      codexTerminalBusy.value = false;
    }
  }

  async function handleCodexSessionUpdate(event = {}) {
    if (event.sessionId && event.sessionId !== selectedSessionId.value) {
      return;
    }
    if (event.codexTerminalStatus === "exited") {
      codexTerminalBusy.value = false;
    }
    await refreshSessionData();
  }

  watch(sessions, (nextSessions) => {
    if (sessionList.isInitialLoading) {
      return;
    }
    sessionSelection.selectAvailableId(nextSessions, {
      fallbackId: nextSessions.at(-1)?.sessionId || "",
      getId: (session) => session.sessionId
    });
  }, {
    immediate: true
  });

  watch(selectedSessionTitle, (title) => {
    notifyTitleChange(title || "");
  }, {
    immediate: true
  });

  return {
    abandonCommand,
    abandonDialogOpen,
    abandonDialogSessionId,
    abandonDialogSessionTitle,
    actionIcon,
    actionResultMessage,
    actionResultType,
    activeActionId,
    advanceCommand,
    aiStudioSessionStatusColor,
    aiStudioSessionStatusLabel,
    canCreateSession,
    cancelAbandonSession,
    codexPromptInjectionKey,
    codexPromptOverride,
    commandBusy,
    commandTerminalAction,
    commandTerminalRunning,
    commandTerminalStartKey,
    commandTerminalVisible,
    confirmAbandonSession,
    copyStatus,
    createSessionCommand,
    createSessionTitle,
    currentActions,
    currentNext,
    currentStepDisabledReason,
    draftEditorBody,
    draftEditorError,
    draftEditorIssueTitle,
    draftEditorKind,
    draftEditorLoading,
    draftEditorOpen,
    draftEditorSaving,
    goNext,
    handleCodexPromptInjected,
    handleCodexPromptInjectionFailed,
    handleCodexTerminalBusyChanged,
    handleCodexSessionUpdate,
    handleCommandTerminalClosed,
    handleCommandTerminalFinished,
    handleCommandTerminalRunningChanged,
    issueRequestCanSubmit: issueFileStep.canSubmit,
    issueRequestError: issueFileStep.requestError,
    issueRequestFormVisible: issueFileStep.formVisible,
    issueRequestSubmitting: issueFileStep.submitting,
    issueRequestSubmitTitle: issueFileStep.submitTitle,
    issueRequestText: issueFileStep.requestText,
    isSelectedSessionClosed,
    pageError,
    pageLoading,
    requestAbandonSelectedSession,
    runAction,
    runActionCommand,
    saveDraftEditor,
    sendIssueRequestPrompt: issueFileStep.sendPrompt,
    selectSession,
    selectedSession,
    selectedSessionId,
    selectedSessionTitle,
    sessionFacts,
    sessions,
    shortSessionId,
    timelineSteps,
    copyText
  };
}

export { useAiStudioSessions };
