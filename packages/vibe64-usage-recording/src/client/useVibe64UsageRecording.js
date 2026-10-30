import { computed, ref } from "vue";

// Session recording API base, under the app surface's project API path:
// paths.api(USAGE_RECORDING_API_SUFFIX, { surface: "app" }) + "/sessions/:sessionId".
const USAGE_RECORDING_API_SUFFIX = "/vibe64/usage-recordings";

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
//   recordInteraction({ id, at, label, componentFile })  POST /:recordingId/interactions
// Placeholder: inert until the recorder lands. Nothing is fetched and every
// operation resolves to null.
function useVibe64UsageRecording() {
  const recording = ref(null);
  const loading = ref(false);
  const error = ref("");
  const inert = async () => null;

  return {
    recording,
    active: computed(() => ["starting", "recording", "stopping"].includes(recording.value?.state)),
    elapsedMs: computed(() => 0),
    loading,
    error,
    refresh: inert,
    readTargets: inert,
    start: inert,
    stop: inert,
    dismiss: inert,
    recordInteraction: inert
  };
}

export {
  USAGE_RECORDING_API_SUFFIX,
  useVibe64UsageRecording
};
