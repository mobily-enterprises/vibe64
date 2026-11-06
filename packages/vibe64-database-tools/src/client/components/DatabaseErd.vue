<template>
  <section ref="erdRoot" class="database-erd" :class="{ 'database-erd--fullscreen': fullscreen }" @keydown="onKeydown">
    <Teleport :to="toolbarTarget || erdRoot" :disabled="!toolbarTarget || fullscreen">
      <!-- A relocated toolbar cannot bubble keyboard events to the ERD root. -->
      <header aria-label="ERD controls" class="database-erd__toolbar" @keydown="toolbarTarget && !fullscreen && onKeydown($event)">
        <v-autocomplete
          v-model="searchChoice"
          v-model:search="searchText"
          class="database-erd__search"
          clearable
          density="compact"
          hide-details
          item-title="title"
          :item-value="item => JSON.stringify([item.table, item.column])"
          :items="searchMatches"
          label="Find table or column"
          :menu-props="{ attach: erdRoot }"
          no-filter
          prepend-inner-icon="$search"
          return-object
          variant="outlined"
          @update:model-value="locate"
        />
        <v-btn class="database-erd__icon-button" :disabled="layoutPending || !nodes.length" icon="$filterCenterFocus" aria-label="Fit" title="Fit diagram" size="small" variant="text" @click="fitDiagram" />
        <v-menu v-model="optionsOpen" :attach="erdRoot" :close-on-content-click="false">
          <template #activator="{ props: menuProps }"><v-btn v-bind="menuProps" class="database-erd__icon-button" icon="$tune" aria-label="Diagram options" title="Diagram options" size="small" variant="text" /></template>
          <v-sheet class="database-erd__options" rounded="lg" elevation="2" aria-label="Diagram options">
            <strong>Display</strong>
            <v-btn-toggle :model-value="columnMode" mandatory density="compact" @update:model-value="changeColumnMode">
              <v-btn value="keys" size="small">Keys only</v-btn>
              <v-btn value="all" size="small">All columns</v-btn>
            </v-btn-toggle>
            <v-select
              :model-value="activeGroup" density="compact" :items="groupItems" label="Show tables"
              :menu-props="{ attach: erdRoot }" variant="outlined"
              hint="Filter the diagram without changing table data or overview concepts." persistent-hint
              @update:model-value="changeGroupFilter"
            />
            <v-divider />
            <strong>Arrangement</strong>
            <div class="database-erd__option-actions">
              <v-btn :disabled="layoutPending || !nodes.length" prepend-icon="$restartAlt" size="small" title="Arrange relationships while preserving pinned tables" variant="text" @click="resetPositions">Reset positions</v-btn>
              <v-btn :disabled="layoutPending || !undoStack.length" icon="$undo" aria-label="Undo diagram change" size="small" variant="text" @click="undo" />
              <v-btn :disabled="layoutPending || !redoStack.length" icon="$redo" aria-label="Redo diagram change" size="small" variant="text" @click="redo" />
            </div>
            <v-divider />
            <div class="database-erd__option-actions">
              <v-menu :attach="erdRoot">
                <template #activator="{ props: menuProps }"><v-btn v-bind="menuProps" size="small" variant="text">Saved views</v-btn></template>
                <v-list density="compact">
                  <v-list-item title="Save view…" @click="optionsOpen = false; viewName = ''; viewDialog = true" />
                  <v-list-item v-for="view in views" :key="view.id" :title="view.name" @click="loadView(view)">
                    <template #append><v-btn icon="$close" :aria-label="'Delete view ' + view.name" size="x-small" variant="text" @click.stop="removeView(view.id)" /></template>
                  </v-list-item>
                </v-list>
              </v-menu>
              <v-btn size="small" variant="text" @click="editGroup()">Edit table groups</v-btn>
              <v-btn v-if="fullscreenAvailable" :prepend-icon="fullscreen ? '$fullscreenExit' : '$fullscreen'" size="small" variant="text" @click="toggleFullscreen">{{ fullscreen ? 'Exit full screen' : 'Full screen' }}</v-btn>
            </div>
            <slot name="options" :close="() => optionsOpen = false" />
          </v-sheet>
        </v-menu>
      </header>
    </Teleport>
    <div v-if="focusTable || activeGroup" class="database-erd__filters">
      <v-chip v-if="activeGroup" size="small" closable @click:close="changeGroupFilter('')">{{ groupItems.find(item => item.value === activeGroup)?.title }}</v-chip>
      <v-chip v-if="focusTable" size="small" closable @click:close="setFocus('')">Focus: {{ tableName(focusTable) }}</v-chip>
      <span>{{ visibleCount }} / {{ nodes.length }} tables</span>
    </div>
    <div class="database-erd__canvas">
      <div v-if="!diagramReady && !layoutError" class="database-erd__loading" role="status" aria-live="polite">
        <v-skeleton-loader class="database-erd__loading-preview" type="heading, text@2" :width="180" color="transparent" boilerplate aria-hidden="true" />
        <span>Preparing diagram…</span>
      </div>
      <!-- Strict connection mode looks each connection end up among its own kind of port only, not among all of
           a card's ports, which on a hub table means hundreds of them per connection. -->
      <VueFlow
        class="database-erd__flow"
        :class="{ 'database-erd__flow--ready': diagramReady }"
        :inert="!diagramReady ? true : undefined"
        v-model:edges="edges"
        v-model:nodes="nodes"
        connection-mode="strict"
        :default-edge-options="defaultEdgeOptions"
        default-marker-color="rgb(var(--v-theme-primary))"
        :edges-updatable="false"
        :elements-selectable="true"
        :max-zoom="1.8"
        :min-zoom="0.08"
        :nodes-connectable="false"
        :nodes-draggable="draggable && !layoutPending"
        @init="onFlowInit"
        @node-click="onNodeClick"
        @node-drag-start="onNodeDragStart"
        @node-drag="onNodeDrag"
        @node-drag-stop="onNodeDragStop"
        @edge-click="onEdgeClick"
        @edge-mouse-enter="onEdgeHover"
        @edge-mouse-leave="onEdgeLeave"
        @pane-click="clearSelection"
        @move-start="clearViewportSave"
        @move-end="onViewportMove"
      >
        <!-- Only what cards and connections draw: Vue Flow's other element props cost every one of hundreds of them
             a props pass on each render, and would re-render every card on each move. -->
        <template #node-table="nodeProps"><DatabaseErdNode :id="nodeProps.id" :data="nodeProps.data" /></template>
        <template #edge-relationship="edgeProps">
          <DatabaseErdEdge
            :id="edgeProps.id" :data="edgeProps.data" :marker-end="edgeProps.markerEnd" :style="edgeProps.style"
            :source-x="edgeProps.sourceX" :source-y="edgeProps.sourceY" :source-position="edgeProps.sourcePosition"
            :target-x="edgeProps.targetX" :target-y="edgeProps.targetY" :target-position="edgeProps.targetPosition"
          />
        </template>
        <MiniMap pannable zoomable />
      </VueFlow>
      <div v-if="layoutPending && diagramReady" class="database-erd__notice" role="status">Arranging tables…</div>
      <div v-else-if="layoutError" class="database-erd__notice" role="alert">{{ layoutError }} <v-btn size="x-small" variant="text" @click="rebuild()">Retry</v-btn></div>
      <div v-else-if="obstructedCount" class="database-erd__notice" role="status">Some connections could not be routed around tables. Move tables or focus on a smaller group, then reset positions.</div>
      <v-sheet v-if="selectedRelationship || selectedNode" class="database-erd__inspector" rounded="lg" elevation="2">
        <div class="database-erd__inspector-heading">
          <strong>{{ selectedRelationship ? 'Relationship' : selectedNode.data.table.name }}</strong>
          <v-btn icon="$close" aria-label="Close diagram details" size="x-small" variant="text" @click="clearSelection" />
        </div>
        <template v-if="selectedRelationship">
          <div class="database-erd__constraint">{{ selectedRelationship.constraintName }}</div>
          <div v-for="(column, index) in selectedRelationship.columns" :key="column" class="database-erd__mapping">
            <span>{{ tableName(selectedRelationship.referencedTable) }}.{{ selectedRelationship.referencedColumns[index] }}</span>
            <span>→ {{ tableName(selectedRelationship.sourceTable) }}.{{ column }}</span>
          </div>
          <p>Per child: {{ selectedCardinality.parent }} parent{{ selectedCardinality.parent === '1' ? '' : 's' }}.<br>Per parent: {{ selectedCardinality.child }} children.</p>
          <p class="database-erd__muted">0 = optional · 1 = one · N = many · ? = unknown</p>
          <dl><dt>On delete</dt><dd>{{ selectedRelationship.deleteAction || 'Unknown' }}</dd><dt>On update</dt><dd>{{ selectedRelationship.updateAction || 'Unknown' }}</dd></dl>
          <v-btn size="small" variant="tonal" @click="setFocus(selectedRelationship.sourceTable)">Focus child table</v-btn>
        </template>
        <template v-else-if="selectedNode">
          <p>{{ selectedNode.data.table.columns.length }} columns · {{ incomingCount }} incoming · {{ outgoingCount }} outgoing</p>
          <div class="database-erd__inspector-actions">
            <v-btn size="small" variant="tonal" @click="setFocus(selectedNode.id)">Focus on this table</v-btn>
            <v-btn size="small" variant="text" @click="emit('select-table', selectedNode.data.table)">Open data</v-btn>
            <v-btn size="small" :prepend-icon="selectedNode.data.pinned ? '$keepFilled' : '$keep'" variant="text" @click="togglePin(selectedNode.id)">{{ selectedNode.data.pinned ? 'Unpin' : 'Pin position' }}</v-btn>
            <v-btn size="small" variant="text" @click="editGroup(selectedNode.data.group)">Edit group</v-btn>
          </div>
        </template>
      </v-sheet>
    </div>
    <v-dialog v-model="viewDialog" :attach="erdRoot" max-width="440">
      <v-card title="Save diagram view">
        <v-card-text><v-text-field v-model="viewName" label="View name" maxlength="80" autofocus :hint="matchingView ? 'This replaces the saved view with the same name.' : 'Includes positions, pins, groups, focus, columns and zoom.'" persistent-hint @keydown.enter.prevent="saveView" /></v-card-text>
        <v-card-actions><v-spacer /><v-btn @click="viewDialog = false">Cancel</v-btn><v-btn :disabled="!viewName.trim() || (!matchingView && views.length >= 20)" @click="saveView">Save view</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="groupDialog" :attach="erdRoot" max-width="520">
      <v-card title="Table groups">
        <v-card-text>
          <v-select v-if="groups.length" :model-value="editingGroup" :items="[{ title: 'New group', value: '' }, ...groups.map(group => ({ title: group.name, value: group.id }))]" label="Group to edit" :menu-props="{ attach: erdRoot }" @update:model-value="editGroup" />
          <v-text-field v-model="groupName" label="Group name" maxlength="80" />
          <v-autocomplete v-model="groupTables" :items="tableItems" label="Tables in group" multiple chips closable-chips :menu-props="{ attach: erdRoot }" />
        </v-card-text>
        <v-card-actions><v-btn v-if="editingGroup" @click="removeGroup">Remove group</v-btn><v-spacer /><v-btn @click="groupDialog = false">Cancel</v-btn><v-btn :disabled="!groupName.trim() || !groupTables.length" @click="saveGroup">Save group</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { MarkerType, VueFlow } from "@vue-flow/core";
