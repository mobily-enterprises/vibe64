<template>
  <div ref="canvas" class="layers" @scroll.passive="measure">
    <p v-if="hiddenCount" class="layers__notice" role="status">Showing {{ nodeCount - hiddenCount }} of {{ nodeCount }} nodes. Search to focus; layer numbers and cycle labels use the full graph.</p>
    <p v-else-if="graph.edges.length > 20 && !selectedId && !allEdges" class="layers__notice">Select a node to see its arrows, or enable All arrows.</p>
    <svg class="layers__arrows" :width="size.width" :height="size.height" aria-hidden="true">
      <defs><marker :id="markerId" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="currentColor" /></marker></defs>
      <path v-for="(line, index) in lines" :key="index" :d="line" fill="none" stroke="currentColor" stroke-width="1.5" :marker-end="`url(#${markerId})`" />
    </svg>
    <section v-for="layer in visibleLayers" :key="layer.rank" class="layers__row" :aria-label="`Dependency layer ${layer.rank}`">
      <div class="layers__label">Layer {{ layer.rank }} <span>{{ layer.rank === 0 ? 'No lower dependency in this scope' : 'Uses layers below' }}</span></div>
      <div class="layers__groups">
        <div v-for="group in layer.groups" :key="group.id" class="layers__group" :class="{ 'layers__group--cycle': group.cyclic }">
          <div v-if="group.cyclic" class="layers__cycle" role="status">{{ group.cycleLabel }}{{ group.hiddenCount ? ` · ${group.hiddenCount} nodes hidden` : '' }}</div>
          <button v-for="node in group.members" :key="node.id" type="button" class="layers__node" :class="{ 'layers__node--selected': node.id === selectedId }" :data-node-id="node.id" :aria-pressed="node.id === selectedId" @click="$emit('select', node.id)">
            <strong>{{ node.title || node.path }}</strong>
            <span>{{ node.root || node.path }}</span>
            <small v-if="node.kind === 'package'">{{ node.opaque ? 'Opaque package' : 'Package boundary' }}{{ node.version ? ` · ${node.version}` : '' }}</small>
            <small v-else-if="node.fileIds">{{ node.fileIds.length }} files · {{ node.provenance }}</small>
            <small v-else>{{ node.language === 'unknown' ? 'Analysis unavailable' : node.language }}</small>
            <small v-if="graph.externalCycleFileIds?.has(node.id)">Cycle crosses subsystem boundary</small>
            <small v-else-if="graph.disconnectedIds?.has(node.id)">Disconnected in this scope</small>
          </button>
        </div>
      </div>
    </section>
    <p v-if="!visibleLayers.length" class="pa-4 text-medium-emphasis">{{ nodeCount ? 'No matching nodes. Clear or change the search.' : 'No files in this view.' }}</p>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
