<template>
  <section
    ref="sourceEditorElement"
    class="vibe64-source-editor"
    :class="{
      'vibe64-source-editor--code-focus': codeFocusMode,
      'vibe64-source-editor--mobile': mobile,
      'vibe64-source-editor--mobile-file-open': mobile && fileListCollapsed
    }"
    aria-label="Session source editor"
  >
    <Vibe64SourceEditorHeader
      v-if="!singleFile || filePresentation === 'code'"
      v-model:file-list-collapsed="fileListCollapsed"
      v-model:file-presentation="filePresentation"
      :assistant-available="assistantAvailable"
      :assistant-unavailable-message="assistantUnavailableMessage"
      :code-focus-mode="codeFocusMode"
      :displayed-path="displayedPath"
      :downloading-path="downloadingPath"
      :editor="editor"
      :file-bookmarks="fileBookmarks"
      :markdown-renderable="markdownRenderable"
      :mobile="mobile"
      :selected-file-name="selectedFileName"
      :single-file="singleFile"
      :svg-renderable="svgRenderable"
      @command="runEditorCommand"
      @download="requestDownload"
      @explain="explainCurrentSelection"
      @refresh="refreshFiles"
    />

    <Vibe64SourceEditorFinder
      v-if="!singleFile && !codeFocusMode && (!mobile || !fileListCollapsed)"
      :editor="editor"
    />

    <div
      class="vibe64-source-editor__body"
      :class="{
        'vibe64-source-editor__body--code-focus': codeFocusMode || singleFile,
        'vibe64-source-editor__body--file-list-collapsed': fileListCollapsed && !codeFocusMode
      }"
    >
      <Vibe64SourceEditorSidebar
        v-if="!singleFile && !codeFocusMode"
        v-show="!mobile || !fileListCollapsed"
        :assistant-draft-available="assistantDraftAvailable"
        :collapsed="fileListCollapsed"
        :displayed-path="displayedPath"
        :editor="editor"
        :expanded-paths="expandedDirectoryPaths"
        :file-bookmarks="fileBookmarks"
        :files-actions="filesActions"
        @ask-assistant-about-file="emit('ask-assistant-about-file', $event)"
        @close-all-directories="closeAllDirectories"
        @collapse="collapseFileList"
        @directory-open-change="handleDirectoryOpenChange"
        @download-file="requestDownload"
        @expand="expandFileList"
        @new-file="openNewFileDialog"
        @transfer="emit('transfer', $event)"
        @upload="emit('upload', $event)"
      />

      <main v-show="singleFile || !mobile || fileListCollapsed || codeFocusMode" class="vibe64-source-editor__main">
        <div
          v-if="editor.loadError.value && (singleFile || editor.tree.value)"
          class="vibe64-source-editor__banner"
        >
          {{ editor.loadError.value }}
        </div>
        <div
          v-if="editor.downloadOnlyFile.value && !imagePreviewUrl && !editor.loadingFile.value"
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
          v-else-if="!displayedPath && !editor.loadingFile.value"
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
            'vibe64-source-editor__workspace--with-explanation': !singleFile && editor.activeExplanation.value && filePresentation === 'code',
            'vibe64-source-editor__workspace--explanation-collapsed': !singleFile && editor.activeExplanation.value && explanationCollapsed && filePresentation === 'code'
          }"
        >
          <div
            ref="editorElement"
            v-show="filePresentation === 'code'"
            class="vibe64-source-editor__codemirror"
            :class="{ 'vibe64-source-editor__codemirror--hidden': !editor.selectedPath.value || editor.loadingFile.value }"
          />
          <Vibe64SourceInterface
            v-if="editor.selectedPath.value && !editor.loadingFile.value && filePresentation === 'interface'"
            :file-path="editor.selectedPath.value"
            :file-hash="editor.savedHash.value"
            :interpretations="editor.interpretations.value"
            :interpretation-warning="editor.interpretationWarning.value"
            :active-interpretation="activeInterfaceInterpretation"
            :active-file-interpretation="activeFileInterpretation"
            :symbols="interfaceSymbols"
            :programs="interfacePrograms"
            :program-status="interfaceArchitecture?.program?.status"
            :selected-id="interfaceSymbolId"
            :current="interfaceCurrent"
            :indexed="Boolean(interfaceFile)"
            :dirty="editor.dirty.value"
            :busy="editor.explanationBusy.value || editor.explanationClosing.value"
            :analysis-error="architectureFacts ? '' : interfaceGraph?.error.value"
            :assistant-available="assistantAvailable"
            :assistant-unavailable-message="assistantUnavailableMessage"
            :source="interfaceSymbolSource"
            :presentation="symbolPresentation"
            @select-symbol="selectInterfaceSymbol"
            @present-symbol="presentInterfaceSymbol"
            @explain-file="presentFileOverview"
            @whole-file-code="showWholeFileCode"
            @open-source="$emit('open-source-file', $event)"
            @open-program="$emit('open-program', $event)"
          >
            <template #explanation="{ savedBody }">
              <Vibe64SourceExplanationPanel
                v-if="activeInterfaceInterpretation || activeFileInterpretation" embedded
                :saved-body="savedBody"
                :assistant-available="assistantAvailable" :assistant-unavailable-message="assistantUnavailableMessage"
                :busy="editor.explanationBusy.value" :closing="editor.explanationClosing.value"
                :explanation="editor.activeExplanation.value" :followup="editor.explanationFollowup.value" :selected-path="editor.selectedPath.value"
                @close="closeExplanationPanel" @open-range="openExplanationRange" @open-source-link="openExplanationSourceLink"
                @retry="retryExplanation" @send-followup="sendExplanationFollowup" @stop="editor.stopExplanation" @update:followup="editor.updateExplanationFollowup"
              />
            </template>
          </Vibe64SourceInterface>
          <div
            v-if="editor.selectedPath.value && !editor.loadingFile.value && filePresentation === 'rendered' && markdownRenderable"
            class="vibe64-source-editor__markdown"
            aria-label="Formatted document"
            tabindex="0"
          >
            <!-- Links are handled here so they cannot navigate the editor itself. -->
            <div @click="openMarkdownLink">
              <GithubMarkdown :html="renderedMarkdownHtml" />
            </div>
          </div>
          <Vibe64ImagePreview
            v-if="imagePreviewUrl"
            :key="`${imagePreviewUrl}:${imagePreviewVersion}`"
            class="vibe64-source-editor__image-preview"
            :name="selectedFileName"
            :src="imagePreviewUrl"
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
            v-if="!singleFile && editor.activeExplanation.value && filePresentation === 'code'"
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
            <Vibe64SourceEditorSideRail
              v-show="explanationCollapsed"
              aria-label="Show explanation"
              class="vibe64-source-editor__side-rail--right"
              :icon="mdiChevronLeft"
              label="AI"
              title="Show explanation"
              @click="expandExplanation"
            />
          </div>
        </div>
      </main>
    </div>

    <Vibe64SourceNewFileDialog
      ref="newFileDialog"
      :editor="editor"
      @created="newFileCreated"
    />
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
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useDisplay } from "vuetify";
import { mdiChevronLeft, mdiDownload } from "@mdi/js";
import Vibe64SourceInterface from "./Vibe64SourceInterface.vue";
import GithubMarkdown from "@/components/studio/GithubMarkdown.vue";
import Vibe64SourceEditorFinder from "@/components/studio/vibe64-session/Vibe64SourceEditorFinder.vue";
import Vibe64SourceEditorHeader from "@/components/studio/vibe64-session/Vibe64SourceEditorHeader.vue";
import Vibe64SourceEditorSideRail from "@/components/studio/vibe64-session/Vibe64SourceEditorSideRail.vue";
import Vibe64SourceEditorSidebar from "@/components/studio/vibe64-session/Vibe64SourceEditorSidebar.vue";
import Vibe64SourceExplanationPanel from "@/components/studio/vibe64-session/Vibe64SourceExplanationPanel.vue";
import Vibe64SourceNewFileDialog from "@/components/studio/vibe64-session/Vibe64SourceNewFileDialog.vue";
import Vibe64ImagePreview from "@/components/studio/files/Vibe64ImagePreview.vue";
import { useVibe64SourceEditor } from "@/composables/useVibe64SourceEditor.js";
import { useVibe64SourceCodeMirror } from "@/composables/useVibe64SourceCodeMirror.js";
import { useVibe64SourceEditorDownloads } from "@/composables/useVibe64SourceEditorDownloads.js";
import { useVibe64SourceFilePresentation } from "@/composables/useVibe64SourceFilePresentation.js";
import { useVibe64SourceTreeExpansion } from "@/composables/useVibe64SourceTreeExpansion.js";
import { basename } from "@/lib/vibe64SourceFilePaths.js";

