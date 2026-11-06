<template>
  <section class="ui-storyboard" aria-label="UI and Engine architecture">
    <header class="ui-storyboard__toolbar">
      <div class="ui-storyboard__heading">
        <h2>Architecture</h2>
        <p v-if="refreshProgress" role="status">{{ refreshProgress.message }} · {{ refreshProgress.elapsedSeconds }}s</p>
        <p v-else-if="usageState.view === 'map'">{{ uiIds.length }} pages / screens / scenes · {{ engineIds.length - (externalCount ? 1 : 0) }} subsystems<span v-if="externalCount"> · {{ externalCount }} external packages</span> <span v-if="coverage && coverage !== 'complete'">· {{ coverage }} page discovery</span><span v-if="architecture?.ui?.capabilities?.operationUses === 'unconfigured'" title="This project has no UI-call discovery configured. Missing arrows do not prove there are no calls."> · UI calls not analysed</span></p>
      </div>
      <v-btn-toggle :model-value="usageState.view" class="ui-storyboard__views" mandatory divided rounded="pill" color="primary" variant="outlined" density="compact" role="group" aria-label="Architecture view" @update:model-value="setArchitectureView">
        <v-btn value="map">Map</v-btn>
        <v-btn value="usage">Usage</v-btn>
      </v-btn-toggle>
      <div class="ui-storyboard__actions">
        <v-btn v-if="refreshing" size="small" variant="text" min-height="44" @click="cancelRefresh">Cancel analysis</v-btn>
        <v-btn v-if="usageState.view === 'map'" size="small" variant="text" :disabled="!contentCount" @click="fit()">Fit</v-btn>
        <v-menu>
          <template #activator="{ props: menuProps }"><v-btn v-bind="menuProps" size="small" variant="text" aria-label="Architecture options" title="Architecture options" min-width="36">⋯</v-btn></template>
          <v-list density="compact">
            <template v-if="usageState.view === 'map'">
              <v-list-item title="Fit UI" :disabled="!uiIds.length" @click="fit(uiIds)" />
              <v-list-item title="Fit Engine" :disabled="!engineIds.length" @click="fit(engineIds)" />
              <v-list-item :title="showCalls ? 'Hide UI calls' : 'Show all UI calls'" :disabled="!edges.some(edge => edge.type === 'controller')" @click="toggleCalls" />
              <v-list-item title="Zoom in" :disabled="!contentCount" @click="zoomControl(true)" />
              <v-list-item title="Zoom out" :disabled="!contentCount" @click="zoomControl(false)" />
              <v-list-item title="Reset arrangement" :disabled="!Object.keys(layoutPositions).length" @click="layoutPositions = {}" />
              <v-divider />
            </template>
            <v-list-item title="Reload architecture" :disabled="loading" @click="reload" />
            <v-list-item v-if="refreshing" title="Cancel analysis" @click="cancelRefresh" />
            <v-list-item v-else title="Re-scan project" :disabled="loading" @click="refresh" />
          </v-list>
        </v-menu>
      </div>
    </header>
    <div v-show="usageState.view === 'map'" ref="canvas" class="ui-storyboard__canvas" tabindex="-1" @keydown.esc.capture="expandedSubsystemId && ($event.preventDefault(), $event.stopPropagation(), previousView($event))" @wheel.capture="zoomWheel" @touchstart.capture="startPinch" @touchmove.capture="movePinch" @touchend.capture="endPinch" @touchcancel.capture="endPinch">
      <v-alert v-if="error && error !== dismissedError" class="ui-storyboard__error" type="error" variant="tonal" closable @click:close="dismissedError = error">{{ error }}<details v-if="refreshOutput"><summary>Command output</summary><pre style="white-space: pre-wrap; overflow-wrap: anywhere">{{ refreshOutput }}</pre></details></v-alert>
      <v-alert v-if="!refreshing && architecture?.diagnostics?.some(item => item.code === 'ARCHITECTURE_UI_STALE')" class="ui-storyboard__error" type="info" variant="tonal">UI map needs refresh. <v-btn size="small" variant="text" :loading="refreshing" @click="refresh">Re-scan project</v-btn></v-alert>
      <VueFlow
        v-model:nodes="nodes" :edges="visibleEdges" :min-zoom="0.08" :max-zoom="3"
        :zoom-on-double-click="false" :zoom-on-scroll="false" :zoom-on-pinch="false" :nodes-draggable="false" :nodes-connectable="false" :edges-updatable="false" :elevate-nodes-on-select="false"
        :default-edge-options="{ markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#7895a4' } }"
        @init="initialize" @nodes-initialized="fitIfPending" @node-click="selectNode" @node-drag-start="startDrag" @node-drag-stop="rearrangeSubsystem" @viewport-change="compact = $event.zoom < 0.5" @viewport-change-end="viewportChanged" @pane-click="clearSelection"
      >
        <template #node-page="{ data, selected }">
          <Vibe64ArchitecturePageNode :data="data" :selected="selected" :compact="compact" :context="Boolean(expandedSubsystemId) && data.id !== selectedPageId" @show-usage="showUsage" />
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
          <div class="subsystem-zoom__context">
            <article class="subsystem-zoom nodrag nopan" aria-label="Zoomed subsystem" @wheel="!$event.ctrlKey && $event.stopPropagation()" @touchmove="($event.touches.length !== 2) && $event.stopPropagation()">
              <nav class="subsystem-zoom__breadcrumbs" aria-label="Architecture location">
                <button type="button" class="subsystem-zoom__previous nodrag nopan" @click="previousView">Previous view</button>
                <button type="button" class="nodrag nopan" @click="closeDetail">Engine</button><span>›</span>
                <button v-if="fileRequest || programId" type="button" class="nodrag nopan" @click="showSubsystem">{{ data.owner.title }}</button><strong v-else>{{ data.owner.title }}</strong>
                <template v-if="currentProgram"><span>›</span><strong>{{ currentProgram.title }}</strong></template>
                <template v-else-if="fileRequest && parentProgram"><span>›</span><button type="button" @click="openProgram(parentProgram.id)">{{ parentProgram.title }}</button></template>
                <template v-if="fileRequest"><span>›</span><strong>{{ fileRequest.path.split('/').pop() }}</strong></template>
                <button v-if="!data.owner.opaque" type="button" class="subsystem-zoom__usage nodrag nopan" @click="showUsageForDetail(data.owner)">Show usage</button>
                <button type="button" class="subsystem-zoom__close" aria-label="Close this view" title="Close this view (Esc)" @click="previousView($event)">×</button>
              </nav>
              <p class="subsystem-zoom__navigation-hint">Scroll to read · Pinch to zoom · Esc / × to close this view</p>
              <div v-if="retainedFileRequest" v-show="fileRequest" class="subsystem-zoom__file"><slot name="file-interface" :request="retainedFileRequest" :active="!!fileRequest" :architecture="architecture" :open-file="openFile" :update-location="updateFileLocation" :open-program="openProgram"><button type="button" @click="emit('inspect-file', retainedFileRequest)">Open {{ retainedFileRequest.path }} interface</button></slot></div>
              <Vibe64ProgramInspector v-if="retainedProgram" v-show="programId" :key="retainedProgram.id" :active="props.active && !!programId" :program="retainedProgram" :architecture="architecture" :owner="architecture.subsystems.find(owner => owner.id === retainedProgram.subsystemId)" @inspect="openFile"><template #text="context"><slot name="text" v-bind="context" :open-source="openFile">{{ context.text }}</slot></template></Vibe64ProgramInspector>
              <div v-show="!fileRequest && !programId" class="subsystem-zoom__body">
                <div v-if="retainedOutline?.owner.id !== data.owner.id" class="subsystem-zoom__loading" role="status" aria-busy="true" aria-label="Loading subsystem interface"><h2>{{ data.owner.title }}</h2><p>{{ data.owner.root }}</p><div class="subsystem-zoom__skeleton" /><div class="subsystem-zoom__skeleton" /><div class="subsystem-zoom__skeleton" /><p>Preparing interface and files…</p></div>
                <Vibe64SubsystemInspector v-if="retainedOutline" v-show="retainedOutline.owner.id === data.owner.id" embedded :outline="retainedOutline" @inspect="openFile" @open-program="openProgram"><template #text="context"><slot name="text" v-bind="context" :open-source="openFile">{{ context.text }}</slot></template></Vibe64SubsystemInspector>
              </div>
            </article>
          </div>
        </template>
        <template #node-subsystem="{ data, selected }">
          <Vibe64ArchitectureSubsystemNode :data="data" :selected="selected" :compact="compact" :context="Boolean(expandedSubsystemId) && !data.expanded" @move="moveSubsystem(data.id, $event)" />
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
        <p v-else-if="!loading">{{ coverage === 'complete' ? 'The configured inspector found no UI entry points.' : 'Re-scan project to create the project index. Check Genesis subsystem declarations and Stack inspection settings if it remains empty.' }}</p>
        <v-btn v-if="error" size="small" variant="tonal" :disabled="loading" @click="reload">Retry loading</v-btn>
      </div>
      <div v-else-if="!expandedSubsystemId" class="ui-storyboard__legend">Drag empty space to pan · Zoom into a subsystem to explore · Use ⠿ to arrange <span>Entry points emphasised · Supporting directories subdued</span></div>
      <div v-if="entryWarning" class="ui-storyboard__notice" role="status">{{ entryWarning }}</div>
    </div>
    <Vibe64UsageView
      v-if="usageMounted" v-show="usageState.view === 'usage'" class="ui-storyboard__usage"
      :active="props.active && usageState.view === 'usage'" :session-id="props.sessionId" :state="usageState" :find-request="usageFind"
      :snapshot-key="usageSnapshotKey" :refreshing="refreshing"
      @update:state="usageState = usageStateFromQuery($event)" @refresh="refresh" @open-source-file="emit('open-source-file', $event)" @select-preview="emit('select-preview')"
    />
  </section>