import { MiniMap } from "@vue-flow/minimap";
import DatabaseErdEdge from "./DatabaseErdEdge.vue";
import DatabaseErdNode from "./DatabaseErdNode.vue";
import { hasElementFunction } from "../browser.js";
import { useDatabaseErd } from "../composables/useDatabaseErd.js";
import { erdCardinality, erdLayoutGroups, erdSearch } from "../../shared/erdModel.js";

const props = defineProps({
  focusRequest: { type: Object, default: null },
  toolbarTarget: { type: Object, default: null },
  draggable: { type: Boolean, default: true },
  centralTable: { type: String, default: "" },
  layout: { default: () => ({ nodes: [] }), type: Object },
  schema: { default: () => ({ relationships: [], tables: [] }), type: Object }
});
const emit = defineEmits(["save-layout", "select-table", "inspect-table"]);
const erdRoot = ref(null);
const optionsOpen = ref(false);
const fullscreen = ref(false);
const fullscreenAvailable = ref(false);
const searchText = ref("");
const searchChoice = ref(null);
const viewDialog = ref(false);
const viewName = ref("");
const groupDialog = ref(false);
const editingGroup = ref("");
const groupName = ref("");
const groupTables = ref([]);
const feedback = useUiFeedback({ source: "vibe64.database-erd.feedback" });
const defaultEdgeOptions = {
  type: "relationship",
  markerEnd: { height: 16, width: 16, markerUnits: "userSpaceOnUse", type: MarkerType.ArrowClosed }
};
const {
  activeGroup,
  changeColumnMode,
  changeGroupFilter,
  clearSelection,
  clearViewportSave,
  columnMode,
  deleteGroup,
  diagramReady,
  edges,
  fitDiagram,
  focusTable,
  groups,
  layoutError,
  layoutPending,
  locate,
  nodes,
  obstructedCount,
  onEdgeClick,
  onEdgeHover,
  onEdgeLeave,
  onFlowInit,
  onNodeClick,
  onNodeDrag,
  onNodeDragStart,
  onNodeDragStop,
  onViewportMove,
  openFocusRequest,
  rebuild,
  receiveLayout,
  redo,
  redoStack,
  relationships,
  removeView,
  resetPositions,
  restoreView,
  selectedRelationshipId,
  selectedTable,
  setFocus,
  storeGroup,
  storeView,
  tableName,
  tables,
  togglePin,
  undo,
  undoStack,
  views
} = useDatabaseErd({ props, emit, feedback });
defineExpose({ locate });
const tableItems = computed(() => tables.value.map((table) => ({ title: table.name, value: table.qualifiedName })));
const searchMatches = computed(() => erdSearch(tables.value, searchText.value || ""));
const selectedNode = computed(() => nodes.value.find((node) => node.id === selectedTable.value));
const selectedRelationship = computed(() => relationships.value.find((relationship) => relationship.id === selectedRelationshipId.value));
const selectedCardinality = computed(() => selectedRelationship.value ? erdCardinality(selectedRelationship.value,
  tables.value.find((table) => table.qualifiedName === selectedRelationship.value.referencedTable),
  tables.value.find((table) => table.qualifiedName === selectedRelationship.value.sourceTable)) : {});
