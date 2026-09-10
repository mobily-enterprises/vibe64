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
        <v-icon :icon="mdiDatabaseAlertOutline" size="38" />
        <strong>Session database could not open.</strong>
        <span>{{ error }}</span>
        <v-btn color="primary" type="button" variant="tonal" @click="reload">Retry</v-btn>
      </div>
    </template>

    <template v-else>
      <header class="database-workspace__header">
        <div class="database-workspace__identity">
          <span class="database-workspace__mark" aria-hidden="true">
            <v-icon :icon="mdiDatabaseOutline" size="20" />
          </span>
          <div>
            <strong>{{ connection.database || "Session database" }}</strong>
            <span>{{ connection.label }} · {{ databaseScopeLabel }} · {{ schema.tables.length }} objects · refreshed {{ refreshedLabel }}</span>
          </div>
        </div>

        <v-btn-toggle v-model="activeView" mandatory density="compact" variant="outlined">
          <v-btn value="overview" :prepend-icon="mdiGraphOutline" size="small">Overview</v-btn>
          <v-btn value="erd" :prepend-icon="mdiGraphOutline" size="small">ERD</v-btn>
          <v-btn value="data" :prepend-icon="mdiTableSearch" size="small">Data</v-btn>
        </v-btn-toggle>

        <div class="database-workspace__header-actions">
          <v-btn
            :append-icon="copilotOpen ? mdiChevronRight : mdiChevronLeft"
            :aria-expanded="copilotOpen"
            aria-controls="database-copilot-panel"
            :prepend-icon="mdiCreationOutline"
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
            :prepend-icon="mdiRefresh"
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
        <aside class="database-workspace__navigator">
          <v-text-field
            v-model="tableSearch"
            aria-label="Find tables and views"
            class="database-workspace__table-search"
            clearable
            density="compact"
            hide-details
            :prepend-inner-icon="mdiMagnify"
            placeholder="Find tables…"
            variant="outlined"
          />
          <v-btn-toggle v-model="navigatorTab" mandatory density="compact" variant="text">
            <v-btn size="x-small" value="tables">Tables</v-btn>
            <v-btn size="x-small" value="saved">Saved</v-btn>
            <v-btn size="x-small" value="history">History</v-btn>
          </v-btn-toggle>

          <DatabaseTableList
            v-if="navigatorTab === 'tables'"
            :schema="schema" :selected-table-name="selectedTableName" :search="tableSearch"
            :database="connection.database" :running="running" @select-table="selectTable"
          >
            <template #table-actions>
              <v-btn :prepend-icon="mdiPlus" size="x-small" title="Insert a row into this table" variant="text" @click="openInsertDialog">Add row</v-btn>
            </template>
          </DatabaseTableList>
          <div v-else-if="navigatorTab === 'saved'" class="database-workspace__nav-scroll">
            <button
              v-for="snippet in workspace.snippets"
              :key="snippet.id"
              class="database-workspace__saved-query"
              type="button"
              @click="loadSql(snippet.sql)"
            >
              <v-icon :icon="mdiBookmarkOutline" size="15" />
              <span><strong>{{ snippet.name }}</strong><small>{{ shortDate(snippet.updatedAt) }}</small></span>
              <v-btn
                :icon="mdiDeleteOutline"
                size="x-small"
                title="Delete snippet"
                type="button"
                variant="text"
                @click.stop="removeSnippet(snippet.id)"
              />
            </button>
            <p v-if="workspace.snippets.length === 0" class="database-workspace__empty-copy">Saved queries stay with this session.</p>
          </div>

          <div v-else class="database-workspace__nav-scroll">
            <button
              v-for="entry in workspace.history"
              :key="entry.id"
              class="database-workspace__saved-query"
              type="button"
              @click="loadSql(entry.sql)"
            >
              <v-icon :color="entry.ok ? undefined : 'error'" :icon="entry.ok ? mdiHistory : mdiAlertCircleOutline" size="15" />
              <span>
                <strong>{{ firstSqlLine(entry.sql) }}</strong>
                <small>{{ shortDate(entry.at) }} · {{ entry.durationMs }} ms</small>
              </span>
            </button>
            <p v-if="workspace.history.length === 0" class="database-workspace__empty-copy">Statements you run appear here.</p>
          </div>
        </aside>

        <main class="database-workspace__main">
          <DatabaseOverview
            v-if="activeView === 'overview'"
            :key="sessionId"
            :schema="schema"
            :overview="state?.overview || { present: false, hash: '', definition: { version: 1, actors: [] } }"
            :assistant-available="assistantAvailable"
            :save-overview="saveOverview"
            @select-table="selectTableFromErd"
            @reload="reload"
            @request-assistant="requestOverviewAssistant"
          />
          <DatabaseErd
            :key="sessionId"
            v-else-if="activeView === 'erd'"
            :layout="erdLayout"
            :schema="schema"
            @save-layout="saveDiagramLayout"
            @select-table="selectTableFromErd"
          />

          <template v-else>
            <section class="database-workspace__query">
              <header class="database-workspace__query-toolbar">
                <div class="database-workspace__query-actions">
                  <v-btn
                    ref="runButton"
                    :aria-busy="running ? 'true' : undefined"
                    aria-keyshortcuts="Control+Enter Meta+Enter"
                    color="primary"
                    :disabled="running || !sqlText.trim()"
                    :prepend-icon="mdiPlay"
                    size="small"
                    title="Run SQL, including write statements (Ctrl/Cmd+Enter, or Tab then Enter from the editor)"
                    type="button"
                    variant="flat"
                    @click="requestRun"
                  >
                    Run
                  </v-btn>
                  <v-btn
                    :aria-busy="cancelling ? 'true' : undefined"
                    :disabled="!running || cancelling || !activeQueryId"
                    :prepend-icon="mdiStop"
                    size="small"
                    type="button"
                    variant="tonal"
                    @click="cancelActiveQuery"
                  >
                    Cancel
                  </v-btn>
                  <v-btn
                    :disabled="!selectedTable"
                    :prepend-icon="mdiFilterPlusOutline"
                    size="small"
                    type="button"
                    variant="text"
                    @click="filterDialog = true"
                  >
                    Filter
                  </v-btn>
                  <v-btn
                    :disabled="running || !selectedTable"
                    :prepend-icon="mdiRestore"
                    size="small"
                    title="Restore and run this table’s default SELECT * query"
                    type="button"
                    variant="text"
                    @click="resetTableQuery"
                  >
                    Reset to SELECT *
                  </v-btn>
                  <v-chip
                    v-for="filter in filters"
                    :key="filter.id"
                    closable
                    size="small"
                    @click:close="removeFilter(filter.id)"
                  >
                    {{ filter.column }} {{ filter.operator }} {{ filter.value }}
                  </v-chip>
                </div>

                <div class="database-workspace__query-options">
                  <v-btn
                    :disabled="!sqlText.trim()"
                    :prepend-icon="mdiBookmarkPlusOutline"
                    size="small"
                    type="button"
                    variant="text"
                    @click="snippetDialog = true"
                  >
                    Save
                  </v-btn>
                </div>
              </header>
              <div class="database-workspace__editor-wrap">
                <DatabaseSqlEditor
                  :engine="schema.engine"
                  :model-value="sqlText"
                  :run-available="!running && Boolean(sqlText.trim())"
                  :schema="schema"
                  @focus-run="focusRunButton"
                  @run="requestRun"
                  @update:model-value="updateSqlText"
                />
              </div>
            </section>

            <section class="database-workspace__results">
              <header>
                <div>
                  <strong>{{ resultTitle }}</strong>
                  <span v-if="queryResult" :title="resultSubtitle">{{ resultSubtitle }}</span>
                </div>
                <v-text-field
                  v-if="queryResult?.kind === 'result-set'"
                  v-model="resultSearch"
                  aria-label="Find in query results"
                  clearable
                  density="compact"
                  hide-details
                  :prepend-inner-icon="mdiMagnify"
                  placeholder="Find in results…"
                  variant="outlined"
                />
              </header>

              <div v-if="running && !queryResult" class="database-workspace__result-skeleton" role="status">
                <v-skeleton-loader type="table-heading, table-row@7" />
              </div>

              <div v-else-if="queryResult?.kind === 'result-set'" class="database-workspace__table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th class="database-workspace__row-number">#</th>
                      <th v-for="column in queryResult.columns" :key="column.index" :title="column.origin ? `${column.origin.schema}.${column.origin.table}.${column.origin.column}` : column.databaseType">
                        <span>{{ resultColumnLabel(column) }}</span>
                        <small>{{ column.databaseType }}</small>
                      </th>
                      <th class="database-workspace__row-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="entry in filteredResultRows" :key="entry.index">
                      <th class="database-workspace__row-number">{{ entry.index + 1 }}</th>
                      <td
                        v-for="(value, columnIndex) in entry.row"
                        :key="columnIndex"
                        :class="{ 'database-workspace__cell--editable': cellMetadata(entry.index, columnIndex).editable }"
                        :title="cellTitle(entry.index, columnIndex)"
                      >
                        <button
                          v-if="cellMetadata(entry.index, columnIndex).editable"
                          :aria-label="`Edit ${resultColumnLabel(queryResult.columns[columnIndex])}: ${displayValue(value)}`"
                          class="database-workspace__cell-editor"
                          type="button"
                          @click="openCellEditor(entry.index, columnIndex)"
                        >
                          <span :class="{ 'database-workspace__null': value === null }">{{ displayValue(value) }}</span>
                          <v-icon :icon="mdiPencilOutline" size="15" />
                        </button>
                        <span v-else :class="{ 'database-workspace__null': value === null }">{{ displayValue(value) }}</span>
                      </td>
                      <td class="database-workspace__row-actions">
                        <v-btn
                          :disabled="!rowDeleteIdentity(entry.index)"
                          :icon="mdiDeleteOutline"
                          size="x-small"
                          title="Delete source row"
                          type="button"
                          variant="text"
                          @click="requestDeleteRow(entry.index)"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p v-if="filteredResultRows.length === 0" class="database-workspace__empty-copy">No result rows match this search.</p>
              </div>

              <div v-else-if="queryResult?.kind === 'command'" class="database-workspace__command-result">
                <v-icon :icon="mdiCheckCircleOutline" color="success" size="32" />
                <strong>{{ queryResult.command || "Statement" }} completed</strong>
                <span>{{ queryResult.affectedRows }} affected rows · {{ queryResult.durationMs }} ms</span>
                <p v-for="warning in queryResult.warnings" :key="warning">{{ warning }}</p>
                <v-btn
                  :aria-busy="refreshing ? 'true' : undefined"
                  :disabled="refreshing || running"
                  :prepend-icon="mdiRefresh"
                  size="small"
                  title="Refresh tables, constraints, and ERD relationships after schema-changing SQL"
                  type="button"
                  variant="tonal"
                  @click="refreshDatabaseSchema"
                >
                  Refresh schema / ERD
                </v-btn>
              </div>

              <div v-else class="database-workspace__empty-result">
                <v-icon :icon="mdiTableSearch" size="34" />
                <strong>Run the editable SQL above.</strong>
                <span>Direct physical fields remain editable whenever this result includes a complete primary or unique key.</span>
              </div>
            </section>
          </template>
        </main>

        <aside
          v-show="copilotOpen"
          id="database-copilot-panel"
          class="database-workspace__copilot"
        >
          <header>
            <span class="database-workspace__copilot-mark"><v-icon :icon="mdiCreationOutline" size="18" /></span>
            <div><strong>Database copilot</strong><small>{{ assistantStatusLabel }}</small></div>
            <v-btn
              :icon="mdiClose"
              size="small"
              title="Collapse database copilot"
              type="button"
              variant="text"
              @click="copilotOpen = false"
            />
          </header>
          <div v-if="assistantCanRun" class="database-workspace__copilot-body">
            <div class="database-workspace__assistant-note">
              Looks up bounded parts of the refreshed schema as needed. Database credentials stay server-side, schema metadata is untrusted, and it can run only read-only queries.
            </div>
            <div class="database-workspace__messages">
              <article v-for="(message, index) in assistantMessages" :key="index" :class="`database-workspace__message--${message.role}`">
                <small>{{ message.role === 'user' ? 'You' : 'Copilot' }}</small>
                <p>{{ message.content }}</p>
                <v-btn
                  v-if="message.sql"
                  :prepend-icon="mdiCodeTags"
                  size="x-small"
                  type="button"
                  variant="tonal"
                  @click="useAssistantSql(message.sql)"
                >
                  Put SQL in editor
                </v-btn>
              </article>
              <div v-if="assistantBusy" class="database-workspace__assistant-skeleton" role="status">
                <v-skeleton-loader type="list-item-two-line, paragraph" />
              </div>
            </div>
            <div class="database-workspace__assistant-composer">
              <v-textarea
                v-model="assistantDraft"
                auto-grow
                density="compact"
                :disabled="assistantBusy"
                hide-details
                max-rows="5"
                placeholder="Ask about this database…"
                rows="2"
                variant="outlined"
                @keydown.meta.enter.prevent="askCopilot"
                @keydown.ctrl.enter.prevent="askCopilot"
              />
              <v-btn
                :aria-busy="assistantBusy ? 'true' : undefined"
                color="primary"
                :disabled="assistantBusy || !assistantDraft.trim()"
                :icon="mdiSend"
                title="Ask database copilot"
                type="button"
                variant="flat"
                @click="askCopilot"
              />
            </div>
          </div>
          <div v-else class="database-workspace__copilot-unavailable">
            <v-icon :icon="mdiInformationOutline" size="26" />
            <strong>{{ assistantUnavailableTitle }}</strong>
            <span>{{ assistantUnavailableCopy }}</span>
          </div>
        </aside>
      </div>
    </template>

    <v-dialog v-model="filterDialog" max-width="38rem">
      <v-card>
        <v-card-title>Add a table filter</v-card-title>
        <v-card-text class="database-workspace__filter-form">
          <v-select v-model="filterDraft.column" :items="filterColumnOptions" label="Column" variant="outlined" />
          <v-select v-model="filterDraft.operator" :items="filterOperators" label="Operator" variant="outlined" />
          <v-text-field v-if="!filterDraft.operator.startsWith('IS ')" v-model="filterDraft.value" label="Value" variant="outlined" />
          <p>The generated SELECT remains ordinary editable SQL.</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn type="button" variant="text" @click="filterDialog = false">Cancel</v-btn>
          <v-btn color="primary" :disabled="!filterDraft.column" type="button" variant="flat" @click="addFilter">Add filter</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="cellDialog" max-width="42rem">
      <v-card>
        <v-card-title>Edit {{ editingColumn?.label }}</v-card-title>
        <v-card-text class="database-workspace__edit-form">
          <p v-if="editingColumn?.origin"><code>{{ editingColumn.origin.schema }}.{{ editingColumn.origin.table }}.{{ editingColumn.origin.column }}</code></p>
          <v-autocomplete
            v-if="editingColumn?.lookup"
            v-model="selectedLookupItem"
            v-model:search="lookupSearch"
            :hint="lookupBusy ? 'Searching lookup table…' : 'Suggestions come from the declared foreign-key target.'"
            :items="lookupItems"
            item-title="display"
            label="Choose from referenced table"
            no-filter
            persistent-hint
            return-object
            variant="outlined"
          />
          <v-checkbox v-model="editingNull" label="Set NULL" />
          <v-textarea
            v-model="editingText"
            auto-grow
            :disabled="editingNull"
            :error-messages="cellValidationError"
            label="Value"
            max-rows="10"
            variant="outlined"
          />
          <small>Objects and arrays use JSON. Number and boolean values keep their database-result type.</small>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="updating" type="button" variant="text" @click="cellDialog = false">Cancel</v-btn>
          <v-btn :aria-busy="updating ? 'true' : undefined" color="primary" :disabled="updating" type="button" variant="flat" @click="saveCell">Save value</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteDialog" max-width="34rem">
      <v-card>
        <v-card-title>Delete this source row?</v-card-title>
        <v-card-text>This deletes exactly one row from <code>{{ pendingDelete?.table?.schema }}.{{ pendingDelete?.table?.name }}</code> using the key included in the query result.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="deleting" type="button" variant="text" @click="deleteDialog = false">Cancel</v-btn>
          <v-btn :aria-busy="deleting ? 'true' : undefined" color="error" :disabled="deleting" type="button" variant="flat" @click="confirmDeleteRow">Delete row</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="insertDialog" max-width="48rem" scrollable>
      <v-card>
        <v-card-title>Insert into {{ selectedTable?.qualifiedName }}</v-card-title>
        <v-card-text class="database-workspace__insert-form">
          <v-alert
            v-if="insertValidationError"
            class="database-workspace__insert-error"
            density="compact"
            type="error"
            variant="tonal"
          >
            {{ insertValidationError }}
          </v-alert>
          <div v-for="column in insertColumns" :key="column.name">
            <v-checkbox v-model="insertIncluded[column.name]" :label="column.name" hide-details />
            <v-text-field v-model="insertValues[column.name]" :disabled="!insertIncluded[column.name]" :hint="column.default ? `Default: ${column.default}` : column.nativeType" persistent-hint variant="outlined" />
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="inserting" type="button" variant="text" @click="insertDialog = false">Cancel</v-btn>
          <v-btn :aria-busy="inserting ? 'true' : undefined" color="primary" :disabled="inserting || !hasInsertValues" type="button" variant="flat" @click="saveInsertedRow">Insert row</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

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
import {
  computed,
  onBeforeUnmount,
  reactive,
  ref,
  watch
} from "vue";
import {
  mdiAlertCircleOutline,
  mdiBookmarkOutline,
  mdiBookmarkPlusOutline,
  mdiCheckCircleOutline,
  mdiChevronLeft,
  mdiChevronRight,
  mdiClose,
  mdiCodeTags,
  mdiCreationOutline,
  mdiDatabaseAlertOutline,
  mdiDatabaseOutline,
  mdiDeleteOutline,
  mdiFilterPlusOutline,
  mdiGraphOutline,
  mdiHistory,
  mdiInformationOutline,
  mdiMagnify,
  mdiPencilOutline,
  mdiPlay,
  mdiPlus,
  mdiRefresh,
  mdiRestore,
  mdiSend,
  mdiStop,
  mdiTableSearch
} from "@mdi/js";

