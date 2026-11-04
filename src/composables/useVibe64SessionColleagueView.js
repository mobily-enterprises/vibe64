import { inject, onBeforeUnmount, ref, toValue, watch, watchEffect } from "vue";
import { VIBE64_AI_TASKS_KEY } from "@local/vibe64-ai-tasks/client";
import { VIBE64_COLLEAGUE_VIEW_KEY } from "@/lib/vibe64AssistantHost.js";

/**
 * Tells Colleague which session view is selected and lets it open the session's main chat or its AI task's
 * conversation, a file, or a lesson message. Opening or closing the AI task window is a new selection;
 * removing the view withdraws it and invalidates any open still in progress.
 * @param {object} options
 * @param {import("vue").MaybeRefOrGetter<string>} options.projectSlug
 * @param {import("vue").MaybeRefOrGetter<string>} options.sessionId
 * @param {import("vue").MaybeRefOrGetter<boolean>} options.ready whether the session's conversations can open
 * @param {import("vue").MaybeRefOrGetter<boolean>} options.selected whether this is the selected session view
 * @param {(path: string) => boolean} options.openFile
 * @param {(text: string) => Promise<boolean>} options.sendLessonMessage
 * @param {() => void} options.showMainChat
 */
function useVibe64SessionColleagueView({ projectSlug, sessionId, ready, selected, openFile, sendLessonMessage, showMainChat }) {
  const colleagueView = inject(VIBE64_COLLEAGUE_VIEW_KEY, null);
  const aiTasks = inject(VIBE64_AI_TASKS_KEY);
  const selectionRevision = ref(0);
  const selectedView = {
    get projectSlug() { return toValue(projectSlug); },
    get sessionId() { return toValue(sessionId); },
    get ready() { return toValue(ready); },
    get selectionRevision() { return selectionRevision.value; },
    get conversationId() { return aiTasks.open && aiTasks.task ? aiTasks.task.id : ""; },
    // A Learning "Show me" for a file opens it in the ordinary Working Files view.
    openFile(path) { return openFile(path) === true; },
    // A lesson beat's Do it for me sends its prompt to this session's Main chat.
    async sendLessonMessage(text) { return await sendLessonMessage(text) === true; },
    async openConversation(conversationId, isCurrent = () => true) {
      if (!toValue(selected) || !toValue(ready) || !isCurrent()) throw new Error("This session is no longer available.");
      if (!conversationId) {
        if (aiTasks.open) aiTasks.hide();
        showMainChat();
        return;
      }
      if (aiTasks.task?.id !== conversationId) throw new Error("The conversation could not be opened.");
      aiTasks.show(null);
    }
  };
  watch(() => aiTasks.open, () => { selectionRevision.value += 1; });
  watchEffect(() => {
    if (!colleagueView) return;
    if (toValue(selected)) colleagueView.value = selectedView;
    else if (colleagueView.value === selectedView) colleagueView.value = null;
  });
  onBeforeUnmount(() => {
    selectionRevision.value += 1;
    if (colleagueView?.value === selectedView) colleagueView.value = null;
  });
}

export { useVibe64SessionColleagueView };
