<template>
  <section ref="erdRoot" class="database-erd" :class="{ 'database-erd--fullscreen': fullscreen }" @keydown="onKeydown">
    <header aria-label="ERD controls" class="database-erd__toolbar">
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
        :prepend-inner-icon="mdiMagnify"
        return-object
        variant="outlined"
        @update:model-value="locate"
      />
      <v-btn :disabled="layoutPending || !nodes.length" :icon="mdiImageFilterCenterFocus" aria-label="Fit" title="Fit diagram" size="small" variant="text" @click="fitDiagram" />
      <v-menu v-model="optionsOpen" :attach="erdRoot" :close-on-content-click="false">
        <template #activator="{ props: menuProps }"><v-btn v-bind="menuProps" :icon="mdiTuneVariant" aria-label="Diagram options" title="Diagram options" size="small" variant="text" /></template>
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
            <v-btn :disabled="layoutPending || !nodes.length" :prepend-icon="mdiRestore" size="small" title="Arrange relationships while preserving pinned tables" variant="text" @click="resetPositions">Reset positions</v-btn>
            <v-btn :disabled="layoutPending || !undoStack.length" :icon="mdiUndo" aria-label="Undo diagram change" size="small" variant="text" @click="undo" />
            <v-btn :disabled="layoutPending || !redoStack.length" :icon="mdiRedo" aria-label="Redo diagram change" size="small" variant="text" @click="redo" />
          </div>
          <v-divider />
          <div class="database-erd__option-actions">
            <v-menu :attach="erdRoot">
              <template #activator="{ props: menuProps }"><v-btn v-bind="menuProps" size="small" variant="text">Saved views</v-btn></template>
              <v-list density="compact">
                <v-list-item title="Save view…" @click="optionsOpen = false; viewName = ''; viewDialog = true" />
                <v-list-item v-for="view in views" :key="view.id" :title="view.name" @click="loadView(view)">
                  <template #append><v-btn :icon="mdiClose" :aria-label="'Delete view ' + view.name" size="x-small" variant="text" @click.stop="removeView(view.id)" /></template>
                </v-list-item>
              </v-list>
            </v-menu>
            <v-btn size="small" variant="text" @click="editGroup()">Edit table groups</v-btn>
            <v-btn v-if="fullscreenAvailable" :prepend-icon="fullscreen ? mdiFullscreenExit : mdiFullscreen" size="small" variant="text" @click="toggleFullscreen">{{ fullscreen ? 'Exit full screen' : 'Full screen' }}</v-btn>
          </div>
          <slot name="options" :close="() => optionsOpen = false" />
        </v-sheet>
      </v-menu>
    </header>
    <div v-if="focusTable || activeGroup" class="database-erd__filters">
      <v-chip v-if="activeGroup" size="small" closable @click:close="changeGroupFilter('')">{{ groupItems.find(item => item.value === activeGroup)?.title }}</v-chip>
      <v-chip v-if="focusTable" size="small" closable @click:close="setFocus('')">Focus: {{ tableName(focusTable) }}</v-chip>
      <span>{{ visibleCount }} / {{ nodes.length }} tables</span>
    </div>
    <div class="database-erd__canvas">
      <div v-if="layoutPending && !nodes.length" class="database-erd__loading" role="status" aria-live="polite">
        <v-skeleton-loader class="database-erd__loading-preview" type="heading, text@2" :width="180" color="transparent" boilerplate aria-hidden="true" />
        <span>Preparing diagram…</span>
      </div>
      <VueFlow
        v-else
        v-model:edges="edges"
        v-model:nodes="nodes"
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
        <template #node-table="nodeProps"><DatabaseErdNode v-bind="nodeProps" /></template>
        <template #edge-relationship="edgeProps"><DatabaseErdEdge v-bind="edgeProps" /></template>
        <MiniMap pannable zoomable />
      </VueFlow>
      <div v-if="layoutPending && nodes.length" class="database-erd__notice" role="status">Arranging tables…</div>
      <div v-else-if="layoutError" class="database-erd__notice" role="alert">{{ layoutError }} <v-btn size="x-small" variant="text" @click="rebuild()">Retry</v-btn></div>
      <div v-else-if="obstructedCount" class="database-erd__notice" role="status">Some connections could not be routed around tables. Move tables or focus on a smaller group, then reset positions.</div>
      <v-sheet v-if="selectedRelationship || selectedNode" class="database-erd__inspector" rounded="lg" elevation="2">
        <div class="database-erd__inspector-heading">
          <strong>{{ selectedRelationship ? 'Relationship' : selectedNode.data.table.name }}</strong>
          <v-btn :icon="mdiClose" aria-label="Close diagram details" size="x-small" variant="text" @click="clearSelection" />
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
            <v-btn size="small" :prepend-icon="selectedNode.data.pinned ? mdiPin : mdiPinOutline" variant="text" @click="togglePin(selectedNode.id)">{{ selectedNode.data.pinned ? 'Unpin' : 'Pin position' }}</v-btn>
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
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from "vue";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { mdiClose, mdiFullscreen, mdiFullscreenExit, mdiImageFilterCenterFocus, mdiMagnify, mdiPin, mdiPinOutline, mdiRedo, mdiRestore, mdiTuneVariant, mdiUndo } from "@mdi/js";
import { MarkerType, VueFlow } from "@vue-flow/core";
import { MiniMap } from "@vue-flow/minimap";
import DatabaseErdEdge from "./DatabaseErdEdge.vue";
import DatabaseErdNode from "./DatabaseErdNode.vue";
import { createErdRelationshipRoutes } from "../erdRelationships.js";
import { ERD_NODE_WIDTH, erdCardinality, erdColumns, erdLayoutGroups, erdNeighbours, erdNodeHeight, erdSearch, placeErdNodes } from "../erdModel.js";

