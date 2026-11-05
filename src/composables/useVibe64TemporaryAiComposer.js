import { computed } from "vue";
import { assistantRoutingFromMetadata, assistantRoutingRequestForDisplay } from "@local/vibe64-runtime/shared/assistantRouting";
import { useVibe64SessionTypingPresence } from "@/composables/useVibe64SessionTypingPresence.js";

/**
 * The temporary chats' composers: whether a chat takes a message now and why not, the active chat's error and
 * activity lines, its chat mode session, typing presence, and Send.
 * @param {object} options
 * @param {{
 *   active: boolean,
 *   assistantSelection: object,
 *   connectionUnavailable: boolean,
 *   projectSlug: string,
 *   repositoryBusy: boolean,
 *   sessionId: string
 * }} options.props the workspace's props
 * @param {import("@/types.js").Vibe64TemporaryAi} options.temporary
 * @param {import("vue").Ref<boolean>} options.closingTask whether a chat's Close is in progress
 * @param {(taskId: string) => { attachmentsCanSubmit: () => boolean } | null} options.taskPrompt the chat's mounted prompt
 * @param {import("vue").Ref<string>} options.sessionsApiPath
 */
function useVibe64TemporaryAiComposer({ props, temporary, closingTask, taskPrompt, sessionsApiPath }) {
  const activeTask = temporary.activeTask;
  const routingRequest = computed(() => assistantRoutingRequestForDisplay(activeTask.value?.routingMetadata));
  const modeSession = computed(() => ({ sessionId: props.sessionId,
    assistantSelection: activeTask.value?.assistantSelection || props.assistantSelection,
    agentSession: { goal: activeTask.value?.goal || null },
    metadata: activeTask.value?.routingMetadata || {} }));
  const activeTaskError = computed(() => {
    if (["failed", "uncertain"].includes(routingRequest.value?.status) &&
        routingRequest.value.error === activeTask.value?.error) return "";
    if (activeTask.value?.delivery.state.messages.some((message) => (
      message.status === "failed" && message.error === activeTask.value.error
    ))) return "";
    if (props.connectionUnavailable && activeTask.value?.errorCode === "vibe64_agent_write_mode_busy") {
      return "";
    }
    return activeTask.value?.error || taskAccessReason(activeTask.value);
  });
  const typingPresence = useVibe64SessionTypingPresence({
    active: computed(() => props.active && temporary.open.value && Boolean(activeTask.value?.conversationId) &&
      !taskInputDisabled(activeTask.value) && !closingTask.value),
    conversationId: computed(() => activeTask.value?.conversationId || ""),
    projectSlug: computed(() => props.projectSlug),
    sessionId: computed(() => props.sessionId),
    sessionsApiPath
  });
  const activityLabel = computed(() => {
    if (activeTask.value?.delivery.state.sending) return "Sending to assistant…";
    if (activeTask.value?.busy && activeTask.value.phase === "background") return "Reply ready · background task still running…";
    if (activeTask.value?.busy) return "AI is working…";
    return typingPresence.typingLabel.value;
  });

  /** Why the chat takes no message now: a turn it cannot steer, or a chat mode that is unavailable. */
  function taskAccessReason(task) {
    if (!task) return "";
    if (task.busy) return task.canSteer === false
      ? "You cannot steer this turn's AI connection. You can send a new request when it finishes." : "";
    const mode = assistantRoutingFromMetadata(task.routingMetadata || {})?.mode;
    const decision = task.purposes?.[mode];
    return decision?.available === false ? decision.message || "This mode is unavailable. Choose another chat mode." : "";
  }

  function taskInputDisabled(task) {
    return props.repositoryBusy || task.state === "closing" || task.status === "closing" || Boolean(taskAccessReason(task));
  }

  async function sendTask(taskId = "", options = {}) {
    const currentPrompt = taskPrompt(taskId);
    if (props.connectionUnavailable || !taskId || currentPrompt?.attachmentsCanSubmit() === false) {
      return;
    }
    const task = temporary.tasks.value.find((task) => task.id === taskId);
    if (!task || taskInputDisabled(task)) return;
    typingPresence.submit();
    return temporary.send(taskId, { ...options, attachmentOwner: currentPrompt });
  }

  return {
    activeTaskError,
    activityLabel,
    modeSession,
    routingRequest,
    sendTask,
    taskAccessReason,
    taskInputDisabled,
    typingPresence
  };
}

export { useVibe64TemporaryAiComposer };
