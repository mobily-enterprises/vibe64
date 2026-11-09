import { computed, ref, shallowRef, unref } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { USAGE_RECORDING_API_SUFFIX } from "@local/vibe64-usage-recording/client";

import { SYSTEM_GRAPH_API_SUFFIX } from "../composables/useVibe64SystemGraph.js";

const ENTRY_PAGE = 100;
const REQUEST_PAGE = 200;
const RECORDED_FUNCTIONS = 1500;

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
    // readable-check: allow optional-collaborator - platform object: the read's AbortController exists only once a read has started, and only where the host has one
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
    // readable-check: allow optional-collaborator - platform object: the read's AbortController exists only once a read has started, and only where the host has one
    controller?.abort();
    data.value = null;
    loading.value = false;
    error.value = "";
    errorCode.value = "";
  }

  return { data, loading, error, errorCode, run, reset };
}

const byId = (rows) => new Set(rows.map((row) => row.id));
const union = (first = [], second = []) => {
  const ids = byId(first);
  return [...first, ...second.filter((row) => !ids.has(row.id))];
};

// A recording's requests page by page: `more` adds the next page, and
// `refresh` puts a live recording's newest first page in front of the rows
// already shown. data holds every row read so far, with the server's total.
function requestPages(load) {
  const read = latestRead(load);
  const data = shallowRef(null);
  let filter = null;

  async function run(next) {
    filter = next;
    const page = await read.run(next, null);
    if (page) data.value = { ...page, filterKey: JSON.stringify(next) };
    return page;
  }

  async function more() {
    const shown = data.value;
    if (!shown?.nextCursor) return null;
    const page = await read.run(filter, shown.nextCursor);
    if (!page || data.value !== shown) return null;
    data.value = { ...shown, ...page, requests: union(shown.requests, page.requests), interactions: union(shown.interactions, page.interactions) };
    return page;
  }

  // Rows already shown stay when the new first page reaches them; a page that
  // does not (many requests since the last read) starts the list again.
  async function refresh(next) {
    const shown = data.value;
    if (!shown || shown.filterKey !== JSON.stringify(next)) return run(next);
    if (read.loading.value) return null;
    const page = await read.run(next, null);
    if (!page || data.value !== shown) return null;
    const reaches = !page.nextCursor || byId(shown.requests).has(page.requests.at(-1)?.id);
    data.value = !reaches ? { ...page, filterKey: shown.filterKey } : {
      ...shown,
      ...page,
      requests: union(page.requests, shown.requests),
      interactions: union(page.interactions, shown.interactions),
      nextCursor: shown.requests.length > page.requests.length ? shown.nextCursor : page.nextCursor
    };
    return page;
  }

  return { data, loading: read.loading, error: read.error, errorCode: read.errorCode, run, more, refresh };
}

/**
 * Reads for the usage view: entries, Imports/Calls webs, one function, and a recording's requests joined to the
 * call web. The view owns what is shown.
 * @param {{ sessionId: import("vue").MaybeRef<string> }} options
 */
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
  // Each read page of requests names its rows' route templates, matched by
  // the server against every route of the current scan.
  async function withRouteTemplates(page, signal) {
    const rows = page?.requests || [];
    const keyOf = (row) => `${row.method} ${row.path}`;
    const asked = [...new Map(rows.filter((row) => row.method && row.path).map((row) => [keyOf(row), row])).values()];
    if (!asked.length) return page;
    const answer = await client.request(`${usagePath.value}/routes`, {
      method: "POST",
      body: { requests: asked.map(({ method, path }) => ({ method, path })) },
      signal
    }).catch(() => null);
    const templates = new Map(asked.map((row, position) => [keyOf(row), answer?.templates?.[position] || ""]));
    return { ...page, requests: rows.map((row) => (templates.get(keyOf(row)) ? { ...row, routeTemplate: templates.get(keyOf(row)) } : row)) };
  }
  const requests = requestPages(async (signal, { recordingId, q, includeEmpty, newestFirst }, cursor) => withRouteTemplates(await get(
    `${recordingPath.value}/${segment(recordingId)}/requests`,
    { q, includeEmpty: includeEmpty ? "true" : "", order: newestFirst ? "newest" : "", cursor, limit: REQUEST_PAGE },
    signal
  ), signal));
  // What ran in one request, or in all the requests of one interaction (one
  // server read that merges them), then the same functions joined to the call
  // web. A request's own row comes along: it names the request when the pages
  // read so far do not hold it (an address reloaded after Show more); an
  // interaction's read names it and lists its requests itself.
  const result = latestRead(async (signal, { recordingId, requestId = "", interactionId = "" }) => {
    const recordingBase = `${recordingPath.value}/${segment(recordingId)}`;
    const requestsPath = `${recordingBase}/requests`;
    const [ran, named] = await Promise.all(interactionId
      ? [get(`${recordingBase}/interactions/${segment(interactionId)}/functions`, { limit: RECORDED_FUNCTIONS }, signal), null]
      : [
        get(`${requestsPath}/${segment(requestId)}/functions`, { limit: RECORDED_FUNCTIONS }, signal),
        get(requestsPath, { requestId, limit: 1 }, signal).then((page) => withRouteTemplates(page, signal)).catch(() => null)
      ]);
    const functions = ran.functions || [];
    const join = await client.request(`${usagePath.value}/join`, {
      method: "POST",
      body: { functions: functions.map(({ path, hash, name, start }) => ({ path, hash, name, start })) },
      signal
    });
    return {
      recordingId, requestId, interactionId, functions, total: ran.total ?? functions.length, truncated: ran.truncated === true, join,
      request: named?.requests?.find((row) => row.id === requestId) || null,
      interactions: interactionId ? [ran.interaction].filter(Boolean) : named?.interactions || [],
      requestIds: interactionId ? ran.requests || [] : null
    };
  });

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
    result
  };
}

/** @typedef {ReturnType<typeof useVibe64UsageWeb>} Vibe64UsageWeb */

export {
  useVibe64UsageWeb
};
