<template>
  <v-list class="vibe64-file-area__body vibe64-file-area__listing" aria-label="Files and folders">
    <v-list-item v-for="entry in entries" :key="entry.path" class="vibe64-file-area__row">
      <!-- Each row is a list item whose name is a button covering the row;
           its own actions sit above that button. -->
      <button class="vibe64-file-area__open" :data-path="entry.path" :disabled="busy" type="button" @click="emit('open', entry)">
        <v-icon class="vibe64-file-area__open-icon" :icon="entryIcon(entry)" aria-hidden="true" />
        <span class="vibe64-file-area__open-text">
          <span class="vibe64-file-area__open-name">{{ entry.name }}</span>
          <span class="vibe64-file-area__open-detail">{{ entrySubtitle(entry) }}</span>
        </span>
      </button>
      <template #append>
        <v-btn
          v-if="entry.type === 'file' && !mobile"
          icon="$download"
          :aria-label="`Download ${entry.name}`"
          :loading="downloading.includes(entry.path)"
          title="Download"
          variant="text"
          @click.stop="emit('download', entry.path)"
        />
        <v-menu v-if="canWrite || canTransfer || mobile">
          <template #activator="{ props: menuProps }">
            <v-btn v-bind="menuProps" icon="$moreVert" :aria-label="`Actions for ${entry.name}`" variant="text" @click.stop />
          </template>
          <v-list class="v64-focus-rings">
            <v-list-item v-if="entry.type === 'file' && mobile" prepend-icon="$download" title="Download" @click="emit('download', entry.path)" />
            <v-list-item v-if="canTransfer" prepend-icon="$driveFileMove" :title="readOnly ? 'Copy to…' : 'Move or copy…'" @click="emit('transfer', entry)" />
            <v-list-item v-if="canWrite" prepend-icon="$edit" title="Rename" @click="emit('rename', entry)" />
            <v-list-item v-if="canWrite" prepend-icon="$delete" title="Delete" @click="emit('delete', entry)" />
          </v-list>
        </v-menu>
      </template>
    </v-list-item>
    <v-btn v-if="hasMore" class="ma-3" variant="text" :disabled="busy" @click="emit('show-more')">Show more</v-btn>
  </v-list>
</template>

<script setup>
import { filePreviewImageType } from "@local/vibe64-source-editor/shared/fileTypes";
import { formatFileSize } from "@/lib/vibe64FileSize.js";

// A Files area folder's items. Each opens from its row and offers download,
// move or copy, rename and delete as the area allows.
defineProps({
  busy: { type: Boolean, default: false },
  // Items can move or copy to another area.
  canTransfer: { type: Boolean, default: false },
  canWrite: { type: Boolean, default: false },
  // Paths downloading now.
  downloading: { type: Array, default: () => [] },
  entries: { type: Array, required: true },
  hasMore: { type: Boolean, default: false },
  mobile: { type: Boolean, default: false },
  readOnly: { type: Boolean, default: false }
});
const emit = defineEmits(["delete", "download", "open", "rename", "show-more", "transfer"]);

function entryIcon(entry) {
  if (entry.type === "directory") return "$folder";
  return filePreviewImageType(entry.name) ? "$image" : "$draft";
}

function entrySubtitle(entry) {
  if (entry.type !== "file") return "Folder";
  const expiry = entry.expiresAt ? ` · Deleted after ${new Date(entry.expiresAt).toLocaleDateString()}` : "";
  return `${formatFileSize(entry.size)}${expiry}`;
}
</script>

<style scoped>
.vibe64-file-area__listing {
  background: transparent;
}

.vibe64-file-area__open {
  align-items: center;
  appearance: none;
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  display: flex;
  font: inherit;
  gap: var(--v64-space-4);
  inline-size: 100%;
  min-inline-size: 0;
  padding: var(--v64-space-1) 0;
  text-align: start;
}

.vibe64-file-area__open:disabled {
  cursor: default;
}

/* The state layer and focus ring cover the whole row, so all of it opens the item. */
.vibe64-file-area__open::after {
  content: "";
  inset: 0;
  position: absolute;
  transition: background-color var(--v64-duration-short);
}

.vibe64-file-area__open:not(:disabled):hover::after {
  background-color: rgba(var(--v-theme-on-surface), var(--v64-state-hover));
}

.vibe64-file-area__open:focus-visible {
  outline: none;
}

.vibe64-file-area__open:focus-visible::after {
  background-color: rgba(var(--v-theme-on-surface), var(--v64-state-focus));
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: -2px;
}

.vibe64-file-area__row :deep(.v-list-item__append) {
  position: relative;
  z-index: 1;
}

.vibe64-file-area__open-icon {
  color: var(--v64-on-surface-variant);
  flex: none;
}

.vibe64-file-area__open-text {
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
}

.vibe64-file-area__open-name,
.vibe64-file-area__open-detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-file-area__open-name {
  font: var(--v64-type-body-lg);
}

.vibe64-file-area__open-detail {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
}
</style>
