import { computed, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { sameQuery, sameUsageState, usageQueryFor, usageStateFromQuery } from "./usageModel.js";

/**
 * A request from elsewhere in the session to open Usage: a recording's request, or an entry picked in Preview.
 * @typedef {object} UsageOpenRequest
 * @property {string} [mode]
 * @property {string} [entryId]
 * @property {string} [recordingId]
 * @property {string} [requestId]
 * @property {number} nonce a new request for the same place opens it again
 */

/**
 * What Usage's entry list looks for: Show usage's search and kind, or an entry opened from elsewhere.
 * @typedef {object} UsageFindRequest
 * @property {string} [q]
 * @property {string} [kind]
 * @property {string} [entryId]
 */

/**
 * A way back to Architecture from the source viewer, carrying where Usage was.
 * @typedef {object} ArchitectureRestoreRequest
 * @property {Partial<import("./usageModel.js").UsageState>} [usage]
 * @property {number} sequence
 */

/**
 * The Architecture view's Map | Usage state. The system dashboard route's query keeps Usage's state,
 * so a reload reopens the same entry, mode, subsystem, recording and request; requests to open or
 * restore Usage from elsewhere replace it, and switching to Map remembers Usage for the way back.
 * @param {object} options
 * @param {{ active: boolean, usageOpenRequest: UsageOpenRequest | null, restoreRequest: ArchitectureRestoreRequest | null }} options.props the view's props
 * @param {import("vue").Ref<object | null>} options.architecture the loaded architecture snapshot
 * @param {() => void} options.onMapShown called when the view returns to Map
 */
function useVibe64UsageState({ props, architecture, onMapShown }) {
  const route = useRoute();
  const router = useRouter();
  const usageState = ref(usageStateFromQuery(route?.query));
  const usageMounted = ref(usageState.value.view === "usage");
  const usageFind = shallowRef(null);
  const usageSnapshotKey = computed(() => [architecture.value?.sourceHash, architecture.value?.callWeb?.identity].filter(Boolean).join(":"));
  const onSystemRoute = computed(() => props.active && /\/dashboard\/system\/?$/u.test(route?.path || ""));

  watch(() => usageState.value.view, (view) => {
    if (view === "usage") usageMounted.value = true;
    else onMapShown();
  });

  watch([usageState, onSystemRoute], ([state, onRoute]) => {
    if (!onRoute || !router) return;
    const query = usageQueryFor(route.query, state);
    if (!sameQuery(query, route.query)) void router.replace({ query });
  }, { immediate: true });

  watch(() => route?.query, (query) => {
    // A query without Usage keys (a plain tool switch) keeps the current view.
    if (!onSystemRoute.value || !query?.view) return;
    const next = usageStateFromQuery(query);
    if (!sameUsageState(next, usageState.value)) usageState.value = next;
  });

  let handledUsageOpen = null;
  watch(() => props.usageOpenRequest, (request) => {
    if (!request || request === handledUsageOpen) return;
    handledUsageOpen = request;
    usageState.value = usageStateFromQuery({ view: "usage", mode: request.mode || "recording", entry: request.entryId, recording: request.recordingId, request: request.requestId });
    // An entry opened from elsewhere (Pick in Preview) is also searched for in the list.
    if (request.entryId && usageState.value.mode !== "recording") usageFind.value = { entryId: request.entryId };
  }, { immediate: true });

  let handledRestore = null;
  watch(() => props.restoreRequest, (request) => {
    if (!request?.usage || request === handledRestore) return;
    handledRestore = request;
    usageState.value = usageStateFromQuery({ ...request.usage, view: "usage" });
  }, { immediate: true });

  // Map | Usage: leaving Usage remembers its state, so returning (or Show usage) resumes it.
  let usageMemory = null;
  function setArchitectureView(view) {
    if (!view || view === usageState.value.view) return;
    if (view === "map") { usageMemory = usageState.value; usageState.value = usageStateFromQuery({}); }
    else usageState.value = usageMemory || usageStateFromQuery({ view: "usage" });
  }
  function showUsage({ q = "", kind = "" }) {
    const mode = usageMemory && usageMemory.mode !== "recording" ? usageMemory.mode : "calls";
    usageState.value = usageStateFromQuery({ view: "usage", mode });
    usageFind.value = { q, kind };
  }

  return { usageState, usageMounted, usageFind, usageSnapshotKey, setArchitectureView, showUsage };
}

export { useVibe64UsageState };
