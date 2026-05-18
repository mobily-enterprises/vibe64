import { computed, nextTick, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useList } from "@jskit-ai/users-web/client/composables/useList";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { useAiStudioCodexCommands } from "@/composables/useAiStudioCodexCommands.js";
import {
  PULL_REQUEST_ARTIFACT
} from "@/lib/aiStudioArtifactNames.js";
import {
  useAiStudioIssueFileStep
} from "@/composables/useAiStudioIssueFileStep.js";
import {
  useAiStudioDiffDialog
} from "@/composables/useAiStudioDiffDialog.js";
import {
  useAiStudioDraftEditor
} from "@/composables/useAiStudioDraftEditor.js";
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
  emptyActionInputValues,
  normalizeActionInputFields,
  requiredActionInputMissing
} from "@/lib/aiStudioActionInputModel.js";
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
function displayableActionResultMessage(result = {}) {
  const message = String(result?.message || "");
  return /^Rendered\b/u.test(message) ? "" : message;
}

const CREATE_PULL_REQUEST_FILE_ACTION_ID = "create_pr_file";
const ACCEPT_CHANGES_STEP_ID = "changes_accepted";
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
  const appReviewTerminalStartKey = ref("");
  const appReviewTerminalVisible = ref(false);
  const appReviewUrl = ref("");
  const commandTerminalAction = ref(null);
  const commandTerminalInput = ref({});
  const commandTerminalRunning = ref(false);
  const commandTerminalStartKey = ref("");
  const inputDialogAction = ref(null);
  const inputDialogError = ref("");
  const inputDialogOpen = ref(false);
  const inputDialogSubmitting = ref(false);
  const inputDialogValues = ref({});
  const pendingCommandAdvanceOnSuccess = ref(false);
  const pendingCommandStartedAt = ref(0);
  let artifactReadinessRefreshInFlight = false;
  const codexCommands = useAiStudioCodexCommands();
  const sessionArtifacts = useAiStudioSessionArtifacts();
  const {
    clear: clearDraftEditor,
    draftEditorError,
    draftEditorFields,
    draftEditorLoading,
    draftEditorOpen,
    draftEditorSaving,
    draftEditorTitle,
    draftEditorValues,
    openDraftEditor,
    saveDraftEditor
  } = useAiStudioDraftEditor({
    onSaved() {
      copyStatus.value = "Draft saved.";
    },
    refreshSessionData,
    selectedSessionId,
    sessionArtifacts
  });

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
      clearSessionTransientState();
      await refreshSessionData();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.sessions.rewind",
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
    rewindCommand.isRunning ||
    abandonCommand.isRunning ||
    codexTerminalBusy.value ||
    commandTerminalRunning.value ||
    draftEditorLoading.value ||
    draftEditorSaving.value ||
    inputDialogSubmitting.value
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
  const worktreeReady = computed(() => Boolean(selectedSession.value?.metadata?.worktree_path));
  const {
    clearDiffDialog,
    closeDiffDialog,
    diffDialogOpen,
    diffError,
    diffLoading,
    diffPayload,
    openDiffDialog
  } = useAiStudioDiffDialog({
    canOpen: () => !reviewDiffDisabled.value,
    selectedSessionId
  });
  const acceptChangesUtilitiesVisible = computed(() => {
    return selectedSession.value?.currentStep === ACCEPT_CHANGES_STEP_ID && !issueFileStep.formVisible.value;
  });
  const reviewDiffDisabled = computed(() => commandBusy.value || diffLoading.value || !worktreeReady.value);
  const reviewDiffTitle = computed(() => {
    if (!worktreeReady.value) {
      return "Create the worktree before reviewing changes.";
    }
    return "Review changes in the session worktree.";
  });
  const runAppReviewDisabled = computed(() => {
    return commandBusy.value || appReviewTerminalVisible.value || !worktreeReady.value;
  });
  const runAppReviewTitle = computed(() => {
    if (!worktreeReady.value) {
      return "Create the worktree before running the app.";
    }
    if (appReviewTerminalVisible.value) {
      return "The app review terminal is already open.";
    }
    return "Run the session worktree for user review.";
  });
  const openAppReviewDisabled = computed(() => !appReviewUrl.value);
  const openAppReviewTitle = computed(() => {
    return appReviewUrl.value || "Run the app before opening it.";
  });
  const commandTerminalVisible = computed(() => Boolean(commandTerminalAction.value || commandTerminalRunning.value));
  const pageLoading = computed(() => Boolean(sessionList.isLoading));
  const pageError = computed(() => {
    return sessionList.loadError ||
      commandMessage(createSessionCommand, "error") ||
      commandMessage(runActionCommand, "error") ||
      commandMessage(advanceCommand, "error") ||
      commandMessage(rewindCommand, "error") ||
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
    commandTerminalInput.value = {};
    commandTerminalRunning.value = false;
    commandTerminalStartKey.value = "";
  }

  const inputDialogFields = computed(() => normalizeActionInputFields(inputDialogAction.value?.inputFields));
  const inputDialogTitle = computed(() => String(inputDialogAction.value?.label || "Provide details"));
  const inputDialogSaveDisabled = computed(() => {
    if (inputDialogSubmitting.value || commandBusy.value || inputDialogFields.value.length < 1) {
      return true;
    }
    return requiredActionInputMissing(inputDialogFields.value, inputDialogValues.value);
  });

  function clearSessionTransientState() {
    activeActionId.value = "";
    appReviewTerminalStartKey.value = "";
    appReviewTerminalVisible.value = false;
    appReviewUrl.value = "";
    codexPromptInjectionKey.value = "";
    codexPromptOverride.value = "";
    codexTerminalBusy.value = false;
    clearCommandTerminal();
    clearDiffDialog();
    clearDraftEditor();
    inputDialogAction.value = null;
    inputDialogError.value = "";
    inputDialogOpen.value = false;
    inputDialogSubmitting.value = false;
    inputDialogValues.value = {};
    pendingCommandAdvanceOnSuccess.value = false;
    pendingCommandStartedAt.value = 0;
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
    abandonDialogOpen.value = false;
    abandonDialogSessionId.value = "";
    abandonDialogSessionTitle.value = "";
    clearSessionTransientState();
    sessionSelection.select(sessionId);
  }

  async function runAction(action = {}) {
    if (!selectedSessionId.value || !action.id || commandBusy.value || action.enabled !== true) {
      return;
    }
    copyStatus.value = "";
    if (normalizeActionInputFields(action.inputFields).length > 0) {
      openInputDialog(action);
      return;
    }
    if (action.type === "link") {
      openActionLink(action);
      return;
    }
    if (action.type === "command") {
      const commandStartedAt = Date.now();
      commandTerminalAction.value = action;
      commandTerminalInput.value = {};
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

  function openActionLink(action = {}) {
    const metadataName = String(action.hrefMetadata || "").trim();
    const href = metadataName ? String(selectedSession.value?.metadata?.[metadataName] || "") : "";
    if (href && typeof window !== "undefined") {
      window.open(href, "_blank", "noopener");
    }
  }

  function openInputDialog(action = {}) {
    const fields = normalizeActionInputFields(action.inputFields);
    inputDialogAction.value = action;
    inputDialogError.value = "";
    inputDialogValues.value = emptyActionInputValues(fields);
    inputDialogOpen.value = true;
  }

  function closeInputDialog() {
    if (inputDialogSubmitting.value) {
      return;
    }
    inputDialogAction.value = null;
    inputDialogError.value = "";
    inputDialogOpen.value = false;
    inputDialogValues.value = {};
  }

  async function submitInputDialog() {
    const action = inputDialogAction.value;
    if (!selectedSessionId.value || !action?.id || inputDialogSaveDisabled.value) {
      return;
    }
    inputDialogError.value = "";
    inputDialogSubmitting.value = true;
    activeActionId.value = action.id;
    try {
      await runActionCommand.run({
        actionId: action.id,
        advanceOnSuccess: action.advanceOnSuccess === true,
        input: {
          ...inputDialogValues.value
        },
        sessionId: selectedSessionId.value
      });
      inputDialogOpen.value = false;
      inputDialogAction.value = null;
      inputDialogValues.value = {};
    } catch (error) {
      inputDialogError.value = String(error?.message || error || "Action failed.");
    } finally {
      inputDialogSubmitting.value = false;
      activeActionId.value = "";
    }
  }

  function runAppReview() {
    if (!selectedSessionId.value || runAppReviewDisabled.value) {
      return;
    }
    appReviewTerminalVisible.value = true;
    appReviewTerminalStartKey.value = `${selectedSessionId.value}:app-review:${Date.now()}`;
  }

  function openAppReview() {
    if (!appReviewUrl.value || typeof window === "undefined") {
      return;
    }
    window.open(appReviewUrl.value, "_blank", "noopener");
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

  async function rewindToStep(step = {}) {
    const stepId = String(step.rewindStepId || step.id || "");
    if (!selectedSessionId.value || commandBusy.value || step.canRewind !== true || !stepId) {
      return;
    }
    await rewindCommand.run({
      sessionId: selectedSessionId.value,
      stepId
    });
  }

  function handleCommandTerminalClosed() {
    clearCommandTerminal();
  }

  function handleAppReviewTerminalClosed() {
    appReviewTerminalStartKey.value = "";
    appReviewTerminalVisible.value = false;
    appReviewUrl.value = "";
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

  function handleAppReviewTerminalStarted(event = {}) {
    appReviewUrl.value = String(event.appUrl || event.metadata?.appUrl || "");
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
    actions: {
      actionIcon,
      actionResultMessage,
      actionResultType,
      activeActionId,
      advanceCommand,
      currentActions,
      currentNext,
      currentStepDisabledReason,
      goNext,
      runAction,
      runActionCommand
    },
    appReview: {
      close: handleAppReviewTerminalClosed,
      disabled: runAppReviewDisabled,
      open: openAppReview,
      openDisabled: openAppReviewDisabled,
      openTitle: openAppReviewTitle,
      run: runAppReview,
      startKey: appReviewTerminalStartKey,
      started: handleAppReviewTerminalStarted,
      title: runAppReviewTitle,
      url: appReviewUrl,
      visible: appReviewTerminalVisible
    },
    codexTerminal: {
      busyChanged: handleCodexTerminalBusyChanged,
      promptInjected: handleCodexPromptInjected,
      promptInjectionFailed: handleCodexPromptInjectionFailed,
      promptInjectionKey: codexPromptInjectionKey,
      promptOverride: codexPromptOverride,
      sessionUpdate: handleCodexSessionUpdate
    },
    commandTerminal: {
      action: commandTerminalAction,
      closed: handleCommandTerminalClosed,
      finished: handleCommandTerminalFinished,
      input: commandTerminalInput,
      running: commandTerminalRunning,
      runningChanged: handleCommandTerminalRunningChanged,
      startKey: commandTerminalStartKey,
      visible: commandTerminalVisible
    },
    dialogs: {
      abandon: {
        cancel: cancelAbandonSession,
        command: abandonCommand,
        confirm: confirmAbandonSession,
        open: abandonDialogOpen,
        request: requestAbandonSelectedSession,
        sessionId: abandonDialogSessionId,
        sessionTitle: abandonDialogSessionTitle
      },
      diff: {
        close: closeDiffDialog,
        error: diffError,
        loading: diffLoading,
        open: diffDialogOpen,
        openDialog: openDiffDialog,
        payload: diffPayload
      },
      draftEditor: {
        error: draftEditorError,
        fields: draftEditorFields,
        loading: draftEditorLoading,
        open: draftEditorOpen,
        save: saveDraftEditor,
        saving: draftEditorSaving,
        title: draftEditorTitle,
        values: draftEditorValues
      },
      input: {
        close: closeInputDialog,
        error: inputDialogError,
        fields: inputDialogFields,
        open: inputDialogOpen,
        saveDisabled: inputDialogSaveDisabled,
        submit: submitInputDialog,
        submitting: inputDialogSubmitting,
        title: inputDialogTitle,
        values: inputDialogValues
      }
    },
    issueRequest: {
      canSubmit: issueFileStep.canSubmit,
      error: issueFileStep.requestError,
      formVisible: issueFileStep.formVisible,
      sendPrompt: issueFileStep.sendPrompt,
      submitting: issueFileStep.submitting,
      submitTitle: issueFileStep.submitTitle,
      text: issueFileStep.requestText
    },
    page: {
      busy: commandBusy,
      copyStatus,
      copyText,
      error: pageError,
      loading: pageLoading
    },
    review: {
      acceptChangesUtilitiesVisible,
      diffDisabled: reviewDiffDisabled,
      diffTitle: reviewDiffTitle
    },
    selection: {
      facts: sessionFacts,
      isClosed: isSelectedSessionClosed,
      selectedSession,
      selectedSessionId,
      selectedSessionTitle,
      statusColor: aiStudioSessionStatusColor,
      statusLabel: aiStudioSessionStatusLabel
    },
    timeline: {
      rewindCommand,
      rewindToStep,
      steps: timelineSteps
    },
    toolbar: {
      canCreateSession,
      createSessionCommand,
      createSessionTitle,
      selectSession,
      sessions,
      shortSessionId
    }
  };
}

export { useAiStudioSessions };
