<template>
  <div class="starred-files-list" :class="{ 'starred-files-list--compact': compact }">
    <v-alert v-if="bookmarks.error.value" density="compact" type="error" variant="tonal">
      {{ bookmarks.error.value }}
      <v-btn size="small" variant="text" @click="bookmarks.refresh">Retry</v-btn>
    </v-alert>
    <v-skeleton-loader v-if="bookmarks.loading.value && !bookmarks.files.value.length" :type="compact ? 'list-item@2' : 'list-item-two-line@2'" />
    <p v-else-if="!bookmarks.files.value.length" class="starred-files-list__empty">
      Star files in Files to keep them handy while chatting. Only you see your stars.
    </p>
    <p v-else-if="!displayedFiles.length" class="starred-files-list__empty">No matching starred files.</p>
    <ul v-else aria-label="Starred files">
      <li v-for="file in displayedFiles" :key="file.path">
        <button
          class="starred-files-list__open"
          :aria-label="compact ? file.path : undefined"
          :disabled="!file.available"
          :title="file.available ? file.path : `${file.path}: ${file.reason}`"
          type="button"
          @click="emit('open-file', file.path)"
        >
          <strong>{{ file.path.split('/').at(-1) }}</strong>
          <span v-if="!compact">{{ file.path }}</span>
          <span v-if="!compact && !file.available">{{ file.reason || 'Not found in this session' }}</span>
        </button>
        <v-btn
          :aria-label="`Unstar ${file.path}`"
          :disabled="bookmarks.pendingPaths.value.includes(file.path)"
          icon="$starFilled"
          size="small"
          title="Unstar file"
          variant="text"
          @click="bookmarks.toggle(file.path)"
        />
      </li>
    </ul>
  </div>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  bookmarks: { type: /** @type {import("vue").PropType<import("@/types.js").Vibe64StarredFiles>} */ (Object), required: true },
  compact: { type: Boolean, default: false },
  files: { type: Array, default: null }
});
const emit = defineEmits(["open-file"]);
const displayedFiles = computed(() => props.files ?? props.bookmarks.files.value);
</script>

<style scoped>
.starred-files-list {
  min-width: 0;
}

.starred-files-list ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.starred-files-list li {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.starred-files-list__open {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  padding: 0.5rem;
  text-align: left;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  border-radius: 0.5rem;
}

.starred-files-list__open:hover:not(:disabled) {
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.starred-files-list__open:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}

.starred-files-list__open strong {
  font-size: 0.875rem;
  font-weight: 500;
}

.starred-files-list__open span {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.starred-files-list__open strong,
.starred-files-list__open span {
  max-width: 100%;
  overflow-wrap: anywhere;
}

.starred-files-list__open:disabled {
  opacity: 0.65;
}

.starred-files-list--compact .starred-files-list__open strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.starred-files-list__empty {
  padding: 0.5rem;
  margin: 0;
  font-size: 0.8125rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
</style>
