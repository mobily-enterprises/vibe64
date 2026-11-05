<template>
  <section class="database-workspace__query">
    <header class="database-workspace__query-toolbar">
      <div class="database-workspace__query-actions">
        <v-btn v-if="diagramReturn" :prepend-icon="mdiChevronLeft" size="small" variant="text" @click="emit('return-to-diagram')">
          Back to {{ diagramReturn.label }}
        </v-btn>
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
          @click="emit('run')"
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
          @click="emit('cancel')"
        >
          Cancel
        </v-btn>
        <v-btn
          :disabled="!selectedTable"
          :prepend-icon="mdiFilterPlusOutline"
          size="small"
          type="button"
          variant="text"
          @click="emit('open-filter')"
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
          @click="emit('reset')"
        >
          Reset to SELECT *
        </v-btn>
        <v-chip
          v-for="filter in filters"
          :key="filter.id"
          closable
          size="small"
          @click:close="emit('remove-filter', filter.id)"
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
          @click="emit('save')"
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
        @run="emit('run')"
        @update:model-value="emit('update:sqlText', $event)"
      />
    </div>
  </section>
</template>

<script setup>
import { ref } from "vue";
import {
  mdiBookmarkPlusOutline,
  mdiChevronLeft,
  mdiFilterPlusOutline,
  mdiPlay,
  mdiRestore,
  mdiStop
} from "@mdi/js";

import DatabaseSqlEditor from "./DatabaseSqlEditor.vue";

defineProps({
  activeQueryId: { type: String, default: "" },
  cancelling: { type: Boolean, default: false },
  diagramReturn: { type: Object, default: null },
  filters: { type: Array, required: true },
  running: { type: Boolean, default: false },
  schema: { type: Object, required: true },
  selectedTable: { type: Object, default: null },
  sqlText: { type: String, required: true }
});
const emit = defineEmits(["cancel", "open-filter", "remove-filter", "reset", "return-to-diagram", "run", "save", "update:sqlText"]);

const runButton = ref(null);

/**
 * Moves focus from the editor to Run, so Tab then Enter runs the SQL.
 */
function focusRunButton() {
  runButton.value?.$el.focus();
}
</script>

<style scoped>
.database-workspace__query { display: grid; grid-template-rows: auto 5.25rem; min-height: 0; border-bottom: 1px solid var(--v64-outline-variant); }
.database-workspace__query-toolbar, .database-workspace__query-actions, .database-workspace__query-options { display: flex; gap: 0.55rem; align-items: center; }
.database-workspace__query-toolbar { justify-content: space-between; min-height: 3.2rem; padding: 0.45rem 0.65rem; }
.database-workspace__query-actions { min-width: 0; flex-wrap: wrap; }
.database-workspace__editor-wrap { min-height: 0; margin: 0 0.65rem 0.65rem; overflow: hidden; border: 1px solid var(--v64-outline); border-radius: 12px; background: var(--v64-surface-container-low); }

@container (max-width: 760px) {
  .database-workspace__query-toolbar { align-items: flex-start; }
}
</style>
