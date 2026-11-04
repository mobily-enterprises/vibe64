<template>
  <aside
    class="vibe64-source-editor__sidebar"
    :class="{ 'vibe64-source-editor__sidebar--collapsed': collapsed, 'vibe64-source-editor__sidebar--drop': dropDepth > 0 }"
    @dragenter="dragEnter"
    @dragover="dragOver"
    @dragleave="dragLeave"
    @drop="dropFiles"
  >
    <Vibe64SourceEditorSideRail
      v-if="collapsed"
      aria-label="Show files"
      :icon="mdiChevronRight"
      label="Files"
      title="Show files"
      @click="emit('expand')"
    />
    <template v-else>
      <div class="vibe64-source-editor__tree-toolbar">
        <span v-if="dropDepth > 0" class="vibe64-source-editor__drop-label" role="status">Drop to upload to {{ uploadFolderLabel }}</span>
        <span v-else>Files</span>
        <div class="vibe64-source-editor__tree-actions">
          <v-btn
            v-if="filesActions"
            :aria-label="`Upload files to ${uploadFolderLabel}`"
            :disabled="!editor.tree.value"
            :icon="mdiUpload"
            size="x-small"
            :title="`Upload files to ${uploadFolderLabel}`"
            type="button"
            variant="text"
            @click="emit('upload', { folder: uploadFolder })"
          />
          <v-btn
            aria-label="New file at source root"
            :disabled="editor.creatingFile.value || !editor.tree.value"
            :icon="mdiFilePlusOutline"
            size="x-small"
            title="New file at source root"
            type="button"
            variant="text"
            @click="emit('new-file', '')"
          />
          <v-btn
            class="vibe64-source-editor__collapse-files-button"
            aria-label="Collapse file list"
            :icon="mdiChevronLeft"
            size="small"
            title="Collapse file list"
            type="button"
            variant="text"
            @click="emit('collapse')"
          />
          <v-btn
            aria-label="Close all folders"
            :disabled="!editor.tree.value || !expandedPaths.length"
            :icon="mdiCollapseAllOutline"
            size="x-small"
            title="Close all folders"
            type="button"
            variant="text"
            @click="emit('close-all-directories')"
          />
        </div>
      </div>

      <details v-if="fileBookmarks" class="vibe64-source-editor__starred" :open="fileBookmarks.files.value.length <= 4">
        <summary>Starred <span>{{ fileBookmarks.files.value.length }}</span></summary>
        <Vibe64StarredFilesList :bookmarks="fileBookmarks" compact @open-file="editor.openFile" />
      </details>

      <section
        v-if="searchPanelVisible"
        class="vibe64-source-editor__search-results"
        aria-label="Find results"
      >
        <div class="vibe64-source-editor__search-heading">
          <span>Find results</span>
          <small>{{ editor.searchResults.value.length }}</small>
        </div>
        <div
          v-if="editor.searchIndexLabel.value"
          class="vibe64-source-editor__notice"
          :class="{ 'vibe64-source-editor__notice--error': editor.searchIndex.value?.state === 'error' }"
          role="status"
        >
          {{ editor.searchIndexLabel.value }}
        </div>
        <div
          v-if="editor.searchLoading.value && !editor.searchResults.value.length"
          class="vibe64-source-editor__notice"
        >
          Searching files...
        </div>
        <div
          v-else-if="editor.searchError.value"
          class="vibe64-source-editor__notice vibe64-source-editor__notice--error"
        >
          {{ editor.searchError.value }}
        </div>
        <div
          v-else-if="!editor.searchResults.value.length && editor.searchIndex.value?.state !== 'error'"
          class="vibe64-source-editor__notice"
        >
          {{ editor.searchIndexPending.value ? "Results will appear as files are indexed." : "No results." }}
        </div>
        <template v-else>
          <button
            v-for="result in editor.searchResults.value"
            :key="`${result.path}:${result.line}:${result.column}:${result.preview}`"
            class="vibe64-source-editor__search-result"
            :title="searchResultTitle(result)"
            type="button"
            @click="editor.openSearchResult(result)"
          >
            <span class="vibe64-source-editor__search-path">{{ result.path }}</span>
            <span class="vibe64-source-editor__search-location">Line {{ result.line }}</span>
            <span class="vibe64-source-editor__search-preview">{{ result.preview }}</span>
          </button>
        </template>
        <div
          v-if="editor.searchTruncated.value"
          class="vibe64-source-editor__notice"
        >
          Search stopped at the first matches. Narrow the query for more precision.
        </div>
      </section>

      <div
        v-if="editor.loadingTree.value && !editor.tree.value"
        class="vibe64-source-editor__notice"
      >
        Loading files...
      </div>
      <div
        v-else-if="editor.loadError.value && !editor.tree.value"
        class="vibe64-source-editor__notice vibe64-source-editor__notice--error"
      >
        {{ editor.loadError.value }}
      </div>
      <Vibe64SourceFileTree
        v-else-if="editor.tree.value"
        :expanded-paths="expandedPaths"
        :load-errors="editor.treeLoadErrors.value"
        :loading-paths="editor.treeLoadingPaths.value"
        :node="editor.tree.value"
        :selected-path="displayedPath"
        :starred-paths="fileBookmarks?.paths.value || []"
        :assistant-draft-available="assistantDraftAvailable"
        :files-actions="filesActions"
        @ask-assistant="askAssistantAboutPath"
        @copy-path="copySourcePath"
        @directory-open-change="emit('directory-open-change', $event)"
        @load-more-directory="editor.loadMoreDirectory"
        @new-file="emit('new-file', $event)"
        @open-file="editor.openFile"
        @toggle-star="fileBookmarks?.toggle($event)"
        @download-file="emit('download-file', $event)"
        @transfer="emit('transfer', $event)"
        @upload="uploadInto"
      />
    </template>
  </aside>
