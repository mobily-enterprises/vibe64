<template>
  <section class="database-overview" @keydown.esc="closeActor">
    <header v-show="!activeGroup" class="database-overview__toolbar" aria-label="Data overview controls">
      <div class="database-overview__title"><strong>Data overview</strong><span>{{ graph.coverage.classified }} / {{ graph.coverage.total }} tables classified</span></div>
      <v-btn v-if="!overview.present" :disabled="!assistantAvailable" size="small" variant="tonal" @click="openGeneration">Create with AI</v-btn>
      <v-btn :icon="mdiImageFilterCenterFocus" size="small" variant="text" aria-label="Fit" title="Fit overview" @click="fit" />
      <v-menu v-model="overviewOptions" :close-on-content-click="false">
        <template #activator="{ props: menuProps }"><v-btn v-bind="menuProps" :icon="mdiTuneVariant" size="small" variant="text" aria-label="Overview options" title="Overview options" /></template>
        <v-sheet class="database-overview__options" rounded="lg" elevation="2" aria-label="Overview options">
          <span>Not yet reviewed: {{ graph.coverage.unreviewed.length }}</span>
          <v-switch v-if="overview.definition.mainRelationships" v-model="allRelationships" density="compact" hide-details label="All connections" />
          <small v-else-if="overview.present">Showing all connections. Review with AI to select the main ones.</small>
          <div class="database-overview__option-actions">
            <v-btn size="small" variant="text" aria-label="Zoom in" @click="flow?.zoomIn()">Zoom in</v-btn>
            <v-btn size="small" variant="text" aria-label="Zoom out" @click="flow?.zoomOut()">Zoom out</v-btn>
          </div>
          <v-btn :disabled="savingPosition || pending" size="small" variant="text" @click="savePositions({})">Reset actor positions</v-btn>
          <v-divider />
          <v-btn :disabled="savingPosition" size="small" variant="text" @click="openEditor">Edit actors</v-btn>
          <v-btn :disabled="!assistantAvailable" size="small" variant="tonal" @click="openGeneration">{{ overview.present ? 'Review with AI' : 'Create with AI' }}</v-btn>
          <v-btn :disabled="savingPosition" size="small" variant="text" @click="emit('reload')">Reload overview</v-btn>
          <small>Drag a concept to move it. Drag empty space to pan; scroll to zoom.</small>
        </v-sheet>
      </v-menu>
    </header>
    <p v-if="overview.error" class="database-overview__warning" role="alert">{{ overview.error }} Your tables remain available under Other tables. Repair {{ DATA_OVERVIEW_PATH }} or edit the actors.</p>
    <p v-else-if="!overview.present" class="database-overview__hint">Choose the main actors with AI or Edit actors. Supporting tables can belong together across several relationships.</p>
    <p v-if="graph.coverage.missing.length" class="database-overview__warning" role="alert">Missing from the refreshed schema: {{ graph.coverage.missing.join(', ') }}. Review the grouping after renaming or removing tables.</p>
    <p v-if="graph.coverage.missingRelationships.length" class="database-overview__warning" role="alert">{{ graph.coverage.missingRelationships.length }} main connections are missing from the refreshed schema. Review with AI or repair {{ DATA_OVERVIEW_PATH }}.</p>
    <div class="database-overview__canvas">
      <div class="database-overview__map" :class="{ 'database-overview__map--faded': activeGroup }" :inert="activeGroup ? true : undefined">
        <VueFlow
          v-model:nodes="nodes" v-model:edges="edges" :min-zoom="0.01" :max-zoom="1.5" :nodes-connectable="false" :edges-updatable="false" :node-drag-threshold="4"
          @node-drag-start="startActorDrag" @node-drag-stop="finishActorDrag"
          @init="flow = $event" @node-click="openActor($event.node.data.group)" @edge-click="selection = $event.edge.data.relationships" @pane-click="selection = null"
        >
          <template #node-actor="{ data }">
            <article class="database-overview__actor" :style="{ width: data.width + 'px', height: data.height + 'px' }">
              <template v-for="side in Object.values(Position)" :key="side">
                <Handle :id="`in-${side}`" type="target" :position="side" :style="side === 'left' || side === 'right' ? { top: '32px' } : {}" />
                <Handle :id="`out-${side}`" type="source" :position="side" :style="side === 'left' || side === 'right' ? { top: '32px' } : {}" />
              </template>
              <header>
                <strong :title="data.group.name">{{ data.group.name }}</strong>
                <v-btn class="nodrag" size="small" variant="tonal" :aria-label="'Explore ' + data.group.name" @click.stop="openActor(data.group)">Explore</v-btn>
              </header>
              <p :title="data.group.description">{{ data.group.description }}</p>
              <small>{{ data.count }} tables<span v-if="data.group.missing.length"> · {{ data.group.missing.length }} missing</span></small>
            </article>
          </template>
          <template #edge-overview="edgeProps"><DatabaseOverviewEdge v-bind="edgeProps" /></template>
        </VueFlow>
      </div>
      <span v-if="pending" class="database-overview__status" role="status">Arranging actors…</span>
      <span v-else-if="layoutError" class="database-overview__status" role="alert">{{ layoutError }} <v-btn size="small" @click="arrange">Retry</v-btn></span>
      <span v-if="!graph.groups.length" class="database-overview__status">No tables in the refreshed schema.</span>
      <aside v-if="selection" class="database-overview__inspector" aria-label="Overview details">
        <v-btn class="database-overview__close" size="small" variant="text" aria-label="Close overview details" @click="selection = null">Close</v-btn>
        <strong>Actual relationships</strong>
        <p>Cardinalities describe these tables, including when their actor is collapsed.</p>
        <section v-for="relationship in selection" :key="relationship.id" class="database-overview__relationship">
          <strong>{{ relationship.constraintName || relationship.id }}</strong>
          <p>{{ relationship.referencedTable }} ({{ relationship.cardinality.parent }}) → {{ relationship.sourceTable }} ({{ relationship.cardinality.child }})</p>
          <p v-for="(column, index) in relationship.columns" :key="column">{{ relationship.referencedColumns[index] }} ← {{ column }}</p>
          <small>On delete: {{ relationship.deleteAction || 'unspecified' }} · On update: {{ relationship.updateAction || 'unspecified' }}</small>
        </section>
      </aside>
      <template v-if="activeGroup">
        <button class="database-overview__backdrop" aria-label="Close expanded actor" @click="closeActor" />
        <section class="database-overview__detail" :aria-label="`ERD for ${activeGroup.name}`">
          <header class="database-overview__detail-header">
            <strong>{{ activeGroup.name }}</strong><small>{{ actorSchema.tables.length }} tables</small>
            <v-btn ref="closeButton" :icon="mdiClose" aria-label="Close details" title="Back to overview" size="small" variant="text" @click="closeActor" />
          </header>
          <aside class="database-overview__tables" aria-label="Actor tables and fields">
            <v-text-field v-model="tableSearch" label="Find tables" clearable density="compact" hide-details />
            <DatabaseTableList interactive-columns :schema="actorSchema" :selected-table-name="selectedTableName" :search="tableSearch" @select-table="locateTable" @select-column="locateColumn" />
          </aside>
          <DatabaseErd :key="activeGroup.id" ref="actorErd" :schema="actorSchema" :central-table="activeGroup.table" :layout="actorLayouts[activeGroup.id]" :draggable="false" @save-layout="actorLayouts[activeGroup.id] = $event" @inspect-table="selectedTableName = $event" @select-table="emit('select-table', $event)">
            <template #options="{ close }">
              <v-divider />
              <strong>Overview concept</strong>
              <v-btn v-if="activeGroup.table" size="small" variant="text" @click="close(); editActor(activeGroup.table)">Edit or merge actor</v-btn>
              <v-btn v-if="selectedPhysicalTable && !overview.definition.actors.some(actor => actor.table === selectedTableName)" size="small" variant="text" @click="close(); promoteTable(selectedPhysicalTable)">Make main actor</v-btn>
            </template>
          </DatabaseErd>
        </section>
      </template>
    </div>
    <v-dialog v-model="generation" max-width="560">
      <v-card title="Generate data overview">
        <v-card-text>
          <v-select v-model="abstraction" :items="DATA_OVERVIEW_ABSTRACTIONS" label="Abstraction" />
          <p>{{ DATA_OVERVIEW_ABSTRACTIONS.find((item) => item.value === abstraction)?.description }}</p>
          <v-radio-group v-model="generationScope" label="Tables to review">
            <v-radio value="new" :disabled="!graph.coverage.unreviewed.length" :label="`Process new tables only (${graph.coverage.unreviewed.length})`" />
            <v-radio value="all" label="Regenerate everything" />
          </v-radio-group>
          <p>{{ generationScope === 'new' ? 'Keeps your existing actors and adjustments. Tables deliberately left in Other tables count as reviewed.' : 'Replaces the existing grouping, including manual adjustments. Your database is unchanged.' }}</p>
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn @click="generation = false">Cancel</v-btn><v-btn variant="tonal" @click="generate">Generate overview</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="editor" max-width="760" :persistent="saving">
      <v-card title="Edit main actors">
        <v-card-text>
          <p>Group supporting tables at any depth. Tables without a group appear under Other tables. Shared concepts can be their own actor.</p>
          <v-select v-model="editing" :items="draftActors.map((actor, index) => ({ title: actor.name || 'New actor', value: index }))" label="Actor" hide-details />
          <div class="database-overview__editor-actions"><v-btn size="small" @click="addActor">Add actor</v-btn><v-btn v-if="draft" size="small" @click="removeActor">Remove actor</v-btn></div>
          <template v-if="draft">
            <v-text-field v-model="draft.name" label="Name" maxlength="120" />
            <v-autocomplete v-model="draft.table" :items="availableTables" label="Main table" @update:model-value="includeMainTable" />
            <v-textarea v-model="draft.description" label="What this actor contains" maxlength="600" rows="2" />
            <v-autocomplete v-model="draft.tables" :items="availableTables" label="Included tables" multiple chips closable-chips @update:model-value="includeMainTable" />
            <template v-if="draftActors.length > 1">
              <v-select v-model="mergeTarget" :items="draftActors.flatMap((actor, index) => index === editing ? [] : [{ title: actor.name, value: actor.table }])" label="Merge into another actor" clearable />
              <v-btn size="small" :disabled="!mergeTarget" @click="mergeActor">Merge actor and its tables</v-btn>
            </template>
          </template>
          <p v-if="editorError" role="alert" class="database-overview__warning">{{ editorError }}</p>
          <small>Saved in {{ DATA_OVERVIEW_PATH }} with the project source. Database tables and records are unchanged.</small>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="saving" @click="editor = false">Cancel</v-btn>
          <v-btn :disabled="saving" min-width="108" @click="save">{{ saving ? 'Saving…' : 'Save actors' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { mdiClose, mdiImageFilterCenterFocus, mdiTuneVariant } from "@mdi/js";
import { Handle, Position, VueFlow } from "@vue-flow/core";
import DatabaseErd from "./DatabaseErd.vue";
import DatabaseTableList from "./DatabaseTableList.vue";
import DatabaseOverviewEdge from "./DatabaseOverviewEdge.vue";
import { dataOverviewGraph } from "../dataOverviewModel.js";
import { DATA_OVERVIEW_ABSTRACTIONS, DATA_OVERVIEW_PATH, validateDataOverview } from "../../shared/dataOverview.js";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";

const props = defineProps({
  schema: { type: Object, required: true },
  overview: { type: Object, required: true },
  assistantAvailable: { type: Boolean, default: true },
  saveOverview: { type: Function, required: true }
});
const emit = defineEmits(["reload", "request-assistant", "select-table"]);
const feedback = useUiFeedback({ source: "vibe64.database-overview.feedback" });
const overviewOptions = ref(false);
const allRelationships = ref(false);
const graph = computed(() => dataOverviewGraph(props.schema, props.overview.definition, { allRelationships: allRelationships.value }));
const activeGroupId = ref("");
const activeGroup = computed(() => graph.value.groups.find((group) => group.id === activeGroupId.value));
const actorSchema = computed(() => {
  const members = new Set(activeGroup.value?.tables || []);
  return { ...props.schema, tables: props.schema.tables.filter((table) => members.has(table.qualifiedName)),
    relationships: (props.schema.relationships || []).filter((relationship) => members.has(relationship.sourceTable) || members.has(relationship.referencedTable)) };
});
const actorErd = ref(null);
const actorLayouts = ref({});
const closeButton = ref(null);
const tableSearch = ref("");
const selectedTableName = ref("");
const selectedPhysicalTable = computed(() => actorSchema.value.tables.find(table => table.qualifiedName === selectedTableName.value));
const savingPosition = ref(false);
let dragging = false;
let positionBase;
let localPositions;
let queuedPositions;
let returnFocus;
const nodes = ref([]);
const edges = ref([]);
const flow = ref(null);
const pending = ref(false);
const layoutError = ref("");
const selection = ref(null);
const editor = ref(false);
const editorError = ref("");
const saving = ref(false);
const generation = ref(false);
const abstraction = ref("balanced");
const generationScope = ref("all");
const mergeTarget = ref(null);
const draftActors = ref([]);
const editing = ref(0);
const draft = computed(() => draftActors.value[editing.value]);
const availableTables = computed(() => {
  const assigned = new Set(draftActors.value.filter((_, index) => index !== editing.value).flatMap((actor) => actor.tables));
  return [...new Set([...(props.schema.tables || []).map((table) => table.qualifiedName), ...(draft.value?.tables || [])])].filter((id) => !assigned.has(id));
});
let baseHash = "";
let baseDefinition;
let worker;
let layoutGraph;
let requestId = 0;
let timer;
let disposed = false;

async function openActor(group) {
  if (dragging) return;
  returnFocus = document.activeElement;
  selection.value = null;
  tableSearch.value = "";
  selectedTableName.value = group.table;
  activeGroupId.value = group.id;
  await nextTick();
  closeButton.value?.$el?.focus();
}
function closeActor(event) {
  if (!activeGroup.value || editor.value || generation.value || event?.defaultPrevented) return;
  activeGroupId.value = "";
  void nextTick(() => returnFocus?.focus?.());
}
function locateTable(table) {
  selectedTableName.value = table.qualifiedName;
  void actorErd.value?.locate({ table: table.qualifiedName, column: "" });
}
function locateColumn(column) {
  void actorErd.value?.locate({ table: selectedTableName.value, column: column.name });
}
async function fit({ automatic = false } = {}) {
  const current = requestId;
  await nextTick();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (!disposed && current === requestId && !activeGroup.value) await flow.value?.fitView({
    padding: 0.15, maxZoom: 1, minZoom: automatic ? 0.5 : 0.01, duration: 0
  });
}
function arrange() {
  if (dragging || !worker || disposed) return;
  const id = ++requestId;
  clearTimeout(timer);
  layoutError.value = "";
  selection.value = null;
  layoutGraph = graph.value;
  pending.value = layoutGraph.nodes.length > 0;
  if (!pending.value) { nodes.value = []; edges.value = []; return; }
  const positions = localPositions || props.overview.definition.positions;
  worker.postMessage({
    id,
    kind: "overview",
    nodes: layoutGraph.nodes.map((node) => ({ id: node.id, count: node.data.count, ...node.dimensions })),
    overviewPositions: positions ? JSON.parse(JSON.stringify(positions)) : undefined,
    overviewRings: props.overview.definition.rings?.map((ring) => ring.map((table) => `actor:${table}`)),
    visibleEdges: layoutGraph.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }))
  });
  timer = setTimeout(() => {
    requestId += 1;
    pending.value = false;
    layoutError.value = "Actor arrangement timed out. Retry to arrange the overview.";
  }, 15000);
}
function startActorDrag({ node }) {
  dragging = true;
  // A routing reply from before this gesture must never move its cards.
  requestId += 1;
  clearTimeout(timer);
  pending.value = false;
  if (!savingPosition.value) positionBase = { hash: props.overview.hash, definition: JSON.parse(JSON.stringify(props.overview.definition)) };
  edges.value = edges.value.map(edge => ({ ...edge, data: { ...edge.data, dragging: edge.data.dragging || edge.source === node.id || edge.target === node.id } }));
}
async function finishActorDrag() {
  dragging = false;
  if (!positionBase) { arrange(); return; }
  const positions = Object.fromEntries(nodes.value.map(node => [node.data.group.table || "other-tables", { ...node.position }]));
  await savePositions(positions);
}
async function savePositions(positions) {
  localPositions = positions;
  queuedPositions = positions;
  arrange();
  if (savingPosition.value) return;
  positionBase ||= { hash: props.overview.hash, definition: props.overview.definition };
  savingPosition.value = true;
  try {
    // Keep only the latest drop while a write is in flight. Each following
    // write uses our last acknowledgement, so concurrent edits still conflict.
    while (queuedPositions && !disposed) {
      const next = queuedPositions;
      queuedPositions = null;
      const result = await props.saveOverview({ definition: { ...positionBase.definition, positions: next }, baseHash: positionBase.hash });
      if (!result?.ok) throw new Error(result?.error || "Actor positions could not be saved.");
      positionBase = result.overview;
    }
  } catch (error) {
    queuedPositions = null;
    positionBase = null;
    feedback.error(error, "Actor positions could not be saved.");
  } finally {
    localPositions = null;
    if (!dragging) positionBase = null;
    if (!disposed) { savingPosition.value = false; arrange(); }
  }
}
watch([() => props.schema.refreshedAt, () => props.overview.hash, () => props.overview.error, allRelationships], () => {
  if (!savingPosition.value) arrange();
});
onMounted(() => {
  worker = new Worker(new URL("../workers/erdLayout.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = async ({ data }) => {
    if (disposed || data.id !== requestId) return;
    clearTimeout(timer);
    if (!data.ok) { pending.value = false; layoutError.value = data.error || "The overview could not be arranged."; return; }
    const initial = !nodes.value.length;
    const positions = new Map(data.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    nodes.value = layoutGraph.nodes.map((node) => ({ ...node, position: positions.get(node.id) || node.position }));
    const routes = new Map(data.overviewRoutes.map((route) => [route.id, route]));
    edges.value = layoutGraph.edges.map((edge) => {
      const route = routes.get(edge.id);
      return { ...edge, sourceHandle: route.sourceHandle, targetHandle: route.targetHandle, data: { ...edge.data, points: route.points } };
    });
    if (data.overviewRoutes.some((route) => route.obstructed)) layoutError.value = "Some connections could not avoid actors. Try showing only main connections.";
    if (initial) await fit({ automatic: true });
    if (!disposed && data.id === requestId) pending.value = false;
  };
  worker.onerror = () => { clearTimeout(timer); pending.value = false; layoutError.value = "The overview layout worker failed. Reload overview to retry."; };
  arrange();
});
onBeforeUnmount(() => { disposed = true; clearTimeout(timer); worker?.terminate(); });

function openGeneration() {
  overviewOptions.value = false;
  abstraction.value = props.overview.definition.abstraction || "balanced";
  generationScope.value = props.overview.present && graph.value.coverage.unreviewed.length ? "new" : "all";
  generation.value = true;
}
function generate() { generation.value = false; emit("request-assistant", { abstraction: abstraction.value, scope: generationScope.value }); }
function openEditor() {
  overviewOptions.value = false;
  baseHash = props.overview.hash;
  baseDefinition = JSON.parse(JSON.stringify(props.overview.definition));
  draftActors.value = JSON.parse(JSON.stringify(baseDefinition.actors));
  editing.value = 0;
  mergeTarget.value = null;
  editorError.value = "";
  editor.value = true;
}
function editActor(table) {
  openEditor();
  editing.value = draftActors.value.findIndex((actor) => actor.table === table);
}
function promoteTable(table) {
  openEditor();
  for (const actor of draftActors.value) actor.tables = actor.tables.filter((id) => id !== table.qualifiedName);
  draftActors.value.push({ table: table.qualifiedName, name: table.name, description: table.comment || "", tables: [table.qualifiedName] });
  editing.value = draftActors.value.length - 1;
}
function mergeActor() {
  const target = draftActors.value.find((actor) => actor.table === mergeTarget.value);
  if (!draft.value || !target || target === draft.value) return;
  target.tables = [...new Set([...target.tables, ...draft.value.tables])];
  draftActors.value.splice(editing.value, 1);
  editing.value = draftActors.value.indexOf(target);
  mergeTarget.value = null;
}
watch(editing, () => { mergeTarget.value = null; });
function addActor() {
  draftActors.value.push({ table: "", name: "", description: "", tables: [] });
  editing.value = draftActors.value.length - 1;
}
function removeActor() {
  draftActors.value.splice(editing.value, 1);
  editing.value = Math.max(0, editing.value - 1);
}
function includeMainTable() { if (draft.value?.table && !draft.value.tables.includes(draft.value.table)) draft.value.tables.push(draft.value.table); }
async function save() {
  if (saving.value) return;
  editorError.value = "";
  try {
    const edited = {
      ...baseDefinition,
      actors: draftActors.value,
      reviewedTables: [...new Set([
        ...(baseDefinition.reviewedTables || []),
        ...baseDefinition.actors.flatMap((actor) => actor.tables),
        ...draftActors.value.flatMap((actor) => actor.tables)
      ])]
    };
    const mainTables = new Set(draftActors.value.map((actor) => actor.table));
    if (edited.positions) edited.positions = Object.fromEntries(Object.entries(edited.positions).filter(([table]) => table === "other-tables" || mainTables.has(table)));
    if (edited.rings) {
      edited.rings = edited.rings.map((ring) => ring.filter((table) => mainTables.has(table))).filter((ring) => ring.length);
      const placed = new Set(edited.rings.flat());
      const added = [...mainTables].filter((table) => !placed.has(table));
      if (added.length) edited.rings.push(added);
    }
    const definition = validateDataOverview(edited);
    saving.value = true;
    const result = await props.saveOverview({ definition, baseHash });
    if (disposed) return;
    if (!result || result.ok === false) { editorError.value = result?.error || "The grouping could not be saved. Your edits are still here."; return; }
    editor.value = false;
  } catch (error) { if (!disposed) editorError.value = error.message || "The grouping could not be saved."; }
  finally { saving.value = false; }
}
</script>

<style scoped>
.database-overview { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; color: rgb(var(--v-theme-on-surface)); }
.database-overview__toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 10px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), .15); }
.database-overview__title { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; min-width: 0; margin-right: auto; }
.database-overview__title span { font-size: 12px; }
.database-overview__options { display: grid; gap: 12px; padding: 16px; width: min(320px, calc(100vw - 24px)); max-height: 80vh; overflow: auto; }
.database-overview__option-actions { display: flex; gap: 4px; }
.database-overview__hint, .database-overview__warning { padding: 8px 12px; font-size: 13px; overflow-wrap: anywhere; }
.database-overview__warning { color: rgb(var(--v-theme-error)); }
.database-overview__canvas { position: relative; flex: 1; min-height: 260px; }
.database-overview__actor { border: 1px solid rgba(var(--v-theme-primary), .5); border-radius: 12px; background: rgb(var(--v-theme-surface)); padding: 14px; }
.database-overview__actor header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.database-overview__actor strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 20px; }
.database-overview__actor p { font-size: 13px; margin: 8px 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.database-overview__actor small { font-size: 12px; }
.database-overview__status { position: absolute; bottom: 8px; left: 8px; padding: 8px; background: rgb(var(--v-theme-surface)); }
.database-overview__inspector { position: absolute; top: 8px; right: 8px; max-height: calc(100% - 16px); width: min(360px, calc(100% - 16px)); overflow: auto; padding: 14px; background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-on-surface), .2); border-radius: 10px; overflow-wrap: anywhere; box-shadow: 0 2px 10px #0002; }
.database-overview__close { float: right; }
.database-overview__inspector p { margin: 12px 0; font-size: 13px; }
.database-overview__relationship { border-top: 1px solid rgba(var(--v-theme-on-surface), .15); padding-top: 10px; margin-top: 10px; }
.database-overview__editor-actions { display: flex; gap: 8px; margin: 12px 0; }
.database-overview__map { height: 100%; }
.database-overview__map--faded { opacity: .12; pointer-events: none; }
.database-overview__backdrop { position: absolute; inset: 0; width: 100%; height: 100%; cursor: default; border: 0; background: transparent; }
.database-overview__detail { position: absolute; inset: 12px; display: grid; grid-template-columns: clamp(160px, 22%, 280px) minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); border: 1px solid rgba(var(--v-theme-primary), .35); border-radius: 12px; background: transparent; box-shadow: 0 12px 40px #0002; overflow: hidden; }
.database-overview__detail-header { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), .15); }
.database-overview__detail-header strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.database-overview__detail-header small { margin-right: auto; }
.database-overview__tables { min-width: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 8px; padding: 10px; border-right: 1px solid rgba(var(--v-theme-on-surface), .15); }
.database-overview__detail > .database-erd { min-width: 0; background: transparent; }
.database-overview__detail :deep(.database-erd__canvas) { background: transparent; }
.database-overview__detail-header, .database-overview__tables,
.database-overview__detail :deep(.database-erd__toolbar), .database-overview__detail :deep(.database-erd__filters) { background: rgba(var(--v-theme-surface), .96); }
@media (max-width: 700px) {
  .database-overview__detail { inset: 12px; grid-template-columns: 140px minmax(0, 1fr); }
  .database-overview__tables { padding: 6px; }
}
</style>
