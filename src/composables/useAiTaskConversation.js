import { computed, ref, toValue } from "vue";
import { normalizeVibe64AgentSettings } from "@local/vibe64-runtime/shared";
import { assistantRoutingFromMetadata, assistantRoutingRequestForDisplay } from "@local/vibe64-runtime/shared/assistantRouting";
import { useAiTaskConversationMessages } from "@/composables/useAiTaskConversationMessages.js";
import { useAiTaskConversationRecord } from "@/composables/useAiTaskConversationRecord.js";
import { useVibe64SessionTypingPresence } from "@/composables/useVibe64SessionTypingPresence.js";
import { aiTaskRequest } from "@/lib/vibe64AiTaskConversation.js";
import { vibe64AiTaskConversationPath } from "@/lib/vibe64SessionRequestConfig.js";

const SENDING_LABEL = "Sending to assistant…";
const WORKING_LABEL = "AI is working…";
const BACKGROUND_LABEL = "Reply ready · background task still running…";
const NOT_STEERABLE = "You cannot steer this turn's AI connection. You can send a new request when it finishes.";
const MODE_UNAVAILABLE = "This mode is unavailable. Choose another chat mode.";
const RESTORE_FAILED = "The conversation could not be loaded:";

/**
 * The AI task's conversation as its chat uses it: messages, draft, attachments, steering, Stop and delivery
 * recovery, over the task's own saved conversation.
 * @param {object} options
 * @param {import("vue").MaybeRefOrGetter<string>} options.taskId
 * @param {import("vue").MaybeRefOrGetter<string>} options.sessionId
 * @param {import("vue").MaybeRefOrGetter<string>} options.sessionsApiPath
 * @param {import("vue").MaybeRefOrGetter<string>} options.projectSlug
 * @param {import("vue").MaybeRefOrGetter<object>} options.assistantSelection
 * @param {import("vue").MaybeRefOrGetter<boolean>} options.assistantReady
 * @param {import("vue").MaybeRefOrGetter<boolean>} options.windowOpen
 * @param {import("vue").MaybeRefOrGetter<boolean>} options.composerOpen whether the task takes a message now
 * @param {import("vue").MaybeRefOrGetter<boolean>} options.connectionUnavailable
 */
function useAiTaskConversation({
  taskId, sessionId, sessionsApiPath, projectSlug, assistantSelection, assistantReady, windowOpen, composerOpen, connectionUnavailable
}) {
  const record = useAiTaskConversationRecord({ taskId, sessionId, sessionsApiPath, projectSlug, assistantReady });
  const { conversation, saves } = record;
  const messages = useAiTaskConversationMessages({
    conversation, saves, stoppingIds: record.stoppingIds, isDisposed: record.isDisposed
  });
  const task = computed(() => conversation.value?.id === toValue(taskId) ? conversation.value : null);
  const stopping = ref(false);
  const actionError = ref("");
  const routingRequest = computed(() => assistantRoutingRequestForDisplay(task.value?.routingMetadata));
  const modeSession = computed(() => ({
    sessionId: toValue(sessionId),
    assistantSelection: task.value?.assistantSelection || toValue(assistantSelection),
    agentSession: { goal: task.value?.goal || null },
    metadata: task.value?.routingMetadata || {}
  }));
  const loadError = computed(() => record.restoreError.value ? `${RESTORE_FAILED} ${record.restoreError.value}` : "");

  const accessReason = computed(() => {
    const current = task.value;
    if (!current) return "";
    if (current.busy) return current.canSteer === false ? NOT_STEERABLE : "";
    const decision = current.purposes?.[assistantRoutingFromMetadata(current.routingMetadata || {})?.mode];
    return decision?.available === false ? decision.message || MODE_UNAVAILABLE : "";
  });
  const inputDisabled = computed(() => !toValue(composerOpen) || !task.value || Boolean(accessReason.value));
  const typingPresence = useVibe64SessionTypingPresence({
    active: computed(() => toValue(windowOpen) && Boolean(task.value?.conversationId) && !inputDisabled.value),
    conversationId: computed(() => task.value?.conversationId || ""),
    projectSlug: computed(() => toValue(projectSlug)),
    sessionId: computed(() => toValue(sessionId)),
    sessionsApiPath: computed(() => toValue(sessionsApiPath))
  });
  const activityLabel = computed(() => {
    const current = task.value;
    if (current?.delivery.state.sending) return SENDING_LABEL;
    if (current?.busy && current.phase === "background") return BACKGROUND_LABEL;
    return current?.busy ? WORKING_LABEL : typingPresence.typingLabel.value;
  });
  // A message that failed shows its own Retry, Cancel and Edit; only anything else needs a line.
  const error = computed(() => {
    const current = task.value;
    if (actionError.value) return actionError.value;
    if (!current?.error) return accessReason.value;
    const owned = current.delivery.state.messages.some(message => message.status === "failed" && message.error === current.error);
    return owned || routingRequest.value?.error === current.error ? accessReason.value : current.error;
  });

  /**
   * @param {{ attachmentsCanSubmit: () => boolean }} prompt the composer, which owns attachments still uploading
   * @param {{ retryMessageId?: string }} [options]
   */
  async function send(prompt, { retryMessageId = "" } = {}) {
    if (toValue(connectionUnavailable) || inputDisabled.value || !prompt.attachmentsCanSubmit()) return;
    typingPresence.submit();
    await messages.send({ retryMessageId, attachmentOwner: prompt });
  }

  async function stop() {
    if (stopping.value || !task.value) return;
    stopping.value = true;
    actionError.value = "";
    try {
      await messages.stop();
    } catch (failure) {
      actionError.value = failure.message;
    } finally {
      stopping.value = false;
    }
  }

  /** @param {string} draft */
  function updateDraft(draft) {
    if (task.value) saves.updateConversation(task.value.id, { draft });
  }

  /** @param {Array<{ attachmentId: string }>} attachments */
  function updateAttachments(attachments) {
    if (task.value) saves.updateConversation(task.value.id, { attachments });
  }

  /**
   * @param {string} parameterId
   * @param {string} value
   */
  function updateAgentSetting(parameterId, value) {
    const current = task.value;
    if (!current) return;
    const settings = normalizeVibe64AgentSettings({ ...current.agentSettings, [parameterId]: value });
    saves.updateConversation(current.id, { agentSettings: settings, settingsToSave: settings });
  }

  /** @param {object} preferences the chat mode, review and custom selection to route the next request with */
  async function updateRouting(preferences) {
    const current = task.value;
    const result = await aiTaskRequest(vibe64AiTaskConversationPath(current.apiPath, current.sessionId, current.conversationId), {
      method: "PATCH", body: { assistantRouting: preferences }
    });
    if (saves.canApply(current)) {
      saves.updateConversation(current.id, { routingMetadata: result.routingMetadata, purposes: result.purposes });
      void current.binding.runtime.value.reload();
    }
    return result;
  }

  return {
    activityLabel,
    assistantReason: accessReason,
    cancelMessage: messages.cancelMessage,
    editMessage: messages.editMessage,
    error,
    inputDisabled,
    loadError,
    modeSession,
    routingRequest,
    send,
    stop,
    stopping,
    task,
    typingPresence,
    updateAgentSetting,
    updateAttachments,
    updateDraft,
    updateRouting
  };
}

export { useAiTaskConversation };