const props = defineProps({ active: { type: Boolean, default: true }, graph: { type: Object, required: true }, selectedId: { type: String, default: "" }, query: { type: String, default: "" }, allEdges: Boolean });
defineEmits(["select"]);
const nodes = computed(() => props.graph.layers.flatMap(layer => layer.groups.flatMap(group => group.members)));
const nodeCount = computed(() => nodes.value.length);
const visibleIds = computed(() => {
  const query = props.query.trim().toLowerCase();
  const matches = nodes.value.filter(node => !query || `${node.title} ${node.path || node.root}`.toLowerCase().includes(query));
  const ids = new Set(props.selectedId ? [props.selectedId] : []);
  const cycle = props.graph.layers.flatMap(layer => layer.groups).find(group => group.cyclic && group.members.some(node => node.id === props.selectedId));
  for (const node of cycle?.members || []) { if (ids.size >= 200) break; ids.add(node.id); }
  if (props.selectedId) for (const edge of props.graph.edges) {
    if (ids.size >= 200) break;
    if (edge.fromId === props.selectedId || edge.toId === props.selectedId) for (const id of [edge.fromId, edge.toId]) { if (ids.size < 200) ids.add(id); }
  }
  for (const node of matches) { if (ids.size >= 200) break; ids.add(node.id); }
  return ids;
});
const visibleLayers = computed(() => props.graph.layers.map(layer => ({ ...layer, groups: layer.groups.map(group => {
  const members = group.members.filter(node => visibleIds.value.has(node.id));
  return { ...group, members, hiddenCount: group.members.length - members.length };
}).filter(group => group.members.length) })).filter(layer => layer.groups.length));
const hiddenCount = computed(() => nodeCount.value - visibleLayers.value.reduce((total, layer) => total + layer.groups.reduce((sum, group) => sum + group.members.length, 0), 0));
const markerId = `dependency-${useId().replace(/[^a-zA-Z0-9_-]/gu, "")}`;
const canvas = ref(null);
const size = ref({ width: 0, height: 0 });
const lines = ref([]);
let observer;
let frame;
function measure() {
  cancelAnimationFrame(frame);
  if (!props.active || !canvas.value) return;
  frame = requestAnimationFrame(() => {
    const element = canvas.value;
    if (!props.active || !element) return;
    const outer = element.getBoundingClientRect();
    const rectangles = new Map([...element.querySelectorAll("[data-node-id]")].map(node => {
      const rect = node.getBoundingClientRect();
      return [node.dataset.nodeId, { x: rect.left - outer.left + element.scrollLeft, y: rect.top - outer.top + element.scrollTop, width: rect.width, height: rect.height }];
    }));
    // Measure the cards, not this SVG's previous size, which can otherwise
    // retain overflow after the pane narrows or the graph changes.
    size.value = { width: Math.max(element.clientWidth, ...[...rectangles.values()].map(rect => rect.x + rect.width + 20)), height: Math.max(element.clientHeight, ...[...rectangles.values()].map(rect => rect.y + rect.height + 36)) };
    lines.value = props.graph.edges.filter(edge => props.allEdges || (!props.selectedId && props.graph.edges.length <= 20) || edge.fromId === props.selectedId || edge.toId === props.selectedId).flatMap(edge => {
      const from = rectangles.get(edge.fromId); const to = rectangles.get(edge.toId);
      if (!from || !to) return [];
      if (Math.abs(from.y - to.y) < 60) {
        const x1 = from.x + from.width / 2; const x2 = to.x + to.width / 2;
        const y1 = from.y + from.height; const y2 = to.y + to.height;
        return [`M${x1},${y1} C${x1},${Math.max(y1, y2) + 22} ${x2},${Math.max(y1, y2) + 22} ${x2},${y2}`];
      }
      const x1 = from.x + from.width / 2; const y1 = from.y + from.height;
      const x2 = to.x + to.width / 2; const y2 = to.y;
      const middle = (y1 + y2) / 2;
      return [`M${x1},${y1} C${x1},${middle} ${x2},${middle} ${x2},${y2}`];
    });
  });
}
watch(() => [props.graph, props.selectedId, props.allEdges, props.query], async () => { await nextTick(); measure(); });
watch(() => props.active, async active => {
  observer?.disconnect(); cancelAnimationFrame(frame);
  if (!active) return;
  await nextTick();
  if (props.active && canvas.value) { observer?.observe(canvas.value); measure(); }
});
onMounted(() => { observer = new ResizeObserver(measure); if (props.active) { observer.observe(canvas.value); measure(); } });
onBeforeUnmount(() => { observer?.disconnect(); cancelAnimationFrame(frame); });
</script>

<style scoped>
.layers { position: relative; overflow: auto; min-height: 260px; isolation: isolate; padding: 12px 20px 36px; }
.layers__notice { font-size: 12px; opacity: .7; margin-bottom: 16px; }
.layers__arrows { position: absolute; left: 0; top: 0; pointer-events: none; z-index: -1; color: rgb(var(--v-theme-primary)); opacity: .7; }
.layers__row { margin: 0 0 54px; }
.layers__label { font-size: 12px; color: rgba(var(--v-theme-on-surface), .7); margin-bottom: 12px; display: flex; gap: 12px; }
.layers__label span { opacity: .7; }
.layers__groups { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 20px; }
.layers__group { display: flex; flex-wrap: wrap; gap: 12px; position: relative; }
.layers__group--cycle { border: 1px dashed rgb(var(--v-theme-warning)); padding: 30px 12px 12px; border-radius: 16px; }
.layers__cycle { position: absolute; top: 6px; left: 12px; font-size: 12px; color: rgb(var(--v-theme-warning)); }
.layers__node { background: rgb(var(--v-theme-surface-light)); color: rgb(var(--v-theme-on-surface)); border: 1px solid rgba(var(--v-theme-on-surface), .18); border-radius: 12px; min-height: 88px; width: 210px; text-align: left; display: flex; flex-direction: column; gap: 4px; padding: 14px; cursor: pointer; }
.layers__node strong { font-size: 14px; overflow-wrap: anywhere; }
.layers__node span { font-size: 11px; opacity: .75; overflow-wrap: anywhere; }
.layers__node small { font-size: 11px; opacity: .65; }
.layers__node:hover, .layers__node--selected { border-color: rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-primary), .1); }
.layers__node:focus-visible { outline: 3px solid rgb(var(--v-theme-primary)); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
</style>
