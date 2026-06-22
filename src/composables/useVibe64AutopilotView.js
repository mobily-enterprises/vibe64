import { computed, nextTick, onBeforeUnmount, onMounted, proxyRefs, ref, watch } from "vue";
import {
  mdiAlertCircleOutline,
  mdiCheck,
  mdiCheckCircleOutline,
  mdiChevronDown,
  mdiChevronUp,
  mdiClose,
  mdiConsoleLine,
  mdiFileCompare,
  mdiGithub,
  mdiInformationOutline,
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
  passiveComposerShouldShow,
  passiveComposerSteerPayload
} from "@/lib/vibe64PassiveComposerSteer.js";
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
  githubBrokerConfirmationWorkflowControl,
  workflowControlButtonPresentation,
  workflowControlsExceptSelected,
  workflowControlSourceAction
} from "@/lib/vibe64WorkflowControlModel.js";
import {
  actionInputFieldIsPrivate
} from "@/lib/vibe64ActionInputModel.js";
import {
  vibe64SessionFacts
} from "@/lib/vibe64SessionPanelModel.js";
import {
  codexInteractionLocksControls
} from "@/lib/vibe64CodexInteractionState.js";
import {
  defineVibe64AsyncComponent
} from "@/lib/vibe64AsyncComponent.js";
import {
  githubBrokerConfirmationState,
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel
} from "@/lib/vibe64SessionViewModel.js";
import {
  readLocalStorageJson,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";

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
  projectPane: {
    default: "preview",
    type: String
  }
};

