import { computed, onScopeDispose, ref, toValue, watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { useVibe64ProjectSlug } from "/src/composables/useVibe64ProjectScope.js";

import { USAGE_RECORDING_CHANGED_EVENT } from "../shared/contract.js";

// Session recording API base, under the app surface's project API path:
// paths.api(USAGE_RECORDING_API_SUFFIX, { surface: "app" }) + "/sessions/:sessionId".
const USAGE_RECORDING_API_SUFFIX = "/vibe64/usage-recordings";

const RUNNING_STATES = Object.freeze(["starting", "recording", "stopping"]);
const FINAL_STATES = Object.freeze(["stopped", "failed", "unavailable"]);

// useVibe64UsageRecording({ sessionId }): one session's recording state.
// sessionId may be a string, ref or getter. Returns:
//   recording          Ref<recording | null> (the current or recently stopped one)
//   active             ComputedRef<boolean>, true while starting, recording or stopping
//   elapsedMs          ComputedRef<number>, from the server's startedAt and serverTime
//   loading, error     Ref<boolean>, Ref<string>
//   refresh()          reads GET /current
//   readTargets()      reads GET /targets → { targets }
//   start({ targetId, parameters })  POST / → { recording }
//   stop()             POST /:recordingId/stop (idempotent)
//   dismiss()          POST /:recordingId/dismiss
//   recordInteraction({ id, at, label, kind, componentFile })  POST /:recordingId/interactions
// Every reader of one project's session shares one cached `current` read, so the
// indicator, the usage view and the Preview controls show the same recording.
// Realtime changes and operation results update that shared entry. Operations
// resolve to their result, or to null after setting error.
function useVibe64UsageRecording({ sessionId = "" } = {}) {
  const paths = usePaths();
  const projectSlug = useVibe64ProjectSlug();
  const queryClient = useQueryClient();
  const id = computed(() => String(toValue(sessionId) || "").trim());
  const enabled = computed(() => Boolean(projectSlug.value && id.value));
  const sessionPath = computed(() =>
    `${paths.api(USAGE_RECORDING_API_SUFFIX, { surface: "app" })}/sessions/${encodeURIComponent(id.value)}`);
  const queryKey = computed(() => ["vibe64", "usage-recording", projectSlug.value, id.value, "current"]);

  // Realtime keeps the shared entry current, so later readers reuse it.
  const resource = useEndpointResource({
    enabled,
    fallbackLoadError: "The recording could not be loaded.",
    path: computed(() => `${sessionPath.value}/current`),
    queryKey,
    queryOptions: { refetchOnWindowFocus: false, staleTime: Infinity },
    requestRecoveryLabel: "Recording"
  });
  const recording = computed(() => resource.data.value?.recording || null);
  const active = computed(() => RUNNING_STATES.includes(recording.value?.state));

  // The server clock minus the client clock when `current` arrived. Shared
  // updates keep that arrival time, so the correction survives them.
  const clockOffsetMs = computed(() => {
    const serverTime = Date.parse(resource.data.value?.serverTime || "");
    const receivedAt = resource.query.dataUpdatedAt.value;
    return Number.isFinite(serverTime) && receivedAt ? serverTime - receivedAt : 0;
  });
  const now = ref(Date.now());
  let ticker = null;
  watch(active, (running) => {
    clearInterval(ticker);
    ticker = null;
    now.value = Date.now();
    if (running) ticker = setInterval(() => { now.value = Date.now(); }, 1000);
  }, { immediate: true });
  onScopeDispose(() => clearInterval(ticker));
  const elapsedMs = computed(() => {
    const current = recording.value;
    const startedAt = Date.parse(current?.startedAt || "");
    if (!Number.isFinite(startedAt)) return 0;
    const stoppedAt = Date.parse(current.stoppedAt || "");
    if (Number.isFinite(stoppedAt)) return Math.max(0, stoppedAt - startedAt);
    return active.value ? Math.max(0, now.value + clockOffsetMs.value - startedAt) : 0;
  });

  function applyRecording(next) {
    queryClient.setQueryData(queryKey.value, (current) => ({ ...current, recording: next }),
      { updatedAt: resource.query.dataUpdatedAt.value || undefined });
    return next;
  }

  // Readers refetch together on a shared event; one request serves them all.
  async function refresh() {
    if (!enabled.value) return null;
    const result = await resource.query.refetch({ cancelRefetch: false });
    return result.data?.recording || null;
  }

  useRealtimeEvent({
    enabled,
    event: USAGE_RECORDING_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => payload.projectSlug === projectSlug.value && payload.sessionId === id.value,
    onEvent: ({ payload }) => {
      const current = recording.value;
      if (current?.id === payload.recordingId) {
        const changes = Object.fromEntries(["state", "counts", "startedAt", "stoppedAt", "stopReason"]
          .filter((field) => payload[field] !== undefined)
          .map((field) => [field, payload[field]]));
        applyRecording({ ...current, ...changes });
      }
      if (current?.id !== payload.recordingId || FINAL_STATES.includes(payload.state)) void refresh();
    }
  });
  useRealtimeEvent({ enabled, event: "connect", onEvent: () => refresh() });

  const pending = ref(0);
  const actionError = ref("");
  const loading = computed(() => resource.isInitialLoading.value || pending.value > 0);
  const error = computed(() => actionError.value || resource.loadError.value);

  async function send(suffix, { method = "POST", body, fallback }) {
    pending.value += 1;
    actionError.value = "";
    try {
      return await getHttpWebClient().request(`${sessionPath.value}${suffix}`, { method, body });
    } catch (failure) {
      actionError.value = String(failure?.message || "").trim() || fallback;
      return null;
    } finally {
      pending.value -= 1;
    }
  }

  const recordingPath = (suffix) => `/${encodeURIComponent(recording.value.id)}${suffix}`;

  async function readTargets() {
    const result = await send("/targets", { method: "GET", fallback: "Recording targets could not be loaded." });
    return result ? { targets: Array.isArray(result.targets) ? result.targets : [] } : null;
  }

  async function start({ targetId, parameters } = {}) {
    const result = await send("", {
      body: { targetId, ...(parameters ? { parameters } : {}) },
      fallback: "The recording could not be started."
    });
    return result?.recording ? applyRecording(result.recording) : null;
  }

  // Stop stays available while stopping: the server treats a repeat as the same stop.
  async function stop() {
    if (!recording.value?.id) return null;
    const result = await send(recordingPath("/stop"), { fallback: "The recording could not be stopped." });
    return result?.recording ? applyRecording(result.recording) : null;
  }

  async function dismiss() {
    if (!recording.value?.id) return null;
    const result = await send(recordingPath("/dismiss"), { fallback: "The recording could not be dismissed." });
    return result?.recording ? applyRecording(result.recording) : null;
  }

  async function recordInteraction({ id: interactionId, at, label = "", kind = "click", componentFile = null } = {}) {
    if (recording.value?.state !== "recording") return null;
    return send(recordingPath("/interactions"), {
      body: { id: interactionId, at, label: String(label).slice(0, 80), kind, componentFile: componentFile || null },
      fallback: "The interaction could not be recorded."
    });
  }

  return {
    recording,
    active,
    elapsedMs,
    loading,
    error,
    refresh,
    readTargets,
    start,
    stop,
    dismiss,
    recordInteraction
  };
}

export {
  USAGE_RECORDING_API_SUFFIX,
  useVibe64UsageRecording
};
