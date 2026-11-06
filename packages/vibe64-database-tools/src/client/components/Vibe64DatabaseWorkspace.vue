<template>
  <section class="database-workspace" aria-label="Session database browser">
    <template v-if="loading && !state">
      <header class="database-workspace__header database-workspace__header--skeleton">
        <v-skeleton-loader type="avatar, list-item-two-line, button@3" />
      </header>
      <div class="database-workspace__loading" role="status">
        <aside><v-skeleton-loader type="list-item-two-line@8" /></aside>
        <main><v-skeleton-loader type="heading, paragraph, table-heading, table-row@7" /></main>
      </div>
    </template>

    <template v-else-if="error && !state">
      <div class="database-workspace__load-error" role="alert">
        <v-icon icon="$databaseOff" size="38" />
        <strong>Session database could not open.</strong>
        <span>{{ error }}</span>
        <v-btn color="primary" type="button" variant="tonal" @click="reload">Retry</v-btn>
      </div>
    </template>

    <template v-else>
      <header class="database-workspace__header">
        <div class="database-workspace__identity">
          <span class="database-workspace__mark" aria-hidden="true">
            <v-icon icon="$database" size="20" />
          </span>
          <div>
            <strong>{{ connection.database || "Session database" }}</strong>
            <span>{{ connection.label }} · {{ databaseScopeLabel }} · {{ schema.tables.length }} objects · refreshed {{ refreshedLabel }}</span>
          </div>
        </div>

        <v-btn-toggle v-model="activeView" mandatory density="compact" variant="outlined">
          <v-btn value="overview" data-vibe64-guide="database-overview" prepend-icon="$hub" size="small">Overview</v-btn>
          <v-btn value="erd" data-vibe64-guide="database-erd" prepend-icon="$hub" size="small">ERD</v-btn>
          <v-btn value="data" data-vibe64-guide="database-data" prepend-icon="$manageSearch" size="small">Data</v-btn>
        </v-btn-toggle>

        <div class="database-workspace__header-actions">
          <v-btn
            :append-icon="copilotOpen ? '$chevronRight' : '$chevronLeft'"
            :aria-expanded="copilotOpen"
            aria-controls="database-copilot-panel"
            prepend-icon="$autoAwesome"
            size="small"
            :title="copilotOpen ? 'Collapse database copilot' : 'Open database copilot'"
            type="button"
            :variant="copilotOpen ? 'tonal' : 'outlined'"
            @click="copilotOpen = !copilotOpen"
          >
            Copilot
          </v-btn>
          <v-btn
            :aria-busy="refreshing ? 'true' : undefined"
            :disabled="refreshing || running"
            prepend-icon="$refresh"
            size="small"
            type="button"
            variant="tonal"
            @click="refreshDatabaseSchema"
          >
            Refresh schema
          </v-btn>
        </div>
      </header>

      <div
        class="database-workspace__body"
        :class="{ 'database-workspace__body--copilot-open': copilotOpen, 'database-workspace__body--overview': activeView === 'overview' }"
      >
        <DatabaseNavigator
          v-model:search="tableSearch"
          v-model:tab="navigatorTab"
          :active="active && activeView !== 'overview'"
          :database="connection.database"
          :history="workspace.history"
          :running="running"
          :schema="schema"
          :selected-table-name="selectedTableName"
          :snippets="workspace.snippets"
          :write-available="state?.writeAccess?.available !== false"
          @add-row="rowDialogs.openInsertDialog()"
          @load-sql="loadSql"
          @remove-snippet="removeSnippet"
          @select-table="selectTable"
        />

        <main class="database-workspace__main">
          <DatabaseOverview
            v-if="openedViews.overview"
            class="database-workspace__view"
            :class="{ 'database-workspace__view--hidden': activeView !== 'overview' }"
            :inert="activeView !== 'overview' || !active"
            :aria-hidden="activeView !== 'overview'"
            :key="sessionId"
            :schema="schema"
            :overview="state?.overview || { present: false, hash: '', definition: { version: 1, actors: [] } }"
            :assistant-available="assistantAvailable"
            :save-overview="saveOverview"
            @select-table="(table, label) => selectTableFromErd(table, 'overview', label)"
            @inspect-table="diagramSelections.overview = $event"
            @reload="reload"
            @request-assistant="requestOverviewAssistant"
          />
          <DatabaseErd
            :key="sessionId"
            v-if="openedViews.erd"
            class="database-workspace__view"
            :class="{ 'database-workspace__view--hidden': activeView !== 'erd' }"
            :inert="activeView !== 'erd' || !active"
            :aria-hidden="activeView !== 'erd'"
            :layout="erdLayout"
            :focus-request="openRequest"
            :schema="schema"
            @save-layout="saveDiagramLayout"
            @select-table="table => selectTableFromErd(table, 'erd')"
            @inspect-table="diagramSelections.erd = $event"
          />

          <div
            v-if="openedViews.data" class="database-workspace__view database-workspace__data"
            :class="{ 'database-workspace__view--hidden': activeView !== 'data' }"
            :inert="activeView !== 'data' || !active" :aria-hidden="activeView !== 'data'"
          >
            <DatabaseQueryEditor
              :active-query-id="activeQueryId"
              :cancelling="cancelling"
              :diagram-return="diagramReturn"
              :filters="filters"
              :running="running"
              :schema="schema"
              :selected-table="selectedTable"
              :sql-text="sqlText"
              @cancel="cancelActiveQuery"
              @open-filter="filterDialog = true"
              @remove-filter="removeFilter"
              @reset="resetTableQuery"
              @return-to-diagram="returnToDiagram"
              @run="requestRun"
              @save="snippetDialog = true"
              @update:sql-text="updateSqlText"
            />
            <DatabaseQueryResults
              v-model:search="resultSearch"
              :query-result="queryResult"
              :refreshing="refreshing"
              :running="running"
              @delete-row="(rowIndex) => rowDialogs.requestDeleteRow(rowIndex)"
              @edit-cell="(rowIndex, columnIndex) => rowDialogs.openCellEditor(rowIndex, columnIndex)"
              @refresh-schema="refreshDatabaseSchema"
            />
          </div>
        </main>

        <DatabaseCopilotPanel
          v-show="copilotOpen"
          id="database-copilot-panel"
          :adapter="assistantAdapter"
          :busy="assistantBusy"
          :configured="assistantConfigured"
          :status-label="assistantStatusLabel"
          :table-name="assistantTableName"
          :unavailable-copy="assistantUnavailableCopy"
          @close="copilotOpen = false"
          @use-sql="useAssistantSql"
        />
      </div>
    </template>

    <DatabaseFilterDialog v-model="filterDialog" :columns="selectedTable?.columns || []" @add="addFilter" />

    <DatabaseRowDialogs
      ref="rowDialogs"
      :delete-row="deleteRow"
      :deleting="deleting"
      :insert-row="insertRow"
      :inserting="inserting"
      :lookup-busy="lookupBusy"
      :query-result="queryResult"
      :search-lookup="searchLookup"
      :selected-table="selectedTable"
      :update-cell="updateCell"
      :updating="updating"
      @changed="refreshVisibleRows"
    />

    <v-dialog v-model="snippetDialog" max-width="30rem">
      <v-card>
        <v-card-title>Save SQL snippet</v-card-title>
        <v-card-text><v-text-field v-model="snippetName" autofocus label="Name" variant="outlined" /></v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn type="button" variant="text" @click="snippetDialog = false">Cancel</v-btn>
          <v-btn color="primary" :disabled="!snippetName.trim()" type="button" variant="flat" @click="saveCurrentSnippet">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, nextTick, reactive, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useDatabaseColleagueView } from "../composables/useDatabaseColleagueView.js";