const props = defineProps({
  singleFile: { type: Boolean, default: false },
  architectureFacts: { type: Object, default: null },
  agentActive: { type: Boolean, default: false },
  fileBookmarks: { type: Object, default: null },
  active: { default: false, type: Boolean },
  assistantAvailable: { default: true, type: Boolean },
  assistantUnavailableMessage: { default: "The selected AI connection is unavailable for this account.", type: String },
  codeFocusMode: { default: false, type: Boolean },
  openRequest: { default: null, type: Object },
  projectSlug: { default: "", type: String },
  sessionId: { default: "", type: String },
  sessionsApiPath: { default: "", type: String },
  assistantDraftAvailable: { default: false, type: Boolean },
  navigateReferencedSource: { default: null, type: Function },
  sourcePathClickWithoutModifier: { default: false, type: Boolean },
  // Files offers uploads and "Move or copy…" in the tree, and refreshes it
  // after an upload, move or copy.
  filesActions: { default: false, type: Boolean },
  refreshKey: { default: 0, type: Number }
});
const emit = defineEmits(["ask-assistant-about-file", "open-source-file", "interface-location", "open-program", "transfer", "upload"]);

const editorElement = ref(null);
const sourceEditorElement = ref(null);
const newFileDialog = ref(null);
// The CodeMirror view; the editor reads the live text from it.
const editorView = shallowRef(null);
let explanationFocusTimer = null;
let sourceEditorUnmounted = false;
const editor = useVibe64SourceEditor({
  active: () => props.active,
  agentActive: () => props.agentActive,
  navigateReferencedSource: (navigation) => props.navigateReferencedSource?.(navigation),
  projectSlug: () => props.projectSlug,
  readCurrentText: () => editorView.value?.state.doc.toString() ?? "",
  sessionId: () => props.sessionId,
  sessionsApiPath: () => props.sessionsApiPath
});
const {
  activeFileInterpretation,
  activeInterfaceInterpretation,
  filePresentation,
  imagePreviewUrl,
  imagePreviewVersion,
  interfaceArchitecture,
  interfaceCurrent,
  interfaceFile,
  interfaceGraph,
  interfacePrograms,
  interfaceSymbolId,
  interfaceSymbolSource,
  interfaceSymbols,
  markdownRenderable,
  openMarkdownLink,
  presentFileOverview,
  presentInterfaceSymbol,
  renderedMarkdownHtml,
  selectInterfaceSymbol,
  svgRenderable,
  symbolPresentation
} = useVibe64SourceFilePresentation({
  editor,
  onInterfaceLocation: (location) => emit("interface-location", location),
  props
});
function showWholeFileCode() { filePresentation.value = 'code'; nextTick(() => { editorView.value?.requestMeasure(); editorView.value?.focus(); }); }
const displayedPath = computed(() => editor.downloadOnlyFile.value?.path || editor.selectedPath.value);
const selectedFileName = computed(() => (
  editor.loadingPath.value || displayedPath.value
    ? basename(editor.loadingPath.value || displayedPath.value)
    : "Choose a source file"
));

