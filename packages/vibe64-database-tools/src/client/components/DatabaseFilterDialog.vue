<template>
  <v-dialog v-model="open" max-width="38rem">
    <v-card>
      <v-card-title>Add a table filter</v-card-title>
      <v-card-text class="database-workspace__filter-form">
        <v-select v-model="filterDraft.column" :items="filterColumnOptions" label="Column" variant="outlined" />
        <v-select v-model="filterDraft.operator" :items="FILTER_OPERATORS" label="Operator" variant="outlined" />
        <v-text-field v-if="!filterDraft.operator.startsWith('IS ')" v-model="filterDraft.value" label="Value" variant="outlined" />
        <p>The generated SELECT remains ordinary editable SQL.</p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn type="button" variant="text" @click="open = false">Cancel</v-btn>
        <v-btn color="primary" :disabled="!filterDraft.column" type="button" variant="flat" @click="addFilter">Add filter</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, reactive } from "vue";

const FILTER_OPERATORS = ["=", "<>", ">", ">=", "<", "<=", "LIKE", "IS NULL", "IS NOT NULL"];

const props = defineProps({
  columns: { type: Array, required: true }
});
const emit = defineEmits(["add"]);
const open = defineModel({ type: Boolean, default: false });

const filterDraft = reactive({ column: "", operator: "=", value: "" });
const filterColumnOptions = computed(() => props.columns.map((column) => ({ title: `${column.name} · ${column.nativeType}`, value: column.name })));

/**
 * Adds the drafted filter and closes the dialog, keeping its column and operator for the next filter.
 */
function addFilter() {
  emit("add", { ...filterDraft });
  open.value = false;
  filterDraft.value = "";
}
</script>

<style scoped>
.database-workspace__filter-form { display: grid; gap: 0.25rem; padding-top: 1rem !important; grid-template-columns: 1fr 0.8fr 1fr; }
.database-workspace__filter-form p { grid-column: 1 / -1; color: rgba(var(--v-theme-on-surface), 0.6); font-size: 0.72rem; }

@container (max-width: 760px) {
  .database-workspace__filter-form { grid-template-columns: 1fr; }
}
</style>
