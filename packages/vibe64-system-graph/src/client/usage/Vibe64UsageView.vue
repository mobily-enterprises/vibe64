<template>
  <section ref="root" class="usage-view" :class="{ 'usage-view--compact': compact, 'usage-view--panel': selected && wide }" aria-label="Usage">
    <aside v-if="!compact" class="usage-view__rail">
      <Vibe64UsageRecordingResults v-if="mode === 'recording'" v-bind="recordingBindings" v-on="recordingHandlers" />
      <Vibe64UsageEntryRail v-else v-bind="railBindings" v-on="railHandlers" />
    </aside>

    <div class="usage-view__main">
      <header class="usage-view__header">
        <!-- Phones: Record sits beside the picker so the modes keep a full row. -->
        <div v-if="compact" class="usage-view__picker-row">
          <Vibe64UsageEntryPicker v-model="pickerOpen" :label="pickerLabel" :title="mode === 'recording' ? 'Requests' : 'Entry points'">
            <Vibe64UsageRecordingResults v-if="mode === 'recording'" v-bind="recordingBindings" v-on="recordingHandlers" />
            <Vibe64UsageEntryRail v-else v-bind="railBindings" v-on="railHandlers" />
          </Vibe64UsageEntryPicker>
          <v-btn class="usage-view__record usage-view__record--icon" variant="tonal" color="primary" icon="$radioOn" aria-label="Record" title="Record" @click="recordOpen = true" />
        </div>
        <div v-if="!compact" class="usage-view__title">
          <h3 class="usage-view__entry text-title-medium" :class="{ 'usage-view__entry--none': !chosen }"><template v-for="(part, position) in pathParts(pickerLabel)" :key="position">{{ part }}<wbr></template></h3>
          <!-- In Recording the click's place is kept, so choosing a request or a click never moves the header. -->
          <p v-if="mode === 'recording'" class="usage-view__click text-body-medium" :title="clickTooltip || undefined">
            <template v-if="clickTitle">
              <span class="usage-view__click-text">{{ clickParts.text }}</span>
              <span v-if="clickParts.file" class="usage-view__click-file">{{ " " + clickParts.file }}</span>
              <span v-if="clickStarted" class="usage-view__click-count">{{ " · " + clickStarted }}</span>
            </template>
          </p>
        </div>
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
            :prepend-icon="exactOnly ? '$check' : undefined"
            role="switch"
            :aria-checked="exactOnly"
            @click="exactOnly = !exactOnly"
          >
            Exact only
          </v-chip>
          <v-btn v-if="!compact" class="usage-view__record" variant="tonal" color="primary" prepend-icon="$radioOn" title="Record" @click="recordOpen = true"><span class="usage-view__record-label">Record</span></v-btn>
        </div>
      </header>
      <v-progress-linear :active="busy" indeterminate color="primary" height="2" class="usage-view__progress" />

      <div class="usage-view__content">
        <v-alert v-if="snapshot?.stale" type="info" variant="tonal" density="compact" class="usage-view__banner">
          Source changed since the last scan
          <template #append><v-btn variant="text" size="small" :loading="refreshing" @click="emit('refresh')">Refresh</v-btn></template>
        </v-alert>

        <template v-if="mode !== 'recording'">
          <div v-if="!state.entry || notScanned" class="usage-view__state" role="status">
            <template v-if="noEntries">
              <h3 class="text-title-medium">No entry points found yet</h3>
              <p class="text-body-medium">No entry points found yet. Refresh the architecture scan.</p>
              <v-btn variant="tonal" :loading="refreshing" prepend-icon="$refresh" @click="emit('refresh')">Refresh</v-btn>
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
            <p class="text-body-medium">{{ snapshot?.callWebIdentity ? 'No functions are known for this entry.' : snapshot?.callWebProblem === 'not-ignored' ? NOT_IGNORED_TEXT : 'The last scan did not read calls for this project.' }} Imports still shows the files it reaches.</p>
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
          <div v-else-if="!state.request && !state.interaction" class="usage-view__state" role="status">
            <h3 class="text-title-medium">Pick a request</h3>
            <p class="text-body-medium">Each request shows the subsystems and functions that ran for it; Everything this click ran shows all of a click's requests together.</p>
          </div>
          <div v-else-if="notScanned" class="usage-view__state" role="status">
            <h3 class="text-title-medium">Not scanned yet</h3>
            <p class="text-body-medium">Refresh the architecture scan to see the subsystems and functions this request ran.</p>
            <v-btn variant="tonal" :loading="refreshing" prepend-icon="$refresh" @click="emit('refresh')">Refresh</v-btn>
          </div>
          <v-alert v-else-if="usage.result.error.value" type="error" variant="tonal" class="usage-view__banner">
            {{ usage.result.error.value }}
            <template #append><v-btn variant="text" size="small" @click="loadResult(true)">Retry</v-btn></template>
          </v-alert>
          <div v-else-if="!resultFresh" class="usage-view__skeleton" aria-busy="true" aria-label="Loading what ran">
            <v-skeleton-loader v-for="card in 4" :key="card" type="card" class="usage-view__skeleton-card" />
          </div>
          <template v-else>
            <v-alert v-if="changedSinceRecording" type="info" variant="tonal" density="compact" class="usage-view__banner">
              Source changed since this recording
            </v-alert>
            <v-alert v-if="usage.result.data.value.truncated" type="warning" variant="tonal" density="compact" class="usage-view__banner">
              Showing the first {{ usage.result.data.value.functions.length.toLocaleString() }} of {{ usage.result.data.value.total.toLocaleString() }} functions that ran.
            </v-alert>
            <Vibe64UsageWebCanvas v-bind="canvasBindings" v-on="canvasHandlers">
              <template #zoom-actions>
                <v-chip
                  v-if="webView.plumbing"
                  size="small"
                  :variant="showPlumbing ? 'tonal' : 'outlined'"
                  :prepend-icon="showPlumbing ? '$check' : undefined"
                  role="switch"
                  :aria-checked="showPlumbing"
                  @click="showPlumbing = !showPlumbing"
                >
                  Show shared plumbing ({{ webView.plumbing }})
                </v-chip>
              </template>
            </Vibe64UsageWebCanvas>
          </template>
        </template>
      </div>
    </div>

    <!-- Between phone and wide layouts the panel floats over the view: a scrim
         separates it and closes it. -->
    <div v-if="selected && !compact && !wide" class="usage-view__scrim" aria-hidden="true" @click="closePanel" />
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
import { computed, onBeforeUnmount, ref, shallowRef, toRef, watch } from "vue";
import { Vibe64UsageRecordDialog } from "@local/vibe64-usage-recording/client";