</template>

<script setup>
import { computed, ref, toRef, watch } from 'vue';
import { BaseEdge, MarkerType, VueFlow } from '@vue-flow/core';
import { useVibe64SystemGraph } from '../composables/useVibe64SystemGraph.js';
import { useVibe64ArchitectureCanvas } from '../composables/useVibe64ArchitectureCanvas.js';
import Vibe64UsageView from '../usage/Vibe64UsageView.vue';
import { usageStateFromQuery } from '../usage/usageModel.js';
import { useVibe64UsageState } from '../usage/useVibe64UsageState.js';
import Vibe64SubsystemInspector from './Vibe64SubsystemInspector.vue';
import Vibe64ProgramInspector from './Vibe64ProgramInspector.vue';
import Vibe64ArchitecturePageNode from './Vibe64ArchitecturePageNode.vue';
import Vibe64ArchitectureSubsystemNode from './Vibe64ArchitectureSubsystemNode.vue';
import { controllerPath } from '../architectureCanvas.js';

const props = defineProps({
  active: { type: Boolean, default: true },
  sessionId: { type: String, default: '' },
  reloadVersion: { type: Number, default: 0 },
  openProgramRequest: { type: /** @type {import('vue').PropType<{ id: string } | null>} */ (Object), default: null },
  restoreRequest: { type: /** @type {import('vue').PropType<import('../usage/useVibe64UsageState.js').ArchitectureRestoreRequest | null>} */ (Object), default: null },
  usageOpenRequest: { type: /** @type {import('vue').PropType<import('../usage/useVibe64UsageState.js').UsageOpenRequest | null>} */ (Object), default: null }
});
const { architecture, error, loading, refreshing, refreshProgress, refreshOutput, refresh, reload, cancelRefresh } = useVibe64SystemGraph({
  active: toRef(props, 'active'), sessionId: toRef(props, 'sessionId'), reloadVersion: toRef(props, 'reloadVersion')
});
const emit = defineEmits(['inspect-file', 'open-source-file', 'select-preview']);
const { usageState, usageMounted, usageFind, usageSnapshotKey, setArchitectureView, showUsage } = useVibe64UsageState({
  props, architecture, onMapShown: () => fitWhenMapShown()
});
const canvas = ref(null);
const dismissedError = ref('');
watch(error, () => { dismissedError.value = ''; });
const compact = ref(false);
const {
  expandedSubsystemId, outline, retainedOutline, layoutPositions, fileRequest, retainedFileRequest, programId, currentProgram, retainedProgram, parentProgram,
  nodes, edges, showCalls, selectedPageId, visibleEdges, uiIds, engineIds, externalCount, contentCount,
  closeDetail, openProgram, openFile, updateFileLocation, previousView, showSubsystem, toggleCalls, selectNode, clearSelection, startDrag, rearrangeSubsystem, moveSubsystem,
  zoomWheel, startPinch, movePinch, endPinch, zoomControl, viewportChanged, fit, initialize, fitIfPending, fitWhenMapShown
} = useVibe64ArchitectureCanvas({ props, architecture, usageState, canvas });
const coverage = computed(() => architecture.value?.ui?.capabilities?.pages);
const entryWarning = computed(() => architecture.value?.layoutDiagnostic || architecture.value?.entryPointDiagnostic || ((architecture.value?.layout?.groups || []).flatMap(group => group.subsystems).some(member => !(architecture.value?.subsystems || []).some(owner => !owner.opaque && owner.root === member.root)) ? 'Some declared architecture roots are not indexed. Re-scan project or correct their Stack paths.' : (architecture.value?.entryPoints || []).some(entry => entry.resolution !== 'resolved') ? 'Some declared entry files are not indexed. Re-scan project or correct their Stack paths.' : ''));

