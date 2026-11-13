import { ref, watch } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { cancelOwnsMessage, routedChatMessage, trackRoutedMessage } from "@/lib/vibe64ChatDelivery.js";
import { chatMessagePayload, createChatMessageId } from "@/lib/vibe64ChatMessage.js";
import { draftWithRestoredMessage, unmatchedOptimisticMessages } from "@jskit-ai/assistant-core/client/conversation-delivery";
import { vibe64RequestAccepted } from "@/lib/vibe64ApiResponses.js";

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

// A sent message's files travel with it: they leave the composer with its
// words, so nothing there can remove a file the message uses, and they come
// back only with its words.
function takeSentAttachments(draftAttachments, payload) {
  const sent = payload.attachmentIds || [];
  if (sent.length) draftAttachments.value = draftAttachments.value.filter(file => !sent.includes(file.attachmentId));
}

function returnSentAttachments(draftAttachments, payload) {
  const kept = draftAttachments.value;
  const returned = (payload?.displayAttachments || []).filter(file => file.attachmentId &&
    !kept.some(saved => saved.attachmentId === file.attachmentId));
  if (returned.length) draftAttachments.value = [...returned, ...kept];
}

function executionAttentionForError(error = null, message = "") {
  const code = normalizeText(error?.code);
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
    message: normalizeText(message) || "This work could not start safely."
  });
}

/**
 * Main chat delivery: sending the composer's message or a lesson's prompt,
 * retrying after a full context, and cancelling, editing or resending a
 * message the server has not accepted.
 * @param {Record<string, any>} props The Autopilot view's props.
 * @param {(event: string, ...args: any[]) => void} emit The Autopilot view's emit.
 * @param {{
 *   actorKey: import("vue").Ref<string>,
 *   agentSteerable: import("vue").Ref<boolean>,
 *   approvalMode: import("vue").Ref<boolean>,
 *   composerAttachments: import("vue").Ref<Array<Record<string, any>>>,
 *   composerCanSubmit: import("vue").Ref<boolean>,
 *   composerDraft: import("vue").Ref<string>,
 *   composerQueueing: import("vue").Ref<boolean>,
 *   composerRetryMatchesDraft: import("vue").Ref<boolean>,
 *   composerRetrySubmission: import("vue").Ref<Record<string, any> | null>,
 *   composerSending: import("vue").Ref<boolean>,
 *   composerSubmissionKind: import("vue").Ref<string>,
 *   mainChatApprovals: import("@/types.js").Vibe64MainChatApprovals | null,
 *   messageDelivery: import("vue").Ref<Record<string, any> | null>,
 *   projectSlug: import("vue").Ref<string>,
 *   questionState: Record<string, any>,
 *   reportActivity: ReturnType<typeof import("@/lib/vibe64PageActivity.js").usePageActivity>,
 *   requestAgentSettings: import("vue").Ref<Record<string, any> | null>,
 *   routingRequest: import("vue").Ref<Record<string, any> | null>,
 *   sessionId: import("vue").Ref<string>
 * }} options
 */
function useVibe64MainChatDelivery(props, emit, {
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
  projectSlug,
  questionState,
  reportActivity,
  requestAgentSettings,
  routingRequest,
  sessionId
}) {
  const conversationFollowLatestKey = ref(0);
  const contextFullFailure = ref(null);
  let messageSequence = 0;

  function restoreCancelledMessage(messageId) {
    const message = messageDelivery.value?.find(messageId);
    if (!message || cancelOwnsMessage(message) ||
        !unmatchedOptimisticMessages(props.conversationLog?.turns, [message]).length) return;
    composerDraft.value = draftWithRestoredMessage(message.payload.draftSnapshot || message.text, composerDraft.value);
    returnSentAttachments(composerAttachments, message.payload);
    messageDelivery.value?.remove(messageId);
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
      !normalizeText(payload.message)) {
      return false;
    }
    const messageId = String(existingMessageId || "").trim() || nextMessageId();
    const sendingSessionId = sessionId.value;
    const sendingProjectSlug = projectSlug.value;
    const sendingActorKey = actorKey.value;
    const runtime = props.conversationRuntime;
    composerSubmissionKind.value = submissionKind === "steer" ? "steer" : "send";
    takeSentAttachments(runtime.draftAttachments, payload);
    let accepted = false;
    try {
      const response = await runtime[composer ? "submitDraft" : "send"]({
        ...payload,
        agentSettings: Object.hasOwn(payload, "agentSettings") ? payload.agentSettings : requestAgentSettings.value || null
      }, { messageId, submissionKind, ...(composer ? { questionText } : {}) });
      accepted = vibe64RequestAccepted(response);
      if (sessionId.value !== sendingSessionId || projectSlug.value !== sendingProjectSlug || actorKey.value !== sendingActorKey) {
        return false;
      }
      if (accepted) {
        conversationFollowLatestKey.value += 1;
        reportActivity("message-sent", { projectSlug: sendingProjectSlug, sessionId: sendingSessionId });
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
      const message = normalizeText(error?.message || error) || "Message could not be sent.";
      if (error?.code === "vibe64_assistant_context_full") {
        contextFullFailure.value = { message, payload, options: { messageId, submissionKind, composer, questionText } };
      }
      const attention = executionAttentionForError(error, message);
      if (attention) {
        emit("execution-attention", attention);
      }
      return false;
    } finally {
      // The chat keeps an undelivered message with Retry, Edit and Cancel, and
      // its files stay with it. The words of a composer message the chat does
      // not keep, or of the composer's own Retry, return there with theirs.
      if (!accepted && (composer && !runtime.delivery.find(messageId) || runtime.draftRetry.value?.messageId === messageId)) {
        returnSentAttachments(runtime.draftAttachments, payload);
      }
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
    returnSentAttachments(composerAttachments, message.payload);
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

  watch([routingRequest, () => messageDelivery.value?.state.messages || []], ([request]) => {
    if (request?.stopped && !request.cancelled && !request.helper && !request.attemptedMessageId) {
      restoreCancelledMessage(request.messageId);
    }
  }, { immediate: true });

  return {
    cancelOptimisticMessage,
    contextFullFailure,
    conversationFollowLatestKey,
    editOptimisticMessage,
    resendOptimisticMessage,
    retryContextFull,
    sendLessonMessage,
    submitComposerMessage
  };
}

export { useVibe64MainChatDelivery };