function refreshFiles() {
  imagePreviewVersion.value += 1;
  void editor.refresh();
}

watch([() => props.active, () => props.agentActive], ([active, working], [wasActive, wasWorking]) => {
  if (active && (!wasActive || (wasWorking && !working))) {
    void props.fileBookmarks?.refresh();
  }
});
const {
  downloadDraftOpen,
  downloadError,
  downloadSavedDraft,
  downloadSaving,
  downloadingPath,
  requestDownload,
  saveAndDownload
} = useVibe64SourceEditorDownloads({ editor, props });
watch(() => props.refreshKey, refreshFiles);
const explanationCollapsed = ref(false);
const { smAndDown: mobile } = useDisplay();
const fileListCollapsed = ref(mobile.value);

watch(mobile, (compact) => {
  fileListCollapsed.value = compact;
});

watch(editor.loadingPath, (filePath) => {
  if (mobile.value && filePath) {
    collapseFileList();
  }
});

watch(() => props.openRequest, (request = null) => {
  if (request?.path) {
    if (request.path === editor.selectedPath.value && request.presentation === "code") showWholeFileCode();
    if (request.presentation === "interface") filePresentation.value = "interface";
    editor.openRequest(request);
  }
}, {
  deep: true,
  immediate: true
});

const {
  currentEditorSelectionRange,
  runEditorCommand
} = useVibe64SourceCodeMirror({
  active: () => props.active,
  editor,
  element: editorElement,
  filePresentation,
  sourcePathClickWithoutModifier: () => props.sourcePathClickWithoutModifier,
  viewRef: editorView
});