const incomingCount = computed(() => relationships.value.filter((relationship) => relationship.referencedTable === selectedTable.value).length);
const outgoingCount = computed(() => relationships.value.filter((relationship) => relationship.sourceTable === selectedTable.value).length);
const connectedTables = computed(() => new Set(relationships.value.flatMap((relationship) => [relationship.sourceTable, relationship.referencedTable])));
const disconnectedCount = computed(() => tables.value.filter((table) => !connectedTables.value.has(table.qualifiedName)).length);
const visibleCount = computed(() => nodes.value.filter((node) => !node.hidden).length);
const automaticGroups = computed(() => erdLayoutGroups(nodes.value, relationships.value).filter((group) => group.id.startsWith("erd-auto:")));
const groupItems = computed(() => [
  { title: "All tables", value: "" },
  ...groups.value.map((group) => ({ title: group.name, value: group.id })),
  ...automaticGroups.value.map((group) => ({ title: `Around ${tableName(group.id.slice("erd-auto:".length))} (${group.tables.length} tables)`, value: group.id })),
  { title: "All tables with relationships", value: "erd-related" },
  ...(disconnectedCount.value ? [{ title: "Tables without relationships", value: "erd-disconnected" }] : [])
]);
const matchingView = computed(() => views.value.find((view) => view.name.toLowerCase() === viewName.value.trim().toLowerCase()));

