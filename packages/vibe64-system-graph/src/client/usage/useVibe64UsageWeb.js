import { computed, ref, shallowRef, unref } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { USAGE_RECORDING_API_SUFFIX } from "@local/vibe64-usage-recording/client";

import { SYSTEM_GRAPH_API_SUFFIX } from "../composables/useVibe64SystemGraph.js";

const ENTRY_PAGE = 100;
const REQUEST_PAGE = 200;
const RECORDED_FUNCTIONS = 1500;
const ROUTE_PAGES = 5;

const segment = (value) => encodeURIComponent(String(value || "").trim());

// Drops absent values so they are not sent as "undefined".
function queryOf(values) {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== "" && value !== false));
}

// One read whose latest call wins; answers to earlier calls are discarded.
function latestRead(load) {
  const data = shallowRef(null);
  const loading = ref(false);
  const error = ref("");
  const errorCode = ref("");
  let sequence = 0;
  let controller = null;

  async function run(...args) {
    const current = ++sequence;
    controller?.abort();
    controller = typeof AbortController === "function" ? new AbortController() : null;
    loading.value = true;
    error.value = "";
    errorCode.value = "";
    try {
      const value = await load(controller?.signal, ...args);
      if (current === sequence) data.value = value;
      return current === sequence ? value : null;
    } catch (failure) {
      if (current === sequence) {
        error.value = String(failure?.message || "The usage map could not be read.");
        errorCode.value = String(failure?.code || "");
      }
      return null;
    } finally {
      if (current === sequence) loading.value = false;
    }
  }

  function reset() {
    sequence += 1;
    controller?.abort();
    data.value = null;
    loading.value = false;
    error.value = "";
    errorCode.value = "";
  }

  return { data, loading, error, errorCode, run, reset };
}

// Reads for the usage view: entries, Imports/Calls webs, one function, and a
// recording's requests joined to the call web. The view owns what is shown.
function useVibe64UsageWeb({ sessionId }) {
  const paths = usePaths();
  const client = getHttpWebClient();
  const session = computed(() => segment(unref(sessionId)));
  const usagePath = computed(() => `${paths.api(SYSTEM_GRAPH_API_SUFFIX, { surface: "app" })}/sessions/${session.value}/usage`);
  const recordingPath = computed(() => `${paths.api(USAGE_RECORDING_API_SUFFIX, { surface: "app" })}/sessions/${session.value}`);
  const get = (path, query, signal) => client.request(path, { method: "GET", query: queryOf(query), signal });

  const entryItems = shallowRef([]);
  const entryKinds = shallowRef([]);
  const entryCursor = ref(null);
  const snapshot = shallowRef(null);
  let entryFilter = {};
  const entryRead = latestRead((signal, filter, cursor) => get(`${usagePath.value}/entries`, { q: filter.q, kind: filter.kind, cursor, limit: ENTRY_PAGE }, signal));

  async function searchEntries(filter = {}) {
    entryFilter = { q: String(filter.q || "").trim().slice(0, 80), kind: filter.kind || "" };
    const page = await entryRead.run(entryFilter, null);
    if (!page) return null;
    entryItems.value = page.entries;
    entryKinds.value = page.kinds;
    entryCursor.value = page.nextCursor;
    snapshot.value = page.snapshot;
    return page;
  }

  async function moreEntries() {
    if (!entryCursor.value) return null;
    const page = await entryRead.run(entryFilter, entryCursor.value);
    if (!page) return null;
    entryItems.value = [...entryItems.value, ...page.entries];
    entryCursor.value = page.nextCursor;
    return page;
  }

  const web = latestRead((signal, query) => get(`${usagePath.value}/web`, query, signal));
  const detail = latestRead((signal, functionId) => get(`${usagePath.value}/function`, { functionId }, signal));
  const recordings = latestRead((signal) => get(recordingPath.value, {}, signal));
  const targets = latestRead((signal) => get(`${recordingPath.value}/targets`, {}, signal));
  const requests = latestRead((signal, { recordingId, q, includeEmpty }) => get(
    `${recordingPath.value}/${segment(recordingId)}/requests`, { q, includeEmpty: includeEmpty ? "true" : "", limit: REQUEST_PAGE }, signal
  ));
  // What ran in one request, then the same functions joined to the call web.
  const result = latestRead(async (signal, { recordingId, requestId }) => {
    const ran = await get(`${recordingPath.value}/${segment(recordingId)}/requests/${segment(requestId)}/functions`, { limit: RECORDED_FUNCTIONS }, signal);
    const functions = ran.functions || [];
    const join = await client.request(`${usagePath.value}/join`, {
      method: "POST",
      body: { functions: functions.map(({ path, hash, name, start }) => ({ path, hash, name, start })) },
      signal
    });
    return { recordingId, requestId, functions, total: ran.total ?? functions.length, truncated: ran.truncated === true, join };
  });

  // Route entries let Recording show a request's route template.
  const routes = shallowRef([]);
  async function loadRoutes() {
    const loaded = [];
    let cursor = null;
    for (let page = 0; page < ROUTE_PAGES; page += 1) {
      const answer = await get(`${usagePath.value}/entries`, { kind: "route", cursor, limit: 200 }).catch(() => null);
      if (!answer) break;
      loaded.push(...answer.entries);
      cursor = answer.nextCursor;
      if (!cursor) break;
    }
    routes.value = loaded;
    return loaded;
  }

  return {
    entries: {
      items: entryItems,
      kinds: entryKinds,
      hasMore: computed(() => Boolean(entryCursor.value)),
      loading: entryRead.loading,
      error: entryRead.error,
      errorCode: entryRead.errorCode,
      search: searchEntries,
      more: moreEntries
    },
    snapshot,
    web,
    detail,
    recordings,
    targets,
    requests,
    result,
    routes,
    loadRoutes
  };
}

export {
  useVibe64UsageWeb
};
