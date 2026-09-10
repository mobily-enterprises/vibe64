<template>
  <div class="database-table-list">
    <div class="database-workspace__nav-scroll">
      <template v-for="group in filteredSchemas" :key="group.name">
        <div class="database-workspace__schema-label">
          <span>{{ group.name || database }}</span>
          <small>{{ group.tables.length }}</small>
        </div>
        <button
          v-for="table in group.tables"
          :key="table.qualifiedName"
          :class="{ 'database-workspace__table-button--active': selectedTableName === table.qualifiedName }"
          class="database-workspace__table-button"
          :disabled="running"
          :title="table.comment || table.qualifiedName"
          type="button"
          @click="emit('select-table', table)"
        >
          <v-icon :icon="table.kind.includes('view') ? mdiTableEye : mdiTable" size="15" />
          <span>
            <strong>{{ table.name }}</strong>
            <small>{{ table.kind }} · {{ table.columns.length }} fields</small>
          </span>
        </button>
      </template>
      <p v-if="filteredSchemas.length === 0" class="database-workspace__empty-copy">No matching tables or views.</p>
    </div>

    <section v-if="selectedTable" class="database-workspace__table-detail">
      <header>
        <strong>{{ selectedTable.name }}</strong>
        <slot name="table-actions" :table="selectedTable" />
      </header>
      <p v-if="selectedTable.comment">{{ selectedTable.comment }}</p>
      <component
        v-for="column in selectedTable.columns"
        :key="column.name"
        :is="interactiveColumns ? 'button' : 'div'"
        :type="interactiveColumns ? 'button' : undefined"
        :title="column.comment || column.nativeType"
        class="database-table-list__column"
        @click="emit('select-column', column)"
      >
        <v-icon :icon="columnKeyIcon(column)" size="13" />
        <span>{{ column.name }}</span>
        <small>{{ column.nativeType }}</small>
      </component>
    </section>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { mdiTable, mdiTableEye, mdiKeyVariant, mdiLinkVariant } from "@mdi/js";
const props = defineProps({
  schema: { type: Object, required: true },
  selectedTableName: { type: String, default: "" },
  search: { type: String, default: "" },
  database: { type: String, default: "" },
  running: { type: Boolean, default: false },
  interactiveColumns: { type: Boolean, default: false }
});
const emit = defineEmits(["select-table", "select-column"]);
const selectedTable = computed(() => props.schema.tables.find((table) => table.qualifiedName === props.selectedTableName));
const filteredSchemas = computed(() => {
  const search = (props.search || "").trim().toLowerCase();
  return (props.schema.schemas || []).map((group) => ({
    ...group,
    tables: (props.schema.tables || []).filter((table) => (
      table.schema === group.name && (!search || `${table.qualifiedName} ${table.comment}`.toLowerCase().includes(search))
    ))
  })).filter((group) => group.tables.length > 0);
});
function columnKeyIcon(column = {}) {
  const primary = selectedTable.value?.keys?.some((key) => key.primary && key.columns.includes(column.name));
  if (primary) return mdiKeyVariant;
  const foreign = props.schema.relationships?.some((relationship) => relationship.sourceTable === selectedTable.value?.qualifiedName && relationship.columns.includes(column.name));
  return foreign ? mdiLinkVariant : mdiTable;
}
</script>

<style scoped>
.database-table-list { display: grid; grid-template-rows: minmax(5rem, 1fr) auto; min-height: 0; overflow: hidden; }
.database-workspace__nav-scroll { min-width: 0; min-height: 0; overflow-x: hidden; overflow-y: auto; margin-top: 0.45rem; scrollbar-gutter: stable; }
.database-workspace__schema-label { display: flex; min-width: 0; gap: 0.35rem; justify-content: space-between; padding: 0.7rem 0.45rem 0.3rem; color: rgba(var(--v-theme-on-surface), 0.55); font-size: 0.64rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.database-workspace__schema-label > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.database-workspace__table-button { display: grid; box-sizing: border-box; width: 100%; min-width: 0; min-height: 2.65rem; grid-template-columns: 1.25rem minmax(0, 1fr); gap: 0.35rem; align-items: center; padding: 0.3rem 0.45rem; border: 0; border-radius: 10px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.database-workspace__table-button:hover { background: rgba(var(--v-theme-on-surface), 0.055); }
.database-workspace__table-button:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: -2px; }
.database-workspace__table-button--active { background: rgba(var(--v-theme-primary), 0.11) !important; color: rgb(var(--v-theme-primary)); }
.database-workspace__table-button span { min-width: 0; }
.database-workspace__table-button strong, .database-workspace__table-button small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.database-workspace__table-button strong { font-size: 0.75rem; }
.database-workspace__table-button small { color: rgba(var(--v-theme-on-surface), 0.55); font-size: 0.62rem; }
.database-workspace__empty-copy { padding: 1rem; color: rgba(var(--v-theme-on-surface), 0.55); font-size: 0.74rem; text-align: center; }
.database-workspace__table-detail { max-height: 16rem; overflow: auto; margin-top: 0.55rem; padding-top: 0.5rem; border-top: 1px solid rgba(var(--v-theme-outline), 0.16); }
.database-workspace__table-detail header { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; justify-content: space-between; }
.database-workspace__table-detail header strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.database-workspace__table-detail p { color: rgba(var(--v-theme-on-surface), 0.65); font-size: 0.68rem; }
.database-table-list__column { display: grid; grid-template-columns: 1rem minmax(0, 1fr) auto; gap: 0.3rem; padding: 0.22rem; font-size: 0.66rem; width: 100%; text-align: left; color: inherit; border: 0; border-radius: 3px; background: transparent; }
.database-table-list__column small { max-width: 6rem; overflow: hidden; color: rgba(var(--v-theme-on-surface), 0.5); text-overflow: ellipsis; white-space: nowrap; }
.database-table-list__column:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); }
.database-table-list__column > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button.database-table-list__column:hover { background: rgba(var(--v-theme-primary), .08); }
</style>
