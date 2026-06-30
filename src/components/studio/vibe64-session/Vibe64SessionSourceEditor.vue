<template>
  <section
    class="vibe64-source-editor"
    :class="{ 'vibe64-source-editor--hidden': editorHidden }"
    aria-label="Session source editor"
  >
    <div
      v-show="editorHidden"
      class="vibe64-source-editor__hidden-shell"
    >
      <v-btn
        :icon="mdiEyeOutline"
        size="large"
        title="Show editor"
        type="button"
        variant="tonal"
        @click="showEditor"
      />
    </div>

    <header
      v-show="!editorHidden"
      class="vibe64-source-editor__header"
    >
      <div class="vibe64-source-editor__title">
        <v-icon
          :icon="mdiFileCodeOutline"
          size="19"
        />
        <div>
          <h2>Editor</h2>
          <p :title="editor.selectedPath.value || 'Choose a source file'">
            {{ editor.selectedPath.value || "Choose a source file" }}
          </p>
        </div>
      </div>
      <div class="vibe64-source-editor__actions">
        <span
          v-if="editor.statusLabel.value"
          class="vibe64-source-editor__status"
          :class="{ 'vibe64-source-editor__status--error': editor.saveError.value }"
        >
          {{ editor.statusLabel.value }}
        </span>
        <v-btn
          :icon="mdiEyeOffOutline"
          size="small"
          title="Hide editor"
          type="button"
          variant="text"
          @click="hideEditor"
        />
        <v-btn
          :disabled="!editor.selectedPath.value"
          :icon="mdiUndoVariant"
          size="small"
          title="Undo"
          type="button"
          variant="text"
          @click="runEditorCommand('undo')"
        />
        <v-btn
          :disabled="!editor.selectedPath.value"
          :icon="mdiRedoVariant"
          size="small"
          title="Redo"
          type="button"
          variant="text"
          @click="runEditorCommand('redo')"
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
          :disabled="editor.loadingTree.value"
          :icon="mdiRefresh"
          :loading="editor.loadingTree.value"
          size="small"
          title="Refresh file tree"
          type="button"
          variant="text"
          @click="editor.refresh"
        />
      </div>
    </header>

    <div
      v-show="!editorHidden"
      class="vibe64-source-editor__tools"
    >
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

    <div
      v-show="!editorHidden"
      class="vibe64-source-editor__body"
    >
      <aside class="vibe64-source-editor__sidebar">
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
            v-if="editor.searchLoading.value"
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
            v-else-if="!editor.searchResults.value.length"
            class="vibe64-source-editor__notice"
          >
            No results.
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
          v-if="editor.loadingTree.value"
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
          :expanded-paths="expandedDirectoryPaths"
          :node="editor.tree.value"
          :selected-path="editor.selectedPath.value"
          @directory-open-change="handleDirectoryOpenChange"
          @open-file="editor.openFile"
        />
      </aside>

      <main class="vibe64-source-editor__main">
        <div
          v-if="editor.loadError.value && editor.tree.value"
          class="vibe64-source-editor__banner"
        >
          {{ editor.loadError.value }}
        </div>
        <div
          v-if="!editor.selectedPath.value && !editor.loadingFile.value"
          class="vibe64-source-editor__empty"
        >
          Select a file to edit.
        </div>
        <div
          ref="editorElement"
          class="vibe64-source-editor__codemirror"
          :class="{ 'vibe64-source-editor__codemirror--hidden': !editor.selectedPath.value }"
        />
      </main>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { undo, redo } from "@codemirror/commands";
import { StreamLanguage } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { cpp } from "@codemirror/lang-cpp";
import { markdown } from "@codemirror/lang-markdown";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { basicSetup } from "codemirror";
import {
  mdiContentSaveOutline,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiFileCodeOutline,
  mdiFileSearchOutline,
  mdiMagnify,
  mdiRedoVariant,
  mdiRefresh,
  mdiUndoVariant
} from "@mdi/js";