function useVibe64AutopilotView(props, emit) {
  const projectSlug = useVibe64ProjectSlug();
  const Vibe64LaunchControls = defineVibe64AsyncComponent({
    label: "Launch controls",
    loader: () => import("@/components/studio/Vibe64LaunchControls.vue"),
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
  const SESSION_TOOL_STORAGE_PREFIX = "vibe64.sessionTools.active";
  const projectPaneIds = Object.freeze([
    "preview",
    "dashboard"
  ]);
  const sessionPaneIds = Object.freeze([
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
  const screenMessage = computed(() => String(screenState.value.message || ""));
  const screenSections = computed(() => Array.isArray(screenState.value.sections) ? screenState.value.sections : []);
  const primaryIntentId = computed(() => props.active ? String(screenState.value.primaryIntentId || "") : "");
  const displayStatusText = computed(() => {
    if (stepInput.visible) {
      return stepInput.interaction?.title || screenState.value.title;
    }
    return screenState.value.title;
  });
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
  const stepInputHasWorkflowIntents = computed(() => Boolean(
    currentStepInputHasDecisionControls(props.session, stepInput.interaction)
  ));
  const selectedStepInputControlVisible = computed(() => Boolean(
    props.active &&
    stepInputFormVisible.value &&
    selectedControl.value &&
    selectedControlFields.value.length
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
  const codexSteerAvailable = computed(() => Boolean(
    codexInteractionLocked.value &&
    String(activeCodexAgentTurn.value.threadId || "").trim() &&
    String(activeCodexAgentTurn.value.turnId || "").trim()
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
    localComposerSubmissionPending: localComposerSubmissionPending.value
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
  const sessionToolControls = computed(() => [
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
      title: props.review?.diffTitle || "Review changes in the session worktree"
    },
    {
      icon: mdiConsoleLine,
      id: "shell",
      label: "Shell",
      title: "Open the session worktree terminal"
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
  const responsePreviewText = computed(() => String(props.humanInputResponsePreview?.text || ""));
  const responsePreviewError = computed(() => String(props.humanInputResponsePreview?.error || ""));
  const responsePreviewLoading = computed(() => Boolean(props.humanInputResponsePreview?.loading));
  const reportPreviewVisible = computed(() => Boolean(sectionVisible("report_preview") && props.reportPreview?.visible));
  const conversationLogVisible = computed(() => Boolean(
    sectionVisible("response_preview") &&
    props.conversationLog?.visible
  ));
  const responsePreviewVisible = computed(() => Boolean(
    sectionVisible("response_preview") &&
    (
      responsePreviewText.value.trim() ||
      responsePreviewError.value ||
      responsePreviewLoading.value
    )
  ));
  const chatTakeoverVisible = computed(() => Boolean(reportPreviewVisible.value));
  const conversationLogReady = computed(() => Boolean(
    !props.conversationLog?.loading
  ));
  const conversationHasTurns = computed(() => Boolean(
    (
      Array.isArray(props.conversationLog?.turns) &&
      props.conversationLog.turns.length
    ) ||
    optimisticComposerTurn.value
  ));
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
  const screenMessageIsGuidance = computed(() => String(screenState.value.variant || "") === "guide");
  const guidanceScreenVisible = computed(() => Boolean(
    !chatTakeoverVisible.value &&
    screenMessageIsGuidance.value &&
    conversationLogReady.value &&
    !conversationHasTurns.value &&
    screenMessage.value &&
    !commandTerminalVisible.value
  ));
  const guidanceActivityMessage = computed(() => {
    if (!guidanceScreenVisible.value) {
      return null;
    }
    const title = screenKind.value === "conversation" ? "" : displayStatusText.value;
    if (screenKind.value === "work_source") {
      return activityMessage({
        appearance: "assistant",
        icon: mdiInformationOutline,
        id: "screen-guidance",
        label: "Vibe64",
        text: screenMessage.value,
        title
      });
    }
    return activityMessage({
      appearance: "assistant",
      icon: mdiRobotOutline,
      id: "screen-guidance",
      label: "Codex",
      text: screenMessage.value,
      title
    });
  });
  const screenActivityMessage = computed(() => {
    const title = String(displayStatusText.value || "").trim();
    if (
      !title ||
      chatTakeoverVisible.value ||
      screenMessageIsGuidance.value ||
      selectedControlUsesLatestAssistantQuestions.value ||
      displayRunning.value ||
      screenKind.value === "codex_running" ||
      commandTerminalVisible.value
    ) {
      return null;
    }
    return activityMessage({
      icon: screenKind.value === "blocked" || screenKind.value === "failure"
        ? mdiAlertCircleOutline
        : mdiInformationOutline,
      id: "screen-status",
      label: "Vibe64",
      text: screenMessage.value,
      title,
      tone: screenKind.value === "blocked" || screenKind.value === "failure" ? "warning" : "info"
    });
  });
  const responsePreviewActivityMessage = computed(() => {
    if (!responsePreviewVisible.value || conversationLogVisible.value) {
      return null;
    }
    return activityMessage({
      icon: mdiRobotOutline,
      id: "codex-response-preview",
      label: "Assistant",
      loading: responsePreviewLoading.value,
      text: responsePreviewError.value || responsePreviewText.value || "Reply is not ready yet.",
      tone: responsePreviewError.value ? "warning" : "info"
    });
  });
  const actionResultNoticeVisible = computed(() => Boolean(
    props.actions?.actionResultMessage
  ));
  const actionResultType = computed(() => String(props.actions?.actionResultType || "info"));
  const clientControlError = ref("");
  const chatReloading = ref(false);
  const passiveComposerMessage = ref("");
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
  const statusActionsVisible = computed(() => Boolean(
    !chatTakeoverVisible.value &&
    (
      codexStopVisible.value && !selectedScreenControlVisible.value ||
      screenStopAction.value ||
      stuckRecoveryAvailable.value
    )
  ));
  const composerVisible = computed(() => Boolean(
    !chatTakeoverVisible.value &&
    props.active &&
    props.session
  ));
  const passiveComposerSteeringActive = computed(() => passiveComposerCanSteer({
    codexSteerAvailable: codexSteerAvailable.value,
    selectedScreenControlVisible: selectedScreenControlVisible.value
  }));
  const passiveComposerVisible = computed(() => passiveComposerShouldShow({
    composerInputLocked: composerInputLocked.value,
    selectedScreenControlVisible: selectedScreenControlVisible.value,
    steeringActive: passiveComposerSteeringActive.value,
    stepInputFormVisible: stepInputFormVisible.value
  }));
  const passiveComposerInputDisabled = computed(() => !passiveComposerSteeringActive.value);
  const passiveComposerCanSubmit = computed(() => Boolean(
    passiveComposerSteeringActive.value &&
    !passiveComposerSteerRunning.value &&
    passiveComposerSteerPayload(passiveComposerMessage.value)
  ));
  const passiveComposerBusy = computed(() => Boolean(
    passiveComposerSteerRunning.value ||
    (
      !passiveComposerSteeringActive.value &&
      (
        composerInputLocked.value ||
        thinkingVisible.value
      )
    )
  ));
  const passiveComposerFields = computed(() => [
    {
      kind: "textarea",
      label: passiveComposerSteeringActive.value ? "Steer Codex" : "What would you like to do?",
      name: PASSIVE_COMPOSER_FIELD,
      required: passiveComposerSteeringActive.value,
      value: ""
    }
  ]);
  const passiveComposerControl = computed(() => ({
    id: passiveComposerSteeringActive.value ? "passive_steer_codex" : "passive_composer",
    inputFields: passiveComposerFields.value,
    label: passiveComposerSteeringActive.value ? "Steer" : "Send",
    style: "primary"
  }));
  const passiveComposerValues = computed(() => ({
    [PASSIVE_COMPOSER_FIELD]: passiveComposerMessage.value
  }));
  const chatActivityMessages = computed(() => [
    screenActivityMessage.value,
    guidanceActivityMessage.value,
    responsePreviewActivityMessage.value
  ].filter(Boolean));
  const chatTimelineVisible = computed(() => true);
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
    selectedControlFields.value.map((field) => field.name).join("|"),
    chatActivityMessages.value.map((message) => [
      message.id,
      message.appearance,
      message.loading ? "loading" : "ready",
      message.text,
      message.title
    ].join(":")).join("|")
  ].join(":"));
  const githubBrokerConfirmation = computed(() => githubBrokerConfirmationState(props.session || {}));
  const workflowScreenControls = computed(() => currentStepWorkflowControls({
    actions: props.actions?.currentActions || [],
    interaction: stepInput.interaction,
    session: props.session
  }));
  const githubBrokerConfirmationSourceControl = computed(() => {
    const primaryId = String(primaryIntentId.value || "").trim();
    const controls = workflowScreenControls.value;
    return controls.find((control) => (
      String(control?.id || "").trim() === primaryId &&
      workflowControlSourceAction(control)
    )) || controls.find((control) => (
      String(control?.id || "").trim() === "talk_to_codex" &&
      workflowControlSourceAction(control)
    )) || null;
  });
  const githubBrokerConfirmationControl = computed(() => {
    return githubBrokerConfirmationWorkflowControl({
      codexSteerAvailable: codexSteerAvailable.value,
      confirmation: githubBrokerConfirmation.value,
      sourceControl: githubBrokerConfirmationSourceControl.value
    });
  });
  const allScreenControls = computed(() => {
    const controls = workflowScreenControls.value;
    return githubBrokerConfirmationControl.value
      ? [
          githubBrokerConfirmationControl.value,
          ...controls.filter((control) => control?.id !== githubBrokerConfirmationControl.value.id)
        ]
      : controls;
  });
  function controlIsGithubBrokerConfirmation(control = {}) {
    return Boolean(control?.githubBrokerConfirmation);
  }
  function controlCanSteerCodexTurn(control = {}) {
    const controlId = String(control?.id || "").trim();
    const primaryId = String(primaryIntentId.value || "").trim();
    const inputFields = Array.isArray(control?.inputFields) ? control.inputFields : [];
    return Boolean(
      codexSteerAvailable.value &&
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
    screenControls,
    selectedControl,
    selectedControlDisplayValues,
    selectedControlFields,
    selectedControlIsPrimary,
    selectedControlSubmissionFields,
    selectedControlUsesLatestAssistantQuestions,
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
  const composerDraftSync = useVibe64ComposerDraftSync({
    applyDraft(fields = {}) {
      const controlId = String(selectedControl.value?.id || "").trim();
      const control = allScreenControls.value.find((item) => item.id === controlId) || selectedControl.value;
      if (!control?.id) {
        return;
      }
      restoreControlDraft(control, fields);
    },
    applySubmissionRejected: applyRemoteComposerSubmissionRejected,
    applySubmissionStart: applyRemoteComposerSubmissionStart,
    enabled: computed(() => props.active !== false),
    projectSlug,
    selectedControl,
    selectedControlValues: selectedControlDisplayValues,
    sessionId,
    sessionsApiPath: props.sessionsApiPath
  });
  const selectedComposerControl = computed(() => {
    if (!selectedControlSteeringActive.value || !selectedControl.value) {
      return selectedControl.value;
    }
    return {
      ...selectedControl.value,
      label: "Steer",
      submitLabel: "Steer"
    };
  });
  const workflowButtonControls = computed(() => {
    return screenControls.value.map((control) => ({
      ...control,
      ...workflowControlButtonPresentation(control),
      disabled: controlDisabled(control),
      icon: controlIcon(control),
      loading: controlLoading(control),
      sourceControl: control
    }));
  });
  const selectedWorkflowButtonControls = computed(() => workflowControlsExceptSelected(
    workflowButtonControls.value,
    selectedControl.value
  ));
  const activeComposerWorkflowControls = computed(() => (
    codexStopVisible.value || codexHandoffPending.value ? [] : workflowButtonControls.value
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

  function sectionVisible(kind = "") {
    return screenSections.value.some((section) => section?.kind === kind);
  }

  function activityMessage({
    appearance = "activity",
    icon = "",
    id = "",
    label = "Vibe64",
    loading = false,
    text = "",
    title = "",
    tone = "info"
  } = {}) {
    const messageText = String(text || "").trim();
    const messageTitle = String(title || "").trim();
    if (!messageText && !messageTitle && loading !== true) {
      return null;
    }
    return {
      appearance,
      icon,
      id,
      label,
      loading: loading === true,
      text: messageText,
      title: messageTitle,
      tone
    };
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

  function controlForSelectedComposer() {
    const controlId = String(selectedControl.value?.id || "").trim();
    return allScreenControls.value.find((item) => item.id === controlId) || selectedControl.value;
  }

  function clearSelectedComposerDraft(control = controlForSelectedComposer()) {
    if (!control?.id || !Array.isArray(control.inputFields)) {
      return false;
    }
    restoreControlDraft(control, initialControlValues(control));
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
    return false;
  }

  function applyRemoteComposerSubmissionStart(fields = {}, payload = {}) {
    const text = String(payload?.text || "").trim();
    const control = controlForSelectedComposer();
    const submissionFields = normalizedDraftFields(fields);
    remoteComposerSubmission.value = {
      controlId: String(payload?.controlId || control?.id || ""),
      fields: submissionFields,
      status: "pending",
      text,
      updatedAt: String(payload?.updatedAt || "")
    };
    if (text && selectedComposerDraftText() === text) {
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
    const control = controlForSelectedComposer();
    const text = String(payload?.text || "").trim();
    if (
      optimisticComposerTurn.value?.remote === true &&
      (!text || optimisticComposerTurn.value.text === text)
    ) {
      optimisticComposerTurn.value = null;
    }
    remoteComposerSubmission.value = null;
    if (control?.id && Array.isArray(control.inputFields)) {
      restoreControlDraft(control, fields);
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
    composerDraftSync.publishSubmissionStart("conversationRequest", values, {
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
    composerDraftSync.publishDraftChange(name, selectedControlDisplayValues.value);
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
    composerDraftSync.publishSubmissionRejected("conversationRequest", optimistic.values, {
      text: optimistic.text
    });
    restoreControlDraft(optimistic.control, optimistic.values);
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
    return ["configure", "dashboard", "history", "preview", "run", "setup"].includes(value)
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

  function submitStepInputForm() {
    if (selectedStepInputControlVisible.value) {
      submitSelectedWorkflowControl();
      return;
    }
    if (stepInputHasWorkflowIntents.value) {
      return;
    }
    if (stepInput.interaction?.kind === "command_failure_response") {
      void submitCommandFailureResponse();
      return;
    }
    submitStepInput();
  }

  function tailCommandText(value = "") {
    const text = String(value || "");
    const maxLength = 12000;
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(text.length - maxLength);
  }

  async function submitStepInput() {
    await stepInput.submit();
  }

  async function submitCommandFailureResponse() {
    const saved = await stepInput.submit();
    if (saved) {
      await retry();
    }
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

  async function submitPassiveComposer() {
    if (!passiveComposerSteeringActive.value || passiveComposerSteerRunning.value) {
      return false;
    }
    const payload = passiveComposerSteerPayload(passiveComposerMessage.value);
    if (!payload) {
      return false;
    }
    passiveComposerSteerRunning.value = true;
    try {
      const steered = await props.steerCodexTurn(payload) !== false;
      if (steered) {
        passiveComposerMessage.value = "";
      }
      return steered;
    } catch {
      return false;
    } finally {
      passiveComposerSteerRunning.value = false;
    }
  }

  function updatePassiveComposer(name = "", value = "") {
    if (String(name || "") !== PASSIVE_COMPOSER_FIELD) {
      return false;
    }
    passiveComposerMessage.value = String(value || "");
    return true;
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
    if (controlIsGithubBrokerConfirmation(control)) {
      const confirmation = githubBrokerConfirmation.value;
      if (!confirmation.required || !confirmation.prompt) {
        return false;
      }
      const confirmationFields = {
        conversationRequest: confirmation.prompt
      };
      if (codexSteerAvailable.value) {
        return await props.steerCodexTurn({
          displayFields: confirmationFields,
          fields: confirmationFields,
          message: confirmation.prompt
        }) !== false;
      }
      const sourceAction = workflowControlSourceAction(control);
      if (!sourceAction) {
        clientControlError.value = "Ask Codex again before confirming this GitHub operation.";
        return false;
      }
      const response = await props.actions.runAction(sourceAction, {
        agentSettings: requestAgentSettings.value,
        displayInput: confirmationFields,
        input: confirmationFields
      });
      await nextTick();
      await runNextOperation();
      return response !== false;
    }
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
    if (controlIsGithubBrokerConfirmation(control)) {
      return !githubBrokerConfirmation.value.required || control.enabled !== true;
    }
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
    if (controlIsGithubBrokerConfirmation(control)) {
      return mdiGithub;
    }
    if (control.style === "primary") {
      return mdiCheck;
    }
    return mdiRefresh;
  }

  onMounted(emitBusyState);

  onBeforeUnmount(() => {
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
    Vibe64LaunchControls,
    Vibe64SessionDiffPanel,
    activateControl,
    activateWorkflowButtonControl,
    activeComposerWorkflowControls,
    activeSessionTool,
    artifactControlFormVisible,
    artifactWorkflowActionsVisible,
    backgroundTaskError,
    canSubmitSelectedControl,
    chatActivityMessages,
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
    composerInputLocked,
    composerVisible,
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
    passiveComposerSteeringActive,
    passiveComposerValues,
    passiveComposerVisible,
    recoverStuckStep,
    reportPreviewVisible,
    requestCodexInterrupt,
    requestCommandAiFix,
    resendOptimisticComposerTurn,
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
    selectedStepInputControlVisible,
    sessionId,
    sessionToolControls,
    sessionToolbarVisible,
    sessionToolsMenuOpen,
    sessionToolsVisible,
    statusActionsVisible,
    stepInput,
    stepInputActionHandlers,
    stepInputFormVisible,
    stepInputHasWorkflowIntents,
    stopCommandAction,
    stopScreenAction,
    stuckRecoveryAvailable,
    stuckRecoveryRunning,
    submitPassiveComposer,
    submitSelectedAnswerChoice,
    submitScreenComposerControl,
    submitSelectedWorkflowControl,
    submitStepInputForm,
    thinkingLabel,
    thinkingVisible,
    updateAgentSetting,
    updatePassiveComposer,
    updateSelectedControlValue,
    useFreeTextForAnswerChoice,
    visibleBackgroundTasks,
    workflowButtonControls,
    workflowExecuting
    };
}

export {
  useVibe64AutopilotView,
  vibe64AutopilotViewEmits,
  vibe64AutopilotViewProps
};
