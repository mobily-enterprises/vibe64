import { computed, ref, watch } from "vue";

function refreshResultError(result = null) {
  if (
    result &&
    typeof result === "object" &&
    (result.isError === true || result.status === "error")
  ) {
    return result.error instanceof Error
      ? result.error
      : new Error(String(result.error || "Session list could not be refreshed."));
  }
  return null;
}

/**
 * Opens the fresh session once a renewal completes: it refreshes the session list, selects the
 * successor and focuses its chat, or reopens the dialog with the reason it could not. Each successor
 * opens once per selected session.
 * @param {{
 *   focusSession: (sessionId: string) => unknown,
 *   hostActive: import("vue").ComputedRef<boolean>,
 *   open: import("vue").Ref<boolean>,
 *   projectSlug: import("vue").Ref<string>,
 *   refreshSessionData: (options: { includeList: boolean, reason: string }) => unknown,
 *   renewal: import("vue").ComputedRef<Record<string, any> | null>,
 *   selectSession: (sessionId: string) => unknown,
 *   sessionId: import("vue").ComputedRef<string>,
 *   triggerFocusTarget: import("vue").ShallowRef<HTMLElement | null>
 * }} options
 */
function useVibe64SessionRenewalSuccessor({
  focusSession,
  hostActive,
  open,
  projectSlug,
  refreshSessionData,
  renewal,
  selectSession,
  sessionId,
  triggerFocusTarget
}) {
  const handledSuccessorId = ref("");
  const successorSelectionPendingId = ref("");
  const successorSelectionError = ref("");

  function availableSuccessorId() {
    return renewal.value?.status === "completed"
      ? String(renewal.value?.successor?.sessionId || "").trim()
      : "";
  }

  async function openSuccessor() {
    const successorId = availableSuccessorId();
    if (
      !successorId ||
      !hostActive.value ||
      handledSuccessorId.value === successorId ||
      successorSelectionPendingId.value
    ) {
      return false;
    }
    const predecessorSessionId = sessionId.value;
    successorSelectionPendingId.value = successorId;
    successorSelectionError.value = "";
    try {
      const refreshResult = await refreshSessionData({
        includeList: true,
        reason: "session-renewal-successor-available"
      });
      const refreshFailure = refreshResultError(refreshResult);
      if (refreshFailure) {
        throw refreshFailure;
      }
      if (
        !hostActive.value ||
        sessionId.value !== predecessorSessionId ||
        availableSuccessorId() !== successorId
      ) {
        return false;
      }
      await Promise.resolve(selectSession(successorId));
      handledSuccessorId.value = successorId;
      triggerFocusTarget.value = null;
      open.value = false;
      await Promise.resolve(focusSession(successorId)).catch(() => null);
      return true;
    } catch (error) {
      if (hostActive.value && sessionId.value === predecessorSessionId) {
        successorSelectionError.value = error instanceof Error
          ? error.message
          : String(error || "The fresh session could not be opened.");
        open.value = true;
      }
      return false;
    } finally {
      if (successorSelectionPendingId.value === successorId) {
        successorSelectionPendingId.value = "";
      }
    }
  }

  watch([projectSlug, sessionId], () => {
    handledSuccessorId.value = "";
    successorSelectionPendingId.value = "";
    successorSelectionError.value = "";
  });
  watch([hostActive, () => availableSuccessorId()], ([activeNow, successorId]) => {
    if (activeNow && successorId && handledSuccessorId.value !== successorId) {
      void openSuccessor();
    }
  }, { immediate: true });

  return {
    openSuccessor,
    successorSelectionError,
    successorSelectionPending: computed(() => Boolean(successorSelectionPendingId.value))
  };
}

export {
  useVibe64SessionRenewalSuccessor
};
