<template>
  <div class="usage-web" :class="{ 'usage-web--compact': compact }">
    <template v-if="!zoomedId">
      <p v-if="!layout.sections.length" class="usage-web__empty text-body-medium" role="status">{{ emptyText }}</p>
      <section v-for="section in layout.sections" :key="section.id || 'all'" class="usage-web__group" :aria-label="section.title || 'Subsystems'">
        <h3 v-if="section.title" class="usage-web__group-title text-title-small">{{ section.title }}</h3>
        <div class="usage-web__cards">
          <v-card
            v-for="card in section.cards"
            :key="card.id"
            class="usage-web__card"
            :class="{ 'usage-web__card--untouched': !reached(card) }"
            variant="outlined"
            rounded="lg"
            :disabled="!reached(card)"
            :aria-label="`${card.title}: ${cardText(card).count}`"
            @click="emit('zoom', card.id)"
          >
            <v-card-item>
              <v-card-title class="text-title-medium">{{ card.title }}</v-card-title>
              <v-card-subtitle class="text-body-medium">{{ cardText(card).count }}</v-card-subtitle>
              <template v-if="card.id === startSubsystemId" #append><span class="usage-web__start text-label-medium">Starts here</span></template>
            </v-card-item>
            <v-card-text v-if="cardText(card).detail || cardText(card).plumbing || crossingsFrom(crossings, card.id, subsystems).length" class="usage-web__card-body">
              <p v-if="cardText(card).detail" class="text-body-small">{{ cardText(card).detail }}</p>
              <v-chip v-if="cardText(card).plumbing" size="small" variant="tonal" class="usage-web__plumbing">Shared plumbing ({{ cardText(card).plumbing }})</v-chip>
              <ul class="usage-web__crossings" aria-label="Crossings">
                <li v-for="crossing in crossingsFrom(crossings, card.id, subsystems)" :key="crossing.toSubsystemId" class="text-body-small">
                  → {{ crossing.title }} · {{ crossingText(mode, crossing) }}
                </li>
              </ul>
            </v-card-text>
          </v-card>
        </div>
      </section>
      <v-chip
        v-if="layout.untouched"
        class="usage-web__untouched"
        :variant="showUntouched ? 'tonal' : 'outlined'"
        :prepend-icon="showUntouched ? mdiCheck : undefined"
        role="switch"
        :aria-checked="showUntouched"
        @click="emit('update:showUntouched', !showUntouched)"
      >Show untouched ({{ layout.untouched }})</v-chip>
    </template>

    <template v-else>
      <header class="usage-web__zoom">
        <v-btn variant="text" :prepend-icon="mdiArrowLeft" @click="emit('zoom', '')">All subsystems</v-btn>
        <h3 class="usage-web__zoom-title text-title-medium">{{ zoomedTitle }}</h3>
        <slot name="zoom-actions" />
        <!-- Lines are drawn only on the canvas; list rows say it in words. -->
        <div v-if="mode !== 'imports' && !compact" class="usage-web__legend" aria-label="Legend">
          <v-chip size="small" variant="text" class="usage-web__legend-chip"><svg width="24" height="8" aria-hidden="true"><line x1="0" y1="4" x2="24" y2="4" class="usage-web__line usage-web__line--exact" /></svg>Exact</v-chip>
          <v-chip size="small" variant="text" class="usage-web__legend-chip"><svg width="24" height="8" aria-hidden="true"><line x1="0" y1="4" x2="24" y2="4" class="usage-web__line usage-web__line--probable" /></svg>Probable</v-chip>
          <v-chip v-if="mode === 'calls'" size="small" variant="text" class="usage-web__legend-chip"><svg width="24" height="10" aria-hidden="true"><line x1="0" y1="5" x2="14" y2="5" class="usage-web__line usage-web__line--probable" /><circle cx="18" cy="5" r="4" class="usage-web__stub" /></svg>Unresolved</v-chip>
        </div>
      </header>
      <ul v-if="leaving.length" class="usage-web__crossings" aria-label="Leaving this subsystem">
        <li v-for="crossing in leaving" :key="crossing.toSubsystemId" class="text-body-small">→ {{ crossing.title }} · {{ crossingText(mode, crossing) }}</li>
      </ul>
      <p v-if="!nodes.length" class="usage-web__empty text-body-medium" role="status">{{ zoomEmptyText }}</p>
      <v-list v-else-if="compact" class="usage-web__rows" density="comfortable" aria-label="Reached in this subsystem">
        <template v-for="column in columns" :key="column.depth">
          <v-list-subheader>{{ depthTitle(column.depth) }}</v-list-subheader>
          <v-list-item
            v-for="node in column.items"
            :key="node.id"
            :active="node.id === selectedId"
            color="primary"
            rounded="lg"
            lines="three"
            :title="node.title"
            @click="emit('select', node)"
          >
            <template #subtitle>
              <span class="usage-web__row-path"><template v-for="(part, position) in pathParts(node.subtitle)" :key="position">{{ part }}<wbr></template></span>
              <span class="usage-web__row-counts">{{ rowCounts(node) }}</span>
            </template>
          </v-list-item>
        </template>
      </v-list>
      <div v-else class="usage-web__frame">
        <div ref="scroller" class="usage-web__scroll" @scroll.passive="measureScroll">
          <div class="usage-web__plane" :style="{ width: `${plan.width + stubRoom}px`, height: `${plan.height}px` }">
            <svg class="usage-web__edges" :width="plan.width + stubRoom" :height="plan.height" aria-hidden="true">
              <defs>
                <marker v-for="certainty in ['exact', 'probable']" :id="`${arrowId}-${certainty}`" :key="certainty" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" :class="`usage-web__arrow usage-web__arrow--${certainty}`" />
                </marker>
              </defs>
              <path
                v-for="edge in plan.paths"
                :key="edge.key"
                :d="edge.d"
                :marker-end="`url(#${arrowId}-${edge.certainty === 'probable' ? 'probable' : 'exact'})`"
                class="usage-web__line"
                :class="[`usage-web__line--${edge.certainty || 'exact'}`, { 'usage-web__line--dim': selectedId && edge.from !== selectedId && edge.to !== selectedId }]"
              />
              <g v-for="stub in stubs" :key="stub.id">
                <line :x1="stub.x" :y1="stub.y" :x2="stub.x + 14" :y2="stub.y" class="usage-web__line usage-web__line--probable" />
                <circle :cx="stub.x + 19" :cy="stub.y" r="5" class="usage-web__stub"><title>{{ countLabel(stub.count, 'unresolved call') }}</title></circle>
              </g>
            </svg>
            <button
              v-for="node in nodes"
              :key="node.id"
              type="button"
              class="usage-node"
              :class="{ 'usage-node--selected': node.id === selectedId, 'usage-node--probable': node.certainty === 'probable', 'usage-node--plumbing': node.plumbing }"
              :style="nodeStyle(node)"
              :aria-pressed="node.id === selectedId"
              :aria-label="nodeLabel(node)"
              :title="[node.title, node.subtitle, badge(node, true)].filter(Boolean).join('\n')"
              @click="emit('select', node)"
            >
              <span class="usage-node__head">
                <span class="usage-node__title text-body-medium">{{ node.title }}</span>
                <span v-if="badge(node)" class="usage-node__badge text-label-small">{{ badge(node) }}</span>
              </span>
              <span class="usage-node__subtitle text-body-small">{{ node.location || node.subtitle }}</span>
            </button>
          </div>
        </div>
        <!-- Columns cut off on the right fade out, saying the canvas scrolls. -->
        <div v-if="moreRight" class="usage-web__more" aria-hidden="true" />
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { mdiArrowLeft, mdiCheck } from "@mdi/js";

