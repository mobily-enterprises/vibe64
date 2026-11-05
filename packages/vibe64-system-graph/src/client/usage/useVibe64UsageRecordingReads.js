import { computed, onBeforeUnmount, ref, watch } from "vue";

import { SEARCH_DELAY_MS, recordingWeb, requestCount, unavailableRuntimes } from "./usageModel.js";

const LIVE_REFRESH_MS = 5000;
const LIVE_STATES = new Set(["starting", "recording", "stopping"]);

/**
 * Recording in Usage: the project's recordings, the chosen recording's requests (followed while it runs) and what
 * the chosen request ran, joined to the last scan, with the bindings of the list that picks them.
 * @param {object} options
 * @param {{ active: boolean, sessionId: string, snapshotKey: string, state: import("./usageModel.js").UsageState }} options.props the view's props
 * @param {import("./useVibe64UsageWeb.js").Vibe64UsageWeb} options.usage the view's usage reads
 * @param {import("vue").ComputedRef<string>} options.mode imports, calls or recording
 * @param {import("vue").Ref<boolean>} options.pickerOpen whether the phone's request picker is open
 * @param {(patch: Partial<import("./usageModel.js").UsageState>) => void} options.update changes the view's address state
 * @param {() => void} options.closePanel closes the selected function's panel
 */
