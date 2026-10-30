import { cancelOwnsMessage, chatTurnsWithRouting, routedChatMessage, trackRoutedMessage } from "@/lib/vibe64ChatDelivery.js";
import { assistantRoutingRequestForDisplay, assistantRoutingStatusIsPending, assistantRoutingRequestCanBeReplaced } from "@local/vibe64-runtime/shared/assistantRouting";
import { computed, inject, ref, unref, watch } from "vue";
import { vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { useRouter } from "vue-router";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  chatMessagePayload,
  createChatMessageId
} from "@/lib/vibe64ChatMessage.js";
import { draftWithRestoredMessage, unmatchedOptimisticMessages } from "@jskit-ai/assistant-core/client/conversation-delivery";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { usePageActivity } from "@/lib/vibe64PageActivity.js";
import { useAssistantQuestions } from "@jskit-ai/assistant-core/client/conversation-questions";
import {
  latestAssistantMessageAwaitingUserReply
} from "@local/vibe64-runtime/shared/conversationQuestions";
import {
  projectAppPath
} from "@/lib/vibe64ProjectScope.js";
import {
  sessionGithubCommandActor
} from "@/lib/vibe64GitCommandActor.js";
import {
  defineVibe64AsyncComponent
} from "@/lib/vibe64AsyncComponent.js";
import {
  readLocalStorageJson,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";
import { vibe64RequestAccepted } from "@/lib/vibe64ApiResponses.js";
import {
  useVibe64Accounts
} from "@local/vibe64-accounts/client";
import {
  VIBE64_WELCOME_NAME_KEY
} from "@/lib/vibe64WelcomeName.js";
import { useVibe64SessionSaveWork } from "@/composables/useVibe64SessionSaveWork.js";
import { useVibe64SessionToolPane } from "@/composables/useVibe64SessionToolPane.js";
import { useVibe64TemporaryAiRepairs } from "@/composables/useVibe64TemporaryAiRepairs.js";
import { useVibe64WorkspaceSetupActivity } from "@/composables/useVibe64WorkspaceSetupActivity.js";

const EMPTY_CONVERSATION_WELCOME = "Hi! 👋 I’m excited to build something with you. Tell me what you have in mind—even a half-formed idea is perfect. We’ll shape it together.";
const EXISTING_PROJECT_CONVERSATION_WELCOME = "Hi! 👋 This is an existing project. Tell me what you’d like to change, check, or improve, and we’ll work through it together.";
const RENEWED_SESSION_CONVERSATION_WELCOME = "Hi! 👋 I’ve received the handover from the previous session and I’m ready to continue. Tell me what you’d like to do next.";
const NUMBERED_QUESTION_UNSURE_VALUE = "I am not sure";
const NUMBERED_QUESTION_UNSURE_CHOICE = Object.freeze({
  label: NUMBERED_QUESTION_UNSURE_VALUE,
  recommended: false,
  selectLabel: NUMBERED_QUESTION_UNSURE_VALUE,
  value: NUMBERED_QUESTION_UNSURE_VALUE
});
const EXECUTION_CAPACITY_ERROR_CODES = new Set([
  "vibe64_capacity_rejected"
]);
const EXECUTION_SAFETY_ERROR_CODES = new Set([
  "vibe64_codex_app_server_cleanup_required",
  "vibe64_codex_app_server_metadata_failed",
  "vibe64_codex_app_server_process_identity_unverified",
  "vibe64_codex_helper_runtime_cleanup_required",
  "vibe64_codex_helper_runtime_metadata_failed",
  "vibe64_execution_cleanup_required",
  "vibe64_execution_drain_failed",
  "vibe64_execution_ownership_unknown",
  "vibe64_managed_execution_provider_unavailable"
]);
const SHORT_ACTION_DISMISSALS_STORAGE_PREFIX = "vibe64:short-action-dismissals:v1";
const vibe64AutopilotViewEmits = [
  "busy-change",
  "chat-attention",
  "execution-attention",
  "project-attention"
];
const vibe64AutopilotViewProps = {
  active: {
    default: true,
    type: Boolean
  },
  agentConnectionError: {
    default: "",
    type: String
  },
  agentConnectionStatus: {
    default: "connected",
    type: String
  },
  retryAgentConnection: {
    default: () => {},
    type: Function
  },
  chatCollapsed: {
    default: false,
    type: Boolean
  },
  cancelAgentMessage: {
    default: async () => false,
    type: Function
  },
  conversationRuntime: { required: true, type: Object },
  conversationLog: {
    default: () => ({}),
    type: Object
  },
  githubActorTeleportTarget: {
    default: "",
    type: String
  },
  createSessionTeleportTarget: {
    default: "",
    type: String
  },
  interruptAgentTurn: {
    default: async () => false,
    type: Function
  },
  page: {
    default: () => ({}),
    type: Object
  },
  previewToolbarTeleportTarget: {
    default: "",
    type: String
  },
  usageRecordingTeleportTarget: {
    default: "",
    type: String
  },
  promptHintPolicy: {
    default: () => ({
      enabled: true,
      ready: false,
      revision: 0,
      version: 0
    }),
    type: Object
  },
  projectContext: {
    default: () => ({}),
    type: Object
  },
  projectPane: {
    default: "preview",
    type: String
  },
  refreshSessionData: {
    default: async () => null,
    type: Function
  },
  refreshSessionWork: {
    default: async () => null,
    type: Function
  },
  retryWorkspaceSetup: {
    default: async () => false,
    type: Function
  },
  saveSessionWork: {
    default: async () => false,
    type: Function
  },
  updateSessionWork: {
    default: async () => false,
    type: Function
  },
  sendAgentMessage: {
    default: async () => false,
    type: Function
  },
  session: {
    default: null,
    type: Object
  },
  sessionArchive: {
    default: () => ({}),
    type: Object
  },
  sessionRenewal: {
    default: () => ({}),
    type: Object
  },
  sessionSelectionArchived: {
    default: false,
    type: Boolean
  },
  sessionsApiPath: {
    default: "",
    type: [String, Object, Function]
  },
  sessionToolbar: {
    default: () => ({}),
    type: Object
  },
  workState: {
    default: () => ({}),
    type: Object
  }
};

function emptyConversationWelcomeText({
  existingProject = false,
  preferredName = "",
  renewedSession = false
} = {}) {
  const message = renewedSession
      ? RENEWED_SESSION_CONVERSATION_WELCOME
      : existingProject
        ? EXISTING_PROJECT_CONVERSATION_WELCOME
        : EMPTY_CONVERSATION_WELCOME;
  const name = normalizedAgentTurnText(preferredName);
  return name ? message.replace("Hi!", `Hi ${name}!`) : message;
}

function normalizedAgentTurnText(value = "") {
  return String(value || "").trim();
}

function agentConnectionThinkingLabel({
  active = false,
  status = "connected"
} = {}) {
  if (!active || ["connected", "failed", "restricted"].includes(status)) {
    return "";
  }
  if (status === "initializing") {
    return "Loading assistant…";
  }
  if (status === "disconnected") {
    return "Connection lost — assistant status unknown.";
  }
  return status === "reconciling"
    ? "Checking assistant status..."
    : "Assistant status could not be verified.";
}

// Per session, the Save/Update, workspace setup and checkpoint activities the
// person dismissed, kept in browser storage.
function useShortActionDismissals(projectSlug, sessionId) {
  const state = ref({
    saveWork: "",
    workspaceSetup: "",
    checkpoint: ""
  });
  const storageKey = computed(() => {
    const slug = normalizedAgentTurnText(projectSlug.value);
    const selectedSessionId = sessionId.value;
    return slug && selectedSessionId
      ? `${SHORT_ACTION_DISMISSALS_STORAGE_PREFIX}:${encodeURIComponent(slug)}:${encodeURIComponent(selectedSessionId)}`
      : "";
  });

  watch(storageKey, (key) => {
    const stored = readLocalStorageJson(key, {});
    state.value = {
      ...stored,
      saveWork: normalizedAgentTurnText(stored?.saveWork),
      workspaceSetup: normalizedAgentTurnText(stored?.workspaceSetup),
      checkpoint: normalizedAgentTurnText(stored?.checkpoint)
    };
  }, { flush: "sync", immediate: true });

  function dismiss(name, activityKey = "") {
    const key = normalizedAgentTurnText(activityKey);
    if (!key || !storageKey.value) {
      return false;
    }
    state.value = {
      ...readLocalStorageJson(storageKey.value, {}),
      ...state.value,
      // Save and Update can alternate; neither may forget a dismissed operation.
      ...(name === "saveWork" ? { [key]: true } : { [name]: key })
    };
    writeLocalStorageJson(storageKey.value, state.value);
    return true;
  }

  function clear(name) {
    state.value = { ...state.value, [name]: "" };
    if (storageKey.value) {
      writeLocalStorageJson(storageKey.value, state.value);
    }
  }

  // Shows one dismissed notice again, for the person who asks to see it.
  function restore(name, activityKey = "") {
    const key = normalizedAgentTurnText(activityKey);
    if (!key || !storageKey.value) {
      return false;
    }
    const { [key]: _dismissed, ...kept } = { ...readLocalStorageJson(storageKey.value, {}), ...state.value };
    state.value = { ...kept, ...(kept[name] === key ? { [name]: "" } : {}) };
    writeLocalStorageJson(storageKey.value, state.value);
    return true;
  }

  return { clear, dismiss, restore, state };
}

function useVibe64AutopilotView(props, emit, {
  assistantAccessLoading = null,
  assistantCanUseAi = null,
  assistantCanRouteChat = null,
  assistantCanUseFix = null,
  assistantCanUseNative = null,
  assistantProgressLabel = null,
  mainChatApprovals = null,
  onAttachmentsAccepted = null,
  requestTemporaryAi = null,
  temporaryAiWorkspace = null
} = {}) {
  const router = useRouter();
  const projectSlug = useVibe64ProjectSlug();
  const Vibe64OutputControls = defineVibe64AsyncComponent({
    label: "Launch controls",
    loader: () => import("@/components/studio/Vibe64OutputControls.vue"),
    minHeight: "10rem"
  });
  const agentSettings = computed(() => props.conversationRuntime?.agentSettings);
  const preferredName = inject(VIBE64_WELCOME_NAME_KEY, () => {
    const accounts = useVibe64Accounts();
    return computed(() => accounts.status.value?.personalProfile?.preferredName);
  }, true);
  const requestAgentSettings = computed(() => agentSettings.value?.requestSettings.value || null);
  const sessionId = computed(() => normalizedAgentTurnText(props.session?.sessionId));
  const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
  // What the person did here, for a lesson's do beats.
  const reportActivity = usePageActivity();
  const actorKey = computed(() => unref(viewer)?.actorKey || "");
  const assistantAccessConfigured = assistantCanUseAi !== null;
  const assistantAccessPending = computed(() => (
    assistantAccessConfigured && unref(assistantAccessLoading) === true
  ));
  const assistantDirectAllowed = computed(() => (
    !assistantAccessConfigured || unref(assistantCanUseAi) === true
  ));
  // Temporary AI repairs run on the Fix it with AI model.
  const assistantFixAllowed = computed(() => assistantCanUseFix === null
    ? assistantDirectAllowed.value : unref(assistantCanUseFix) === true);
  const sessionGithubActor = computed(() => sessionGithubCommandActor(props.session || {}));
  const sessionGithubActorHeaderVisible = computed(() => Boolean(
    props.active &&
    sessionGithubActor.value.available &&
    String(props.githubActorTeleportTarget || "").trim()
  ));
  const sessionSourceRoot = computed(() => String(props.session?.sourcePath || ""));
  const activeAgentTurn = computed(() => {
    const turn = props.session?.agentSession?.turn;
    return turn && typeof turn === "object" && !Array.isArray(turn) ? turn : {};
  });
  const agentActive = computed(() => activeAgentTurn.value.active === true);
  watch(agentActive, (active, was) => {
    if (was && !active) reportActivity("agent-finished", { projectSlug: projectSlug.value, sessionId: sessionId.value });
  });
  const agentObservationLost = computed(() => activeAgentTurn.value.status === "observation_lost");
  // The only source of the chat's working indicator: the server's live native
  // turn. Routing, sending, uncertain delivery and connection states have their
  // own labels and controls but can never show the assistant as working.
  const agentWorking = computed(() => agentActive.value && !agentObservationLost.value);
  const composerConnectionStatus = computed(() => !agentActive.value && unref(assistantCanRouteChat) === true &&
    ["restricted", "unavailable", "failed"].includes(props.agentConnectionStatus)
    ? "connected" : props.agentConnectionStatus);
  const agentNativeTurnReady = computed(() => Boolean(
    agentActive.value && !agentObservationLost.value &&
    normalizedAgentTurnText(activeAgentTurn.value.id) &&
    normalizedAgentTurnText(activeAgentTurn.value.state) === "active" &&
    props.agentConnectionStatus === "connected"
  ));
  const agentSteerable = computed(() => agentNativeTurnReady.value &&
    props.conversationRuntime?.steerable.value === true);
  const chatCollapsed = computed(() => Boolean(props.chatCollapsed));
  const sessionToolbarVisible = computed(() => Boolean(
    Array.isArray(props.sessionToolbar?.sessions) && props.sessionToolbar.sessions.length
  ));

  // A team member's main-chat messages go to the owner for approval.
  const approvalMode = computed(() => mainChatApprovals?.memberMode === true);
  const approvalOwner = computed(() => mainChatApprovals?.ownerName || "the owner");
  const approvalOwnerSentence = computed(() => approvalOwner.value.charAt(0).toUpperCase() + approvalOwner.value.slice(1));
  // A team member's lesson runs on a team AI, never the owner's personal plan.
  const lessonTeamAiLabel = computed(() => mainChatApprovals?.lessonTeamAi === true && props.session?.assistantSelection
    ? vibe64AssistantSelectionLabel(props.session.assistantSelection) : "");

  const composerKey = computed(() => JSON.stringify([actorKey.value, projectSlug.value, sessionId.value]));
  const composerDraft = computed({
    get: () => props.conversationRuntime?.draft.value || "",
    set: value => { if (props.conversationRuntime) props.conversationRuntime.draft.value = value; }
  });
  const composerAttachments = computed({
    get: () => props.conversationRuntime?.draftAttachments.value || [],
    set: value => { if (props.conversationRuntime) props.conversationRuntime.draftAttachments.value = value; }
  });
  const composerRetrySubmission = computed(() => props.conversationRuntime?.draftRetry.value || null);
  const messageDelivery = computed(() => props.conversationRuntime?.delivery || null);
  const composerSending = computed(() => messageDelivery.value?.state.sending === true);
  const composerQueueing = computed(() => props.conversationRuntime?.queueWhileSending.value === true);
  const composerStartupQueueing = computed(() => composerQueueing.value && composerSending.value &&
    activeAgentTurn.value.state === "starting" && !agentObservationLost.value);
  const composerSubmissionKind = ref("");
  const routingRequest = computed(() => assistantRoutingRequestForDisplay(props.session?.metadata));
  const routingBusy = computed(() => assistantRoutingStatusIsPending(routingRequest.value) &&
    !assistantRoutingRequestCanBeReplaced(routingRequest.value, props.session?.assistantSelection));
  const composerRoutingQueueing = computed(() => composerQueueing.value && composerSending.value &&
    Boolean(routingRequest.value?.messageId) &&
    messageDelivery.value?.find(routingRequest.value.messageId)?.status === "pending");
  function restoreCancelledMessage(messageId) {
    const message = messageDelivery.value?.find(messageId);
    if (!message || cancelOwnsMessage(message) ||
        !unmatchedOptimisticMessages(props.conversationLog?.turns, [message]).length) return;
    composerDraft.value = draftWithRestoredMessage(message.payload.draftSnapshot || message.text, composerDraft.value);
    messageDelivery.value?.remove(messageId);
  }
  const conversationFollowLatestKey = ref(0);
  const interrupting = ref(false);
  const contextFullFailure = ref(null);
  const previewAttachmentState = ref({
    attachDiagnostics: null,
    capture: null,
    captureAvailable: false,
    captureBusy: false,
    diagnosticsAvailable: false,
    diagnosticsBusy: false
  });
  let messageSequence = 0;

  const dismissals = useShortActionDismissals(projectSlug, sessionId);

  const checkpointTask = computed(() => (props.session?.backgroundTasks || [])
    .find((task) => task.id === "codex_turn_checkpoint" && task.status === "failed"));
  const checkpointFailure = computed(() => checkpointTask.value?.error || "");
  const checkpointFailureKey = computed(() => checkpointFailure.value ? JSON.stringify([
    checkpointTask.value.checkpointTurnId, checkpointTask.value.updatedAt, checkpointFailure.value
  ]) : "");
  const checkpointFailureVisible = computed(() => Boolean(checkpointFailure.value &&
    dismissals.state.value.checkpoint !== checkpointFailureKey.value));
  const checkpointFailureReason = computed(() => /\bSIG(?:TERM|KILL|INT)\b/u.test(checkpointFailure.value)
    ? "The snapshot command was interrupted."
    : "Vibe64 could not create a recovery snapshot for an assistant turn.");

  function dismissCheckpointFailure() {
    return dismissals.dismiss("checkpoint", checkpointFailureKey.value);
  }

  const questionState = useAssistantQuestions({
    message: () => latestAssistantMessageAwaitingUserReply(props.conversationLog),
    extraChoice: NUMBERED_QUESTION_UNSURE_CHOICE
  });
  const {
    answers: questionAnswers,
    choice: selectedAnswerChoice,
    questions: numberedQuestions,
    selectItems: numberedQuestionSelectItems,
    choices: answerChoices,
    active: structuredQuestionActive,
    dismiss: dismissNumberedQuestions
  } = questionState;

  const repositoryOperationActive = computed(() => [
    props.workState?.operation,
    props.workState?.updateOperation
  ].some((operation) => ["queued", "running", "starting"].includes(
    String(operation?.status || "").trim().toLowerCase()
  )));

  const sessionInteractionDisabled = computed(() => Boolean(
    !props.active ||
    !sessionId.value ||
    props.sessionSelectionArchived
  ));
  const composerDisabled = computed(() => Boolean(
    sessionInteractionDisabled.value ||
    !approvalMode.value && !assistantDirectAllowed.value
  ));
  // Messages for approval are text only.
  const composerAttachmentsSupported = computed(() => !approvalMode.value);
  const composerAttachmentsEnabled = computed(() => Boolean(
    composerAttachmentsSupported.value &&
    !composerDisabled.value &&
    !composerSending.value &&
    !interrupting.value &&
    (!agentActive.value || agentSteerable.value) &&
    !repositoryOperationActive.value
  ));
  const composerRetryMatchesDraft = computed(() => props.conversationRuntime?.draftRetryMatches.value === true);
  const composerSubmitMode = computed(() => {
    if (approvalMode.value) return mainChatApprovals.sending ? "approval-sending" : "approval";
    if (assistantAccountUnavailable.value) {
      return "unavailable";
    }
    if (composerConnectionStatus.value === "initializing") {
      return "initializing";
    }
    if (composerConnectionStatus.value === "failed") {
      return "failed";
    }
    if (composerConnectionStatus.value !== "connected") {
      return "reconnecting";
    }
    if (routingBusy.value && !agentActive.value && !composerRoutingQueueing.value) return "routing";
    if (agentActive.value && (!agentNativeTurnReady.value && !composerStartupQueueing.value || !agentSteerable.value && !composerQueueing.value)) {
      return "waiting";
    }
    if (composerSending.value && !composerQueueing.value) {
      return composerSubmissionKind.value === "steer" ? "steering" : "sending";
    }
    if (agentSteerable.value) {
      return composerRetryMatchesDraft.value ? "retry" : "steer";
    }
    return composerRetryMatchesDraft.value ? "retry" : "send";
  });
  const composerSubmitAriaLabel = computed(() => ({
    approval: `Send to ${approvalOwner.value} for approval`,
    "approval-sending": `Sending to ${approvalOwner.value} for approval`,
    routing: "Preparing the message recipient",
    failed: "Assistant unavailable",
    unavailable: "Connect your AI account to send messages",
    initializing: "Waiting for the assistant to load",
    reconnecting: "Waiting for the connection to recover",
    retry: "Retry guidance to assistant",
    sending: "Sending message",
    steer: "Steer assistant",
    steering: "Sending guidance to assistant",
    waiting: "Waiting for the assistant to accept guidance"
  })[composerSubmitMode.value] || "Send message");
  const composerSubmitTitle = computed(() => ({
    approval: `${approvalOwnerSentence.value} approves each message before it reaches main chat`,
    "approval-sending": "Keep typing while this message is sent for approval",
    routing: "Keep typing while this request is routed",
    failed: "Resolve the assistant startup error, then retry. Your draft is kept.",
    unavailable: "Go to AI Accounts to connect your assistant. Your draft is kept.",
    initializing: "Keep typing while the assistant loads",
    reconnecting: "Your draft is kept while the connection recovers",
    retry: "Retry the same guidance without duplicating it",
    sending: "Keep typing while this message is sent",
    steer: "Send this guidance to the active assistant turn",
    steering: "Keep typing while this guidance is sent",
    waiting: "Keep typing while the assistant becomes ready"
  })[composerSubmitMode.value] || "Send message");
  const composerCanSubmit = computed(() => {
    if (approvalMode.value) return !composerDisabled.value && !mainChatApprovals.sending && Boolean(composerDraft.value.trim());
    if (!props.conversationRuntime?.canSubmit.value || composerDisabled.value ||
        routingBusy.value && !agentSteerable.value && !composerRoutingQueueing.value) return false;
    if (
      composerConnectionStatus.value !== "connected" ||
      (composerSending.value && !composerQueueing.value) ||
      interrupting.value ||
      repositoryOperationActive.value ||
      (agentActive.value && (!agentNativeTurnReady.value && !composerStartupQueueing.value ||
        !agentSteerable.value && (!composerQueueing.value || composerAttachments.value.length > 0)))
    ) {
      return false;
    }
    if (numberedQuestions.value.length) {
      return numberedQuestions.value.every((question) => String(questionAnswers.value[question.name] || "").trim());
    }
    return Boolean(
      (answerChoices.value.length && selectedAnswerChoice.value) || composerDraft.value.trim()
    );
  });
  const agentStopVisible = computed(() => agentActive.value || routingBusy.value);
  const agentStopEnabled = computed(() => Boolean(
    agentStopVisible.value &&
    !interrupting.value &&
    (!composerSending.value || routingBusy.value || !agentSteerable.value && composerQueueing.value)
  ));
  const assistantConnectionReady = computed(() => composerConnectionStatus.value === "connected");
  const reasoningActive = computed(() => assistantConnectionReady.value && agentActive.value &&
    !agentObservationLost.value && activeAgentTurn.value.phase === "reasoning");
  const assistantAccountUnavailable = computed(() => composerConnectionStatus.value === "unavailable");
  // The server's access check names the account the selection needs, as AI
  // Accounts names it; the generic text covers a refusal that carried no message.
  const assistantAccountMessage = computed(() => props.agentConnectionError ||
    "The selected AI account or model is unavailable. Check AI Accounts or choose another model.");
  const connectionRecoveryVisible = computed(() => (
    !sessionInteractionDisabled.value &&
    ["disconnected", "unknown", "reconciling", "unavailable", "failed"].includes(composerConnectionStatus.value)
  ));
  const thinkingVisible = computed(() => Boolean(
    !assistantAccountUnavailable.value && (
      agentActive.value || composerSending.value ||
      (!assistantConnectionReady.value && !["failed", "restricted"].includes(composerConnectionStatus.value) && !sessionInteractionDisabled.value)
    )
  ));
  const thinkingLabel = computed(() => (
    (agentObservationLost.value && agentActive.value ? "Assistant stop not yet confirmed" : "") ||
    agentConnectionThinkingLabel({
      active: !sessionInteractionDisabled.value,
      status: composerConnectionStatus.value
    }) ||
    (agentActive.value && activeAgentTurn.value.phase === "compacting" ? "Compacting conversation context…" : "") ||
    (agentActive.value && activeAgentTurn.value.phase === "background" ? "Reply ready · background task still running…" : "") ||
    (unref(props.conversationRuntime?.phase) === "compacting" ? "Summarising the assistant's memory before sending…" : "") ||
    (agentActive.value ? unref(assistantProgressLabel) : "") ||
    (agentActive.value ? "Assistant is working..." : "") ||
    (composerSending.value ? "Sending to assistant..." : "")
  ));
  const composerHint = computed(() => approvalMode.value
    ? `Main chat runs on ${approvalOwner.value}'s AI. ${approvalOwnerSentence.value} approves each message.` : (
    lessonTeamAiLabel.value ? `This lesson runs on the team AI: ${lessonTeamAiLabel.value}. Only you see this chat.` :
    agentObservationLost.value
      ? agentActive.value
        ? "The stop is not yet confirmed. Your draft is kept; you can retry Stop."
        : "The assistant stopped because its progress could not be tracked. Send a message to continue."
      : structuredQuestionActive.value
      ? "Answer the assistant, then send one combined reply."
      : ""
  ));
  const composerPlaceholder = computed(() => approvalMode.value
    ? `Message main chat — ${approvalOwner.value} approves before it's sent` : (
    lessonTeamAiLabel.value ? `Message your lesson's AI — ${lessonTeamAiLabel.value} (team AI)` :
    numberedQuestions.value.length
      ? "Optional additional context…"
      : answerChoices.value.length
        ? "Choose an answer above, or type another answer…"
        : ""
  ));

  const saveWork = useVibe64SessionSaveWork(props, {
    actorKey,
    agentActive,
    composerSending,
    dismissals,
    projectSlug,
    reportActivity,
    repositoryOperationActive,
    sessionId,
    sessionInteractionDisabled
  });
  const workspaceSetupActivity = useVibe64WorkspaceSetupActivity(props, {
    actorKey,
    dismissals,
    projectSlug,
    retryBlocked: computed(() => Boolean(
      repositoryOperationActive.value ||
      saveWork.saveWorkSending.value ||
      saveWork.saveWorkOperationActive.value ||
      agentActive.value
    )),
    sessionId
  });
  const temporaryAiRepairs = useVibe64TemporaryAiRepairs(props, {
    actorKey,
    assistantFixAllowed,
    projectSlug,
    repositoryOperationActive,
    requestTemporaryAi,
    saveWork,
    sessionId,
    temporaryAiWorkspace,
    workspaceSetupActivity
  });

  function updateComposerAttachments(attachments = []) {
    composerAttachments.value = Array.isArray(attachments) ? attachments : [];
  }

  function updatePreviewAttachmentState(state = {}) {
    previewAttachmentState.value = {
      attachDiagnostics: typeof state.attachDiagnostics === "function" ? state.attachDiagnostics : null,
      capture: typeof state.capture === "function" ? state.capture : null,
      captureAvailable: state.captureAvailable === true,
      captureBusy: state.captureBusy === true,
      diagnosticsAvailable: state.diagnosticsAvailable === true,
      diagnosticsBusy: state.diagnosticsBusy === true
    };
  }

  function captureVisiblePreview() {
    return previewAttachmentState.value.capture?.() ?? false;
  }

  function attachPreviewDiagnostics() {
    return previewAttachmentState.value.attachDiagnostics?.() ?? false;
  }

  function nextMessageId() {
    messageSequence += 1;
    return createChatMessageId({
      sequence: messageSequence
    });
  }

  function settleComposerRetry(retry = composerRetrySubmission.value) {
    return props.conversationRuntime?.settleDraftRetry(retry) ?? false;
  }

  async function sendChatPayload(payload = {}, {
    messageId: existingMessageId = "",
    submissionKind = "send",
    composer = false,
    questionText = ""
  } = {}) {
    if (!props.conversationRuntime?.canSubmit.value || (composerSending.value && !composerQueueing.value) ||
      !normalizedAgentTurnText(payload?.message)) {
      return false;
    }
    const messageId = String(existingMessageId || "").trim() || nextMessageId();
    const sendingSessionId = sessionId.value;
    const sendingProjectSlug = projectSlug.value;
    const sendingActorKey = actorKey.value;
    composerSubmissionKind.value = submissionKind === "steer" ? "steer" : "send";
    try {
      const response = await props.conversationRuntime[composer ? "submitDraft" : "send"]({
        ...payload,
        agentSettings: Object.hasOwn(payload, "agentSettings") ? payload.agentSettings : requestAgentSettings.value || null
      }, { messageId, submissionKind, ...(composer ? { questionText } : {}) });
      if (sessionId.value !== sendingSessionId || projectSlug.value !== sendingProjectSlug || actorKey.value !== sendingActorKey) {
        return false;
      }
      const accepted = vibe64RequestAccepted(response);
      if (accepted) {
        conversationFollowLatestKey.value += 1;
        reportActivity("message-sent", { projectSlug: sendingProjectSlug, sessionId: sendingSessionId });
      }
      if (accepted && payload.attachmentIds?.length) {
        onAttachmentsAccepted?.(payload.attachmentIds);
      }
      return accepted;
    } catch (error) {
      if (sessionId.value !== sendingSessionId || projectSlug.value !== sendingProjectSlug || actorKey.value !== sendingActorKey) {
        return false;
      }
      if (error?.code === "vibe64_assistant_routing_cancelled") {
        restoreCancelledMessage(messageId);
        return false;
      }
      const message = normalizedAgentTurnText(error?.message || error) || "Message could not be sent.";
      if (error?.code === "vibe64_assistant_context_full") {
        contextFullFailure.value = { message, payload, options: { messageId, submissionKind, composer, questionText } };
      }
      const attention = executionAttentionForError(error, message);
      if (attention) {
        emit("execution-attention", attention);
      }
      return false;
    } finally {
      if (sessionId.value === sendingSessionId && projectSlug.value === sendingProjectSlug && actorKey.value === sendingActorKey && !composerSending.value) {
        composerSubmissionKind.value = "";
      }
    }
  }

  // A lesson beat's Do it for me: its quoted prompt, sent as the learner's
  // next Main chat message and stored as sent by the lesson.
  function sendLessonMessage(text) {
    return sendChatPayload({ message: String(text || ""), messageSource: "lesson" });
  }

  function retryContextFull() {
    const failure = contextFullFailure.value;
    contextFullFailure.value = null;
    return failure ? sendChatPayload(failure.payload, failure.options) : false;
  }

  async function submitComposerMessage() {
    if (!composerCanSubmit.value) return false;
    if (approvalMode.value) {
      const message = composerDraft.value;
      if (!await mainChatApprovals.send(message)) return false;
      if (composerDraft.value === message) composerDraft.value = "";
      return true;
    }
    const retry = composerRetryMatchesDraft.value ? composerRetrySubmission.value : null;
    const draftSnapshot = retry?.draftSnapshot || composerDraft.value;
    const { message, questionText } = questionState.capture(draftSnapshot);
    const payload = retry?.payload || chatMessagePayload(message, composerAttachments.value);
    if (!payload) return false;
    const submissionKind = retry?.submissionKind || (agentSteerable.value ? "steer" : "send");
    const questionTextSnapshot = retry?.questionTextSnapshot || questionText;
    const messageId = retry?.messageId || nextMessageId();
    questionState.markSubmitted(questionTextSnapshot);
    return sendChatPayload(payload, { messageId, submissionKind, composer: true, questionText: questionTextSnapshot });
  }

  function optimisticMessageById(messageId = "") {
    const request = routingRequest.value;
    const local = messageDelivery.value?.find(messageId);
    return (request?.messageId === messageId && routedChatMessage(request, local)) || local;
  }

  // Cancel means cancel, and the server decides: the message stays, shown as
  // Cancelling…, until the server records the cancel, which also stops its
  // route and any turn it started. When the server cannot be reached the
  // message stays with Cancel again. Accepted history remains the transcript's.
  async function cancelOptimisticMessage(messageId = "") {
    const message = optimisticMessageById(messageId);
    if (!message || message.status === "accepted") return false;
    trackRoutedMessage(messageDelivery.value, message, props.conversationLog?.turns);
    if (await props.cancelAgentMessage(messageId) !== true) return false;
    if (composerRetrySubmission.value?.messageId === messageId) settleComposerRetry(composerRetrySubmission.value);
    return true;
  }

  async function editOptimisticMessage(messageId = "") {
    const message = optimisticMessageById(messageId);
    if (!message || message.status !== "failed") {
      return false;
    }
    if (!await cancelOptimisticMessage(messageId)) return false;
    composerDraft.value = draftWithRestoredMessage(message.text, String(composerDraft.value || ""));
    return true;
  }

  async function resendOptimisticMessage(messageId = "") {
    const message = optimisticMessageById(messageId);
    if (!message || message.checking || !["failed", "uncertain"].includes(message.status)) {
      return false;
    }
    const retry = composerRetrySubmission.value?.messageId === messageId
      ? composerRetrySubmission.value
      : null;
    if (message.status === "uncertain") {
      const receipt = await props.conversationRuntime.inspectDelivery(messageId);
      if (receipt?.status === "accepted") {
        settleComposerRetry(retry);
        return true;
      }
      // Only the server's proof that the message was never sent lets Retry send it again.
      if (receipt?.status !== "not-sent" && routingRequest.value?.messageId === messageId &&
          routingRequest.value?.delivery === "failed") return false;
    }
    // Retry through the original coordinator with the same identity and payload.
    // A missing route is not a receipt: the coordinator owns duplicate detection
    // and recovery of any native dispatch that was already attempted.
    messageDelivery.value?.remove(messageId);
    const accepted = await sendChatPayload(message.payload, {
      messageId,
      submissionKind: retry?.submissionKind || (agentSteerable.value ? "steer" : "send")
    });
    if (accepted) {
      settleComposerRetry(retry);
    } else if (!messageDelivery.value?.find(messageId)) {
      messageDelivery.value?.state.messages.push(message);
    }
    return accepted;
  }

  async function requestAgentInterrupt() {
    if (!agentStopEnabled.value) {
      return false;
    }
    const stoppingSessionId = sessionId.value;
    const stoppingProjectSlug = projectSlug.value;
    const stoppingTurnId = normalizedAgentTurnText(activeAgentTurn.value.id);
    interrupting.value = true;
    let acknowledgeStop;
    const receipt = new Promise((resolve) => { acknowledgeStop = resolve; });
    const stopWatchingReceipt = watch(
      [sessionId, projectSlug, () => activeAgentTurn.value.id, () => activeAgentTurn.value.active],
      ([currentSessionId, currentProjectSlug, turnId, active]) => {
        if (currentSessionId !== stoppingSessionId || currentProjectSlug !== stoppingProjectSlug) {
          acknowledgeStop(false);
        } else if (stoppingTurnId && normalizedAgentTurnText(turnId) === stoppingTurnId && active === false) {
          acknowledgeStop(true);
        }
      }
    );
    try {
      return await Promise.race([
        props.interruptAgentTurn({ reason: "user_interrupt" }),
        receipt
      ]) !== false;
    } finally {
      stopWatchingReceipt();
      if (sessionId.value === stoppingSessionId && projectSlug.value === stoppingProjectSlug) {
        interrupting.value = false;
      }
    }
  }

  const chatTurns = computed(() => {
    // Hydrate history before appending a restored unsent request to its tail.
    if (!messageDelivery.value || props.conversationLog?.initializing) return [];
    return chatTurnsWithRouting(
      messageDelivery.value.turns(Array.isArray(props.conversationLog?.turns) ? props.conversationLog.turns : []),
      routingRequest.value,
      composerSending.value
    );
  });
  const emptyConversationWelcome = computed(() => (
    sessionId.value &&
    !props.conversationLog?.loading &&
    !props.conversationLog?.error &&
    !chatTurns.value.length
      ? emptyConversationWelcomeText({
          existingProject: workspaceSetupActivity.workspaceSetupStatus.value !== "unconfigured",
          preferredName: preferredName.value,
          renewedSession: Boolean(normalizedAgentTurnText(
            props.session?.metadata?.renewed_from
          ))
        })
      : ""
  ));
  const conversationLogVisible = computed(() => Boolean(props.active));
  const conversationScrollKey = computed(() => sessionId.value);
  const chatReloading = ref(false);
  const chatReloadAvailable = computed(() => Boolean(
    props.active && props.session && (
      typeof props.refreshSessionData === "function" ||
      typeof props.conversationLog?.reload === "function"
    )
  ));

  async function reloadChatPane() {
    if (!chatReloadAvailable.value || chatReloading.value) {
      return false;
    }
    chatReloading.value = true;
    try {
      await Promise.allSettled([
        props.refreshSessionData?.(),
        props.conversationLog?.reload?.()
      ]);
      return true;
    } finally {
      chatReloading.value = false;
    }
  }

  async function loadMoreChatTurns(request = {}) {
    return typeof props.conversationLog?.loadMore === "function"
      ? props.conversationLog.loadMore(request)
      : false;
  }

  const sessionToolPane = useVibe64SessionToolPane(props, emit, {
    actorKey,
    assistantAccessPending,
    assistantCanUseNative,
    assistantDirectAllowed,
    projectSlug,
    requestSaveWork: saveWork.requestSaveWork,
    sessionId,
    sessionSourceRoot
  });

  // A conversation's integration request acts only in the active, selected session.
  function integrationRequestAllowed(request) {
    return Boolean(props.active && !props.sessionSelectionArchived && request.sessionId === sessionId.value);
  }

  // `action` is connect, check, cancel, skip or resume.
  function runIntegrationRequest({ action, ...request }) {
    if (!integrationRequestAllowed(request)) return false;
    return props.conversationLog?.[`${action}IntegrationRequest`]?.(request) || false;
  }

  function openIntegrationRequest(request) {
    if (!integrationRequestAllowed(request)) return;
    void router.push({
      path: projectAppPath(projectSlug.value, "/dashboard/integrations"),
      query: { integration: request.integrationId, integrationSession: sessionId.value, integrationTurn: request.turnId, integrationRequest: request.requestId }
    });
    emit("project-attention");
  }

  const assistantDraftAvailable = computed(() => Boolean(
    props.active &&
    sessionId.value &&
    !props.sessionSelectionArchived &&
    assistantDirectAllowed.value
  ));

  function prefillComposer(text = "", { append = false } = {}) {
    const prompt = normalizedAgentTurnText(text);
    if (!prompt || !assistantDraftAvailable.value) {
      return false;
    }
    composerDraft.value = append && composerDraft.value.trim()
      ? `${composerDraft.value}\n\n${prompt}` : prompt;
    emit(append ? "chat-attention" : "project-attention");
    return true;
  }

  function askAssistantAboutFile(path = "") {
    const normalizedPath = normalizedAgentTurnText(path);
    return normalizedPath
      ? prefillComposer(`Please look at \`${normalizedPath}\` and help me with this file.`)
      : false;
  }

  watch([sessionId, projectSlug, actorKey], () => {
    composerSubmissionKind.value = "";
    interrupting.value = false;
    questionState.reset();
  });

  watch([routingRequest, () => messageDelivery.value?.state.messages || []], ([request]) => {
    if (request?.stopped && !request.cancelled && !request.helper && !request.attemptedMessageId) {
      restoreCancelledMessage(request.messageId);
    }
  }, { immediate: true });

  watch(() => Boolean(
    agentActive.value ||
    composerSending.value ||
    interrupting.value ||
    saveWork.saveWorkSending.value
  ), (busy) => {
    emit("busy-change", busy);
  }, { immediate: true });

  return {
    ...saveWork,
    ...workspaceSetupActivity,
    ...temporaryAiRepairs,
    ...sessionToolPane,
    Vibe64OutputControls,
    sendLessonMessage,
    assistantDirectAllowed,
    assistantFixAllowed,
    agentActive,
    reasoningActive,
    agentObservationLost,
    agentStopEnabled,
    agentStopVisible,
    answerChoices,
    prefillComposer,
    askAssistantAboutFile,
    attachPreviewDiagnostics,
    cancelOptimisticMessage,
    captureVisiblePreview,
    chatCollapsed,
    chatReloading,
    chatTurns,
    checkpointFailure,
    checkpointFailureReason,
    checkpointFailureVisible,
    dismissCheckpointFailure,
    approvalMode,
    composerKey,
    composerAttachments,
    composerAttachmentsEnabled,
    composerAttachmentsSupported,
    composerCanSubmit,
    composerDisabled,
    composerDraft,
    composerHint,
    composerPlaceholder,
    composerSending,
    routingRequest,
    routingBusy,
    composerSubmitAriaLabel,
    composerSubmitMode,
    composerSubmitTitle,
    conversationLogVisible,
    conversationFollowLatestKey,
    conversationScrollKey,
    dismissNumberedQuestions,
    editOptimisticMessage,
    emptyConversationWelcome,
    interrupting,
    loadMoreChatTurns,
    numberedQuestionSelectItems,
    numberedQuestions,
    openIntegrationRequest,
    runIntegrationRequest,
    previewAttachmentState,
    projectSlug,
    questionAnswers,
    reloadChatPane,
    repositoryOperationActive,
    resendOptimisticMessage,
    requestAgentInterrupt,
    contextFullFailure,
    retryContextFull,
    sessionId,
    sessionGithubActor,
    sessionGithubActorHeaderVisible,
    sessionSourceRoot,
    sessionToolbarVisible,
    selectedAnswerChoice,
    assistantDraftAvailable,
    structuredQuestionActive,
    submitComposerMessage,
    thinkingLabel,
    thinkingVisible,
    agentWorking,
    assistantAccountMessage,
    assistantAccountUnavailable,
    connectionRecoveryVisible,
    updateComposerAttachments,
    updatePreviewAttachmentState
  };
}

function executionAttentionForError(error = null, message = "") {
  const code = normalizedAgentTurnText(error?.code);
  const category = EXECUTION_CAPACITY_ERROR_CODES.has(code)
    ? "capacity"
    : EXECUTION_SAFETY_ERROR_CODES.has(code)
      ? "ownership"
      : "";
  if (!category) {
    return null;
  }
  return Object.freeze({
    category,
    code,
    message: normalizedAgentTurnText(message) || "This work could not start safely."
  });
}

export {
  emptyConversationWelcomeText,
  agentConnectionThinkingLabel,
  useVibe64AutopilotView,
  vibe64AutopilotViewEmits,
  vibe64AutopilotViewProps
};
