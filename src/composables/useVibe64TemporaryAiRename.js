import { computed, ref } from "vue";

/** The Rename chat dialog's state: the chat being renamed, its new name, and the save. */
function useVibe64TemporaryAiRename(temporary) {
  const renamingTaskId = ref("");
  const renameValue = ref("");
  const renameError = ref("");
  const renamePending = ref(false);
  const renamingTask = computed(() => temporary.tasks.value.find(task => task.id === renamingTaskId.value) || null);

  function openRename(task) {
    renameValue.value = task.title;
    renameError.value = "";
    renamingTaskId.value = task.id;
  }

  async function submitRename() {
    renamePending.value = true;
    renameError.value = "";
    try {
      await temporary.renameTask(renamingTaskId.value, renameValue.value);
      renamingTaskId.value = "";
    } catch (error) {
      renameError.value = error.message || "The chat could not be renamed.";
    } finally {
      renamePending.value = false;
    }
  }

  return {
    openRename,
    renameError,
    renamePending,
    renameValue,
    renamingTask,
    renamingTaskId,
    submitRename
  };
}

export { useVibe64TemporaryAiRename };
