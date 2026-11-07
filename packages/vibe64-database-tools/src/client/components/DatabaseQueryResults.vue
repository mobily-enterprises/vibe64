<template>
  <section class="database-workspace__results">
    <header>
      <div>
        <strong>{{ resultTitle }}</strong>
        <span v-if="queryResult" :title="resultSubtitle">{{ resultSubtitle }}</span>
      </div>
      <v-text-field
        v-if="queryResult?.kind === 'result-set'"
        v-model="search"
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
              :class="{ 'database-workspace__cell--editable': cellMetadata(queryResult, entry.index, columnIndex).editable }"
              :title="cellTitle(entry.index, columnIndex)"
            >
              <button
                v-if="cellMetadata(queryResult, entry.index, columnIndex).editable"
                :aria-label="`Edit ${resultColumnLabel(queryResult.columns[columnIndex])}: ${displayValue(value)}`"
                class="database-workspace__cell-editor"
                type="button"
                @click="emit('edit-cell', entry.index, columnIndex)"
              >
                <span :class="{ 'database-workspace__null': value === null }">{{ displayValue(value) }}</span>
                <v-icon :icon="mdiPencilOutline" size="15" />
              </button>
              <span v-else :class="{ 'database-workspace__null': value === null }">{{ displayValue(value) }}</span>
            </td>
            <td class="database-workspace__row-actions">
              <v-btn
                :disabled="!rowDeleteIdentity(queryResult, entry.index)"
                :icon="mdiDeleteOutline"
                size="x-small"
                title="Delete source row"
                type="button"
                variant="text"
                @click="emit('delete-row', entry.index)"
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
        @click="emit('refresh-schema')"
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

<script setup>
import { computed } from "vue";
import {
  mdiCheckCircleOutline,
  mdiDeleteOutline,
  mdiMagnify,
  mdiPencilOutline,
  mdiRefresh,
  mdiTableSearch
} from "@mdi/js";

import { displayValue } from "../databaseText.js";
import { cellMetadata, rowDeleteIdentity } from "../queryResultCells.js";

const props = defineProps({
  queryResult: { type: Object, default: null },
  refreshing: { type: Boolean, default: false },
  running: { type: Boolean, default: false }
});
const emit = defineEmits(["delete-row", "edit-cell", "refresh-schema"]);
const search = defineModel("search", { type: String, default: "" });

const filteredResultRows = computed(() => {
  const rows = Array.isArray(props.queryResult?.rows) ? props.queryResult.rows : [];
  const text = String(search.value || "").trim().toLowerCase();
  return rows.map((row, index) => ({ index, row })).filter(({ row }) => (
    !text || row.some((value) => displayValue(value).toLowerCase().includes(text))
  ));
});
const resultTitle = computed(() => {
  if (!props.queryResult) return "Results";
  if (props.queryResult.kind === "command") return "Statement complete";
  if (props.queryResult.fullRowCount == null && props.queryResult.rowCountMoreThan != null) {
    return `More than ${props.queryResult.rowCountMoreThan} rows`;
  }
  return `${props.queryResult.fullRowCount ?? props.queryResult.rows?.length ?? 0} rows`;
});
const resultEditHint = computed(() => {
  if (props.queryResult?.kind !== "result-set") return "";
  if (!props.queryResult.rows?.length) return "No rows to edit";
  const metadata = props.queryResult.cellMeta || [];
  if (metadata.some((row) => row.some((cell) => cell?.editable))) {
    return "Pencil-marked cells are editable—click one to change its source value";
  }
  const reason = metadata.flat().find((cell) => cell?.reason)?.reason;
  return reason ? `Read-only result: ${reason}` : "Read-only result";
});
const resultSubtitle = computed(() => {
  if (!props.queryResult) return "";
  const truncation = props.queryResult.truncated ? " · limited result" : "";
  const editHint = resultEditHint.value ? ` · ${resultEditHint.value}` : "";
  return `${props.queryResult.durationMs || 0} ms${truncation}${editHint}`;
});

