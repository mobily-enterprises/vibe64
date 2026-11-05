import { ref } from "vue";

/**
 * Stopping and closing temporary chats; each failure stays beside its chat.
 */
function useVibe64TemporaryAiStopAndClose({ temporary, selectionRevision }) {
  const closingTask = ref(false);
  const stoppingTaskId = ref("");
  const actionErrors = ref({});

  async function closeTask(taskId) {
    selectionRevision.value += 1;
    closingTask.value = true;
    delete actionErrors.value[taskId];
    try {
      await temporary.closeTask(taskId);
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
    closingTask,
    stopTask,
    stoppingTaskId
  };
}

export { useVibe64TemporaryAiStopAndClose };