import {
  useVibe64DatabaseTools
} from "../composables/useVibe64DatabaseTools.js";
import {
  databaseClientDialect
} from "../databaseDialect.js";
import DatabaseTableList from "./DatabaseTableList.vue";
import DatabaseErd from "./DatabaseErd.vue";
import DatabaseOverview from "./DatabaseOverview.vue";
import { DATA_OVERVIEW_ABSTRACTIONS } from "../../shared/dataOverview.js";
import DatabaseSqlEditor from "./DatabaseSqlEditor.vue";

const props = defineProps({
  active: {
    default: true,
    type: Boolean
  },
  assistantAvailable: {
    default: true,
    type: Boolean
  },
  assistantUnavailableMessage: {
    default: "",
    type: String
  },
  projectSlug: {
    default: "",
    type: String
  },
  sessionId: {
    default: "",
    type: String
  },
  sessionsApiPath: {
    default: "",
    type: [String, Object, Function]
  }
});
const emit = defineEmits(["request-overview-assistant"]);

function requestOverviewAssistant({ abstraction = "balanced", scope = "all" } = {}) {
  const level = DATA_OVERVIEW_ABSTRACTIONS.find((item) => item.value === abstraction) || DATA_OVERVIEW_ABSTRACTIONS[1];
  const scopeInstruction = scope === "new"
    ? "Process only coverage.unreviewed tables. Preserve existing actors, names, descriptions, memberships and manual choices. New tables may join an existing actor or form a new one. Preserve reviewedTables and add the newly reviewed tables, including those deliberately left under Other tables."
    : "Regenerate the whole grouping at the selected abstraction level, replacing existing actor choices as needed. Review every current table and record every one in reviewedTables, including those deliberately left under Other tables.";
  emit("request-overview-assistant", {
    title: "Data overview",
    displayMessage: `${scope === "new" ? "Process new tables only" : "Regenerate the data overview"}: ${level.title}.`,
    message: `Create or review this project's Data overview. Run \`vibe64-database overview --json\` to read its current definition, refreshed schema and exact authoring instructions. Inspect the relevant application source to understand the main actors. Selected abstraction: ${level.title} (${level.value}). ${level.description} ${scopeInstruction} Save the grouping in data-overview.json with abstraction set to "${level.value}". Supporting tables may be several relationships away. Change only this grouping file; do not change database records, schema or other application files. Run \`vibe64-database refresh\` followed by \`vibe64-database overview --json\`, fix invalid or missing references, and report coverage plus any tables left under Other tables.`,
    dedupeKey: "database-overview",
    policy: "workspace_write"
  });
}

