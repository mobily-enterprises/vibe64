<template>
  <section
    class="vibe64-source-editor"
    aria-label="Session source editor"
  >
    <header class="vibe64-source-editor__header">
      <div class="vibe64-source-editor__title">
        <v-icon
          :icon="mdiFileCodeOutline"
          size="19"
        />
        <div>
          <h2>Editor</h2>
          <p>{{ editor.selectedPath.value || "Choose a source file" }}</p>
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

    <div class="vibe64-source-editor__body">
      <aside class="vibe64-source-editor__sidebar">
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
          :node="editor.tree.value"
          :selected-path="editor.selectedPath.value"
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
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
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
  mdiFileCodeOutline,
  mdiRedoVariant,
  mdiRefresh,
  mdiUndoVariant
} from "@mdi/js";

import Vibe64SourceFileTree from "@/components/studio/vibe64-session/Vibe64SourceFileTree.vue";
import {
  useVibe64SourceEditor
} from "@/composables/useVibe64SourceEditor.js";

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
let editorView = null;
let resettingEditor = false;

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

watch(() => props.openRequest, (request = null) => {
  if (request?.path) {
    editor.openRequest(request);
  }
}, {
  deep: true,
  immediate: true
});

watch(editor.loadedVersion, () => {
  replaceEditorDocument();
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
  grid-template-rows: auto minmax(0, 1fr);
  min-block-size: 0;
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
