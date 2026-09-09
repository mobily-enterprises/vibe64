<template>
  <section
    ref="sourceEditorElement"
    class="vibe64-source-editor"
    :class="{ 'vibe64-source-editor--code-focus': codeFocusMode }"
    aria-label="Session source editor"
  >
    <header
      class="vibe64-source-editor__header"
    >
      <div class="vibe64-source-editor__title">
        <v-icon
          :icon="mdiFileCodeOutline"
          size="19"
        />
        <h2 :title="editor.loadingPath.value || displayedPath || 'Choose a source file'">
          {{ selectedFileName }}
        </h2>
      </div>
      <div class="vibe64-source-editor__actions">
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
          @click="requestDownload(displayedPath)"
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
          @click="explainCurrentSelection"
        >
          {{ editor.explanationClosing.value ? "Closing…" : editor.explanationBusy.value ? "Working…" : "Explain" }}
        </v-btn>
        <v-btn
          :disabled="editor.loadingTree.value"
          :icon="mdiRefresh"
          :aria-busy="editor.loadingTree.value"
          size="small"
          title="Refresh files"
          type="button"
          variant="text"
          @click="editor.refresh"
        />
      </div>
    </header>

    <div
      v-if="!codeFocusMode"
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
      class="vibe64-source-editor__body"
      :class="{
        'vibe64-source-editor__body--code-focus': codeFocusMode,
        'vibe64-source-editor__body--file-list-collapsed': fileListCollapsed && !codeFocusMode
      }"
    >
      <aside
        v-if="!codeFocusMode"
        class="vibe64-source-editor__sidebar"
        :class="{ 'vibe64-source-editor__sidebar--collapsed': fileListCollapsed }"
      >
        <button
          v-if="fileListCollapsed"
          aria-label="Show files"
          class="vibe64-source-editor__side-rail"
          title="Show files"
          type="button"
          @click="expandFileList"
        >
          <v-icon :icon="mdiChevronRight" size="22" />
          <span>Files</span>
        </button>
        <template v-else>
          <div class="vibe64-source-editor__tree-toolbar">
            <span>Files</span>
            <div class="vibe64-source-editor__tree-actions">
              <v-btn
                aria-label="New file at source root"
                :disabled="editor.creatingFile.value || !editor.tree.value"
                :icon="mdiFilePlusOutline"
                size="x-small"
                title="New file at source root"
                type="button"
                variant="text"
                @click="openNewFileDialog('')"
              />
              <v-btn
                class="vibe64-source-editor__collapse-files-button"
                aria-label="Collapse file list"
                :icon="mdiChevronLeft"
                size="small"
                title="Collapse file list"
                type="button"
                variant="text"
                @click="collapseFileList"
              />
              <v-btn
                aria-label="Reset folder view"
                :disabled="!editor.tree.value"
                :icon="mdiRestore"
                size="x-small"
                title="Reset folder view"
                type="button"
                variant="text"
                @click="resetExpandedDirectoryPaths"
              />
              <v-btn
                aria-label="Close all folders"
                :disabled="!editor.tree.value || !expandedDirectoryPaths.length"
                :icon="mdiCollapseAllOutline"
                size="x-small"
                title="Close all folders"
                type="button"
                variant="text"
                @click="closeAllDirectories"
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
            :expanded-paths="expandedDirectoryPaths"
            :load-errors="editor.treeLoadErrors.value"
            :loading-paths="editor.treeLoadingPaths.value"
            :node="editor.tree.value"
            :selected-path="displayedPath"
            :starred-paths="fileBookmarks?.paths.value || []"
            :ask-codex-available="askCodexAvailable"
            @ask-codex="askCodexAboutPath"
            @copy-path="copySourcePath"
            @directory-open-change="handleDirectoryOpenChange"
            @load-more-directory="editor.loadMoreDirectory"
            @new-file="openNewFileDialog"
            @open-file="editor.openFile"
            @toggle-star="fileBookmarks?.toggle($event)"
            @download-file="requestDownload"
          />
        </template>
      </aside>

      <main class="vibe64-source-editor__main">
        <div
          v-if="editor.loadError.value && editor.tree.value"
          class="vibe64-source-editor__banner"
        >
          {{ editor.loadError.value }}
        </div>
        <div
          v-if="editor.downloadOnlyFile.value && !editor.loadingFile.value"
          class="vibe64-source-editor__empty"
        >
          <p class="mb-4">{{ editor.downloadOnlyFile.value.message }}</p>
          <v-btn
            color="primary"
            :disabled="Boolean(downloadingPath)"
            :prepend-icon="mdiDownload"
            @click="requestDownload(editor.downloadOnlyFile.value.path)"
          >
            {{ downloadingPath ? "Downloading…" : "Download file" }}
          </v-btn>
        </div>
        <div
          v-else-if="!editor.selectedPath.value && !editor.loadingFile.value"
          class="vibe64-source-editor__empty"
        >
          Select a file to edit.
        </div>
        <div
          v-if="editor.explanationError.value && !editor.activeExplanation.value"
          class="vibe64-source-editor__banner vibe64-source-editor__banner--error"
        >
          {{ editor.explanationError.value }}
        </div>
        <div
          class="vibe64-source-editor__workspace"
          :class="{
            'vibe64-source-editor__workspace--with-explanation': editor.activeExplanation.value,
            'vibe64-source-editor__workspace--explanation-collapsed': editor.activeExplanation.value && explanationCollapsed
          }"
        >
          <div
            ref="editorElement"
            class="vibe64-source-editor__codemirror"
            :class="{ 'vibe64-source-editor__codemirror--hidden': !editor.selectedPath.value || editor.loadingFile.value }"
          />
          <div
            v-if="editor.loadingFile.value"
            :aria-label="`Opening ${selectedFileName}`"
            aria-live="polite"
            class="vibe64-source-editor__file-loading"
            role="status"
          >
            <v-skeleton-loader
              class="vibe64-source-editor__file-skeleton"
              type="image"
            />
          </div>
          <div
            v-if="editor.activeExplanation.value"
            class="vibe64-source-editor__explanation-dock"
            :class="{ 'vibe64-source-editor__explanation-dock--collapsed': explanationCollapsed }"
          >
            <Vibe64SourceExplanationPanel
              v-show="!explanationCollapsed"
              :assistant-available="assistantAvailable"
              :assistant-unavailable-message="assistantUnavailableMessage"
              :busy="editor.explanationBusy.value"
              :closing="editor.explanationClosing.value"
              :explanation="editor.activeExplanation.value"
              :followup="editor.explanationFollowup.value"
              :selected-path="editor.selectedPath.value"
              @close="closeExplanationPanel"
              @collapse="collapseExplanation"
              @open-range="openExplanationRange"
              @open-source-link="openExplanationSourceLink"
              @retry="retryExplanation"
              @send-followup="sendExplanationFollowup"
              @stop="editor.stopExplanation"
              @update:followup="editor.updateExplanationFollowup"
            />
            <button
              v-show="explanationCollapsed"
              aria-label="Show explanation"
              class="vibe64-source-editor__side-rail vibe64-source-editor__side-rail--right"
              title="Show explanation"
              type="button"
              @click="expandExplanation"
            >
              <v-icon :icon="mdiChevronLeft" size="22" />
              <span>AI</span>
            </button>
          </div>
        </div>
      </main>
    </div>

    <v-dialog
      v-model="newFileDialogOpen"
      max-width="520"
    >
      <v-card>
        <v-card-title>New file</v-card-title>
        <v-card-text class="vibe64-source-editor__new-file-dialog">
          <p>
            {{ newFileDirectoryLabel }}
          </p>
          <v-alert
            v-if="newFileError"
            density="compact"
            type="warning"
            variant="tonal"
          >
            {{ newFileError }}
          </v-alert>
          <v-text-field
            v-model="newFileName"
            autofocus
            autocomplete="off"
            :disabled="editor.creatingFile.value"
            label="Path"
            placeholder="components/NewFile.vue"
            variant="outlined"
            @keydown.enter.prevent="submitNewFile"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            :disabled="editor.creatingFile.value"
            type="button"
            variant="text"
            @click="closeNewFileDialog"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            :disabled="newFileCreateDisabled"
            :loading="editor.creatingFile.value"
            type="button"
            variant="flat"
            @click="submitNewFile"
          >
            Create
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="downloadDraftOpen" max-width="440">
      <v-card title="Download this file?">
        <v-card-text>
          This file has unsaved edits. Download the saved version, or save your edits first.
          <v-alert v-if="downloadError" class="mt-3" density="compact" type="error" variant="tonal">{{ downloadError }}</v-alert>
        </v-card-text>
        <v-card-actions class="flex-wrap">
          <v-btn :disabled="downloadSaving" @click="downloadDraftOpen = false">Cancel</v-btn>
          <v-btn :disabled="downloadSaving" @click="downloadSavedDraft">Download saved file</v-btn>
          <v-btn color="primary" :disabled="downloadSaving" @click="saveAndDownload">{{ downloadSaving ? 'Saving…' : 'Save & download' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <span class="vibe64-source-editor__download-status" role="status">{{ downloadingPath ? 'Downloading file…' : '' }}</span>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Compartment, EditorState } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  undo
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting
} from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import {
  javascript,
  jsxLanguage,
  tsxLanguage,
  typescriptLanguage
} from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";
import { cpp } from "@codemirror/lang-cpp";
import { markdown } from "@codemirror/lang-markdown";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import {
  mdiChevronLeft,
  mdiChevronRight,
  mdiCollapseAllOutline,
  mdiContentSaveOutline,
  mdiDownload,
  mdiFileCodeOutline,
  mdiFilePlusOutline,
  mdiFileSearchOutline,
  mdiMagnify,
  mdiRedoVariant,
  mdiRefresh,
  mdiRobotOutline,
  mdiRestore,
  mdiStar,
  mdiStarOutline,
  mdiUndoVariant
} from "@mdi/js";

