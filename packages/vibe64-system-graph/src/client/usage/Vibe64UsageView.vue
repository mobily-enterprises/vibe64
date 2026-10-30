<template>
  <section ref="root" class="usage-view" :class="{ 'usage-view--compact': compact, 'usage-view--panel': selected && wide }" aria-label="Usage">
    <aside v-if="!compact" class="usage-view__rail">
      <Vibe64UsageRecordingResults v-if="mode === 'recording'" v-bind="recordingBindings" v-on="recordingHandlers" />
      <Vibe64UsageEntryRail v-else v-bind="railBindings" v-on="railHandlers" />
    </aside>

    <div class="usage-view__main">
      <header class="usage-view__header">
        <Vibe64UsageEntryPicker v-if="compact" v-model="pickerOpen" :label="pickerLabel" :title="mode === 'recording' ? 'Requests' : 'Entry points'">
          <Vibe64UsageRecordingResults v-if="mode === 'recording'" v-bind="recordingBindings" v-on="recordingHandlers" />
          <Vibe64UsageEntryRail v-else v-bind="railBindings" v-on="railHandlers" />
        </Vibe64UsageEntryPicker>
        <h3 v-if="!compact && mode !== 'recording' && state.entry" class="usage-view__entry text-title-medium">{{ pickerLabel }}</h3>
        <div class="usage-view__controls">
          <v-btn-toggle
            :model-value="mode"
            class="usage-view__modes"
            mandatory
            divided
            rounded="pill"
            color="primary"
            variant="outlined"
            density="comfortable"
            role="group"
            aria-label="Usage mode"
            @update:model-value="setMode"
          >
            <v-btn v-for="item in USAGE_MODES" :key="item.value" :value="item.value">{{ item.title }}</v-btn>
          </v-btn-toggle>
          <v-chip
            v-if="mode === 'calls'"
            :variant="exactOnly ? 'tonal' : 'outlined'"
            :prepend-icon="exactOnly ? mdiCheck : undefined"
            role="switch"
            :aria-checked="exactOnly"
            @click="exactOnly = !exactOnly"
          >Exact only</v-chip>
          <v-btn class="usage-view__record" variant="tonal" color="primary" :prepend-icon="mdiRecordCircleOutline" title="Record" @click="recordOpen = true"><span class="usage-view__record-label">Record</span></v-btn>
        </div>
      </header>
      <v-progress-linear :active="busy" indeterminate color="primary" height="2" class="usage-view__progress" />

      <div class="usage-view__content">
        <v-alert v-if="snapshot?.stale" type="info" variant="tonal" density="compact" class="usage-view__banner">
          Source changed since the last scan
          <template #append><v-btn variant="text" size="small" :loading="refreshing" @click="emit('refresh')">Refresh</v-btn></template>
        </v-alert>

        <template v-if="mode !== 'recording'">
          <div v-if="!state.entry" class="usage-view__state" role="status">
            <template v-if="noEntries">
              <h3 class="text-title-medium">No entry points found yet</h3>
              <p class="text-body-medium">No entry points found yet. Refresh the architecture scan.</p>
              <v-btn variant="tonal" :loading="refreshing" :prepend-icon="mdiRefresh" @click="emit('refresh')">Refresh</v-btn>
            </template>
            <template v-else>
              <h3 class="text-title-medium">Pick an entry point</h3>
              <p class="text-body-medium">Choose a page, component, route, command or library export to see only what it reaches.</p>
            </template>
          </div>
          <v-alert v-else-if="usage.web.error.value" type="error" variant="tonal" class="usage-view__banner">
            {{ usage.web.errorCode.value === 'vibe64_usage_entry_not_found' ? 'This entry point is not in the current scan.' : usage.web.error.value }}
            <template #append>
              <v-btn v-if="usage.web.errorCode.value === 'vibe64_usage_entry_not_found'" variant="text" size="small" @click="update({ entry: '', subsystem: '' })">Choose another</v-btn>
              <v-btn v-else variant="text" size="small" @click="loadWeb(true)">Retry</v-btn>
            </template>
          </v-alert>
          <div v-else-if="!webFresh" class="usage-view__skeleton" aria-busy="true" aria-label="Loading usage">
            <v-skeleton-loader v-for="card in 4" :key="card" type="card" class="usage-view__skeleton-card" />
          </div>
          <div v-else-if="mode === 'calls' && !webEntry.hasCalls" class="usage-view__state" role="status">
            <h3 class="text-title-medium">Calls are not available here</h3>
            <p class="text-body-medium">{{ snapshot?.callWebIdentity ? 'No functions are known for this entry.' : 'The last scan did not read calls for this project.' }} Imports still shows the files it reaches.</p>
            <v-btn variant="tonal" @click="setMode('imports')">Show Imports</v-btn>
          </div>
          <template v-else>
            <v-alert v-if="webData.truncated" type="warning" variant="tonal" density="compact" class="usage-view__banner">
              Showing the first {{ webData.limits.maxNodes.toLocaleString() }}{{ maxNodes < MORE_NODES ? '' : '. Zoom into a subsystem to see the rest' }}
              <template v-if="maxNodes < MORE_NODES" #append><v-btn variant="text" size="small" @click="maxNodes = MORE_NODES">Show more</v-btn></template>
            </v-alert>
            <Vibe64UsageWebCanvas v-bind="canvasBindings" v-on="canvasHandlers" />
            <p v-if="mode === 'calls' && state.subsystem && webData.unresolvedTotal > webData.unresolved.length" class="usage-view__note text-body-small">
              Showing {{ webData.unresolved.length }} of {{ webData.unresolvedTotal.toLocaleString() }} unresolved calls.
            </p>
            <p v-if="mode === 'imports' && webData.unresolvedImports" class="usage-view__note text-body-small">
              {{ countLabel(webData.unresolvedImports, 'import') }} could not be resolved to a project file.
            </p>
          </template>
        </template>

        <template v-else>
          <v-alert v-if="usage.recordings.error.value" type="error" variant="tonal" class="usage-view__banner">
            {{ usage.recordings.error.value }}
            <template #append><v-btn variant="text" size="small" @click="loadRecordings">Retry</v-btn></template>
          </v-alert>
          <div v-else-if="!recordings.length" class="usage-view__state" role="status">
            <template v-if="usage.recordings.loading.value || !usage.recordings.data.value">
              <v-skeleton-loader type="paragraph" />
            </template>
            <p v-else-if="unavailable.length" class="text-body-medium">
              Recording not available for this project's runtimes (<code>{{ unavailable.join('`, `') }}</code>). Imports and Calls still work.
            </p>
            <template v-else>
              <h3 class="text-title-medium">No recordings yet</h3>
              <p class="text-body-medium">Record what runs, use the app or command, then pick a request to see only the code it ran.</p>
            </template>
          </div>
          <div v-else-if="!state.request" class="usage-view__state" role="status">
            <h3 class="text-title-medium">Pick a request</h3>
            <p class="text-body-medium">Each request shows the subsystems and functions that ran for it.</p>
          </div>
          <v-alert v-else-if="usage.result.error.value" type="error" variant="tonal" class="usage-view__banner">
            {{ usage.result.error.value }}
            <template #append><v-btn variant="text" size="small" @click="loadResult(true)">Retry</v-btn></template>
          </v-alert>
          <div v-else-if="!resultFresh" class="usage-view__skeleton" aria-busy="true" aria-label="Loading what ran">
            <v-skeleton-loader v-for="card in 4" :key="card" type="card" class="usage-view__skeleton-card" />
          </div>
          <template v-else>
            <v-alert v-if="usage.result.data.value.truncated" type="warning" variant="tonal" density="compact" class="usage-view__banner">
              Showing the first {{ usage.result.data.value.functions.length.toLocaleString() }} of {{ usage.result.data.value.total.toLocaleString() }} functions that ran.
            </v-alert>
            <Vibe64UsageWebCanvas v-bind="canvasBindings" v-on="canvasHandlers">
              <template #zoom-actions>
                <v-chip
                  v-if="webView.plumbing"
                  size="small"
                  :variant="showPlumbing ? 'tonal' : 'outlined'"
                  :prepend-icon="showPlumbing ? mdiCheck : undefined"
                  role="switch"
                  :aria-checked="showPlumbing"
                  @click="showPlumbing = !showPlumbing"
                >Shared plumbing ({{ webView.plumbing }})</v-chip>
              </template>
            </Vibe64UsageWebCanvas>
          </template>
        </template>
      </div>
    </div>

    <aside v-if="selected && !compact" class="usage-view__panel" :class="{ 'usage-view__panel--floating': !wide }">
      <Vibe64UsageFunctionPanel v-bind="panelBindings" v-on="panelHandlers" />
    </aside>
    <v-bottom-sheet v-if="compact" :model-value="Boolean(selected)" scrollable @update:model-value="!$event && closePanel()">
      <v-card v-if="selected" class="usage-view__sheet"><Vibe64UsageFunctionPanel v-bind="panelBindings" v-on="panelHandlers" /></v-card>
    </v-bottom-sheet>
    <Vibe64UsageRecordDialog v-model="recordOpen" :session-id="sessionId" @started="recordingStarted" @select-preview="emit('select-preview')" />
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, toRef, watch } from "vue";
import { mdiCheck, mdiRecordCircleOutline, mdiRefresh } from "@mdi/js";
import { Vibe64UsageRecordDialog } from "@local/vibe64-usage-recording/client";

