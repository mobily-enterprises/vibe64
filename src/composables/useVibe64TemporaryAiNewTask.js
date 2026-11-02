import { nextTick, ref, watch } from "vue";

/**
 * The New temporary chat flow. When Main has messages it offers to copy them
 * first; otherwise it creates the chat directly and shows the dialog only for a
 * failure. Cancelling a first chat returns to Main chat.
 */
function useVibe64TemporaryAiNewTask({ props, temporary, hostConversation, selectionRevision, selectMainChat }) {
  const newTaskOpen = ref(false);
  const newTaskReturnsToMain = ref(false);
  const includeRecentChatContext = ref(false);
  const creatingTask = ref(false);
  const creatingTaskId = ref("");
  const createTaskError = ref("");
  watch(() => [props.projectSlug, props.sessionId], () => {
    selectionRevision.value += 1;
    newTaskOpen.value = false;
    newTaskReturnsToMain.value = false;
    creatingTask.value = false;
    creatingTaskId.value = "";
  });
  watch(newTaskOpen, value => {
    if (value) { includeRecentChatContext.value = false; createTaskError.value = ""; creatingTaskId.value = ""; }
  });

  async function openNewTask() {
    newTaskReturnsToMain.value = !temporary.activeTask.value && !hostConversation?.value?.selected;
    if (props.mainHasMessages) {
      newTaskOpen.value = true;
      return;
    }
    // Nothing to copy: create directly, and show the dialog only for a failure.
    includeRecentChatContext.value = false;
    createTaskError.value = "";
    creatingTaskId.value = "";
    await createTask();
    if (!createTaskError.value) return;
    const failure = { message: createTaskError.value, taskId: creatingTaskId.value };
    newTaskOpen.value = true;
    await nextTick();
    createTaskError.value = failure.message;
    creatingTaskId.value = failure.taskId;
  }

  function cancelNewTask() {
    if (creatingTask.value) return;
    newTaskOpen.value = false;
    if (newTaskReturnsToMain.value) selectMainChat();
  }

  async function createTask() {
    const revision = ++selectionRevision.value;
    creatingTask.value = true;
    createTaskError.value = "";
    hostConversation?.value?.close();
    try {
      await temporary.createTask({ includeRecentChatContext: includeRecentChatContext.value, taskId: creatingTaskId.value });
      if (revision === selectionRevision.value) newTaskOpen.value = false;
    } catch (error) {
      if (revision === selectionRevision.value) {
        creatingTaskId.value = error.taskId || "";
        createTaskError.value = error.message || "Temporary chat could not be created.";
      }
    } finally { if (revision === selectionRevision.value) creatingTask.value = false; }
  }

  return {
    cancelNewTask,
    createTask,
    createTaskError,
    creatingTask,
    creatingTaskId,
    includeRecentChatContext,
    newTaskOpen,
    openNewTask
  };
}

export { useVibe64TemporaryAiNewTask };
