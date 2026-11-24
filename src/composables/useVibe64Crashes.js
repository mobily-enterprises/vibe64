import { computed, onScopeDispose, ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useRealtimeSocket } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { crashBugReport } from "@local/vibe64-core/shared/crashText";
import { writeClipboardText } from "@/lib/clipboard.js";
import {
  STUDIO_CRASHES_ACKNOWLEDGE_ENDPOINT,
  STUDIO_CRASHES_ENDPOINT,
  STUDIO_CRASH_SUMMARY_ENDPOINT,
  studioCrashesQueryKey
} from "@/lib/studioGateApi.js";
import { VIBE64_SURFACE_ID } from "@/lib/vibe64RequestConfig.js";

/** The Crashes page's own address, the same on every host. */
const VIBE64_CRASHES_PATH = "/app/crashes";

const crashesQueryKey = (part = "") => studioCrashesQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, part);

/**
 * Acknowledging and copying, shared by the banner and the Crashes page: acknowledging covers the newest crash the
 * person was shown and every older one, then reads both again.
 */
function useVibe64CrashActions() {
  const queryClient = useQueryClient();
  const acknowledging = ref(false);
  const actionError = ref("");
  const copiedId = ref("");

  async function acknowledge(through) {
    if (!through || acknowledging.value) return;
    acknowledging.value = true;
    actionError.value = "";
    try {
      await getHttpWebClient().request(STUDIO_CRASHES_ACKNOWLEDGE_ENDPOINT, { method: "POST", body: { through } });
      await queryClient.invalidateQueries({ queryKey: crashesQueryKey() });
    } catch (error) {
      actionError.value = String(error?.message || "") || "The crashes could not be acknowledged. Try again.";
    } finally {
      acknowledging.value = false;
    }
  }

  async function copyReport(record) {
    actionError.value = "";
    try {
      await writeClipboardText(crashBugReport(record));
      copiedId.value = record.id;
    } catch {
      actionError.value = "This browser would not copy. Open the crash on the Crashes page and select its text.";
    }
  }

  return { acknowledge, acknowledging, actionError, copiedId, copyReport };
}

/**
 * The crashes nobody has acknowledged yet, for the banner on every page. It is read again whenever the realtime
 * connection comes back, as it does after the restart that follows a crash, and when the tab is focused again.
 */
function useVibe64CrashSummary() {
  const resource = useEndpointResource({
    fallbackLoadError: "Vibe64 could not check for crashes.",
    path: STUDIO_CRASH_SUMMARY_ENDPOINT,
    queryKey: crashesQueryKey("summary"),
    queryOptions: { refetchOnWindowFocus: true, retry: false },
    // A banner that cannot load stays away rather than adding a recovery notice to every page.
    requestRecovery: false
  });
  const socket = useRealtimeSocket();
  const reconnected = () => void resource.reload();
  socket.on("connect", reconnected);
  onScopeDispose(() => socket.off("connect", reconnected));

  const { acknowledge, acknowledging, actionError, copiedId, copyReport } = useVibe64CrashActions();
  const summary = computed(() => (resource.data.value?.ok === true ? resource.data.value : null));
  const latest = computed(() => summary.value?.latest || null);
  return {
    acknowledge,
    acknowledging,
    actionError,
    canAcknowledge: computed(() => summary.value?.canAcknowledge === true),
    copiedId,
    copyReport,
    latest,
    unacknowledged: computed(() => Number(summary.value?.unacknowledged || 0)),
    visible: computed(() => Boolean(latest.value))
  };
}

/** Every crash record, newest first, for the Crashes page (the workspace owner's). */
function useVibe64CrashList() {
  const resource = useEndpointResource({
    fallbackLoadError: "The crashes could not be read.",
    path: STUDIO_CRASHES_ENDPOINT,
    queryKey: crashesQueryKey("list"),
    requestRecoveryLabel: "Crashes"
  });
  const { acknowledge, acknowledging, actionError, copiedId, copyReport } = useVibe64CrashActions();
  const list = computed(() => (resource.data.value?.ok === true ? resource.data.value : null));
  return {
    acknowledge,
    acknowledging,
    actionError,
    copiedId,
    copyReport,
    isInitialLoading: resource.isInitialLoading,
    limit: computed(() => Number(list.value?.limit || 0)),
    loadError: computed(() => (list.value ? "" : resource.loadError.value)),
    records: computed(() => (Array.isArray(list.value?.records) ? list.value.records : [])),
    reload: resource.reload,
    removed: computed(() => list.value?.removed || { count: 0, unacknowledged: 0, lastRemovedAt: null }),
    unacknowledged: computed(() => Number(list.value?.unacknowledged || 0))
  };
}

export { VIBE64_CRASHES_PATH, useVibe64CrashList, useVibe64CrashSummary };
