<template>
  <header class="vibe64-source-editor__header">
    <v-btn
      v-if="!singleFile && mobile && !codeFocusMode"
      :aria-expanded="!fileListCollapsed"
      :aria-label="fileListCollapsed ? 'Show files' : 'Hide files'"
      :icon="fileListCollapsed ? mdiFolderOutline : mdiClose"
      variant="text"
      @click="fileListCollapsed = !fileListCollapsed"
    />
    <div class="vibe64-source-editor__title">
      <v-icon
        v-if="!mobile"
        :icon="mdiFileCodeOutline"
        size="19"
      />
      <h2 :title="editor.loadingPath.value || displayedPath || 'Choose a source file'">
        {{ selectedFileName }}
      </h2>
    </div>
    <v-btn v-if="editor.selectedPath.value && markdownRenderable" min-height="48" variant="text" :title="filePresentation === 'rendered' ? 'Show the Markdown source' : 'Show the formatted document'" @click="filePresentation = filePresentation === 'rendered' ? 'code' : 'rendered'">{{ filePresentation === 'rendered' ? 'Markdown' : 'Rendered' }}</v-btn>
    <v-btn v-else-if="editor.selectedPath.value && svgRenderable" min-height="48" variant="text" :title="filePresentation === 'rendered' ? 'Show the SVG source' : 'Show the image'" @click="filePresentation = filePresentation === 'rendered' ? 'code' : 'rendered'">{{ filePresentation === 'rendered' ? 'SVG source' : 'Image' }}</v-btn>
    <v-btn v-else-if="editor.selectedPath.value" min-height="48" variant="text" @click="filePresentation = filePresentation === 'code' ? 'interface' : 'code'">{{ filePresentation === 'code' ? 'Interface' : 'Code' }}</v-btn>
    <div v-if="mobile" class="vibe64-source-editor__mobile-actions">
      <v-btn
        :disabled="!editor.dirty.value || editor.saving.value"
        :aria-label="editor.saving.value ? 'Saving file' : 'Save now'"
        :icon="mdiContentSaveOutline"
        variant="tonal"
        @click="editor.saveNow"
      />
      <v-menu>
        <template #activator="{ props: menuProps }">
          <v-btn v-bind="menuProps" :icon="mdiDotsVertical" aria-label="File actions" variant="text" />
        </template>
        <v-list density="compact">
          <v-list-item
            v-if="editor.statusLabel.value"
            :title="editor.statusLabel.value"
            :class="{ 'text-error': editor.saveError.value }"
          />
          <v-list-item
            v-if="fileBookmarks"
            :title="selectedStarred ? 'Unstar file' : 'Star file'"
            :prepend-icon="selectedStarred ? mdiStar : mdiStarOutline"
            :disabled="!displayedPath || fileBookmarks.pendingPaths.value.includes(displayedPath)"
            @click="fileBookmarks.toggle(displayedPath)"
          />
          <v-list-item
            title="Download file"
            :prepend-icon="mdiDownload"
            :disabled="!displayedPath || editor.loadingFile.value || Boolean(downloadingPath)"
            @click="emit('download', displayedPath)"
          />
          <v-list-item
            title="Undo"
            :prepend-icon="mdiUndoVariant"
            :disabled="!editor.selectedPath.value"
            @click="emit('command', 'undo')"
          />
          <v-list-item
            title="Redo"
            :prepend-icon="mdiRedoVariant"
            :disabled="!editor.selectedPath.value"
            @click="emit('command', 'redo')"
          />
          <v-list-item
            v-if="!singleFile"
            title="Explain file or selection"
            :prepend-icon="mdiRobotOutline"
            :disabled="!assistantAvailable || !editor.selectedPath.value || editor.explanationBusy.value || editor.explanationClosing.value"
            @click="emit('explain')"
          />
          <v-list-item
            title="Refresh files"
            :prepend-icon="mdiRefresh"
            :disabled="editor.loadingTree.value"
            @click="emit('refresh')"
          />
        </v-list>
      </v-menu>
    </div>
    <div v-else class="vibe64-source-editor__actions">
      <v-btn
        v-if="fileBookmarks"
        :aria-label="selectedStarred ? 'Unstar file' : 'Star file'"
        :aria-pressed="selectedStarred"
        :disabled="!displayedPath || fileBookmarks.pendingPaths.value.includes(displayedPath)"
        :icon="selectedStarred ? mdiStar : mdiStarOutline"
        size="small"
        :title="selectedStarred ? 'Unstar file' : 'Star file'"
        variant="text"
        @click="fileBookmarks.toggle(displayedPath)"
      />
      <v-btn
        aria-label="Download file"
        :disabled="!displayedPath || editor.loadingFile.value || Boolean(downloadingPath)"
        :icon="mdiDownload"
        size="small"
        :title="downloadingPath ? 'Downloading file…' : 'Download file'"
        variant="text"
        @click="emit('download', displayedPath)"
      />
      <span
        v-if="editor.statusLabel.value"
        class="vibe64-source-editor__status"
        :class="{ 'vibe64-source-editor__status--error': editor.saveError.value }"
      >
        {{ editor.statusLabel.value }}
      </span>
      <v-btn
        :disabled="!editor.selectedPath.value"
        :icon="mdiUndoVariant"
        size="small"
        title="Undo"
        type="button"
        variant="text"
        @click="emit('command', 'undo')"
      />
      <v-btn
        :disabled="!editor.selectedPath.value"
        :icon="mdiRedoVariant"
        size="small"
        title="Redo"
        type="button"
        variant="text"
        @click="emit('command', 'redo')"
      />
      <v-btn
        :disabled="!editor.dirty.value || editor.saving.value"
        :icon="mdiContentSaveOutline"
        :loading="editor.saving.value"
        size="small"
        title="Save now"
        type="button"
        variant="tonal"
        @click="editor.saveNow"
      />
      <v-btn
        v-if="!singleFile"
        class="vibe64-source-editor__explain-button"
        :aria-busy="editor.explanationBusy.value || editor.explanationClosing.value ? 'true' : 'false'"
        color="primary"
        :disabled="!assistantAvailable || !editor.selectedPath.value || editor.explanationBusy.value || editor.explanationClosing.value"
        :prepend-icon="mdiRobotOutline"
        size="small"
        :title="!assistantAvailable
          ? assistantUnavailableMessage
          : editor.explanationClosing.value ? 'Closing explanation'
            : editor.explanationBusy.value ? 'Explanation in progress' : 'Explain file or selection'"
        type="button"
        variant="tonal"
        @click="emit('explain')"
      >
        {{ editor.explanationClosing.value ? "Closing…" : editor.explanationBusy.value ? "Working…" : "Explain" }}
      </v-btn>
      <v-btn
        v-if="!singleFile"
        :disabled="editor.loadingTree.value"
        :icon="mdiRefresh"
        :aria-busy="editor.loadingTree.value"
        size="small"
        title="Refresh files"
        type="button"
        variant="text"
        @click="emit('refresh')"
      />
    </div>
  </header>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiClose,
  mdiContentSaveOutline,
  mdiDotsVertical,
  mdiDownload,
  mdiFileCodeOutline,
  mdiFolderOutline,
  mdiRedoVariant,
  mdiRefresh,
  mdiRobotOutline,
  mdiStar,
  mdiStarOutline,
  mdiUndoVariant
} from "@mdi/js";