import {
  COUNT_KEYS,
  NODE,
  canvasLayout,
  countLabel,
  crossingText,
  crossingsFrom,
  depthColumns,
  depthTitle,
  joinText,
  pathParts,
  subsystemCard,
  subsystemSections
} from "./usageModel.js";

const props = defineProps({
  mode: { type: String, required: true },
  subsystems: { type: Array, default: () => [] },
  groups: { type: Array, default: () => [] },
  crossings: { type: Array, default: () => [] },
  zoomedId: { type: String, default: "" },
  nodes: { type: Array, default: () => [] },
  edges: { type: Array, default: () => [] },
  selectedId: { type: String, default: "" },
  showUntouched: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  startSubsystemId: { type: String, default: "" }
});
const emit = defineEmits(["zoom", "select", "update:showUntouched"]);

const stubRoom = 32;
const countKey = computed(() => COUNT_KEYS[props.mode]);
const reached = (item) => Number(item[countKey.value] || 0) > 0;
const cardText = (item) => subsystemCard(props.mode, item);
const layout = computed(() => subsystemSections(props.subsystems, props.groups, { countKey: countKey.value, showUntouched: props.showUntouched }));
const zoomedTitle = computed(() => props.subsystems.find((item) => item.id === props.zoomedId)?.title || props.zoomedId);
const leaving = computed(() => (props.zoomedId ? crossingsFrom(props.crossings, props.zoomedId, props.subsystems) : []));
const emptyText = computed(() => (props.mode === "recording" ? "This request ran no project code that the last scan knows." : "Nothing is reached from this entry."));
const zoomEmptyText = computed(() => (props.mode === "imports" ? "No files in this subsystem are reached." : props.mode === "calls" ? "No functions in this subsystem are reached." : "No functions in this subsystem ran."));
const columns = computed(() => depthColumns(props.nodes));
const plan = computed(() => canvasLayout(props.nodes, props.edges));
const stubs = computed(() => props.nodes.filter((node) => node.unresolved).map((node) => {
  const position = plan.value.positions.get(node.id);
  return { id: node.id, count: node.unresolved, x: position.x + NODE.width, y: position.y + NODE.height - 12 };
}));
// Arrowheads take their line's colour, so each certainty has its own marker.
const arrowId = `usage-arrow-${useId()}`;