watch([() => props.focusRequest, () => nodes.value.length, layoutPending], ([request, count, pending]) => openFocusRequest(request, count, pending), { flush: "post" });

function editGroup(id = "") {
  optionsOpen.value = false;
  const group = groups.value.find((item) => item.id === id);
  editingGroup.value = group?.id || "";
  groupName.value = group?.name || "";
  groupTables.value = group ? nodes.value.filter((node) => node.data.group === id).map((node) => node.id) : selectedTable.value ? [selectedTable.value] : [];
  groupDialog.value = true;
}
async function saveGroup() {
  if (!groupName.value.trim() || !groupTables.value.length) return;
  groupDialog.value = false;
  await storeGroup(editingGroup.value, groupName.value.trim(), groupTables.value);
}
async function removeGroup() {
  groupDialog.value = false;
  await deleteGroup(editingGroup.value);
}
function saveView() {
  if (!viewName.value.trim() || (!matchingView.value && views.value.length >= 20)) return;
  viewDialog.value = false;
  storeView(viewName.value.trim(), matchingView.value?.id);
}
async function loadView(view) { optionsOpen.value = false; await restoreView(view); }
function onFullscreenChange() {
  fullscreen.value = document.fullscreenElement === erdRoot.value;
  void nextTick().then(() => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(fitDiagram)));
}
async function toggleFullscreen() {
  optionsOpen.value = false;
  try {
    if (fullscreen.value) await document.exitFullscreen();
    else await erdRoot.value.requestFullscreen();
  } catch (error) { feedback.error(error, "The ERD could not change full screen mode."); }
}
function onKeydown(event) {
  if (event.target.closest("input, textarea, [contenteditable=true]")) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) void redo(); else void undo();
  } else if (event.key === "Escape" && !viewDialog.value && !groupDialog.value) clearSelection();
}
// State reloads replace the same snapshot object; only a refreshed schema needs layout work.
watch([() => props.schema.refreshedAt, () => props.schema.database, () => props.schema.engine], () => {
  void rebuild();
});
watch(() => props.layout, receiveLayout);
onMounted(() => {
  fullscreenAvailable.value = hasElementFunction(erdRoot.value, "requestFullscreen");
  document.addEventListener("fullscreenchange", onFullscreenChange);
});
onBeforeUnmount(() => {
  document.removeEventListener("fullscreenchange", onFullscreenChange);
});
</script>