/**
 * A column's label, numbered when the result has several columns with that label.
 * @param {Record<string, any>} [column]
 */
function resultColumnLabel(column = {}) {
  const duplicates = props.queryResult?.columns?.filter((candidate) => candidate.label === column.label) || [];
  return duplicates.length > 1 ? `${column.label} · ${column.index + 1}` : column.label;
}

/**
 * @param {number} rowIndex
 * @param {number} columnIndex
 */
function cellTitle(rowIndex, columnIndex) {
  const meta = cellMetadata(props.queryResult, rowIndex, columnIndex);
  return meta.editable ? "Double-click to edit the physical source value" : meta.reason;
}
</script>

<style scoped>
.database-workspace__results { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; overflow: hidden; }
.database-workspace__results > header { display: flex; gap: 1rem; align-items: center; justify-content: space-between; min-height: 3.1rem; padding: 0.45rem 0.75rem; border-bottom: 1px solid var(--v64-outline-variant); }
.database-workspace__results > header > div { min-width: 0; }
.database-workspace__results > header strong, .database-workspace__results > header span { display: block; }
.database-workspace__results > header span { overflow: hidden; color: rgba(var(--v-theme-on-surface), 0.55); font-size: 0.66rem; text-overflow: ellipsis; white-space: nowrap; }
.database-workspace__results > header .v-text-field { max-width: 15rem; }
.database-workspace__table-wrap { min-height: 0; overflow: auto; }
.database-workspace__table-wrap table { width: max-content; min-width: 100%; border-collapse: separate; border-spacing: 0; font-size: 0.72rem; }
.database-workspace__table-wrap th, .database-workspace__table-wrap td { max-width: 24rem; padding: 0.42rem 0.6rem; overflow: hidden; border-right: 1px solid var(--v64-outline-variant); border-bottom: 1px solid var(--v64-outline-variant); text-overflow: ellipsis; white-space: nowrap; }
.database-workspace__table-wrap thead th { position: sticky; z-index: 2; top: 0; background: var(--v64-surface-container); text-align: left; }
.database-workspace__table-wrap thead th span, .database-workspace__table-wrap thead th small { display: block; }
.database-workspace__table-wrap thead th small { color: rgba(var(--v-theme-on-surface), 0.48); font-size: 0.58rem; font-weight: 400; }
.database-workspace__row-number { position: sticky; z-index: 1; left: 0; width: 3rem; background: var(--v64-surface-container-low); color: rgba(var(--v-theme-on-surface), 0.48); text-align: right !important; }
.database-workspace__row-actions { width: 4rem; text-align: center !important; }
.database-workspace__cell--editable { padding: 0 !important; }
.database-workspace__cell-editor { display: grid; width: 100%; min-width: 0; grid-template-columns: minmax(0, 1fr) auto; gap: 0.45rem; align-items: center; padding: 0.42rem 0.6rem; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.database-workspace__cell-editor:hover { background: rgba(var(--v-theme-primary), 0.1); }
.database-workspace__cell-editor:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: -2px; }
.database-workspace__cell-editor > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.database-workspace__cell-editor > .v-icon { color: rgb(var(--v-theme-primary)); opacity: 0.8; }
.database-workspace__null { color: rgba(var(--v-theme-on-surface), 0.42); font-style: italic; }
.database-workspace__empty-result, .database-workspace__command-result { display: grid; align-content: center; justify-items: center; gap: 0.4rem; padding: 2rem; color: rgba(var(--v-theme-on-surface), 0.62); text-align: center; }
.database-workspace__empty-result strong, .database-workspace__command-result strong { color: rgb(var(--v-theme-on-surface)); }
.database-workspace__empty-result span { max-width: 30rem; font-size: 0.74rem; }
.database-workspace__result-skeleton { padding: 0.75rem; }
.database-workspace__empty-copy { padding: 1rem; color: rgba(var(--v-theme-on-surface), 0.55); font-size: 0.74rem; text-align: center; }
</style>
