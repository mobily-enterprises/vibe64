import { nextTick, onBeforeUnmount, onMounted, watch } from "vue";
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
  syntaxHighlighting
} from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import {
  sourcePathReferenceAtLineColumn
} from "@/lib/vibe64SourceEditorLinks.js";
import {
  sourceEditorDocumentChanges
} from "@/lib/vibe64SourceEditorDocumentChanges.js";
import {
  languageExtension,
  sourceEditorLineWrappingExtension
} from "@/lib/vibe64SourceEditorLanguages.js";

const SOURCE_EDITOR_THEME = EditorView.theme({
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
  // The gutter stays in place while a long line scrolls sideways (a
  // phone editing one line), so its tint sits on an opaque surface:
  // a translucent gutter let the scrolled code show through the numbers.
  ".cm-gutters": {
    backgroundColor: "rgb(var(--v-theme-surface))",
    backgroundImage: "linear-gradient(rgba(var(--v-theme-surface-variant), 0.38), rgba(var(--v-theme-surface-variant), 0.38))",
    borderRight: "1px solid rgba(var(--v-border-color), 0.28)",
    color: "rgba(var(--v-theme-on-surface), 0.56)"
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
  },
  ".cm-selectionBackground": {
    backgroundColor: "rgba(var(--v-theme-primary), 0.22)"
  }
});

function sourcePathModifierPressed(event = {}) {
  return event.ctrlKey || event.metaKey;
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

/**
 * The CodeMirror view of the selected source file: it opens on mount, follows
 * each file the editor loads while keeping the scroll position of a reloaded
 * file, reports edits to the editor, and opens source paths clicked in the code.
 * @param {object} options
 * @param {() => boolean} options.active
 * @param {ReturnType<typeof import("@/composables/useVibe64SourceEditor.js").useVibe64SourceEditor>} options.editor
 * @param {import("vue").Ref<HTMLElement | null>} options.element The element the view is placed in.
 * @param {import("vue").Ref<string>} options.filePresentation
 * @param {() => boolean} options.sourcePathClickWithoutModifier
 * @param {import("vue").ShallowRef<EditorView | null>} options.viewRef Holds the view, which the editor reads its live text from.
 */
function useVibe64SourceCodeMirror({
  active,
  editor,
  element,
  filePresentation,
  sourcePathClickWithoutModifier,
  viewRef
}) {
  let renderedEditorPath = "";
  let resettingEditor = false;
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

  function sourcePathNavigationGesture(event = {}) {
    return sourcePathClickWithoutModifier() || sourcePathModifierPressed(event);
  }

  function createEditor() {
    if (!element.value || viewRef.value) {
      return;
    }
    viewRef.value = new EditorView({
      parent: element.value,
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
          SOURCE_EDITOR_THEME
        ]
      })
    });
    renderedEditorPath = editor.selectedPath.value;
  }

  function replaceEditorDocument() {
    const editorView = viewRef.value;
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
    const editorView = viewRef.value;
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
    if (filePresentation.value === "code") editorView.focus();
  }

  function runEditorCommand(command = "") {
    const editorView = viewRef.value;
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
    const editorView = viewRef.value;
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

  watch(active, async (isActive) => {
    if (!isActive) {
      return;
    }
    await nextTick();
    viewRef.value?.requestMeasure();
  });

  watch(editor.loadedVersion, () => {
    replaceEditorDocument();
  });

  onMounted(() => {
    createEditor();
  });

  onBeforeUnmount(() => {
    viewRef.value?.destroy();
    viewRef.value = null;
    renderedEditorPath = "";
  });

  return {
    currentEditorSelectionRange,
    runEditorCommand
  };
}

export { useVibe64SourceCodeMirror };
