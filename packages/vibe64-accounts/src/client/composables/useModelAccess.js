import { computed, onBeforeUnmount, ref, watch } from "vue";
import { zenCheckIsRunning } from "../lib/zenModelCheck.js";

/**
 * Which models a connection may use: unlocking or locking paid models, with a
 * confirmation before unlocking, and the Zen model check, whose progress is
 * reloaded every two seconds while it runs.
 * @param {{
 *   connections: import("./useAiConnections.js").AiConnectionList,
 *   reload: import("./useAiConnections.js").AiConnections["reload"],
 *   updateModelAccess: import("./useAiConnections.js").AiConnections["updateModelAccess"],
 *   updatingModelAccessProviderId: import("vue").Ref<string>,
 *   emit: import("./useAiConnectionManager.js").AiConnectionEmit
 * }} options
 */
function useModelAccess({ connections, reload, updateModelAccess, updatingModelAccessProviderId, emit }) {
  const modelAccessConfirmOpen = ref(false);
  const modelAccessTarget = ref(null);
  let zenProgressDisposed = false;
  let zenProgressTimer = null;

  const modelAccessRunning = computed(() => (
    Boolean(updatingModelAccessProviderId.value) &&
    updatingModelAccessProviderId.value === String(modelAccessTarget.value?.id || "")
  ));
  const zenCheckRunning = computed(() => connections.value.some((connection) => (
    connection.id === "opencode" && zenCheckIsRunning(connection)
  )));

  /** Reloads the connections in two seconds while a Zen check runs, and again after each reload. */
  function scheduleZenProgressRefresh() {
    if (zenProgressDisposed || zenProgressTimer || !zenCheckRunning.value) return;
    zenProgressTimer = setTimeout(async () => {
      zenProgressTimer = null;
      try {
        await reload();
      } finally {
        scheduleZenProgressRefresh();
      }
    }, 2_000);
  }

  /** Locks paid models at once; unlocking asks for confirmation first. */
  function requestModelAccess(connection = {}, unlocked = false) {
    if (!connection.modelAccess?.configurable || updatingModelAccessProviderId.value) return;
    modelAccessTarget.value = connection;
    if (unlocked === true) {
      modelAccessConfirmOpen.value = true;
      return;
    }
    void applyModelAccess(false);
  }

  /** Unlocks paid models once the person confirms. */
  async function confirmModelAccessUnlock() {
    modelAccessConfirmOpen.value = false;
    await applyModelAccess(true);
  }

  /** Saves the requested connection's model access. */
  async function applyModelAccess(unlocked) {
    const providerId = String(modelAccessTarget.value?.id || "");
    if (!providerId || updatingModelAccessProviderId.value) return null;
    try {
      const response = await updateModelAccess(
        providerId,
        unlocked === true ? "enable-all" : "disable-additional"
      );
      if (response?.ok !== false) emit("changed");
      return response;
    } finally {
      if (!modelAccessConfirmOpen.value) modelAccessTarget.value = null;
    }
  }

  /** Runs one Zen model access operation on the OpenCode Zen connection. */
  async function applyZenModelAccess(account = {}, operation = "") {
    const providerId = String(account.id || "");
    if (
      providerId !== "opencode" ||
      !operation ||
      updatingModelAccessProviderId.value
    ) {
      return null;
    }
    const response = await updateModelAccess(providerId, operation);
    if (response?.ok !== false) {
      emit("changed");
    }
    return response;
  }

  watch(zenCheckRunning, (running) => {
    if (!running && zenProgressTimer) {
      clearTimeout(zenProgressTimer);
      zenProgressTimer = null;
    }
    if (running) scheduleZenProgressRefresh();
  }, { immediate: true });

  onBeforeUnmount(() => {
    zenProgressDisposed = true;
    if (zenProgressTimer) clearTimeout(zenProgressTimer);
    zenProgressTimer = null;
  });

  return {
    applyModelAccess,
    applyZenModelAccess,
    confirmModelAccessUnlock,
    modelAccessConfirmOpen,
    modelAccessRunning,
    modelAccessTarget,
    requestModelAccess,
    scheduleZenProgressRefresh,
    zenCheckRunning
  };
}

export { useModelAccess };