watch(() => editor.activeExplanation.value?.id || "", (explanationId = "") => {
  if (explanationId) {
    explanationCollapsed.value = false;
  }
});

const {
  closeAllDirectories,
  expandedDirectoryPaths,
  handleDirectoryOpenChange,
  revealCreatedFile
} = useVibe64SourceTreeExpansion({ editor, props });

onBeforeUnmount(() => {
  sourceEditorUnmounted = true;
  if (explanationFocusTimer) {
    clearTimeout(explanationFocusTimer);
    explanationFocusTimer = null;
  }
});

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

function openNewFileDialog(directoryPath = "") {
  newFileDialog.value?.open(directoryPath);
}

function newFileCreated(filePath) {
  revealCreatedFile(filePath);
  if (mobile.value) {
    collapseFileList();
  }
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
</script>

<style scoped>
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

.vibe64-source-editor__markdown {
  min-block-size: 0;
  min-inline-size: 0;
  overflow: auto;
  padding: 1rem 1.25rem 2rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.vibe64-source-editor__markdown > * {
  max-inline-size: 52rem;
}

.vibe64-source-editor__image-preview {
  min-block-size: 0;
  min-inline-size: 0;
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

.vibe64-source-editor__empty,
.vibe64-source-editor__banner {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.86rem;
  padding: 0.72rem;
}

.vibe64-source-editor__banner--error {
  color: rgb(var(--v-theme-error));
}

.vibe64-source-editor__empty {
  align-self: start;
}

@media (max-width: 900px) {
  .vibe64-source-editor__body {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(9rem, 14rem) minmax(0, 1fr);
  }

  .vibe64-source-editor__body--file-list-collapsed {
    grid-template-columns: 1fr;
    grid-template-rows: 2.65rem minmax(0, 1fr);
  }

  .vibe64-source-editor__workspace--with-explanation {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) minmax(16rem, 42vh);
  }

  .vibe64-source-editor__workspace--explanation-collapsed {
    grid-template-rows: minmax(0, 1fr) 2.65rem;
  }
}

.vibe64-source-editor--mobile-file-open {
  grid-template-rows: auto minmax(0, 1fr);
}

.vibe64-source-editor--mobile .vibe64-source-editor__body {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}

.vibe64-source-editor--code-focus {
  grid-template-rows: auto minmax(0, 1fr);
}

.vibe64-source-editor__body--code-focus {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}
</style>
