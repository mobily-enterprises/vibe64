<template>
  <section class="ui-storyboard" aria-label="UI and Engine architecture">
    <header class="ui-storyboard__toolbar">
      <slot name="navigation" />
      <div class="ui-storyboard__heading">
        <h1>Architecture</h1>
        <p>{{ uiIds.length }} pages / screens / scenes · {{ engineIds.length - (externalCount ? 1 : 0) }} subsystems<span v-if="externalCount"> · {{ externalCount }} external packages</span> <span v-if="coverage && coverage !== 'complete'">· {{ coverage }} page discovery</span><span v-if="architecture?.ui?.capabilities?.operationUses === 'unconfigured'" title="This project has no UI-call discovery configured. Missing arrows do not prove there are no calls."> · UI calls not analysed</span></p>
      </div>
      <div class="ui-storyboard__actions">
        <v-btn size="small" variant="text" :disabled="!contentCount" @click="fit()">Fit</v-btn>
        <v-menu>
          <template #activator="{ props: menuProps }"><v-btn v-bind="menuProps" size="small" variant="text" aria-label="Architecture options" title="Architecture options" min-width="36">⋯</v-btn></template>
          <v-list density="compact">
            <v-list-item title="Fit UI" :disabled="!uiIds.length" @click="fit(uiIds)" />
            <v-list-item title="Fit Engine" :disabled="!engineIds.length" @click="fit(engineIds)" />
            <v-list-item :title="showCalls ? 'Hide UI calls' : 'Show all UI calls'" :disabled="!edges.some(edge => edge.type === 'controller')" @click="toggleCalls" />
            <v-list-item title="Zoom in" :disabled="!contentCount" @click="zoomControl(true)" />
            <v-list-item title="Zoom out" :disabled="!contentCount" @click="zoomControl(false)" />
            <v-list-item title="Reset arrangement" :disabled="!Object.keys(layoutPositions).length" @click="layoutPositions = {}" />
            <v-divider />
            <v-list-item title="Reload architecture" :disabled="loading" @click="reload" />
            <v-list-item v-if="refreshing" title="Cancel analysis" @click="cancelRefresh" />
            <v-list-item v-else title="Refresh analysis" :disabled="loading" @click="refresh" />
          </v-list>
        </v-menu>
      </div>
    </header>
    <div ref="canvas" class="ui-storyboard__canvas" tabindex="-1" @keydown.esc.capture="expandedSubsystemId && ($event.preventDefault(), $event.stopPropagation(), fileRequest ? closeFile() : closeDetail($event))" @wheel.capture="zoomWheel" @touchstart.capture="startPinch" @touchmove.capture="movePinch" @touchend.capture="endPinch" @touchcancel.capture="endPinch">
      <v-alert v-if="error && error !== dismissedError" class="ui-storyboard__error" type="error" variant="tonal" closable @click:close="dismissedError = error">{{ error }}</v-alert>
      <v-alert v-else-if="architecture?.diagnostics?.some(item => item.code === 'ARCHITECTURE_UI_STALE')" class="ui-storyboard__error" type="info" variant="tonal">UI map needs refresh. <v-btn size="small" variant="text" :loading="refreshing" @click="refresh">Refresh analysis</v-btn></v-alert>
      <VueFlow v-model:nodes="nodes" :edges="visibleEdges" :min-zoom="0.08" :max-zoom="3"
        :zoom-on-double-click="false" :zoom-on-scroll="false" :zoom-on-pinch="false" :nodes-draggable="false" :nodes-connectable="false" :edges-updatable="false" :elevate-nodes-on-select="false"
        :default-edge-options="{ markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#7895a4' } }"
        @init="initialize" @nodes-initialized="fitIfPending" @node-click="selectNode" @node-drag-start="dragging = true" @node-drag-stop="rearrangeSubsystem" @viewport-change="compact = $event.zoom < 0.5" @viewport-change-end="viewportChanged" @pane-click="clearSelection">
        <template #node-page="{ data, selected }">
          <article class="storyboard-page" :class="{ 'storyboard-page--compact': compact, 'storyboard-page--root': !data.parentId, 'storyboard-page--selected': selected, 'architecture-context': expandedSubsystemId && data.id !== selectedPageId }" :title="[data.title, ...data.identities, data.file].filter(Boolean).join('\n')">
            <Handle v-if="data.parentId" id="parent" type="target" :position="Position.Top" />
            <div class="storyboard-page__meta"><span>{{ data.kind }}</span><span>{{ data.surface }}</span></div>
            <h2>{{ data.title }}</h2>
            <div v-if="data.identities.length" class="storyboard-page__routes"><span v-for="identity in data.identities" :key="identity">{{ identity }}</span></div>
            <p v-else class="storyboard-page__unregistered">No navigation identity recorded</p>
            <span v-if="data.unresolvedCalls" class="storyboard-page__unresolved">{{ data.unresolvedCalls }} unresolved calls</span>
            <Handle v-if="data.callCount" id="engine-out" type="source" :position="Position.Right" />
            <Handle v-if="data.childCount" id="children" type="source" :position="Position.Bottom" />
          </article>
        </template>
        <template #node-external-dependencies="{ data }">
          <aside class="external-dependencies" aria-label="External dependencies">
            <header><h2>External dependencies</h2><p>{{ data.packages.length }} packages · Available throughout the project</p></header>
            <ul>
              <li v-for="pkg in data.packages" :key="pkg.id"><button type="button" class="nodrag nopan" :data-package-id="pkg.id" :aria-label="`View ${pkg.title} public interface`" :title="pkg.title" @click.stop="expandedSubsystemId = pkg.id">{{ pkg.title }}</button></li>
            </ul>
          </aside>
        </template>
        <template #node-subsystem-detail="{ data }">
          <div class="subsystem-zoom__context"><article class="subsystem-zoom nodrag nopan" aria-label="Zoomed subsystem" @wheel="!$event.ctrlKey && $event.stopPropagation()" @touchmove="($event.touches.length !== 2) && $event.stopPropagation()">
            <nav class="subsystem-zoom__breadcrumbs" aria-label="Architecture location">
              <button type="button" class="subsystem-zoom__back nodrag nopan" aria-label="Back to previous view" @click="goBack">← Back</button>
              <button type="button" class="nodrag nopan" @click="closeDetail">Engine</button><span>›</span>
              <button v-if="fileRequest" type="button" class="nodrag nopan" @click="closeFile">{{ data.owner.title }}</button><strong v-else>{{ data.owner.title }}</strong>
              <template v-if="fileRequest"><span>›</span><strong>{{ fileRequest.path.split('/').pop() }}</strong></template>
              <button type="button" class="subsystem-zoom__close" :aria-label="fileRequest ? 'Back to subsystem' : 'Back to Engine'" title="Close this view (Esc)" @click="fileRequest ? closeFile() : closeDetail($event)">×</button>
            </nav>
            <p class="subsystem-zoom__navigation-hint">Scroll to read · Pinch to zoom · Esc / × to go back</p>
            <div v-if="retainedFileRequest" v-show="fileRequest" class="subsystem-zoom__file"><slot name="file-interface" :request="retainedFileRequest" :active="!!fileRequest" :architecture="architecture" :refresh="refresh" :refreshing="refreshing" :open-file="openFile" :update-location="updateFileLocation"><button type="button" @click="emit('inspect-file', retainedFileRequest)">Open {{ retainedFileRequest.path }} interface</button></slot></div>
            <div v-show="!fileRequest" class="subsystem-zoom__body">
              <div v-if="!data.outline" class="subsystem-zoom__loading" role="status" aria-busy="true" aria-label="Loading subsystem interface"><h2>{{ data.owner.title }}</h2><p>{{ data.owner.root }}</p><div class="subsystem-zoom__skeleton" /><div class="subsystem-zoom__skeleton" /><div class="subsystem-zoom__skeleton" /><p>Preparing interface and files…</p></div>
              <Vibe64SubsystemInspector v-else embedded :outline="data.outline" @inspect="openFile" @open-source="emit('open-source-file', $event)"><template #text="context"><slot name="text" v-bind="context" :open-source="openFile">{{ context.text }}</slot></template></Vibe64SubsystemInspector>
            </div>
          </article></div>
        </template>
        <template #node-subsystem="{ data, selected }">
          <article class="engine-subsystem" :class="{ 'engine-subsystem--compact': compact, 'engine-subsystem--library': data.library, 'engine-subsystem--support': data.placementKind === 'support', 'engine-subsystem--entry': data.entryFiles.length, 'engine-subsystem--cycle': data.cycleLabel, 'engine-subsystem--selected': selected, 'engine-subsystem--expanded': data.expanded, 'architecture-context': expandedSubsystemId && !data.expanded }"
            :title="`${data.root}\n${data.description || 'Description not recorded.'}${data.sourceLines != null ? '\n' + data.sourceLines.toLocaleString() + ' measured source lines' : ''}${data.cycleLabel ? '\n' + data.cycleLabel : ''}${data.entryFiles.length ? '\nEntry files: ' + data.entryFiles.join(', ') : ''}`">
            <template v-for="port in ports" :key="port.id"><Handle :id="port.id" :type="port.type" :position="port.position" /></template>
            <Handle v-for="(receiver, index) in data.receivers || []" :key="receiver.id" :id="`controller:${receiver.id}`" type="target" :position="Position.Left"
              :style="{ top: `${(index + 1) * 100 / (data.receivers.length + 1)}%` }" />
            <span v-if="data.arrangeable" class="engine-subsystem__grip" role="button" tabindex="0" aria-label="Rearrange subsystem" title="Drag to arrange. Arrow keys move sideways." @keydown.left.stop.prevent="moveSubsystem(data.id, -1)" @keydown.right.stop.prevent="moveSubsystem(data.id, 1)" @dblclick.stop>⠿</span>
            <div class="engine-subsystem__content">
            <div v-if="data.entryFiles.length" class="engine-subsystem__start">Start here</div>
            <div class="engine-subsystem__meta"><span>{{ data.library ? 'Shared library' : data.opaque ? 'Opaque package' : data.entryFiles.length ? 'Entry point' : data.provenance === 'fallback' ? 'Directory group' : 'Subsystem' }}</span><span v-if="data.version">{{ data.version }}</span></div>
            <h2>{{ data.title }}</h2>
            <div v-if="data.root" class="engine-subsystem__directory">{{ data.root }}</div>
            <p class="engine-subsystem__description">{{ data.description || (data.opaque ? 'Public package boundary. Internals stay opaque.' : 'Description not recorded.') }}</p>
            <div class="engine-subsystem__api" :title="data.publicSummary">{{ data.publicSummary }}</div>
            <div class="engine-subsystem__size" :title="data.opaque ? 'Package internals are not measured.' : `${data.measuredFiles} of ${data.fileIds.length} files measured; physical source lines include comments and blanks. Card area has a readability floor.`">
              {{ data.opaque ? 'Unmeasured package' : data.sourceLines == null ? 'Size unavailable' : `${data.sizePartial ? '~' : ''}${data.sourceLines.toLocaleString()} source lines` }}<span v-if="!data.opaque"> · {{ data.fileIds.length }} files</span>
            </div>
            <div v-if="data.receivers?.length" class="engine-subsystem__receivers"><span v-for="receiver in data.receivers.slice(0, 2)" :key="receiver.id" :title="receiver.path">↳ {{ receiver.path.split('/').pop() }}</span><span v-if="data.receivers.length > 2" :title="data.receivers.map(receiver => receiver.path).join('\n')">+ {{ data.receivers.length - 2 }} receiving files</span></div>
            </div>
            <div v-if="data.cycleLabel" class="engine-subsystem__warning" role="img" :aria-label="data.cycleLabel" :title="data.cycleLabel">{{ data.cycleLabel }}</div>
          </article>
        </template>
        <template #edge-controller="edge">
          <BaseEdge :id="edge.id" :path="controllerPath(edge)" :marker-end="edge.markerEnd" :style="edge.style" :interaction-width="18" />
          <foreignObject :x="(edge.sourceX + edge.targetX) / 2" :y="(edge.sourceY + edge.targetY) / 2 - 11" width="330" height="22" class="controller-call-label">
            <div :title="`${edge.data.controllerFile}\n${edge.data.operation}\nScope: ${edge.data.connection.key?.scope || 'unspecified'}`">{{ edge.data.label }}</div>
          </foreignObject>
        </template>
        <template #node-annotation="{ data }">
          <div class="architecture-annotation" :class="[`architecture-annotation--${data.kind}`, { nopan: data.kind === 'heading' }]" :title="data.detail" :style="data.labelWidth ? { '--layer-label-width': data.labelWidth + 'px' } : undefined">
            <strong v-if="data.title">{{ data.title }}</strong><span v-if="data.detail">{{ data.detail }}</span>
          </div>
        </template>
      </VueFlow>
      <Vibe64SubsystemInspector v-if="outline?.owner.opaque" :outline="outline" @close="closeDetail" @inspect="emit('inspect-file', $event)" />
      <div v-if="!contentCount" class="ui-storyboard__empty" role="status">
        <h2>{{ error ? 'Architecture could not be loaded' : loading ? 'Loading architecture…' : 'Architecture needs evidence' }}</h2>
        <p v-if="error">{{ error }}</p>
        <p v-else-if="!loading">{{ coverage === 'complete' ? 'The configured inspector found no UI entry points.' : 'Refresh analysis to create the project index. Check Genesis subsystem declarations and Stack inspection settings if it remains empty.' }}</p>
        <v-btn v-if="error" size="small" variant="tonal" :disabled="loading" @click="reload">Retry loading</v-btn>
      </div>
      <div v-else-if="!expandedSubsystemId" class="ui-storyboard__legend">Drag empty space to pan · Zoom into a subsystem to explore · Use ⠿ to arrange <span>Entry points emphasised · Supporting directories subdued</span></div>
      <div v-if="entryWarning" class="ui-storyboard__notice" role="status">{{ entryWarning }}</div>
    </div>
  </section>