import { useDatabaseCopilot } from "../composables/useDatabaseCopilot.js";
import { useDatabaseDiagramLayout } from "../composables/useDatabaseDiagramLayout.js";
import { useDatabaseTableQueries } from "../composables/useDatabaseTableQueries.js";
import { useVibe64DatabaseTools } from "../composables/useVibe64DatabaseTools.js";
import { buildOverviewAssistantRequest } from "../../shared/databaseOverviewPrompt.js";
import { databaseScopeText, shortDate } from "../databaseText.js";
import DatabaseCopilotPanel from "./DatabaseCopilotPanel.vue";
import DatabaseErd from "./DatabaseErd.vue";
import DatabaseFilterDialog from "./DatabaseFilterDialog.vue";
import DatabaseNavigator from "./DatabaseNavigator.vue";
import DatabaseOverview from "./DatabaseOverview.vue";
import DatabaseQueryEditor from "./DatabaseQueryEditor.vue";
import DatabaseQueryResults from "./DatabaseQueryResults.vue";
import DatabaseRowDialogs from "./DatabaseRowDialogs.vue";

const props = defineProps({
  openRequest: { type: Object, default: null },
  active: { default: true, type: Boolean },
  assistantAvailable: { default: true, type: Boolean },
  projectSlug: { default: "", type: String },
  // Raised by the host once work that changed the overview's source ends: the workspace reads it again.
  reloadVersion: { default: 0, type: Number },
  sessionId: { default: "", type: String }
});
const emit = defineEmits(["request-overview-assistant"]);