import Vibe64SourceFileTree from "@/components/studio/vibe64-session/Vibe64SourceFileTree.vue";
import {
  useVibe64SourceEditor
} from "@/composables/useVibe64SourceEditor.js";
import {
  readLocalStorageJson,
  stableLocalStorageKeyPart,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";

const SOURCE_EDITOR_TREE_STATE_STORAGE_KEY = "vibe64:source-editor:tree-state";

const props = defineProps({
  openRequest: {
    default: null,
    type: Object
  },
  sessionId: {
    default: "",
    type: String
  },
  sessionsApiPath: {
    default: "",
    type: String
  }
});

const editorElement = ref(null);
const editor = useVibe64SourceEditor({
  sessionId: () => props.sessionId,
  sessionsApiPath: () => props.sessionsApiPath
});
const languageCompartment = new Compartment();
const editorHidden = ref(false);
const expandedDirectoryPaths = ref([]);
const treeStateStorageKey = computed(() => sourceEditorTreeStateStorageKey({
  sessionId: props.sessionId,
  sessionsApiPath: props.sessionsApiPath
}));
const fastOpenPanelVisible = computed(() => Boolean(editor.fileQuery.value));
const searchPanelVisible = computed(() => Boolean(editor.searchQuery.value) || editor.searchResults.value.length > 0);
let editorView = null;
let resettingEditor = false;

function normalizeTreePath(value = "") {
  return String(value || "").trim().replaceAll("\\", "/").replace(/^\.\/+/u, "");
}

function basename(filePath = "") {
  const segments = String(filePath || "").split("/");
  return segments.at(-1) || filePath;
}

function searchResultTitle(result = {}) {
  return `${result.path || ""}:${result.line || 1}:${result.column || 1}`;
}

function normalizeExpandedDirectoryPaths(value = []) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((path) => normalizeTreePath(path))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function sourceEditorTreeStateStorageKey({
  sessionId = "",
  sessionsApiPath = ""
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedSessionsApiPath = String(sessionsApiPath || "").trim();
  if (!normalizedSessionId || !normalizedSessionsApiPath) {
    return "";
  }
  return [
    SOURCE_EDITOR_TREE_STATE_STORAGE_KEY,
    stableLocalStorageKeyPart(normalizedSessionsApiPath),
    stableLocalStorageKeyPart(normalizedSessionId)
  ].join(":");
}

function languageExtension(filePath = "") {
  const lowerPath = String(filePath || "").toLowerCase();
  if (/\.(js|jsx|mjs|cjs|vue)$/u.test(lowerPath)) {
    return javascript({
      jsx: true
    });
  }
  if (/\.(ts|tsx)$/u.test(lowerPath)) {
    return javascript({
      jsx: lowerPath.endsWith(".tsx"),
      typescript: true
    });
  }
  if (lowerPath.endsWith(".json")) {
    return json();
  }
  if (/\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/u.test(lowerPath)) {
    return cpp();
  }
  if (/\.(sh|bash|zsh|fish)$/u.test(lowerPath)) {
    return StreamLanguage.define(shell);
  }
  if (/\.(md|markdown|todo)$/u.test(lowerPath) || /(^|\/)todo$/u.test(lowerPath)) {
    return markdown();
  }
  return [];
}

function createEditor() {
  if (!editorElement.value || editorView) {
    return;
  }
  editorView = new EditorView({
    parent: editorElement.value,
    state: EditorState.create({
      doc: editor.text.value,
      extensions: [
        basicSetup,
        languageCompartment.of(languageExtension(editor.selectedPath.value)),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || resettingEditor) {
            return;
          }
          editor.updateText(update.state.doc.toString());
        }),
        EditorView.theme({
          "&": {
            backgroundColor: "rgb(var(--v-theme-surface))",
            color: "rgb(var(--v-theme-on-surface))",
            fontSize: "13px",
            height: "100%"
          },
          ".cm-content": {
            caretColor: "rgb(var(--v-theme-primary))",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
          },
          ".cm-focused": {
            outline: "none"
          },
          ".cm-gutters": {
            backgroundColor: "rgba(var(--v-theme-surface-variant), 0.38)",
            borderRight: "1px solid rgba(var(--v-border-color), 0.28)",
            color: "rgba(var(--v-theme-on-surface), 0.56)"
          },
          ".cm-scroller": {
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
          },
          ".cm-selectionBackground": {
            backgroundColor: "rgba(var(--v-theme-primary), 0.22)"
          }
        })
      ]
    })
  });
}

function replaceEditorDocument() {
  if (!editorView) {
    return;
  }
  resettingEditor = true;
  editorView.dispatch({
    changes: {
      from: 0,
      insert: editor.text.value,
      to: editorView.state.doc.length
    },
    effects: languageCompartment.reconfigure(languageExtension(editor.selectedPath.value))
  });
  resettingEditor = false;
  applyCursorRequest();
}

function applyCursorRequest() {
  if (!editorView) {
    return;
  }
  const request = editor.cursorRequest.value;
  const line = Number(request?.line || 0);
  if (!line) {
    return;
  }
  const boundedLine = Math.max(1, Math.min(line, editorView.state.doc.lines));
  const lineInfo = editorView.state.doc.line(boundedLine);
  const column = Math.max(0, Number(request?.column || 1) - 1);
  const anchor = Math.min(lineInfo.to, lineInfo.from + column);
  editorView.dispatch({
    selection: {
      anchor
    },
    scrollIntoView: true
  });
  editorView.focus();
}

