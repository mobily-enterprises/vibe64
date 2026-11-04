import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import { MAX_NODES, SEARCH_DELAY_MS } from "./usageModel.js";

/**
 * Imports and Calls in Usage: the entry list's search (which also answers Show usage from Map and Pick in Preview)
 * and the web read for the chosen entry. Reads wait while the view is hidden and repeat only when the session or
 * scan changes.
 * @param {object} options
 * @param {{ active: boolean, sessionId: string, snapshotKey: string, state: import("./usageModel.js").UsageState, findRequest: import("./useVibe64UsageState.js").UsageFindRequest | null }} options.props the view's props
 * @param {import("./useVibe64UsageWeb.js").Vibe64UsageWeb} options.usage the view's usage reads
 * @param {import("vue").ComputedRef<string>} options.mode imports, calls or recording
 * @param {import("vue").Ref<boolean>} options.compact whether the view has a phone's layout
 * @param {import("vue").Ref<boolean>} options.pickerOpen whether the phone's entry picker is open
 * @param {(patch: Partial<import("./usageModel.js").UsageState>) => void} options.update changes the view's address state
 * @param {() => void} options.closePanel closes the selected function's panel
 */
function useVibe64UsageEntryReads({ props, usage, mode, compact, pickerOpen, update, closePanel }) {
  const search = ref("");
  const kind = ref("");
  const exactOnly = ref(false);
  const maxNodes = ref(MAX_NODES);

  let searchTimer;
  let loadedKey = "";
  const loadEntries = () => usage.entries.search({ q: search.value, kind: kind.value });
  watch([search, kind], () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadEntries, SEARCH_DELAY_MS);
  });
  watch([() => props.active, () => props.sessionId, () => props.snapshotKey], ([active, sessionId, key]) => {
    if (!active || !sessionId || loadedKey === `${sessionId}\n${key}`) return;
    loadedKey = `${sessionId}\n${key}`;
    void loadEntries();
  }, { immediate: true });

  function selectEntry(entry) {
    pickerOpen.value = false;
    if (entry.id !== props.state.entry) update({ entry: entry.id, subsystem: "" });
  }

  // "Show usage" from Map: the entry when exactly one matches, else the
  // filtered list. A request naming an entry (Pick) is handled below.
  let handledFind = null;
  watch(() => props.findRequest, async (request) => {
    if (!request || request === handledFind || request.entryId) return;
    handledFind = request;
    search.value = String(request.q || "").slice(0, 80);
    kind.value = request.kind || "";
    await nextTick();
    clearTimeout(searchTimer);
    const page = await loadEntries();
    if (page?.entries.length === 1 && !page.nextCursor) selectEntry(page.entries[0]);
    else if (compact.value) pickerOpen.value = true;
  }, { immediate: true });

  const webQuery = computed(() => (props.state.entry && mode.value !== "recording" ? {
    entryId: props.state.entry,
    mode: mode.value,
    certainty: mode.value === "calls" && exactOnly.value ? "exact" : undefined,
    subsystemId: props.state.subsystem || undefined,
    maxNodes: maxNodes.value === MAX_NODES ? undefined : maxNodes.value
  } : null));
  let webKey = "";
  function loadWeb(force = false) {
    const key = JSON.stringify([webQuery.value, props.sessionId, props.snapshotKey]);
    if (!props.active || !webQuery.value || (!force && key === webKey)) return;
    webKey = key;
    void usage.web.run(webQuery.value);
  }
  watch([() => props.state.entry, mode, () => props.state.subsystem], () => { maxNodes.value = MAX_NODES; closePanel(); });
  watch([() => JSON.stringify(webQuery.value), () => props.active, () => props.sessionId, () => props.snapshotKey], () => loadWeb(), { immediate: true });

  const webData = computed(() => usage.web.data.value);
  const webEntry = computed(() => webData.value?.entry || {});

  // Pick in Preview opens one entry, which may be far down the list: once the
  // web names it, its title becomes the list's search so the row is in view.
  let handledPick = null;
  let pickedEntry = "";
  watch([() => props.findRequest, webEntry], ([request, entry]) => {
    if (request?.entryId && request !== handledPick) {
      handledPick = request;
      pickedEntry = request.entryId;
    }
    if (!pickedEntry || entry.id !== pickedEntry) return;
    pickedEntry = "";
    kind.value = "";
    search.value = String(entry.title || "").slice(0, 80);
  }, { immediate: true });
  const webFresh = computed(() => Boolean(webData.value && webData.value.entry.id === props.state.entry && webData.value.mode === mode.value
    && (mode.value !== "calls" || webData.value.certainty === (exactOnly.value ? "exact" : "all"))));

  onBeforeUnmount(() => clearTimeout(searchTimer));

  return {
    search,
    kind,
    exactOnly,
    maxNodes,
    loadEntries,
    selectEntry,
    loadWeb,
    webData,
    webEntry,
    webFresh
  };
}

export { useVibe64UsageEntryReads };