</template>

<script setup>
import { computed, ref } from "vue";
import {
  mdiChevronLeft,
  mdiChevronRight,
  mdiCollapseAllOutline,
  mdiFilePlusOutline,
  mdiUpload
} from "@mdi/js";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import Vibe64SourceEditorSideRail from "@/components/studio/vibe64-session/Vibe64SourceEditorSideRail.vue";
import Vibe64SourceFileTree from "@/components/studio/vibe64-session/Vibe64SourceFileTree.vue";
import Vibe64StarredFilesList from "@/components/studio/vibe64-session/Vibe64StarredFilesList.vue";
import { normalizeSourceEditorPath } from "@/lib/vibe64SourceEditorLinks.js";
import { vibe64DroppedFiles, vibe64FileArea } from "@/lib/vibe64FileAreas.js";
import { writeClipboardText } from "@/lib/clipboard.js";

// The source editor's file list: its toolbar, starred files, Find in files
// results and the source tree. In Files it also takes dropped uploads into
// the open file's folder.
const props = defineProps({
  assistantDraftAvailable: { type: Boolean, default: false },
  collapsed: { type: Boolean, default: false },
  displayedPath: { type: String, default: "" },
  // The source editor composable's state and operations.
  editor: { type: /** @type {import("vue").PropType<import("@/types.js").Vibe64SourceEditor>} */ (Object), required: true },
  expandedPaths: { type: Array, default: () => [] },
  // readable-check: allow collaborator-prop - optional operation: the source editor hands on its starred files, which the architecture file viewer does not have
  fileBookmarks: { type: /** @type {import("vue").PropType<import("@/types.js").Vibe64StarredFiles | null>} */ (Object), default: null },
  filesActions: { type: Boolean, default: false }
});
const emit = defineEmits([
  "ask-assistant-about-file",
  "close-all-directories",
  "collapse",
  "directory-open-change",
  "download-file",
  "expand",
  "new-file",
  "transfer",
  "upload"
]);

// Files uploads into the current folder: the open file's folder, or the root.
const uploadFolder = computed(() => normalizeSourceEditorPath(props.displayedPath).split("/").slice(0, -1).join("/"));
const uploadFolderLabel = computed(() => [vibe64FileArea("repo").label, ...uploadFolder.value.split("/").filter(Boolean)].join(" › "));
const uploadFeedback = useUiFeedback({ source: "vibe64.files" });
const dropDepth = ref(0);
const searchPanelVisible = computed(() => Boolean(props.editor.searchQuery.value) || props.editor.searchResults.value.length > 0);

function searchResultTitle(result = {}) {
  return `${result.path || ""}:${result.line || 1}:${result.column || 1}`;
}

// "Upload here" opens the folder so the new files show once they arrive.
function uploadInto(directoryPath = "") {
  emit("directory-open-change", { open: true, path: directoryPath });
  emit("upload", { folder: normalizeSourceEditorPath(directoryPath) });
}

const fileDrag = (event) => props.filesActions && event.dataTransfer?.types.includes("Files");

function dragEnter(event) {
  if (!fileDrag(event)) return;
  event.preventDefault();
  dropDepth.value += 1;
}