/**
 * Asks an agent to create or review the Data overview: the request's input, and its message for a chat draft.
 * @param {{ abstraction?: string, scope?: string, tables?: string[] }} [request]
 */
function requestOverviewAssistant({ abstraction = "balanced", scope = "all", tables = [] } = {}) {
  const { message } = buildOverviewAssistantRequest({ abstraction, scope, schemaTables: schema.value.tables, tables });
  emit("request-overview-assistant", { input: { abstraction, scope, tables }, message });
}

const {
  assistantCommand,
  assistantEndpoint,
  assistantBusy,
  cancelQuery,
  cancelling,
  deleteRow,
  deleteSnippet,
  deleting,
  error,
  insertRow,
  inserting,
  loading,
  lookupBusy,
  refreshSchema,
  refreshing,
  reload,
  runQuery,
  running,
  saveLayout,
  saveOverview,
  saveSnippet,
  searchLookup,
  state,
  updateCell,
  updating
} = useVibe64DatabaseTools({
  active: computed(() => props.active),
  projectSlug: computed(() => props.projectSlug),
  sessionId: computed(() => props.sessionId)
});

const activeView = ref("overview");
const route = useRoute();
const router = useRouter();
// Retain each visited view in the same grid cell. Its diagram and camera stay
// mounted; switching views only changes visibility and interaction.
const openedViews = reactive({ overview: true, erd: false, data: false });
watch(activeView, (view) => { openedViews[view] = true; }, { flush: "sync" });
const diagramReturn = shallowRef(null);
const diagramSelections = reactive({ overview: "", erd: "" });
const copilotOpen = ref(false);
const navigatorTab = ref("tables");
const tableSearch = ref("");
const hydratedSessionId = ref("");
const filterDialog = ref(false);
const snippetDialog = ref(false);
const snippetName = ref("");
const rowDialogs = ref(null);

const schema = computed(() => state.value?.schema || { relationships: [], schemas: [], tables: [] });
const connection = computed(() => state.value?.connection || {});
const workspace = computed(() => state.value?.workspace || { history: [], snippets: [] });
const databaseScopeLabel = computed(() => databaseScopeText(connection.value.developmentDatabaseScope));
const refreshedLabel = computed(() => shortDate(schema.value.refreshedAt));

const {
  activeQueryId,
  addFilter,
  admitSchemaTable,
  cancelActiveQuery,
  filters,
  forgetTableQueries,
  loadSql,
  openTable,
  queryResult,
  refreshVisibleRows,
  rememberSelectedTableState,
  removeFilter,
  requestRun,
  resetTableQuery,
  resultSearch,
  selectTable,
  selectedTable,
  selectedTableName,
  sqlText,
  updateSqlText,
  useAssistantSql
} = useDatabaseTableQueries({ activeView, cancelQuery, connection, reload, runQuery, running, schema });
const {
  assistantAdapter,
  assistantBinding,
  assistantConfigured,
  assistantStatusLabel,
  assistantTableName,
  assistantUnavailableCopy
} = useDatabaseCopilot({
  activeView,
  assistantCommand,
  assistantEndpoint,
  diagramSelections,
  queryResult,
  rememberSelectedTableState,
  schema,
  selectedTableName,
  sessionId: () => props.sessionId,
  state
});
const { erdLayout, saveDiagramLayout } = useDatabaseDiagramLayout({
  active: () => props.active,
  saveLayout,
  sessionId: () => props.sessionId,
  state
});