const props = defineProps({
  draggable: { type: Boolean, default: true },
  centralTable: { type: String, default: "" },
  layout: { default: () => ({ nodes: [] }), type: Object },
  schema: { default: () => ({ relationships: [], tables: [] }), type: Object }
});
const emit = defineEmits(["save-layout", "select-table", "inspect-table"]);
defineExpose({ locate });
const nodes = ref([]);
const edges = ref([]);
const erdRoot = ref(null);
const optionsOpen = ref(false);
const fullscreen = ref(false);
const fullscreenAvailable = ref(false);
const layoutError = ref("");
const layoutPending = ref(false);
const columnMode = ref(props.layout.columnMode || "keys");
const focusTable = ref(props.layout.focusTable || "");
const activeGroup = ref(props.layout.activeGroup || "");
const groups = ref((props.layout.groups || []).map((group) => ({ ...group })));
const views = ref(JSON.parse(JSON.stringify(props.layout.views || [])));
const undoStack = ref([]);
const redoStack = ref([]);
const selectedTable = ref("");
const selectedRelationshipId = ref("");
const hoveredRelationshipId = ref("");
const searchText = ref("");
const searchChoice = ref(null);
const searchColumn = ref("");
const viewDialog = ref(false);
const viewName = ref("");
const groupDialog = ref(false);
const editingGroup = ref("");
const groupName = ref("");
const groupTables = ref([]);
const obstructedCount = ref(0);
const feedback = useUiFeedback({ source: "vibe64.database-erd.feedback" });
const defaultEdgeOptions = {
  type: "relationship",
  markerEnd: { height: 16, width: 16, markerUnits: "userSpaceOnUse", type: MarkerType.ArrowClosed }
};
// Schema refreshes replace the snapshot; its metadata is immutable between reads.
const relationships = computed(() => toRaw(props.schema.relationships || []));
const tables = computed(() => toRaw(props.schema.tables || []));
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
let flow = null;
let layoutWorker = null;
let layoutRequestId = 0;
let rebuildId = 0;
let graphRefreshId = 0;
let routingPromise = null;
let relationshipDragFrame = null;
let routes = [];
let storedNodes = props.layout.nodes || [];
let draggingSnapshot = null;
let pendingRemoteLayout = null;
let appliedLayoutRevision = props.layout.revision || 0;
let disposed = false;
let viewportSaveTimer = null;
const layoutResolvers = new Map();

