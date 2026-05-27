import { ref } from "vue";

function useVibe64FixCodexDialog() {
  const fixDialogOpen = ref(false);
  const fixJob = ref(null);
  const fixTerminal = ref(null);

  function openFixCodexDialog(response = {}) {
    if (response?.ok === false) {
      return false;
    }
    fixJob.value = response.fixJob || null;
    fixTerminal.value = response.id ? response : null;
    fixDialogOpen.value = Boolean(fixJob.value && fixTerminal.value);
    return fixDialogOpen.value;
  }

  function closeFixCodexDialog() {
    fixDialogOpen.value = false;
  }

  return {
    closeFixCodexDialog,
    fixDialogOpen,
    fixJob,
    fixTerminal,
    openFixCodexDialog
  };
}

export {
  useVibe64FixCodexDialog
};
