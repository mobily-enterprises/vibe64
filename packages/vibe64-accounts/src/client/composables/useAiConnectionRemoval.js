import { computed, ref } from "vue";

/**
 * Removing one AI connection after confirmation, through the owner of its kind:
 * a provider key in Codex or Claude Code, a native sign-out, or an OpenCode key.
 */
function useAiConnectionRemoval({ codexProviders, nativeAccounts, removingProviderId, removeConnection, emit }) {
  const removeOpen = ref(false);
  const removeTarget = ref(null);
  const nativeRemoving = ref(false);

  const removeRunning = computed(() => codexProviders.busy.value || (
    ["codex", "claude"].includes(removeTarget.value?.kind)
      ? nativeRemoving.value
      : Boolean(removingProviderId.value) && removingProviderId.value === String(removeTarget.value?.id || "")
  ));

  /** Asks to confirm removing a connection. */
  function requestRemove(connection = {}) {
    removeTarget.value = connection;
    removeOpen.value = true;
  }

  /** Removes the confirmed connection and closes the dialog once it is gone. */
  async function confirmRemove() {
    const target = removeTarget.value;
    const providerId = String(target?.id || "");
    if (!providerId || removeRunning.value) return;
    let response = null;
    try {
      if (target?.kind === "codex-provider") {
        response = await codexProviders.change({ modelProviderId: providerId, engineId: target.engineId, remove: true });
      } else if (["codex", "claude"].includes(target?.kind)) {
        nativeRemoving.value = true;
        response = await nativeAccounts.logout(target.kind);
        // The sign-out's own account row shows at once; the rest reload behind it.
        if (response?.ok !== false) {
          nativeAccounts.showAccount(response?.account);
          void nativeAccounts.reloadLocalStatus().catch(() => {});
        }
      } else {
        response = await removeConnection(providerId);
      }
    } catch {
      return;
    } finally {
      nativeRemoving.value = false;
    }
    if (response?.ok !== false) {
      removeOpen.value = false;
      removeTarget.value = null;
      emit("changed");
    }
  }

  return {
    confirmRemove,
    nativeRemoving,
    removeOpen,
    removeRunning,
    removeTarget,
    requestRemove
  };
}

export { useAiConnectionRemoval };
