import { draftWithRestoredMessage } from "@jskit-ai/assistant-core/client/conversation-delivery";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { assistantRoutingRequestForDisplay } from "@local/vibe64-runtime/shared/assistantRouting";
import { cancelOwnsMessage, routedChatMessage, trackRoutedMessage } from "@/lib/vibe64ChatDelivery.js";
import { chatMessagePayload } from "@/lib/vibe64ChatMessage.js";
import { aiTaskMessageId, aiTaskRequestError } from "@/lib/vibe64AiTaskConversation.js";

/** @typedef {import("@/types.js").AiTaskConversationSaves} AiTaskConversationSaves */

/**
 * The AI task conversation's messages: sending the draft or retrying a message, cancelling or editing a
 * message not yet answered, and stopping the turn.
 * @param {object} options
 * @param {import("vue").ShallowRef<object | null>} options.conversation
 * @param {AiTaskConversationSaves} options.saves
 * @param {Set<string>} options.stoppingIds conversations whose Stop is in flight
 * @param {() => boolean} options.isDisposed
 */
function useAiTaskConversationMessages({ conversation, saves, stoppingIds, isDisposed }) {
  const { canApply, cancelScheduledSave, releaseConversation, saveInFlight, updateConversation } = saves;

  function pendingMessage(value, messageId) {
    const local = value.delivery.find(messageId);
    const route = assistantRoutingRequestForDisplay(value.routingMetadata);
    return (route?.messageId === messageId && routedChatMessage(route, local)) || local;
  }

  // JSKIT's failed delivery entry was definitely not sent, so the server holds
  // nothing to cancel. A message shown from its route is the server's own record.
  function definitelyUnsent(value, messageId) {
    const route = assistantRoutingRequestForDisplay(value.routingMetadata);
    return route?.messageId !== messageId && value.delivery.find(messageId)?.status === "failed";
  }

  function submitRequest(value, { messageId, retryMessageId, retry, attachmentOwner, payload }) {
    const { id } = value;
    const authored = payload.request ? payload : { ...payload, data: {
      agentSettings: payload.agentSettings, displayMessage: payload.displayMessage,
      presentation: payload.presentation, promptLabel: payload.promptLabel
    } };
    function accepted() {
      if (!canApply(value)) return;
      const current = conversation.value;
      if (current.pendingMessageId !== messageId) return;
      updateConversation(id, { pendingMessageId: "", error: "", errorCode: "", status: current.status });
      if (retry || current.draft || current.attachments.length) updateConversation(id, { draft: current.draft });
    }
    return value.binding.submitPrepared(authored, {
      messageId, retryMessageId, retry, working: ["starting", "inProgress"].includes(value.status), clearDraft: true,
      attachments: attachmentOwner, isCurrent: () => canApply(value), onAccepted: accepted,
      onSubmit() {
        updateConversation(id, {
          sendVersion: (value.sendVersion || 0) + 1, messageId, busy: true, error: "", errorCode: "",
          pendingMessageId: messageId, outcomeKind: "", status: "starting"
        });
        cancelScheduledSave(id);
      },
      async prepare(submission) {
        const save = saveInFlight(id);
        if (save) await save;
        if (!canApply(value)) return false;
        return { ...submission.request, data: { ...submission.request.data,
          presentation: { ...submission.request.data.presentation, draft: conversation.value.draft } } };
      }
    });
  }

  function sendFailed(value, { messageId, payload }, error) {
    const { id } = value;
    if (error.code === "vibe64_conversation_closed") {
      releaseConversation(id);
      return false;
    }
    const current = conversation.value;
    if (error.code === "vibe64_assistant_routing_cancelled") {
      const cancelling = cancelOwnsMessage(value.delivery.find(messageId));
      if (!cancelling) value.delivery.remove(messageId);
      updateConversation(id, { busy: false, pendingMessageId: "", error: "", errorCode: "", status: "interrupted",
        ...(cancelling ? {} : { draft: draftWithRestoredMessage(payload.displayMessage || payload.message, current.draft) }) });
      updateConversation(id, { draft: conversation.value.draft });
      return false;
    }
    const retained = value.delivery.find(messageId);
    if (retained?.status === "accepted" || !retained && current.pendingMessageId !== messageId) return true;
    const expired = error.conversationExpired === true;
    const stillWorking = value.busy && !expired;
    updateConversation(id, { busy: stillWorking,
      error: normalizeText(error.message || error) || "The message could not be sent.",
      errorCode: normalizeText(error.code), pendingMessageId: messageId,
      runId: expired ? "" : value.runId, status: stillWorking ? value.status : "failed" });
    updateConversation(id, { draft: current.draft });
    return false;
  }

  /**
   * Sends the draft, or retries a message with its own id and payload.
   * @param {{ retryMessageId?: string, attachmentOwner: object }} options
   */
  async function send({ retryMessageId = "", attachmentOwner }) {
    const value = conversation.value;
    if (isDisposed() || !value || stoppingIds.has(value.id)) return false;
    const retry = retryMessageId ? pendingMessage(value, retryMessageId) : null;
    const draftPayload = chatMessagePayload(value.draft, value.attachments);
    const payload = retry?.payload || (draftPayload && {
      ...draftPayload, agentSettings: value.agentSettings, presentation: { draft: value.draft }, promptLabel: value.title
    });
    if (!payload?.message) return false;
    const request = { messageId: retryMessageId || aiTaskMessageId(), retryMessageId, retry, attachmentOwner, payload };
    try {
      const submission = submitRequest(value, request);
      if (submission === false) return false;
      const response = await submission;
      if (!canApply(value)) return false;
      if (response === false || response?.ok === false) {
        throw aiTaskRequestError(response || { error: value.delivery.find(request.messageId)?.error || "Message could not be sent." });
      }
      if (response?.assistantRoutingRequest) updateConversation(value.id, { routingMetadata: { ...conversation.value.routingMetadata,
        assistant_routing_request: JSON.stringify(response.assistantRoutingRequest) } });
      // The run's identity and status come only from the conversation's own read, which the binding schedules.
      return true;
    } catch (error) {
      return canApply(value) ? sendFailed(value, request, error) : false;
    }
  }

  /**
   * Cancel means cancel, and the server decides: the message stays, shown as Cancelling…, until the server
   * records the cancel, which also stops its route and any turn it started. When the server cannot be reached
   * the message stays with Cancel again. A definitely unsent message leaves through JSKIT's Edit instead.
   * @param {string} messageId
   */
  async function cancelMessage(messageId) {
    const value = conversation.value;
    const message = value && pendingMessage(value, messageId);
    if (isDisposed() || !message || message.status === "accepted") return false;
    const runtime = value.binding.runtime.value;
    if (definitelyUnsent(value, messageId)) {
      if (value.delivery.edit(messageId) === null) return false;
    } else {
      trackRoutedMessage(value.delivery, message, runtime.turns.value);
      if (await runtime.cancelMessage(messageId) !== true || !canApply(value)) return false;
    }
    const current = conversation.value;
    updateConversation(value.id, {
      ...(current.pendingMessageId === messageId ? { pendingMessageId: "" } : {}),
      ...(message.status === "uncertain" || current.error === message.error ? { error: "", errorCode: "" } : {})
    });
    return true;
  }

  /**
   * Returns a failed message to the draft. A message that may have reached the AI is never turned back into a draft.
   * @param {string} messageId
   */
  async function editMessage(messageId) {
    const value = conversation.value;
    const message = value && pendingMessage(value, messageId);
    if (message?.status !== "failed" || !await cancelMessage(messageId)) return false;
    updateConversation(value.id, { draft: draftWithRestoredMessage(message.text, conversation.value.draft) });
    return true;
  }

  async function stop() {
    const value = conversation.value;
    if (isDisposed() || !value || !value.busy && !value.routingMetadata?.assistant_routing_request || stoppingIds.has(value.id)) return false;
    stoppingIds.add(value.id);
    try {
      const runtime = value.binding.runtime.value;
      const response = await runtime.cancel();
      if (!canApply(value)) return false;
      if (response === false || response?.ok === false) throw aiTaskRequestError(response || { error: runtime.error.value });
      updateConversation(value.id, { busy: false,
        ...(response.routingMetadata ? { routingMetadata: response.routingMetadata } : {}), error: "", status: "interrupted" });
      return true;
    } catch (error) {
      if (!canApply(value)) return false;
      if (error.code === "vibe64_conversation_closed") {
        releaseConversation(value.id);
        return false;
      }
      throw error;
    } finally {
      stoppingIds.delete(value.id);
    }
  }

  return {
    cancelMessage,
    editMessage,
    send,
    stop
  };
}

export { useAiTaskConversationMessages };
