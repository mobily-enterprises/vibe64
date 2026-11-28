import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useRealtimeSocket } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { STUDIO_PLANNED_RESTART_ENDPOINT } from "@/lib/studioGateApi.js";
import { clientUpdateOffer, dismissClientUpdateOffer, hostClientUpdateOffer } from "@/lib/vibe64ClientUpdateOffer.js";
import { editorReconnect } from "@/lib/vibe64EditorReconnect.js";
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
  shown: ref(readShown()),
  // The page says "Updating…" (src/error.js): the editor does not answer, as while it restarts.
  updating: ref(false)
};

/**
 * Keeps the page's planned restart current: the shell's banner runs it once for the page, so every control that
 * reads usePlannedRestart() follows one read. The banner also shows JSKIT's offer to reload after an update, and
 * follows whether the page says "Updating…".
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
  const endHosting = hostClientUpdateOffer();
  // Unreachable now is "Updating…" in a moment, or answered (and the banner back) at once.
  shared.updating.value = editorReconnect.unreachable();
  const stopFollowingEditor = editorReconnect.subscribe((event) => {
    shared.updating.value = event.type === "updating";
  });
  // The countdown's clock while a notice is in force, which also ends the notice here at its expiry, before the next read.
  let ticking = null;
  const tick = () => { shared.now.value = Date.now(); };
  function stopTicking() {
    clearInterval(ticking);
    ticking = null;
  }
  watch(() => resource.data.value, (value) => {
    shared.status.value = value?.ok === true ? value : null;
    stopTicking();
    if (shared.status.value?.active) ticking = setInterval(tick, 1000);
    tick();
  }, { immediate: true });
  onScopeDispose(() => {
    socket.off("connect", reconnected);
    stopTicking();
    endHosting();
    stopFollowingEditor();
  });
}

/**
 * The host's planned restart as every page sees it: whether a notice is in force (its time and reason, and the
 * "Paused until HH:MM" the paused controls show), and once after the restart what it stopped. A host's own pages use
 * it for their own paused controls. The banner also reads JSKIT's offer to reload after an update (`updateOffer`) and
 * whether the page says "Updating…" (`updating`).
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
  // The banner's Dismiss closes what it shows: the message after the restart and the offer to reload with it.
  function dismissRestarted() {
    dismissClientUpdateOffer();
    const id = restarted.value?.id;
    if (!id) return;
    shared.shown.value = id;
    try {
      globalThis.localStorage?.setItem(SHOWN_KEY, id);
    } catch {
      // Without storage the banner goes for this page only.
    }
  }
  return {
    active: computed(() => Boolean(notice.value)),
    dismissRestarted,
    notice,
    now: shared.now,
    pausedLabel: computed(() => (notice.value ? plannedRestartPausedLabel(notice.value) : "")),
    reason: computed(() => notice.value?.reason || ""),
    restartAt: computed(() => notice.value?.restartAt || ""),
    restarted,
    updateOffer: clientUpdateOffer,
    updating: shared.updating
  };
}

export { usePlannedRestart, usePlannedRestartWatch };
