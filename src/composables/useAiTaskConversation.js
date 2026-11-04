import { computed, ref, toValue, watch } from "vue";
import { assistantRoutingFromMetadata, assistantRoutingRequestForDisplay } from "@local/vibe64-runtime/shared/assistantRouting";
import { useVibe64SessionTypingPresence } from "@/composables/useVibe64SessionTypingPresence.js";
import { useVibe64TemporaryAi } from "@/composables/useVibe64TemporaryAi.js";

const SENDING_LABEL = "Sending to assistant…";
const WORKING_LABEL = "AI is working…";
const BACKGROUND_LABEL = "Reply ready · background task still running…";
const NOT_STEERABLE = "You cannot steer this turn's AI connection. You can send a new request when it finishes.";
const MODE_UNAVAILABLE = "This mode is unavailable. Choose another chat mode.";

const ownsAiTaskRecord = record => Boolean(record.task);

/**
 * The AI task's conversation: its messages, draft, attachments, Stop and delivery recovery are
 * Temporary AI's, so a chat behaves the same wherever it is. Only the task's own chats are bound here.
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
  const temporary = useVibe64TemporaryAi({
    active: () => toValue(windowOpen),
    agentSettings: computed(() => {
      const selection = toValue(assistantSelection);
      return { providerId: selection.engineId, model: selection.modelId, thinking: selection.variantId };
    }),
    assistantReady: () => toValue(assistantReady),
    ownsRecord: ownsAiTaskRecord,
    sessionId: computed(() => toValue(sessionId)),
    sessionsApiPath: computed(() => toValue(sessionsApiPath))
  });
  const task = computed(() => temporary.tasks.value.find(candidate => candidate.id === toValue(taskId)) || null);
  const stopping = ref(false);
  const actionError = ref("");
  const routingRequest = computed(() => assistantRoutingRequestForDisplay(task.value?.routingMetadata));
  const modeSession = computed(() => ({
    sessionId: toValue(sessionId),
    assistantSelection: task.value?.assistantSelection || toValue(assistantSelection),
    agentSession: { goal: task.value?.goal || null },
    metadata: task.value?.routingMetadata || {}
  }));

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
  async function send(prompt, options = {}) {
    if (toValue(connectionUnavailable) || inputDisabled.value || !prompt.attachmentsCanSubmit()) return;
    typingPresence.submit();
    await temporary.send(task.value.id, { ...options, attachmentOwner: prompt });
  }

  async function stop() {
    if (stopping.value || !task.value) return;
    stopping.value = true;
    actionError.value = "";
    try {
      await temporary.stopTask(task.value.id);
    } catch (failure) {
      actionError.value = failure.message;
    } finally {
      stopping.value = false;
    }
  }

  // A task the server has just started: its chat appears in the next saved list.
  watch(() => toValue(taskId), (id) => {
    if (id && !task.value) void temporary.restoreTasks();
  });

  return {
    activityLabel,
    assistantReason: accessReason,
    cancelMessage: id => temporary.cancelMessage(task.value.id, id),
    editMessage: id => temporary.editMessage(task.value.id, id),
    error,
    inputDisabled,
    modeSession,
    routingRequest,
    send,
    stop,
    stopping,
    task,
    typingPresence,
    updateAgentSetting: (parameterId, value) => temporary.updateAgentSetting(task.value.id, parameterId, value),
    updateAttachments: attachments => temporary.updateAttachments(task.value.id, attachments),
    updateDraft: draft => temporary.updateDraft(task.value.id, draft),
    updateRouting: preferences => temporary.updateRouting(task.value.id, preferences)
  };
}

export { useAiTaskConversation };