import Vibe64UsageEntryPicker from "./Vibe64UsageEntryPicker.vue";
import Vibe64UsageEntryRail from "./Vibe64UsageEntryRail.vue";
import Vibe64UsageFunctionPanel from "./Vibe64UsageFunctionPanel.vue";
import Vibe64UsageRecordingResults from "./Vibe64UsageRecordingResults.vue";
import Vibe64UsageWebCanvas from "./Vibe64UsageWebCanvas.vue";
import { hasWindowFunction } from "../browser.js";
import {
  MORE_NODES,
  NOT_IGNORED_TEXT,
  NOT_SCANNED_CODE,
  USAGE_MODES,
  countLabel,
  functionLabel,
  interactionParts,
  interactionRunTitle,
  interactionTitle,
  isBackgroundRequest,
  pathParts,
  requestTitle,
  webNodes
} from "./usageModel.js";
import { useVibe64UsageEntryReads } from "./useVibe64UsageEntryReads.js";
import { useVibe64UsageRecordingReads } from "./useVibe64UsageRecordingReads.js";
import { useVibe64UsageWeb } from "./useVibe64UsageWeb.js";

const COMPACT_WIDTH = 600;
const WIDE_WIDTH = 1040;
// Below the rail plus two function columns (280 + 32 + 544 + 32) a call
// cannot be drawn whole, so the canvas lists functions as on a phone.
const GRAPH_WIDTH = 888;

// The Usage half of Architecture. Its address state (entry, mode, zoomed
// subsystem, recording, request or interaction) belongs to the parent, which keeps it in the
// route; filters, selection and dialogs are local.
const props = defineProps({
  active: { type: Boolean, default: true },
  sessionId: { type: String, required: true },
  state: { type: /** @type {import("vue").PropType<import("./usageModel.js").UsageState>} */ (Object), required: true },
  findRequest: { type: /** @type {import("vue").PropType<import("./useVibe64UsageState.js").UsageFindRequest | null>} */ (Object), default: null },
  snapshotKey: { type: String, default: "" },
  refreshing: { type: Boolean, default: false }
});
const emit = defineEmits(["update:state", "refresh", "open-source-file", "select-preview"]);