import Vibe64UsageEntryPicker from "./Vibe64UsageEntryPicker.vue";
import Vibe64UsageEntryRail from "./Vibe64UsageEntryRail.vue";
import Vibe64UsageFunctionPanel from "./Vibe64UsageFunctionPanel.vue";
import Vibe64UsageRecordingResults from "./Vibe64UsageRecordingResults.vue";
import Vibe64UsageWebCanvas from "./Vibe64UsageWebCanvas.vue";
import {
  MAX_NODES,
  MORE_NODES,
  USAGE_MODES,
  countLabel,
  functionLabel,
  isBackgroundRequest,
  recordingWeb,
  requestTitle,
  unavailableRuntimes,
  webNodes
} from "./usageModel.js";
import { useVibe64UsageWeb } from "./useVibe64UsageWeb.js";

const COMPACT_WIDTH = 600;
const WIDE_WIDTH = 1040;
// Below the rail plus two function columns (280 + 32 + 544 + 32) a call
// cannot be drawn whole, so the canvas lists functions as on a phone.
const GRAPH_WIDTH = 888;
const SEARCH_DELAY_MS = 200;
const LIVE_REFRESH_MS = 5000;

// The Usage half of Architecture. Its address state (entry, mode, zoomed
// subsystem, recording, request) belongs to the parent, which keeps it in the
// route; filters, selection and dialogs are local.
const props = defineProps({
  active: { type: Boolean, default: true },
  sessionId: { type: String, required: true },
  state: { type: Object, required: true },
  findRequest: { type: Object, default: null },
  snapshotKey: { type: String, default: "" },
  refreshing: { type: Boolean, default: false }
});
const emit = defineEmits(["update:state", "refresh", "open-source-file", "select-preview"]);