</template>

<script setup>
import { computed, markRaw, nextTick, onBeforeUnmount, ref, shallowRef, toRaw, toRef, unref, watch } from 'vue';
import { BaseEdge, Handle, MarkerType, Position, VueFlow } from '@vue-flow/core';
import { useVibe64SystemGraph } from '../composables/useVibe64SystemGraph.js';
import Vibe64SubsystemInspector from './Vibe64SubsystemInspector.vue';
import { architectureOverview, subsystemOutline } from '../architectureModel.js';

const props = defineProps({ active: { type: Boolean, default: true }, sessionId: { type: String, default: '' }, reloadVersion: { type: Number, default: 0 } });
const { architecture, error, loading, refreshing, refresh, reload, cancelRefresh } = useVibe64SystemGraph({
  active: toRef(props, 'active'), sessionId: toRef(props, 'sessionId'), reloadVersion: toRef(props, 'reloadVersion'), projection: 'architecture'
});
const emit = defineEmits(['inspect-file', 'open-source-file']);
const canvas = ref(null);
const dismissedError = ref('');
watch(error, () => { dismissedError.value = ''; });
const expandedSubsystemId = ref('');
const compact = ref(false);
const outline = shallowRef(null);
const focusOwner = computed(() => {
  const native = architecture.value?.subsystems?.find(owner => owner.id === expandedSubsystemId.value);
  return native ? { ...native, ...(overview.value.nodes.find(node => node.id === native.id)?.data || {}) } : null;
});
watch([expandedSubsystemId, architecture], async ([id], previous, onCleanup) => {
  outline.value = null;
  if (!id) return;
  let cancelled = false;
  onCleanup(() => { cancelled = true; });
  // Paint the square and its context first; prepare only this owner's detail.
  await nextTick();
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  if (!cancelled) {
    const detail = subsystemOutline(toRaw(architecture.value), id);
    outline.value = detail ? markRaw(detail) : null;
  }
}, { flush: 'sync' });
const layoutPositions = ref({});
const fileRequest = ref(null);
const retainedFileRequest = shallowRef(null);
const fileHistory = shallowRef([]);
let dragging = false;
let lastDragEnded = 0;
let zoomAnchor;
let zoomTarget;
let parentViewport;
let parentNode;
let fileParentViewport;
let transitioning = false;
let gestureTarget;
let gestureTimer;
let gestureDirection;
let zoomMotion;
let zoomFrame;
let zoomTime;
let navigationVersion = 0;
let pinchDistance;
let pinchTarget;
function finishGesture() {
  if (zoomMotion || transitioning) { gestureTimer = setTimeout(finishGesture, 80); return; }
  gestureTarget = undefined; zoomTarget = undefined; zoomAnchor = undefined;
}
function stopZoomMotion() { cancelAnimationFrame(zoomFrame); zoomFrame = undefined; zoomMotion = undefined; }
function moveCamera(viewport, { semantic = false, done } = {}) {
  zoomMotion = { viewport, semantic, done };
  if (!zoomFrame) { zoomTime = undefined; zoomFrame = requestAnimationFrame(animateZoom); }
}
function animateZoom(time) {
  if (!zoomMotion || !flow || !props.active) { stopZoomMotion(); return; }
  const motion = zoomMotion;
  const destination = motion.viewport;
  const current = flow.getViewport();
  const amount = 1 - Math.exp(-Math.min(50, time - (zoomTime || time - 16)) / 45);
  zoomTime = time;
  const next = { x: current.x + (destination.x - current.x) * amount, y: current.y + (destination.y - current.y) * amount, zoom: current.zoom + (destination.zoom - current.zoom) * amount };
  const complete = Math.abs(next.zoom - destination.zoom) < 0.001 && Math.abs(next.x - destination.x) < 0.3 && Math.abs(next.y - destination.y) < 0.3;
  void flow.setViewport(complete ? destination : next, { duration: 0 });
  // Programmatic VueFlow transforms emit no viewport-change-end event.
  if (motion.semantic) viewportChanged(complete ? destination : next);
  if (zoomMotion !== motion) return;
  if (complete) { zoomFrame = undefined; zoomMotion = undefined; motion.done?.(); }
  else zoomFrame = requestAnimationFrame(animateZoom);
}
async function readingViewport(origin) {
  const version = ++navigationVersion;
  stopZoomMotion();
  if (gestureTarget) gestureTarget.consumed = true;
  transitioning = true;
  canvas.value?.focus({ preventScroll: true });
  if (origin && flow && canvas.value) {
    const width = Math.min(960, Math.max(280, canvas.value.clientWidth - 48));
    const zoom = Math.min(1, origin.width / width);
    // Move the camera before Vue paints the new origin-based square; there
    // must not be a blank frame between hiding the circle and its skeleton.
    void flow.setViewport({ x: origin.x + origin.width / 2 - width * zoom / 2, y: origin.y + origin.height / 2 - 160 * zoom, zoom }, { duration: 0 });
  }
  await nextTick();
  await new Promise(requestAnimationFrame);
  if (version !== navigationVersion || !flow || !canvas.value) return;
  const node = unref(flow?.getNodes)?.find(node => node.type === 'subsystem-detail');
  const width = node?.dimensions.width || Math.min(960, Math.max(280, canvas.value.clientWidth - 48));
  const height = Math.min(node?.dimensions.height || canvas.value.clientHeight - 48, canvas.value.clientHeight - 48);
  // Detail can grow after the skeleton paints. A stable top inset keeps its
  // first signatures readable without shifting again when analysis arrives.
  const destination = { x: (canvas.value.clientWidth - width) / 2, y: 24, zoom: 1 };
  if (origin) {
    const zoom = Math.min(1, origin.width / width);
    await flow.setViewport({ x: origin.x + origin.width / 2 - width * zoom / 2, y: origin.y + origin.height / 2 - height * zoom / 2, zoom }, { duration: 0 });
  }
  moveCamera(destination, { done: () => { transitioning = false; } });
}
async function closeDetail(event) {
  const external = outline.value?.owner.opaque;
  const currentViewport = flow?.getViewport();
  const detailWidth = unref(flow?.getNodes)?.find(node => node.type === 'subsystem-detail')?.dimensions.width || Math.min(960, Math.max(280, canvas.value.clientWidth - 48));
  const detailHeight = unref(flow?.getNodes)?.find(node => node.type === 'subsystem-detail')?.dimensions.height || canvas.value.clientHeight;
  const outAnchor = zoomAnchor || { x: canvas.value.clientWidth / 2, y: canvas.value.clientHeight / 2 };
  stopZoomMotion();
  ++navigationVersion;
  if (event?.type === 'click' || event?.type === 'keydown') gestureTarget = undefined;
  else if (gestureTarget) gestureTarget.consumed = true;
  transitioning = true;
  expandedSubsystemId.value = '';
  fileRequest.value = null;
  retainedFileRequest.value = null;
  fileHistory.value = [];
  zoomTarget = undefined;
  await nextTick();
  if (!external && parentViewport && parentNode && currentViewport) {
    const zoom = Math.min(3, detailWidth * currentViewport.zoom / parseFloat(parentNode.style.width));
    // Match the parent's screen centre/size before the camera moves outward.
    // The diagram data stays cached; no analysis is rebuilt during this motion.
    const centreX = currentViewport.x + detailWidth * currentViewport.zoom / 2;
    const centreY = currentViewport.y + Math.min(detailHeight, canvas.value.clientHeight) * currentViewport.zoom / 2;
    const matched = { zoom, x: centreX - (parentNode.position.x + parseFloat(parentNode.style.width) / 2) * zoom,
      y: centreY - (parentNode.position.y + parseFloat(parentNode.style.height) / 2) * zoom };
    await flow?.setViewport(matched, { duration: 0 });
    const destination = { zoom: parentViewport.zoom, x: outAnchor.x - (outAnchor.x - matched.x) / zoom * parentViewport.zoom,
      y: outAnchor.y - (outAnchor.y - matched.y) / zoom * parentViewport.zoom };
    moveCamera(destination, { done: () => { transitioning = false; } });
    return;
  }
  transitioning = false;
}
async function openFile(request) {
  if (fileRequest.value?.path === request.path && !request.symbolId && !request.symbol && !request.presentation) return;
  if (fileRequest.value) fileHistory.value = [...fileHistory.value, {
    request: { ...fileRequest.value }, ownerId: expandedSubsystemId.value,
    parentNode, parentViewport, fileParentViewport, viewport: { ...flow.getViewport() }
  }];
  const file = architecture.value?.files?.find(file => file.path === request.path);
  const ownerNode = nodes.value.find(node => node.id === file?.subsystemId);
  if (ownerNode && file.subsystemId !== expandedSubsystemId.value) {
    parentNode = { position: { ...ownerNode.position }, style: { ...ownerNode.style } };
    expandedSubsystemId.value = file.subsystemId;
  }
  // Return to the enclosing reading view, before its icon grew to entry size.
  fileParentViewport = gestureDirection === true && zoomTarget?.kind === 'file' ? gestureTarget.viewport
    : { ...(zoomMotion && !zoomMotion.semantic ? zoomMotion.viewport : flow.getViewport()) };
  fileRequest.value = { path: request.path, symbolId: request.symbolId, symbol: request.symbol, line: request.line, presentation: request.presentation || 'interface', symbolPresentation: request.symbolPresentation };
  retainedFileRequest.value = fileRequest.value;
  zoomTarget = undefined;
  await readingViewport();
}
function updateFileLocation(location) {
  if (!fileRequest.value || location.path !== fileRequest.value.path) return;
  if (['symbolId', 'presentation', 'symbolPresentation'].every(key => fileRequest.value[key] === location[key])) return;
  fileRequest.value = { ...fileRequest.value, ...location };
  retainedFileRequest.value = fileRequest.value;
}
async function goBack(event) {
  const previous = fileHistory.value.at(-1);
  if (!fileRequest.value || !previous) return fileRequest.value ? closeFile() : closeDetail(event);
  ++navigationVersion;
  stopZoomMotion();
  gestureTarget = undefined;
  transitioning = false;
  fileHistory.value = fileHistory.value.slice(0, -1);
  expandedSubsystemId.value = previous.ownerId;
  parentNode = previous.parentNode;
  parentViewport = previous.parentViewport;
  fileParentViewport = previous.fileParentViewport;
  fileRequest.value = previous.request;
  retainedFileRequest.value = previous.request;
  await nextTick();
  await flow.setViewport(previous.viewport, { duration: 0 });
}
async function closeFile() {
  ++navigationVersion;
  stopZoomMotion();
  if (gestureTarget) gestureTarget.consumed = true;
  transitioning = true;
  canvas.value?.focus({ preventScroll: true });
  fileRequest.value = null;
  fileHistory.value = [];
  await nextTick();
  moveCamera(fileParentViewport || { x: 24, y: 24, zoom: 1 }, { done: () => { transitioning = false; } });
}
const coverage = computed(() => architecture.value?.ui?.capabilities?.pages);
const nodes = shallowRef([]);
const edges = shallowRef([]);
const showCalls = ref(false);
const selectedPageId = ref('');
const visibleEdges = computed(() => (focusOwner.value && !focusOwner.value.opaque ? [] : edges.value).filter(edge => edge.type !== 'controller' || showCalls.value || edge.source === selectedPageId.value).map(edge =>
  expandedSubsystemId.value && edge.type !== 'controller' ? { ...edge, style: { ...edge.style, opacity: edge.source === expandedSubsystemId.value || edge.target === expandedSubsystemId.value ? 0.4 : 0.05 } } : edge));