function tableName(id) { return tables.value.find((table) => table.qualifiedName === id)?.name || id; }
function snapshot() {
  return {
    nodes: nodes.value.map((node) => ({ table: node.id, x: node.position.x, y: node.position.y, collapsed: node.data.collapsed, expanded: node.data.expanded, pinned: node.data.pinned, group: node.data.group, hidden: false })),
    columnMode: columnMode.value, focusTable: focusTable.value, activeGroup: activeGroup.value,
    groups: groups.value.map((group) => ({ ...group })),
    viewport: { ...(flow?.getViewport?.() || { x: 0, y: 0, zoom: 1 }) }
  };
}
function checkpoint() {
  undoStack.value = [...undoStack.value, snapshot()].slice(-30);
  redoStack.value = [];
}
function clearViewportSave() { clearTimeout(viewportSaveTimer); viewportSaveTimer = null; }
function persistPositions() { clearViewportSave(); emit("save-layout", { ...snapshot(), views: views.value }); }
function buildNodes(saved = storedNodes) {
  const records = new Map(saved.map((node) => [node.table, node]));
  const memberships = new Map(erdLayoutGroups(tables.value.map((table) => ({ id: table.qualifiedName, data: { table, group: records.get(table.qualifiedName)?.group } })), relationships.value)
    .flatMap((group) => group.tables.map((id) => [id, group])));
  return tables.value.map((table) => {
    const record = records.get(table.qualifiedName) || {};
    const columns = erdColumns(table, relationships.value, columnMode.value, record.expanded);
    const group = record.group || "";
    return {
      id: table.qualifiedName, type: "table", draggable: props.draggable && !record.pinned,
      position: { x: record.x || 0, y: record.y || 0 },
      dimensions: { width: ERD_NODE_WIDTH, height: erdNodeHeight(columns, record.collapsed) },
      data: {
        table: markRaw(table), columns: markRaw(columns), group, collapsed: record.collapsed === true, expanded: record.expanded === true, pinned: record.pinned === true,
        columnMode: columnMode.value, keyColumnCount: erdColumns(table, relationships.value).length,
        primaryColumns: new Set((table.keys || []).filter((key) => key.primary).flatMap((key) => key.columns)),
        uniqueColumns: new Set((table.keys || []).flatMap((key) => key.columns)),
        foreignColumns: new Set(relationships.value.filter((relationship) => relationship.sourceTable === table.qualifiedName).flatMap((relationship) => relationship.columns)),
        layoutGroup: memberships.get(table.qualifiedName)?.id,
        groupName: groups.value.find((item) => item.id === group)?.name || memberships.get(table.qualifiedName)?.name,
        onToggle: toggleNode, onExpand: expandNode, onPin: togglePin
      }
    };
  });
}
function applyVisibility() {
  const neighbours = erdNeighbours(focusTable.value, relationships.value);
  nodes.value = nodes.value.map((node) => {
    const matchesGroup = !activeGroup.value || activeGroup.value === node.data.layoutGroup ||
      (activeGroup.value === "erd-related" && connectedTables.value.has(node.id));
    return { ...node, hidden: Boolean((focusTable.value && !neighbours.has(node.id)) || !matchesGroup) };
  });
}
function emphasize() {
  const selectedRoutes = routes.filter((route) => selectedRelationshipId.value ? route.relationshipId === selectedRelationshipId.value :
    selectedTable.value && (route.source === selectedTable.value || route.target === selectedTable.value));
  const selectedTables = new Set(selectedRoutes.flatMap((route) => [route.source, route.target]));
  if (selectedTable.value) selectedTables.add(selectedTable.value);
  const highlighted = hoveredRelationshipId.value ? routes.filter((route) =>
    route.relationshipId === hoveredRelationshipId.value || selectedRoutes.includes(route)) : selectedRoutes;
  const highlightedIds = new Set(highlighted.map((route) => route.id));
  const hasSelection = Boolean(selectedRelationshipId.value || selectedTable.value);
  const columnsByTable = new Map();
  for (const route of highlighted) {
    for (const [table, column] of [[route.source, route.sourceColumn], [route.target, route.targetColumn]]) {
      if (!columnsByTable.has(table)) columnsByTable.set(table, []);
      if (column) columnsByTable.get(table).push(column);
    }
  }
  // Preserve graph identities: replacing the arrays makes Vue Flow parse every
  // table and connection again for each pointer crossing.
  for (const node of nodes.value) {
    const columns = columnsByTable.get(node.id) || [];
    if (node.id === selectedTable.value && searchColumn.value) columns.push(searchColumn.value);
    node.data.highlighted = node.id === selectedTable.value || columnsByTable.has(node.id);
    node.data.dimmed = hasSelection && !selectedTables.has(node.id);
    const previous = node.data.highlightedColumns || [];
    if (previous.length !== columns.length || previous.some((column, index) => column !== columns[index])) node.data.highlightedColumns = columns;
  }
  for (const edge of edges.value) {
    const active = highlightedIds.has(edge.id);
    edge.selected = edge.data.relationshipId === selectedRelationshipId.value;
    edge.data.emphasized = active;
    edge.style ||= { stroke: "rgb(var(--v-theme-primary))", strokeDasharray: edge.data.cardinality.optional ? "6 3" : undefined, strokeLinejoin: "round" };
    edge.style.strokeWidth = active ? 2.4 : 1.6;
    edge.style.strokeOpacity = hasSelection && !active ? 0.12 : 0.85;
  }
}
async function refreshGraph({ dragging = false, reset = false, layoutPaths = new Map() } = {}) {
  const request = ++graphRefreshId;
  applyVisibility();
  // Coalesce drag/visibility updates while the worker is routing. Only the most
  // recent graph may replace the current one, including after a remote restore.
  if (routingPromise) await routingPromise.catch(() => {});
  if (disposed || request !== graphRefreshId) return false;
  // Keep component callbacks and Vue's reactive proxies out of the worker payload.
  const routingNodes = nodes.value.filter((node) => !node.hidden).map((node) => ({
    id: node.id, position: node.position, dimensions: node.dimensions,
    data: { table: node.data.table, columns: node.data.columns, collapsed: node.data.collapsed }
  }));
  const operation = requestWorker({
    kind: "routes",
    nodes: JSON.parse(JSON.stringify(routingNodes)),
    relationships: JSON.parse(JSON.stringify(relationships.value)),
    options: { previousRoutes: reset ? [] : routes, dragging, fixedSides: reset, layoutPaths }
  });
  routingPromise = operation;
  let graph;
  try {
    graph = await operation;
  } catch (error) {
    if (!disposed && request === graphRefreshId) layoutError.value = error.message || "The ERD connections could not be drawn.";
    return false;
  } finally {
    if (routingPromise === operation) routingPromise = null;
  }
  if (disposed || request !== graphRefreshId) return false;
  layoutError.value = "";
  routes = graph.routes;
  nodes.value = nodes.value.map((node) => ({ ...node, data: { ...node.data, relationshipPorts: graph.portsByNode.get(node.id) || [] } }));
  edges.value = routes.map((route) => ({
    id: route.id, type: "relationship", source: route.source, target: route.target,
    sourceHandle: route.sourceHandle, targetHandle: route.targetHandle,
    ariaLabel: `${tableName(route.source)}.${route.sourceColumn || "(collapsed)"} → ${tableName(route.target)}.${route.targetColumn || "(collapsed)"}; ${route.cardinality.parent} parent(s) per child; ${route.cardinality.child} children per parent; ${route.relationship.constraintName}`,
    data: { relationshipId: route.relationshipId, points: route.points, cardinality: route.cardinality }
  }));
  obstructedCount.value = routes.filter((route) => route.obstructed).length;
  emphasize();
  await nextTick();
  if (disposed || request !== graphRefreshId) return false;
  flow?.updateNodeInternals?.(nodes.value.filter((node) => !node.hidden).map((node) => node.id));
  return true;
}
function requestWorker(payload) {
  const id = ++layoutRequestId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { layoutResolvers.delete(id); reject(new Error("The layout worker timed out.")); }, 15000);
    layoutResolvers.set(id, { resolve, reject, timeout });
    layoutWorker.postMessage({ ...payload, id });
  });
}
async function rebuild({ force = false } = {}) {
  if (!layoutWorker) return;
  const request = ++rebuildId;
  graphRefreshId += 1;
  layoutPending.value = true;
  layoutError.value = "";
  const saved = nodes.value.length ? snapshot().nodes : storedNodes;
  const initialViewport = !nodes.value.length && saved.length ? props.layout.viewport : null;
  try {
    const sourceNodes = buildNodes(saved);
    const savedTables = new Set(saved.map((node) => node.table));
    const needsSave = force || sourceNodes.some((node) => !savedTables.has(node.id));
    const graph = createErdRelationshipRoutes(sourceNodes, relationships.value, { fixedSides: true, calculatePaths: false });
    const layout = await requestWorker({
      nodes: sourceNodes.map((node) => ({ id: node.id, ...node.dimensions, ports: graph.portsByNode.get(node.id) })),
      edges: graph.routes.map((route) => ({ id: route.id, source: route.source, target: route.target, sourceHandle: route.sourceHandle, targetHandle: route.targetHandle })),
      centralTable: props.centralTable,
      groups: erdLayoutGroups(sourceNodes, relationships.value)
    });
    if (disposed || request !== rebuildId) return;
    nodes.value = placeErdNodes(sourceNodes, layout.nodes, saved, force);
    if (!await refreshGraph({ reset: true, layoutPaths: new Map(layout.paths.map((path) => [path.id, path.points])) })) return;
    if (!await updateViewport(initialViewport)) return;
    if (needsSave) persistPositions();
    if (layout.fallback) feedback.error(new Error("The recommended layout was unavailable; a basic arrangement was used."), "Layout needs attention.");
  } catch (error) {
    if (request === rebuildId) layoutError.value = error.message || "The ERD could not be arranged.";
  } finally {
    if (request === rebuildId) layoutPending.value = false;
  }
}
async function restore(state, { remote = false } = {}) {
  const request = ++rebuildId;
  layoutPending.value = true;
  columnMode.value = state.columnMode || "keys";
  focusTable.value = state.focusTable || "";
  activeGroup.value = state.activeGroup || "";
  groups.value = (state.groups || []).map((group) => ({ ...group }));
  if (remote) {
    views.value = JSON.parse(JSON.stringify(state.views || []));
  } else {
    selectedTable.value = "";
    selectedRelationshipId.value = "";
    hoveredRelationshipId.value = "";
  }
  nodes.value = buildNodes(state.nodes);
  try {
    if (!await refreshGraph({ reset: true })) return false;
    if (!remote) {
      if (!await updateViewport(state.viewport)) return false;
      persistPositions();
    }
    return true;
  } finally {
    // An older restore cannot unlock a newer restore or arrangement.
    if (request === rebuildId) layoutPending.value = false;
  }
}
async function undo() {
  if (!undoStack.value.length || layoutPending.value) return;
  redoStack.value.push(snapshot());
  await restore(undoStack.value.pop());
}
async function redo() {
  if (!redoStack.value.length || layoutPending.value) return;
  undoStack.value.push(snapshot());
  await restore(redoStack.value.pop());
}
async function changeColumnMode(mode) {
  if (mode === columnMode.value || layoutPending.value) return;
  checkpoint();
  columnMode.value = mode;
  const saved = snapshot().nodes.map((node) => ({ ...node, expanded: false }));
  nodes.value = buildNodes(saved);
  if (!await refreshGraph()) return;
  persistPositions();
}
async function changeNode(id, changes) {
  checkpoint();
  const saved = snapshot().nodes.map((node) => node.table === id ? { ...node, ...changes } : node);
  nodes.value = buildNodes(saved);
  if (!await refreshGraph()) return;
  persistPositions();
}
function toggleNode(id) { return changeNode(id, { collapsed: !nodes.value.find((node) => node.id === id).data.collapsed }); }
function expandNode(id) { return changeNode(id, { expanded: !nodes.value.find((node) => node.id === id).data.expanded }); }
function togglePin(id) { return changeNode(id, { pinned: !nodes.value.find((node) => node.id === id).data.pinned }); }
function onNodeDragStart() { draggingSnapshot = snapshot(); }
function onNodeDrag() {
  if (relationshipDragFrame !== null) return;
  relationshipDragFrame = globalThis.requestAnimationFrame(() => {
    relationshipDragFrame = null;
    void refreshGraph({ dragging: true });
  });
}
async function onNodeDragStop() {
  if (relationshipDragFrame !== null) globalThis.cancelAnimationFrame(relationshipDragFrame);
  relationshipDragFrame = null;
  const beforeDrag = draggingSnapshot;
  if (beforeDrag) {
    undoStack.value = [...undoStack.value, beforeDrag].slice(-30);
    redoStack.value = [];
    draggingSnapshot = null;
  }
  if (pendingRemoteLayout) {
    // Keep this drag without reverting tables moved by another viewer during it.
    const previous = new Map(beforeDrag.nodes.map((node) => [node.table, node]));
    const moved = new Map(snapshot().nodes.filter((node) => {
      const before = previous.get(node.table);
      return before && (node.x !== before.x || node.y !== before.y);
    }).map((node) => [node.table, node]));
    const shared = pendingRemoteLayout;
    pendingRemoteLayout = null;
    const mergedNodes = shared.nodes.map((node) => {
      const position = moved.get(node.table);
      return position ? { ...node, x: position.x, y: position.y } : node;
    });
    if (!await restore({ ...shared, nodes: mergedNodes }, { remote: true })) return;
  }
  if (!await refreshGraph()) return;
  persistPositions();
}
function onNodeClick({ node }) { selectedTable.value = node.id; emit("inspect-table", node.id); selectedRelationshipId.value = ""; hoveredRelationshipId.value = ""; searchColumn.value = ""; emphasize(); }
function onEdgeClick({ edge }) { selectedRelationshipId.value = edge.data.relationshipId; selectedTable.value = ""; emphasize(); }
function onEdgeHover({ edge }) { hoveredRelationshipId.value = edge.data.relationshipId; emphasize(); }
function onEdgeLeave() { hoveredRelationshipId.value = ""; emphasize(); }
function clearSelection() { selectedTable.value = ""; selectedRelationshipId.value = ""; hoveredRelationshipId.value = ""; searchColumn.value = ""; emphasize(); }
async function setFocus(id) {
  checkpoint();
  focusTable.value = id;
  activeGroup.value = "";
  clearSelection();
  if (!await refreshGraph()) return;
  if (!await fitDiagram()) return;
  persistPositions();
}
async function changeGroupFilter(id) {
  checkpoint();
  activeGroup.value = id;
  focusTable.value = "";
  clearSelection();
  if (!await refreshGraph()) return;
  if (!await fitDiagram()) return;
  persistPositions();
}
async function locate(item) {
  if (!item || layoutPending.value || !nodes.value.length) return;
  checkpoint();
  focusTable.value = "";
  activeGroup.value = "";
  selectedRelationshipId.value = "";
  hoveredRelationshipId.value = "";
  selectedTable.value = item.table;
  emit("inspect-table", item.table);
  searchColumn.value = item.column;
  const saved = snapshot().nodes.map((node) => node.table === item.table ? { ...node, collapsed: false, expanded: Boolean(item.column) || node.expanded } : node);
  nodes.value = placeErdNodes(buildNodes(saved), [], saved);
  if (!await refreshGraph()) return;
  const request = graphRefreshId;
  await flow?.fitView?.({ nodes: [item.table], maxZoom: 1.2, padding: 0.5, duration: 220 });
  if (disposed || request !== graphRefreshId) return;
  persistPositions();
}
async function resetPositions() { checkpoint(); await rebuild({ force: true }); }
async function updateViewport(viewport) {
  const request = graphRefreshId;
  await nextTick();
  await new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)));
  if (disposed || request !== graphRefreshId) return false;
  if (viewport) await flow?.setViewport?.(viewport, { duration: 180 });
  else await flow?.fitView?.({ nodes: nodes.value.filter((node) => !node.hidden).map((node) => node.id), duration: 220, padding: 0.18 });
  return !disposed && request === graphRefreshId;
}
function fitDiagram() { return updateViewport(); }
function onFlowInit(instance) { flow = instance; }
function onViewportMove() {
  clearViewportSave();
  if (layoutPending.value || draggingSnapshot || !nodes.value.length) return;
  // A wheel gesture ends after a short pause. Save the camera once it settles,
  // instead of triggering a shared-state reload between successive wheel ticks.
  viewportSaveTimer = setTimeout(() => {
    viewportSaveTimer = null;
    if (!disposed && !layoutPending.value && !draggingSnapshot) persistPositions();
  }, 600);
}
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
  checkpoint();
  const existing = groups.value.find((group) => group.name.toLowerCase() === groupName.value.trim().toLowerCase());
  const id = editingGroup.value || existing?.id || crypto.randomUUID();
  groups.value = [...groups.value.filter((group) => group.id !== id), { id, name: groupName.value.trim() }];
  const members = new Set(groupTables.value);
  const saved = snapshot().nodes.map((node) => ({ ...node, group: members.has(node.table) ? id : node.group === id ? "" : node.group }));
  nodes.value = buildNodes(saved);
  activeGroup.value = id;
  focusTable.value = "";
  clearSelection();
  groupDialog.value = false;
  await rebuild({ force: true });
}
async function removeGroup() {
  checkpoint();
  const id = editingGroup.value;
  groups.value = groups.value.filter((group) => group.id !== id);
  if (activeGroup.value === id) activeGroup.value = "";
  const saved = snapshot().nodes.map((node) => ({ ...node, group: node.group === id ? "" : node.group }));
  nodes.value = buildNodes(saved);
  groupDialog.value = false;
  await rebuild({ force: true });
}
function saveView() {
  if (!viewName.value.trim() || (!matchingView.value && views.value.length >= 20)) return;
  const id = matchingView.value?.id || crypto.randomUUID();
  const view = { ...snapshot(), id, name: viewName.value.trim() };
  views.value = [...views.value.filter((item) => item.id !== id), view];
  viewDialog.value = false;
  persistPositions();
}
async function loadView(view) { optionsOpen.value = false; checkpoint(); await restore(view); }
function removeView(id) { views.value = views.value.filter((view) => view.id !== id); persistPositions(); }
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
watch(() => props.schema, () => { if (layoutWorker) void rebuild(); });
watch(() => props.layout, (layout) => {
  if (!layout.revision || layout.revision <= appliedLayoutRevision) return;
  appliedLayoutRevision = layout.revision;
  const current = snapshot();
  // Acknowledging our own save (or changing only named views) does not change
  // the graph. Rebuilding it would disable controls and repeat dense routing.
  if (["columnMode", "focusTable", "activeGroup"].every((key) => layout[key] === current[key]) &&
      JSON.stringify(layout.groups) === JSON.stringify(current.groups) &&
      layout.nodes.length === current.nodes.length && layout.nodes.every((node, index) =>
        Object.entries(current.nodes[index]).every(([key, value]) => node[key] === value))) {
    views.value = JSON.parse(JSON.stringify(layout.views || []));
    pendingRemoteLayout = null;
    return;
  }
  if (draggingSnapshot) {
    pendingRemoteLayout = layout;
  } else if (layoutWorker) {
    void restore(layout, { remote: true });
  }
});
onMounted(() => {
  fullscreenAvailable.value = typeof erdRoot.value?.requestFullscreen === "function";
  document.addEventListener("fullscreenchange", onFullscreenChange);
  layoutWorker = new Worker(new URL("../workers/erdLayout.worker.js", import.meta.url), { type: "module" });
  layoutWorker.addEventListener("message", ({ data }) => {
    const resolver = layoutResolvers.get(data.id);
    if (!resolver) return;
    layoutResolvers.delete(data.id);
    clearTimeout(resolver.timeout);
    if (data.ok === false) resolver.reject(new Error(data.error));
    else resolver.resolve(data);
  });
  layoutWorker.addEventListener("error", (event) => {
    for (const resolver of layoutResolvers.values()) { clearTimeout(resolver.timeout); resolver.reject(new Error(event.message || "The layout worker failed.")); }
    layoutResolvers.clear();
  });
  void rebuild();
});
onBeforeUnmount(() => {
  clearViewportSave();
  disposed = true;
  rebuildId += 1;
  graphRefreshId += 1;
  if (relationshipDragFrame !== null) globalThis.cancelAnimationFrame(relationshipDragFrame);
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  for (const resolver of layoutResolvers.values()) { clearTimeout(resolver.timeout); resolver.reject(new Error("ERD closed.")); }
  layoutResolvers.clear();
  layoutWorker?.terminate();
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
  .database-erd__canvas :deep(.vue-flow__edge) { transition: none; }
  .database-erd__loading { animation: none; }
}
</style>