import Vibe64SourceExplanationPanel from "@/components/studio/vibe64-session/Vibe64SourceExplanationPanel.vue";
import Vibe64SourceFileTree from "@/components/studio/vibe64-session/Vibe64SourceFileTree.vue";
import Vibe64StarredFilesList from "@/components/studio/vibe64-session/Vibe64StarredFilesList.vue";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { vibe64SourceEditorDownloadPath } from "@/lib/vibe64SessionRequestConfig.js";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import {
  useVibe64SourceEditor
} from "@/composables/useVibe64SourceEditor.js";
import {
  readLocalStorageJson,
  stableLocalStorageKeyPart,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";
import {
  writeClipboardText
} from "@/lib/clipboard.js";
import {
  sourceEditorDocumentChanges
} from "@/lib/vibe64SourceEditorDocumentChanges.js";

const SOURCE_EDITOR_TREE_STATE_STORAGE_KEY = "vibe64:source-editor:tree-state";

const props = defineProps({
  agentActive: { type: Boolean, default: false },
  fileBookmarks: { type: Object, default: null },
  active: {
    default: false,
    type: Boolean
  },
  assistantAvailable: {
    default: true,
    type: Boolean
  },
  assistantUnavailableMessage: {
    default: "The selected AI connection is unavailable for this account.",
    type: String
  },
  codeFocusMode: {
    default: false,
    type: Boolean
  },
  openRequest: {
    default: null,
    type: Object
  },
  projectSlug: {
    default: "",
    type: String
  },
  sessionId: {
    default: "",
    type: String
  },
  sessionsApiPath: {
    default: "",
    type: String
  },
  askCodexAvailable: {
    default: false,
    type: Boolean
  },
  navigateReferencedSource: {
    default: null,
    type: Function
  },
  sourcePathClickWithoutModifier: {
    default: false,
    type: Boolean
  }
});
const emit = defineEmits(["ask-codex-about-file"]);

const editorElement = ref(null);
let editorView = null;
let explanationFocusTimer = null;
let renderedEditorPath = "";
let resettingEditor = false;
let sourceEditorUnmounted = false;
const editor = useVibe64SourceEditor({
  active: () => props.active,
  agentActive: () => props.agentActive,
  navigateReferencedSource: (navigation) => props.navigateReferencedSource?.(navigation),
  projectSlug: () => props.projectSlug,
  readCurrentText: () => editorView?.state.doc.toString() ?? "",
  sessionId: () => props.sessionId,
  sessionsApiPath: () => props.sessionsApiPath
});
const displayedPath = computed(() => editor.downloadOnlyFile.value?.path || editor.selectedPath.value);
const selectedStarred = computed(() => props.fileBookmarks?.paths.value.includes(displayedPath.value) || false);
const downloadingPath = ref("");
const downloadDraftOpen = ref(false);
const downloadSaving = ref(false);
const downloadError = ref("");
let draftDownload = null;
const downloadFeedback = useUiFeedback({ source: "vibe64.source-editor.download" });

function requestDownload(filePath) {
  if (!filePath || downloadingPath.value) {
    return;
  }
  const target = {
    path: filePath,
    sessionId: props.sessionId,
    sessionsApiPath: readRefOrGetterValue(props.sessionsApiPath),
    projectSlug: props.projectSlug
  };
  if (filePath === editor.selectedPath.value && (editor.dirty.value || editor.saving.value)) {
    draftDownload = target;
    downloadError.value = "";
    downloadDraftOpen.value = true;
  } else {
    void downloadFile(target);
  }
}

async function downloadFile(target) {
  downloadingPath.value = target.path;
  try {
    // The JSON HTTP client cannot return binary bodies. Keep the same project scope and cookie authentication.
    const url = scopedDevelopmentApiUrl(
      vibe64SourceEditorDownloadPath(target.sessionsApiPath, target.sessionId, target.path),
      target.projectSlug
    );
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok || !response.headers.get("content-disposition")?.startsWith("attachment;")) {
      const failure = await response.json().catch(() => ({}));
      const message = typeof failure.error === "string"
        ? failure.error
        : failure.error?.message || "File could not download. Check your connection and access, then retry.";
      throw new Error(message);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = basename(target.path);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (cause) {
    downloadFeedback.error(cause, "File could not download.");
  } finally {
    downloadingPath.value = "";
  }
}

function downloadSavedDraft() {
  downloadDraftOpen.value = false;
  void downloadFile(draftDownload);
}

async function saveAndDownload() {
  downloadSaving.value = true;
  await editor.saveNow();
  downloadSaving.value = false;
  if (editor.dirty.value || editor.saveError.value) {
    downloadError.value = editor.saveError.value || "The file still has unsaved edits.";
    return;
  }
  downloadSavedDraft();
}

watch([() => props.active, () => props.agentActive], ([active, working], [wasActive, wasWorking]) => {
  if (active && (!wasActive || (wasWorking && !working))) {
    void props.fileBookmarks?.refresh();
  }
});
watch(() => props.sessionId, () => {
  downloadDraftOpen.value = false;
});
const languageCompartment = new Compartment();
const lineWrappingCompartment = new Compartment();
const editorPerformanceSetup = [
  lineNumbers(),
  highlightActiveLineGutter(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, {
    fallback: true
  }),
  bracketMatching(),
  rectangularSelection(),
  crosshairCursor(),
  keymap.of([
    indentWithTab,
    ...defaultKeymap,
    ...historyKeymap,
    ...searchKeymap
  ])
];
const sourcePathClickExtension = EditorView.domEventHandlers({
  click(event, view) {
    if (!sourcePathNavigationGesture(event) || event.button !== 0) {
      return false;
    }
    const sourcePath = sourcePathReferenceAtEvent(view, event);
    if (!sourcePath) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    void editor.openReferencedSourcePath({
      fromPath: editor.selectedPath.value,
      target: sourcePath.target
    });
    return true;
  },
  mouseleave(_event, view) {
    setSourcePathHoverState(view, false);
    return false;
  },
  mousemove(event, view) {
    setSourcePathHoverState(view, Boolean(
      sourcePathNavigationGesture(event) &&
      sourcePathReferenceAtEvent(view, event)
    ));
    return false;
  }
});
const expandedDirectoryPaths = ref([]);
const explanationCollapsed = ref(false);
const fileListCollapsed = ref(false);
const newFileDialogOpen = ref(false);
const sourceEditorElement = ref(null);
const newFileDirectory = ref("");
const newFileError = ref("");
const newFileName = ref("");
const treeStateStorageKey = computed(() => sourceEditorTreeStateStorageKey({
  sessionId: props.sessionId,
  sessionsApiPath: props.sessionsApiPath
}));
const fastOpenPanelVisible = computed(() => Boolean(editor.fileQuery.value));
const searchPanelVisible = computed(() => Boolean(editor.searchQuery.value) || editor.searchResults.value.length > 0);
const selectedFileName = computed(() => (
  editor.loadingPath.value || displayedPath.value
    ? basename(editor.loadingPath.value || displayedPath.value)
    : "Choose a source file"
));
const newFileDirectoryLabel = computed(() => (
  newFileDirectory.value
    ? `Create in ${newFileDirectory.value}`
    : "Create in source root"
));
const newFilePath = computed(() => {
  const name = normalizeNewFileEntryPath(newFileName.value);
  if (!name) {
    return "";
  }
  return newFileDirectory.value
    ? `${newFileDirectory.value}/${name}`
    : name;
});
const newFileCreateDisabled = computed(() => Boolean(
  editor.creatingFile.value ||
  !newFilePath.value
));

function normalizeTreePath(value = "") {
  return String(value || "").trim().replaceAll("\\", "/").replace(/^\.\/+/u, "");
}

function normalizeNewFileEntryPath(value = "") {
  const raw = normalizeTreePath(value).replace(/\/+$/u, "");
  if (!raw || raw.startsWith("/")) {
    return "";
  }
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    return "";
  }
  return parts.join("/");
}

function basename(filePath = "") {
  const segments = String(filePath || "").split("/");
  return segments.at(-1) || filePath;
}

function searchResultTitle(result = {}) {
  return `${result.path || ""}:${result.line || 1}:${result.column || 1}`;
}

async function focusAfterLayout(rootElement = null, selector = "") {
  await nextTick();
  if (sourceEditorUnmounted) {
    return;
  }
  if (explanationFocusTimer) {
    clearTimeout(explanationFocusTimer);
  }
  explanationFocusTimer = setTimeout(() => {
    explanationFocusTimer = null;
    rootElement?.querySelector?.(selector)?.focus?.();
  }, 0);
}

function collapseExplanation(event = {}) {
  const rootElement = event?.currentTarget?.closest?.(".vibe64-source-editor") || sourceEditorElement.value;
  explanationCollapsed.value = true;
  void focusAfterLayout(rootElement, ".vibe64-source-editor__side-rail--right");
}

function expandExplanation(event = {}) {
  const rootElement = event?.currentTarget?.closest?.(".vibe64-source-editor") || sourceEditorElement.value;
  explanationCollapsed.value = false;
  void focusAfterLayout(rootElement, ".vibe64-source-explanation__range");
}

async function closeExplanationPanel(event = {}) {
  const rootElement = event?.currentTarget?.closest?.(".vibe64-source-editor") || sourceEditorElement.value;
  if (await editor.closeExplanation()) {
    void focusAfterLayout(rootElement, ".vibe64-source-editor__explain-button");
  }
}

function collapseFileList() {
  fileListCollapsed.value = true;
}

function expandFileList() {
  fileListCollapsed.value = false;
}

function normalizeExpandedDirectoryPaths(value = []) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((path) => normalizeTreePath(path))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function addExpandedDirectoryPaths(paths = []) {
  const normalizedPaths = normalizeExpandedDirectoryPaths(paths);
  if (!normalizedPaths.length) {
    return;
  }
  expandedDirectoryPaths.value = normalizeExpandedDirectoryPaths([
    ...expandedDirectoryPaths.value,
    ...normalizedPaths
  ]);
}

function parentDirectoryPathsFor(filePath = "") {
  const parts = normalizeTreePath(filePath).split("/").filter(Boolean);
  const paths = [];
  for (let index = 1; index < parts.length; index += 1) {
    paths.push(parts.slice(0, index).join("/"));
  }
  return paths;
}

function openNewFileDialog(directoryPath = "") {
  newFileDirectory.value = normalizeTreePath(directoryPath);
  newFileName.value = "";
  newFileError.value = "";
  newFileDialogOpen.value = true;
}

function closeNewFileDialog() {
  if (editor.creatingFile.value) {
    return;
  }
  newFileDialogOpen.value = false;
  newFileError.value = "";
}

async function submitNewFile() {
  const filePath = newFilePath.value;
  if (!filePath || editor.creatingFile.value) {
    if (String(newFileName.value || "").trim()) {
      newFileError.value = "Enter a nested file path without absolute or parent-directory segments.";
    }
    return;
  }
  const created = await editor.createFile(filePath);
  if (!created) {
    newFileError.value = editor.createFileError.value || "Source file could not be created.";
    return;
  }
  addExpandedDirectoryPaths(parentDirectoryPathsFor(filePath));
  newFileDialogOpen.value = false;
  newFileError.value = "";
}

async function copySourcePath(path = "") {
  const normalizedPath = normalizeTreePath(path);
  if (!normalizedPath) {
    return;
  }
  try {
    await writeClipboardText(normalizedPath);
  } catch {
    // Clipboard failures are non-destructive; leave the tree state untouched.
  }
}

function askCodexAboutPath(path = "") {
  const normalizedPath = normalizeTreePath(path);
  if (!normalizedPath || !props.askCodexAvailable) {
    return;
  }
  emit("ask-codex-about-file", normalizedPath);
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
  if (lowerPath.endsWith(".vue")) {
    return htmlSourceLanguage({
      matchClosingTags: false
    });
  }
  if (/\.(html|htm|xhtml|svg)$/u.test(lowerPath)) {
    return htmlSourceLanguage();
  }
  if (/\.(js|jsx|mjs|cjs)$/u.test(lowerPath)) {
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
  if (sourceEditorPathIsMarkdown(lowerPath)) {
    return markdown();
  }
  return [];
}

function sourceEditorPathIsMarkdown(filePath = "") {
  const lowerPath = String(filePath || "").toLowerCase();
  return /\.(md|markdown|todo)$/u.test(lowerPath) || /(^|\/)todo$/u.test(lowerPath);
}

function sourceEditorLineWrappingExtension(filePath = "") {
  return sourceEditorPathIsMarkdown(filePath) ? EditorView.lineWrapping : [];
}

function htmlSourceLanguage(options = {}) {
  return html({
    selfClosingTags: true,
    ...options,
    nestedLanguages: [
      {
        attrs: (attrs = {}) => ["ts", "typescript"].includes(String(attrs.lang || "").toLowerCase()),
        parser: typescriptLanguage.parser,
        tag: "script"
      },
      {
        attrs: (attrs = {}) => String(attrs.lang || "").toLowerCase() === "jsx",
        parser: jsxLanguage.parser,
        tag: "script"
      },
      {
        attrs: (attrs = {}) => String(attrs.lang || "").toLowerCase() === "tsx",
        parser: tsxLanguage.parser,
        tag: "script"
      }
    ]
  });
}

function sourcePathModifierPressed(event = {}) {
  return event.ctrlKey || event.metaKey;
}

function sourcePathNavigationGesture(event = {}) {
  return props.sourcePathClickWithoutModifier || sourcePathModifierPressed(event);
}

function setSourcePathHoverState(view, active = false) {
  view.dom.classList.toggle("vibe64-source-editor__codemirror--source-link-hover", active);
}

function sourcePathReferenceAtEvent(view, event = {}) {
  const position = view.posAtCoords({
    x: event.clientX,
    y: event.clientY
  });
  if (position == null) {
    return null;
  }
  const line = view.state.doc.lineAt(position);
  return sourcePathReferenceAtLineColumn(line.text, position - line.from);
}

function sourcePathReferenceAtLineColumn(lineText = "", column = 0) {
  return sourcePathReferencesInLine(lineText)
    .find((reference) => column >= reference.from && column <= reference.to) || null;
}

function sourcePathReferencesInLine(lineText = "") {
  const references = [];
  collectQuotedSourcePathReferences(lineText, references);
  collectUrlSourcePathReferences(lineText, references);
  return references;
}

function collectQuotedSourcePathReferences(lineText = "", references = []) {
  for (let index = 0; index < lineText.length; index += 1) {
    const quote = lineText[index];
    if (!["\"", "'", "`"].includes(quote)) {
      continue;
    }
    let cursor = index + 1;
    let value = "";
    while (cursor < lineText.length) {
      const character = lineText[cursor];
      if (character === "\\") {
        value += lineText[cursor + 1] || "";
        cursor += 2;
        continue;
      }
      if (character === quote) {
        const target = sourcePathReferenceTarget(value);
        if (target) {
          references.push({
            from: index + 1,
            target,
            to: cursor
          });
        }
        index = cursor;
        break;
      }
      value += character;
      cursor += 1;
    }
  }
}

function collectUrlSourcePathReferences(lineText = "", references = []) {
  const urlPattern = /url\(\s*([^"'`\s)]+)\s*\)/giu;
  for (const match of lineText.matchAll(urlPattern)) {
    const rawTarget = match[1] || "";
    const target = sourcePathReferenceTarget(rawTarget);
    if (!target) {
      continue;
    }
    const from = Number(match.index || 0) + match[0].indexOf(rawTarget);
    references.push({
      from,
      target,
      to: from + rawTarget.length
    });
  }
}

function sourcePathReferenceTarget(value = "") {
  const target = String(value || "").trim();
  if (!target || target.startsWith("//") || /^[a-z][a-z0-9+.-]*:/iu.test(target)) {
    return "";
  }
  if (target.startsWith("./") || target.startsWith("../") || target.startsWith("/")) {
    return target;
  }
  return "";
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
        editorPerformanceSetup,
        sourcePathClickExtension,
        languageCompartment.of(languageExtension(editor.selectedPath.value)),
        lineWrappingCompartment.of(sourceEditorLineWrappingExtension(editor.selectedPath.value)),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || resettingEditor) {
            return;
          }
          editor.updateText();
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
  renderedEditorPath = editor.selectedPath.value;
}

function replaceEditorDocument() {
  if (!editorView) {
    return;
  }
  const selectedPath = editor.selectedPath.value;
  const sameFile = renderedEditorPath === selectedPath;
  const currentText = editorView.state.doc.toString();
  const changes = editorView.state.changes(sameFile
    ? sourceEditorDocumentChanges(currentText, editor.text.value)
    : [{
        from: 0,
        insert: editor.text.value,
        to: currentText.length
      }]);
  const effects = [
    languageCompartment.reconfigure(languageExtension(selectedPath)),
    lineWrappingCompartment.reconfigure(sourceEditorLineWrappingExtension(selectedPath))
  ];
  const cursorRequest = editor.cursorRequest.value;
  const explicitCursorRequest = (
    cursorRequest?.path === selectedPath &&
    Number(cursorRequest.line || 0) > 0
  );
  if (sameFile && !explicitCursorRequest) {
    const scrollSnapshot = editorView.scrollSnapshot().map(changes);
    if (scrollSnapshot) {
      effects.unshift(scrollSnapshot);
    }
  }

  resettingEditor = true;
  try {
    editorView.dispatch({
      changes,
      effects
    });
  } finally {
    resettingEditor = false;
  }
  renderedEditorPath = selectedPath;
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

function currentEditorSelectionRange() {
  if (!editorView) {
    return {
      endColumn: 1,
      endLine: 1,
      startColumn: 1,
      startLine: 1
    };
  }
  const selection = editorView.state.selection.main;
  const from = Math.min(selection.from, selection.to);
  const to = Math.max(selection.from, selection.to);
  const fromLine = editorView.state.doc.lineAt(from);
  const toLine = editorView.state.doc.lineAt(to);
  if (selection.empty) {
    const firstLine = editorView.state.doc.line(1);
    const lastLine = editorView.state.doc.line(editorView.state.doc.lines);
    return {
      endColumn: Math.max(1, lastLine.length + 1),
      endLine: lastLine.number,
      scope: "file",
      startColumn: 1,
      startLine: firstLine.number
    };
  }
  return {
    endColumn: Math.max(1, to - toLine.from + 1),
    endLine: toLine.number,
    scope: "selection",
    startColumn: Math.max(1, from - fromLine.from + 1),
    startLine: fromLine.number
  };
}

function explainCurrentSelection() {
  if (!props.assistantAvailable) {
    return false;
  }
  void editor.explainSelection(currentEditorSelectionRange());
  return true;
}

function retryExplanation() {
  if (!props.assistantAvailable) {
    return false;
  }
  void editor.retryExplanation();
  return true;
}

function sendExplanationFollowup() {
  if (!props.assistantAvailable) {
    return false;
  }
  void editor.sendExplanationFollowup();
  return true;
}

function openExplanationRange(explanation = {}) {
  const sourceRange = explanation?.sourceRange || {};
  if (sourceRange.path) {
    void editor.openFile(sourceRange.path, {
      column: sourceRange.startColumn,
      line: sourceRange.startLine
    });
  }
}

function openExplanationSourceLink(sourceLink = {}) {
  const path = String(sourceLink?.path || "").trim();
  if (!path) {
    return;
  }
  void editor.openFile(path, {
    column: Number(sourceLink.column || 0) || 0,
    line: Number(sourceLink.line || 0) || 0
  });
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
    editor.loadDirectory(normalizedPath);
  } else {
    nextPaths.delete(normalizedPath);
  }
  expandedDirectoryPaths.value = normalizeExpandedDirectoryPaths([...nextPaths]);
}

function resetExpandedDirectoryPaths() {
  expandedDirectoryPaths.value = normalizeExpandedDirectoryPaths(editor.preexpandedDirectoryPaths.value);
}

function closeAllDirectories() {
  expandedDirectoryPaths.value = [];
}

watch(() => props.openRequest, (request = null) => {
  if (request?.path) {
    editor.openRequest(request);
  }
}, {
  deep: true,
  immediate: true
});

watch(() => props.active, async (active) => {
  if (!active) {
    return;
  }
  await nextTick();
  editorView?.requestMeasure?.();
});

watch(editor.loadedVersion, () => {
  replaceEditorDocument();
});

watch(() => editor.activeExplanation.value?.id || "", (explanationId = "") => {
  if (explanationId) {
    explanationCollapsed.value = false;
  }
});

watch(editor.preexpandedDirectoryPaths, (paths) => {
  addExpandedDirectoryPaths(paths);
});

watch(editor.revealedDirectoryPaths, (paths) => {
  addExpandedDirectoryPaths(paths);
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
  sourceEditorUnmounted = true;
  if (explanationFocusTimer) {
    clearTimeout(explanationFocusTimer);
    explanationFocusTimer = null;
  }
  editorView?.destroy();
  editorView = null;
  renderedEditorPath = "";
});
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

.vibe64-source-editor__download-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.vibe64-source-editor {
  block-size: 100%;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-block-size: 0;
  overflow: hidden;
}

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

.vibe64-source-editor__body {
  block-size: 100%;
  contain: layout style;
  display: grid;
  grid-template-columns: minmax(12rem, 17rem) minmax(0, 1fr);
  max-block-size: 100%;
  min-block-size: 0;
  overflow: hidden;
}

.vibe64-source-editor__body--file-list-collapsed {
  grid-template-columns: 2.65rem minmax(0, 1fr);
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

.vibe64-source-editor__side-rail {
  align-items: center;
  appearance: none;
  background: rgba(var(--v-theme-primary), 0.08);
  border: 0;
  color: rgba(var(--v-theme-on-surface), 0.74);
  cursor: pointer;
  display: grid;
  gap: 0.34rem;
  grid-template-rows: auto auto;
  height: 100%;
  justify-items: center;
  min-height: 0;
  min-width: 0;
  padding: 0.56rem 0.18rem;
  width: 100%;
}

.vibe64-source-editor__side-rail:hover,
.vibe64-source-editor__side-rail:focus-visible {
  background: rgba(var(--v-theme-primary), 0.14);
  outline: 0;
}

.vibe64-source-editor__side-rail span {
  font-size: 0.76rem;
  font-weight: 740;
  letter-spacing: 0;
  line-height: 1;
  transform: rotate(180deg);
  writing-mode: vertical-rl;
}

.vibe64-source-editor__side-rail--right {
  background: rgba(var(--v-theme-primary), 0.07);
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

.vibe64-source-editor__new-file-dialog {
  display: grid;
  gap: 0.76rem;
}

.vibe64-source-editor__new-file-dialog p {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.84rem;
  line-height: 1.35;
  margin: 0;
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
  block-size: 100%;
  contain: layout style;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  max-block-size: 100%;
  min-block-size: 0;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

.vibe64-source-editor__workspace {
  block-size: 100%;
  contain: layout style;
  display: grid;
  grid-row: 4;
  grid-template-columns: minmax(0, 1fr);
  max-block-size: 100%;
  min-block-size: 0;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

.vibe64-source-editor__workspace--with-explanation {
  grid-template-columns: minmax(0, 1fr) minmax(18rem, 27rem);
}

.vibe64-source-editor__workspace--explanation-collapsed {
  grid-template-columns: minmax(0, 1fr) 2.65rem;
}

.vibe64-source-editor__explanation-dock {
  block-size: 100%;
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
  min-block-size: 0;
  min-width: 0;
  overflow: hidden;
}

.vibe64-source-editor__explanation-dock > :deep(.vibe64-source-explanation) {
  block-size: 100%;
  height: 100%;
  min-block-size: 0;
}

.vibe64-source-editor__explanation-dock--collapsed {
  border-left: 1px solid rgba(var(--v-border-color), 0.26);
}

.vibe64-source-editor__codemirror {
  contain: layout style paint;
  min-block-size: 0;
  min-width: 0;
  overflow: hidden;
}

.vibe64-source-editor__codemirror :deep(.cm-editor.vibe64-source-editor__codemirror--source-link-hover .cm-content) {
  cursor: pointer;
}

.vibe64-source-editor__codemirror--hidden {
  display: none;
}

.vibe64-source-editor__file-loading {
  background: rgb(var(--v-theme-surface));
  inset: 0;
  overflow: hidden;
  padding: 0.75rem;
  position: absolute;
  z-index: 4;
}

.vibe64-source-editor__file-skeleton {
  height: 100%;
}

.vibe64-source-editor__notice,
.vibe64-source-editor__empty,
.vibe64-source-editor__banner {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.86rem;
  padding: 0.72rem;
}

.vibe64-source-editor__notice--error,
.vibe64-source-editor__banner--error {
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

  .vibe64-source-editor__body--file-list-collapsed {
    grid-template-columns: 1fr;
    grid-template-rows: 2.65rem minmax(0, 1fr);
  }

  .vibe64-source-editor__sidebar {
    border-bottom: 1px solid rgba(var(--v-border-color), 0.26);
    border-right: 0;
  }

  .vibe64-source-editor__side-rail {
    grid-template-columns: auto auto;
    grid-template-rows: 1fr;
    justify-content: start;
    padding: 0.18rem 0.56rem;
  }

  .vibe64-source-editor__side-rail span {
    transform: none;
    writing-mode: horizontal-tb;
  }

  .vibe64-source-editor__workspace--with-explanation {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) minmax(16rem, 42vh);
  }

  .vibe64-source-editor__workspace--explanation-collapsed {
    grid-template-rows: minmax(0, 1fr) 2.65rem;
  }
}

.vibe64-source-editor--code-focus {
  grid-template-rows: auto minmax(0, 1fr);
}

.vibe64-source-editor__body--code-focus {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}
</style>