const usage = useVibe64UsageWeb({ sessionId: toRef(props, "sessionId") });
const root = ref(null);
const compact = ref(false);
const wide = ref(true);
const listCanvas = ref(false);
const search = ref("");
const kind = ref("");
const exactOnly = ref(false);
const maxNodes = ref(MAX_NODES);
const showUntouched = ref(false);
const showPlumbing = ref(false);
const selected = shallowRef(null);
const pickerOpen = ref(false);
const recordOpen = ref(false);
const requestSearch = ref("");
const includeEmpty = ref(false);

const mode = computed(() => props.state.mode || "calls");
const snapshot = computed(() => usage.snapshot.value || usage.web.data.value?.snapshot || null);
const recordings = computed(() => usage.recordings.data.value?.recordings || []);
const unavailable = computed(() => unavailableRuntimes(usage.targets.data.value?.targets || []));
const noEntries = computed(() => !usage.entries.items.value.length && !usage.entries.loading.value && !usage.entries.error.value && !search.value && !kind.value && Boolean(usage.snapshot.value));
const busy = computed(() => [usage.web, usage.result, usage.requests].some((read) => read.loading.value));

function update(patch) {
  emit("update:state", { ...props.state, view: "usage", ...patch });
}

function setMode(value) {
  if (!value || value === mode.value) return;
  update({ mode: value, subsystem: "" });
}