function toggleCalls() { showCalls.value = !showCalls.value; selectedPageId.value = ''; }
function selectNode({ node, event }) {
  if (node.type === 'page') { selectedPageId.value = node.id; showCalls.value = false; }
  else if (node.type === 'subsystem' && !node.data.opaque && !dragging && Date.now() - lastDragEnded > 250 && !event?.target?.closest('.engine-subsystem__grip')) {
    gestureTarget = undefined;
    enterSubsystem(node, flow.getViewport());
  }
}
function clearSelection() { selectedPageId.value = ''; }
function rearrangeSubsystem({ node }) {
  dragging = false;
  lastDragEnded = Date.now();
  if (!node.data.arrangeable) return;
  layoutPositions.value = { ...layoutPositions.value, [node.id]: { ...node.position } };
}
function moveSubsystem(id, direction) {
  const node = nodes.value.find(entry => entry.id === id);
  if (!node) return;
  rearrangeSubsystem({ node: { ...node, position: { ...node.position, x: node.position.x + direction * 32 } } });
}
function captureZoomAnchor(event) {
  const rect = canvas.value.getBoundingClientRect();
  zoomAnchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const element = event.target?.closest?.('[data-zoom-kind]');
  zoomTarget = element ? { kind: element.dataset.zoomKind, path: element.dataset.filePath, element } : undefined;
}
function zoomGesture(event, factor, inward) {
  const current = flow.getViewport();
  if (!gestureTarget || gestureDirection !== inward) {
    captureZoomAnchor(event);
    const hovered = event.target.closest('.vue-flow__node');
    const node = nodes.value.find(node => node.id === hovered?.dataset.id);
    const element = inward ? zoomTarget?.element : undefined;
    const rect = element?.getBoundingClientRect();
    const canvasRect = canvas.value.getBoundingClientRect();
    const centred = inward && (element || node && node.type !== 'subsystem-detail' && node.type !== 'annotation');
    const point = rect ? { x: (rect.x - canvasRect.x + rect.width / 2 - current.x) / current.zoom, y: (rect.y - canvasRect.y + rect.height / 2 - current.y) / current.zoom }
      : centred ? { x: node.position.x + parseFloat(node.style.width) / 2, y: node.position.y + parseFloat(node.style.height) / 2 }
        : { x: (zoomAnchor.x - current.x) / current.zoom, y: (zoomAnchor.y - current.y) / current.zoom };
    gestureTarget = { point, anchor: centred ? { x: canvas.value.clientWidth / 2, y: canvas.value.clientHeight / 2 } : { ...zoomAnchor }, detail: zoomTarget, nodeId: node?.id, viewport: { ...current } };
    gestureDirection = inward;
  }
  clearTimeout(gestureTimer);
  gestureTimer = setTimeout(finishGesture, 220);
  if (gestureTarget.consumed) return;
  // A reversed gesture interrupts camera navigation without awaiting a D3
  // transition promise that may never resolve after interruption.
  if (transitioning) { ++navigationVersion; transitioning = false; stopZoomMotion(); }
  const zoom = Math.max(0.08, Math.min(3, (zoomMotion?.viewport.zoom || current.zoom) * factor));
  zoomTarget = gestureTarget.detail;
  zoomAnchor = gestureTarget.anchor;
  moveCamera({ zoom, x: zoomAnchor.x - gestureTarget.point.x * zoom, y: zoomAnchor.y - gestureTarget.point.y * zoom }, { semantic: true });
}
function zoomWheel(event) {
  if (!flow || !props.active || focusOwner.value?.opaque || !event.deltaY) return;
  // Ordinary wheel/touchpad scrolling belongs to the expanded square, even
  // at its scroll boundary. Zoom only outside it or with an explicit pinch.
  if (!event.ctrlKey && event.target.closest('.subsystem-zoom')) return;
  event.preventDefault();
  event.stopPropagation();
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.value.clientHeight : 1);
  zoomGesture(event, 2 ** (-Math.max(-300, Math.min(300, delta)) * (event.ctrlKey ? 0.006 : 0.003)), delta < 0);
}
function startPinch(event) {
  if (event.touches.length !== 2 || !flow || focusOwner.value?.opaque) return;
  event.preventDefault(); event.stopPropagation();
  pinchDistance = Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
  pinchTarget = event.target;
  gestureTarget = undefined;
}
function movePinch(event) {
  if (event.touches.length !== 2 || !pinchDistance || !props.active) return;
  event.preventDefault(); event.stopPropagation();
  const distance = Math.hypot(event.touches[0].clientX - event.touches[1].clientX, event.touches[0].clientY - event.touches[1].clientY);
  if (!distance || distance === pinchDistance) return;
  const factor = distance / pinchDistance;
  zoomGesture({ target: pinchTarget, clientX: (event.touches[0].clientX + event.touches[1].clientX) / 2, clientY: (event.touches[0].clientY + event.touches[1].clientY) / 2 }, factor, factor > 1);
  clearTimeout(gestureTimer);
  pinchDistance = distance;
}
function endPinch(event) { if (event.touches.length < 2) { pinchDistance = undefined; pinchTarget = undefined; gestureTimer = setTimeout(finishGesture, 220); } }
function zoomControl(inward) {
  if (!flow || !canvas.value) return;
  gestureTarget = undefined;
  const rect = canvas.value.getBoundingClientRect();
  zoomGesture({ target: canvas.value, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }, inward ? 1.4 : 1 / 1.4, inward);
}
function enterSubsystem(node, viewport) {
  if (expandedSubsystemId.value || !canvas.value) return;
  parentNode = { position: { ...node.position }, style: { ...node.style } };
  parentViewport = gestureTarget ? { ...gestureTarget.viewport } : { ...viewport };
  expandedSubsystemId.value = node.id;
  void readingViewport({ x: node.position.x * viewport.zoom + viewport.x, y: node.position.y * viewport.zoom + viewport.y,
    width: parseFloat(node.style.width) * viewport.zoom, height: parseFloat(node.style.height) * viewport.zoom });
}
function viewportChanged(viewport) {
  if (!props.active || !canvas.value || !contentCount.value || dragging || transitioning) return;
  if (focusOwner.value?.opaque) { zoomAnchor = undefined; return; }
  const rect = canvas.value.getBoundingClientRect();
  if (outline.value && !outline.value.owner.opaque) {
    if (viewport.zoom < 0.7) {
      if (fileRequest.value) void closeFile();
      else void closeDetail();
    }
    return;
  }
  const centerX = ((zoomAnchor?.x ?? rect.width / 2) - viewport.x) / viewport.zoom;
  const centerY = ((zoomAnchor?.y ?? rect.height / 2) - viewport.y) / viewport.zoom;
  const candidate = gestureDirection === true && nodes.value.find(node => node.type === 'subsystem' && node.id === gestureTarget?.nodeId && !node.data.opaque
    && parseFloat(node.style.width) * viewport.zoom >= Math.min(560, rect.width * 0.8)
    && centerX >= node.position.x && centerX <= node.position.x + parseFloat(node.style.width)
    && centerY >= node.position.y && centerY <= node.position.y + parseFloat(node.style.height));
  if (candidate) {
    enterSubsystem(candidate, viewport);
  }
}