const database = useVibe64DatabaseTools({
  active: computed(() => props.active),
  projectSlug: computed(() => props.projectSlug),
  sessionId: computed(() => props.sessionId)
});
const {
  askAssistant,
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
} = database;

const activeView = ref("overview");
const copilotOpen = ref(false);
const erdLayout = ref({ nodes: [] });
const diagramSavesPending = ref(0);
let disposed = false;
const navigatorTab = ref("tables");
const tableSearch = ref("");
const selectedTableName = ref("");
const sqlText = ref("");
const queryResult = ref(null);
const activeQueryId = ref("");
const resultSearch = ref("");
const hydratedSessionId = ref("");
const filters = ref([]);
const filterDialog = ref(false);
const filterDraft = reactive({ column: "", operator: "=", value: "" });
const filterOperators = ["=", "<>", ">", ">=", "<", "<=", "LIKE", "IS NULL", "IS NOT NULL"];
const cellDialog = ref(false);
const editingCell = ref(null);
const editingText = ref("");
const editingNull = ref(false);
const cellValidationError = ref("");
const lookupItems = ref([]);
const lookupSearch = ref("");
const selectedLookupItem = ref(null);
const deleteDialog = ref(false);
const pendingDelete = ref(null);
const insertDialog = ref(false);
const insertValues = reactive({});
const insertIncluded = reactive({});
const insertValidationError = ref("");
const snippetDialog = ref(false);
const snippetName = ref("");
const assistantDraft = ref("");
const assistantMessages = ref([]);
const runButton = ref(null);
const tableQueryStates = new Map();
let lookupTimer = null;