// ---------------------------------------------------------------- entries

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
// filtered list.
let handledFind = null;
watch(() => props.findRequest, async (request) => {
  if (!request || request === handledFind) return;
  handledFind = request;
  search.value = String(request.q || "").slice(0, 80);
  kind.value = request.kind || "";
  await nextTick();
  clearTimeout(searchTimer);
  const page = await loadEntries();
  if (page?.entries.length === 1 && !page.nextCursor) selectEntry(page.entries[0]);
  else if (compact.value) pickerOpen.value = true;
}, { immediate: true });

const railBindings = computed(() => ({
  entries: usage.entries.items.value,
  kinds: usage.entries.kinds.value,
  search: search.value,
  kind: kind.value,
  selectedId: props.state.entry,
  loading: usage.entries.loading.value,
  error: usage.entries.error.value,
  hasMore: usage.entries.hasMore.value,
  refreshing: props.refreshing
}));
const railHandlers = {
  "update:search": (value) => { search.value = value; },
  "update:kind": (value) => { kind.value = value; },
  select: selectEntry,
  more: () => usage.entries.more(),
  retry: loadEntries,
  refresh: () => emit("refresh")
};

// ---------------------------------------------------------------- Imports and Calls

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
const webFresh = computed(() => Boolean(webData.value && webData.value.entry.id === props.state.entry && webData.value.mode === mode.value
  && (mode.value !== "calls" || webData.value.certainty === (exactOnly.value ? "exact" : "all"))));

// ---------------------------------------------------------------- Recording

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

let requestTimer;
const loadRequests = () => (recordingActive.value && props.state.recording
  ? usage.requests.run({ recordingId: props.state.recording, q: requestSearch.value.trim(), includeEmpty: includeEmpty.value })
  : null);
watch(requestSearch, () => {
  clearTimeout(requestTimer);
  requestTimer = setTimeout(loadRequests, SEARCH_DELAY_MS);
});
watch([recordingActive, () => props.state.recording, includeEmpty, () => props.snapshotKey], () => { void loadRequests(); }, { immediate: true });

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

// While a recording runs, its requests list follows it.
watch(() => recordingActive.value && selectedRecording.value?.state === "recording", (live, previous, onCleanup) => {
  if (!live) return;
  const timer = setInterval(() => { void usage.recordings.run(); void loadRequests(); }, LIVE_REFRESH_MS);
  onCleanup(() => clearInterval(timer));
});

const resultFresh = computed(() => {
  const data = usage.result.data.value;
  return Boolean(data && data.recordingId === props.state.recording && data.requestId === props.state.request);
});
const recorded = computed(() => (resultFresh.value ? recordingWeb(usage.result.data.value.functions, usage.result.data.value.join) : null));
const requestRows = computed(() => usage.requests.data.value?.requests || []);
const selectedRequest = computed(() => requestRows.value.find((request) => request.id === props.state.request) || null);

