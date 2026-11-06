<template>
  <aside class="database-workspace__navigator">
    <v-text-field
      v-model="search"
      aria-label="Find tables and views"
      class="database-workspace__table-search"
      clearable
      density="compact"
      hide-details
      prepend-inner-icon="$search"
      placeholder="Find tables…"
      variant="outlined"
    />
    <v-btn-toggle v-model="tab" mandatory density="compact" variant="text">
      <v-btn size="x-small" value="tables">Tables</v-btn>
      <v-btn size="x-small" value="saved">Saved</v-btn>
      <v-btn size="x-small" value="history">History</v-btn>
    </v-btn-toggle>

    <DatabaseTableList
      v-if="tab === 'tables'"
      :active="active"
      :schema="schema" :selected-table-name="selectedTableName" :search="search"
      :database="database" :running="running" @select-table="emit('select-table', $event)"
    >
      <template #table-actions>
        <v-btn v-if="writeAvailable" prepend-icon="$add" size="x-small" title="Insert a row into this table" variant="text" @click="emit('add-row')">Add row</v-btn>
      </template>
    </DatabaseTableList>
    <div v-else-if="tab === 'saved'" class="database-workspace__nav-scroll">
      <button
        v-for="snippet in snippets"
        :key="snippet.id"
        class="database-workspace__saved-query"
        type="button"
        @click="emit('load-sql', snippet.sql)"
      >
        <v-icon icon="$bookmark" size="15" />
        <span><strong>{{ snippet.name }}</strong><small>{{ shortDate(snippet.updatedAt) }}</small></span>
        <v-btn
          icon="$delete"
          size="x-small"
          title="Delete snippet"
          type="button"
          variant="text"
          @click.stop="emit('remove-snippet', snippet.id)"
        />
      </button>
      <p v-if="snippets.length === 0" class="database-workspace__empty-copy">Saved queries stay with this session.</p>
    </div>

    <div v-else class="database-workspace__nav-scroll">
      <button
        v-for="entry in history"
        :key="entry.id"
        class="database-workspace__saved-query"
        type="button"
        @click="emit('load-sql', entry.sql)"
      >
        <v-icon :color="entry.ok ? undefined : 'error'" :icon="entry.ok ? '$history' : '$error'" size="15" />
        <span>
          <strong>{{ firstSqlLine(entry.sql) }}</strong>
          <small>{{ shortDate(entry.at) }} · {{ entry.durationMs }} ms</small>
        </span>
      </button>
      <p v-if="history.length === 0" class="database-workspace__empty-copy">Statements you run appear here.</p>
    </div>
  </aside>
</template>

<script setup>

import { firstSqlLine, shortDate } from "../databaseText.js";
import DatabaseTableList from "./DatabaseTableList.vue";

defineProps({
  active: { type: Boolean, default: true },
  database: { type: String, default: "" },
  history: { type: Array, required: true },
  running: { type: Boolean, default: false },
  schema: { type: Object, required: true },
  selectedTableName: { type: String, default: "" },
  snippets: { type: Array, required: true },
  writeAvailable: { type: Boolean, default: true }
});
const emit = defineEmits(["add-row", "load-sql", "remove-snippet", "select-table"]);
const search = defineModel("search", { type: String, default: "" });
const tab = defineModel("tab", { type: String, default: "tables" });
</script>

<style scoped>
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
</style>