const scroller = ref(null);
const moreRight = ref(false);
function measureScroll() {
  const element = scroller.value;
  moreRight.value = Boolean(element) && element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
}
let resizeObserver = null;
watch(scroller, (element) => {
  resizeObserver?.disconnect();
  resizeObserver = element && typeof ResizeObserver === "function" ? new ResizeObserver(measureScroll) : null;
  resizeObserver?.observe(element);
  measureScroll();
}, { flush: "post" });
watch(plan, () => nextTick(measureScroll));
onBeforeUnmount(() => resizeObserver?.disconnect());

function nodeStyle(node) {
  const position = plan.value.positions.get(node.id);
  return { left: `${position.x}px`, top: `${position.y}px`, width: `${NODE.width}px`, height: `${NODE.height}px` };
}

// A node's badge is short; its label, tooltip and list row say it in full.
const SHORT_JOIN = Object.freeze({ stale: "changed", none: "not scanned" });

function badge(node, full = false) {
  if (props.mode === "recording" && node.join !== "exact" && node.join !== "name-line") return full ? joinText(node.join) : SHORT_JOIN[node.join] || "";
  if (props.mode === "recording") return node.count == null ? "ran" : `×${node.count.toLocaleString()}`;
  if (node.certainty === "probable") return full ? "only via probable calls" : "probable";
  return "";
}

// List rows carry what the canvas draws: certainty, counts and unresolved stubs.
function rowCounts(node) {
  if (props.mode === "recording") return badge(node, true);
  const [out, into] = props.mode === "imports" ? ["imports", "imported by"] : ["calls", "called by"];
  return [badge(node, true), `${out} ${node.outCount} → · ${into} ${node.inCount} ←`, node.unresolved && countLabel(node.unresolved, "unresolved call")].filter(Boolean).join(" · ");
}

function nodeLabel(node) {
  return [node.title, node.subtitle, props.mode === "recording" ? badge(node, true) : rowCounts(node)].filter(Boolean).join(", ");
}
</script>

