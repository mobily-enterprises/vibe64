<template>
  <article
    class="database-erd-node"
    :class="{ 'database-erd-node--selected': data.highlighted, 'database-erd-node--dimmed': data.dimmed }"
    :style="{ width: ERD_NODE_WIDTH + 'px' }"
  >
    <Handle
      v-for="port in data.relationshipPorts"
      :id="port.id"
      :key="port.id"
      class="database-erd-node__port"
      :class="`database-erd-node__port--${port.type}`"
      :position="port.position"
      :style="{ top: port.y + 'px' }"
      :type="port.type"
    />
    <header :style="{ height: ERD_HEADER_HEIGHT + 'px' }">
      <div class="database-erd-node__title" :title="data.table.qualifiedName">
        <small>{{ data.table.schema }}</small>
        <strong>{{ data.table.name }}</strong>
      </div>
      <v-btn
        :aria-label="data.pinned ? 'Unpin table' : 'Pin table'"
        :aria-pressed="data.pinned"
        class="nodrag"
        :icon="data.pinned ? mdiPin : mdiPinOutline"
        size="x-small"
        variant="text"
        @click.stop="data.onPin(id)"
      />
      <v-btn
        v-if="controlsVisible"
        :aria-label="data.collapsed ? 'Expand table' : 'Collapse table'"
        class="nodrag"
        :icon="data.collapsed ? mdiChevronDown : mdiChevronUp"
        size="x-small"
        variant="text"
        @click.stop="data.onToggle(id)"
      />
    </header>
    <template v-if="!data.collapsed">
      <div
        v-for="column in data.columns"
        :key="column.name"
        class="database-erd-node__column"
        :class="{ 'database-erd-node__column--highlighted': data.highlightedColumns?.includes(column.name) }"
        :data-column="column.name"
        :style="{ height: ERD_ROW_HEIGHT + 'px' }"
        :title="`${column.name} · ${column.nativeType}${column.nullable ? ' · nullable' : ''}`"
      >
        <span class="database-erd-node__key">{{ data.primaryColumns.has(column.name) ? 'PK' : data.foreignColumns.has(column.name) ? 'FK' : data.uniqueColumns.has(column.name) ? 'UQ' : '' }}</span>
        <span>{{ column.name }}</span>
        <small>{{ column.nativeType }}{{ column.nullable ? ' ?' : '' }}</small>
      </div>
      <div v-if="!data.columns.length" class="database-erd-node__empty" :style="{ height: ERD_ROW_HEIGHT + 'px' }">No key columns</div>
      <footer :style="{ height: ERD_FOOTER_HEIGHT + 'px' }">
        <span :title="data.groupName">{{ data.groupName || data.table.kind }}</span>
        <button
          v-if="data.columnMode === 'keys' && data.table.columns.length > data.keyColumnCount"
          class="nodrag"
          type="button"
          @click.stop="data.onExpand(id)"
        >
          {{ data.expanded ? 'Keys only' : `Show all ${data.table.columns.length}` }}
        </button>
        <span v-else>{{ data.columns.length }} columns</span>
      </footer>
    </template>
  </article>
</template>

<script setup>
import { Handle } from "@vue-flow/core";
import { mdiChevronDown, mdiChevronUp, mdiPin, mdiPinOutline } from "@mdi/js";
import { ERD_NODE_WIDTH, ERD_HEADER_HEIGHT, ERD_ROW_HEIGHT, ERD_FOOTER_HEIGHT } from "../../shared/erdModel.js";

defineProps({
  controlsVisible: { default: true, type: Boolean },
  data: { required: true, type: Object },
  id: { required: true, type: String }
});
</script>

<style scoped>
.database-erd-node {
  position: relative;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  outline: 1px solid rgba(var(--v-theme-on-surface), 0.2);
  color: rgb(var(--v-theme-on-surface));
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
}
.database-erd-node--selected { outline: 2px solid rgb(var(--v-theme-primary)); }
.database-erd-node--dimmed { opacity: 0.35; }
.database-erd-node header {
  display: flex;
  align-items: center;
  padding: 0 8px 0 12px;
  border-radius: 12px 12px 0 0;
  background: rgba(var(--v-theme-primary), 0.09);
}
.database-erd-node__title { flex: 1; min-width: 0; }
.database-erd-node__title small,
.database-erd-node__title strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.database-erd-node__title small { font-size: 10px; opacity: 0.65; }
.database-erd-node__title strong { font-size: 14px; }
.database-erd-node__column {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  padding: 0 10px;
  font-size: 12px;
}
.database-erd-node__column > span:not(.database-erd-node__key) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.database-erd-node__column small { max-width: 95px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; opacity: 0.65; }
.database-erd-node__key { font-size: 9px; font-weight: 800; color: rgb(var(--v-theme-primary)); }
.database-erd-node__column--highlighted { background: rgba(var(--v-theme-primary), 0.18); font-weight: 700; }
.database-erd-node__empty { padding: 0 12px; font-size: 11px; opacity: 0.6; }
.database-erd-node__port { width: 6px; min-width: 6px; height: 6px; min-height: 6px; pointer-events: none; border: 1px solid rgb(var(--v-theme-surface)); }
.database-erd-node__port.vue-flow__handle-left { left: 0; transform: translate(-50%, -50%); }
.database-erd-node__port.vue-flow__handle-right { right: 0; transform: translate(50%, -50%); }
.database-erd-node__port--source { background: rgb(var(--v-theme-secondary)); }
.database-erd-node__port--target { background: rgb(var(--v-theme-primary)); }
.database-erd-node footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 0 12px; border-top: 1px solid rgba(var(--v-theme-on-surface), 0.12); font-size: 10px; }
.database-erd-node footer > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.database-erd-node footer button { color: rgb(var(--v-theme-primary)); white-space: nowrap; }
</style>