const uiIds = ref([]);
const engineIds = ref([]);
const externalCount = ref(0);
const initialIds = ref([]);
const contentCount = computed(() => uiIds.value.length + engineIds.value.length);
const entryWarning = computed(() => architecture.value?.layoutDiagnostic || architecture.value?.entryPointDiagnostic || ((architecture.value?.layout?.groups || []).flatMap(group => group.subsystems).some(member => !(architecture.value?.subsystems || []).some(owner => !owner.opaque && owner.root === member.root)) ? 'Some declared architecture roots are not indexed. Refresh analysis or correct their Stack paths.' : (architecture.value?.entryPoints || []).some(entry => entry.resolution !== 'resolved') ? 'Some declared entry files are not indexed. Refresh analysis or correct their Stack paths.' : ''));
const ports = [
  ['top-in', 'target', Position.Top], ['bottom-out', 'source', Position.Bottom],
  ['top-out', 'source', Position.Top], ['bottom-in', 'target', Position.Bottom],
  ['left-in', 'target', Position.Left], ['left-out', 'source', Position.Left],
  ['right-in', 'target', Position.Right], ['right-out', 'source', Position.Right]
].map(([id, type, position]) => ({ id, type, position }));
function controllerPath(edge) {
  const { sourceX, sourceY, targetX, targetY } = edge;
  return `M ${sourceX},${sourceY} L ${targetX},${targetY}`;
}
let flow;
let fitPending = true;
async function fit(ids) {
  if (!flow || !props.active || !contentCount.value) return;
  stopZoomMotion();
  ++navigationVersion;
  gestureTarget = undefined;
  transitioning = true;
  if (focusOwner.value && !focusOwner.value.opaque) {
    expandedSubsystemId.value = ''; fileRequest.value = null; retainedFileRequest.value = null; fileHistory.value = [];
    ids = undefined;
  }
  await nextTick();
  const measured = unref(flow.getNodes);
  if (measured.length !== nodes.value.length || measured.some(node => !node.dimensions.width || !node.dimensions.height)) { transitioning = false; return; }
  await flow.fitView({ nodes: Array.isArray(ids) ? ids : undefined, padding: 0.12, maxZoom: 1, duration: 0 });
  transitioning = false;
  fitPending = false;
}
function initialize(instance) { flow = instance; void fit(initialIds.value); }
function fitIfPending() { if (fitPending) void fit(initialIds.value); }
// Index snapshots are immutable. Traversing reactive proxies for every symbol
// adds work without making the displayed facts any more current.
const overview = computed(() => architectureOverview(toRaw(architecture.value)));
watch([overview, expandedSubsystemId, layoutPositions], ([diagram, expanded, positions], previous) => {
  if (architecture.value && expanded && !focusOwner.value) expandedSubsystemId.value = '';
  const arranged = diagram.nodes.map(node => ({ ...node, class: node.class || '', position: { ...node.position } }));
  for (const node of arranged) if (node.data.arrangeable && positions[node.id]) {
    const [minimum, maximum] = node.extent;
    node.position = { x: Math.max(minimum[0], Math.min(maximum[0] - parseFloat(node.style.width), positions[node.id].x)),
      y: Math.max(minimum[1], Math.min(maximum[1] - parseFloat(node.style.height), positions[node.id].y)) };
  }
  if (!(architecture.value?.ui?.pages || []).some(page => page.id === selectedPageId.value)) selectedPageId.value = '';
  const focused = focusOwner.value && !focusOwner.value.opaque;
  // Keep map node IDs/types mounted. Hiding the wrappers preserves their DOM
  // and VueFlow geometry, rather than reconstructing the map on zoom-out.
  nodes.value = focused ? [...arranged.map(node => ({ ...node, class: 'architecture-map-node--hidden' })),
    { id: 'visual:subsystem-detail', type: 'subsystem-detail', position: { x: 0, y: 0 }, draggable: false,
      style: { width: 'clamp(280px, calc(100cqw - 48px), 960px)' }, data: { outline: outline.value, owner: focusOwner.value } }] : arranged;
  edges.value = diagram.edges;
  uiIds.value = diagram.uiIds;
  engineIds.value = diagram.engineIds;
  externalCount.value = diagram.externalCount;
  initialIds.value = diagram.initialIds;
  if (!previous || diagram !== previous[0]) {
    fitPending = true;
    void fit(initialIds.value);
  }
}, { immediate: true });
watch(outline, detail => {
  // Detail arriving must not rebuild the retained map during its animation.
  flow?.updateNodeData('visual:subsystem-detail', { outline: detail });
});
watch(() => props.sessionId, () => { ++navigationVersion; stopZoomMotion(); clearTimeout(gestureTimer); gestureTarget = undefined; transitioning = false; expandedSubsystemId.value = ''; fileRequest.value = null; retainedFileRequest.value = null; fileHistory.value = []; selectedPageId.value = ''; showCalls.value = false; layoutPositions.value = {}; zoomAnchor = undefined; zoomTarget = undefined; parentViewport = undefined; fileParentViewport = undefined; });
watch(() => props.active, active => { if (!active) { ++navigationVersion; stopZoomMotion(); clearTimeout(gestureTimer); gestureTarget = undefined; transitioning = false; } else if (fitPending) void fit(initialIds.value); });
onBeforeUnmount(() => { stopZoomMotion(); clearTimeout(gestureTimer); });
</script>

