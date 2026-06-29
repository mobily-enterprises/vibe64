import { computed, nextTick, onBeforeUnmount, onMounted, proxyRefs, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  mdiAlertCircleOutline,
  mdiCheck,
  mdiCheckCircleOutline,
  mdiChevronDown,
  mdiChevronUp,
  mdiClose,
  mdiCogOutline,
  mdiConsoleLine,
  mdiFileCompare,
  mdiInformationOutline,
  mdiPlayBoxMultipleOutline,
  mdiRefresh,
  mdiRobotOutline,
  mdiStopCircleOutline,
  mdiViewGridOutline
} from "@mdi/js";
import {
  VIBE64_ACTION_DISPATCH_ROUTES as ACTION_DISPATCH_ROUTES
} from "@local/vibe64-core/shared";
import {
  VIBE64_DEFAULT_AGENT_PROVIDER_ID
} from "@local/vibe64-runtime/shared";
import {
  initialControlValues,
  latestAssistantMessageAwaitingUserReply,
  latestSubmittedConversationText,
  selectedControlDraftText,
  useVibe64AutopilotComposer
} from "@/composables/useVibe64AutopilotComposer.js";
import {
  createRemoteComposerOptimisticTurn
} from "@/lib/vibe64ComposerOptimisticTurn.js";
import {
  normalizedDraftFields,
  useVibe64ComposerDraftSync
} from "@/composables/useVibe64ComposerDraftSync.js";
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
  vibe64CodexTerminalAttentionSignature
} from "@/lib/vibe64CodexTerminalAttention.js";
import {
  localComposerSubmissionCanClear,
  optimisticComposerTurnIsLocalPending,
  vibe64ComposerSubmissionStatusState
} from "@/lib/vibe64ComposerSubmissionState.js";
import {
  PASSIVE_COMPOSER_FIELD,
  passiveComposerCanSteer,
  passiveComposerSteeringMode,
  passiveComposerShouldShow,
  passiveComposerSteerPayload
} from "@/lib/vibe64PassiveComposerSteer.js";
import {
  UI_QUESTION_FIELD_PREFIX,
  numberedQuestionInputFields,
  numberedQuestionSubmissionFields,
  numberedQuestionSugarForInput
} from "@/lib/vibe64NumberedQuestionSugar.js";
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
  codexInteractionLocksControls
} from "@/lib/vibe64CodexInteractionState.js";
import {
  defineVibe64AsyncComponent
} from "@/lib/vibe64AsyncComponent.js";
import {
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel
} from "@/lib/vibe64SessionViewModel.js";
import {
  readLocalStorageJson,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";
import {
  BROWSER_LIFECYCLE_DISCONNECTED_EVENT
} from "@/lib/browserLifecycle.js";

const vibe64AutopilotViewEmits = ["busy-change", "project-attention", "project-pane-change"];
const CODEX_INTERRUPT_DEBOUNCE_MS = 5000;
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
  codexThinking: {
    default: false,
    type: Boolean
  },
  chatCollapsed: {
    default: false,
    type: Boolean
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
  interruptCodexTurn: {
    default: async () => false,
    type: Function
  },
  steerCodexTurn: {
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
  previewToolbarTeleportTarget: {
    default: "",
    type: String
  }
};

function useVibe64AutopilotView(props, emit) {
  const route = useRoute();
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
  const sessionToolsMenuOpen = ref(false);
  const screenControlFormRef = ref(null);
  const rightPaneTab = ref("preview");
  const mountedRightPaneTabs = ref(["preview"]);
  const openedCodexTerminalAttentionSignature = ref("");
  const optimisticComposerTurn = ref(null);
  const remoteComposerSubmission = ref(null);
  const codexInterruptCooldownActive = ref(false);
  const codexInterruptRequestPending = ref(false);
  let codexInterruptCooldownTimer = null;
  let optimisticComposerTurnCounter = 0;
  let removeBrowserLifecycleDisconnectListener = () => null;
  const SESSION_TOOL_STORAGE_PREFIX = "vibe64.sessionTools.active";
  const projectPaneIds = Object.freeze([
    "preview",
    "dashboard"
  ]);
  const sessionPaneIds = Object.freeze([
    "run",
    "config",
    "session-details",
    "diff",
    "shell",
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
  const sessionToolStorageKey = computed(() => (
    sessionId.value ? `${SESSION_TOOL_STORAGE_PREFIX}:${sessionId.value}` : ""
  ));
  const codexTerminalAttentionSignature = computed(() => (
    props.active ? vibe64CodexTerminalAttentionSignature(props.session || {}) : ""
  ));
  const dashboardSessionContext = computed(() => ({
    copyText: typeof props.page?.copyText === "function" ? props.page.copyText : null,
    facts: vibe64SessionFacts(props.session || {}),
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
  const screenContentMessage = computed(() => String(screenState.value.message || "").trim());
  const screenContentHeaderVisible = computed(() => Boolean(
    props.active &&
    !chatTakeoverVisible.value &&
    !stepInputFormVisible.value &&
    !["codex_running", "conversation"].includes(screenKind.value) &&
    screenContentTitle.value
  ));
  const screenContentMessageVisible = computed(() => Boolean(
    screenContentHeaderVisible.value &&
    screenContentMessage.value &&
    screenContentMessage.value !== screenContentTitle.value &&
    !stepInputFormVisible.value
  ));
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
  const codexInteractionLocked = computed(() => codexInteractionLocksControls({
    codexThinking: props.codexThinking
  }));
  const activeCodexAgentTurn = computed(() => (
    props.session?.codexAgentTurn && typeof props.session.codexAgentTurn === "object"
      ? props.session.codexAgentTurn
      : {}
  ));
  const codexTerminalHandoffSteerAvailable = computed(() => Boolean(
    codexInteractionLocked.value &&
    primaryIntentId.value &&
    !String(activeCodexAgentTurn.value.threadId || "").trim() &&
    String(props.session?.codexTerminal?.status || "").trim() === "running"
  ));
  const passiveComposerEditableWhileLocked = computed(() => Boolean(
    codexTerminalHandoffSteerAvailable.value
  ));
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
  const remoteComposerSubmissionPending = computed(() => remoteComposerSubmission.value?.status === "pending");
  const localComposerSubmissionPending = computed(() => optimisticComposerTurnIsLocalPending(optimisticComposerTurn.value));
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
    codexInteractionLocked.value ||
    autopilotBusy.value ||
    commandRunning.value
  ));
  const composerInputLocked = computed(() => Boolean(
    codexInteractionLocked.value ||
    running.value ||
    displayRunning.value ||
    commandRunning.value ||
    localComposerSubmissionPending.value ||
    remoteComposerSubmissionPending.value ||
    stepInput.saving ||
    props.page?.busy
  ));
  const selectedControlSteeringActive = computed(() => controlCanSteerCodexTurn(selectedControl.value));
  const selectedComposerInputDisabled = computed(() => Boolean(
    composerInputLocked.value &&
    !selectedControlSteeringActive.value
  ));
  const selectedComposerRunning = computed(() => Boolean(
    selectedComposerInputDisabled.value
  ));
  const selectedScreenControlVisible = computed(() => Boolean(
    props.active &&
    selectedControl.value &&
    (!composerInputLocked.value || selectedControlSteeringActive.value)
  ));
  const codexInterruptVisible = computed(() => Boolean(codexInteractionLocked.value));
  const codexInterruptBlocked = computed(() => Boolean(
    codexInterruptCooldownActive.value ||
    codexInterruptRequestPending.value
  ));
  const composerSubmissionStatus = computed(() => vibe64ComposerSubmissionStatusState({
    codexInterruptBlocked: codexInterruptBlocked.value,
    codexInterruptVisible: codexInterruptVisible.value,
    localComposerSubmissionPending: localComposerSubmissionPending.value,
    remoteComposerSubmissionPending: remoteComposerSubmissionPending.value
  }));
  const codexHandoffPending = computed(() => composerSubmissionStatus.value.codexHandoffPending);
  const codexStopVisible = computed(() => composerSubmissionStatus.value.codexStopVisible);
  const codexStopEnabled = computed(() => composerSubmissionStatus.value.codexStopEnabled);
  const thinkingVisible = computed(() => Boolean(
    codexInteractionLocked.value ||
    running.value ||
    displayRunning.value ||
    commandRunning.value ||
    localComposerSubmissionPending.value ||
    remoteComposerSubmissionPending.value ||
    stepInput.saving
  ));
  const thinkingLabel = computed(() => composerSubmissionStatus.value.thinkingLabel);
  const sessionToolbarVisible = computed(() => Boolean(
    Array.isArray(props.sessionToolbar?.sessions) &&
    props.sessionToolbar.sessions.length
  ));
  const sessionToolsVisible = computed(() => Boolean(props.session));
  const sessionConfigSourceReady = computed(() => Boolean(vibe64SessionSourcePath(props.session || {})));
  const sessionConfigBootstrapReady = computed(() => props.projectContext?.projectConfig?.bootstrap === true);
  const sessionConfigEditable = computed(() => Boolean(
    sessionConfigSourceReady.value ||
    sessionConfigBootstrapReady.value
  ));
  const sessionConfigToolTitle = computed(() => {
    if (sessionConfigSourceReady.value) {
      return "Edit this session source .vibe64 config";
    }
    if (sessionConfigBootstrapReady.value) {
      return "Edit pending seed config before the session source exists";
    }
    return "Create the session source before editing config";
  });
  const sessionToolControls = computed(() => [
    {
      icon: mdiPlayBoxMultipleOutline,
      id: "run",
      label: "Run",
      title: "Run project scripts"
    },
    {
      disabled: !sessionConfigEditable.value,
      icon: mdiCogOutline,
      id: "config",
      label: "Config",
      title: sessionConfigToolTitle.value
    },
    {
      icon: mdiInformationOutline,
      id: "session-details",
      label: "Session",
      title: "Show active session details"
    },
    {
      disabled: props.review?.diffDisabled === true,
      icon: mdiFileCompare,
      id: "diff",
      label: "Diff",
      title: props.review?.diffTitle || "Review changes in the session clone"
    },
    {
      icon: mdiConsoleLine,
      id: "shell",
      label: "Shell",
      title: "Open the session clone terminal"
    },
    {
      icon: mdiRobotOutline,
      id: "ai-terminal",
      label: "AI Terminal",
      title: "Open the active session Codex terminal"
    }
  ]);
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
    const optimistic = optimisticComposerTurn.value;
    if (!optimistic) {
      return turns;
    }
    if (
      optimistic.status !== "failed" &&
      turns.some((turn) => turnMatchesOptimisticComposerTurn(turn, optimistic))
    ) {
      return turns;
    }
    return [
      ...turns,
      {
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
      }
    ];
  });
  const actionResultNoticeVisible = computed(() => Boolean(
    props.actions?.actionResultMessage
  ));
  const actionResultType = computed(() => String(props.actions?.actionResultType || "info"));
  const clientControlError = ref("");
  const chatReloading = ref(false);
  const conversationComposerFallbackDraft = ref("");
  const passiveComposerSteerRunning = ref(false);
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
    codexTerminalAttentionSignature.value
      ? {
          icon: mdiRobotOutline,
          id: "codex-terminal-attention",
          text: "Codex needs attention in the AI Terminal.",
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
      : null
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
  const allScreenControls = computed(() => {
    return workflowScreenControls.value;
  });
  function controlCanSteerCodexTurn(control = {}) {
    const controlId = String(control?.id || "").trim();
    const primaryId = String(primaryIntentId.value || "").trim();
    const inputFields = Array.isArray(control?.inputFields) ? control.inputFields : [];
    return Boolean(
      codexTerminalHandoffSteerAvailable.value &&
      controlId &&
      primaryId &&
      controlId === primaryId &&
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
    controls: allScreenControls,
    canSubmitWhileRunning: controlCanSteerCodexTurn,
    isControlDisabled: controlDisabled,
    onDraftSubmissionRejected: markOptimisticComposerTurnFailed,
    onDraftSubmissionStart: startOptimisticComposerTurn,
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
    return String(selectedControlValues.value?.[fieldName] || conversationComposerFallbackDraft.value || "");
  });
  const passiveComposerSteeringActive = computed(() => passiveComposerCanSteer({
    codexSteerAvailable: codexTerminalHandoffSteerAvailable.value,
    selectedScreenControlVisible: selectedScreenControlVisible.value
  }));
  const passiveComposerSteeringDraftActive = computed(() => Boolean(
    conversationComposerDraft.value &&
    codexInteractionLocked.value
  ));
  const passiveComposerSteeringModeActive = computed(() => passiveComposerSteeringMode({
    codexInteractionLocked: codexInteractionLocked.value,
    codexSteerAvailable: codexTerminalHandoffSteerAvailable.value,
    selectedScreenControlVisible: selectedScreenControlVisible.value,
    steeringDraftActive: passiveComposerSteeringDraftActive.value
  }));
  const passiveComposerInputDisabled = computed(() => {
    if (!passiveComposerSteeringModeActive.value) {
      return true;
    }
    if (codexInteractionLocked.value) {
      return !passiveComposerEditableWhileLocked.value;
    }
    return false;
  });
  const passiveComposerCanSubmit = computed(() => Boolean(
    passiveComposerSteeringActive.value &&
    !passiveComposerSteerRunning.value &&
    passiveComposerSteerPayload(conversationComposerDraft.value)
  ));
  const passiveComposerBusy = computed(() => Boolean(
    passiveComposerSteerRunning.value ||
    (
      !passiveComposerSteeringModeActive.value &&
      (
        composerInputLocked.value ||
        thinkingVisible.value
      )
    )
  ));
  const passiveComposerFieldName = computed(() => CONVERSATION_COMPOSER_DRAFT_FIELD);
  const passiveComposerFields = computed(() => [
    {
      kind: "textarea",
      label: passiveComposerSteeringModeActive.value
        ? "Steer Codex"
        : "Message",
      name: passiveComposerFieldName.value,
      required: passiveComposerSteeringModeActive.value,
      value: ""
    }
  ]);
  const passiveComposerControl = computed(() => ({
    id: passiveComposerSteeringModeActive.value ? "passive_steer_codex" : "passive_composer",
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
    [PASSIVE_COMPOSER_FIELD]: conversationComposerDraft.value,
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
    applySubmissionRejected: applyRemoteComposerSubmissionRejected,
    applySubmissionStart: applyRemoteComposerSubmissionStart,
    enabled: computed(() => props.active !== false),
    projectSlug,
    selectedControl: syncedComposerDraftControl,
    selectedControlValues: syncedComposerDraftValues,
    sessionId,
    sessionsApiPath: props.sessionsApiPath
  });
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
    if (!selectedControlSteeringActive.value || !selectedControl.value) {
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
    }
    return {
      ...selectedControl.value,
      label: "Steer",
      submitLabel: "Steer"
    };
  });
  const selectedComposerControlFields = computed(() => {
    if (!selectedControlSteeringActive.value) {
      return selectedControlFields.value;
    }
    return selectedControlFields.value.map((field) => (
      field?.kind === "textarea" && !inputFieldIsPrivate(field)
        ? {
            ...field,
            ariaLabel: "Steer Codex",
            label: "Steer Codex"
          }
        : field
    ));
  });
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
  const composerMenuItems = computed(() => {
    const menu = props.session?.presentation?.composerMenu;
    return Array.isArray(menu?.items) ? menu.items : [];
  });
  const composerMenuKey = computed(() => composerMenuItems.value
    .map((item) => String(item?.id || ""))
    .filter(Boolean)
    .join(","));
  const composerControlFormKey = computed(() => [
    "composer",
    sessionId.value,
    composerMenuKey.value
  ].join(":"));
  const selectedWorkflowButtonControls = computed(() => {
    const selectedControlId = String(selectedControl.value?.id || "").trim();
    return workflowButtonControls.value.filter((control) => (
      String(control?.id || "").trim() !== selectedControlId
    ));
  });
  const composerSelectedScreenControlVisible = computed(() => Boolean(
    selectedScreenControlVisible.value &&
    !stepInputDecisionTimelineVisible.value
  ));
  const composerSelectedScreenAnswerChoicesVisible = computed(() => Boolean(
    composerSelectedScreenControlVisible.value &&
    selectedControlFields.value.some((field) => field?.kind === "answer_choices")
  ));
  const candidateControlSurfaceMode = computed(() => composerControlCandidateSurfaceMode({
    composerVisible: composerVisible.value,
    selectedScreenAnswerChoicesVisible: composerSelectedScreenAnswerChoicesVisible.value,
    selectedScreenControlVisible: composerSelectedScreenControlVisible.value,
    stepInputFormVisible: stepInputFormVisible.value && !stepInputDecisionTimelineVisible.value
  }));
  const passiveComposerWorkflowControls = computed(() => (
    !codexStopVisible.value &&
    !codexHandoffPending.value
      ? workflowButtonControls.value
      : []
  ));
  const passiveComposerVisible = computed(() => Boolean(
    candidateControlSurfaceMode.value === "passive_composer" &&
    passiveComposerShouldShow({
      composerInputLocked: composerInputLocked.value,
      handoffPending: codexHandoffPending.value,
      selectedScreenControlVisible: selectedScreenControlVisible.value,
      steeringActive: passiveComposerSteeringModeActive.value,
      stepInputFormVisible: stepInputFormVisible.value
    })
  ));
  const controlSurfaceMode = computed(() => composerControlSurfaceMode({
    candidateMode: candidateControlSurfaceMode.value,
    passiveComposerVisible: passiveComposerVisible.value
  }));
  const composerControlModel = computed(() => composerControlProjection({
    canSubmitSelectedControl: canSubmitSelectedControl.value,
    codexInterruptVisible: codexInterruptVisible.value,
    codexStopEnabled: codexStopEnabled.value,
    codexStopVisible: codexStopVisible.value,
    composerDraftUsesConversationComposer: composerDraftUsesConversationComposer.value,
    mode: controlSurfaceMode.value,
    pageBusy: props.page?.busy,
    passiveComposerCanSubmit: passiveComposerCanSubmit.value,
    passiveComposerControl: passiveComposerControl.value,
    passiveComposerFields: passiveComposerFields.value,
    passiveComposerInputDisabled: passiveComposerInputDisabled.value,
    passiveComposerSteeringModeActive: passiveComposerSteeringModeActive.value,
    passiveComposerSteerRunning: passiveComposerSteerRunning.value,
    passiveComposerValues: passiveComposerValues.value,
    passiveComposerWorkflowControls: passiveComposerWorkflowControls.value,
    selectedComposerControl: selectedComposerControl.value,
    selectedComposerInputDisabled: selectedComposerInputDisabled.value,
    selectedComposerRunning: selectedComposerRunning.value,
    selectedControlFields: selectedComposerControlFields.value,
    selectedControlIsPrimary: selectedControlIsPrimary.value,
    selectedControlSteeringActive: selectedControlSteeringActive.value,
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
  const composerControlCancelVisible = computed(() => composerControlModel.value.cancelVisible);
  const composerControlCanSubmit = computed(() => composerControlModel.value.canSubmit);
  const composerControlFields = computed(() => composerControlModel.value.fields);
  const composerControlInlineSubmit = computed(() => composerControlModel.value.inlineSubmit);
  const composerControlInlineSubmitLabelVisible = computed(() => composerControlModel.value.inlineSubmitLabelVisible);
  const composerControlInputDisabled = computed(() => composerControlModel.value.inputDisabled);
  const composerControlInputDisabledReason = computed(() => composerInputDisabledReason({
    codexInteractionLocked: codexInteractionLocked.value,
    commandRunning: commandRunning.value,
    disabled: composerControlInputDisabled.value,
    displayRunning: displayRunning.value,
    localComposerSubmissionPending: localComposerSubmissionPending.value,
    pageBusy: props.page?.busy,
    passiveComposerSteerRunning: passiveComposerSteerRunning.value,
    remoteComposerSubmissionPending: remoteComposerSubmissionPending.value,
    running: running.value,
    stepInputSaving: stepInput.saving
  }));
  const composerStatusLaneReason = computed(() => composerStatusLaneReasonFor(
    composerControlInputDisabledReason.value
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
  const statusCodexStopVisible = computed(() => Boolean(
    codexStopVisible.value &&
    !selectedScreenControlVisible.value &&
    !composerInlineInterruptVisible.value
  ));
  const statusActionsVisible = computed(() => Boolean(
    !chatTakeoverVisible.value &&
    (
      statusCodexStopVisible.value ||
      screenStopAction.value ||
      stuckRecoveryAvailable.value
    )
  ));
  const composerControlRunning = computed(() => composerControlModel.value.running);
  const composerControlSelectedControl = computed(() => composerControlModel.value.selectedControl);
  const composerControlValues = computed(() => composerControlModel.value.values);
  const composerControlWorkflowControls = computed(() => composerControlModel.value.workflowControls);
  const composerControlAttachmentsEnabled = computed(() => composerControlModel.value.attachmentsEnabled);
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
  const timelineControlSelectedControlVisible = computed(() => Boolean(
    stepInputDecisionTimelineVisible.value &&
    selectedScreenControlVisible.value
  ));
  const timelineControlSelectedControl = computed(() => (
    timelineControlSelectedControlVisible.value
      ? selectedComposerControl.value
      : stepInputComposerControl.value
  ));
  const timelineControlFields = computed(() => (
    timelineControlSelectedControlVisible.value
      ? selectedControlFields.value
      : stepInputComposerFields.value
  ));
  const timelineControlValues = computed(() => (
    timelineControlSelectedControlVisible.value
      ? selectedControlValues.value
      : stepInputComposerValues.value
  ));
  const timelineControlCanSubmit = computed(() => (
    timelineControlSelectedControlVisible.value
      ? canSubmitSelectedControl.value
      : false
  ));
  const timelineControlCancelVisible = computed(() => Boolean(
    timelineControlSelectedControlVisible.value
  ));
  const timelineControlWorkflowControls = computed(() => (
    timelineControlSelectedControlVisible.value
      ? selectedWorkflowButtonControls.value
      : workflowButtonControls.value
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
        source[PASSIVE_COMPOSER_FIELD] ??
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

  function clearRemoteComposerSubmissionIfCanonical() {
    const submission = remoteComposerSubmission.value;
    if (submission?.status !== "pending") {
      return false;
    }
    const text = String(submission.text || "").trim();
    if (!text || latestSubmittedConversationText(props.conversationLog) !== text) {
      return false;
    }
    remoteComposerSubmission.value = null;
    if (optimisticComposerTurn.value?.remote === true && optimisticComposerTurn.value.text === text) {
      optimisticComposerTurn.value = null;
    }
    return true;
  }

  function clearLocalComposerSubmissionIfCanonical() {
    const optimistic = optimisticComposerTurn.value;
    if (localComposerSubmissionCanClear({
      assistantReplyText: latestAssistantMessageAwaitingUserReply(props.conversationLog),
      codexHandoffComplete: codexInteractionLocked.value,
      optimisticTurn: optimistic,
      submittedText: latestSubmittedConversationText(props.conversationLog)
    })) {
      optimisticComposerTurn.value = null;
      return true;
    }
    if (
      optimistic?.status === "failed" &&
      Array.isArray(props.conversationLog?.turns) &&
      props.conversationLog.turns.some((turn) => turnMatchesOptimisticComposerTurn(turn, optimistic))
    ) {
      optimisticComposerTurn.value = null;
      return true;
    }
    return false;
  }

  function applyRemoteComposerSubmissionStart(fields = {}, payload = {}) {
    const text = String(payload?.text || "").trim();
    const control = controlForComposerPayload(payload);
    const submissionFields = normalizedDraftFields(fields);
    remoteComposerSubmission.value = {
      controlId: String(payload?.controlId || control?.id || ""),
      fields: submissionFields,
      status: "pending",
      text,
      updatedAt: String(payload?.updatedAt || "")
    };
    if (payloadUsesConversationComposer(payload)) {
      if (text && String(conversationComposerDraft.value || "").trim() === text) {
        setConversationComposerDraft("");
      }
    } else if (text && selectedComposerDraftText() === text) {
      clearSelectedComposerDraft(control);
    }
    optimisticComposerTurnCounter += 1;
    optimisticComposerTurn.value = createRemoteComposerOptimisticTurn({
      control,
      fields: submissionFields,
      id: `remote-composer-${optimisticComposerTurnCounter}`,
      payload,
      text
    });
  }

  function applyRemoteComposerSubmissionRejected(fields = {}, payload = {}) {
    const control = controlForComposerPayload(payload);
    const text = String(payload?.text || "").trim();
    if (
      optimisticComposerTurn.value?.remote === true &&
      (!text || optimisticComposerTurn.value.text === text)
    ) {
      optimisticComposerTurn.value = null;
    }
    remoteComposerSubmission.value = null;
    if (payloadUsesConversationComposer(payload)) {
      setConversationComposerDraft(conversationComposerDraftTextFromFields(fields) || text);
      return;
    }
    if (control?.id && Array.isArray(control.inputFields)) {
      restoreControlDraft(control, fields);
      if (String(control.id || "") === String(primaryIntentId.value || "")) {
        conversationComposerFallbackDraft.value = "";
      }
    }
  }

  function startOptimisticComposerTurn({
    control = {},
    options = {},
    values = {}
  } = {}) {
    const text = optimisticTextFromSubmission(options);
    if (!text) {
      return null;
    }
    const syncedFields = composerDraftSyncFields(values);
    composerDraftSync.publishSubmissionStart(composerDraftSyncFieldName(syncedFields), syncedFields, {
      text
    });
    optimisticComposerTurnCounter += 1;
    const id = `optimistic-composer-${optimisticComposerTurnCounter}`;
    const sourceOptions = options && typeof options === "object" && !Array.isArray(options) ? options : {};
    optimisticComposerTurn.value = {
      control,
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now(),
      error: "",
      id,
      options: {
        ...sourceOptions,
        displayFields: normalizedDraftFields(sourceOptions.displayFields),
        fields: normalizedDraftFields(sourceOptions.fields)
      },
      status: "pending",
      text,
      values: normalizedDraftFields(values)
    };
    return id;
  }

  function updateSelectedControlValue(name = "", value = "") {
    updateLocalSelectedControlValue(name, value);
    if (conversationComposerDraftFieldMatches(name)) {
      conversationComposerFallbackDraft.value = "";
    }
    publishComposerDraftChange(name, selectedControlDisplayValues.value);
  }

  function markOptimisticComposerTurnFailed(submissionId = "", {
    error = null
  } = {}) {
    if (!submissionId || optimisticComposerTurn.value?.id !== submissionId) {
      return;
    }
    const optimistic = optimisticComposerTurn.value;
    optimisticComposerTurn.value = {
      ...optimistic,
      error: String(error?.message || error || "Message could not be sent."),
      status: "failed"
    };
    const syncedFields = composerDraftSyncFields(optimistic.values);
    composerDraftSync.publishSubmissionRejected(composerDraftSyncFieldName(syncedFields), syncedFields, {
      text: optimistic.text
    });
    restoreControlDraft(optimistic.control, optimistic.values);
    if (String(optimistic.control?.id || "") === String(primaryIntentId.value || "")) {
      conversationComposerFallbackDraft.value = "";
    }
  }

  function failLocalComposerSubmissionForLifecycleDisconnect() {
    const optimistic = optimisticComposerTurn.value;
    if (optimisticComposerTurnIsLocalPending(optimistic)) {
      markOptimisticComposerTurnFailed(optimistic.id, {
        error: "Vibe64 restarted before this message reached Codex. Use Resend when the server is back."
      });
    }
    props.actions?.clear?.();
  }

  function clearOptimisticComposerTurn(submissionId = "") {
    if (!submissionId || optimisticComposerTurn.value?.id !== submissionId) {
      return false;
    }
    optimisticComposerTurn.value = null;
    return true;
  }

  function turnMatchesOptimisticComposerTurn(turn = {}, optimistic = {}) {
    const text = String(turn?.user?.text || "").trim();
    if (!text || text !== optimistic.text) {
      return false;
    }
    const userAtMs = Date.parse(String(turn?.user?.at || ""));
    return !Number.isNaN(userAtMs) && userAtMs >= optimistic.createdAtMs - 5000;
  }

  async function resendOptimisticComposerTurn(submissionId = "") {
    const optimistic = optimisticComposerTurn.value;
    if (!optimistic || optimistic.id !== submissionId || optimistic.status !== "failed") {
      return false;
    }
    optimisticComposerTurn.value = {
      ...optimistic,
      error: "",
      status: "pending"
    };
    let accepted = false;
    try {
      accepted = await runWorkflowControl(optimistic.control, optimistic.options);
    } catch (error) {
      markOptimisticComposerTurnFailed(submissionId, {
        error
      });
      return false;
    }
    if (accepted === false) {
      markOptimisticComposerTurnFailed(submissionId);
      return false;
    }
    return true;
  }

  function editOptimisticComposerTurn(submissionId = "") {
    const optimistic = optimisticComposerTurn.value;
    if (!optimistic || optimistic.id !== submissionId) {
      return false;
    }
    restoreControlDraft(optimistic.control, optimistic.values);
    optimisticComposerTurn.value = null;
    return true;
  }

  function normalizeProjectPane(value = "") {
    return ["dashboard", "preview"].includes(value)
      ? value
      : "preview";
  }

  function rightPaneExists(tabId = "") {
    return projectPaneIds.includes(tabId) || sessionPaneIds.includes(tabId);
  }

  function persistedSessionTool() {
    const value = readLocalStorageJson(sessionToolStorageKey.value, "");
    return sessionPaneIds.includes(value) ? value : "";
  }

  function persistSessionTool(tabId = "") {
    if (!sessionToolStorageKey.value) {
      return;
    }
    writeLocalStorageJson(sessionToolStorageKey.value, sessionPaneIds.includes(tabId) ? tabId : "");
  }

  function selectRightPaneTab(tabId = "", {
    persist = true
  } = {}) {
    if (!rightPaneExists(tabId)) {
      return;
    }
    rightPaneTab.value = tabId;
    if (persist) {
      persistSessionTool(sessionPaneIds.includes(tabId) ? tabId : "");
    }
  }

  function selectProjectPaneTab(tabId = "") {
    selectRightPaneTab(tabId, {
      persist: true
    });
  }

  function restorePersistedSessionTool() {
    const tabId = persistedSessionTool();
    if (!tabId) {
      selectRightPaneTab("preview", {
        persist: false
      });
      return;
    }
    selectSessionTool(tabId, {
      persist: false
    });
  }

  function selectSessionTool(tabId = "", {
    persist = true
  } = {}) {
    if (!sessionPaneIds.includes(tabId)) {
      return false;
    }
    selectRightPaneTab(tabId, {
      persist
    });
    if (tabId === "diff" && !props.diff?.payload && !props.diff?.loading && typeof props.diff?.load === "function") {
      void props.diff.load();
    }
    return true;
  }

  function openCodexTerminalForRecovery() {
    const opened = selectSessionTool("ai-terminal", {
      persist: false
    });
    if (opened) {
      emit("project-attention");
    }
    return opened;
  }

  function selectSessionToolFromMenu(tabId = "") {
    if (selectSessionTool(tabId)) {
      sessionToolsMenuOpen.value = false;
      emit("project-attention");
    }
  }

  function closeSessionTool() {
    sessionToolsMenuOpen.value = false;
    selectProjectPaneTab(projectPaneValue.value === "dashboard" ? "dashboard" : "preview");
  }

  function emitBusyState() {
    emit("busy-change", autopilotBusy.value);
  }

  function tailCommandText(value = "") {
    const text = String(value || "");
    const maxLength = 12000;
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
      source[PASSIVE_COMPOSER_FIELD] ??
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
    if (!fieldName) {
      conversationComposerFallbackDraft.value = text;
      if (publishDraft) {
        publishComposerDraftChange(CONVERSATION_COMPOSER_DRAFT_FIELD, {
          [CONVERSATION_COMPOSER_DRAFT_FIELD]: text
        });
      }
      return true;
    }
    updateLocalSelectedControlValue(fieldName, text);
    conversationComposerFallbackDraft.value = "";
    if (publishDraft) {
      publishComposerDraftChange(fieldName, conversationComposerSyncFields({
        [fieldName]: text
      }));
    }
    return true;
  }

  function composerDraftWithPastedText(current = "", text = "") {
    const existing = String(current || "");
    const pasted = String(text || "").trim();
    if (!pasted) {
      return existing;
    }
    if (!existing.trim()) {
      return pasted;
    }
    return `${existing.trimEnd()}\n\n${pasted}`;
  }

  function prefillActiveComposer(text = "") {
    const value = String(text || "").trim();
    if (!value) {
      return false;
    }
    if (selectedScreenControlVisible.value && selectedControl.value) {
      const fieldName = publicTextareaFieldName(selectedControlFields.value);
      if (!fieldName) {
        return false;
      }
      const nextValue = composerDraftWithPastedText(selectedControlValues.value?.[fieldName], value);
      if (conversationComposerDraftFieldMatches(fieldName)) {
        setConversationComposerDraft(nextValue, {
          publishDraft: true
        });
      } else {
        updateLocalSelectedControlValue(fieldName, nextValue);
        publishComposerDraftChange(fieldName, selectedControlDisplayValues.value);
      }
      return true;
    }
    setConversationComposerDraft(composerDraftWithPastedText(conversationComposerDraft.value, value), {
      publishDraft: true
    });
    return true;
  }

  async function activateComposerMenuItem(item = {}) {
    const kind = String(item?.kind || "template").trim();
    if (kind === "template") {
      return prefillActiveComposer(item.text);
    }
    if (kind === "action") {
      const action = currentActionById(item.actionId);
      if (!action) {
        return false;
      }
      return activateWorkflowButtonControl({
        disabledReason: item.disabledReason || action.disabledReason || "",
        enabled: item.enabled === true && action.enabled === true,
        id: item.id || action.id,
        label: item.label || action.label || action.id,
        sourceAction: action,
        style: "secondary"
      });
    }
    if (kind === "intent") {
      const intent = currentIntentById(item.intentId);
      if (!intent) {
        return false;
      }
      return activateWorkflowButtonControl({
        ...intent,
        enabled: item.enabled === true && intent.enabled === true,
        id: intent.id,
        label: item.label || intent.label || intent.id
      });
    }
    return false;
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

  async function submitScreenComposerControl(options = {}) {
    const submittedForm = screenControlFormRef.value;
    const accepted = await submitSelectedControl(options);
    if (accepted) {
      submittedForm?.clearAttachments?.();
      screenControlFormRef.value?.clearAttachments?.();
    }
    return accepted;
  }

  async function submitPassiveComposer(options = {}) {
    if (!passiveComposerSteeringActive.value || passiveComposerSteerRunning.value) {
      return false;
    }
    const submittedDraft = conversationComposerDraft.value;
    const payload = passiveComposerSteerPayload(submittedDraft, options);
    if (!payload) {
      return false;
    }
    const draftSubmission = startOptimisticComposerTurn({
      control: passiveComposerControl.value,
      options: {
        displayFields: payload.displayFields,
        fields: payload.fields
      },
      values: {
        [passiveComposerFieldName.value]: submittedDraft
      }
    });
    setConversationComposerDraft("");
    passiveComposerSteerRunning.value = true;
    function restoreSubmittedDraft() {
      if (!conversationComposerDraft.value) {
        setConversationComposerDraft(submittedDraft);
      }
    }
    try {
      const steered = await props.steerCodexTurn(payload) !== false;
      if (!steered) {
        clearOptimisticComposerTurn(draftSubmission);
        restoreSubmittedDraft();
      }
      return steered;
    } catch {
      clearOptimisticComposerTurn(draftSubmission);
      restoreSubmittedDraft();
      return false;
    } finally {
      passiveComposerSteerRunning.value = false;
    }
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

  async function submitTimelineControl(options = {}) {
    if (!timelineControlSelectedControlVisible.value) {
      return false;
    }
    return submitSelectedWorkflowControl(options);
  }

  async function submitComposerControl(options = {}) {
    const handlers = {
      [COMPOSER_CONTROL_TARGETS.PASSIVE_COMPOSER]: submitPassiveComposer,
      [COMPOSER_CONTROL_TARGETS.SELECTED_CONTROL]: submitScreenComposerControl,
      [COMPOSER_CONTROL_TARGETS.STEP_INPUT]: submitStepInputFromComposer
    };
    return (handlers[composerControlTarget.value] || submitScreenComposerControl)(options);
  }

  function updatePassiveComposer(name = "", value = "") {
    const fieldName = String(name || "").trim();
    if (
      fieldName !== PASSIVE_COMPOSER_FIELD &&
      fieldName !== passiveComposerFieldName.value
    ) {
      return false;
    }
    return setConversationComposerDraft(value, {
      publishDraft: true
    });
  }

  function updateComposerControlValue(name = "", value = "") {
    const handlers = {
      [COMPOSER_CONTROL_TARGETS.PASSIVE_COMPOSER]: updatePassiveComposer,
      [COMPOSER_CONTROL_TARGETS.SELECTED_CONTROL]: updateSelectedControlValue,
      [COMPOSER_CONTROL_TARGETS.STEP_INPUT]: updateStepInputComposerValue
    };
    return (handlers[composerControlTarget.value] || updateSelectedControlValue)(name, value);
  }

  function updateStepInputComposerValue(name = "", value = "") {
    stepInput.updateValue(name, value);
    publishStepInputDraftChange(name);
    return true;
  }

  function updateTimelineControlValue(name = "", value = "") {
    return timelineControlSelectedControlVisible.value
      ? updateSelectedControlValue(name, value)
      : updateStepInputComposerValue(name, value);
  }

  async function requestCodexInterrupt() {
    if (!codexStopEnabled.value) {
      return false;
    }
    codexInterruptCooldownActive.value = true;
    codexInterruptRequestPending.value = true;
    if (codexInterruptCooldownTimer) {
      clearTimeout(codexInterruptCooldownTimer);
    }
    codexInterruptCooldownTimer = setTimeout(() => {
      codexInterruptCooldownActive.value = false;
      codexInterruptCooldownTimer = null;
    }, CODEX_INTERRUPT_DEBOUNCE_MS);
    try {
      return await props.interruptCodexTurn();
    } finally {
      codexInterruptRequestPending.value = false;
    }
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
    const runOptions = {
      ...(options && typeof options === "object" && !Array.isArray(options) ? options : {}),
      agentSettings: requestAgentSettings.value
    };
    const fields = runOptions.fields && typeof runOptions.fields === "object" && !Array.isArray(runOptions.fields)
      ? runOptions.fields
      : {};
    const displayFields = runOptions.displayFields && typeof runOptions.displayFields === "object" && !Array.isArray(runOptions.displayFields)
      ? runOptions.displayFields
      : {};
    if (controlCanSteerCodexTurn(control)) {
      const message = String(displayFields.conversationRequest || fields.conversationRequest || "").trim();
      if (!message) {
        return false;
      }
      return await props.steerCodexTurn({
        displayFields,
        fields,
        message
      }) !== false;
    }
    const sourceAction = workflowControlSourceAction(control);
    if (!sourceAction) {
      return runPresentedIntent(control, runOptions);
    }
    if (String(sourceAction.dispatchRoute || "") === ACTION_DISPATCH_ROUTES.COMMAND_TERMINAL) {
      return runCommandAction(sourceAction);
    }
    const response = await props.actions.runAction(sourceAction, {
      agentSettings: runOptions.agentSettings,
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
    if (controlCanSteerCodexTurn(control)) {
      return false;
    }
    return Boolean(
      props.page.busy ||
      codexInteractionLocked.value ||
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
    if (codexInterruptCooldownTimer) {
      clearTimeout(codexInterruptCooldownTimer);
      codexInterruptCooldownTimer = null;
    }
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
    sessionId.value
  ].join("|"), () => {
    const pane = projectPaneValue.value;
    if (pane === "preview") {
      restorePersistedSessionTool();
      return;
    }
    selectProjectPaneTab("dashboard");
  }, {
    immediate: true
  });

  watch(sessionId, () => {
    optimisticComposerTurn.value = null;
    remoteComposerSubmission.value = null;
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
    conversationComposerFallbackDraft.value = "";
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

  watch(() => [
    optimisticComposerTurn.value?.remote === true ? "remote" : "local",
    optimisticComposerTurn.value?.status || "",
    optimisticComposerTurn.value?.text || "",
    remoteComposerSubmission.value?.status || "",
    remoteComposerSubmission.value?.text || "",
    codexInteractionLocked.value ? "codex-locked" : "codex-idle",
    running.value ? "running" : "idle",
    displayRunning.value ? "display-running" : "display-idle",
    commandRunning.value ? "command-running" : "command-idle",
    stepInput.saving ? "saving" : "idle",
    props.page?.busy ? "page-busy" : "page-idle",
    props.session?.revision ?? "",
    props.session?.stepRevision ?? "",
    props.session?.stepMachine?.status || "",
    latestSubmittedConversationText(props.conversationLog),
    latestAssistantMessageAwaitingUserReply(props.conversationLog)
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
    canSubmitSelectedControl,
    chatCollapsed,
    chatReloadAvailable,
    chatReloading,
    chatTakeoverVisible,
    chatTimelineVisible,
    chatTurns,
    clearSelectedControl,
    closeSessionTool,
    codexInterruptVisible,
    codexStopEnabled,
    codexStopVisible,
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
    commandTerminalSummary,
    commandTerminalText,
    composerControlAgentControlsVisible,
    composerControlAttachmentsEnabled,
    composerControlCancelVisible,
    composerControlCanSubmit,
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
    composerControlRunning,
    composerControlSelectedControl,
    composerControlValues,
    composerControlWorkflowControls,
    composerInputLocked,
    composerMenuItems,
    composerVisible,
    conversationLogVisible,
    controlSurfaceMode,
    conversationScrollKey,
    currentAgentSettings,
    dashboardSessionContext,
    editOptimisticComposerTurn,
    fixDialogOpen,
    fixJob,
    fixTerminal,
    inputFieldIsPrivate,
    mdiCheck,
    mdiChevronDown,
    mdiChevronUp,
    mdiClose,
    mdiConsoleLine,
    mdiRefresh,
    mdiRobotOutline,
    mdiStopCircleOutline,
    mdiViewGridOutline,
    navigationBusy,
    openFixCodexDialog,
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
    requestCodexInterrupt,
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
    screenContentHeaderVisible,
    screenContentMessage,
    screenContentMessageVisible,
    screenContentTitle,
    screenStopAction,
    selectSessionToolFromMenu,
    selectedComposerControl,
    selectedComposerInputDisabled,
    selectedComposerRunning,
    selectedControl,
    selectedControlFields,
    selectedControlIsPrimary,
    selectedWorkflowButtonControls,
    selectedControlSteeringActive,
    selectedControlValues,
    selectedScreenControlVisible,
    sessionId,
    sessionConfigEditable,
    sessionConfigSourceReady,
    sessionToolControls,
    sessionToolbarVisible,
    sessionToolsMenuOpen,
    sessionToolsVisible,
    statusCodexStopVisible,
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
    submitTimelineControl,
    thinkingLabel: statusLaneLabel,
    thinkingVisible: statusLaneVisible,
    timelineControlCanSubmit,
    timelineControlCancelVisible,
    timelineControlFields,
    timelineControlSelectedControl,
    timelineControlValues,
    timelineControlWorkflowControls,
    updateAgentSetting,
    updateComposerControlValue,
    updatePassiveComposer,
    updateSelectedControlValue,
    updateTimelineControlValue,
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