const usage = useVibe64UsageWeb({ sessionId: toRef(props, "sessionId") });
const root = ref(null);
const compact = ref(false);
const wide = ref(true);
const listCanvas = ref(false);
const showUntouched = ref(false);
const showPlumbing = ref(false);
const selected = shallowRef(null);
const pickerOpen = ref(false);
const recordOpen = ref(false);

const mode = computed(() => props.state.mode || "calls");
const snapshot = computed(() => usage.snapshot.value || usage.web.data.value?.snapshot || null);
// Before the first scan there is nothing to retry: every read needs a scan.
const notScanned = computed(() => [usage.entries, usage.web, usage.result].some((read) => read.errorCode.value === NOT_SCANNED_CODE));
const busy = computed(() => [usage.web, usage.result, usage.requests].some((read) => read.loading.value));

function update(patch) {
  emit("update:state", { ...props.state, view: "usage", ...patch });
}

function setMode(value) {
  if (!value || value === mode.value) return;
  update({ mode: value, subsystem: "" });
}

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

// ---------------------------------------------------------------- entries, Imports and Calls

const { search, kind, exactOnly, maxNodes, loadEntries, selectEntry, loadWeb, webData, webEntry, webFresh } = useVibe64UsageEntryReads({
  props, usage, mode, compact, pickerOpen, update, closePanel
});
const noEntries = computed(() => notScanned.value || (!usage.entries.items.value.length && !usage.entries.loading.value && !usage.entries.error.value && !search.value && !kind.value && Boolean(usage.snapshot.value)));

const railBindings = computed(() => ({
  entries: usage.entries.items.value,
  kinds: usage.entries.kinds.value,
  search: search.value,
  kind: kind.value,
  selectedId: props.state.entry,
  loading: usage.entries.loading.value,
  error: notScanned.value ? "" : usage.entries.error.value,
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

// ---------------------------------------------------------------- Recording

const {
  recordings, unavailable, loadRecordings, loadResult, resultFresh, recorded, changedSinceRecording,
  requestRows, selectedRequest, selectedInteraction, interactionRequestCount, recordingBindings, recordingHandlers, recordingStarted
} = useVibe64UsageRecordingReads({ props, usage, mode, pickerOpen, update, closePanel });

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
  compact: compact.value || listCanvas.value,
  startSubsystemId: mode.value === "recording" ? "" : webEntry.value.subsystemId || ""
}));
const canvasHandlers = {
  zoom: (subsystemId) => update({ subsystem: subsystemId }),
  select: selectNode,
  "update:showUntouched": (value) => { showUntouched.value = value; }
};

// A function picked from Calls or Called by becomes the selection.
function selectFunction(fn) {
  const known = (webView.value?.nodes || []).find((node) => node.functionId === fn.id);
  selectNode(known || { id: fn.id, functionId: fn.id, title: functionLabel(fn), subtitle: `${fn.file}:${fn.start.line}`, file: fn.file, start: fn.start });
}

function openSource(location) {
  emit("open-source-file", { ...location, presentation: "code", origin: "system", systemContext: { usage: { ...props.state, view: "usage" } } });
}

// Outside Recording nothing ran, so no function is counted.
const ranCounts = computed(() => (mode.value === "recording" && recorded.value
  ? new Map(recorded.value.nodes.filter((node) => node.functionId).map((node) => [node.functionId, node.count]))
  : new Map()));