function runEditorCommand(command = "") {
  if (!editorView) {
    return;
  }
  if (command === "undo") {
    undo(editorView);
  } else if (command === "redo") {
    redo(editorView);
  }
}

function hideEditor() {
  editorHidden.value = true;
}

async function showEditor() {
  editorHidden.value = false;
  await nextTick();
  editorView?.requestMeasure?.();
}

function handleDirectoryOpenChange({
  open = false,
  path = ""
} = {}) {
  const normalizedPath = normalizeTreePath(path);
  if (!normalizedPath) {
    return;
  }
  const nextPaths = new Set(expandedDirectoryPaths.value);
  if (open) {
    nextPaths.add(normalizedPath);
  } else {
    nextPaths.delete(normalizedPath);
  }
  expandedDirectoryPaths.value = normalizeExpandedDirectoryPaths([...nextPaths]);
}

watch(() => props.openRequest, (request = null) => {
  if (request?.path) {
    editorHidden.value = false;
    editor.openRequest(request);
  }
}, {
  deep: true,
  immediate: true
});

watch(editor.loadedVersion, () => {
  replaceEditorDocument();
});

watch(treeStateStorageKey, (storageKey = "") => {
  expandedDirectoryPaths.value = normalizeExpandedDirectoryPaths(
    readLocalStorageJson(storageKey, [])
  );
}, {
  immediate: true
});

watch(expandedDirectoryPaths, (paths) => {
  if (treeStateStorageKey.value) {
    writeLocalStorageJson(treeStateStorageKey.value, normalizeExpandedDirectoryPaths(paths));
  }
});

onMounted(() => {
  createEditor();
});

onBeforeUnmount(() => {
  editorView?.destroy();
  editorView = null;
});
</script>

<style scoped>
.vibe64-source-editor {
  block-size: 100%;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-block-size: 0;
}

.vibe64-source-editor--hidden {
  grid-template-rows: minmax(0, 1fr);
}

.vibe64-source-editor__hidden-shell {
  align-items: center;
  display: grid;
  justify-items: center;
  min-block-size: 0;
  padding: 0.8rem;
}

.vibe64-source-editor__header {
  align-items: center;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.3);
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  min-width: 0;
  padding: 0.68rem 0.85rem;
}

.vibe64-source-editor__title {
  align-items: center;
  display: flex;
  gap: 0.58rem;
  min-width: 0;
}

.vibe64-source-editor__title h2 {
  font-size: 0.95rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.15;
  margin: 0;
}

.vibe64-source-editor__title p {
  color: rgba(var(--v-theme-on-surface), 0.64);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.76rem;
  line-height: 1.2;
  margin: 0.12rem 0 0;
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

.vibe64-source-editor__tools {
  align-items: start;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.24);
  display: grid;
  gap: 0.6rem;
  grid-template-columns: minmax(14rem, 22rem) minmax(14rem, 1fr);
  min-width: 0;
  padding: 0.55rem 0.75rem;
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

.vibe64-source-editor__body {
  display: grid;
  grid-template-columns: minmax(12rem, 17rem) minmax(0, 1fr);
  min-block-size: 0;
}

.vibe64-source-editor__sidebar {
  border-right: 1px solid rgba(var(--v-border-color), 0.26);
  min-block-size: 0;
  overflow: auto;
  padding: 0.64rem;
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

.vibe64-source-editor__main {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-block-size: 0;
  min-width: 0;
  position: relative;
}

.vibe64-source-editor__codemirror {
  min-block-size: 0;
  overflow: hidden;
}

.vibe64-source-editor__codemirror--hidden {
  display: none;
}

.vibe64-source-editor__notice,
.vibe64-source-editor__empty,
.vibe64-source-editor__banner {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.86rem;
  padding: 0.72rem;
}

.vibe64-source-editor__notice--error,
.vibe64-source-editor__banner {
  color: rgb(var(--v-theme-error));
}

.vibe64-source-editor__empty {
  align-self: start;
}

@media (max-width: 900px) {
  .vibe64-source-editor__tools {
    grid-template-columns: 1fr;
  }

  .vibe64-source-editor__body {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(9rem, 14rem) minmax(0, 1fr);
  }

  .vibe64-source-editor__sidebar {
    border-bottom: 1px solid rgba(var(--v-border-color), 0.26);
    border-right: 0;
  }
}
</style>
