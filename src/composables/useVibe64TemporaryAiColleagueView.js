import { inject, nextTick, onBeforeUnmount, watchEffect } from "vue";
import { VIBE64_COLLEAGUE_VIEW_KEY } from "@/lib/vibe64AssistantHost.js";

/**
 * Tells Colleague which session view is selected and lets it open one of the
 * view's conversations, a file, or a lesson message. Removing the view
 * withdraws it and invalidates any open still in progress.
 */
function useVibe64TemporaryAiColleagueView({ props, emit, temporary, hostConversation, selectionRevision }) {
  const colleagueView = inject(VIBE64_COLLEAGUE_VIEW_KEY, null);
  const activeTask = temporary.activeTask;
  const selectedView = {
    get projectSlug() { return props.projectSlug; },
    get sessionId() { return props.sessionId; },
    get ready() { return props.assistantReady; },
    get selectionRevision() { return selectionRevision.value; },
    get hostConversationSelected() { return Boolean(hostConversation?.value?.selected); },
    get temporarySelected() { return temporary.open.value && !hostConversation?.value?.selected; },
    get conversationId() { return this.temporarySelected ? activeTask.value?.conversationId || "" : ""; },
    // A Learning "Show me" for a file opens it in the ordinary Working Files view.
    openFile(path) { return typeof props.openFile === "function" && props.openFile(path) === true; },
    // A lesson beat's Do it for me sends its prompt to this session's Main chat.
    async sendLessonMessage(text) { return typeof props.sendLessonMessage === "function" && await props.sendLessonMessage(text) === true; },
    async openConversation(conversationId, isCurrent = () => true) {
      if (!props.sessionSelected || !props.assistantReady || !isCurrent()) throw new Error("This session is no longer available.");
      if (!conversationId) {
        hostConversation?.value?.close();
        temporary.closeWorkspace();
        emit("select-main-chat");
        return;
      }
      const projectSlug = props.projectSlug;
      const sessionId = props.sessionId;
      const revision = selectionRevision.value;
      const hostSelected = hostConversation?.value?.selected;
      await temporary.restoreTasks();
      if (!isCurrent() || !props.sessionSelected || !props.assistantReady || props.projectSlug !== projectSlug ||
        props.sessionId !== sessionId || selectionRevision.value !== revision || hostConversation?.value?.selected !== hostSelected) {
        throw new Error("The selected conversation changed before it opened.");
      }
      const task = temporary.tasks.value.find((entry) => entry.conversationId === conversationId);
      if (!task) throw new Error(temporary.restoreError.value || "The temporary conversation could not be opened.");
      hostConversation?.value?.close();
      temporary.selectTask(task.id);
      await nextTick();
      if (!isCurrent() || !props.sessionSelected || props.sessionId !== sessionId || selectionRevision.value !== revision ||
        temporary.activeTaskId.value !== task.id || !temporary.open.value) throw new Error("The selected conversation changed before it opened.");
    }
  };
  watchEffect(() => {
    if (!colleagueView) return;
    if (props.sessionSelected) colleagueView.value = selectedView;
    else if (colleagueView.value === selectedView) colleagueView.value = null;
  });
  onBeforeUnmount(() => {
    selectionRevision.value += 1;
    if (colleagueView?.value === selectedView) colleagueView.value = null;
  });
}

export { useVibe64TemporaryAiColleagueView };
