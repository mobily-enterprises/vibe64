<template>
  <v-dialog v-model="cellDialog" max-width="42rem">
    <v-card>
      <v-card-title>Edit {{ editingColumn?.label }}</v-card-title>
      <v-card-text class="database-workspace__edit-form">
        <p v-if="editingColumn?.origin"><code>{{ editingColumn.origin.schema }}.{{ editingColumn.origin.table }}.{{ editingColumn.origin.column }}</code></p>
        <SelectField
          v-if="editingColumn?.lookup"
          v-model="selectedLookupItem"
          v-model:search="lookupSearch"
          searchable
          :hint="lookupBusy ? 'Searching lookup table…' : 'Suggestions come from the declared foreign-key target.'"
          :items="lookupItems"
          item-title="display"
          label="Choose from referenced table"
          :loading="lookupBusy"
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
</template>

<script setup>
import { toRef } from "vue";
import SelectField from "@jskit-ai/http-web/client/components/SelectField";

import { useDatabaseRowEditing } from "../composables/useDatabaseRowEditing.js";

const props = defineProps({
  deleteRow: { type: Function, required: true },
  deleting: { type: Boolean, default: false },
  insertRow: { type: Function, required: true },
  inserting: { type: Boolean, default: false },
  lookupBusy: { type: Boolean, default: false },
  queryResult: { type: Object, default: null },
  searchLookup: { type: Function, required: true },
  selectedTable: { type: Object, default: null },
  updateCell: { type: Function, required: true },
  updating: { type: Boolean, default: false }
});
const emit = defineEmits(["changed"]);

const {
  cellDialog,
  cellValidationError,
  confirmDeleteRow,
  deleteDialog,
  editingColumn,
  editingNull,
  editingText,
  hasInsertValues,
  insertColumns,
  insertDialog,
  insertIncluded,
  insertValidationError,
  insertValues,
  lookupItems,
  lookupSearch,
  openCellEditor,
  openInsertDialog,
  pendingDelete,
  requestDeleteRow,
  saveCell,
  saveInsertedRow,
  selectedLookupItem
} = useDatabaseRowEditing({
  changed: () => emit("changed"),
  deleteRow: (request) => props.deleteRow(request),
  insertRow: (request) => props.insertRow(request),
  queryResult: toRef(props, "queryResult"),
  searchLookup: (request) => props.searchLookup(request),
  selectedTable: toRef(props, "selectedTable"),
  updateCell: (request) => props.updateCell(request)
});

defineExpose({ openCellEditor, openInsertDialog, requestDeleteRow });
</script>

<style scoped>
.database-workspace__edit-form { display: grid; gap: 0.25rem; padding-top: 1rem !important; }
.database-workspace__insert-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.7rem; }

@container (max-width: 760px) {
  .database-workspace__insert-form { grid-template-columns: 1fr; }
}

.database-workspace__insert-error { grid-column: 1 / -1; }
</style>