function useVibe64UsageRecordingReads({ props, usage, mode, pickerOpen, update, closePanel }) {
  const requestSearch = ref("");
  const includeEmpty = ref(false);
  const recordings = computed(() => usage.recordings.data.value?.recordings || []);
  const unavailable = computed(() => unavailableRuntimes(usage.targets.data.value?.targets || []));

  const recordingActive = computed(() => props.active && mode.value === "recording");
  const selectedRecording = computed(() => recordings.value.find((recording) => recording.id === props.state.recording) || null);
  async function loadRecordings() {
    await Promise.all([usage.recordings.run(), usage.targets.run(), usage.routes.value.length ? null : usage.loadRoutes()]);
  }
  let recordingsKey = "";
  watch([recordingActive, () => props.sessionId, () => props.snapshotKey], ([on, sessionId, key]) => {
    if (!on || recordingsKey === `${sessionId}\n${key}`) return;
    recordingsKey = `${sessionId}\n${key}`;
    void loadRecordings();
  }, { immediate: true });
  watch(recordings, (list) => {
    if (mode.value === "recording" && list.length && !list.some((recording) => recording.id === props.state.recording)) {
      update({ recording: list[0].id, request: "", subsystem: "" });
    }
  });

  // A recording opened while it runs lists its newest requests first, so new
  // ones appear on top; one opened after it stopped reads in recorded order.
  const live = computed(() => LIVE_STATES.has(selectedRecording.value?.state));
  const newestFirst = ref(false);
  watch(() => selectedRecording.value?.id, (id) => { if (id) newestFirst.value = live.value; }, { immediate: true });

  let requestTimer;
  const requestFilter = () => ({ recordingId: props.state.recording, q: requestSearch.value.trim(), includeEmpty: includeEmpty.value, newestFirst: newestFirst.value });
  const loadRequests = (read = "run") => (recordingActive.value && selectedRecording.value ? usage.requests[read](requestFilter()) : null);
  watch(requestSearch, () => {
    clearTimeout(requestTimer);
    requestTimer = setTimeout(loadRequests, SEARCH_DELAY_MS);
  });
  watch([recordingActive, () => selectedRecording.value?.id, includeEmpty, newestFirst, () => props.snapshotKey], () => { void loadRequests(); }, { immediate: true });

  let resultKey = "";
  function loadResult(force = false) {
    const { recording, request } = props.state;
    const key = JSON.stringify([recording, request, props.sessionId, props.snapshotKey]);
    if (!recordingActive.value || !recording || !request || (!force && key === resultKey)) return;
    resultKey = key;
    void usage.result.run({ recordingId: recording, requestId: request });
  }
  watch([recordingActive, () => props.state.recording, () => props.state.request, () => props.snapshotKey], () => loadResult(), { immediate: true });
  watch(() => props.state.request, () => closePanel());

  // While a recording runs, its requests list follows it, and reads once more
  // when it stops so its last requests are listed too.
  watch(() => recordingActive.value && live.value, (following, wasFollowing, onCleanup) => {
    if (!following) {
      if (wasFollowing) void loadRequests("refresh");
      return;
    }
    const timer = setInterval(() => { void usage.recordings.run(); void loadRequests("refresh"); }, LIVE_REFRESH_MS);
    onCleanup(() => clearInterval(timer));
  });

  const resultFresh = computed(() => {
    const data = usage.result.data.value;
    return Boolean(data && data.recordingId === props.state.recording && data.requestId === props.state.request);
  });
  const recorded = computed(() => (resultFresh.value ? recordingWeb(usage.result.data.value.functions, usage.result.data.value.join) : null));
  // The scan the recording ran against is no longer the one its functions were joined to.
  const changedSinceRecording = computed(() => {
    const recordedScan = selectedRecording.value?.sourceIdentity;
    const currentScan = resultFresh.value ? usage.result.data.value.join?.snapshot?.sourceIdentity : null;
    return Boolean(recordedScan && currentScan && recordedScan !== currentScan);
  });
  const requestRows = computed(() => usage.requests.data.value?.requests || []);
  const requestTotal = computed(() => usage.requests.data.value?.total ?? null);
  // The chosen request's row from the pages read, else the one its result carries.
  const resultRead = computed(() => (resultFresh.value ? usage.result.data.value : null));
  const selectedRequest = computed(() => requestRows.value.find((request) => request.id === props.state.request)
    || (resultRead.value?.request?.id === props.state.request ? resultRead.value.request : null));
  const selectedInteraction = computed(() => {
    const id = selectedRequest.value?.interaction;
    return id ? [...(usage.requests.data.value?.interactions || []), ...(resultRead.value?.interactions || [])].find((item) => item.id === id) || null : null;
  });

  const recordingBindings = computed(() => ({
    sessionId: props.sessionId,
    recordings: recordings.value,
    recordingId: props.state.recording,
    requests: requestRows.value,
    interactions: usage.requests.data.value?.interactions || [],
    total: requestTotal.value,
    hasMore: Boolean(usage.requests.data.value?.nextCursor) && (requestTotal.value == null || requestCount(requestRows.value) < requestTotal.value),
    newestFirst: newestFirst.value,
    requestId: props.state.request,
    search: requestSearch.value,
    includeEmpty: includeEmpty.value,
    routes: usage.routes.value,
    unavailable: unavailable.value,
    loading: usage.recordings.loading.value,
    requestsLoading: usage.requests.loading.value,
    error: usage.recordings.error.value || usage.requests.error.value
  }));
  const recordingHandlers = {
    deleted: () => {
      update({ recording: "", request: "", subsystem: "" });
      void loadRecordings();
    },
    "update:recordingId": (id) => update({ recording: id, request: "", subsystem: "" }),
    "update:requestId": (id) => { pickerOpen.value = false; update({ request: id, subsystem: "" }); },
    "update:search": (value) => { requestSearch.value = value; },
    "update:includeEmpty": (value) => { includeEmpty.value = value; },
    more: () => usage.requests.more(),
    retry: () => { void loadRecordings(); void loadRequests(); }
  };

  function recordingStarted(event = {}) {
    const id = event.recording?.id;
    if (id) update({ mode: "recording", recording: id, request: "", subsystem: "" });
    recordingsKey = "";
    void loadRecordings();
  }

  onBeforeUnmount(() => clearTimeout(requestTimer));

  return {
    recordings,
    unavailable,
    loadRecordings,
    loadResult,
    resultFresh,
    recorded,
    changedSinceRecording,
    requestRows,
    selectedRequest,
    selectedInteraction,
    recordingBindings,
    recordingHandlers,
    recordingStarted
  };
}

export { useVibe64UsageRecordingReads };