// The source editor's header: the open file's name, how it is shown, and its
// actions (star, download, undo and redo, save, explain, refresh). A phone
// gets a files toggle, Save and an actions menu instead.
const props = defineProps({
  assistantAvailable: { type: Boolean, default: true },
  assistantUnavailableMessage: { type: String, default: "" },
  codeFocusMode: { type: Boolean, default: false },
  displayedPath: { type: String, default: "" },
  downloadingPath: { type: String, default: "" },
  // The source editor composable's state and operations.
  editor: { type: /** @type {import("vue").PropType<import("@/types.js").Vibe64SourceEditor>} */ (Object), required: true },
  // readable-check: allow collaborator-prop - optional operation: the architecture file viewer passes no starred files, so its header shows no star
  fileBookmarks: { type: /** @type {import("vue").PropType<import("@/types.js").Vibe64StarredFiles | null>} */ (Object), default: null },
  markdownRenderable: { type: Boolean, default: false },
  mobile: { type: Boolean, default: false },
  selectedFileName: { type: String, default: "" },
  singleFile: { type: Boolean, default: false },
  svgRenderable: { type: Boolean, default: false }
});
const emit = defineEmits(["command", "download", "explain", "refresh"]);
const fileListCollapsed = defineModel("fileListCollapsed", { type: Boolean, default: false });
const filePresentation = defineModel("filePresentation", { type: String, default: "interface" });

const selectedStarred = computed(() => props.fileBookmarks?.paths.value.includes(props.displayedPath) || false);
</script>

<style scoped>
.vibe64-source-editor__header {
  align-items: center;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.3);
  display: flex;
  flex-wrap: wrap;
  gap: 0.48rem;
  justify-content: space-between;
  min-width: 0;
  padding: 0.24rem 0.52rem;
}

.vibe64-source-editor__title {
  align-items: center;
  display: flex;
  gap: 0.42rem;
  min-width: 0;
}

.vibe64-source-editor__title h2 {
  font-size: 0.9rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.15;
  margin: 0;
  max-width: min(52vw, 46rem);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-source-editor__actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 0.22rem;
}

.vibe64-source-editor__actions :deep(.v-btn) {
  block-size: 1.9rem;
  min-block-size: 1.9rem;
  min-inline-size: 1.9rem;
}

.vibe64-source-editor__status {
  color: rgba(var(--v-theme-on-surface), 0.64);
  font-size: 0.75rem;
  margin-right: 0.35rem;
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-source-editor__status--error {
  color: rgb(var(--v-theme-error));
}

.vibe64-source-editor__explain-button {
  font-weight: 680;
  min-inline-size: 6.25rem;
  text-transform: none;
}

.vibe64-source-editor--mobile .vibe64-source-editor__header {
  flex-wrap: nowrap;
  gap: 0;
  padding: 0 0.25rem;
}

.vibe64-source-editor--mobile .vibe64-source-editor__title {
  flex: 1;
  overflow: hidden;
}

.vibe64-source-editor--mobile .vibe64-source-editor__title h2 {
  max-width: 100%;
  font-weight: 500;
}

.vibe64-source-editor__mobile-actions {
  display: flex;
  flex: 0 0 auto;
}
</style>