<style>
@import "@vue-flow/core/dist/style.css";
@import "@vue-flow/core/dist/theme-default.css";
@import "@vue-flow/minimap/dist/style.css";
</style>
<style scoped>
.database-erd { container-type: inline-size; display: flex; flex-direction: column; min-height: 0; height: 100%; background: rgb(var(--v-theme-surface)); }
.database-erd__toolbar { display: flex; flex-wrap: nowrap; align-items: center; gap: 8px; padding: 8px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12); }
.database-erd__search { flex: 1; min-width: 0; }
.database-erd__options { display: grid; gap: 12px; padding: 16px; width: min(340px, calc(100vw - 24px)); max-height: 80vh; overflow: auto; }
.database-erd__option-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.database-erd__filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 6px 8px; font-size: 12px; }
.database-erd--fullscreen, .database-erd:fullscreen { width: 100%; height: 100%; }
.database-erd__canvas { position: relative; flex: 1; min-height: 300px; overflow: hidden; background: rgb(var(--v-theme-surface)); }
.database-erd__canvas :deep(.vue-flow) { height: 100%; }
.database-erd__flow { opacity: 0; pointer-events: none; transition: opacity 160ms ease; }
.database-erd__flow--ready { opacity: 1; pointer-events: auto; }
.database-erd__canvas :deep(.vue-flow__edge-text) { fill: rgb(var(--v-theme-on-surface)); font-size: 10px; }
.database-erd__canvas :deep(.vue-flow__edge-textbg) { fill: rgb(var(--v-theme-surface)); }
.database-erd__canvas :deep(.vue-flow__edge) { transition: opacity 100ms ease; }
.database-erd__canvas :deep(.vue-flow__minimap) { background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-on-surface), 0.2); border-radius: 10px; }
.database-erd__canvas :deep(.vue-flow__minimap-mask) { fill: rgba(var(--v-theme-surface), 0.7); }
.database-erd__canvas :deep(.vue-flow__minimap-node) { fill: rgba(var(--v-theme-on-surface), 0.35); }
.database-erd__notice { position: absolute; bottom: 10px; left: 10px; max-width: min(520px, 75%); padding: 8px 12px; background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-on-surface), 0.2); border-radius: 8px; font-size: 12px; }
.database-erd__inspector { position: absolute; top: 10px; right: 10px; width: 290px; max-width: calc(100% - 20px); max-height: calc(100% - 20px); overflow: auto; padding: 14px; font-size: 12px; }
.database-erd__inspector-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.database-erd__inspector-heading strong { overflow-wrap: anywhere; }
.database-erd__constraint { margin: 8px 0; font-weight: 600; overflow-wrap: anywhere; }
.database-erd__mapping { display: grid; gap: 4px; margin: 10px 0; overflow-wrap: anywhere; }
.database-erd__inspector p { margin: 10px 0; }
.database-erd__muted { opacity: 0.7; font-size: 11px; }
.database-erd__inspector dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 12px 0; }
.database-erd__inspector dd { margin: 0; }
.database-erd__inspector-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.database-erd__loading { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 8px; width: max-content; max-width: calc(100% - 32px); color: rgba(var(--v-theme-on-surface), 0.7); font-size: 13px; animation: erd-loading-appear 160ms ease-out 150ms both; }
.database-erd__loading-preview { opacity: 0.35; }
@keyframes erd-loading-appear { from { opacity: 0; } to { opacity: 1; } }
@container (max-width: 600px) {
  .database-erd__canvas { min-height: 0; }
  .database-erd__inspector { top: auto; bottom: 8px; max-height: 45%; }
}
@media (prefers-reduced-motion: reduce) {
  .database-erd__canvas :deep(.vue-flow__edge), .database-erd__flow { transition: none; }
  .database-erd__loading { animation: none; }
}
</style>
