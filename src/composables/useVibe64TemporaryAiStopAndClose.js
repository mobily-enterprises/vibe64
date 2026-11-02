import { computed, ref } from "vue";

/**
 * Stopping and closing temporary chats: an unfinished Update repair asks for
 * confirmation before it closes, and each failure stays beside its chat.
 */
function useVibe64TemporaryAiStopAndClose({ temporary, selectionRevision, emit }) {
  const closeTaskId = ref("");
  const closingTask = ref(false);
  const stoppingTaskId = ref("");
  const actionErrors = ref({});
  const taskToClose = computed(() => temporary.tasks.value.find((task) => task.id === closeTaskId.value));

  function requestCloseTask(task) {
    if (task.recoveryOperation === "update" && task.recoveryOutcome !== "succeeded" && (task.busy || task.messages.length)) {
      closeTaskId.value = task.id;
      return;
    }
    void closeTask(task.id);
  }

  async function closeTask(taskId, { returnToMainChat = false } = {}) {
    selectionRevision.value += 1;
    closingTask.value = true;
    delete actionErrors.value[taskId];
    try {
      await temporary.closeTask(taskId);
      closeTaskId.value = "";
      if (returnToMainChat && !temporary.tasks.value.some((task) => task.id === taskId)) {
        emit("select-main-chat");
      }
    } catch (error) {
      actionErrors.value[taskId] = error?.message || "Temporary AI could not be closed. The chat is still open; try again.";
    } finally {
      closingTask.value = false;
    }
  }

  async function stopTask(taskId) {
    stoppingTaskId.value = taskId;
    delete actionErrors.value[taskId];
    try {
      await temporary.stopTask(taskId);
    } catch (error) {
      actionErrors.value[taskId] = error?.message || "Temporary AI could not be stopped. Try again.";
    } finally {
      stoppingTaskId.value = "";
    }
  }

  return {
    actionErrors,
    closeTask,
    closeTaskId,
    closingTask,
    requestCloseTask,
    stopTask,
    stoppingTaskId,
    taskToClose
  };
}

export { useVibe64TemporaryAiStopAndClose };