function showUsageForDetail(owner) {
  if (fileRequest.value) return showUsage({ q: fileRequest.value.path });
  if (currentProgram.value) return showUsage({ q: currentProgram.value.title, kind: 'program-operation' });
  return showUsage({ q: owner.root && owner.root !== '.' ? `${owner.root}/` : '' });
}
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
.ui-storyboard__heading h2 { margin: 0; font-size: 18px; font-weight: 650; line-height: 26px; }
.ui-storyboard__heading p { margin: 0; font-size: 11px; line-height: 16px; opacity: .65; }
.ui-storyboard__actions { display: flex; align-items: center; gap: 4px; }
.ui-storyboard__views { flex: none; }
.ui-storyboard__usage { flex: 1; min-height: 0; }
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
.subsystem-zoom__breadcrumbs .subsystem-zoom__previous { min-height: 44px; padding: 5px 8px; }
.subsystem-zoom__breadcrumbs .subsystem-zoom__close { position: absolute; top: 2px; right: 4px; width: 44px; height: 44px; padding: 0; font-size: 24px; }
.subsystem-zoom__navigation-hint { flex: none; margin: 0; padding: 3px 18px; font-size: 11px; line-height: 16px; color: #69817d; border-bottom: 1px solid #edf2f0; }
.subsystem-zoom__file { height: min(720px, 75vh); min-height: 0; overflow: hidden; }
.subsystem-zoom__file :deep(.vibe64-source-editor) { height: 100%; }
.ui-storyboard__legend { position: absolute; bottom: 16px; left: 20px; right: 20px; display: flex; justify-content: space-between; gap: 12px; pointer-events: none; font-size: 11px; color: #6d8094; }
.ui-storyboard__error { position: absolute; z-index: 12; top: 12px; left: 12px; max-width: min(520px, calc(100% - 24px)); flex: none; font-size: 12px; }
.ui-storyboard__empty { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 8px; text-align: center; padding: 24px; pointer-events: none; }
.ui-storyboard__empty button { pointer-events: auto; }
.ui-storyboard__empty h2 { margin: 0 0 8px; font-size: 20px; }
.ui-storyboard__empty p { max-width: 420px; margin: 0; font-size: 14px; }
.external-dependencies { width: 100%; height: 100%; border: 1px solid #afbfce; border-radius: 10px; background: #f0f4f9; color: #304b64; overflow: hidden; }
.external-dependencies header { height: 98px; padding: 18px 20px; border-bottom: 1px solid #d5dfe9; }
.external-dependencies h2 { margin: 0; font-size: 22px; line-height: 28px; font-weight: 650; }
.external-dependencies header p { margin: 8px 0 0; font-size: 13px; line-height: 20px; color: #6b8196; }
.external-dependencies ul { list-style: none; padding: 4px 12px 8px; margin: 0; }
.external-dependencies button { display: block; width: 100%; padding: 7px 12px; border: 0; border-bottom: 1px solid #dde5ed; border-radius: 4px; text-align: left; font: 15px/22px ui-monospace, monospace; overflow-wrap: anywhere; color: inherit; cursor: pointer; }
.external-dependencies button:hover { background: #dfe9f3; color: #245e90; }
.external-dependencies button:focus-visible { outline: 2px solid #377dcb; outline-offset: -2px; }
.controller-call-label { overflow: visible; }
.controller-call-label div { width: max-content; max-width: 330px; padding: 2px 5px; border-radius: 4px; background: #f6f0ff; color: #68469e; font: 10px/18px ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.architecture-annotation { height: 100%; width: 100%; pointer-events: none; color: #6f8392; }
.architecture-annotation--heading { pointer-events: auto; user-select: none; cursor: default; display: flex; align-items: baseline; gap: 14px; padding: 4px 0; }
.architecture-annotation--heading strong { font-size: 22px; color: #29475a; font-weight: 650; }
.architecture-annotation--heading span { font-size: 13px; }
.architecture-annotation--layer { background: #eaf0f4; border-radius: 8px; border-bottom: 1px solid #d6e1e5; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 4px; padding: 8px 12px; }
.architecture-annotation--layer strong { width: calc(var(--layer-label-width) - 24px); font-size: 14px; line-height: 18px; color: #526d77; overflow-wrap: anywhere; }
.architecture-annotation--layer span { width: calc(var(--layer-label-width) - 24px); font-size: 10px; line-height: 14px; }
.architecture-annotation--divider { background: #c2d0dc; }
.ui-storyboard__notice { position: absolute; top: 12px; left: 12px; max-width: 460px; padding: 8px 12px; background: #fff7e9; color: #875829; font-size: 12px; border-radius: 6px; }
.architecture-annotation--libraries { padding: 8px 4px; }
.architecture-annotation--libraries strong { display: block; font-size: 22px; color: #60528a; }
.architecture-annotation--libraries span { display: block; font-size: 12px; margin-top: 5px; }
.architecture-annotation--support { background: #eef0f4; border: 1px dashed #cbd1da; border-radius: 7px; padding: 12px; }
.architecture-annotation--support strong, .architecture-annotation--support span { display: block; width: calc(var(--layer-label-width) - 24px); }
.architecture-annotation--support strong { font-size: 16px; color: #657282; }
.architecture-annotation--support span { font-size: 11px; line-height: 17px; margin-top: 6px; }
@media (max-width: 600px) { .ui-storyboard__toolbar { gap: 4px 6px; padding: 4px 8px; } .ui-storyboard__heading { display: contents; } .ui-storyboard__heading p { order: 1; flex-basis: 100%; } .ui-storyboard__actions { margin-left: auto; } .ui-storyboard__legend { left: 12px; bottom: 10px; } .ui-storyboard__legend span { display: none; } }
</style>
