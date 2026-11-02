import { onScopeDispose, watch } from "vue";

const SESSION_RENEWAL_POLL_INTERVAL_MS = 1_200;
const SESSION_RENEWAL_BACKGROUND_POLL_INTERVAL_MS = 5_000;
const SESSION_RENEWAL_RETRY_POLL_INTERVAL_MS = 60_000;

/**
 * Re-reads a renewal while it runs or its cleanup is pending: often while the dialog is open, less
 * often in the background, and once a minute while failed cleanup waits for a retry. Nothing is read
 * while the session's host is inactive.
 * @param {{
 *   hostActive: import("vue").ComputedRef<boolean>,
 *   maintenanceInProgress: import("vue").ComputedRef<boolean>,
 *   maintenanceNeedsRetry: import("vue").ComputedRef<boolean>,
 *   open: import("vue").Ref<boolean>,
 *   projectSlug: import("vue").Ref<string>,
 *   reload: () => Promise<unknown>,
 *   renewal: import("vue").ComputedRef<Record<string, any> | null>,
 *   sessionId: import("vue").ComputedRef<string>
 * }} options
 */
function useVibe64SessionRenewalPolling({
  hostActive,
  maintenanceInProgress,
  maintenanceNeedsRetry,
  open,
  projectSlug,
  reload,
  renewal,
  sessionId
}) {
  let pollTimer = null;
  function clearPoll() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }
  function schedulePoll() {
    clearPoll();
    if (
      !hostActive.value ||
      (
        renewal.value?.status !== "running" &&
        !maintenanceInProgress.value &&
        !maintenanceNeedsRetry.value
      )
    ) {
      return;
    }
    const pollIntervalMs = maintenanceNeedsRetry.value
      ? SESSION_RENEWAL_RETRY_POLL_INTERVAL_MS
      : open.value
        ? SESSION_RENEWAL_POLL_INTERVAL_MS
        : SESSION_RENEWAL_BACKGROUND_POLL_INTERVAL_MS;
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      await reload().catch(() => null);
      schedulePoll();
    }, pollIntervalMs);
  }

  watch([
    hostActive,
    open,
    projectSlug,
    sessionId,
    () => renewal.value?.status,
    () => renewal.value?.maintenance?.status
  ], schedulePoll, { immediate: true });

  onScopeDispose(clearPoll);
}

export {
  SESSION_RENEWAL_BACKGROUND_POLL_INTERVAL_MS,
  SESSION_RENEWAL_RETRY_POLL_INTERVAL_MS,
  useVibe64SessionRenewalPolling
};
