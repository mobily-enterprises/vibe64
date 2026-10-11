<template>
  <section ref="workspace" class="architecture" aria-label="Project architecture">
    <header class="architecture__toolbar">
      <div><h1 class="text-headline-small">Architecture</h1><p class="text-body-small text-medium-emphasis">{{ engineOnly ? 'Engine subsystems → files → public interfaces' : 'UI intent → Engine entry points → dependency layers' }}</p></div>
      <div class="architecture__controls">
        <v-btn variant="text" min-height="48" :disabled="!canBack" @click="back">Back</v-btn>
        <v-btn variant="text" min-height="48" :disabled="!canForward" @click="forward">Forward</v-btn>
        <v-btn variant="text" min-height="48" :disabled="loading || refreshing" @click="reload">Reload</v-btn>
        <v-btn v-if="refreshing" variant="text" min-height="48" @click="cancelRefresh">Cancel analysis</v-btn>
        <v-btn variant="tonal" min-height="48" :loading="refreshing" @click="refresh">Refresh analysis</v-btn>
      </div>
    </header>
    <v-alert v-if="error" type="error" variant="tonal" class="ma-3">{{ error }}</v-alert>
    <p v-if="loading && !architecture" role="status" class="pa-4">Loading architecture…</p>
    <template v-if="architecture">
      <div class="architecture__coverage" role="status">
        <span>Dependencies: {{ architecture.capabilities.dependencies }}</span>
        <span>UI: {{ architecture.capabilities.pages }}</span>
        <span>{{ unresolvedDependencies }} unresolved references</span>
        <span>Arrows mean source dependencies. Runtime flow can differ.</span>
      </div>
      <nav v-if="!engineOnly" class="architecture__mobile-tabs" aria-label="Architecture pane">
        <v-btn min-height="48" :variant="pane === 'ui' ? 'tonal' : 'text'" @click="pane = 'ui'">UI</v-btn>
        <v-btn min-height="48" :variant="pane === 'engine' ? 'tonal' : 'text'" @click="pane = 'engine'">Engine</v-btn>
      </nav>
      <div v-if="selectedConnection" class="architecture__connection-strip">
        {{ selectedPage?.title }} → {{ controllerFile?.path || selectedConnection.resolution }}
        <v-btn v-if="controllerFile" variant="text" min-height="48" @click="followConnection(selectedConnection)">Follow controller</v-btn>
      </div>
      <div ref="panes" class="architecture__panes" :class="{ 'architecture__panes--engine-only': engineOnly }" :style="{ '--ui-width': `${uiWidth}%` }" @scroll.capture.passive="measureConnection">
        <svg v-if="connectionLine" class="architecture__bridge" :width="bridgeSize.width" :height="bridgeSize.height" aria-hidden="true">
          <defs><marker :id="bridgeMarker" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="currentColor" /></marker></defs>
          <path :d="connectionLine" stroke="currentColor" stroke-width="2" fill="none" :marker-end="`url(#${bridgeMarker})`" />
        </svg>
        <section v-if="!engineOnly" class="architecture__ui" :class="{ 'architecture__pane--hidden': pane !== 'ui' }" aria-label="UI pages and components">
          <header class="architecture__pane-heading"><h2>UI</h2><span>{{ pages.length }} pages / screens / scenes</span></header>
          <div v-if="!pages.length" class="architecture__empty">
            <h3>{{ architecture.ui?.capabilities.pages === 'complete' ? 'Engine-only project' : 'Page discovery needs evidence' }}</h3>
            <p>{{ architecture.ui?.capabilities.pages === 'complete' ? 'The configured inspector found no UI entry points.' : 'Declare UI discovery inputs in Stack and provide a technology inspector. Registered navigation and filesystem routing are both supported.' }}</p>
            <v-btn variant="text" min-height="48" @click="openSource({ path: 'genesis/stack.md' })">Open Stack</v-btn>
          </div>
          <div v-else class="architecture__pages">
            <button v-for="page in pages" :key="page.id" type="button" class="architecture__page" :class="{ 'architecture__item--selected': page.id === pageId }" :style="{ paddingLeft: `${16 + page.depth * 16}px` }" :aria-pressed="page.id === pageId" @click="selectPage(page.id)">
              <strong>{{ page.title }}</strong><span>{{ page.surface }} · {{ page.kind }}</span>
              <small>{{ page.registrations.map(registration => registration.identity).join(' · ') || page.file }}</small>
            </button>
          </div>
          <section v-if="selectedPage" class="architecture__composition" aria-label="Selected page composition">
            <h3>{{ selectedPage.title }}</h3>
            <v-btn variant="text" min-height="48" @click="openSource({ path: selectedPage.file })">Open interface</v-btn>
            <h4>Components</h4>
            <p v-if="!composition.length" class="text-body-small text-medium-emphasis">No component uses recorded. Coverage: {{ architecture.ui.capabilities.components }}.</p>
            <button v-for="use in composition" :key="use.contextId" type="button" class="architecture__component" :style="{ marginLeft: `${use.depth * 12}px` }" :disabled="!use.component" @click="revealFile(use.component?.fileId || use.component?.origin?.packageId)">
              <strong>{{ use.component?.title || 'Unresolved component' }}</strong>
              <small>{{ ownerTitle(use.component?.subsystemId) }}{{ use.component?.origin?.kind === 'package' ? ' · Package boundary' : '' }}{{ use.recursive ? ' · Recursive use' : '' }}</small>
              <span v-if="use.component">{{ use.component.file || use.component.origin?.importPath }}</span>
            </button>
            <p v-if="composition.truncated" class="text-body-small" role="status">Showing the first 200 component uses. Shared definitions can repeat in this composition; Engine entry points below use the complete relationship graph.</p>
            <h4>Engine entry points</h4>
            <p v-if="!connections.length" class="text-body-small text-medium-emphasis">No receiving operation is evidenced for this page. Coverage: {{ architecture.ui.capabilities.operationUses }}.</p>
            <button v-for="connection in connections" :key="connection.id" :ref="element => registerConnectionElement(connection.id, element)" type="button" class="architecture__operation" :class="{ 'architecture__item--selected': connection.id === connectionId }" @click="followConnection(connection)">
              <strong>{{ connection.key?.operation || 'Dynamic operation' }}</strong>
              <small>{{ connection.key?.protocol }} · {{ connection.key?.scope }} · {{ connection.resolution }}</small>
              <span>{{ fileById.get(connection.controllerFileId)?.path || 'Receiving controller unresolved' }}</span>
            </button>
          </section>
        </section>
        <section class="architecture__engine" :class="{ 'architecture__pane--hidden': !engineOnly && pane !== 'engine' }" aria-label="Engine dependency layers">
          <header class="architecture__pane-heading"><h2>Engine</h2><span>{{ architecture.subsystems.length }} subsystems · {{ architecture.files.length }} files</span></header>
          <div class="architecture__engine-controls">
            <v-btn min-height="48" variant="text" :disabled="!subsystemId" @click="navigate({ subsystemId: '', fileId: '', packageId: '', query: '' })">All subsystems</v-btn>
            <strong>{{ selectedSubsystem?.title || 'Subsystem layers' }}</strong>
            <label><input v-model="allEdges" type="checkbox" /> All arrows</label>
            <label><input v-model="includeTypeOnly" type="checkbox" /> Include type-only dependencies</label>
          </div>
          <p class="pa-3 text-body-small">Layer numbers are relative to {{ subsystemId ? 'this subsystem’s files' : 'the subsystem overview' }}. {{ includeTypeOnly ? 'Type-only dependencies are included.' : 'Type-only dependencies are excluded.' }}</p>
          <p v-if="selectedFile && graph.externalCycleFileIds.has(selectedFile.id)" class="pa-3 text-body-small" role="status">This file participates in a dependency cycle across subsystems. <v-btn variant="text" min-height="48" @click="navigate({ subsystemId: '', query: '', allEdges: true })">Show cycle</v-btn></p>
          <label class="architecture__search">Find a subsystem or file<input v-model="engineQuery" type="search" placeholder="Search names and paths" /></label>
          <button v-if="controllerFile" ref="controllerElement" type="button" class="architecture__controller" @click="openSource({ path: controllerFile.path, symbol: selectedConnection.controllerSymbol })">
            <small>Selected receiving controller · {{ ownerTitle(controllerFile.subsystemId) }}</small>
            <strong>{{ controllerFile.path }}</strong>
            <span>{{ selectedConnection.controllerSymbol || 'Open public interface' }}</span>
          </button>
          <Vibe64LayerDiagram :active="active" :graph="graph" :selected-id="packageId || (subsystemId ? fileId : highlightedSubsystemId)" :query="engineQuery" :all-edges="allEdges" @select="selectEngineNode" />
          <section v-if="incidentEdges.length" class="architecture__evidence" aria-label="Selected dependencies">
            <h3>Dependency evidence</h3>
            <button v-for="edge in incidentEdges" :key="`${edge.fromId}:${edge.toId}`" type="button" @click="inspectEdge(edge)">
              {{ nodeTitle(edge.fromId) }} → {{ nodeTitle(edge.toId) }} <small>{{ edge.evidence.length }} source references</small>
            </button>
          </section>
          <section v-if="graph.boundary.length" class="architecture__evidence" aria-label="Dependencies outside this subsystem">
            <h3>Across the subsystem boundary</h3>
            <button v-for="edge in graph.boundary" :key="edge.evidence[0].id" type="button" @click="revealFile(edge.from.subsystemId === subsystemId ? edge.to.id : edge.from.id)">{{ edge.from.path }} → {{ edge.to.path }} <small>{{ ownerTitle(edge.from.subsystemId) }} → {{ ownerTitle(edge.to.subsystemId) }}</small></button>
          </section>
        </section>
      </div>
      <label v-if="!engineOnly" class="architecture__divider">Pane balance <input v-model.number="uiWidth" type="range" min="25" max="55" aria-label="UI pane width" /></label>
      <section v-if="selectedPackage || selectedFile || selectedSubsystem || edgeEvidence.length" class="architecture__inspector" aria-label="Architecture inspector">
        <template v-if="edgeEvidence.length"><h3>Source evidence</h3><button v-for="evidence in edgeEvidence" :key="evidence.id" type="button" class="architecture__evidence-link" @click="openSource({ path: evidence.evidence.path, line: evidence.evidence.start?.line })">{{ evidence.evidence.path }}:{{ evidence.evidence.start?.line }} · {{ evidence.specifier || evidence.kind }}{{ evidence.typeOnly || evidence.kind === 'type-import' ? ' · Type only' : '' }}</button></template>
        <template v-else-if="selectedPackage">
          <h3>{{ selectedPackage.name }} <small>{{ selectedPackage.version || 'Installed version unavailable' }}</small></h3>
          <p>{{ selectedPackage.opaque ? 'Opaque package: this view shows its declared public boundary. Internal files and dependency trees stay outside the project graph.' : 'Project-owned package: its source remains part of the directory and file layers.' }}</p>
          <p class="text-body-small">{{ selectedPackage.manager }} · {{ selectedPackage.dependencyKinds.join(', ') }} · Requested {{ selectedPackage.requested }} · Public symbols: {{ selectedPackage.symbolCoverage }}</p>
          <v-btn v-for="declaration in selectedPackage.declarations || [{ manifest: selectedPackage.manifest, requested: selectedPackage.requested }]" :key="declaration.manifest" min-height="48" variant="text" @click="openSource({ path: declaration.manifest, presentation: 'code' })">Open dependency declaration · {{ declaration.manifest }} · {{ declaration.requested }}</v-btn>
          <p v-if="!selectedPackage.entryPoints.length">Public import paths are unavailable. Check dependency preparation and the Package discovery declaration in Stack, then refresh analysis.</p>
          <label v-if="selectedPackage.entryPoints.some(entry => entry.symbols.length)" class="architecture__search">Find a public package symbol<input v-model="packageSymbolQuery" type="search" placeholder="Search symbol names" /></label>
          <details v-for="(entry, index) in packageEntries" :key="index" class="architecture__package-entry">
            <summary>{{ packageImportPath(selectedPackage, entry) }} <small>{{ entry.conditions.join(' · ') || 'Default' }} · {{ entry.symbols.length }} public symbols · {{ entry.coverage }}</small></summary>
            <p class="text-body-small">Declared target: {{ entry.target }}</p>
            <ul v-if="entry.symbols.length"><li v-for="(symbol, symbolIndex) in entry.matchingSymbols.slice(0, 200)" :key="symbolIndex">{{ symbol.qualifiedName || symbol.name }}{{ Array.isArray(symbol.parameters) ? `(${symbol.parameters.join(', ')})` : '' }} <small>{{ symbol.kind }}</small></li></ul>
            <p v-if="entry.symbols.length && entry.matchingSymbols.length > 200" role="status">Showing 200 of {{ entry.matchingSymbols.length }} matching symbols. Search to find any available public symbol.</p>
            <p v-if="entry.symbols.length && !entry.matchingSymbols.length" role="status">No public symbols match this search.</p>
            <p v-if="!entry.symbols.length">No public symbols are available from this declared entry. Re-exports, wildcard paths, runtime exports or an unsupported parser can require additional analysis.</p>
          </details>
        </template>
        <template v-else-if="selectedFile">
          <h3>{{ selectedFile.path }}</h3><p class="text-body-small text-medium-emphasis">Public symbols · {{ selectedFile.language === 'unknown' ? 'Analysis unavailable for this file' : 'Partial static coverage' }}</p>
          <div class="architecture__symbol-list"><v-btn v-for="symbol in publicSymbols" :key="symbol.id" variant="tonal" min-height="48" @click="openSource({ path: selectedFile.path, symbolId: symbol.id, line: symbol.start?.line })">{{ symbol.qualifiedName || symbol.name }} <small class="ml-2">{{ symbol.kind }}{{ symbol.visibilityScope && symbol.visibilityScope !== 'public' ? ` · Visibility: ${symbol.visibilityScope}` : '' }}</small></v-btn></div>
          <v-btn min-height="48" variant="text" @click="openSource({ path: selectedFile.path })">Open interface</v-btn>
          <v-btn min-height="48" variant="text" @click="openSource({ path: selectedFile.path, presentation: 'code' })">Code · whole file</v-btn>
        </template>
        <template v-else-if="selectedSubsystem"><h3>{{ selectedSubsystem.title }}</h3><p>{{ selectedSubsystem.description || 'Directory boundary inferred from Stack or the project inventory.' }}</p><p class="text-body-small">{{ selectedSubsystem.root }} · {{ selectedSubsystem.provenance }}</p><v-btn v-if="selectedSubsystem.authoredId" min-height="48" variant="tonal" @click="detailsOpen = true">Operations and data</v-btn></template>
      </section>
      <v-alert v-for="(diagnostic, index) in architecture.diagnostics" :key="index" type="warning" variant="tonal" class="ma-3">{{ diagnostic.message }} {{ diagnostic.path }}</v-alert>
    </template>
    <div v-else-if="!loading" class="architecture__empty">
      <h2>Build a view of your project</h2><p>Refresh analysis to discover directory boundaries and available symbols. Page and controller evidence comes from the project’s technology inspector.</p>
      <v-btn min-height="48" variant="tonal" :loading="refreshing" @click="refresh">Refresh analysis</v-btn>
      <v-btn min-height="48" variant="text" @click="detailsOpen = true">Operations and data</v-btn>
    </div>
    <v-dialog v-model="detailsOpen" max-width="1100" scrollable>
      <v-card><v-card-actions><v-btn min-height="48" @click="detailsOpen = false">Close details</v-btn></v-card-actions><v-card-text>
        <Vibe64SubsystemsView v-bind="props" :active="active && detailsOpen" :restore-request="detailRestoreRequest || { subsystemId: selectedSubsystem?.authoredId || '' }" @open-source-file="openSource" @open-table="openSource($event, 'open-table')" @describe-subsystems="$emit('describe-subsystems')">
          <template v-if="$slots.text" #text="slotProps"><slot name="text" v-bind="slotProps" /></template>
        </Vibe64SubsystemsView>
      </v-card-text></v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, useId, watch } from "vue";
