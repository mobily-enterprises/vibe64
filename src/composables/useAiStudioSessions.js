import { computed, nextTick, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useList } from "@jskit-ai/users-web/client/composables/useList";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { useStoredSelection } from "@/composables/useStoredSelection.js";
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
import {
  readAiStudioArtifacts,
  saveAiStudioArtifacts,
  saveAiStudioCodexPromptHandoff
} from "@/lib/aiStudioSessionApi.js";

const ISSUE_BODY_ARTIFACT = "issue.md";
const ISSUE_TITLE_ARTIFACT = "issue_title";
const PULL_REQUEST_ARTIFACT = "pull_request.md";

function resolveResponseErrorMessage(response = {}, fallback = "AI Studio request failed.") {
  return String(response?.errors?.[0]?.message || response?.error || fallback);
}

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
  const copyStatus = ref("");
  const codexPromptInjectionKey = ref("");
  const codexPromptOverride = ref("");
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
        codexPromptOverride.value = promptHandoff.prompt;
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
    onRunSuccess: async () => {
      sessionSelection.clear();
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
  const currentActions = computed(() => {
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
    commandTerminalRunning.value ||
    draftEditorLoading.value ||
    draftEditorSaving.value
  ));
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
    return resolveCurrentStepDisabledReason(currentActions.value, currentNext.value);
  });

  async function refreshSessionData() {
    await sessionList.reload();
  }

  function actionShouldAdvance(response = {}, context = {}) {
    return context.advanceOnSuccess === true &&
      response.actionResult?.status === "completed" &&
      response.next?.visible === true &&
      response.next?.enabled === true;
  }

  function selectSession(sessionId = "") {
    activeActionId.value = "";
    codexPromptInjectionKey.value = "";
    codexPromptOverride.value = "";
    commandTerminalAction.value = null;
    commandTerminalRunning.value = false;
    commandTerminalStartKey.value = "";
    draftEditorOpen.value = false;
    pendingCommandAdvanceOnSuccess.value = false;
    sessionSelection.select(sessionId);
  }

  async function runAction(action = {}) {
    if (!selectedSessionId.value || !action.id || commandBusy.value || action.enabled !== true) {
      return;
    }
    copyStatus.value = "";
    if (action.type === "command") {
      commandTerminalAction.value = action;
      pendingCommandAdvanceOnSuccess.value = action.advanceOnSuccess === true;
      commandTerminalStartKey.value = `${selectedSessionId.value}:${action.id}:${Date.now()}`;
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
      const response = await readAiStudioArtifacts(selectedSessionId.value);
      if (response?.ok === false) {
        draftEditorError.value = resolveResponseErrorMessage(response, "Draft could not be loaded.");
        return;
      }
      const artifacts = response.artifacts || {};
      draftEditorIssueTitle.value = String(artifacts[ISSUE_TITLE_ARTIFACT] || "");
      draftEditorBody.value = draftEditorKind.value === "issue"
        ? String(artifacts[ISSUE_BODY_ARTIFACT] || "")
        : String(artifacts[PULL_REQUEST_ARTIFACT] || "");
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
        ? await saveAiStudioArtifacts(selectedSessionId.value, {
            [ISSUE_BODY_ARTIFACT]: draftEditorBody.value,
            [ISSUE_TITLE_ARTIFACT]: draftEditorIssueTitle.value
          })
        : await saveAiStudioArtifacts(selectedSessionId.value, {
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
  }

  async function abandonSelectedSession() {
    if (!selectedSessionId.value || commandBusy.value || isSelectedSessionClosed.value) {
      return;
    }
    await abandonCommand.run({
      sessionId: selectedSessionId.value
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
    commandTerminalRunning.value = false;
    activeActionId.value = "";
    await refreshSessionData();
    await nextTick();
    if (
      event.sessionId === selectedSessionId.value &&
      Number(event.exitCode) === 0 &&
      pendingCommandAdvanceOnSuccess.value &&
      currentNext.value?.visible === true &&
      currentNext.value?.enabled === true
    ) {
      pendingCommandAdvanceOnSuccess.value = false;
      await goNext();
    }
  }

  async function handleCodexPromptInjected(event = {}) {
    const sessionId = String(event.sessionId || selectedSessionId.value || "");
    if (sessionId) {
      await saveAiStudioCodexPromptHandoff(sessionId, {
        outputStart: Number(event.outputStart || 0),
        signature: `${sessionId}:${Date.now()}`
      }).catch(() => null);
    }
    copyStatus.value = "Prompt sent to Codex.";
  }

  function handleCodexPromptInjectionFailed(event = {}) {
    copyStatus.value = String(event.error || "Prompt injection failed.");
  }

  async function handleCodexSessionUpdate() {
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
    abandonSelectedSession,
    actionIcon,
    actionResultMessage,
    actionResultType,
    activeActionId,
    advanceCommand,
    aiStudioSessionStatusColor,
    aiStudioSessionStatusLabel,
    canCreateSession,
    codexPromptInjectionKey,
    codexPromptOverride,
    commandBusy,
    commandTerminalAction,
    commandTerminalRunning,
    commandTerminalStartKey,
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
    handleCodexSessionUpdate,
    handleCommandTerminalFinished,
    isSelectedSessionClosed,
    pageError,
    pageLoading,
    runAction,
    runActionCommand,
    saveDraftEditor,
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