function dragOver(event) {
  if (!fileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

function dragLeave(event) {
  if (fileDrag(event)) dropDepth.value = Math.max(0, dropDepth.value - 1);
}

function dropFiles(event) {
  if (!fileDrag(event)) return;
  event.preventDefault();
  dropDepth.value = 0;
  try {
    emit("upload", { folder: uploadFolder.value, files: vibe64DroppedFiles(event.dataTransfer) });
  } catch (error) {
    uploadFeedback.error(error);
  }
}

async function copySourcePath(path = "") {
  const normalizedPath = normalizeSourceEditorPath(path);
  if (!normalizedPath) {
    return;
  }
  try {
    await writeClipboardText(normalizedPath);
  } catch {
    // Clipboard failures are non-destructive; leave the tree state untouched.
  }
}

function askAssistantAboutPath(path = "") {
  const normalizedPath = normalizeSourceEditorPath(path);
  if (!normalizedPath || !props.assistantDraftAvailable) {
    return;
  }
  emit("ask-assistant-about-file", normalizedPath);
}
</script>

<style scoped>
.vibe64-source-editor__starred {
  margin-bottom: 0.75rem;
}

.vibe64-source-editor__starred .starred-files-list {
  max-height: 14rem;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.vibe64-source-editor__starred summary {
  cursor: pointer;
  padding: 0.375rem;
  font-size: 0.8125rem;
  font-weight: 500;
}

.vibe64-source-editor__starred summary span {
  margin-left: 0.25rem;
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.vibe64-source-editor__sidebar {
  border-right: 1px solid rgba(var(--v-border-color), 0.26);
  contain: layout style paint;
  min-block-size: 0;
  overflow: auto;
  padding: 0 0.64rem 0.64rem;
}

.vibe64-source-editor__sidebar--collapsed {
  overflow: hidden;
  padding: 0;
}

.vibe64-source-editor__tree-toolbar {
  align-items: center;
  background: rgb(var(--v-theme-surface));
  border-bottom: 1px solid rgba(var(--v-border-color), 0.18);
  box-sizing: border-box;
  color: rgba(var(--v-theme-on-surface), 0.62);
  display: flex;
  font-size: 0.72rem;
  font-weight: 720;
  justify-content: space-between;
  letter-spacing: 0;
  margin: 0 -0.64rem 0.44rem;
  min-width: 0;
  padding: 0.48rem 0.72rem 0.34rem;
  position: sticky;
  top: 0;
  z-index: 4;
}

.vibe64-source-editor__sidebar--drop {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, rgb(var(--v-theme-surface)));
  outline: 2px dashed rgb(var(--v-theme-primary));
  outline-offset: -2px;
}

.vibe64-source-editor__drop-label {
  color: rgb(var(--v-theme-primary));
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-source-editor__tree-actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 0.08rem;
}

.vibe64-source-editor__collapse-files-button {
  min-inline-size: 2.2rem;
}

.vibe64-source-editor__search-results {
  border-bottom: 1px solid rgba(var(--v-border-color), 0.24);
  display: grid;
  gap: 0.16rem;
  margin: -0.1rem -0.1rem 0.58rem;
  max-block-size: min(21rem, 45vh);
  overflow: auto;
  padding: 0 0 0.58rem;
}

.vibe64-source-editor__search-heading {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.66);
  display: flex;
  font-size: 0.72rem;
  font-weight: 760;
  justify-content: space-between;
  letter-spacing: 0;
  padding: 0 0.16rem 0.22rem;
  text-transform: uppercase;
}

.vibe64-source-editor__search-heading small {
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 0.7rem;
}

.vibe64-source-editor__search-result {
  background: transparent;
  border: 0;
  border-radius: 7px;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  display: grid;
  gap: 0.12rem;
  min-width: 0;
  padding: 0.46rem 0.5rem;
  text-align: left;
}

.vibe64-source-editor__search-result:hover {
  background: rgba(var(--v-theme-primary), 0.08);
}

.vibe64-source-editor__search-path,
.vibe64-source-editor__search-location,
.vibe64-source-editor__search-preview {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-source-editor__search-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.75rem;
  font-weight: 720;
}

.vibe64-source-editor__search-location {
  color: rgba(var(--v-theme-on-surface), 0.54);
  font-size: 0.7rem;
}

.vibe64-source-editor__search-preview {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.72rem;
}

.vibe64-source-editor__notice {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.86rem;
  padding: 0.72rem;
}

.vibe64-source-editor__notice--error {
  color: rgb(var(--v-theme-error));
}

@media (max-width: 900px) {
  .vibe64-source-editor__sidebar {
    border-bottom: 1px solid rgba(var(--v-border-color), 0.26);
    border-right: 0;
  }
}
</style>
