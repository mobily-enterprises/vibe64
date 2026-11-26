import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { pageClientBuildId } from "@jskit-ai/kernel/shared/support/clientBuild";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useRealtimeSocket } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { STUDIO_PLANNED_RESTART_ENDPOINT } from "@/lib/studioGateApi.js";
import { plannedRestartPausedLabel } from "@/lib/vibe64PlannedRestartPresentation.js";
import { VIBE64_SURFACE_ID } from "@/lib/vibe64RequestConfig.js";

// A notice gives five minutes' warning: a read every 20 seconds shows it in time, and the realtime connection's return
// after the restart reads it again at once.
const POLL_MS = 20_000;
// The restart this browser was already shown, so its banner after the restart shows once.
const SHOWN_KEY = "vibe64.plannedRestart.shown";

function readShown() {
  try {
    return globalThis.localStorage?.getItem(SHOWN_KEY) || "";
  } catch {
    return "";
  }
}

// readable-check: allow module-state - shared resource: the page's one read of the host's planned restart, which the shell's banner keeps current and every paused control reads
const shared = {
  status: shallowRef(null),
  now: ref(Date.now()),
  shown: ref(readShown())
};

/**
 * Keeps the page's planned restart current: the shell's banner runs it once for the page, so every control that
 * reads usePlannedRestart() follows one read.
 */
function usePlannedRestartWatch() {
  const resource = useEndpointResource({
    fallbackLoadError: "Vibe64 could not check for a planned restart.",
    path: STUDIO_PLANNED_RESTART_ENDPOINT,
    queryKey: ["vibe64", VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, "planned-restart"],
    queryOptions: { refetchInterval: POLL_MS, refetchOnWindowFocus: true, retry: false },
    // A check that cannot load shows nothing rather than a recovery notice on every page.
    requestRecovery: false
  });
  const socket = useRealtimeSocket();
  const reconnected = () => void resource.reload();
  socket.on("connect", reconnected);
  let ticking = null;
  watch(() => resource.data.value, (value) => {
    shared.status.value = value?.ok === true ? value : null;
    clearInterval(ticking);
    // The countdown's clock, which also ends the notice here at its expiry, before the next read.
    ticking = shared.status.value?.active ? setInterval(() => { shared.now.value = Date.now(); }, 1000) : null;
    shared.now.value = Date.now();
  }, { immediate: true });
  onScopeDispose(() => {
    socket.off("connect", reconnected);
    clearInterval(ticking);
  });
}

/**
 * The host's planned restart as every page sees it: whether a notice is in force (its time and reason, and the
 * "Paused until HH:MM" the paused controls show), and once after the restart what it stopped. A host's own pages use
 * it for their own paused controls.
 */
function usePlannedRestart() {
  const notice = computed(() => {
    const value = shared.status.value?.active || null;
    return value && shared.now.value < Date.parse(value.expiresAt) ? value : null;
  });
  const restarted = computed(() => {
    const value = shared.status.value?.restarted || null;
    return value && value.id !== shared.shown.value ? value : null;
  });
  function dismissRestarted() {
    const id = restarted.value?.id;
    if (!id) return;
    shared.shown.value = id;
    try {
      globalThis.localStorage?.setItem(SHOWN_KEY, id);
    } catch {
      // Without storage the banner goes for this page only.
    }
  }
  // The page runs another client build than the server serves now: only then does the message offer Reload.
  const clientChanged = computed(() => {
    const page = pageClientBuildId();
    const served = String(shared.status.value?.clientBuildId || "");
    return Boolean(page && served && page !== served);
  });
  return {
    active: computed(() => Boolean(notice.value)),
    clientChanged,
    dismissRestarted,
    notice,
    now: shared.now,
    pausedLabel: computed(() => (notice.value ? plannedRestartPausedLabel(notice.value) : "")),
    reason: computed(() => notice.value?.reason || ""),
    restartAt: computed(() => notice.value?.restartAt || ""),
    restarted
  };
}

export { usePlannedRestart, usePlannedRestartWatch };
