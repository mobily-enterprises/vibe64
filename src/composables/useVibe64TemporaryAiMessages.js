import { draftWithRestoredMessage } from "@jskit-ai/assistant-core/client/conversation-delivery";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { cancelOwnsMessage, routedChatMessage, trackRoutedMessage } from "@/lib/vibe64ChatDelivery.js";
import { VIBE64_AGENT_TASK_RESULT_SCHEMA } from "@local/vibe64-runtime/shared";
import { chatMessagePayload } from "@/lib/vibe64ChatMessage.js";
import { assistantRoutingRequestForDisplay } from "@local/vibe64-runtime/shared/assistantRouting";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import {
  temporaryAiId,
  temporaryAiRequestError,
  temporaryAiTaskPresentation
} from "@/lib/vibe64TemporaryAiTasks.js";

/**
 * Temporary AI's messages: sending a task's draft or a generated request,
 * cancelling or editing a message not yet answered, and stopping a task's turn.
 */
function useVibe64TemporaryAiMessages({
  tasks,
  closingTaskIds,
  stoppingTaskIds,
  isDisposed,
  operationBusy,
  records,
  reportTaskFinished,
  updateDraft
}) {
  const {
    canApplyTaskResponse,
    cancelScheduledSave,
    ensureConversation,
    removeTask,
    saveInFlight,
    updateTask
  } = records;

  function pendingMessage(task, messageId) {
    const local = task?.delivery.find(messageId);
    const route = assistantRoutingRequestForDisplay(task?.routingMetadata);
    return (route?.messageId === messageId && routedChatMessage(route, local)) || local;
  }

  // JSKIT's failed delivery entry was definitely not sent, so the server holds
  // nothing to cancel, even when the conversation itself was never created. A
  // message shown from its route is the server's own record.
  function definitelyUnsent(task, messageId) {
    const route = assistantRoutingRequestForDisplay(task?.routingMetadata);
    return route?.messageId !== messageId && task?.delivery.find(messageId)?.status === "failed";
  }

  async function send(taskId = "", { retryMessageId = "", generatedMessage = null, attachmentOwner = null } = {}) {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (isDisposed() || !task || closingTaskIds.has(taskId) || stoppingTaskIds.has(taskId) ||
        readRefOrGetterValue(operationBusy) || task.recoveryOutcome === "checking") return false;
    const retry = retryMessageId ? pendingMessage(task, retryMessageId) : null;
    const draftPayload = generatedMessage || chatMessagePayload(task.draft, task.attachments);
    const payload = retry?.payload || (draftPayload && {
      ...draftPayload, agentSettings: task.agentSettings, displayMessage: draftPayload.displayMessage,
      presentation: temporaryAiTaskPresentation(task),
      message: !generatedMessage && task.recoveryContext
        ? `${task.recoveryContext}\n\nUser message:\n${draftPayload.message}` : draftPayload.message,
      ...(task.recoveryOperation === "update" ? { outputSchema: VIBE64_AGENT_TASK_RESULT_SCHEMA } : {}),
      promptLabel: task.label
    });
    if (!payload?.message) return false;
    const authored = payload.request ? payload : { ...payload, data: {
      agentSettings: payload.agentSettings, displayMessage: payload.displayMessage,
      presentation: payload.presentation, ...(payload.outputSchema ? { outputSchema: payload.outputSchema } : {}),
      promptLabel: payload.promptLabel
    } };
    const messageId = retryMessageId || temporaryAiId("message");
    const working = ["starting", "inProgress"].includes(task.status);
    function accepted() {
      if (!canApplyTaskResponse(task) || closingTaskIds.has(taskId)) return;
      const current = tasks.value.find(candidate => candidate.id === taskId);
      if (current.pendingMessageId !== messageId) return;
      updateTask(taskId, { displayMessage: "", pendingMessageId: "", error: "", errorCode: "", status: current.status });
      if (retry || current.draft || current.attachments.length) updateTask(taskId, { draft: current.draft });
    }
    try {
      const submission = task.binding.submitPrepared(authored, {
        messageId, retryMessageId, retry, working, clearDraft: !generatedMessage, attachments: attachmentOwner,
        isCurrent: () => canApplyTaskResponse(task) && !closingTaskIds.has(taskId), onAccepted: accepted,
        onSubmit() {
          updateTask(taskId, {
            sendVersion: (task.sendVersion || 0) + 1, messageId, busy: true,
            error: "", errorCode: "", pendingMessageId: messageId,
            outcomeKind: "", runConflictId: task.recoveryConflictId,
            recoveryOutcome: task.recoveryOutcome === "failed" ? "failed" : "",
            recoveryOutcomeMessage: task.recoveryOutcome === "failed" ? task.recoveryOutcomeMessage : "", status: "starting"
          });
          cancelScheduledSave(taskId);
        },
        async prepare(submission) {
          const save = saveInFlight(taskId);
          if (save) await save;
          if (!canApplyTaskResponse(task) || closingTaskIds.has(taskId)) return false;
          await ensureConversation(task);
          if (!canApplyTaskResponse(task) || closingTaskIds.has(taskId)) return false;
          return { ...submission.request, data: { ...submission.request.data,
            presentation: { ...submission.request.data.presentation,
              draft: tasks.value.find(candidate => candidate.id === taskId).draft }
          } };
        }
      });
      if (submission === false) return false;
      const response = await submission;
      if (!canApplyTaskResponse(task) || closingTaskIds.has(taskId)) return false;
      if (response === false || response?.ok === false) {
        throw temporaryAiRequestError(response || { error: task.delivery.find(messageId)?.error || "Message could not be sent." });
      }
      const current = tasks.value.find(candidate => candidate.id === taskId);
      if (response?.assistantRoutingRequest) updateTask(taskId, { routingMetadata: { ...current.routingMetadata,
        assistant_routing_request: JSON.stringify(response.assistantRoutingRequest) } });
      // Native run identity/status comes only from the original logical read.
      // The shared owner already schedules that read and reconciles its receipt.
      return true;
    } catch (error) {
      if (!canApplyTaskResponse(task)) return false;
      if (error.code === "vibe64_conversation_closed") { removeTask(taskId); return false; }
      if (error.code === "vibe64_assistant_routing_cancelled") {
        const current = tasks.value.find(candidate => candidate.id === taskId);
        const text = payload.displayMessage || payload.message;
        const cancelling = cancelOwnsMessage(task.delivery.find(messageId));
        if (!cancelling) task.delivery.remove(messageId);
        updateTask(taskId, { busy: false, pendingMessageId: "", error: "", errorCode: "", status: "interrupted",
          ...(cancelling ? {} : { draft: draftWithRestoredMessage(text, current.draft) }) });
        updateTask(taskId, { draft: tasks.value.find(candidate => candidate.id === taskId).draft });
        return false;
      }
      const current = tasks.value.find(candidate => candidate.id === taskId);
      const retained = task.delivery.find(messageId);
      if (retained?.status === "accepted" || !retained && current.pendingMessageId !== messageId) return true;
      const stillWorking = task.busy && error?.conversationExpired !== true;
      updateTask(taskId, { busy: stillWorking,
        conversationId: error?.conversationExpired === true ? "" : current.conversationId,
        error: normalizeText(error?.message || error) || "Temporary AI message could not be sent.",
        errorCode: normalizeText(error?.code), pendingMessageId: messageId,
        runId: error?.conversationExpired === true ? "" : task.runId, status: stillWorking ? task.status : "failed" });
      updateTask(taskId, { draft: current.draft });
      if (!stillWorking) reportTaskFinished(taskId);
      return false;
    }
  }

  // Cancel means cancel, and the server decides: the message stays, shown as
  // Cancelling…, until the server records the cancel, which also stops its
  // route and any turn it started. When the server cannot be reached the
  // message stays with Cancel again. Accepted history remains the transcript's.
  // A definitely unsent message leaves through JSKIT's Edit instead.
  async function cancelMessage(taskId, messageId) {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    const message = pendingMessage(task, messageId);
    const runtime = task?.binding.runtime.value;
    if (isDisposed() || !message || message.status === "accepted" || !runtime) return false;
    if (definitelyUnsent(task, messageId)) {
      if (task.delivery.edit(messageId) === null) return false;
    } else {
      trackRoutedMessage(task.delivery, message, runtime.turns?.value);
      if (await runtime.cancelMessage(messageId) !== true || !canApplyTaskResponse(task)) return false;
    }
    const current = tasks.value.find(candidate => candidate.id === taskId);
    updateTask(taskId, {
      ...(current.pendingMessageId === messageId ? { pendingMessageId: "" } : {}),
      ...(message.status === "uncertain" || current.error === message.error ? { error: "", errorCode: "" } : {})
    });
    return true;
  }

  async function editMessage(taskId, messageId) {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    const message = pendingMessage(task, messageId);
    // A message that may have reached the AI is never turned back into a draft.
    if (message?.status !== "failed" || !await cancelMessage(taskId, messageId)) return false;
    updateDraft(taskId, draftWithRestoredMessage(message.text, task.draft));
    return true;
  }

  async function stopTask(taskId = "") {
    const task = tasks.value.find(candidate => candidate.id === taskId);
    if (isDisposed() || !task || !task.busy && !task.routingMetadata?.assistant_routing_request || stoppingTaskIds.has(taskId)) return false;
    if (!task.conversationId) throw new Error("Temporary AI is still starting. Wait for it to start, then stop it.");
    stoppingTaskIds.add(taskId);
    try {
      const runtime = task.binding.runtime.value;
      const response = await runtime.cancel();
      if (!canApplyTaskResponse(task)) return false;
      if (response === false || response?.ok === false) throw temporaryAiRequestError(response || { error: runtime.error.value });
      updateTask(taskId, { busy: false,
        ...(response.routingMetadata ? { routingMetadata: response.routingMetadata } : {}), error: "", status: "interrupted" });
      return true;
    } catch (error) {
      if (!canApplyTaskResponse(task)) return false;
      if (error.code === "vibe64_conversation_closed") { removeTask(taskId); return false; }
      throw error;
    } finally { stoppingTaskIds.delete(taskId); }
  }

  return {
    cancelMessage,
    editMessage,
    send,
    stopTask
  };
}

export { useVibe64TemporaryAiMessages };