watch([state, () => props.active, activeView], ([next, active]) => {
  if (!active || !next) return;
  const sessionChanged = hydratedSessionId.value !== props.sessionId;
  if (sessionChanged) {
    hydratedSessionId.value = props.sessionId;
    forgetTableQueries();
    assistantBinding.runtime.value.clearHistory();
    copilotOpen.value = false;
    diagramReturn.value = null;
    diagramSelections.overview = "";
    diagramSelections.erd = "";
    erdLayout.value = next.layout || { nodes: [] };
  }
  if (activeView.value !== "data") return;
  admitSchemaTable(next.schema?.tables);
}, { immediate: true });

watch(() => props.reloadVersion, () => { void reload(); });
watch(() => props.sessionId, () => {
  if (hydratedSessionId.value !== props.sessionId) {
    hydratedSessionId.value = "";
    activeView.value = "overview";
    openedViews.erd = false;
    openedViews.data = false;
  }
}, { immediate: true });

let appliedOpenRequest = null;
watch([() => route.query.databaseView, () => props.openRequest, () => props.active, () => props.sessionId],
  ([view, request, active]) => {
    if (!active) return;
    if (request?.qualifiedName && request !== appliedOpenRequest) {
      appliedOpenRequest = request;
      activeView.value = "erd";
    } else {
      activeView.value = ["overview", "erd", "data"].includes(view) ? view : "overview";
    }
  }, { immediate: true });
watch(activeView, (view) => {
  const routeView = ["overview", "erd", "data"].includes(route.query.databaseView) ? route.query.databaseView : "overview";
  // The default Overview needs no URL write: mounting must not cancel navigation away.
  if (props.active && routeView !== view) {
    void router.replace({ path: route.path, query: { ...route.query, databaseView: view } });
  }
}, { flush: "post", immediate: true });

useDatabaseColleagueView({ props, activeView, selectedTable, state, schema, running, loading, error, showTable });

/**
 * Shows a table in Data with the navigator on its full table list.
 * @param {Record<string, any>} table
 */
function showTable(table) {
  navigatorTab.value = "tables";
  tableSearch.value = "";
  return openTable(table);
}

/**
 * Opens a diagram's table in Data, remembering the diagram, its label and the focused element for Back.
 * @param {Record<string, any>} table
 * @param {string} [view]
 * @param {string} [label]
 */
function selectTableFromErd(table, view = activeView.value, label = "") {
  if (!table.qualifiedName || running.value) return;
  diagramReturn.value = {
    view,
    label: label || (view === "erd" ? "ERD" : "Overview"),
    focusTarget: globalThis.document?.activeElement
  };
  return showTable(table);
}

function returnToDiagram() {
  if (!diagramReturn.value) return;
  activeView.value = diagramReturn.value.view;
  void nextTick(() => diagramReturn.value?.focusTarget?.focus({ preventScroll: true }));
}

async function refreshDatabaseSchema() {
  await refreshSchema();
}

async function saveCurrentSnippet() {
  const result = await saveSnippet({ name: snippetName.value, sql: sqlText.value });
  if (!result) return;
  snippetDialog.value = false;
  snippetName.value = "";
  navigatorTab.value = "saved";
  await reload();
}

async function removeSnippet(id) {
  await deleteSnippet(id);
  await reload();
}
</script>