const panelBindings = computed(() => ({
  node: selected.value,
  ran: ranCounts.value,
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

// In Recording, a chosen request or a chosen click (everything its requests ran).
const chosenClick = computed(() => (props.state.interaction ? selectedInteraction.value : null));
const chosen = computed(() => Boolean(mode.value === "recording" ? selectedRequest.value || chosenClick.value : props.state.entry));
// The chosen click, or the click behind the chosen request, for the desktop header.
const clickInteraction = computed(() => (chosen.value ? selectedInteraction.value : null));
const clickParts = computed(() => interactionParts(clickInteraction.value));
const clickTitle = computed(() => interactionTitle(clickInteraction.value));
const clickStarted = computed(() => (chosenClick.value && interactionRequestCount.value !== null
  ? `probably started ${countLabel(interactionRequestCount.value, "request")}` : ""));
const clickTooltip = computed(() => [clickTitle.value, clickStarted.value].filter(Boolean).join(" · "));
const pickerLabel = computed(() => {
  if (mode.value === "recording") {
    // Phones show no click line, so their picker names the click and its requests.
    if (chosenClick.value) {
      return compact.value ? [clickTitle.value, interactionRequestCount.value !== null && countLabel(interactionRequestCount.value, "request")].filter(Boolean).join(" · ")
        : interactionRunTitle(chosenClick.value);
    }
    const request = selectedRequest.value;
    if (!request) return "Choose a request";
    return isBackgroundRequest(request) ? `Request: ${requestTitle(request, [], requestRows.value)}` : `Request: ${[request.method, requestTitle(request, usage.routes.value)].filter(Boolean).join(" ")}`;
  }
  const entry = usage.entries.items.value.find((item) => item.id === props.state.entry) || (webEntry.value.id === props.state.entry ? webEntry.value : null);
  return entry ? `Entry: ${entry.title}` : "Choose an entry";
});

let observer = null;
watch(root, (element) => {
  observer?.disconnect();
  if (!element || !hasWindowFunction("ResizeObserver")) return;
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
});

defineExpose({ compact, selected, pickerOpen, search, kind, exactOnly });
</script>

<style scoped>
.usage-view { position: relative; display: grid; grid-template-columns: 280px minmax(0, 1fr); height: 100%; min-height: 0; min-width: 0; background: rgb(var(--v-theme-surface)); color: rgb(var(--v-theme-on-surface)); }
.usage-view--panel { grid-template-columns: 280px minmax(0, 1fr) 360px; }
.usage-view--compact { grid-template-columns: minmax(0, 1fr); }
.usage-view__rail { min-height: 0; overflow: hidden; border-right: 1px solid rgb(var(--v-theme-outline-variant)); background: rgb(var(--v-theme-surface-container-low)); }
.usage-view__main { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.usage-view__header { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px 8px; container-type: inline-size; }
.usage-view__controls { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
.usage-view__title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 12px; min-width: 0; }
.usage-view__entry { margin: 0; min-width: 0; overflow-wrap: break-word; }
.usage-view__entry--none { color: rgb(var(--v-theme-on-surface-variant)); }
/* The click is one line beside the heading, shortened to fit while keeping its
   component file and, for a chosen click, how many requests it probably
   started. Where that is too narrow it has a line of its own, kept even while
   empty, so choosing a request or a click never changes the header's height. */
.usage-view__click { display: flex; flex: 1 1 0; min-width: 0; margin: 0; overflow: hidden; white-space: nowrap; color: rgb(var(--v-theme-on-surface-variant)); }
.usage-view__click-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.usage-view__click-file, .usage-view__click-count { flex: none; white-space: pre; }
@container (max-width: 720px) {
  .usage-view__click { flex-basis: 100%; min-height: 1lh; }
}
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
.usage-view__panel { min-height: 0; overflow: auto; border-left: 1px solid rgb(var(--v-theme-outline-variant)); background: rgb(var(--v-theme-surface)); }
.usage-view__panel--floating { position: absolute; top: 0; right: 0; bottom: 0; z-index: 2; width: min(360px, 100%); border-left: 0; border-radius: var(--v64-shape-lg) 0 0 var(--v64-shape-lg); background: rgb(var(--v-theme-surface-container-high)); box-shadow: var(--v64-elevation-3); }
.usage-view__scrim { position: absolute; inset: 0; z-index: 1; background: rgb(0 0 0 / .32); }
.usage-view__sheet { max-height: 80vh; overflow: auto; border-radius: 28px 28px 0 0; }
.usage-view--compact .usage-view__header { padding: 8px 12px; }
.usage-view--compact .usage-view__content { padding: 8px 12px 24px; }
.usage-view__picker-row { display: flex; align-items: center; gap: 8px; }
.usage-view__picker-row :deep(.usage-picker) { flex: 1 1 auto; width: auto; min-width: 0; }
.usage-view__record--icon { flex: none; margin-left: 0; }
/* The modes take a whole row on phones; Exact only wraps below them. */
.usage-view--compact .usage-view__modes { flex: 1 1 100%; }
.usage-view--compact .usage-view__modes :deep(.v-btn) { flex: 1 1 0; min-width: 0; padding: 0 8px; }
.usage-view__controls :deep(.v-chip--variant-outlined) { border-color: rgb(var(--v-theme-outline)); }
/* Touch: 48 px targets; the chip keeps its look and gains an invisible margin (buttons have JSKIT's). */
@media (pointer: coarse) {
  .usage-view__modes { height: 48px; }
  .usage-view__controls :deep(.v-chip) { position: relative; overflow: visible; margin-block: 8px; }
  .usage-view__controls :deep(.v-chip)::after { content: ""; position: absolute; inset: -8px 0; }
}
</style>
