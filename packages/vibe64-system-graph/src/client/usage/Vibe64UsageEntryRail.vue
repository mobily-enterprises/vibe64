<template>
  <section class="usage-entry-rail" aria-label="Entry points">
    <v-text-field
      :model-value="search"
      class="usage-entry-rail__search"
      label="Search entries"
      :prepend-inner-icon="mdiMagnify"
      variant="outlined"
      density="comfortable"
      maxlength="80"
      clearable
      hide-details
      @update:model-value="emit('update:search', $event || '')"
    />
    <v-chip-group
      v-if="kinds.length"
      :model-value="kind"
      class="usage-entry-rail__kinds"
      column
      selected-class="usage-entry-rail__kind--selected"
      aria-label="Entry kinds"
      @update:model-value="emit('update:kind', $event || '')"
    >
      <v-chip v-for="item in kinds" :key="item.kind" :value="item.kind" filter variant="outlined" size="small">
        {{ entryKind(item.kind).plural }} · {{ item.count }}
      </v-chip>
    </v-chip-group>

    <div class="usage-entry-rail__body">
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="ma-3">
        {{ error }}
        <template #append><v-btn variant="text" size="small" @click="emit('retry')">Retry</v-btn></template>
      </v-alert>
      <div v-else-if="loading && !entries.length" class="pa-2" aria-busy="true" aria-label="Loading entry points">
        <v-skeleton-loader v-for="row in 6" :key="row" type="list-item-two-line" />
      </div>
      <div v-else-if="!entries.length" class="usage-entry-rail__empty" role="status">
        <template v-if="search || kind">
          <p class="text-body-medium">No entry points match.</p>
        </template>
        <template v-else>
          <p class="text-body-medium">No entry points found yet. Refresh the architecture scan.</p>
          <v-btn variant="tonal" :loading="refreshing" :prepend-icon="mdiRefresh" @click="emit('refresh')">Refresh</v-btn>
        </template>
      </div>
      <v-virtual-scroll v-else :items="rows" item-key="id" class="usage-entry-rail__list" role="listbox" aria-label="Entry points">
        <template #default="{ item }">
          <v-btn v-if="item.more" block variant="text" class="my-1" :loading="loading" @click="emit('more')">Show more</v-btn>
          <v-list-item
            v-else
            :active="item.id === selectedId"
            role="option"
            :aria-selected="item.id === selectedId"
            :prepend-icon="entryKind(item.kind).icon"
            :aria-label="`${entryKind(item.kind).label}: ${item.title}, ${item.file}`"
            color="primary"
            rounded="xl"
            lines="two"
            class="usage-entry-rail__item"
            @click="emit('select', item)"
          >
            <template #title><template v-for="(part, position) in pathParts(item.title)" :key="position">{{ part }}<wbr></template></template>
            <template #subtitle><template v-for="(part, position) in pathParts(item.file)" :key="position">{{ part }}<wbr></template></template>
          </v-list-item>
        </template>
      </v-virtual-scroll>
    </div>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { mdiMagnify, mdiRefresh } from "@mdi/js";

import { entryKind, pathParts } from "./usageModel.js";

const props = defineProps({
  entries: { type: Array, default: () => [] },
  kinds: { type: Array, default: () => [] },
  search: { type: String, default: "" },
  kind: { type: String, default: "" },
  selectedId: { type: String, default: "" },
  loading: { type: Boolean, default: false },
  error: { type: String, default: "" },
  hasMore: { type: Boolean, default: false },
  refreshing: { type: Boolean, default: false }
});
const emit = defineEmits(["update:search", "update:kind", "select", "more", "retry", "refresh"]);
const rows = computed(() => (props.hasMore ? [...props.entries, { id: "\u0000more", more: true }] : props.entries));
</script>

<style scoped>
.usage-entry-rail { display: flex; flex-direction: column; min-height: 0; height: 100%; gap: 8px; padding: 12px 8px 0; }
.usage-entry-rail__search { flex: none; padding: 0 4px; }
.usage-entry-rail__kinds { flex: none; padding: 0 4px; }
.usage-entry-rail__kinds :deep(.v-chip--variant-outlined) { border-color: var(--v64-outline); }
.usage-entry-rail :deep(.usage-entry-rail__kind--selected) { border-color: transparent; background: var(--v64-secondary-container); color: var(--v64-on-secondary-container); }
.usage-entry-rail__body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.usage-entry-rail__list { flex: 1; min-height: 0; padding-bottom: 8px; }
.usage-entry-rail__item { min-height: 56px; }
/* Titles and paths wrap between folders, like request rows. */
.usage-entry-rail__item :deep(.v-list-item-title) { white-space: normal; overflow-wrap: break-word; }
.usage-entry-rail__item :deep(.v-list-item-subtitle) { -webkit-line-clamp: unset; overflow-wrap: break-word; }
.usage-entry-rail__empty { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 16px 12px; }
.usage-entry-rail__empty p { margin: 0; }
/* Touch: 48 px targets; chips keep their look and gain an invisible margin. */
@media (pointer: coarse) {
  .usage-entry-rail__kinds :deep(.v-chip) { position: relative; overflow: visible; margin-block: 8px; }
  .usage-entry-rail__kinds :deep(.v-chip)::after { content: ""; position: absolute; inset: -8px 0; }
}
</style>