import { useVibe64SystemGraph } from "../composables/useVibe64SystemGraph.js";
import { architectureGraph } from "../layeredGraph.js";
import { pageComposition, pageConnections, pageHierarchy } from "../architectureModel.js";
import { createWorldViewHistory } from "../world/worldViewHistory.js";
import Vibe64LayerDiagram from "./Vibe64LayerDiagram.vue";
import Vibe64SubsystemsView from "./Vibe64SubsystemsView.vue";
const props = defineProps({ active: Boolean, assistantAvailable: { type: Boolean, default: true }, sessionId: { type: String, required: true }, projectSlug: { type: String, default: '' }, reloadVersion: { type: Number, default: 0 }, restoreRequest: { type: Object, default: null }, resolveRequestUrl: { type: Function, default: value => value } });
const emit = defineEmits(['open-source-file', 'open-table', 'describe-subsystems']);
const { cancelRefresh, architecture, loading, error, refresh, refreshing, reload } = useVibe64SystemGraph({ active: toRef(props, 'active'), sessionId: toRef(props, 'sessionId'), reloadVersion: toRef(props, 'reloadVersion'), projection: 'architecture' });
const pageId = ref(''); const subsystemId = ref(''); const fileId = ref(''); const packageId = ref(''); const connectionId = ref(''); const pane = ref('ui');
const uiWidth = ref(36); const allEdges = ref(false); const detailsOpen = ref(false); const edgeEvidence = ref([]);
const includeTypeOnly = ref(false);
const detailRestoreRequest = ref(null);
const engineQuery = ref('');
const workspace = ref(null); const panes = ref(null); const controllerElement = ref(null);
const history = createWorldViewHistory(); const historyVersion = ref(0);
const canBack = computed(() => { void historyVersion.value; return history.canBack; });
const canForward = computed(() => { void historyVersion.value; return history.canForward; });
const fileById = computed(() => new Map((architecture.value?.files || []).map(file => [file.id, file])));
const subsystems = computed(() => new Map((architecture.value?.subsystems || []).map(subsystem => [subsystem.id, subsystem])));
const pages = computed(() => pageHierarchy(architecture.value?.ui));
const engineOnly = computed(() => architecture.value?.capabilities.pages === 'complete' && !pages.value.length);
const selectedPage = computed(() => pages.value.find(page => page.id === pageId.value));
const composition = computed(() => pageComposition(architecture.value?.ui, pageId.value));
const connections = computed(() => pageConnections(architecture.value?.ui, pageId.value));
const selectedConnection = computed(() => connections.value.find(connection => connection.id === connectionId.value));
const controllerFile = computed(() => fileById.value.get(selectedConnection.value?.controllerFileId));
const selectedFile = computed(() => fileById.value.get(fileId.value));
const packages = computed(() => new Map((architecture.value?.packages || []).map(entry => [entry.id, entry])));
const selectedPackage = computed(() => packages.value.get(packageId.value));
const packageSymbolQuery = ref('');
const packageEntries = computed(() => {
  const query = packageSymbolQuery.value.trim().toLocaleLowerCase();
  return (selectedPackage.value?.entryPoints || []).map(entry => ({ ...entry, matchingSymbols: query ? entry.symbols.filter(symbol => `${symbol.qualifiedName || ''} ${symbol.name}`.toLocaleLowerCase().includes(query)) : entry.symbols }));
});
watch(packageId, () => { packageSymbolQuery.value = ''; });
const selectedSubsystem = computed(() => subsystems.value.get(subsystemId.value));
const highlightedSubsystemId = computed(() => selectedFile.value?.subsystemId || subsystemId.value);
const publicSymbols = computed(() => (architecture.value?.symbols || []).filter(symbol => symbol.fileId === fileId.value && symbol.visibility === 'public'));
const graph = computed(() => architectureGraph(architecture.value, subsystemId.value, { includeTypeOnly: includeTypeOnly.value }));
const incidentEdges = computed(() => graph.value.edges.filter(edge => edge.fromId === (packageId.value || (subsystemId.value ? fileId.value : highlightedSubsystemId.value)) || edge.toId === (packageId.value || (subsystemId.value ? fileId.value : highlightedSubsystemId.value))));
const unresolvedDependencies = computed(() => (architecture.value?.relations || []).filter(relation => relation.resolution !== 'resolved').length);
function state() { return { pageId: pageId.value, subsystemId: subsystemId.value, fileId: fileId.value, packageId: packageId.value, connectionId: connectionId.value, pane: pane.value, query: engineQuery.value, allEdges: allEdges.value, includeTypeOnly: includeTypeOnly.value, detailsOpen: detailsOpen.value, detailRestoreRequest: detailRestoreRequest.value ? { ...detailRestoreRequest.value } : null, scrollTop: workspace.value?.scrollTop || 0, pageScrollTop: workspace.value?.querySelector('.architecture__pages')?.scrollTop || 0 }; }
function apply(value) {
  pageId.value = value.pageId || ''; subsystemId.value = value.subsystemId || ''; fileId.value = value.fileId || ''; connectionId.value = value.connectionId || ''; pane.value = value.pane || 'ui'; edgeEvidence.value = [];
  packageId.value = value.packageId || ''; engineQuery.value = value.query || ''; allEdges.value = Boolean(value.allEdges);
  includeTypeOnly.value = Boolean(value.includeTypeOnly);
  detailsOpen.value = Boolean(value.detailsOpen); detailRestoreRequest.value = value.detailRestoreRequest || null;
  nextTick(() => {
    if (workspace.value) workspace.value.scrollTop = Math.max(0, Number(value.scrollTop) || 0);
    const list = workspace.value?.querySelector('.architecture__pages');
    if (list) list.scrollTop = Math.max(0, Number(value.pageScrollTop) || 0);
  });
}
function navigate(change) { history.record(state()); historyVersion.value++; apply({ ...state(), ...(change.subsystemId !== undefined && change.subsystemId !== subsystemId.value ? { detailRestoreRequest: null } : {}), ...change }); }
function back() { const value = history.back(state()); if (value) apply(value); historyVersion.value++; }
function forward() { const value = history.forward(state()); if (value) apply(value); historyVersion.value++; }
function selectPage(id) { navigate({ pageId: id, connectionId: '', pane: 'ui' }); }
function revealFile(id) { if (packages.value.has(id)) navigate({ packageId: id, fileId: '', pane: 'engine' }); else { const file = fileById.value.get(id); if (file) navigate({ subsystemId: file.subsystemId, fileId: id, packageId: '', query: '', pane: 'engine' }); } }
function followConnection(connection) { const file = fileById.value.get(connection.controllerFileId); navigate({ connectionId: connection.id, packageId: '', query: '', ...(file ? { subsystemId: file.subsystemId, fileId: file.id, pane: 'engine' } : {}) }); }
function selectEngineNode(id) { if (packages.value.has(id)) navigate({ packageId: id, fileId: '', pane: 'engine' }); else if (subsystemId.value) navigate({ fileId: id, packageId: '' }); else navigate({ subsystemId: id, fileId: '', packageId: '', query: '', pane: 'engine' }); }
function packageImportPath(dependency, entry) { return entry.importPath === '.' ? dependency.name : `${dependency.name}${entry.importPath.slice(1)}`; }
function ownerTitle(id) { return subsystems.value.get(id)?.title || 'Owner unavailable'; }
function nodeTitle(id) { return fileById.value.get(id)?.path || packages.value.get(id)?.name || subsystems.value.get(id)?.title || id; }
function inspectEdge(edge) { edgeEvidence.value = edge.evidence; }
function openSource(target, event = 'open-source-file') {
  const selection = { ...state(), detailRestoreRequest: detailsOpen.value ? target.systemContext || null : detailRestoreRequest.value };
  detailsOpen.value = false;
  emit(event, { ...target, origin: 'system', systemContext: { ...target.systemContext, subsystemView: 'architecture', architectureSelection: selection } });
}
watch(() => props.restoreRequest, request => { if (request?.architectureSelection) apply(request.architectureSelection); }, { immediate: true });
watch(() => props.sessionId, () => { apply({}); history.clear(); historyVersion.value++; });
watch(pages, value => { if (architecture.value && !value.some(page => page.id === pageId.value)) pageId.value = value[0]?.id || ''; }, { immediate: true });
watch(architecture, value => {
  if (!value) return;
  if (!subsystems.value.has(subsystemId.value)) subsystemId.value = '';
  if (!fileById.value.has(fileId.value)) fileId.value = '';
  else if (fileId.value && subsystemId.value) subsystemId.value = fileById.value.get(fileId.value).subsystemId;
  if (!packages.value.has(packageId.value)) packageId.value = '';
  if (!connections.value.some(connection => connection.id === connectionId.value)) connectionId.value = '';
  edgeEvidence.value = [];
});
const connectionElements = new Map(); const connectionLine = ref(''); const bridgeSize = ref({ width: 0, height: 0 });
const bridgeMarker = `controller-${useId().replace(/[^a-zA-Z0-9_-]/gu, '')}`;
let observer; let frame;
function registerConnectionElement(id, element) { if (element) connectionElements.set(id, element); else connectionElements.delete(id); }
function measureConnection() {
  cancelAnimationFrame(frame);
  if (!props.active || !workspace.value) return;
  frame = requestAnimationFrame(() => {
    if (!props.active || !workspace.value) return;
    const outer = panes.value?.getBoundingClientRect(); const from = connectionElements.get(connectionId.value)?.getBoundingClientRect(); const to = controllerElement.value?.getBoundingClientRect();
    connectionLine.value = '';
    const uiBounds = workspace.value?.querySelector('.architecture__ui')?.getBoundingClientRect();
    const engineBounds = workspace.value?.querySelector('.architecture__engine')?.getBoundingClientRect();
    if (!outer || !from || !to || outer.width < 760 || !uiBounds || !engineBounds || from.bottom <= uiBounds.top || from.top >= uiBounds.bottom || to.bottom <= engineBounds.top || to.top >= engineBounds.bottom) return;
    bridgeSize.value = { width: outer.width, height: outer.height };
    const x1 = from.right - outer.left; const y1 = from.top + from.height / 2 - outer.top;
    const x2 = to.left - outer.left; const y2 = to.top + to.height / 2 - outer.top;
    const middle = (x1 + x2) / 2;
    connectionLine.value = `M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`;
  });
}
watch(() => [state(), uiWidth.value, architecture.value], async () => { await nextTick(); measureConnection(); });
watch(() => props.active, async active => {
  observer?.disconnect(); cancelAnimationFrame(frame);
  if (!active) return;
  await nextTick();
  if (props.active && workspace.value) { observer?.observe(workspace.value); measureConnection(); }
});
onMounted(() => { observer = new ResizeObserver(measureConnection); if (props.active) { observer.observe(workspace.value); measureConnection(); } });
onBeforeUnmount(() => { observer?.disconnect(); cancelAnimationFrame(frame); });
</script>