const schema = computed(() => state.value?.schema || { relationships: [], schemas: [], tables: [] });
const connection = computed(() => state.value?.connection || {});
const workspace = computed(() => state.value?.workspace || { history: [], snippets: [] });
const databaseScopeLabel = computed(() => (
  connection.value.developmentDatabaseScope === "project"
    ? "Shared project database"
    : connection.value.developmentDatabaseScope === "session"
      ? "Session database"
      : "Resolved database"
));
const assistantConfigured = computed(() => Boolean(state.value?.assistant?.available));
const assistantCanRun = computed(() => assistantConfigured.value && props.assistantAvailable);
const assistantStatusLabel = computed(() => {
  if (!assistantConfigured.value) return "Not configured";
  if (!props.assistantAvailable) return "Owner only";
  return state.value?.assistant?.model || "Available";
});
const assistantUnavailableTitle = computed(() => (
  assistantConfigured.value ? "Copilot is owner-only for this connection." : "Copilot is optional."
));
const assistantUnavailableCopy = computed(() => {
  if (assistantConfigured.value) {
    return props.assistantUnavailableMessage || "This Personal AI connection can only be used by the workspace owner. Database browsing and editing remain available.";
  }
  return "Configure the server’s database-assistant OpenAI key to enable it. Database browsing and editing work without AI.";
});
const selectedTable = computed(() => schema.value.tables.find((table) => table.qualifiedName === selectedTableName.value) || null);
const currentQueryIsDefault = computed(() => Boolean(
  selectedTable.value && sqlText.value.trim() === defaultTableSql(selectedTable.value)
));
const refreshedLabel = computed(() => shortDate(schema.value.refreshedAt));
const filterColumnOptions = computed(() => (selectedTable.value?.columns || []).map((column) => ({ title: `${column.name} · ${column.nativeType}`, value: column.name })));
const editingColumn = computed(() => editingCell.value ? queryResult.value?.columns?.[editingCell.value.columnIndex] : null);
const insertColumns = computed(() => (selectedTable.value?.columns || []).filter((column) => !column.immutable));
const hasInsertValues = computed(() => insertColumns.value.some((column) => insertIncluded[column.name]));

const filteredResultRows = computed(() => {
  const rows = Array.isArray(queryResult.value?.rows) ? queryResult.value.rows : [];
  const search = resultSearch.value.trim().toLowerCase();
  return rows.map((row, index) => ({ index, row })).filter(({ row }) => (
    !search || row.some((value) => displayValue(value).toLowerCase().includes(search))
  ));
});

const resultTitle = computed(() => {
  if (!queryResult.value) return "Results";
  if (queryResult.value.kind === "command") return "Statement complete";
  return `${queryResult.value.fullRowCount ?? queryResult.value.rows?.length ?? 0} rows`;
});
const resultEditHint = computed(() => {
  if (queryResult.value?.kind !== "result-set") return "";
  if (!queryResult.value.rows?.length) return "No rows to edit";
  const metadata = queryResult.value.cellMeta || [];
  if (metadata.some((row) => row.some((cell) => cell?.editable))) {
    return "Pencil-marked cells are editable—click one to change its source value";
  }
  const reason = metadata.flat().find((cell) => cell?.reason)?.reason;
  return reason ? `Read-only result: ${reason}` : "Read-only result";
});
const resultSubtitle = computed(() => {
  if (!queryResult.value) return "";
  const truncation = queryResult.value.truncated ? " · limited result" : "";
  const editHint = resultEditHint.value ? ` · ${resultEditHint.value}` : "";
  return `${queryResult.value.durationMs || 0} ms${truncation}${editHint}`;
});