const recordingBindings = computed(() => ({
  recordings: recordings.value,
  recordingId: props.state.recording,
  requests: requestRows.value,
  interactions: usage.requests.data.value?.interactions || [],
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
  "update:recordingId": (id) => update({ recording: id, request: "", subsystem: "" }),
  "update:requestId": (id) => { pickerOpen.value = false; update({ request: id, subsystem: "" }); },
  "update:search": (value) => { requestSearch.value = value; },
  "update:includeEmpty": (value) => { includeEmpty.value = value; },
  retry: () => { void loadRecordings(); void loadRequests(); }
};

function recordingStarted(event = {}) {
  const id = event.recording?.id;
  if (id) update({ mode: "recording", recording: id, request: "", subsystem: "" });
  recordingsKey = "";
  void loadRecordings();
}

// ---------------------------------------------------------------- the web

const inSubsystem = (items, subsystemId) => (items || []).filter((item) => item.subsystemId === subsystemId);
const webView = computed(() => {
  const zoomed = props.state.subsystem;
  if (mode.value === "recording") {
    const data = recorded.value;
    if (!data) return null;
    const inside = zoomed ? inSubsystem(data.nodes, zoomed) : [];
    return {
      subsystems: data.subsystems,
      groups: usage.result.data.value.join?.groups || [],
      crossings: data.crossings,
      nodes: webNodes("recording", { nodes: inside.filter((node) => showPlumbing.value || !node.plumbing), edges: data.edges }),
      edges: data.edges,
      plumbing: inside.filter((node) => node.plumbing).length
    };
  }
  const data = webFresh.value ? webData.value : null;
  if (!data) return null;
  const scoped = zoomed ? { ...data, files: inSubsystem(data.files, zoomed), functions: inSubsystem(data.functions, zoomed) } : {};
  return { subsystems: data.subsystems, groups: data.groups, crossings: data.crossings, nodes: zoomed ? webNodes(mode.value, scoped) : [], edges: data.edges || [], plumbing: 0 };
});
const canvasBindings = computed(() => ({
  mode: mode.value,
  subsystems: webView.value?.subsystems || [],
  groups: webView.value?.groups || [],
  crossings: webView.value?.crossings || [],
  zoomedId: props.state.subsystem,
  nodes: webView.value?.nodes || [],
  edges: webView.value?.edges || [],
  selectedId: selected.value?.id || "",
  showUntouched: showUntouched.value,
  compact: compact.value || listCanvas.value
}));
const canvasHandlers = {
  zoom: (subsystemId) => update({ subsystem: subsystemId }),
  select: selectNode,
  "update:showUntouched": (value) => { showUntouched.value = value; }
};

// ---------------------------------------------------------------- one function

function selectNode(node) {
  selected.value = node;
  if (node.functionId) void usage.detail.run(node.functionId);
  else usage.detail.reset();
}

function closePanel() {
  selected.value = null;
  usage.detail.reset();
}

// A function picked from Calls or Called by becomes the selection.
function selectFunction(fn) {
  const known = (webView.value?.nodes || []).find((node) => node.functionId === fn.id);
  selectNode(known || { id: fn.id, functionId: fn.id, title: functionLabel(fn), subtitle: `${fn.file}:${fn.start.line}`, file: fn.file, start: fn.start });
}

function openSource(location) {
  emit("open-source-file", { ...location, presentation: "code", origin: "system", systemContext: { usage: { ...props.state, view: "usage" } } });
}

const panelBindings = computed(() => ({
  node: selected.value,
  detail: selected.value?.functionId && usage.detail.data.value?.function?.id === selected.value.functionId ? usage.detail.data.value : null,
  loading: usage.detail.loading.value,
  error: usage.detail.error.value
}));
const panelHandlers = {
  close: closePanel,
  select: selectFunction,
  "open-source": openSource,
  retry: () => selected.value && selectNode(selected.value)
};

// ---------------------------------------------------------------- layout

const pickerLabel = computed(() => {
  if (mode.value === "recording") {
    const request = selectedRequest.value;
    if (!request) return "Choose a request";
    return isBackgroundRequest(request) ? `Request: ${requestTitle(request, [], requestRows.value)}` : `Request: ${request.method} ${requestTitle(request, usage.routes.value)}`;
  }
  const entry = usage.entries.items.value.find((item) => item.id === props.state.entry) || (webEntry.value.id === props.state.entry ? webEntry.value : null);
  return entry ? `Entry: ${entry.title}` : "Choose an entry";
});

let observer = null;
watch(root, (element) => {
  observer?.disconnect();
  if (!element || typeof ResizeObserver !== "function") return;
  observer = new ResizeObserver(() => {
    const width = element.clientWidth;
    if (!width) return;
    compact.value = width <= COMPACT_WIDTH;
    wide.value = width >= WIDE_WIDTH;
    listCanvas.value = width < GRAPH_WIDTH;
  });
  observer.observe(element);
}, { flush: "post" });
onBeforeUnmount(() => {
  observer?.disconnect();
  clearTimeout(searchTimer);
  clearTimeout(requestTimer);
});

defineExpose({ compact, selected, pickerOpen, search, kind, exactOnly });
</script>

<style scoped>
.usage-view { position: relative; display: grid; grid-template-columns: 280px minmax(0, 1fr); height: 100%; min-height: 0; min-width: 0; background: rgb(var(--v-theme-surface)); color: rgb(var(--v-theme-on-surface)); }
.usage-view--panel { grid-template-columns: 280px minmax(0, 1fr) 360px; }
.usage-view--compact { grid-template-columns: minmax(0, 1fr); }
.usage-view__rail { min-height: 0; overflow: hidden; border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); background: rgb(var(--v-theme-surface-container-low, var(--v-theme-surface))); }
.usage-view__main { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.usage-view__header { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px 8px; container-type: inline-size; }
.usage-view__controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
.usage-view__entry { margin: 0; overflow-wrap: anywhere; }
.usage-view__modes { flex: none; }
.usage-view__record { margin-left: auto; }
/* Narrow headers keep Record on the modes' row as an icon. */
@container (max-width: 480px) {
  .usage-view__record { min-width: 0; padding: 0 12px; }
  .usage-view__record :deep(.v-btn__prepend) { margin-inline: 0; }
  .usage-view__record-label { display: none; }
}
.usage-view__progress { flex: none; }
.usage-view__content { flex: 1; min-height: 0; overflow: auto; padding: 8px 16px 24px; display: flex; flex-direction: column; gap: 12px; }
.usage-view__banner { flex: none; }
.usage-view__state { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 24px 0; max-width: 560px; }
.usage-view__state h3, .usage-view__state p { margin: 0; }
.usage-view__skeleton { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); gap: 12px; }
.usage-view__skeleton-card { border-radius: 12px; }
.usage-view__note { margin: 0; color: rgb(var(--v-theme-on-surface-variant)); }
.usage-view__panel { min-height: 0; overflow: auto; border-left: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); background: rgb(var(--v-theme-surface)); }
.usage-view__panel--floating { position: absolute; top: 0; right: 0; bottom: 0; z-index: 2; width: min(360px, 100%); box-shadow: 0 4px 16px rgba(0, 0, 0, .16); }
.usage-view__sheet { max-height: 80vh; overflow: auto; border-radius: 28px 28px 0 0; }
.usage-view--compact .usage-view__header { padding: 8px 12px; }
.usage-view--compact .usage-view__content { padding: 8px 12px 24px; }
.usage-view--compact .usage-view__modes { flex: 1 1 auto; }
.usage-view--compact .usage-view__modes :deep(.v-btn) { flex: 1 1 0; min-width: 0; padding: 0 8px; }
</style>
