import { nextTick, onBeforeUnmount, ref } from "vue";

/**
 * The source editor's explanation dock: whether it is collapsed, and where
 * focus goes once the layout settles after the explanation collapses, expands
 * or closes. A click's event names the editor holding the control that was
 * used; without one, focus stays in this editor. The pending focus is dropped
 * when the editor unmounts.
 * @param {object} options
 * @param {import("@/types.js").Vibe64SourceEditor} options.editor
 * @param {import("vue").Ref<HTMLElement | null>} options.sourceEditorElement The editor's root element.
 */
function useVibe64SourceExplanationDock({ editor, sourceEditorElement }) {
  const explanationCollapsed = ref(false);
  let explanationFocusTimer = null;
  let sourceEditorUnmounted = false;

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
      rootElement?.querySelector(selector)?.focus();
    }, 0);
  }

  function collapseExplanation(event = {}) {
    const rootElement = event.currentTarget?.closest(".vibe64-source-editor") || sourceEditorElement.value;
    explanationCollapsed.value = true;
    void focusAfterLayout(rootElement, ".vibe64-source-editor__side-rail--right");
  }

  function expandExplanation(event = {}) {
    const rootElement = event.currentTarget?.closest(".vibe64-source-editor") || sourceEditorElement.value;
    explanationCollapsed.value = false;
    void focusAfterLayout(rootElement, ".vibe64-source-explanation__range");
  }

  async function closeExplanationPanel(event = {}) {
    const rootElement = event.currentTarget?.closest(".vibe64-source-editor") || sourceEditorElement.value;
    if (await editor.closeExplanation()) {
      void focusAfterLayout(rootElement, ".vibe64-source-editor__explain-button");
    }
  }

  return {
    closeExplanationPanel,
    collapseExplanation,
    expandExplanation,
    explanationCollapsed
  };
}

export { useVibe64SourceExplanationDock };