watch([state, () => props.active, activeView], ([next, active]) => {
  if (!active || !next) return;
  const sessionChanged = hydratedSessionId.value !== props.sessionId;
  if (sessionChanged) {
    hydratedSessionId.value = props.sessionId;
    tableQueryStates.clear();
    selectedTableName.value = "";
    sqlText.value = "";
    queryResult.value = null;
    filters.value = [];
    assistantMessages.value = [];
    copilotOpen.value = false;
    erdLayout.value = next.layout || { nodes: [] };
  }
  if (activeView.value !== "data") return;
  if (!selectedTableName.value) {
    const firstTable = next.schema?.tables?.[0];
    if (firstTable) void openTable(firstTable, { rememberCurrent: false });
  } else {
    const stillPresent = next.schema?.tables?.some((table) => table.qualifiedName === selectedTableName.value);
    if (!stillPresent) {
      const firstTable = next.schema?.tables?.[0];
      if (firstTable) {
        void openTable(firstTable, { rememberCurrent: false });
      } else {
        selectedTableName.value = "";
        sqlText.value = "";
        queryResult.value = null;
        filters.value = [];
      }
    }
  }
}, { immediate: true });

watch(() => props.sessionId, () => {
  if (hydratedSessionId.value !== props.sessionId) {
    hydratedSessionId.value = "";
    activeView.value = "overview";
  }
}, { immediate: true });

watch([() => state.value?.layout, () => props.active, diagramSavesPending], ([layout, active, pending]) => {
  if (active && !pending && layout && layout.revision > (erdLayout.value.revision || 0)) {
    erdLayout.value = layout;
  }
}, { immediate: true });

onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(lookupTimer);
});

watch([cellDialog, lookupSearch], ([open]) => {
  clearTimeout(lookupTimer);
  if (!open || !editingColumn.value?.lookup) return;
  lookupTimer = setTimeout(() => void loadLookup(), 220);
}, { immediate: true });

watch(selectedLookupItem, (item) => {
  if (!item || !editingColumn.value?.lookup || !editingCell.value) return;
  const lookup = editingColumn.value.lookup;
  const sourceColumn = editingColumn.value.origin?.column;
  const sourceIndex = lookup.sourceColumns.indexOf(sourceColumn);
  const referencedColumn = lookup.referencedColumns[sourceIndex];
  if (referencedColumn && Object.hasOwn(item.keys || {}, referencedColumn)) {
    const value = item.keys[referencedColumn];
    editingNull.value = value == null;
    editingText.value = value == null ? "" : String(value);
  }
});

