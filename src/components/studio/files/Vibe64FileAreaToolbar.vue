<template>
  <div class="vibe64-file-area__toolbar">
    <nav v-if="directory" class="vibe64-file-area__crumbs" aria-label="Folder">
      <template v-for="(crumb, index) in breadcrumbs" :key="crumb.path">
        <v-icon v-if="index" :icon="mdiChevronRight" size="18" aria-hidden="true" />
        <span v-if="index === breadcrumbs.length - 1" class="vibe64-file-area__crumb-current" aria-current="location">{{ crumb.title }}</span>
        <v-btn v-else :disabled="loading || busy" variant="text" @click="emit('open-folder', crumb.path)">{{ crumb.title }}</v-btn>
      </template>
    </nav>
    <div v-if="!mobile" class="vibe64-file-area__actions">
      <v-btn v-if="archiveAvailable" :prepend-icon="mdiDownload" variant="text" :loading="archiveDownloading" @click="emit('download-archive')">Download archive</v-btn>
      <v-btn v-if="location" :prepend-icon="mdiContentCopy" variant="text" @click="emit('copy-location')">Copy AI path</v-btn>
      <v-btn :icon="mdiRefresh" aria-label="Refresh files" title="Refresh files" variant="text" :disabled="loading || busy" @click="emit('refresh')" />
      <template v-if="canWrite">
        <v-btn :prepend-icon="mdiFolderPlusOutline" variant="text" :disabled="busy" @click="emit('new-folder')">New folder</v-btn>
        <v-btn :prepend-icon="mdiFilePlusOutline" variant="text" :disabled="busy" @click="emit('new-file')">New file</v-btn>
        <v-btn :prepend-icon="mdiUpload" color="primary" variant="flat" @click="emit('upload')">Upload</v-btn>
      </template>
    </div>
    <div v-else class="vibe64-file-area__actions">
      <v-btn v-if="canWrite" :icon="mdiUpload" aria-label="Upload files" color="primary" variant="tonal" @click="emit('upload')" />
      <v-menu>
        <template #activator="{ props: menuProps }">
          <v-btn v-bind="menuProps" :icon="mdiDotsVertical" aria-label="More folder actions" variant="text" />
        </template>
        <v-list class="v64-focus-rings">
          <v-list-item v-if="canWrite" :prepend-icon="mdiFilePlusOutline" title="New file" :disabled="busy" @click="emit('new-file')" />
          <v-list-item v-if="canWrite" :prepend-icon="mdiFolderPlusOutline" title="New folder" :disabled="busy" @click="emit('new-folder')" />
          <v-list-item v-if="location" :prepend-icon="mdiContentCopy" title="Copy AI path" @click="emit('copy-location')" />
          <v-list-item v-if="archiveAvailable" :prepend-icon="mdiDownload" title="Download archive" :disabled="archiveDownloading" @click="emit('download-archive')" />
          <v-list-item :prepend-icon="mdiRefresh" title="Refresh" :disabled="loading || busy" @click="emit('refresh')" />
        </v-list>
      </v-menu>
    </div>
  </div>
</template>

<script setup>
import {
  mdiChevronRight,
  mdiContentCopy,
  mdiDotsVertical,
  mdiDownload,
  mdiFilePlusOutline,
  mdiFolderPlusOutline,
  mdiRefresh,
  mdiUpload
} from "@mdi/js";

// A Files area's folder toolbar: the folder's path and the folder actions.
// The tab names the area, so the path shows only inside a folder.
defineProps({
  // A finished session's files download as one archive.
  archiveAvailable: { type: Boolean, default: false },
  archiveDownloading: { type: Boolean, default: false },
  breadcrumbs: { type: Array, required: true },
  busy: { type: Boolean, default: false },
  canWrite: { type: Boolean, default: false },
  directory: { type: String, default: "" },
  loading: { type: Boolean, default: false },
  location: { type: String, default: "" },
  mobile: { type: Boolean, default: false }
});
const emit = defineEmits(["copy-location", "download-archive", "new-file", "new-folder", "open-folder", "refresh", "upload"]);
</script>

<style scoped>
.vibe64-file-area__toolbar {
  align-items: center;
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: var(--v64-space-1);
  padding: var(--v64-space-2) var(--v64-space-2) 0 var(--v64-space-2);
}

.vibe64-file-area__crumbs {
  align-items: center;
  display: flex;
  flex: 1 1 12rem;
  flex-wrap: wrap;
  min-inline-size: 0;
}

.vibe64-file-area__crumbs .v-btn {
  font: var(--v64-type-title-md);
  min-inline-size: 0;
  padding-inline: var(--v64-space-2);
  text-transform: none;
}

.vibe64-file-area__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  margin-inline-start: auto;
}

.vibe64-file-area__crumb-current {
  color: rgb(var(--v-theme-on-surface));
  font: var(--v64-type-title-md);
  overflow-wrap: anywhere;
  padding-inline: var(--v64-space-2);
}

.vibe64-file-area--mobile .vibe64-file-area__crumbs .v-btn {
  min-block-size: 48px;
}
</style>