<style scoped>
.architecture { container-type: inline-size; padding: 16px; height: 100%; min-width: 0; overflow: auto; color: rgb(var(--v-theme-on-surface)); }
.architecture__toolbar, .architecture__controls, .architecture__coverage, .architecture__engine-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.architecture__toolbar { justify-content: space-between; margin-bottom: 16px; }
.architecture__coverage { font-size: 12px; padding: 12px; background: rgba(var(--v-theme-primary), .06); border-radius: 12px; margin-bottom: 16px; }
.architecture__panes { display: grid; grid-template-columns: minmax(240px, var(--ui-width)) minmax(0, 1fr); gap: 32px; position: relative; align-items: start; }
.architecture__panes--engine-only { grid-template-columns: minmax(0, 1fr); }
.architecture__bridge { position: absolute; left: 0; top: 0; pointer-events: none; color: rgb(var(--v-theme-primary)); z-index: 2; }
.architecture__ui, .architecture__engine { min-width: 0; border: 1px solid rgba(var(--v-theme-on-surface), .12); border-radius: 16px; max-height: min(900px, 70dvh); overflow: auto; }
.architecture__pane-heading { padding: 18px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), .1); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
.architecture__pane-heading h2 { font-size: 20px; }
.architecture__pane-heading span { font-size: 12px; opacity: .65; }
.architecture__package-entry { border-top: 1px solid rgba(var(--v-theme-on-surface), .12); padding: 12px 0; }
.architecture__package-entry summary { cursor: pointer; min-height: 48px; padding: 12px; overflow-wrap: anywhere; }
.architecture__package-entry small { opacity: .7; }
.architecture__package-entry ul { padding: 8px 24px; }
.architecture__pages { max-height: 340px; overflow: auto; }
.architecture__page, .architecture__component, .architecture__operation, .architecture__controller { display: flex; flex-direction: column; text-align: left; min-height: 64px; padding: 16px; gap: 4px; border: 1px solid transparent; border-radius: 8px; color: inherit; width: 100%; cursor: pointer; }
.architecture__page { border-radius: 0; border-bottom: 1px solid rgba(var(--v-theme-on-surface), .07); }
.architecture__page span, .architecture__component span, .architecture__operation span, .architecture__controller span { font-size: 12px; opacity: .7; overflow-wrap: anywhere; }
.architecture__page small, .architecture__component small, .architecture__operation small, .architecture__controller small { font-size: 11px; opacity: .7; overflow-wrap: anywhere; }
.architecture__item--selected, .architecture__controller { background: rgba(var(--v-theme-primary), .1); border-color: rgb(var(--v-theme-primary)); }
.architecture__page strong, .architecture__component strong, .architecture__operation strong, .architecture__controller strong, .architecture__inspector h3 { overflow-wrap: anywhere; }
.architecture__symbol-list :deep(.v-btn) { max-width: 100%; }
.architecture__symbol-list :deep(.v-btn__content) { white-space: normal; overflow-wrap: anywhere; }
.architecture__composition { padding: 16px; border-top: 1px solid rgba(var(--v-theme-on-surface), .1); }
.architecture__composition h4 { margin: 16px 0 8px; font-size: 13px; }
.architecture__component, .architecture__operation { margin-bottom: 8px; width: calc(100% - 12px); background: rgba(var(--v-theme-on-surface), .035); }
.architecture__controller { margin: 12px 20px; width: calc(100% - 40px); }
.architecture__engine-controls { padding: 8px 12px; font-size: 13px; }
.architecture__search { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 4px 16px 12px; font-size: 12px; }
.architecture__search input { min-height: 48px; min-width: 0; flex: 1; padding: 10px; border: 1px solid rgba(var(--v-theme-on-surface), .2); border-radius: 8px; }
.architecture__engine-controls label { margin-left: auto; display: flex; align-items: center; gap: 6px; min-height: 48px; }
.architecture__evidence { padding: 16px; border-top: 1px solid rgba(var(--v-theme-on-surface), .1); font-size: 12px; }
.architecture__evidence h3 { font-size: 13px; margin-bottom: 8px; }
.architecture__evidence button, .architecture__evidence-link { display: block; text-align: left; min-height: 48px; padding: 8px; color: rgb(var(--v-theme-primary)); overflow-wrap: anywhere; }
.architecture__evidence small { opacity: .7; }
.architecture__inspector { margin-top: 16px; padding: 20px; background: rgba(var(--v-theme-on-surface), .04); border-radius: 16px; }
.architecture__symbol-list { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.architecture__empty { padding: 28px; }
.architecture__empty p { margin: 12px 0; line-height: 1.6; }
.architecture__divider { display: flex; align-items: center; justify-content: center; gap: 12px; min-height: 48px; font-size: 12px; opacity: .7; }
.architecture__mobile-tabs { display: none; }
.architecture__connection-strip { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px; font-size: 12px; align-items: center; overflow-wrap: anywhere; }
button:focus-visible { outline: 3px solid rgb(var(--v-theme-primary)); outline-offset: -3px; }
@container (max-width: 759px) { .architecture__ui, .architecture__engine { max-height: none; } .architecture__panes { display: block; } .architecture__pane--hidden { display: none; } .architecture__mobile-tabs { display: flex; gap: 8px; padding: 8px; } .architecture__connection-strip { display: flex; flex-wrap: wrap; padding: 8px; font-size: 12px; align-items: center; overflow-wrap: anywhere; } .architecture__divider { display: none; } .architecture__toolbar { align-items: flex-start; } }
</style>