function shortDate(value = "") {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function firstSqlLine(value = "") {
  return String(value || "").trim().split("\n")[0].slice(0, 80) || "SQL statement";
}

function quoteIdentifier(name = "") {
  return databaseClientDialect(schema.value.engine).quoteIdentifier(name);
}

function qualifiedTable(table = {}) {
  return [table.schema, table.name].filter(Boolean).map(quoteIdentifier).join(".");
}

function defaultTableSql(table = {}) {
  return `SELECT *\nFROM ${qualifiedTable(table)};`;
}

function rememberSelectedTableState() {
  if (!selectedTableName.value) return;
  tableQueryStates.set(selectedTableName.value, {
    filters: filters.value.map((filter) => ({ ...filter })),
    queryResult: queryResult.value,
    sqlText: sqlText.value
  });
}

async function openTable(table = {}, { rememberCurrent = true } = {}) {
  if (!table.qualifiedName || running.value) return;
  if (rememberCurrent) rememberSelectedTableState();
  selectedTableName.value = table.qualifiedName;
  resultSearch.value = "";
  activeView.value = "data";
  const saved = tableQueryStates.get(table.qualifiedName);
  if (saved) {
    filters.value = saved.filters.map((filter) => ({ ...filter }));
    sqlText.value = saved.sqlText;
    queryResult.value = saved.queryResult;
    return;
  }
  filters.value = [];
  sqlText.value = defaultTableSql(table);
  queryResult.value = null;
  await executeQuery({ automatic: true });
}

function selectTable(table = {}) {
  return openTable(table);
}

function selectTableFromErd(table = {}) {
  selectTable(table);
}

function loadSql(value = "") {
  filters.value = [];
  sqlText.value = String(value || "");
  activeView.value = "data";
  rememberSelectedTableState();
}

function updateSqlText(value = "") {
  sqlText.value = String(value || "");
  rememberSelectedTableState();
}

async function resetTableQuery() {
  if (!selectedTable.value || running.value) return;
  filters.value = [];
  resultSearch.value = "";
  sqlText.value = defaultTableSql(selectedTable.value);
  queryResult.value = null;
  tableQueryStates.delete(selectedTable.value.qualifiedName);
  await executeQuery({ automatic: true });
}

function sqlLiteral(value = "", column = {}) {
  const raw = String(value ?? "");
  if (/^(?:smallint|integer|bigint|decimal|numeric|real|double|float|int|tinyint|mediumint)/iu.test(column.dataType || column.nativeType) && /^-?(?:\d+\.?\d*|\.\d+)$/u.test(raw.trim())) return raw.trim();
  if (/^(?:boolean|bool)/iu.test(column.dataType || column.nativeType) && /^(?:true|false)$/iu.test(raw.trim())) return raw.trim().toUpperCase();
  return databaseClientDialect(schema.value.engine).stringLiteral(raw);
}

function regenerateFilteredSql() {
  if (!selectedTable.value) return;
  const predicates = filters.value.map((filter) => {
    const column = selectedTable.value.columns.find((candidate) => candidate.name === filter.column) || {};
    return filter.operator.startsWith("IS ")
      ? `${quoteIdentifier(filter.column)} ${filter.operator}`
      : `${quoteIdentifier(filter.column)} ${filter.operator} ${sqlLiteral(filter.value, column)}`;
  });
  sqlText.value = `${defaultTableSql(selectedTable.value).replace(/;$/u, "")}${predicates.length ? `\nWHERE ${predicates.join("\n  AND ")}` : ""};`;
  rememberSelectedTableState();
}

function addFilter() {
  filters.value.push({ id: crypto.randomUUID(), ...filterDraft });
  filterDialog.value = false;
  filterDraft.value = "";
  regenerateFilteredSql();
}

function removeFilter(id = "") {
  filters.value = filters.value.filter((filter) => filter.id !== id);
  regenerateFilteredSql();
}

function focusRunButton() {
  const element = runButton.value?.$el || runButton.value;
  element?.focus?.();
}

async function requestRun() {
  if (!sqlText.value.trim() || running.value) return;
  await executeQuery();
}

async function executeQuery({ automatic = currentQueryIsDefault.value } = {}) {
  const queryId = crypto.randomUUID();
  const querySql = sqlText.value;
  activeQueryId.value = queryId;
  try {
    const result = await runQuery({
      automatic,
      confirmationDatabase: connection.value.database,
      confirmed: true,
      queryId,
      readOnly: automatic,
      sql: querySql,
      writeUnlocked: true
    });
    if (result) {
      queryResult.value = result;
      rememberSelectedTableState();
    }
    if (!automatic) await reload();
  } finally {
    if (activeQueryId.value === queryId) activeQueryId.value = "";
  }
}

async function cancelActiveQuery() {
  if (activeQueryId.value) await cancelQuery(activeQueryId.value);
}

async function refreshDatabaseSchema() {
  await refreshSchema();
}

function displayValue(value) {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function resultColumnLabel(column = {}) {
  const duplicates = queryResult.value?.columns?.filter((candidate) => candidate.label === column.label) || [];
  return duplicates.length > 1 ? `${column.label} · ${column.index + 1}` : column.label;
}

function cellMetadata(rowIndex, columnIndex) {
  return queryResult.value?.cellMeta?.[rowIndex]?.[columnIndex] || { editable: false, reason: "This result is read-only." };
}

function cellTitle(rowIndex, columnIndex) {
  const meta = cellMetadata(rowIndex, columnIndex);
  return meta.editable ? "Double-click to edit the physical source value" : meta.reason;
}

function openCellEditor(rowIndex, columnIndex) {
  const meta = cellMetadata(rowIndex, columnIndex);
  if (!meta.editable) return;
  const value = queryResult.value.rows[rowIndex][columnIndex];
  editingCell.value = { columnIndex, meta, rowIndex, value };
  editingNull.value = value === null;
  editingText.value = value == null ? "" : (typeof value === "object" ? JSON.stringify(value, null, 2) : String(value));
  cellValidationError.value = "";
  lookupItems.value = [];
  lookupSearch.value = "";
  selectedLookupItem.value = null;
  cellDialog.value = true;
}

async function loadLookup() {
  const lookup = editingColumn.value?.lookup;
  if (!lookup) return;
  const result = await searchLookup({ relationshipId: lookup.relationshipId, search: lookupSearch.value });
  lookupItems.value = result?.items || [];
}

function parsedValue(text, original, column = {}) {
  if (editingNull.value) return null;
  if (typeof original === "number") {
    const number = Number(text);
    if (!Number.isFinite(number)) throw new Error("Enter a valid number.");
    return number;
  }
  if (typeof original === "boolean") {
    if (!/^(?:true|false)$/iu.test(text.trim())) throw new Error("Enter true or false.");
    return text.trim().toLowerCase() === "true";
  }
  if (original && typeof original === "object") return JSON.parse(text);
  if (
    /json/iu.test(column.databaseType || "") &&
    (text.trim().startsWith("[") || text.trim().startsWith("{"))
  ) return JSON.parse(text);
  return text;
}

async function saveCell() {
  if (!editingCell.value) return;
  cellValidationError.value = "";
  let value;
  try {
    value = parsedValue(editingText.value, editingCell.value.value, editingColumn.value);
  } catch (error) {
    cellValidationError.value = String(error?.message || "Enter a valid value.");
    return;
  }
  const result = await updateCell({ edit: editingCell.value.meta, value });
  if (!result) return;
  cellDialog.value = false;
  await refreshVisibleRows();
}

function rowDeleteIdentity(rowIndex) {
  const sources = queryResult.value?.rowMeta?.[rowIndex] || [];
  return sources.length === 1 ? sources[0] : null;
}

function requestDeleteRow(rowIndex) {
  pendingDelete.value = rowDeleteIdentity(rowIndex);
  if (pendingDelete.value) deleteDialog.value = true;
}

async function confirmDeleteRow() {
  if (!pendingDelete.value) return;
  const result = await deleteRow({ confirmed: true, key: pendingDelete.value.key, table: pendingDelete.value.table });
  if (!result) return;
  deleteDialog.value = false;
  pendingDelete.value = null;
  await refreshVisibleRows();
}

function openInsertDialog() {
  if (!selectedTable.value) return;
  insertValidationError.value = "";
  for (const column of insertColumns.value) {
    insertValues[column.name] = "";
    insertIncluded[column.name] = !column.nullable && !column.default;
  }
  insertDialog.value = true;
}

function insertValue(column = {}) {
  const value = insertValues[column.name];
  if (value === "" && column.nullable) return null;
  return parsedValue(String(value ?? ""), "", { databaseType: column.nativeType });
}

async function saveInsertedRow() {
  insertValidationError.value = "";
  let values;
  try {
    values = Object.fromEntries(insertColumns.value.filter((column) => insertIncluded[column.name]).map((column) => [column.name, insertValue(column)]));
  } catch (error) {
    insertValidationError.value = String(error?.message || "Enter valid row values.");
    return;
  }
  const result = await insertRow({ table: { name: selectedTable.value.name, schema: selectedTable.value.schema }, values });
  if (!result) return;
  insertDialog.value = false;
  await refreshVisibleRows();
}

async function refreshVisibleRows() {
  const replaySafeCommands = new Set(["DESC", "DESCRIBE", "EXPLAIN", "SELECT", "SHOW"]);
  if (
    queryResult.value?.kind === "result-set" &&
    replaySafeCommands.has(String(queryResult.value.command || "").toUpperCase()) &&
    sqlText.value.trim()
  ) {
    await executeQuery();
    return;
  }
  queryResult.value = null;
  await reload();
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

let diagramSaveQueue = Promise.resolve();
let diagramSaveRevision = 0;
function saveDiagramLayout(layout) {
  const sessionId = props.sessionId;
  const revision = ++diagramSaveRevision;
  const previousLayout = erdLayout.value;
  const pending = JSON.parse(JSON.stringify(layout));
  pending.revision = previousLayout.revision || 0;
  diagramSavesPending.value += 1;
  erdLayout.value = pending;
  diagramSaveQueue = diagramSaveQueue.catch(() => null).then(async () => {
    try {
      if (disposed || props.sessionId !== sessionId) return;
      const result = await saveLayout(pending);
      if (!disposed && props.sessionId === sessionId && revision === diagramSaveRevision) {
        erdLayout.value = result?.layout || previousLayout;
      }
    } catch {
      // The command owns failure feedback; restore the last acknowledged layout.
      if (!disposed && props.sessionId === sessionId && revision === diagramSaveRevision) {
        erdLayout.value = previousLayout;
      }
    } finally {
      diagramSavesPending.value -= 1;
    }
  });
  return diagramSaveQueue;
}

function useAssistantSql(sql) {
  filters.value = [];
  updateSqlText(sql);
  activeView.value = "data";
}

async function askCopilot() {
  const content = assistantDraft.value.trim();
  if (!content || assistantBusy.value || !assistantCanRun.value) return;
  assistantMessages.value.push({ content, role: "user" });
  assistantDraft.value = "";
  const result = await askAssistant(assistantMessages.value.map(({ content: text, role }) => ({ content: text, role })));
  if (!result) return;
  assistantMessages.value.push({ content: result.answer, intent: result.intent, role: "assistant", sql: result.sql });
  const lastQuery = result.queries?.at(-1)?.result;
  if (lastQuery) {
    queryResult.value = lastQuery;
    rememberSelectedTableState();
  }
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
  border: 1px solid rgba(var(--v-theme-outline), 0.2);
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
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.18);
  background: rgb(var(--v-theme-surface-container-low));
}

.database-workspace__header--skeleton :deep(.v-skeleton-loader) { width: 100%; }
.database-workspace__identity, .database-workspace__header-actions, .database-workspace__query-toolbar, .database-workspace__query-actions, .database-workspace__query-options { display: flex; gap: 0.55rem; align-items: center; }
.database-workspace__header-actions { justify-content: flex-end; }
.database-workspace__identity { min-width: 0; }
.database-workspace__identity > div { min-width: 0; }
.database-workspace__identity strong, .database-workspace__identity span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.database-workspace__identity span { color: rgba(var(--v-theme-on-surface), 0.58); font-size: 0.7rem; }
.database-workspace__mark, .database-workspace__copilot-mark { display: grid; flex: 0 0 2.15rem; width: 2.15rem; height: 2.15rem; place-items: center; border-radius: 11px; background: rgba(var(--v-theme-primary), 0.12); color: rgb(var(--v-theme-primary)); }

.database-workspace__body, .database-workspace__loading { position: relative; display: grid; grid-template-columns: 15rem minmax(0, 1fr); min-height: 0; }
.database-workspace__body--copilot-open { grid-template-columns: 15rem minmax(0, 1fr) 20rem; }
.database-workspace__body--overview { grid-template-columns: minmax(0, 1fr); }
.database-workspace__body--overview.database-workspace__body--copilot-open { grid-template-columns: minmax(0, 1fr) 20rem; }
.database-workspace__body--overview > .database-workspace__navigator { display: none; }
.database-workspace__loading { height: 100%; }
.database-workspace__loading > * { padding: 1rem; border-right: 1px solid rgba(var(--v-theme-outline), 0.14); }
.database-workspace__navigator, .database-workspace__copilot { display: grid; min-height: 0; overflow: hidden; background: rgb(var(--v-theme-surface-container-lowest)); }
.database-workspace__navigator { grid-template-rows: auto auto minmax(8rem, 1fr); padding: 0.7rem; border-right: 1px solid rgba(var(--v-theme-outline), 0.16); }
.database-workspace__table-search { margin-bottom: 0.45rem; }
.database-workspace__nav-scroll { min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; margin-top: 0.45rem; scrollbar-gutter: stable; }
.database-workspace__saved-query { display: grid; box-sizing: border-box; width: 100%; min-width: 0; min-height: 2.65rem; grid-template-columns: 1.25rem minmax(0, 1fr) auto; gap: 0.35rem; align-items: center; padding: 0.3rem 0.45rem; border: 0; border-radius: 10px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.database-workspace__saved-query:hover { background: rgba(var(--v-theme-on-surface), 0.055); }
.database-workspace__saved-query:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: -2px; }
.database-workspace__saved-query span { min-width: 0; }
.database-workspace__saved-query strong, .database-workspace__saved-query small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.database-workspace__saved-query strong { font-size: 0.75rem; }
.database-workspace__saved-query small { color: rgba(var(--v-theme-on-surface), 0.55); font-size: 0.62rem; }
.database-workspace__empty-copy { padding: 1rem; color: rgba(var(--v-theme-on-surface), 0.55); font-size: 0.74rem; text-align: center; }

.database-workspace__main { min-width: 0; min-height: 0; overflow: hidden; display: grid; grid-template-rows: auto minmax(16rem, 1fr); }
.database-workspace__main > .database-erd, .database-workspace__main > .database-overview { grid-row: 1 / -1; }
.database-workspace__query { display: grid; grid-template-rows: auto 5.25rem; min-height: 0; border-bottom: 1px solid rgba(var(--v-theme-outline), 0.18); }
.database-workspace__query-toolbar { justify-content: space-between; min-height: 3.2rem; padding: 0.45rem 0.65rem; }
.database-workspace__query-actions { min-width: 0; flex-wrap: wrap; }
.database-workspace__editor-wrap { min-height: 0; margin: 0 0.65rem 0.65rem; overflow: hidden; border: 1px solid rgba(var(--v-theme-outline), 0.28); border-radius: 12px; background: rgb(var(--v-theme-surface-container-low)); }
.database-workspace__results { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; overflow: hidden; }
.database-workspace__results > header { display: flex; gap: 1rem; align-items: center; justify-content: space-between; min-height: 3.1rem; padding: 0.45rem 0.75rem; border-bottom: 1px solid rgba(var(--v-theme-outline), 0.14); }
.database-workspace__results > header > div { min-width: 0; }
.database-workspace__results > header strong, .database-workspace__results > header span { display: block; }
.database-workspace__results > header span { overflow: hidden; color: rgba(var(--v-theme-on-surface), 0.55); font-size: 0.66rem; text-overflow: ellipsis; white-space: nowrap; }
.database-workspace__results > header .v-text-field { max-width: 15rem; }
.database-workspace__table-wrap { min-height: 0; overflow: auto; }
.database-workspace__table-wrap table { width: max-content; min-width: 100%; border-collapse: separate; border-spacing: 0; font-size: 0.72rem; }
.database-workspace__table-wrap th, .database-workspace__table-wrap td { max-width: 24rem; padding: 0.42rem 0.6rem; overflow: hidden; border-right: 1px solid rgba(var(--v-theme-outline), 0.12); border-bottom: 1px solid rgba(var(--v-theme-outline), 0.12); text-overflow: ellipsis; white-space: nowrap; }
.database-workspace__table-wrap thead th { position: sticky; z-index: 2; top: 0; background: rgb(var(--v-theme-surface-container)); text-align: left; }
.database-workspace__table-wrap thead th span, .database-workspace__table-wrap thead th small { display: block; }
.database-workspace__table-wrap thead th small { color: rgba(var(--v-theme-on-surface), 0.48); font-size: 0.58rem; font-weight: 400; }
.database-workspace__row-number { position: sticky; z-index: 1; left: 0; width: 3rem; background: rgb(var(--v-theme-surface-container-low)); color: rgba(var(--v-theme-on-surface), 0.48); text-align: right !important; }
.database-workspace__row-actions { width: 4rem; text-align: center !important; }
.database-workspace__cell--editable { padding: 0 !important; }
.database-workspace__cell-editor { display: grid; width: 100%; min-width: 0; grid-template-columns: minmax(0, 1fr) auto; gap: 0.45rem; align-items: center; padding: 0.42rem 0.6rem; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.database-workspace__cell-editor:hover { background: rgba(var(--v-theme-primary), 0.1); }
.database-workspace__cell-editor:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: -2px; }
.database-workspace__cell-editor > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.database-workspace__cell-editor > .v-icon { color: rgb(var(--v-theme-primary)); opacity: 0.8; }
.database-workspace__null { color: rgba(var(--v-theme-on-surface), 0.42); font-style: italic; }
.database-workspace__empty-result, .database-workspace__command-result, .database-workspace__load-error, .database-workspace__copilot-unavailable { display: grid; align-content: center; justify-items: center; gap: 0.4rem; padding: 2rem; color: rgba(var(--v-theme-on-surface), 0.62); text-align: center; }
.database-workspace__empty-result strong, .database-workspace__command-result strong, .database-workspace__load-error strong, .database-workspace__copilot-unavailable strong { color: rgb(var(--v-theme-on-surface)); }
.database-workspace__empty-result span, .database-workspace__copilot-unavailable span { max-width: 30rem; font-size: 0.74rem; }
.database-workspace__result-skeleton { padding: 0.75rem; }

.database-workspace__copilot { grid-template-rows: auto minmax(0, 1fr); border-left: 1px solid rgba(var(--v-theme-outline), 0.16); }
.database-workspace__copilot > header { display: flex; gap: 0.55rem; align-items: center; min-height: 3.7rem; padding: 0.65rem; border-bottom: 1px solid rgba(var(--v-theme-outline), 0.15); }
.database-workspace__copilot > header > div { min-width: 0; flex: 1; }
.database-workspace__copilot > header strong, .database-workspace__copilot > header small { display: block; }
.database-workspace__copilot > header small { color: rgba(var(--v-theme-on-surface), 0.54); font-size: 0.63rem; }
.database-workspace__copilot-body { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; min-height: 0; }
.database-workspace__assistant-note { margin: 0.65rem; padding: 0.6rem; border-radius: 10px; background: rgba(var(--v-theme-tertiary), 0.09); color: rgba(var(--v-theme-on-surface), 0.68); font-size: 0.67rem; }
.database-workspace__messages { min-height: 0; overflow: auto; padding: 0.25rem 0.65rem 0.65rem; }
.database-workspace__messages article { margin: 0.5rem 0; padding: 0.65rem; border-radius: 13px; background: rgb(var(--v-theme-surface-container)); font-size: 0.73rem; }
.database-workspace__messages article.database-workspace__message--user { margin-left: 1.5rem; background: rgba(var(--v-theme-primary), 0.12); }
.database-workspace__messages article small { color: rgba(var(--v-theme-on-surface), 0.5); }
.database-workspace__messages article p { margin: 0.25rem 0; white-space: pre-wrap; }
.database-workspace__assistant-composer { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.45rem; align-items: end; padding: 0.65rem; border-top: 1px solid rgba(var(--v-theme-outline), 0.14); }
.database-workspace__assistant-skeleton { margin: 0.5rem 0; }
.database-workspace__filter-form, .database-workspace__edit-form { display: grid; gap: 0.25rem; padding-top: 1rem !important; }
.database-workspace__filter-form { grid-template-columns: 1fr 0.8fr 1fr; }
.database-workspace__filter-form p { grid-column: 1 / -1; color: rgba(var(--v-theme-on-surface), 0.6); font-size: 0.72rem; }
.database-workspace__insert-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.7rem; }
.database-workspace__load-error { height: 100%; }

@container (max-width: 1180px) {
  .database-workspace__body, .database-workspace__loading, .database-workspace__body--copilot-open { grid-template-columns: 13rem minmax(0, 1fr); }
  .database-workspace__body--overview, .database-workspace__body--overview.database-workspace__body--copilot-open { grid-template-columns: minmax(0, 1fr); }
  .database-workspace__copilot { position: absolute; z-index: 4; inset: 0 0 0 auto; width: min(22rem, calc(100% - 13rem)); border-left: 1px solid rgba(var(--v-theme-outline), 0.16); box-shadow: 0 8px 24px rgba(var(--v-theme-on-surface), 0.18); }
  .database-workspace__header { grid-template-columns: minmax(12rem, 1fr) auto auto; }
}

@container (max-width: 760px) {
  .database-workspace { min-height: 42rem; }
  .database-workspace__header { grid-template-columns: minmax(0, 1fr) auto; }
  .database-workspace__header > .v-btn-toggle { order: 3; grid-column: 1 / -1; justify-self: center; }
  .database-workspace__body, .database-workspace__loading, .database-workspace__body--copilot-open { grid-template-columns: 1fr; }
  .database-workspace__navigator { display: none; }
  .database-workspace__copilot { width: min(22rem, 100%); }
  .database-workspace__query-toolbar { align-items: flex-start; }
  .database-workspace__insert-form, .database-workspace__filter-form { grid-template-columns: 1fr; }
}

.database-workspace__insert-error { grid-column: 1 / -1; }
</style>
