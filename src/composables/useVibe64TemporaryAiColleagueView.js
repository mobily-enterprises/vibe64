import { inject, nextTick, onBeforeUnmount, watch, watchEffect } from "vue";
import { VIBE64_AI_TASKS_KEY } from "@local/vibe64-ai-tasks/client";
import { VIBE64_COLLEAGUE_VIEW_KEY } from "@/lib/vibe64AssistantHost.js";

/**
 * Tells Colleague which session view is selected and lets it open one of the
 * view's conversations, a file, or a lesson message. An AI task's conversation
 * opens in its window, and opening or closing that window is a new selection.
 * Removing the view withdraws it and invalidates any open still in progress.
 * @param {object} options
 * @param {{
 *   projectSlug: string,
 *   sessionId: string,
 *   assistantReady: boolean,
 *   sessionSelected: boolean,
 *   openFile: (path: string) => boolean,
 *   sendLessonMessage: (text: string) => Promise<boolean>
 * }} options.props the workspace's props
 * @param {(event: "select-main-chat") => void} options.emit the workspace's emit
 * @param {import("@/types.js").Vibe64TemporaryAi} options.temporary
 * @param {import("vue").Ref<number>} options.selectionRevision the workspace's selection count, which an open checks
 */
function useVibe64TemporaryAiColleagueView({ props, emit, temporary, selectionRevision }) {
  /** @type {import("@/lib/vibe64AssistantHost.js").ShellSlot<typeof selectedView>} */
  const colleagueView = inject(VIBE64_COLLEAGUE_VIEW_KEY);
  /** @type {import("@local/vibe64-ai-tasks/client/types").AiTaskHost} */
  const aiTasks = inject(VIBE64_AI_TASKS_KEY);
  const activeTask = temporary.activeTask;
  const selectedView = {
    get projectSlug() { return props.projectSlug; },
    get sessionId() { return props.sessionId; },
    get ready() { return props.assistantReady; },
    get selectionRevision() { return selectionRevision.value; },
    get temporarySelected() { return temporary.open.value; },
    get conversationId() {
      if (aiTasks.open && aiTasks.task) return aiTasks.task.id;
      return this.temporarySelected ? activeTask.value?.conversationId || "" : "";
    },
    // A Learning "Show me" for a file opens it in the ordinary Working Files view.
    openFile(path) { return props.openFile(path) === true; },
    // A lesson beat's Do it for me sends its prompt to this session's Main chat.
    async sendLessonMessage(text) { return await props.sendLessonMessage(text) === true; },
    async openConversation(conversationId, isCurrent = () => true) {
      if (!props.sessionSelected || !props.assistantReady || !isCurrent()) throw new Error("This session is no longer available.");
      if (!conversationId) {
        if (aiTasks.open) aiTasks.hide();
        temporary.closeWorkspace();
        emit("select-main-chat");
        return;
      }
      if (aiTasks.task?.id === conversationId) {
        aiTasks.show(null);
        return;
      }
      const projectSlug = props.projectSlug;
      const sessionId = props.sessionId;
      const revision = selectionRevision.value;
      await temporary.restoreTasks();
      if (!isCurrent() || !props.sessionSelected || !props.assistantReady || props.projectSlug !== projectSlug ||
        props.sessionId !== sessionId || selectionRevision.value !== revision) {
        throw new Error("The selected conversation changed before it opened.");
      }
      const task = temporary.tasks.value.find((entry) => entry.conversationId === conversationId);
      if (!task) throw new Error(temporary.restoreError.value || "The temporary conversation could not be opened.");
      if (aiTasks.open) aiTasks.hide();
      temporary.selectTask(task.id);
      await nextTick();
      if (!isCurrent() || !props.sessionSelected || props.sessionId !== sessionId || selectionRevision.value !== revision ||
        temporary.activeTaskId.value !== task.id || !temporary.open.value) throw new Error("The selected conversation changed before it opened.");
    }
  };
  watch(() => aiTasks.open, () => { selectionRevision.value += 1; });
  watchEffect(() => {
    if (props.sessionSelected) colleagueView.value = selectedView;
    else if (colleagueView.value === selectedView) colleagueView.value = null;
  });
  onBeforeUnmount(() => {
    selectionRevision.value += 1;
    if (colleagueView.value === selectedView) colleagueView.value = null;
  });
}

export { useVibe64TemporaryAiColleagueView };
