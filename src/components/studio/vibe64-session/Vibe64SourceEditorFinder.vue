<template>
  <div class="vibe64-source-editor__tools">
    <div class="vibe64-source-editor__tool">
      <v-text-field
        autocomplete="off"
        clearable
        density="compact"
        hide-details
        label="Open file"
        :model-value="editor.fileQuery.value"
        :prepend-inner-icon="mdiFileSearchOutline"
        variant="outlined"
        @keydown.enter.prevent="editor.openFirstFileMatch"
        @update:model-value="editor.updateFileQuery"
      />
      <div
        v-if="fastOpenPanelVisible"
        class="vibe64-source-editor__matches"
      >
        <div
          v-if="editor.fileMatchesLoading.value"
          class="vibe64-source-editor__match-note"
        >
          Finding files...
        </div>
        <div
          v-else-if="editor.fileMatchesError.value"
          class="vibe64-source-editor__match-note vibe64-source-editor__match-note--error"
        >
          {{ editor.fileMatchesError.value }}
        </div>
        <template v-else>
          <button
            v-for="file in editor.fileMatches.value"
            :key="file.path"
            class="vibe64-source-editor__match"
            :title="file.path"
            type="button"
            @click="editor.openFileMatch(file.path)"
          >
            <span class="vibe64-source-editor__match-name">{{ file.name || basename(file.path) }}</span>
            <span class="vibe64-source-editor__match-path">{{ file.path }}</span>
          </button>
          <div
            v-if="!editor.fileMatches.value.length"
            class="vibe64-source-editor__match-note"
          >
            No matching files.
          </div>
          <div
            v-if="editor.fileMatchesTruncated.value"
            class="vibe64-source-editor__match-note"
          >
            Keep typing to narrow the list.
          </div>
        </template>
      </div>
    </div>

    <div class="vibe64-source-editor__tool">
      <v-text-field
        autocomplete="off"
        clearable
        density="compact"
        hide-details
        label="Find in files"
        :model-value="editor.searchQuery.value"
        :prepend-inner-icon="mdiMagnify"
        variant="outlined"
        @keydown.enter.prevent="editor.openSearchResult(editor.searchResults.value[0])"
        @update:model-value="editor.updateSearchQuery"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import { mdiFileSearchOutline, mdiMagnify } from "@mdi/js";
import { basename } from "@/lib/vibe64SourceFilePaths.js";

// Open file, with its list of matching paths, and Find in files, whose
// results the file list shows.
const props = defineProps({
  // The source editor composable's state and operations.
  editor: { type: Object, required: true }
});

const fastOpenPanelVisible = computed(() => Boolean(props.editor.fileQuery.value));
</script>

<style scoped>
.vibe64-source-editor__tools {
  align-items: start;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.24);
  display: grid;
  gap: 0.38rem;
  grid-template-columns: minmax(14rem, 22rem) minmax(14rem, 1fr);
  min-width: 0;
  padding: 0.22rem 0.48rem;
}

.vibe64-source-editor__tools :deep(.v-field) {
  min-block-size: 2.35rem;
}

.vibe64-source-editor__tools :deep(.v-field__input) {
  min-block-size: 2.35rem;
  padding-block: 0.28rem;
}

.vibe64-source-editor__tools :deep(.v-field__prepend-inner),
.vibe64-source-editor__tools :deep(.v-field__clearable) {
  padding-top: 0.4rem;
}

.vibe64-source-editor__tool {
  min-width: 0;
  position: relative;
}

.vibe64-source-editor__matches {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.35);
  border-radius: 8px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
  display: grid;
  gap: 0.08rem;
  inset-inline: 0;
  margin-top: 0.28rem;
  max-block-size: min(18rem, 52vh);
  overflow: auto;
  padding: 0.28rem;
  position: absolute;
  z-index: 8;
}

.vibe64-source-editor__match {
  background: transparent;
  border: 0;
  border-radius: 6px;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  display: grid;
  gap: 0.08rem;
  min-width: 0;
  padding: 0.42rem 0.5rem;
  text-align: left;
}

.vibe64-source-editor__match:hover {
  background: rgba(var(--v-theme-primary), 0.08);
}

.vibe64-source-editor__match-name,
.vibe64-source-editor__match-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-source-editor__match-name {
  font-size: 0.84rem;
  font-weight: 720;
}

.vibe64-source-editor__match-path {
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.72rem;
}

.vibe64-source-editor__match-note {
  color: rgba(var(--v-theme-on-surface), 0.64);
  font-size: 0.78rem;
  padding: 0.48rem 0.55rem;
}

.vibe64-source-editor__match-note--error {
  color: rgb(var(--v-theme-error));
}

@media (max-width: 900px) {
  .vibe64-source-editor__tools {
    grid-template-columns: 1fr;
  }
}

.vibe64-source-editor--mobile .vibe64-source-editor__tools {
  grid-template-columns: minmax(0, 1fr);
}
</style>
