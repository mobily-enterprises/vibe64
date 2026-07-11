import { computed, nextTick, onBeforeUnmount, onMounted, proxyRefs, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  mdiAlertCircleOutline,
  mdiArrowLeft,
  mdiCheck,
  mdiCheckCircleOutline,
  mdiChevronDown,
  mdiChevronUp,
  mdiClose,
  mdiConsoleLine,
  mdiFileCompare,
  mdiGithub,
  mdiRefresh,
  mdiRobotOutline,
  mdiStopCircleOutline
} from "@mdi/js";
import {
  VIBE64_ACTION_DISPATCH_ROUTES as ACTION_DISPATCH_ROUTES
} from "@local/vibe64-core/shared";
import {
  VIBE64_DEFAULT_AGENT_PROVIDER_ID
} from "@local/vibe64-runtime/shared";
import {
  useVibe64AutopilotComposer
} from "@/composables/vibe64-session/composer/useVibe64AutopilotComposer.js";
import {
  initialControlValues,
  selectedControlDraftText
} from "@/composables/vibe64-session/composer/composerControlFields.js";
import {
  useVibe64ComposerDraftSync
} from "@/composables/vibe64-session/composer/useVibe64ComposerDraftSync.js";
import {
  normalizedDraftFields
} from "@/composables/vibe64-session/composer/composerDraftFields.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  useVibe64AutopilotController
} from "@/composables/useVibe64AutopilotController.js";
import {
  useVibe64BackgroundTasks
} from "@/composables/useVibe64BackgroundTasks.js";
import {
  useVibe64ClientControls
} from "@/composables/useVibe64ClientControls.js";
import {
  useVibe64AgentSettings
} from "@/composables/useVibe64AgentSettings.js";
import { useVibe64StepInputForm } from "@/composables/useVibe64StepInputForm.js";
import {
  stripTerminalControlSequences
} from "@/lib/codexOutput.js";
import {
  STUDIO_TERMINAL_TEXT_TAIL_LENGTH
} from "@/lib/studioTerminalSize.js";
import {
  vibe64CodexTerminalAttentionSignature
} from "@/lib/vibe64CodexTerminalAttention.js";
import {
  useVibe64ComposerHandoffState
} from "@/composables/vibe64-session/composer/useVibe64ComposerHandoffState.js";
import {
  unmatchedOptimisticComposerTurns
} from "@/lib/vibe64ComposerOptimisticTurn.js";
import {
  useVibe64ComposerActivity
} from "@/composables/vibe64-session/composer/useVibe64ComposerActivity.js";
import {
  composerInputDebugFieldValue,
  useVibe64ComposerInputDebug
} from "@/composables/vibe64-session/composer/useVibe64ComposerInputDebug.js";
import {
  useVibe64ComposerPromptActions
} from "@/composables/vibe64-session/composer/useVibe64ComposerPromptActions.js";
import {
  useVibe64PassiveComposerSubmission
} from "@/composables/vibe64-session/composer/useVibe64PassiveComposerSubmission.js";
import {
  passiveComposerMessagePayload,
  passiveComposerSteeringMode,
  passiveComposerShouldShow
} from "@/lib/vibe64PassiveComposerSteer.js";
import {
  UI_QUESTION_FIELD_PREFIX,
  numberedQuestionInputFields,
  numberedQuestionSubmissionFields,
  numberedQuestionSugarForInput
} from "@/lib/vibe64NumberedQuestionSugar.js";
import {
  VIBE64_SESSION_TOOL_DEFINITIONS,
  vibe64SessionToolDashboardSuffix,
  vibe64SessionToolIdFromRouteSegment
} from "@/lib/vibe64SessionToolDefinitions.js";
import {
  normalizeProjectRoutePath,
  projectAppPath
} from "@/lib/vibe64ProjectScope.js";
import {
  useVibe64FixCodexDialog
} from "@/composables/useVibe64FixCodexDialog.js";
import Vibe64FixCodexDialog from "@/components/studio/Vibe64FixCodexDialog.vue";
import {
  useVibe64TerminalFailureFixCommand
} from "@/composables/useVibe64TerminalFailureFixCommand.js";
import {
  controlSavesCurrentStepInputBeforeRun,
  currentStepInputHasDecisionControls
} from "@/lib/vibe64CurrentStepInputDecision.js";
import {
  VIBE64_CLIENT_CONTROL_ICON_TOKENS,
  controlIconToken,
  controlStateActive as presentationControlStateActive
} from "@/lib/vibe64PresentationControls.js";
import {
  currentStepWorkflowControls,
  workflowControlButtonPresentation,
  workflowControlSourceAction,
  visibleWorkflowButtonControls
} from "@/lib/vibe64WorkflowControlModel.js";
import {
  COMPOSER_CONTROL_PLACEMENTS,
  COMPOSER_CONTROL_TARGETS,
  CONVERSATION_COMPOSER_DRAFT_CONTROL_ID,
  CONVERSATION_COMPOSER_DRAFT_FIELD,
  CURRENT_STEP_INPUT_CONTROL_ID,
  composerControlCandidateSurfaceMode,
  composerControlProjection,
  composerControlSurfaceMode,
  composerInlineInputDisabledReason as composerInlineInputDisabledReasonFor,
  composerInputDisabledReason,
  composerStatusLaneReason as composerStatusLaneReasonFor,
  composerStatusLaneState
} from "@/lib/vibe64AutopilotComposerControlModel.js";
import {
  actionInputFieldIsPrivate
} from "@/lib/vibe64ActionInputModel.js";
import {
  vibe64SessionFacts
} from "@/lib/vibe64SessionPanelModel.js";
import {
  vibe64SessionSourcePath
} from "@/lib/vibe64SessionPaths.js";
import {
  defineVibe64AsyncComponent
} from "@/lib/vibe64AsyncComponent.js";
import {
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel
} from "@/lib/vibe64SessionViewModel.js";
import {
  sessionGithubCommandActor
} from "@/lib/vibe64GitCommandActor.js";
import {
  BROWSER_LIFECYCLE_DISCONNECTED_EVENT
} from "@/lib/browserLifecycle.js";

const vibe64AutopilotViewEmits = ["busy-change", "project-attention", "project-pane-change"];
const vibe64AutopilotViewProps = {
  actions: {
    default: () => ({}),
    type: Object
  },
  active: {
    default: true,
    type: Boolean
  },
  automationEnabled: {
    default: true,
    type: Boolean
  },
  autopilotSteps: {
    default: () => [],
    type: Array
  },
  chatCollapsed: {
    default: false,
    type: Boolean
  },
  cancelAgentMessage: {
    default: async () => false,
    type: Function
  },
  commandRunner: {
    default: null,
    type: Object
  },
  conversationLog: {
    default: () => ({}),
    type: Object
  },
  diff: {
    default: () => ({}),
    type: Object
  },
  humanInputResponsePreview: {
    default: () => ({}),
    type: Object
  },
  interruptAgentTurn: {
    default: async () => false,
    type: Function
  },
  sendAgentMessage: {
    default: async () => false,
    type: Function
  },
  page: {
    default: () => ({}),
    type: Object
  },
  projectContext: {
    default: () => ({}),
    type: Object
  },
  reportPreview: {
    default: () => ({}),
    type: Object
  },
  review: {
    default: () => ({}),
    type: Object
  },
  refreshSessionData: {
    default: async () => null,
    type: Function
  },
  rewindBusy: {
    default: false,
    type: Boolean
  },
  rewindToStep: {
    default: null,
    type: Function
  },
  sessionAbandon: {
    default: () => ({}),
    type: Object
  },
  session: {
    default: null,
    type: Object
  },
  sessionDetailState: {
    default: () => ({}),
    type: Object
  },
  sessionsApiPath: {
    default: "",
    type: [String, Object, Function]
  },
  sessionSelectionClosed: {
    default: false,
    type: Boolean
  },
  sessionToolbar: {
    default: () => ({}),
    type: Object
  },
  saveProjectConfig: {
    default: null,
    type: Function
  },
  savingProjectConfig: {
    default: false,
    type: Boolean
  },
  projectPane: {
    default: "preview",
    type: String
  },
  githubActorTeleportTarget: {
    default: "",
    type: String
  },
  previewToolbarTeleportTarget: {
    default: "",
    type: String
  }
};

function normalizedAgentTurnText(value = "") {
  return String(value || "").trim();
}

function agentTurnHasProviderIds(session = {}, turn = {}) {
  return Boolean(
    normalizedAgentTurnText(session?.agentSession?.thread?.id) &&
    normalizedAgentTurnText(turn?.id)
  );
}