<style scoped>
.database-workspace {
  container-type: inline-size;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 38rem;
  height: 100%;
  overflow: hidden;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 18px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.database-workspace__header {
  display: grid;
  grid-template-columns: minmax(14rem, 1fr) auto minmax(14rem, 1fr);
  gap: 1rem;
  align-items: center;
  min-height: 4.25rem;
  padding: 0.6rem 0.85rem;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  background: rgb(var(--v-theme-surface-container-low));
}

.database-workspace__header--skeleton :deep(.v-skeleton-loader) { width: 100%; }
.database-workspace__identity, .database-workspace__header-actions { display: flex; gap: 0.55rem; align-items: center; }
.database-workspace__header-actions { justify-content: flex-end; }
.database-workspace__identity { min-width: 0; }
.database-workspace__identity > div { min-width: 0; }
.database-workspace__identity strong, .database-workspace__identity span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.database-workspace__identity span { color: rgba(var(--v-theme-on-surface), 0.58); font-size: 0.7rem; }
.database-workspace__mark { display: grid; flex: 0 0 2.15rem; width: 2.15rem; height: 2.15rem; place-items: center; border-radius: 11px; background: rgba(var(--v-theme-primary), 0.12); color: rgb(var(--v-theme-primary)); }

.database-workspace__body, .database-workspace__loading { position: relative; display: grid; grid-template-columns: 15rem minmax(0, 1fr); min-height: 0; }
.database-workspace__body--copilot-open { grid-template-columns: 15rem minmax(0, 1fr) 20rem; }
.database-workspace__body--overview { grid-template-columns: minmax(0, 1fr); }
.database-workspace__body--overview.database-workspace__body--copilot-open { grid-template-columns: minmax(0, 1fr) 20rem; }
.database-workspace__body--overview > .database-workspace__navigator { display: none; }
.database-workspace__loading { height: 100%; }
.database-workspace__loading > * { padding: 1rem; border-right: 1px solid rgb(var(--v-theme-outline-variant)); }
.database-workspace__navigator, .database-workspace__copilot { display: grid; min-height: 0; overflow: hidden; background: rgb(var(--v-theme-surface)); }
.database-workspace__navigator { grid-template-rows: auto auto minmax(8rem, 1fr); padding: 0.7rem; border-right: 1px solid rgb(var(--v-theme-outline-variant)); }

.database-workspace__main { min-width: 0; min-height: 0; overflow: hidden; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); }
.database-workspace__view { grid-area: 1 / 1; min-width: 0; min-height: 0; transition: opacity 140ms ease, visibility 140ms; }
.database-workspace__view--hidden { opacity: 0; visibility: hidden; pointer-events: none; }
.database-workspace__data { display: grid; grid-template-rows: auto minmax(16rem, 1fr); }
@media (prefers-reduced-motion: reduce) { .database-workspace__view { transition: none; } }
.database-workspace__load-error { display: grid; height: 100%; align-content: center; justify-items: center; gap: 0.4rem; padding: 2rem; color: rgba(var(--v-theme-on-surface), 0.62); text-align: center; }
.database-workspace__load-error strong { color: rgb(var(--v-theme-on-surface)); }

.database-workspace__copilot { grid-template-rows: auto minmax(0, 1fr); border-left: 1px solid rgb(var(--v-theme-outline-variant)); }

@container (max-width: 1180px) {
  .database-workspace__body, .database-workspace__loading, .database-workspace__body--copilot-open { grid-template-columns: 13rem minmax(0, 1fr); }
  .database-workspace__body--overview, .database-workspace__body--overview.database-workspace__body--copilot-open { grid-template-columns: minmax(0, 1fr); }
  .database-workspace__copilot { position: absolute; z-index: 4; inset: 0 0 0 auto; width: min(22rem, calc(100% - 13rem)); border-left: 1px solid rgb(var(--v-theme-outline-variant)); box-shadow: 0 8px 24px rgba(var(--v-theme-on-surface), 0.18); }
  .database-workspace__header { grid-template-columns: minmax(12rem, 1fr) auto auto; }
}

@container (max-width: 760px) {
  .database-workspace { min-height: 42rem; }
  .database-workspace__header { grid-template-columns: minmax(0, 1fr) auto; }
  .database-workspace__header > .v-btn-toggle { order: 3; grid-column: 1 / -1; justify-self: center; }
  .database-workspace__body, .database-workspace__loading, .database-workspace__body--copilot-open { grid-template-columns: 1fr; }
  .database-workspace__navigator { display: none; }
  .database-workspace__copilot { width: min(22rem, 100%); }
}
</style>