<style>
@import '@vue-flow/core/dist/style.css';
@import '@vue-flow/core/dist/theme-default.css';
</style>
<style scoped>
.ui-storyboard { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; overflow: hidden; color: rgb(var(--v-theme-on-surface)); }
.ui-storyboard *, .ui-storyboard *::before, .ui-storyboard *::after { box-sizing: border-box; }
.ui-storyboard__toolbar { display: flex; align-items: center; gap: 12px; padding: 4px 12px; flex-wrap: wrap; border-bottom: 1px solid rgba(110, 130, 150, .18); }
.ui-storyboard__heading { display: flex; align-items: baseline; flex: 1; min-width: 0; gap: 4px 12px; flex-wrap: wrap; }
.ui-storyboard__heading h1 { margin: 0; font-size: 18px; font-weight: 650; line-height: 26px; }
.ui-storyboard__heading p { margin: 0; font-size: 11px; line-height: 16px; opacity: .65; }
.ui-storyboard__actions { display: flex; align-items: center; gap: 4px; }
.ui-storyboard__canvas { --diagram-label-scale: 2.5; container-type: size; position: relative; flex: 1; min-height: 0; outline: none; overflow: hidden; background-color: #f6f8fb; background-image: radial-gradient(#ced7e2 .8px, transparent .8px); background-size: 22px 22px; }
.ui-storyboard__canvas :deep(.vue-flow) { height: 100%; }
.ui-storyboard__canvas :deep(.vue-flow__edge-path) { vector-effect: non-scaling-stroke; }
.ui-storyboard__canvas :deep(.architecture-map-node--hidden) { visibility: hidden !important; pointer-events: none !important; }
.subsystem-zoom__context { position: relative; }
.subsystem-zoom__context::before { content: ''; position: absolute; z-index: -1; width: calc(100% + 140px); aspect-ratio: 1; left: 50%; top: 50%; transform: translate(-50%, -50%); border-radius: 50%; border: 2px solid #75a99b36; background: #e8f1ed29; box-shadow: 0 0 0 16px #7cac9e0c; pointer-events: none; }
.subsystem-zoom__loading { padding: 12px 18px; min-height: 260px; }
.subsystem-zoom__loading h2 { font-size: 22px; margin-bottom: 4px; }
.subsystem-zoom__loading p { color: #698a80; font-size: 12px; margin-bottom: 12px; }
.subsystem-zoom__skeleton { height: 30px; margin: 6px 0; border-radius: 5px; background: linear-gradient(90deg, #edf3f0 20%, #f7faf8 45%, #edf3f0 70%); background-size: 200% 100%; animation: subsystem-loading 1.3s linear infinite; }
@keyframes subsystem-loading { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .subsystem-zoom__skeleton { animation: none; } }
.subsystem-zoom { display: flex; flex-direction: column; max-height: calc(100cqh - 48px); background: #fff; border: 1px solid #82b5a9; border-radius: 14px; color: #304b50; overflow: hidden; box-shadow: 0 10px 36px #30465d12; }
.subsystem-zoom__body { min-height: 0; overflow: auto; overscroll-behavior: contain; }
.subsystem-zoom__breadcrumbs { position: relative; display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 48px; padding: 10px 56px 10px 18px; background: #edf5f2; border-bottom: 1px solid #d5e6df; font-size: 12px; }
.subsystem-zoom__breadcrumbs button { color: #367e70; cursor: pointer; border-radius: 4px; padding: 5px 3px; }
.subsystem-zoom__breadcrumbs button:hover { background: #dcece6; }
.subsystem-zoom__breadcrumbs button:focus-visible { outline: 2px solid #377dcb; }
.subsystem-zoom__breadcrumbs .subsystem-zoom__back { min-height: 44px; padding: 5px 8px; }
.subsystem-zoom__breadcrumbs .subsystem-zoom__close { position: absolute; top: 2px; right: 4px; width: 44px; height: 44px; padding: 0; font-size: 24px; }
.subsystem-zoom__navigation-hint { flex: none; margin: 0; padding: 3px 18px; font-size: 11px; line-height: 16px; color: #69817d; border-bottom: 1px solid #edf2f0; }
.subsystem-zoom__file { height: min(720px, 75vh); min-height: 0; overflow: hidden; }
.subsystem-zoom__file :deep(.vibe64-source-editor) { height: 100%; }
.storyboard-page { width: 100%; height: 100%; padding: 18px 20px; border: 1px solid #ccd6e2; border-radius: 12px; background: #fff; color: #213549; box-shadow: 0 3px 12px #30465d0b; }
.storyboard-page--root { border-top: 4px solid #4582c1; padding-top: 15px; }
.storyboard-page--selected { border-color: #377dcb; box-shadow: 0 0 0 3px #377dcb22; }
.storyboard-page__meta { display: flex; justify-content: space-between; gap: 12px; font-size: 10px; letter-spacing: .04em; color: #6e8195; text-transform: uppercase; }
.storyboard-page h2 { margin: 10px 0 6px; font-size: 19px; font-weight: 650; line-height: 26px; overflow-wrap: anywhere; }
.storyboard-page__routes { display: flex; flex-direction: column; font-family: ui-monospace, monospace; font-size: 12px; line-height: 20px; color: #4b6985; overflow-wrap: anywhere; }
.storyboard-page__unregistered { margin: 0; font-size: 11px; color: #7a8b9b; }
.storyboard-page :deep(.vue-flow__handle) { width: 6px; height: 6px; border: 0; background: #93a7ba; pointer-events: none; }
.ui-storyboard__legend { position: absolute; bottom: 16px; left: 20px; right: 20px; display: flex; justify-content: space-between; gap: 12px; pointer-events: none; font-size: 11px; color: #6d8094; }
.ui-storyboard__error { position: absolute; z-index: 12; top: 12px; left: 12px; max-width: min(520px, calc(100% - 24px)); flex: none; font-size: 12px; }
.ui-storyboard__empty { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 8px; text-align: center; padding: 24px; pointer-events: none; }
.ui-storyboard__empty button { pointer-events: auto; }
.ui-storyboard__empty h2 { margin: 0 0 8px; font-size: 20px; }
.ui-storyboard__empty p { max-width: 420px; margin: 0; font-size: 14px; }
.engine-subsystem { position: relative; display: flex; align-items: center; justify-content: center; text-align: center; width: 100%; height: 100%; background: #fff; color: #213c40; border: 1px solid #bfcfce; border-radius: 50%; box-shadow: 0 3px 12px #30465d0b; }
.engine-subsystem__content { width: 72%; min-width: 0; }
.engine-subsystem--entry { border-color: #4b9386; border-width: 2px; }
.engine-subsystem__start { color: #34796e; font-size: 12px; font-weight: 650; margin-bottom: 6px; }
.engine-subsystem--support { background: #f0f2f5; border-style: dashed; color: #64717e; box-shadow: none; }
.engine-subsystem--support .engine-subsystem__directory { color: #64717e; }
.engine-subsystem--cycle { border-color: #c69a6f; background: #fffdf9; }
.external-dependencies { width: 100%; height: 100%; border: 1px solid #afbfce; border-radius: 10px; background: #f0f4f9; color: #304b64; overflow: hidden; }
.external-dependencies header { height: 98px; padding: 18px 20px; border-bottom: 1px solid #d5dfe9; }
.external-dependencies h2 { margin: 0; font-size: 22px; line-height: 28px; font-weight: 650; }
.external-dependencies header p { margin: 8px 0 0; font-size: 13px; line-height: 20px; color: #6b8196; }
.external-dependencies ul { list-style: none; padding: 4px 12px 8px; margin: 0; }
.external-dependencies button { display: block; width: 100%; padding: 7px 12px; border: 0; border-bottom: 1px solid #dde5ed; border-radius: 4px; text-align: left; font: 15px/22px ui-monospace, monospace; overflow-wrap: anywhere; color: inherit; cursor: pointer; }
.external-dependencies button:hover { background: #dfe9f3; color: #245e90; }
.external-dependencies button:focus-visible { outline: 2px solid #377dcb; outline-offset: -2px; }
.engine-subsystem--overview { position: relative; display: flex; flex-direction: column; justify-content: center; padding: 12px 16px; border-radius: 7px; box-shadow: none; }
.engine-subsystem--overview h2 { margin: 0; font-size: 17px; line-height: 20px; }
.engine-subsystem--overview .engine-subsystem__meta,
.engine-subsystem--overview .engine-subsystem__directory,
.engine-subsystem--overview .engine-subsystem__description,
.engine-subsystem--overview .engine-subsystem__size,
.engine-subsystem--overview .engine-subsystem__receivers { display: none; }
.engine-subsystem--overview .engine-subsystem__warning { position: absolute; top: 6px; right: 22px; margin: 0; width: 6px; height: 6px; border-radius: 50%; background: #ba8459; font-size: 0; }
.engine-subsystem__volume { position: absolute; bottom: 0; left: 0; height: 3px; max-width: 100%; background: #6f9b91; border-radius: 0 0 3px 3px; }
.engine-subsystem--overview .engine-subsystem__grip { font-size: 14px; top: 2px; right: 2px; padding: 0 3px; }
.engine-subsystem--selected { box-shadow: 0 0 0 3px #4b938633; border-color: #4b9386; }
.engine-subsystem__meta { display: flex; justify-content: center; gap: 8px; color: #6b8987; text-transform: uppercase; letter-spacing: .04em; font-size: 10px; }
.engine-subsystem h2 { margin: 8px 0 5px; font-size: 18px; line-height: 24px; font-weight: 650; overflow-wrap: anywhere; }
.engine-subsystem__directory { font-family: ui-monospace, monospace; font-size: 11px; line-height: 17px; color: #4d7772; overflow-wrap: anywhere; }
.engine-subsystem__description { margin: 10px 0 8px; font-size: 12px; line-height: 18px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.engine-subsystem__size { font-size: 11px; line-height: 17px; color: #708583; }
.storyboard-page__unresolved { font-size: 10px; color: #94602f; }
.engine-subsystem__receivers { display: flex; flex-direction: column; margin-top: 5px; font-family: ui-monospace, monospace; font-size: 10px; color: #7954b3; }
.controller-call-label { overflow: visible; }
.controller-call-label div { width: max-content; max-width: 330px; padding: 2px 5px; border-radius: 4px; background: #f6f0ff; color: #68469e; font: 10px/18px ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.engine-subsystem__warning { margin-top: 6px; color: #94602f; font-size: 10px; }
.engine-subsystem :deep(.vue-flow__handle) { width: 5px; height: 5px; background: #7895a4; border: 0; pointer-events: none; opacity: 0; }
.architecture-annotation { height: 100%; width: 100%; pointer-events: none; color: #6f8392; }
.architecture-annotation--heading { pointer-events: auto; user-select: none; cursor: default; display: flex; align-items: baseline; gap: 14px; padding: 4px 0; }
.architecture-annotation--heading strong { font-size: 22px; color: #29475a; font-weight: 650; }
.architecture-annotation--heading span { font-size: 13px; }
.architecture-annotation--layer { background: #eaf0f4; border-radius: 8px; border-bottom: 1px solid #d6e1e5; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 4px; padding: 8px 12px; }
.architecture-annotation--layer strong { width: calc(var(--layer-label-width) - 24px); font-size: 14px; line-height: 18px; color: #526d77; overflow-wrap: anywhere; }
.architecture-annotation--layer span { width: calc(var(--layer-label-width) - 24px); font-size: 10px; line-height: 14px; }
.architecture-annotation--divider { background: #c2d0dc; }
.ui-storyboard__notice { position: absolute; top: 12px; left: 12px; max-width: 460px; padding: 8px 12px; background: #fff7e9; color: #875829; font-size: 12px; border-radius: 6px; }
.engine-subsystem__grip { position: absolute; top: 14%; right: 14%; padding: 2px 5px; font-size: 18px; line-height: 22px; color: #87a09b; cursor: grab; border-radius: 4px; touch-action: none; }
.engine-subsystem__grip:hover { color: #336d60; background: #e9f3ee; }
.engine-subsystem__grip:active { cursor: grabbing; }
.engine-subsystem__grip:focus-visible { outline: 2px solid #377dcb; }
.engine-subsystem--compact h2 { font-size: calc(14px * var(--diagram-label-scale)); line-height: 1.15; margin: 0 0 8px; }
.engine-subsystem--compact .engine-subsystem__directory { font-size: calc(8px * var(--diagram-label-scale)); line-height: 1.25; }
.engine-subsystem--compact .engine-subsystem__start { font-size: calc(9px * var(--diagram-label-scale)); }
.engine-subsystem--compact .engine-subsystem__meta,
.engine-subsystem--compact .engine-subsystem__description, .engine-subsystem--compact .engine-subsystem__receivers,
.engine-subsystem--compact .engine-subsystem__warning { display: none; }
.engine-subsystem--compact .engine-subsystem__size { font-size: calc(9px * var(--diagram-label-scale)); line-height: 1.3; }
.engine-subsystem--compact .engine-subsystem__grip { font-size: calc(12px * var(--diagram-label-scale)); }
.engine-subsystem--overview.engine-subsystem--compact h2 { font-size: 17px; line-height: 20px; max-height: none; overflow: visible; margin: 0; }
.engine-subsystem--overview.engine-subsystem--compact { padding: 12px 16px; }
.engine-subsystem--overview.engine-subsystem--compact .engine-subsystem__grip { font-size: 14px; }
.engine-subsystem--declared .engine-subsystem__directory { display: block; margin-top: 5px; }
.engine-subsystem__api { margin-top: 7px; color: #557c75; font-size: 11px; line-height: 17px; }
.engine-subsystem--library { border-color: #7b70aa; background: #fdfcff; }
.engine-subsystem--library .engine-subsystem__description { display: -webkit-box; margin: 7px 0 0; -webkit-line-clamp: 2; }
.architecture-annotation--libraries { padding: 8px 4px; }
.architecture-annotation--libraries strong { display: block; font-size: 22px; color: #60528a; }
.architecture-annotation--libraries span { display: block; font-size: 12px; margin-top: 5px; }
.architecture-annotation--support { background: #eef0f4; border: 1px dashed #cbd1da; border-radius: 7px; padding: 12px; }
.architecture-annotation--support strong, .architecture-annotation--support span { display: block; width: calc(var(--layer-label-width) - 24px); }
.architecture-annotation--support strong { font-size: 16px; color: #657282; }
.architecture-annotation--support span { font-size: 11px; line-height: 17px; margin-top: 6px; }
.engine-subsystem h2, .engine-subsystem__directory, .engine-subsystem__description, .engine-subsystem__api { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.engine-subsystem__api { -webkit-line-clamp: 1; }
.engine-subsystem--compact .engine-subsystem__size, .engine-subsystem--compact .engine-subsystem__api { display: none; }
.storyboard-page--compact { display: flex; flex-direction: column; justify-content: center; padding: 12px; }
.storyboard-page--compact h2 { font-size: 19px; line-height: 26px; margin: 0 0 6px; overflow-wrap: anywhere; }
.storyboard-page--compact .storyboard-page__meta, .storyboard-page--compact .storyboard-page__unregistered { display: none; }
.storyboard-page--compact .storyboard-page__routes { font-size: 12px; line-height: 20px; overflow-wrap: anywhere; }
@media (max-width: 600px) { .ui-storyboard__toolbar { gap: 4px 6px; padding: 4px 8px; } .ui-storyboard__heading { display: contents; } .ui-storyboard__heading p { order: 1; flex-basis: 100%; } .ui-storyboard__actions { margin-left: auto; } .ui-storyboard__legend { left: 12px; bottom: 10px; } .ui-storyboard__legend span { display: none; } }
</style>
