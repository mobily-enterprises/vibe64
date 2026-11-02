import { assistantRoutingRequestForDisplay, assistantRoutingStatusIsPending, assistantRoutingRequestCanBeReplaced } from "@local/vibe64-runtime/shared/assistantRouting";
import { computed, inject, ref, unref, watch } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { useRouter } from "vue-router";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
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
  useVibe64Accounts
} from "@local/vibe64-accounts/client";
import {
  VIBE64_WELCOME_NAME_KEY
} from "@/lib/vibe64WelcomeName.js";
import { useVibe64AgentTurnState } from "@/composables/useVibe64AgentTurnState.js";
import { emptyConversationWelcomeText, useVibe64AutopilotChatPane } from "@/composables/useVibe64AutopilotChatPane.js";
import { useVibe64MainChatDelivery } from "@/composables/useVibe64MainChatDelivery.js";
import { useVibe64SessionSaveWork } from "@/composables/useVibe64SessionSaveWork.js";
import { useVibe64SessionToolPane } from "@/composables/useVibe64SessionToolPane.js";
import { useVibe64ShortActionDismissals } from "@/composables/useVibe64ShortActionDismissals.js";
import { useVibe64TemporaryAiRepairs } from "@/composables/useVibe64TemporaryAiRepairs.js";
import { useVibe64WorkspaceSetupActivity } from "@/composables/useVibe64WorkspaceSetupActivity.js";

const NUMBERED_QUESTION_UNSURE_VALUE = "I am not sure";
const NUMBERED_QUESTION_UNSURE_CHOICE = Object.freeze({
  label: NUMBERED_QUESTION_UNSURE_VALUE,
  recommended: false,
  selectLabel: NUMBERED_QUESTION_UNSURE_VALUE,
  value: NUMBERED_QUESTION_UNSURE_VALUE
});

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
  const sessionId = computed(() => normalizeText(props.session?.sessionId));
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
  const {
    activeAgentTurn,
    agentActive,
    agentNativeTurnReady,
    agentObservationLost,
    agentSteerable,
    agentWorking,
    assistantAccountMessage,
    assistantAccountUnavailable,
    assistantConnectionReady,
    composerConnectionStatus,
    reasoningActive
  } = useVibe64AgentTurnState(props, { assistantCanRouteChat, projectSlug, reportActivity, sessionId });
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
  const interrupting = ref(false);
  const previewAttachmentState = ref({
    attachDiagnostics: null,
    capture: null,
    captureAvailable: false,
    captureBusy: false,
    diagnosticsAvailable: false,
    diagnosticsBusy: false
  });

  const dismissals = useVibe64ShortActionDismissals(projectSlug, sessionId);

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
  async function requestAgentInterrupt() {
    if (!agentStopEnabled.value) {
      return false;
    }
    const stoppingSessionId = sessionId.value;
    const stoppingProjectSlug = projectSlug.value;
    const stoppingTurnId = normalizeText(activeAgentTurn.value.id);
    interrupting.value = true;
    let acknowledgeStop;
    const receipt = new Promise((resolve) => { acknowledgeStop = resolve; });
    const stopWatchingReceipt = watch(
      [sessionId, projectSlug, () => activeAgentTurn.value.id, () => activeAgentTurn.value.active],
      ([currentSessionId, currentProjectSlug, turnId, active]) => {
        if (currentSessionId !== stoppingSessionId || currentProjectSlug !== stoppingProjectSlug) {
          acknowledgeStop(false);
        } else if (stoppingTurnId && normalizeText(turnId) === stoppingTurnId && active === false) {
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

  const chatPane = useVibe64AutopilotChatPane(props, {
    composerSending,
    messageDelivery,
    preferredName,
    routingRequest,
    sessionId,
    workspaceSetupStatus: workspaceSetupActivity.workspaceSetupStatus
  });

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
    const prompt = normalizeText(text);
    if (!prompt || !assistantDraftAvailable.value) {
      return false;
    }
    composerDraft.value = append && composerDraft.value.trim()
      ? `${composerDraft.value}\n\n${prompt}` : prompt;
    emit(append ? "chat-attention" : "project-attention");
    return true;
  }

  function askAssistantAboutFile(path = "") {
    const normalizedPath = normalizeText(path);
    return normalizedPath
      ? prefillComposer(`Please look at \`${normalizedPath}\` and help me with this file.`)
      : false;
  }

  watch([sessionId, projectSlug, actorKey], () => {
    composerSubmissionKind.value = "";
    interrupting.value = false;
    questionState.reset();
  });

  const delivery = useVibe64MainChatDelivery(props, emit, {
    actorKey,
    agentSteerable,
    approvalMode,
    composerAttachments,
    composerCanSubmit,
    composerDraft,
    composerQueueing,
    composerRetryMatchesDraft,
    composerRetrySubmission,
    composerSending,
    composerSubmissionKind,
    mainChatApprovals,
    messageDelivery,
    onAttachmentsAccepted,
    projectSlug,
    questionState,
    reportActivity,
    requestAgentSettings,
    routingRequest,
    sessionId
  });


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
    ...chatPane,
    ...delivery,
    Vibe64OutputControls,
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
    captureVisiblePreview,
    chatCollapsed,
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
    dismissNumberedQuestions,
    interrupting,
    numberedQuestionSelectItems,
    numberedQuestions,
    openIntegrationRequest,
    runIntegrationRequest,
    previewAttachmentState,
    projectSlug,
    questionAnswers,
    repositoryOperationActive,
    requestAgentInterrupt,
    sessionId,
    sessionGithubActor,
    sessionGithubActorHeaderVisible,
    sessionSourceRoot,
    sessionToolbarVisible,
    selectedAnswerChoice,
    assistantDraftAvailable,
    structuredQuestionActive,
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

export {
  emptyConversationWelcomeText,
  agentConnectionThinkingLabel,
  useVibe64AutopilotView
};