<style scoped>
.usage-web { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.usage-web__empty { margin: 0; padding: 8px 0; color: var(--v64-on-surface-variant); }
.usage-web__group { display: flex; flex-direction: column; gap: 8px; }
.usage-web__group-title { margin: 0; color: var(--v64-on-surface-variant); }
.usage-web__cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); gap: 12px; }
.usage-web__card { min-width: 0; border-color: var(--v64-outline-variant); }
.usage-web__card--untouched { opacity: .6; }
.usage-web__card-body { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding-top: 0; }
.usage-web__card-body p { margin: 0; }
.usage-web__crossings { list-style: none; margin: 0; padding: 0; color: var(--v64-on-surface-variant); }
.usage-web__crossings li { overflow-wrap: anywhere; }
.usage-web__start { color: var(--v64-primary); white-space: nowrap; }
.usage-web__untouched { align-self: flex-start; }
.usage-web__untouched.v-chip--variant-outlined { border-color: var(--v64-outline); }
.usage-web__zoom { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; }
.usage-web__zoom-title { margin: 0; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.usage-web__legend { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.usage-web__legend-chip svg { margin-right: 6px; }
.usage-web__rows { background: transparent; padding: 0; }
.usage-web__rows :deep(.v-list-item-subtitle) { display: flex; flex-direction: column; gap: 2px; -webkit-line-clamp: unset; overflow-wrap: break-word; }
.usage-web__row-counts { color: var(--v64-on-surface); }
.usage-web__frame { position: relative; min-width: 0; }
.usage-web__scroll { overflow: auto; max-width: 100%; border: 1px solid var(--v64-outline-variant); border-radius: var(--v64-shape-md); background: var(--v64-surface); }
.usage-web__more { position: absolute; top: 1px; right: 1px; bottom: 1px; width: 48px; pointer-events: none; border-radius: 0 var(--v64-shape-md) var(--v64-shape-md) 0; background: linear-gradient(to right, transparent, var(--v64-surface)); }
.usage-web__plane { position: relative; }
.usage-web__edges { position: absolute; inset: 0; pointer-events: none; }
.usage-web__line { fill: none; stroke: var(--v64-primary); stroke-width: 1.5; }
.usage-web__line--probable { stroke: var(--v64-on-surface-variant); stroke-dasharray: 6 4; }
.usage-web__line--dim { opacity: .18; }
.usage-web__arrow--exact { fill: var(--v64-primary); }
.usage-web__arrow--probable { fill: var(--v64-on-surface-variant); }
.usage-web__stub { fill: var(--v64-surface); stroke: var(--v64-error); stroke-width: 1.5; }
.usage-node { position: absolute; display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: 8px 12px; text-align: left; border-radius: var(--v64-shape-md); border: 1px solid var(--v64-outline); background: var(--v64-surface); color: var(--v64-on-surface); cursor: pointer; overflow: hidden; }
.usage-node:hover { background: color-mix(in srgb, var(--v64-on-surface) calc(var(--v64-state-hover) * 100%), var(--v64-surface)); }
.usage-node:focus-visible { outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color); outline-offset: var(--v64-focus-ring-offset); }
/* Selected stays tinted under the pointer: its hover layer sits on its tint. */
.usage-node--selected { border-color: var(--v64-primary); background: var(--v64-secondary-container); }
.usage-node--selected:hover { background: color-mix(in srgb, var(--v64-on-secondary-container) calc(var(--v64-state-hover) * 100%), var(--v64-secondary-container)); }
.usage-node--probable { border-style: dashed; }
.usage-node--plumbing { opacity: .7; }
.usage-node__title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: break-word; }
.usage-node__subtitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.usage-node__subtitle { color: var(--v64-on-surface-variant); }
.usage-node__head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.usage-node__title { flex: 1; min-width: 0; }
.usage-node__badge { flex: none; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 6px; border-radius: var(--v64-shape-sm); background: var(--v64-surface-container-highest); color: var(--v64-on-surface-variant); }
/* Touch: 48 px targets. Chips keep their look and gain an invisible margin. */
@media (pointer: coarse) {
  .usage-web__zoom :deep(.v-btn) { min-height: 48px; }
  .usage-web__untouched, .usage-web__zoom :deep(.v-chip) { position: relative; overflow: visible; margin-block: 8px; }
  .usage-web__untouched::after, .usage-web__zoom :deep(.v-chip)::after { content: ""; position: absolute; inset: -8px 0; }
}
</style>