function useVibe64AutopilotView(props, emit) {
  const route = useRoute();
  const router = useRouter();
  const projectSlug = useVibe64ProjectSlug();
  const Vibe64LaunchControls = defineVibe64AsyncComponent({
    label: "Launch controls",
    loader: () => import("@/components/studio/Vibe64LaunchControls.vue"),
    minHeight: "10rem"
  });
  const TargetScriptsPanel = defineVibe64AsyncComponent({
    label: "Run",
    loader: () => import("@/components/studio/TargetScriptsPanel.vue"),
    minHeight: "10rem"
  });
  const Vibe64SessionDiffPanel = defineVibe64AsyncComponent({
    label: "Diff viewer",
    loader: () => import("@/components/studio/vibe64-session/Vibe64SessionDiffPanel.vue"),
    minHeight: "14rem"
  });

  const agentSettings = useVibe64AgentSettings();
  const currentAgentSettings = computed(() => agentSettings.settings.value);
  const requestAgentSettings = computed(() => {
    const settings = currentAgentSettings.value || {};
    return String(settings.providerId || "") !== VIBE64_DEFAULT_AGENT_PROVIDER_ID ||
      String(settings.model || "") ||
      String(settings.thinking || "")
      ? settings
      : null;
  });
  const {
    canDispatchNextOperation,
    clearFailure,
    commandOutput,
    commandPreview,
    commandResult,
    commandRunning,
    commandTerminal,
    failure,
    nextOperationKey,
    recoverStuckStep,
    retry,
    runCommandAction,
    runNextOperation,
    runPresentedIntent,
    running,
    screenState,
    stop,
    stopCommandAction,
    stuckRecoveryAvailable,
    stuckRecoveryRunning
  } = useVibe64AutopilotController({
    actions: props.actions,
    commandRunner: props.commandRunner || undefined,
    enabled: computed(() => props.automationEnabled),
    agentSettings: requestAgentSettings,
    refreshSessionData: () => props.refreshSessionData(),
    session: computed(() => props.session)
  });

  const clientControls = useVibe64ClientControls({
    sessionsApiPath: () => props.sessionsApiPath
  });
  const {
    backgroundTaskError,
    retryBackgroundTask,
    retryingBackgroundTaskId,
    visibleBackgroundTasks
  } = useVibe64BackgroundTasks({
    openCodexTerminal: openCodexTerminalForRecovery,
    refreshSessionData: () => props.refreshSessionData(),
    runClientControl: clientControls.runClientControl,
    session: computed(() => props.session)
  });
  const {
    fixDialogOpen,
    fixJob,
    fixTerminal,
    openFixCodexDialog
  } = useVibe64FixCodexDialog();
  const terminalFailureFix = useVibe64TerminalFailureFixCommand({
    sessionsApiPath: () => props.sessionsApiPath
  });
  const commandSpyExpanded = ref(false);
  const screenControlFormRef = ref(null);
  const rightPaneTab = ref("preview");
  const mountedRightPaneTabs = ref(["preview"]);
  const lastDashboardRoutePath = ref("");
  const openedCodexTerminalAttentionSignature = ref("");
  const sourceEditorOpenRequest = ref(null);
  const optimisticComposerTurn = ref(null);
  const optimisticComposerMessages = ref([]);
  const remoteComposerSubmission = ref(null);

  function composerControlTargetSubmissionId() {
    const handoff = props.session?.composerHandoff;
    const activeHandoffSubmissionId = (
      handoff?.pending === true ||
      activeAgentTurn?.value?.active === true
    )
      ? handoff?.submissionId
      : "";
    return String(
      optimisticComposerTurn.value?.id ||
      remoteComposerSubmission.value?.id ||
      activeHandoffSubmissionId ||
      optimisticComposerMessages.value.find((message) => message?.status === "pending")?.id ||
      props.session?.composerMessages?.find((message) => message?.state === "accepted")?.id ||
      handoff?.submissionId ||
      ""
    ).trim();
  }

  const {
    activeAgentTurn,
    agentConversationActive,
    agentHandoffPending,
    agentInteractionLocked,
    agentInterruptVisible,
    agentSteeringAvailable,
    agentStopEnabled,
    agentStopVisible,
    agentTerminalRunning,
    composerHandoffPresentation,
    composerSubmissionStatus,
    localComposerSubmissionPending,
    remoteComposerSubmissionPending,
    requestAgentInterrupt
  } = useVibe64ComposerActivity({
    composerHandoff: () => props.session?.composerHandoff || null,
    interruptAgentTurn: (reason) => props.interruptAgentTurn({
      afterSubmissionId: composerControlTargetSubmissionId(),
      reason
    }),
    optimisticComposerMessages,
    optimisticComposerTurn,
    remoteComposerSubmission,
    session: () => props.session
  });
  let composerHandoffState = null;
  let sourceEditorOpenSequence = 0;
  let removeBrowserLifecycleDisconnectListener = () => null;

  function startSelectedComposerSubmission(input = {}) {
    const submissionId = composerHandoffState?.startOptimisticComposerTurn(input) || null;
    const submittedText = selectedControlDraftText({
      fields: input?.control?.inputFields,
      values: input?.values
    });
    if (
      submissionId &&
      submittedText &&
      String(conversationComposerDraft.value || "").trim() === submittedText
    ) {
      setConversationComposerDraft("");
    }
    return submissionId;
  }

  const projectPaneIds = Object.freeze([
    "preview",
    "dashboard"
  ]);
  const standaloneSessionPaneIds = Object.freeze([
    "editor",
    "diff"
  ]);
  const sessionPaneIds = Object.freeze([
    "run",
    "editor",
    "config",
    "session-details",
    "diff",
    "ai-terminal"
  ]);

  const stepInput = proxyRefs(useVibe64StepInputForm({
    onSaved: async () => {
      await props.refreshSessionData();
      await nextTick();
      await runNextOperation();
    },
    sessionsApiPath: () => props.sessionsApiPath,
    session: computed(() => props.session)
  }));

  const screenKind = computed(() => screenState.value.kind);
  const sessionId = computed(() => String(props.session?.sessionId || ""));
  const chatCollapsed = computed(() => Boolean(props.chatCollapsed));
  const projectPaneValue = computed(() => normalizeProjectPane(props.projectPane));
  const routeSessionToolId = computed(() => sessionToolIdForDashboardRoute(route.path, projectSlug.value));
  const standaloneSessionToolVisible = computed(() => Boolean(
    projectPaneValue.value === "dashboard" &&
    standaloneSessionPaneIds.includes(rightPaneTab.value)
  ));
  const dashboardShellVisible = computed(() => Boolean(
    projectPaneValue.value === "dashboard" &&
    !standaloneSessionToolVisible.value
  ));
  const sessionToolBackPath = computed(() => (
    lastDashboardRoutePath.value || projectAppPath(projectSlug.value, "/dashboard/env")
  ));
  const codexTerminalAttentionSignature = computed(() => (
    props.active ? vibe64CodexTerminalAttentionSignature(props.session || {}) : ""
  ));
  const sessionGithubActor = computed(() => sessionGithubCommandActor(props.session || {}));
  const sessionGithubActorHeaderVisible = computed(() => Boolean(
    props.active &&
    String(props.githubActorTeleportTarget || "").trim()
  ));
  const activeSessionNav = computed(() => ({
    label: sessionNavLabel(props.session || {}),
    selectTool: selectSessionToolFromNav,
    sessionId: sessionId.value,
    status: String(props.session?.status || ""),
    statusLabel: vibe64SessionStatusLabel(props.session?.status),
    tools: sessionToolControls.value.map((tool) => ({
      ...tool,
      active: rightPaneTab.value === tool.id,
      disabledReason: tool.disabled ? tool.title || "" : "",
      to: sessionToolRoutePath(tool.id)
    })),
    visible: Boolean(props.session && sessionToolsVisible.value)
  }));
  const dashboardSessionContext = computed(() => ({
    activeSessionNav: activeSessionNav.value,
    copyText: typeof props.page?.copyText === "function" ? props.page.copyText : null,
    embeddedShell: true,
    facts: vibe64SessionFacts(props.session || {}),
    projectContext: props.projectContext || {},
    session: props.session || null,
    sessionId: sessionId.value,
    statusColor: vibe64SessionStatusColor(props.session?.status),
    statusLabel: vibe64SessionStatusLabel(props.session?.status)
  }));
  const screenSections = computed(() => Array.isArray(screenState.value.sections) ? screenState.value.sections : []);
  const primaryIntentId = computed(() => props.active ? String(screenState.value.primaryIntentId || "") : "");
  const displayStatusText = computed(() => {
    if (stepInput.visible) {
      return stepInput.interaction?.title || screenState.value.title;
    }
    return screenState.value.title;
  });
  const screenContentTitle = computed(() => String(displayStatusText.value || "").trim());
  const displayRunning = computed(() => Boolean(
    screenState.value.showProgress &&
    screenKind.value !== "codex_running"
  ));
  const commandTerminalFailed = computed(() => commandResult.value?.ok === false);
  const commandTerminalVisible = computed(() => Boolean(screenKind.value === "command"));
  const stepInputFormVisible = computed(() => Boolean(
    stepInput.visible &&
    !displayRunning.value
  ));
  const stepInputTimelineDisplayFields = computed(() => {
    if (!stepInputFormVisible.value) {
      return [];
    }
    if (stepInput.displayFields?.length) {
      return stepInput.displayFields;
    }
    return screenKind.value === "confirm_files" ? stepInput.fields : [];
  });
  const stepInputHasWorkflowIntents = computed(() => Boolean(
    currentStepInputHasDecisionControls(props.session, stepInput.interaction)
  ));
  const inspectMode = computed(() => String(route?.query?.mode || "").trim() === "inspect");
  const stepInputDecisionTimelineVisible = computed(() => Boolean(
    stepInputFormVisible.value &&
    stepInputHasWorkflowIntents.value &&
    !inspectMode.value
  ));
  const commandStatus = computed(() => commandRunning.value ? "running" : "");
  const commandTerminalError = computed(() => {
    if (commandResult.value?.ok === false) {
      return String(commandResult.value.error || "");
    }
    return "";
  });
  const commandFailureSummary = computed(() => (
    commandTerminalError.value ||
    failure.value?.error ||
    "The command did not finish properly."
  ));
  const sessionDetailState = computed(() => {
    const state = props.sessionDetailState && typeof props.sessionDetailState === "object" && !Array.isArray(props.sessionDetailState)
      ? props.sessionDetailState
      : {};
    return {
      label: String(state.label || ""),
      sessionId: String(state.sessionId || ""),
      state: String(state.state || ""),
      suppressPassiveComposer: state.suppressPassiveComposer === true
    };
  });
  const sessionControlsRestoring = computed(() => Boolean(
    props.active &&
    sessionDetailState.value.suppressPassiveComposer
  ));
  const sessionControlsBlocking = computed(() => sessionControlsRestoring.value);
  const sessionControlsBlockingLabel = computed(() => (
    sessionControlsBlocking.value
      ? sessionDetailState.value.label || "Loading session controls..."
      : ""
  ));
  const sessionControlsUnavailableLabel = computed(() => {
    const state = sessionDetailState.value.state;
    if (
      !props.active ||
      !state ||
      state === "detailReady" ||
      sessionControlsBlocking.value
    ) {
      return "";
    }
    return sessionDetailState.value.label || "Session controls could not load.";
  });
  const commandOverlayTitle = computed(() => {
    return commandTerminalFailed.value
      ? "Command needs attention."
      : "Command running.";
  });
  const commandTerminalSummary = computed(() => commandPreview.value || displayStatusText.value || "Running command.");
  const commandTerminalText = computed(() => {
    const output = stripTerminalControlSequences(commandOutput.value);
    const resultOutput = stripTerminalControlSequences(commandResult.value?.output || "");
    const preview = stripTerminalControlSequences(commandPreview.value);
    return tailCommandText(output || resultOutput || preview || "Starting command...");
  });
  const autopilotBusy = computed(() => Boolean(props.active && (
    running.value ||
    displayRunning.value ||
    commandRunning.value ||
    localComposerSubmissionPending.value ||
    remoteComposerSubmissionPending.value ||
    stepInput.saving
  )));
  const navigationBusy = computed(() => Boolean(props.page?.busy || autopilotBusy.value || props.rewindBusy));
  const workflowExecuting = computed(() => Boolean(
    agentInteractionLocked.value ||
    autopilotBusy.value ||
    commandRunning.value
  ));
  const composerInputLocked = computed(() => Boolean(
    agentInteractionLocked.value ||
    running.value ||
    displayRunning.value ||
    commandRunning.value ||
    localComposerSubmissionPending.value ||
    remoteComposerSubmissionPending.value ||
    stepInput.saving ||
    props.page?.busy
  ));
  const selectedComposerRunning = computed(() => Boolean(
    composerInputLocked.value
  ));
  const selectedComposerInputDisabled = computed(() => Boolean(
    selectedComposerRunning.value ||
    (selectedControl.value && controlDisabled(selectedControl.value))
  ));
  const selectedScreenControlVisible = computed(() => Boolean(
    props.active &&
    selectedControl.value &&
    !sessionControlsBlocking.value &&
    !agentConversationActive.value &&
    !composerInputLocked.value
  ));
  const thinkingVisible = computed(() => Boolean(
    agentConversationActive.value ||
    agentInteractionLocked.value ||
    running.value ||
    displayRunning.value ||
    commandRunning.value ||
    localComposerSubmissionPending.value ||
    remoteComposerSubmissionPending.value ||
    composerHandoffPresentation.value.pending ||
    stepInput.saving
  ));
  const thinkingLabel = computed(() => (
    commandRunning.value
      ? "Running command..."
      : composerSubmissionStatus.value.thinkingLabel
  ));
  const sessionToolbarVisible = computed(() => Boolean(
    Array.isArray(props.sessionToolbar?.sessions) &&
    props.sessionToolbar.sessions.length
  ));
  const sessionToolsVisible = computed(() => Boolean(props.session));
  const sessionSourceRoot = computed(() => vibe64SessionSourcePath(props.session || {}));
  const sessionConfigSourceReady = computed(() => Boolean(sessionSourceRoot.value));
  const sessionConfigBootstrapReady = computed(() => props.projectContext?.projectConfig?.bootstrap === true);
  const sessionConfigEditable = computed(() => Boolean(
    sessionConfigSourceReady.value ||
    sessionConfigBootstrapReady.value
  ));
  const sessionConfigToolTitle = computed(() => {
    if (sessionConfigSourceReady.value) {
      return "Edit this session source project config";
    }
    if (sessionConfigBootstrapReady.value) {
      return "Edit pending seed config before the session source exists";
    }
    return "Create the session source before editing config";
  });
  const sessionToolControls = computed(() => VIBE64_SESSION_TOOL_DEFINITIONS.map((definition) => ({
    ...definition,
    ...sessionToolRuntimeState(definition.id)
  })));
  const activeSessionTool = computed(() => {
    return sessionToolControls.value.find((tool) => tool.id === rightPaneTab.value) || null;
  });
  function rightPaneTabMounted(tabId) {
    return mountedRightPaneTabs.value.includes(String(tabId || ""));
  }

  watch(rightPaneTab, (tabId) => {
    const nextTabId = String(tabId || "");
    if (!nextTabId || mountedRightPaneTabs.value.includes(nextTabId)) {
      return;
    }
    mountedRightPaneTabs.value = [
      ...mountedRightPaneTabs.value,
      nextTabId
    ];
  }, {
    immediate: true
  });
  const commandSpyVisible = computed(() => Boolean(
    commandTerminalVisible.value ||
    commandRunning.value ||
    commandTerminalFailed.value
  ));
  const screenStopAction = computed(() => String(screenState.value.stopAction || ""));
  const reportPreviewVisible = computed(() => Boolean(sectionVisible("report_preview") && props.reportPreview?.visible));
  const chatTakeoverVisible = computed(() => Boolean(reportPreviewVisible.value));
  const chatTurns = computed(() => {
    const turns = Array.isArray(props.conversationLog?.turns) ? props.conversationLog.turns : [];
    const optimisticTurns = unmatchedOptimisticComposerTurns(turns, [
      ...(optimisticComposerTurn.value ? [optimisticComposerTurn.value] : []),
      ...optimisticComposerMessages.value
    ]);
    if (!optimisticTurns.length) {
      return turns;
    }
    return [
      ...turns,
      ...optimisticTurns.map((optimistic) => ({
        optimistic: {
          error: optimistic.error,
          id: optimistic.id,
          status: optimistic.status
        },
        turnId: optimistic.id,
        user: {
          at: optimistic.createdAt,
          role: "user",
          text: optimistic.text
        }
      }))
    ];
  });
  const actionResultNoticeVisible = computed(() => Boolean(
    props.actions?.actionResultMessage
  ));
  const actionResultType = computed(() => String(props.actions?.actionResultType || "info"));
  const clientControlError = ref("");
  const chatReloading = ref(false);
  const conversationComposerFallbackDraft = ref("");
  const clientControlErrorVisible = computed(() => Boolean(clientControlError.value));
  const chatReloadAvailable = computed(() => Boolean(
    props.active &&
    props.session &&
    (
      typeof props.refreshSessionData === "function" ||
      typeof props.conversationLog?.reload === "function"
    )
  ));
  const composerVisible = computed(() => Boolean(
    !chatTakeoverVisible.value &&
    props.active &&
    props.session
  ));
  const chatTimelineVisible = computed(() => true);
  const conversationLogVisible = computed(() => Boolean(
    props.active &&
    chatTimelineVisible.value
  ));
  const runtimeNoticeMessages = computed(() => [
    composerHandoffPresentation.value.error
      ? {
          icon: mdiAlertCircleOutline,
          id: "composer-handoff-failed",
          text: composerHandoffPresentation.value.error,
          tone: "error"
        }
      : null,
    codexTerminalAttentionSignature.value
      ? {
          icon: mdiRobotOutline,
          id: "codex-terminal-attention",
          text: "The assistant needs attention in the AI Terminal.",
          tone: "warning"
        }
      : null,
    actionResultNoticeVisible.value
      ? {
          icon: actionResultType.value === "success" ? mdiCheckCircleOutline : mdiAlertCircleOutline,
          id: "action-result",
          text: String(props.actions.actionResultMessage || ""),
          tone: ["success", "warning", "error"].includes(actionResultType.value) ? actionResultType.value : "info"
        }
      : null,
    clientControlErrorVisible.value
      ? {
          icon: mdiAlertCircleOutline,
          id: "client-control-error",
          text: clientControlError.value,
          tone: "warning"
        }
      : null,
  ].filter(Boolean));
  const runtimeStatusVisible = computed(() => Boolean(
    visibleBackgroundTasks.value.length ||
    backgroundTaskError.value ||
    runtimeNoticeMessages.value.length
  ));
  const conversationScrollKey = computed(() => [
    sessionId.value,
    chatTimelineVisible.value ? "conversation-visible" : "conversation-hidden",
    selectedControl.value?.id || "",
    selectedControlFields.value.map((field) => field.name).join("|")
  ].join(":"));
  const workflowScreenControls = computed(() => currentStepWorkflowControls({
    actions: props.actions?.currentActions || [],
    interaction: stepInput.interaction,
    session: props.session
  }));
  const stepInputFallbackWorkflowControls = computed(() => {
    if (
      !stepInputFormVisible.value ||
      stepInputHasWorkflowIntents.value ||
      workflowScreenControls.value.length
    ) {
      return [];
    }
    return (Array.isArray(props.actions?.currentActions) ? props.actions.currentActions : [])
      .map(stepInputActionWorkflowControl)
      .filter(Boolean);
  });
  const allScreenControls = computed(() => {
    return [
      ...workflowScreenControls.value,
      ...stepInputFallbackWorkflowControls.value
    ];
  });
  const composerScreenControls = computed(() => {
    const fallbackDraft = String(conversationComposerFallbackDraft.value || "");
    if (!fallbackDraft) {
      return allScreenControls.value;
    }
    return allScreenControls.value.map((control) => controlWithConversationFallbackDraft(control, fallbackDraft));
  });
  function controlWithConversationFallbackDraft(control = {}, fallbackDraft = "") {
    const text = String(fallbackDraft || "");
    const fields = Array.isArray(control?.inputFields) ? control.inputFields : [];
    if (!text || !fields.length) {
      return control;
    }
    let changed = false;
    const inputFields = fields.map((field) => {
      if (
        field?.kind !== "textarea" ||
        String(field?.name || "") !== CONVERSATION_COMPOSER_DRAFT_FIELD ||
        String(field?.value || "")
      ) {
        return field;
      }
      changed = true;
      return {
        ...field,
        value: text
      };
    });
    return changed
      ? {
          ...control,
          inputFields
        }
      : control;
  }
  function controlUsesAssistantMessageOperation(control = {}) {
    const sourceAction = workflowControlSourceAction(control);
    return String(control?.id || "").trim() === CONVERSATION_COMPOSER_DRAFT_CONTROL_ID ||
      control?.dispatchRoute === ACTION_DISPATCH_ROUTES.SESSION_MESSAGE ||
      sourceAction?.dispatchRoute === ACTION_DISPATCH_ROUTES.SESSION_MESSAGE;
  }
  function controlCanSendDuringAgentActivity(control = {}) {
    const inputFields = Array.isArray(control?.inputFields) ? control.inputFields : [];
    return Boolean(
      agentConversationActive.value &&
      controlUsesAssistantMessageOperation(control) &&
      inputFields.some((field) => (
        field?.kind === "textarea" &&
        !inputFieldIsPrivate(field)
      ))
    );
  }
  const {
    activateControl,
    canSubmitSelectedControl,
    clearSelectedControl,
    selectedControl,
    selectedControlDisplayValues,
    selectedControlFields,
    selectedControlIsPrimary,
    selectedControlSubmissionFields,
    selectedControlValues,
    restoreControlDraft,
    submitSelectedAnswerChoice,
    submitSelectedControl,
    useFreeTextForAnswerChoice,
    updateSelectedControlValue: updateLocalSelectedControlValue
  } = useVibe64AutopilotComposer({
    conversationLog: computed(() => props.conversationLog),
    controls: composerScreenControls,
    controlsRefreshing: sessionControlsRestoring,
    canSubmitWhileRunning: controlCanSendDuringAgentActivity,
    isControlDisabled: controlDisabled,
    onDraftSubmissionRejected: (...args) => composerHandoffState?.markOptimisticComposerTurnFailed(...args),
    onDraftSubmissionStart: startSelectedComposerSubmission,
    onRunClientControl: runClientControl,
    onRunControl: runWorkflowControl,
    primaryIntentId,
    running: composerInputLocked
  });
  const selectedControlConversationFieldName = computed(() => publicTextareaFieldName(selectedControlFields.value));
  const selectedControlUsesConversationComposer = computed(() => Boolean(
    selectedControl.value &&
    selectedControlConversationFieldName.value === CONVERSATION_COMPOSER_DRAFT_FIELD
  ));
  const conversationComposerFieldName = computed(() => (
    selectedControlUsesConversationComposer.value
      ? selectedControlConversationFieldName.value
      : ""
  ));
  const conversationComposerDraft = computed(() => {
    const fieldName = conversationComposerFieldName.value;
    if (!fieldName) {
      return conversationComposerFallbackDraft.value;
    }
    return String(conversationComposerFallbackDraft.value || selectedControlValues.value?.[fieldName] || "");
  });
  const composerSteerAfterSubmissionId = computed(composerControlTargetSubmissionId);
  const passiveComposerSteeringModeActive = computed(() => passiveComposerSteeringMode({
    agentSteeringAvailable: agentSteeringAvailable.value,
    selectedScreenControlVisible: selectedScreenControlVisible.value
  }));
  const passiveComposerUnavailableReason = computed(() => {
    if (passiveComposerSteeringModeActive.value) {
      return "";
    }
    if (sessionDetailState.value.state && sessionDetailState.value.state !== "detailReady") {
      return sessionDetailState.value.label;
    }
    return "";
  });
  const passiveComposerInputDisabled = computed(() => {
    return Boolean(passiveComposerUnavailableReason.value);
  });
  const passiveComposerCanSubmit = computed(() => Boolean(
    passiveComposerMessagePayload(conversationComposerDraft.value)
  ));
  const passiveComposerBusy = computed(() => Boolean(
    !passiveComposerSteeringModeActive.value &&
    (
      composerInputLocked.value ||
      thinkingVisible.value
    )
  ));
  const passiveComposerFieldName = computed(() => CONVERSATION_COMPOSER_DRAFT_FIELD);
  const passiveComposerFields = computed(() => [
    {
      kind: "textarea",
      label: passiveComposerSteeringModeActive.value
        ? "Steer assistant"
        : "Message",
      name: passiveComposerFieldName.value,
      required: passiveComposerSteeringModeActive.value,
      value: ""
    }
  ]);
  const passiveComposerControl = computed(() => ({
    id: CONVERSATION_COMPOSER_DRAFT_CONTROL_ID,
    inputFields: passiveComposerFields.value,
    label: passiveComposerSteeringModeActive.value ? "Steer" : "Send",
    style: "primary"
  }));
  const stepInputNumberedQuestions = computed(() => numberedQuestionSugarForInput(
    stepInput.interaction,
    stepInput.fields
  ));
  const stepInputUsesNumberedQuestions = computed(() => Boolean(
    stepInputNumberedQuestions.value.questions.length
  ));
  const stepInputNumberedQuestionsComplete = computed(() => (
    stepInputNumberedQuestions.value.questions.every((question) => String(
      stepInput.values?.[question.name] || ""
    ).trim())
  ));
  const stepInputComposerCanSubmit = computed(() => (
    stepInputUsesNumberedQuestions.value
      ? stepInput.visible && !stepInput.saving && stepInputNumberedQuestionsComplete.value
      : stepInput.canSubmit
  ));
  const stepInputComposerFields = computed(() => (
    stepInputUsesNumberedQuestions.value
      ? numberedQuestionInputFields(stepInputNumberedQuestions.value.questions)
      : stepInput.fields
  ));
  const stepInputComposerControl = computed(() => {
    const submitLabel = String(stepInput.interaction?.submitLabel || "Submit").trim() || "Submit";
    return {
      id: CURRENT_STEP_INPUT_CONTROL_ID,
      inputFields: stepInputComposerFields.value,
      label: submitLabel,
      style: "primary",
      submitLabel
    };
  });
  const stepInputDraftControl = computed(() => ({
    ...stepInputComposerControl.value,
    id: currentStepInputDraftControlId()
  }));
  const stepInputDraftValues = computed(() => stepInputEditableValues());
  const stepInputComposerValues = computed(() => stepInput.values);
  const passiveComposerValues = computed(() => ({
    [passiveComposerFieldName.value]: conversationComposerDraft.value
  }));
  const composerDraftUsesConversationComposer = computed(() => Boolean(
    !selectedScreenControlVisible.value ||
    !selectedControl.value ||
    selectedControlUsesConversationComposer.value
  ));
  const syncedComposerDraftControl = computed(() => {
    if (!composerDraftUsesConversationComposer.value && selectedControl.value) {
      return selectedControl.value;
    }
    return {
      ...(selectedControl.value || passiveComposerControl.value),
      id: CONVERSATION_COMPOSER_DRAFT_CONTROL_ID
    };
  });
  const syncedComposerDraftValues = computed(() => {
    if (!composerDraftUsesConversationComposer.value) {
      return selectedControlDisplayValues.value;
    }
    return {
      [CONVERSATION_COMPOSER_DRAFT_FIELD]: conversationComposerDraft.value
    };
  });
  const composerDraftSync = useVibe64ComposerDraftSync({
    applyDraft(fields = {}, payload = {}) {
      if (String(payload?.controlId || "") === CONVERSATION_COMPOSER_DRAFT_CONTROL_ID) {
        applyConversationComposerDraft(fields);
        return;
      }
      const controlId = String(payload?.controlId || selectedControl.value?.id || "").trim();
      const control = allScreenControls.value.find((item) => item.id === controlId) || selectedControl.value;
      if (!control?.id) {
        return;
      }
      restoreControlDraft(control, fields);
      if (String(control.id || "") === String(primaryIntentId.value || "")) {
        conversationComposerFallbackDraft.value = "";
      }
    },
    applySubmissionRejected: (...args) => composerHandoffState?.applyRemoteComposerSubmissionRejected(...args),
    applySubmissionStart: (...args) => composerHandoffState?.applyRemoteComposerSubmissionStart(...args),
    enabled: computed(() => props.active !== false),
    projectSlug,
    selectedControl: syncedComposerDraftControl,
    selectedControlValues: syncedComposerDraftValues,
    sessionId,
    sessionsApiPath: props.sessionsApiPath
  });
  composerHandoffState = useVibe64ComposerHandoffState({
    actionsClear: () => props.actions?.clear?.(),
    cancelAgentMessage: props.cancelAgentMessage,
    clearSelectedComposerDraft,
    composerHandoff: computed(() => props.session?.composerHandoff || null),
    composerDraftSync: () => composerDraftSync,
    composerDraftSyncFieldName,
    composerDraftSyncFields,
    controlForComposerPayload,
    conversationComposerDraft,
    conversationComposerDraftTextFromFields,
    conversationComposerFallbackDraft,
    optimisticComposerMessages,
    optimisticComposerTurn,
    optimisticTextFromSubmission,
    payloadUsesConversationComposer,
    primaryIntentId,
    remoteComposerSubmission,
    restoreControlDraft,
    runWorkflowControl,
    selectedComposerDraftText,
    setConversationComposerDraft,
    sendAgentMessage: props.sendAgentMessage
  });
  const {
    cancelOptimisticComposerTurn,
    clearLocalComposerSubmissionIfCanonical,
    clearRemoteComposerSubmissionIfCanonical,
    editOptimisticComposerTurn,
    failLocalComposerSubmissionForLifecycleDisconnect,
    markOptimisticComposerTurnFailed,
    reconcileComposerMessageOutcomes,
    reconcileOptimisticComposerMessages,
    resendOptimisticComposerTurn,
    startOptimisticComposerTurn
  } = composerHandoffState;
  const stepInputDraftSync = useVibe64ComposerDraftSync({
    applyDraft(fields = {}) {
      applyStepInputDraft(fields);
    },
    enabled: computed(() => Boolean(
      props.active !== false &&
      stepInputFormVisible.value &&
      stepInput.fields.length
    )),
    projectSlug,
    selectedControl: stepInputDraftControl,
    selectedControlValues: stepInputDraftValues,
    sessionId,
    sessionsApiPath: props.sessionsApiPath
  });
  const selectedComposerControl = computed(() => {
    if (
      selectedControl.value &&
      selectedControlFields.value.length &&
      selectedControlFields.value.every((field) => String(field?.name || "").startsWith(UI_QUESTION_FIELD_PREFIX))
    ) {
      return {
        ...selectedControl.value,
        submitLabel: selectedControl.value.submitLabel || "Submit"
      };
    }
    return selectedControl.value;
  });
  const selectedComposerControlFields = computed(() => selectedControlFields.value);
  const workflowButtonControls = computed(() => {
    return visibleWorkflowButtonControls(
      allScreenControls.value.map((control) => ({
        ...control,
        ...workflowControlButtonPresentation(control),
        disabled: controlDisabled(control),
        icon: controlIcon(control),
        loading: controlLoading(control),
        sourceControl: control
      }))
    );
  });
  const composerUserResponseControlsVisible = computed(() => Boolean(
    selectedScreenControlVisible.value ||
    workflowButtonControls.value.length ||
    stepInputFormVisible.value
  ));
  const composerMenuItems = computed(() => {
    const menu = props.session?.presentation?.composerMenu;
    return Array.isArray(menu?.items) ? menu.items : [];
  });
  const composerControlFormKey = computed(() => [
    "composer",
    sessionId.value
  ].join(":"));
  const selectedWorkflowButtonControls = computed(() => {
    const selectedControlId = String(selectedControl.value?.id || "").trim();
    return workflowButtonControls.value.filter((control) => (
      String(control?.id || "").trim() !== selectedControlId
    ));
  });
  const composerSelectedScreenControlVisible = computed(() => Boolean(
    selectedScreenControlVisible.value
  ));
  const composerSelectedScreenAnswerChoicesVisible = computed(() => Boolean(
    composerSelectedScreenControlVisible.value &&
    selectedControlFields.value.some((field) => field?.kind === "answer_choices")
  ));
  const candidateControlSurfaceMode = computed(() => composerControlCandidateSurfaceMode({
    composerVisible: composerVisible.value,
    selectedScreenAnswerChoicesVisible: composerSelectedScreenAnswerChoicesVisible.value,
    selectedScreenControlVisible: composerSelectedScreenControlVisible.value,
    stepInputFormVisible: stepInputFormVisible.value
  }));
  const passiveComposerWorkflowControls = computed(() => (
    !agentStopVisible.value &&
    !agentHandoffPending.value
      ? workflowButtonControls.value
      : []
  ));
  const passiveComposerVisible = computed(() => Boolean(
    candidateControlSurfaceMode.value === "passive_composer" &&
    !sessionControlsBlocking.value &&
    passiveComposerShouldShow({
      selectedScreenControlVisible: selectedScreenControlVisible.value,
      stepInputFormVisible: stepInputFormVisible.value
    })
  ));
  const controlSurfaceMode = computed(() => composerControlSurfaceMode({
    candidateMode: candidateControlSurfaceMode.value,
    passiveComposerVisible: passiveComposerVisible.value
  }));
  const composerControlModel = computed(() => composerControlProjection({
    canSubmitSelectedControl: canSubmitSelectedControl.value,
    agentInterruptVisible: agentInterruptVisible.value,
    agentStopEnabled: agentStopEnabled.value,
    agentStopVisible: agentStopVisible.value,
    composerDraftUsesConversationComposer: composerDraftUsesConversationComposer.value,
    mode: controlSurfaceMode.value,
    pageBusy: props.page?.busy,
    passiveComposerCanSubmit: passiveComposerCanSubmit.value,
    passiveComposerControl: passiveComposerControl.value,
    passiveComposerFields: passiveComposerFields.value,
    passiveComposerInputDisabled: passiveComposerInputDisabled.value,
    passiveComposerSteeringModeActive: passiveComposerSteeringModeActive.value,
    passiveComposerValues: passiveComposerValues.value,
    passiveComposerWorkflowControls: passiveComposerWorkflowControls.value,
    selectedComposerControl: selectedComposerControl.value,
    selectedComposerInputDisabled: selectedComposerInputDisabled.value,
    selectedComposerRunning: selectedComposerRunning.value,
    selectedControlFields: selectedComposerControlFields.value,
    selectedControlIsPrimary: selectedControlIsPrimary.value,
    selectedControlSteeringActive: false,
    selectedControlUsesConversationComposer: selectedControlUsesConversationComposer.value,
    selectedControlValues: selectedControlValues.value,
    selectedWorkflowButtonControls: selectedWorkflowButtonControls.value,
    stepInputCanSubmit: stepInputComposerCanSubmit.value,
    stepInputControl: stepInputComposerControl.value,
    stepInputDecisionControlsVisible: stepInputHasWorkflowIntents.value,
    stepInputFields: stepInputComposerFields.value,
    stepInputSaving: stepInput.saving,
    stepInputValues: stepInputComposerValues.value,
    workflowButtonControls: workflowButtonControls.value
  }));
  const composerControlFormVisible = computed(() => composerControlModel.value.formVisible);
  const composerControlTarget = computed(() => composerControlModel.value.target);
  const composerControlAgentControlsVisible = computed(() => composerControlModel.value.agentControlsVisible);
  const composerControlAttachTextarea = computed(() => composerControlModel.value.attachTextarea);
  const composerControlCancelVisible = computed(() => composerControlModel.value.cancelVisible);
  const composerControlCanSubmit = computed(() => composerControlModel.value.canSubmit);
  const composerControlFields = computed(() => composerControlModel.value.fields);
  const composerControlInlineSubmit = computed(() => composerControlModel.value.inlineSubmit);
  const composerControlInlineSubmitLabelVisible = computed(() => composerControlModel.value.inlineSubmitLabelVisible);
  const composerControlInputDisabled = computed(() => composerControlModel.value.inputDisabled);
  const composerControlInputDisabledReason = computed(() => composerInputDisabledReason({
    agentInteractionLocked: agentInteractionLocked.value,
    commandRunning: commandRunning.value,
    disabled: composerControlInputDisabled.value,
    displayRunning: displayRunning.value,
    localComposerSubmissionPending: localComposerSubmissionPending.value,
    pageBusy: props.page?.busy,
    remoteComposerSubmissionPending: remoteComposerSubmissionPending.value,
    running: running.value,
    stepInputSaving: stepInput.saving
  }));
  const composerStatusLaneReason = computed(() => (
    (
      thinkingVisible.value
        ? ""
        : sessionControlsBlockingLabel.value || sessionControlsUnavailableLabel.value
    ) ||
    (
      composerUserResponseControlsVisible.value
        ? ""
        : composerStatusLaneReasonFor(composerControlInputDisabledReason.value)
    )
  ));
  const composerInlineInputDisabledReason = computed(() => composerInlineInputDisabledReasonFor(
    composerControlInputDisabledReason.value
  ));
  const statusLane = computed(() => composerStatusLaneState({
    composerStatusReason: composerStatusLaneReason.value,
    thinkingLabel: thinkingLabel.value,
    thinkingVisible: thinkingVisible.value
  }));
  const statusLaneVisible = computed(() => statusLane.value.visible);
  const statusLaneLabel = computed(() => statusLane.value.label);
  const composerControlInterruptDisabled = computed(() => composerControlModel.value.interruptDisabled);
  const composerControlInterruptVisible = computed(() => composerControlModel.value.interruptVisible);
  const composerInlineInterruptVisible = computed(() => Boolean(
    composerControlFormVisible.value &&
    composerControlInlineSubmit.value &&
    composerControlInterruptVisible.value
  ));
  const statusAgentStopVisible = computed(() => Boolean(
    agentStopVisible.value &&
    !selectedScreenControlVisible.value &&
    !composerInlineInterruptVisible.value
  ));
  const statusActionsVisible = computed(() => Boolean(
    !chatTakeoverVisible.value &&
    (
      statusAgentStopVisible.value ||
      screenStopAction.value ||
      stuckRecoveryAvailable.value
    )
  ));
  const composerControlRunning = computed(() => composerControlModel.value.running);
  const composerControlLayout = computed(() => composerControlModel.value.layout);
  const composerControlPlacement = computed(() => composerControlModel.value.placement);
  const composerControlSelectedControl = computed(() => composerControlModel.value.selectedControl);
  const composerControlTextareaRows = computed(() => composerControlModel.value.textareaRows);
  const composerControlValues = computed(() => composerControlModel.value.values);
  const composerControlWorkflowControls = computed(() => composerControlModel.value.workflowControls);
  const composerControlAttachmentsEnabled = computed(() => composerControlModel.value.attachmentsEnabled);
  const composerControlTimelineFormVisible = computed(() => Boolean(
    composerControlFormVisible.value &&
    composerControlPlacement.value === COMPOSER_CONTROL_PLACEMENTS.TIMELINE
  ));
  const composerControlComposerFormVisible = computed(() => Boolean(
    composerControlFormVisible.value &&
    composerControlPlacement.value !== COMPOSER_CONTROL_PLACEMENTS.TIMELINE
  ));
  const sourceEditorAskCodexAvailable = computed(() => Boolean(
    composerVisible.value &&
    composerControlFormVisible.value &&
    !composerControlInputDisabled.value &&
    !composerInputLocked.value &&
    !reportPreviewVisible.value &&
    !stepInputFormVisible.value &&
    (
      !selectedScreenControlVisible.value ||
      selectedControlUsesConversationComposer.value
    )
  ));
  const conversationTimelineControlVisible = computed(() => Boolean(
    composerControlTimelineFormVisible.value &&
    !reportPreviewVisible.value &&
    !stepInputFormVisible.value
  ));
  const bottomWorkflowActionsVisible = computed(() => Boolean(
    workflowButtonControls.value.length &&
    !selectedControl.value &&
    !stepInputDecisionTimelineVisible.value &&
    !composerControlTimelineFormVisible.value &&
    !["passive_composer", "step_input"].includes(controlSurfaceMode.value)
  ));
  const bottomComposerVisible = computed(() => Boolean(
    composerVisible.value &&
    (
      composerControlComposerFormVisible.value ||
      (
        statusActionsVisible.value &&
        !passiveComposerSteeringModeActive.value
      ) ||
      bottomWorkflowActionsVisible.value
    )
  ));
  const artifactControlFormVisible = computed(() => Boolean(
    reportPreviewVisible.value &&
    selectedScreenControlVisible.value
  ));
  const artifactWorkflowActionsVisible = computed(() => Boolean(
    reportPreviewVisible.value &&
    !selectedControl.value &&
    workflowButtonControls.value.length
  ));
  const stepInputActionHandlers = computed(() => ({
    ...props.actions,
    runAction: runActionAfterStepInput
  }));
  const stepInputFallbackActionsVisible = computed(() => Boolean(
    stepInputFormVisible.value &&
    !stepInputHasWorkflowIntents.value &&
    !workflowButtonControls.value.length &&
    Array.isArray(props.actions?.currentActions) &&
    props.actions.currentActions.length
  ));
  function sectionVisible(kind = "") {
    return screenSections.value.some((section) => section?.kind === kind);
  }

  function optimisticTextFromSubmission(options = {}) {
    const sourceOptions = options && typeof options === "object" && !Array.isArray(options) ? options : {};
    const displayFields = normalizedDraftFields(sourceOptions.displayFields);
    const fields = normalizedDraftFields(sourceOptions.fields);
    return String(displayFields.conversationRequest || fields.conversationRequest || "").trim();
  }

  function selectedComposerDraftText() {
    return selectedControlDraftText({
      fields: selectedControlFields.value,
      values: selectedControlSubmissionFields()
    });
  }

  function conversationComposerSyncFields(fields = {}) {
    const source = fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {};
    return {
      [CONVERSATION_COMPOSER_DRAFT_FIELD]: String(
        source[CONVERSATION_COMPOSER_DRAFT_FIELD] ??
        conversationComposerDraft.value ??
        ""
      )
    };
  }

  function composerDraftSyncFields(fields = selectedControlDisplayValues.value) {
    return composerDraftUsesConversationComposer.value
      ? conversationComposerSyncFields(fields)
      : normalizedDraftFields(fields);
  }

  function publishComposerDraftChange(fieldName = "", fields = selectedControlDisplayValues.value) {
    if (composerDraftUsesConversationComposer.value) {
      composerDraftSync.publishDraftChange(
        CONVERSATION_COMPOSER_DRAFT_FIELD,
        composerDraftSyncFields(fields)
      );
      return;
    }
    composerDraftSync.publishDraftChange(fieldName, composerDraftSyncFields(fields));
  }

  function composerDraftSyncFieldName(fields = {}) {
    if (composerDraftUsesConversationComposer.value) {
      return CONVERSATION_COMPOSER_DRAFT_FIELD;
    }
    return Object.keys(normalizedDraftFields(fields))[0] || CONVERSATION_COMPOSER_DRAFT_FIELD;
  }

  function controlForSelectedComposer() {
    const controlId = String(selectedControl.value?.id || "").trim();
    return allScreenControls.value.find((item) => item.id === controlId) || selectedControl.value;
  }

  function payloadUsesConversationComposer(payload = {}) {
    return String(payload?.controlId || "") === CONVERSATION_COMPOSER_DRAFT_CONTROL_ID;
  }

  function controlForComposerPayload(payload = {}) {
    return payloadUsesConversationComposer(payload)
      ? selectedControl.value || passiveComposerControl.value
      : controlForSelectedComposer();
  }

  function clearSelectedComposerDraft(control = controlForSelectedComposer()) {
    if (!control?.id || !Array.isArray(control.inputFields)) {
      return false;
    }
    restoreControlDraft(control, initialControlValues(control));
    if (String(control.id || "") === String(primaryIntentId.value || "")) {
      conversationComposerFallbackDraft.value = "";
    }
    return true;
  }

  function composerDebugFieldIsPrivate(name = "") {
    const fieldName = String(name || "").trim();
    if (!fieldName) {
      return false;
    }
    const fieldGroups = [
      passiveComposerFields.value,
      selectedControlFields.value,
      stepInputComposerFields.value,
      composerControlFields.value
    ];
    return fieldGroups.some((fields = []) => (
      Array.isArray(fields) &&
      fields.some((field = {}) => (
        String(field?.name || "").trim() === fieldName &&
        inputFieldIsPrivate(field)
      ))
    ));
  }

  function composerInputDebugState() {
    const turn = activeAgentTurn.value || {};
    const control = composerControlSelectedControl.value || {};
    return {
      agentTurnActive: turn.active === true,
      agentTurnState: String(turn.state || ""),
      agentTurnStatus: String(turn.status || ""),
      agentTurnHasProviderIds: agentTurnHasProviderIds(props.session, turn),
      agentTurnThreadId: String(props.session?.agentSession?.thread?.id || ""),
      agentTurnTurnId: String(turn.id || ""),
      agentInteractionLocked: agentInteractionLocked.value,
      agentSteeringAvailable: agentSteeringAvailable.value,
      agentTerminalRunning: agentTerminalRunning.value,
      composerControlCanSubmit: composerControlCanSubmit.value,
      composerControlFields: (Array.isArray(composerControlFields.value)
        ? composerControlFields.value
        : []
      ).map((field) => composerInputDebugFieldValue({
        field,
        fieldIsPrivate: inputFieldIsPrivate,
        values: composerControlValues.value
      })),
      composerControlFormVisible: composerControlFormVisible.value,
      composerControlId: String(control.id || ""),
      composerControlInputDisabled: composerControlInputDisabled.value,
      composerControlInputDisabledReason: composerControlInputDisabledReason.value,
      composerControlInlineSubmit: composerControlInlineSubmit.value,
      composerControlInlineSubmitLabelVisible: composerControlInlineSubmitLabelVisible.value,
      composerControlLabel: String(control.label || ""),
      composerControlRunning: composerControlRunning.value,
      composerControlTarget: composerControlTarget.value,
      composerInputLocked: composerInputLocked.value,
      controlSurfaceMode: controlSurfaceMode.value,
      passiveComposerCanSubmit: passiveComposerCanSubmit.value,
      passiveComposerInputDisabled: passiveComposerInputDisabled.value,
      passiveComposerSteeringModeActive: passiveComposerSteeringModeActive.value,
      passiveComposerVisible: passiveComposerVisible.value,
      projectSlug: projectSlug.value,
      selectedScreenControlVisible: selectedScreenControlVisible.value,
      sessionDetailState: sessionDetailState.value.state,
      sessionControlsRestoring: sessionControlsRestoring.value,
      statusLaneLabel: statusLaneLabel.value,
      statusLaneVisible: statusLaneVisible.value
    };
  }

  const {
    logInputChanged: logComposerInputChanged
  } = useVibe64ComposerInputDebug({
    fieldIsPrivate: composerDebugFieldIsPrivate,
    session: () => props.session || {},
    state: composerInputDebugState
  });

  function updateSelectedControlValue(name = "", value = "", options = {}) {
    const fieldName = String(name || "");
    const valueBefore = selectedControlValues.value?.[fieldName] ?? "";
    updateLocalSelectedControlValue(name, value);
    if (conversationComposerDraftFieldMatches(name)) {
      conversationComposerFallbackDraft.value = String(value || "");
    }
    publishComposerDraftChange(name, selectedControlDisplayValues.value);
    logComposerInputChanged({
      name,
      source: options?.source || COMPOSER_CONTROL_TARGETS.SELECTED_CONTROL,
      valueAfter: selectedControlValues.value?.[fieldName] ?? "",
      valueBefore,
      valueRequested: value
    });
  }

  function normalizeProjectPane(value = "") {
    return ["dashboard", "preview"].includes(value)
      ? value
      : "preview";
  }

  function sessionToolIdForDashboardRoute(routePath = "", slug = "") {
    const dashboardPrefix = `${normalizeProjectRoutePath(projectAppPath(slug, "/dashboard"))}/`;
    const normalizedRoutePath = `${normalizeProjectRoutePath(routePath)}/`;
    if (!normalizedRoutePath.startsWith(dashboardPrefix)) {
      return "";
    }
    const routeSegment = normalizedRoutePath
      .slice(dashboardPrefix.length)
      .split("/")[0] || "";
    return vibe64SessionToolIdFromRouteSegment(routeSegment);
  }

  function sessionNavLabel(session = {}) {
    const metadata = session?.metadata || {};
    const name = String(session?.sessionName || metadata.issue_word || "").trim();
    if (name) {
      return name;
    }
    const value = String(session?.sessionId || "").trim();
    if (!value) {
      return "";
    }
    return value.includes("_")
      ? value.split("_").slice(-2).join("_")
      : value.slice(0, 12);
  }

  function sessionToolRuntimeState(toolId = "") {
    if (toolId === "editor") {
      return {
        disabled: !sessionSourceRoot.value,
        title: sessionSourceRoot.value ? "Edit session source files" : "Create the session source before editing files"
      };
    }
    if (toolId === "config") {
      return {
        disabled: !sessionConfigEditable.value,
        title: sessionConfigToolTitle.value
      };
    }
    if (toolId === "diff") {
      return {
        disabled: props.review?.diffDisabled === true,
        title: props.review?.diffTitle || "Review changes in the session clone"
      };
    }
    return {};
  }

  function rightPaneExists(tabId = "") {
    return projectPaneIds.includes(tabId) || sessionPaneIds.includes(tabId);
  }

  function selectRightPaneTab(tabId = "") {
    if (!rightPaneExists(tabId)) {
      return;
    }
    rightPaneTab.value = tabId;
  }

  function selectProjectPaneTab(tabId = "") {
    selectRightPaneTab(tabId);
  }

  function sessionToolRoutePath(toolId = "") {
    const suffix = vibe64SessionToolDashboardSuffix(toolId);
    return suffix ? projectAppPath(projectSlug.value, suffix) : "";
  }

  function navigateToPath(path = "") {
    const targetPath = String(path || "").trim();
    if (!targetPath || normalizeProjectRoutePath(targetPath) === normalizeProjectRoutePath(route.path)) {
      return;
    }
    void router.push(targetPath);
  }

  function navigateToSessionTool(toolId = "") {
    navigateToPath(sessionToolRoutePath(toolId));
  }

  function backToDashboard() {
    navigateToPath(sessionToolBackPath.value);
  }

  function selectSessionTool(tabId = "", {
    navigate = true
  } = {}) {
    if (!sessionPaneIds.includes(tabId)) {
      return false;
    }
    if (navigate) {
      navigateToSessionTool(tabId);
    }
    selectRightPaneTab(tabId);
    if (tabId === "diff" && !props.diff?.payload && !props.diff?.loading && typeof props.diff?.load === "function") {
      void props.diff.load();
    }
    return true;
  }

  function openCodexTerminalForRecovery() {
    const opened = selectSessionTool("ai-terminal");
    if (opened) {
      emit("project-attention");
    }
    return opened;
  }

  function openSourceEditorFile(target = {}) {
    const filePath = String(target?.path || "").trim();
    if (!filePath) {
      return false;
    }
    sourceEditorOpenSequence += 1;
    sourceEditorOpenRequest.value = {
      column: Number(target.column || 0) || 0,
      line: Number(target.line || 0) || 0,
      path: filePath,
      sequence: sourceEditorOpenSequence
    };
    const opened = selectSessionTool("editor");
    if (opened) {
      emit("project-attention");
    }
    return opened;
  }

  function selectSessionToolFromNav(tabId = "") {
    if (selectSessionTool(tabId)) {
      emit("project-attention");
    }
  }

  function emitBusyState() {
    emit("busy-change", autopilotBusy.value);
  }

  function tailCommandText(value = "") {
    const text = String(value || "");
    const maxLength = STUDIO_TERMINAL_TEXT_TAIL_LENGTH;
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(text.length - maxLength);
  }

  async function submitCommandFailureResponse() {
    const saved = await stepInput.submit();
    if (saved) {
      await retry();
    }
    return saved;
  }

  async function saveCurrentStepInputForControl(control = {}) {
    if (
      !stepInputFormVisible.value ||
      !controlSavesCurrentStepInputBeforeRun(control)
    ) {
      return true;
    }
    return await stepInput.submit();
  }

  async function activateWorkflowButtonControl(control = {}) {
    if (await saveCurrentStepInputForControl(control) === false) {
      return false;
    }
    return activateControl(control);
  }

  function currentActionById(actionId = "") {
    const normalizedActionId = String(actionId || "").trim();
    if (!normalizedActionId) {
      return null;
    }
    return (Array.isArray(props.actions?.currentActions) ? props.actions.currentActions : [])
      .find((action) => String(action?.id || "").trim() === normalizedActionId) || null;
  }

  function stepInputActionWorkflowControl(action = {}) {
    const id = String(action?.id || "").trim();
    if (!id || action?.visible === false) {
      return null;
    }
    return {
      actionId: id,
      disabledReason: String(action.disabledReason || ""),
      dispatchRoute: String(action.dispatchRoute || ""),
      enabled: action.enabled === true,
      id,
      label: String(action.label || id),
      saveCurrentStepInputBeforeRun: action.saveCurrentStepInputBeforeRun === true,
      sourceAction: action,
      style: action.style || "primary"
    };
  }

  function currentIntentById(intentId = "") {
    const normalizedIntentId = String(intentId || "").trim();
    if (!normalizedIntentId) {
      return null;
    }
    const intents = [
      ...(Array.isArray(props.session?.intents) ? props.session.intents : []),
      ...(Array.isArray(props.session?.presentation?.intents) ? props.session.presentation.intents : [])
    ];
    return intents.find((intent) => String(intent?.id || "").trim() === normalizedIntentId) || null;
  }

  function publicTextareaFieldName(fields = []) {
    const field = (Array.isArray(fields) ? fields : [])
      .find((candidate) => (
        candidate?.kind === "textarea" &&
        !inputFieldIsPrivate(candidate)
      ));
    return String(field?.name || "").trim();
  }

  function currentStepInputDraftControlId() {
    return [
      CURRENT_STEP_INPUT_CONTROL_ID,
      props.session?.currentStep || "",
      props.session?.stepMachine?.status || ""
    ]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(".");
  }

  function stepInputEditableFieldNames() {
    return new Set((Array.isArray(stepInput.fields) ? stepInput.fields : [])
      .map((field) => String(field?.name || "").trim())
      .filter(Boolean));
  }

  function stepInputEditableValues() {
    const fieldNames = stepInputEditableFieldNames();
    return Object.fromEntries(Object.entries(stepInput.values || {})
      .filter(([name]) => fieldNames.has(String(name || "").trim()))
      .map(([name, value]) => [name, String(value ?? "")]));
  }

  function firstStepInputDraftFieldName(fields = stepInputEditableValues()) {
    return Object.keys(normalizedDraftFields(fields))[0] || "";
  }

  function firstStepInputDraftText(fields = stepInputEditableValues()) {
    const normalized = normalizedDraftFields(fields);
    const fieldName = firstStepInputDraftFieldName(normalized);
    return String(normalized[fieldName] || "").trim();
  }

  function publishStepInputDraftChange(fieldName = "", fields = stepInputEditableValues()) {
    const normalizedFieldName = String(fieldName || "").trim();
    const normalizedFields = normalizedDraftFields(fields);
    if (!normalizedFieldName || !Object.hasOwn(normalizedFields, normalizedFieldName)) {
      return;
    }
    stepInputDraftSync.publishDraftChange(normalizedFieldName, normalizedFields);
  }

  function applyStepInputDraft(fields = {}) {
    const fieldNames = stepInputEditableFieldNames();
    for (const [fieldName, value] of Object.entries(normalizedDraftFields(fields))) {
      if (fieldNames.has(fieldName)) {
        stepInput.updateValue(fieldName, value);
      }
    }
  }

  function conversationComposerDraftFieldMatches(name = "") {
    const fieldName = conversationComposerFieldName.value;
    return Boolean(
      fieldName &&
      String(name || "").trim() === fieldName
    );
  }

  function conversationComposerDraftTextFromFields(fields = {}) {
    const source = fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {};
    const fieldName = conversationComposerFieldName.value;
    return String(
      source[fieldName] ??
      source[CONVERSATION_COMPOSER_DRAFT_FIELD] ??
      Object.values(source)[0] ??
      ""
    );
  }

  function applyConversationComposerDraft(fields = {}) {
    setConversationComposerDraft(conversationComposerDraftTextFromFields(fields));
  }

  function setConversationComposerDraft(value = "", {
    publishDraft = false
  } = {}) {
    const text = String(value || "");
    const fieldName = conversationComposerFieldName.value;
    conversationComposerFallbackDraft.value = text;
    if (!fieldName) {
      if (publishDraft) {
        publishComposerDraftChange(CONVERSATION_COMPOSER_DRAFT_FIELD, {
          [CONVERSATION_COMPOSER_DRAFT_FIELD]: text
        });
      }
      return true;
    }
    updateLocalSelectedControlValue(fieldName, text);
    if (publishDraft) {
      publishComposerDraftChange(fieldName, conversationComposerSyncFields({
        [fieldName]: text
      }));
    }
    return true;
  }

  function activeComposerDraftText() {
    if (selectedScreenControlVisible.value && selectedControl.value) {
      const fieldName = publicTextareaFieldName(selectedControlFields.value);
      return fieldName ? String(selectedControlValues.value?.[fieldName] || "") : "";
    }
    return String(conversationComposerDraft.value || "");
  }

  function setActiveComposerDraftText(text = "") {
    const nextText = String(text || "");
    if (selectedScreenControlVisible.value && selectedControl.value) {
      const fieldName = publicTextareaFieldName(selectedControlFields.value);
      if (!fieldName) {
        return false;
      }
      if (conversationComposerDraftFieldMatches(fieldName)) {
        setConversationComposerDraft(nextText, {
          publishDraft: true
        });
      } else {
        updateLocalSelectedControlValue(fieldName, nextText);
        publishComposerDraftChange(fieldName, selectedControlDisplayValues.value);
      }
      return true;
    }
    setConversationComposerDraft(nextText, {
      publishDraft: true
    });
    return true;
  }

  function activePromptSubmissionControl() {
    if (composerControlTarget.value === COMPOSER_CONTROL_TARGETS.PASSIVE_COMPOSER) {
      return passiveComposerControl.value;
    }
    if (composerControlTarget.value === COMPOSER_CONTROL_TARGETS.SELECTED_CONTROL) {
      return composerControlSelectedControl.value || selectedControl.value;
    }
    return null;
  }

  const {
    activateComposerMenuItem,
    clearPromptRefs: clearComposerPromptRefs,
    expandedSubmissionOptions: expandedComposerPromptSubmissionOptions,
    insertComposerMenuItemText,
    prefillActiveComposer
  } = useVibe64ComposerPromptActions({
    actionById: currentActionById,
    activateWorkflowControl: activateWorkflowButtonControl,
    activeDraftText: activeComposerDraftText,
    activePromptControl: activePromptSubmissionControl,
    composerMenuItems,
    intentById: currentIntentById,
    rejectOptimisticTurn: markOptimisticComposerTurnFailed,
    runWorkflowControl,
    setActiveDraftText: setActiveComposerDraftText,
    startOptimisticTurn: (input = {}) => startOptimisticComposerTurn({
      ...input,
      ...(
        String(input?.control?.id || "") === CONVERSATION_COMPOSER_DRAFT_CONTROL_ID ||
        input?.control?.dispatchRoute === ACTION_DISPATCH_ROUTES.SESSION_MESSAGE
        ? {
            afterSubmissionId: composerSteerAfterSubmissionId.value,
            messageDelivery: true
          }
        : {})
    })
  });

  function askCodexAboutSourceEditorFile(filePath = "") {
    const normalizedPath = String(filePath || "").trim();
    if (!normalizedPath || !sourceEditorAskCodexAvailable.value) {
      return false;
    }
    return prefillActiveComposer(`Please look at \`${normalizedPath}\` and help me with this file.`);
  }

  async function submitSelectedWorkflowControl(options = {}) {
    if (await saveCurrentStepInputForControl(selectedControl.value) === false) {
      return false;
    }
    return submitSelectedControl({
      ...(options && typeof options === "object" && !Array.isArray(options) ? options : {}),
      agentSettings: requestAgentSettings.value
    });
  }

  function clearAcceptedComposerSubmission(submittedForm = null) {
    for (const form of new Set([submittedForm, screenControlFormRef.value])) {
      form?.clearAttachments?.();
    }
    clearComposerPromptRefs();
  }

  const {
    submitPassiveComposer,
    updatePassiveComposer
  } = useVibe64PassiveComposerSubmission({
    afterSubmissionId: composerSteerAfterSubmissionId,
    clearAcceptedSubmission: clearAcceptedComposerSubmission,
    control: passiveComposerControl,
    draft: conversationComposerDraft,
    expandSubmissionOptions: expandedComposerPromptSubmissionOptions,
    fieldName: passiveComposerFieldName,
    logInputChanged: logComposerInputChanged,
    rejectOptimisticTurn: markOptimisticComposerTurnFailed,
    sendAgentMessage: props.sendAgentMessage,
    setDraft: setConversationComposerDraft,
    startOptimisticTurn: startOptimisticComposerTurn,
    submittedForm: () => screenControlFormRef.value
  });

  async function submitScreenComposerControl(options = {}) {
    const submittedForm = screenControlFormRef.value;
    const accepted = await submitSelectedControl(options);
    if (accepted) {
      clearAcceptedComposerSubmission(submittedForm);
    }
    return accepted;
  }

  async function submitStepInputFromComposer() {
    if (stepInputUsesNumberedQuestions.value) {
      const fields = numberedQuestionSubmissionFields(
        stepInputNumberedQuestions.value.questions,
        stepInput.values
      );
      for (const [name, value] of Object.entries(fields)) {
        stepInput.updateValue(name, value);
      }
    }
    const fields = stepInputEditableValues();
    const fieldName = firstStepInputDraftFieldName(fields);
    if (fieldName) {
      stepInputDraftSync.publishSubmissionStart(fieldName, fields, {
        text: firstStepInputDraftText(fields)
      });
    }
    const accepted = stepInput.interaction?.kind === "command_failure_response"
      ? await submitCommandFailureResponse()
      : await stepInput.submit();
    if (!accepted && fieldName) {
      stepInputDraftSync.publishSubmissionRejected(fieldName, fields, {
        text: firstStepInputDraftText(fields)
      });
    }
    return accepted;
  }

  async function submitComposerControl(options = {}) {
    const handlers = {
      [COMPOSER_CONTROL_TARGETS.PASSIVE_COMPOSER]: submitPassiveComposer,
      [COMPOSER_CONTROL_TARGETS.SELECTED_CONTROL]: submitScreenComposerControl,
      [COMPOSER_CONTROL_TARGETS.STEP_INPUT]: submitStepInputFromComposer
    };
    return (handlers[composerControlTarget.value] || submitScreenComposerControl)(options);
  }

  function updateComposerControlValue(name = "", value = "") {
    const handlers = {
      [COMPOSER_CONTROL_TARGETS.PASSIVE_COMPOSER]: updatePassiveComposer,
      [COMPOSER_CONTROL_TARGETS.SELECTED_CONTROL]: updateSelectedControlValue,
      [COMPOSER_CONTROL_TARGETS.STEP_INPUT]: updateStepInputComposerValue
    };
    return (handlers[composerControlTarget.value] || updateSelectedControlValue)(name, value, {
      source: composerControlTarget.value
    });
  }

  function updateStepInputComposerValue(name = "", value = "", options = {}) {
    const fieldName = String(name || "");
    const valueBefore = stepInput.values?.[fieldName] ?? "";
    stepInput.updateValue(name, value);
    publishStepInputDraftChange(name);
    logComposerInputChanged({
      name,
      source: options?.source || COMPOSER_CONTROL_TARGETS.STEP_INPUT,
      valueAfter: stepInput.values?.[fieldName] ?? "",
      valueBefore,
      valueRequested: value
    });
    return true;
  }

  async function runActionFromStepInput(action = {}) {
    return saveCurrentStepInputForControl(action);
  }

  async function runActionAfterStepInput(action = {}) {
    if (String(action.dispatchRoute || "") === ACTION_DISPATCH_ROUTES.COMMAND_TERMINAL) {
      return runCommandAction(action);
    }
    return props.actions.runAction(action, {
      agentSettings: requestAgentSettings.value
    });
  }

  async function runWorkflowControl(control = {}, options = {}) {
    const runOptions = expandedComposerPromptSubmissionOptions({
      ...(options && typeof options === "object" && !Array.isArray(options) ? options : {}),
      agentSettings: requestAgentSettings.value
    });
    const fields = runOptions.fields && typeof runOptions.fields === "object" && !Array.isArray(runOptions.fields)
      ? runOptions.fields
      : {};
    const displayFields = runOptions.displayFields && typeof runOptions.displayFields === "object" && !Array.isArray(runOptions.displayFields)
      ? runOptions.displayFields
      : {};
    const sourceAction = workflowControlSourceAction(control);
    const usesAssistantMessageOperation = controlUsesAssistantMessageOperation(control);
    if (usesAssistantMessageOperation) {
      const message = String(fields.conversationRequest || displayFields.conversationRequest || "").trim();
      if (!message) {
        return false;
      }
      const afterSubmissionId = composerSteerAfterSubmissionId.value === runOptions.composerSubmissionId
        ? ""
        : composerSteerAfterSubmissionId.value;
      return await props.sendAgentMessage({
        ...(afterSubmissionId
          ? { afterSubmissionId }
          : {}),
        agentSettings: runOptions.agentSettings,
        composerSubmissionId: runOptions.composerSubmissionId,
        displayFields: Object.keys(displayFields).length ? displayFields : fields,
        fields,
        message
      }) !== false;
    }
    if (!sourceAction) {
      return runPresentedIntent(control, runOptions);
    }
    if (String(sourceAction.dispatchRoute || "") === ACTION_DISPATCH_ROUTES.COMMAND_TERMINAL) {
      return runCommandAction(sourceAction);
    }
    const response = await props.actions.runAction(sourceAction, {
      agentSettings: runOptions.agentSettings,
      composerSubmissionId: runOptions.composerSubmissionId,
      displayInput: displayFields,
      input: fields
    });
    await nextTick();
    await runNextOperation();
    return response !== false;
  }

  function updateAgentSetting(parameterId = "", value = "") {
    agentSettings.update({
      [String(parameterId || "")]: String(value || "")
    });
  }

  function inputFieldIsPrivate(field = {}) {
    return actionInputFieldIsPrivate(field);
  }

  async function retryFromCommandFailure() {
    if (stepInput.interaction?.kind === "command_failure_response" && stepInput.visible) {
      clearFailure({
        clearCommandResult: true
      });
      await submitCommandFailureResponse();
      return;
    }
    await retry();
  }

  async function requestCommandAiFix() {
    if (!commandTerminalFailed.value) {
      return;
    }
    openFixCodexDialog(await terminalFailureFix.request({
      actionId: commandResult.value?.actionId || "",
      actionLabel: commandResult.value?.actionLabel || "",
      attemptedCommand: commandResult.value?.attemptedCommand || "",
      closeError: commandTerminalError.value,
      commandPreview: commandPreview.value,
      exitCode: commandResult.value?.exitCode ?? "",
      output: commandTerminalText.value,
      sessionId: sessionId.value,
      terminalKind: "command",
      terminalSessionId: commandResult.value?.terminalSessionId || "",
      terminalStatus: commandStatus.value
    }));
  }

  async function runOptionalPaneReload(reload) {
    if (typeof reload !== "function") {
      return null;
    }
    return await reload();
  }

  async function reloadChatPane() {
    if (!chatReloadAvailable.value || chatReloading.value) {
      return false;
    }
    chatReloading.value = true;
    try {
      await Promise.allSettled([
        runOptionalPaneReload(props.refreshSessionData),
        runOptionalPaneReload(props.conversationLog?.reload)
      ]);
      return true;
    } finally {
      chatReloading.value = false;
    }
  }

  async function loadMoreChatTurns() {
    if (typeof props.conversationLog?.loadMore !== "function") {
      return false;
    }
    return await props.conversationLog.loadMore();
  }

  function stopScreenAction() {
    stop();
  }

  async function rewindToAutopilotStep(step = {}) {
    if (navigationBusy.value || step.canRewind !== true || typeof props.rewindToStep !== "function") {
      return;
    }
    clearFailure();
    clearSelectedControl();
    await props.rewindToStep(step);
  }

  function controlStateActive(control = {}, field = "") {
    return presentationControlStateActive(control, field, {
      diff: props.diff,
      review: props.review
    });
  }

  async function runClientControl(control = {}) {
    clientControlError.value = "";
    try {
      const result = await clientControls.runClientControl(control, {
        diff: props.diff,
        openCodexTerminal: openCodexTerminalForRecovery,
        openDiffPane: () => selectSessionTool("diff"),
        refreshSessionData: props.refreshSessionData,
        session: props.session,
        sessionId: sessionId.value
      });
      if (result?.ok === false) {
        clientControlError.value = String(result.error || "The requested control could not run.");
        return false;
      }
      return result;
    } catch (error) {
      clientControlError.value = String(error?.message || error || "The requested control could not run.");
      return false;
    }
  }

  function controlDisabled(control = {}) {
    if (controlCanSendDuringAgentActivity(control)) {
      return false;
    }
    return Boolean(
      props.page.busy ||
      agentInteractionLocked.value ||
      running.value ||
      localComposerSubmissionPending.value ||
      remoteComposerSubmissionPending.value ||
      stepInput.saving ||
      control.enabled !== true ||
      controlStateActive(control, "disabledWhen")
    );
  }

  function controlLoading(control = {}) {
    const sourceAction = workflowControlSourceAction(control);
    if (sourceAction) {
      return Boolean(
        props.actions.runActionCommand?.isRunning &&
        props.actions.activeActionId === sourceAction.id
      );
    }
    return Boolean(
      running.value ||
      localComposerSubmissionPending.value ||
      remoteComposerSubmissionPending.value ||
      stepInput.saving ||
      controlStateActive(control, "loadingWhen")
    );
  }

  function controlIcon(control = {}) {
    const sourceAction = workflowControlSourceAction(control);
    if (sourceAction && typeof props.actions.actionIcon === "function") {
      return props.actions.actionIcon(sourceAction);
    }
    if (controlIconToken(control) === VIBE64_CLIENT_CONTROL_ICON_TOKENS.DIFF) {
      return mdiFileCompare;
    }
    if (control.style === "primary") {
      return mdiCheck;
    }
    return mdiRefresh;
  }

  onMounted(() => {
    emitBusyState();
    const browserWindow = typeof window !== "undefined" ? window : null;
    browserWindow?.addEventListener?.(
      BROWSER_LIFECYCLE_DISCONNECTED_EVENT,
      failLocalComposerSubmissionForLifecycleDisconnect
    );
    removeBrowserLifecycleDisconnectListener = () => {
      browserWindow?.removeEventListener?.(
        BROWSER_LIFECYCLE_DISCONNECTED_EVENT,
        failLocalComposerSubmissionForLifecycleDisconnect
      );
    };
  });

  onBeforeUnmount(() => {
    removeBrowserLifecycleDisconnectListener();
    removeBrowserLifecycleDisconnectListener = () => null;
  });

  watch(autopilotBusy, () => {
    emitBusyState();
  }, {
    flush: "post"
  });

  watch(() => props.active, () => {
    emitBusyState();
  }, {
    flush: "post"
  });

  watch(() => [
    props.active ? "active" : "inactive",
    canDispatchNextOperation.value ? "dispatchable" : "idle",
    nextOperationKey.value
  ].join(":"), () => {
    if (props.active && canDispatchNextOperation.value) {
      void runNextOperation();
    }
  }, {
    flush: "post",
    immediate: true
  });

  watch(() => [
    projectPaneValue.value,
    route.path,
    routeSessionToolId.value,
    sessionId.value
  ].join("|"), () => {
    if (projectPaneValue.value === "preview") {
      selectRightPaneTab("preview");
      return;
    }
    const toolId = routeSessionToolId.value;
    if (toolId) {
      selectSessionTool(toolId, {
        navigate: false
      });
      return;
    }
    lastDashboardRoutePath.value = route.path;
    selectProjectPaneTab("dashboard");
  }, {
    immediate: true
  });

  watch(sessionId, () => {
    optimisticComposerTurn.value = null;
    optimisticComposerMessages.value = [];
    remoteComposerSubmission.value = null;
    clearComposerPromptRefs();
  });

  function restoreConversationFallbackDraft() {
    const fieldName = conversationComposerFieldName.value;
    const fallbackDraft = conversationComposerFallbackDraft.value;
    if (!fieldName || !fallbackDraft) {
      return;
    }
    if (!String(selectedControlValues.value?.[fieldName] || "")) {
      updateLocalSelectedControlValue(fieldName, fallbackDraft);
    }
  }

  watch(() => [
    conversationComposerFieldName.value,
    String(selectedControl.value?.id || ""),
    Object.keys(selectedControlValues.value || {}).join("|")
  ].join(":"), () => {
    restoreConversationFallbackDraft();
  }, {
    flush: "post"
  });

  watch(() => props.conversationLog?.turns, (turns) => {
    reconcileOptimisticComposerMessages(turns);
  }, {
    deep: true,
    flush: "post"
  });

  watch(() => props.session?.composerMessages, (messages) => {
    reconcileComposerMessageOutcomes(messages);
  }, {
    deep: true,
    flush: "post",
    immediate: true
  });

  watch(() => [
    optimisticComposerTurn.value?.id || "",
    optimisticComposerTurn.value?.status || "",
    remoteComposerSubmission.value?.id || "",
    remoteComposerSubmission.value?.status || "",
    props.session?.composerHandoff?.canonical === true ? "canonical" : "",
    props.session?.composerHandoff?.submissionId || ""
  ].join("|"), () => {
    clearRemoteComposerSubmissionIfCanonical();
    clearLocalComposerSubmissionIfCanonical();
  }, {
    flush: "post"
  });

  watch(codexTerminalAttentionSignature, (signature) => {
    if (!signature) {
      openedCodexTerminalAttentionSignature.value = "";
      return;
    }
    if (openedCodexTerminalAttentionSignature.value === signature) {
      return;
    }
    openedCodexTerminalAttentionSignature.value = signature;
    openCodexTerminalForRecovery();
  }, {
    flush: "post",
    immediate: true
  });

  return {
    Vibe64FixCodexDialog,
    TargetScriptsPanel,
    Vibe64LaunchControls,
    activateComposerMenuItem,
    Vibe64SessionDiffPanel,
    activateControl,
    activateWorkflowButtonControl,
    activeSessionTool,
    artifactControlFormVisible,
    artifactWorkflowActionsVisible,
    backgroundTaskError,
    bottomComposerVisible,
    bottomWorkflowActionsVisible,
    backToDashboard,
    canSubmitSelectedControl,
    chatCollapsed,
    chatReloadAvailable,
    chatReloading,
    chatTakeoverVisible,
    chatTimelineVisible,
    chatTurns,
    clearSelectedControl,
    agentInterruptVisible,
    agentStopEnabled,
    agentStopVisible,
    commandFailureSummary,
    commandOverlayTitle,
    commandPreview,
    commandResult,
    commandRunning,
    commandSpyExpanded,
    commandSpyVisible,
    commandStatus,
    commandTerminalError,
    commandTerminalFailed,
    commandTerminal,
    commandTerminalSummary,
    commandTerminalText,
    composerControlAgentControlsVisible,
    composerControlAttachTextarea,
    composerControlAttachmentsEnabled,
    composerControlCancelVisible,
    composerControlCanSubmit,
    composerControlComposerFormVisible,
    composerControlFields,
    composerControlFormKey,
    composerControlFormVisible,
    composerControlInlineSubmit,
    composerControlInlineSubmitLabelVisible,
    composerControlInputDisabled,
    composerControlInputDisabledReason,
    composerInlineInputDisabledReason,
    composerControlInterruptDisabled,
    composerControlInterruptVisible,
    composerControlLayout,
    composerControlRunning,
    composerControlSelectedControl,
    composerControlTextareaRows,
    composerControlTimelineFormVisible,
    composerControlValues,
    composerControlWorkflowControls,
    composerInputLocked,
    composerMenuItems,
    composerVisible,
    cancelOptimisticComposerTurn,
    conversationTimelineControlVisible,
    conversationLogVisible,
    controlSurfaceMode,
    conversationScrollKey,
    currentAgentSettings,
    dashboardSessionContext,
    dashboardShellVisible,
    editOptimisticComposerTurn,
    fixDialogOpen,
    fixJob,
    fixTerminal,
    insertComposerMenuItemText,
    inputFieldIsPrivate,
    mdiCheck,
    mdiArrowLeft,
    mdiChevronDown,
    mdiChevronUp,
    mdiClose,
    mdiConsoleLine,
    mdiGithub,
    mdiRefresh,
    mdiRobotOutline,
    mdiStopCircleOutline,
    navigationBusy,
    openFixCodexDialog,
    openSourceEditorFile,
    projectSlug,
    passiveComposerBusy,
    passiveComposerCanSubmit,
    passiveComposerControl,
    passiveComposerFields,
    passiveComposerInputDisabled,
    passiveComposerSteeringModeActive,
    passiveComposerValues,
    passiveComposerVisible,
    passiveComposerWorkflowControls,
    recoverStuckStep,
    reportPreviewVisible,
    requestAgentInterrupt,
    requestCommandAiFix,
    resendOptimisticComposerTurn,
    loadMoreChatTurns,
    reloadChatPane,
    retryBackgroundTask,
    retryFromCommandFailure,
    retryingBackgroundTaskId,
    rewindToAutopilotStep,
    rightPaneTab,
    rightPaneTabMounted,
    runActionFromStepInput,
    runtimeNoticeMessages,
    runtimeStatusVisible,
    screenContentTitle,
    screenControlFormRef,
    screenStopAction,
    selectedComposerControl,
    selectedComposerInputDisabled,
    selectedComposerRunning,
    selectedControl,
    selectedControlFields,
    selectedControlIsPrimary,
    selectedWorkflowButtonControls,
    selectedControlValues,
    selectedScreenControlVisible,
    sessionId,
    sessionConfigEditable,
    sessionConfigSourceReady,
    sessionSourceRoot,
    sessionGithubActor,
    sessionGithubActorHeaderVisible,
    sessionToolControls,
    sessionToolbarVisible,
    sourceEditorAskCodexAvailable,
    askCodexAboutSourceEditorFile,
    sourceEditorOpenRequest,
    statusAgentStopVisible,
    statusActionsVisible,
    stepInput,
    stepInputActionHandlers,
    stepInputDecisionTimelineVisible,
    stepInputFallbackActionsVisible,
    stepInputFormVisible,
    stepInputTimelineDisplayFields,
    stopCommandAction,
    stopScreenAction,
    stuckRecoveryAvailable,
    stuckRecoveryRunning,
    submitComposerControl,
    submitPassiveComposer,
    submitSelectedAnswerChoice,
    submitScreenComposerControl,
    submitSelectedWorkflowControl,
    thinkingLabel: statusLaneLabel,
    thinkingVisible: statusLaneVisible,
    updateAgentSetting,
    updateComposerControlValue,
    updatePassiveComposer,
    updateSelectedControlValue,
    useFreeTextForAnswerChoice,
    visibleBackgroundTasks,
    workflowButtonControls,
    workflowExecuting
    };
}

export {
  composerInputDisabledReason,
  useVibe64AutopilotView,
  vibe64AutopilotViewEmits,
  vibe64AutopilotViewProps
};
