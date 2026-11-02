import { nextTick } from "vue";

/**
 * Where keyboard focus goes in a Files area: back to what opened a dialog
 * once it closes, to a row by its path, or to a folder's first item.
 * @param {object} options
 * @param {import("vue").Ref<HTMLElement | null>} options.root The area's element.
 */
function useVibe64FileAreaFocus({ root }) {
  // Where focus goes back to when a dialog closes: the control that opened it,
  // or the row it was about when that control lived in a closed menu.
  let returnFocus = null;

  function rowElement(path) {
    return path ? root.value?.querySelector(`[data-path="${path.replace(/["\\]/gu, "\\$&")}"]`) : null;
  }

  // After moving to another folder, focus its first item, or its empty state.
  function focusFolder() {
    root.value?.querySelector("[data-path], .vibe64-file-area__empty h3")?.focus();
  }

  function rememberFocus(path = "") {
    const active = globalThis.document?.activeElement;
    returnFocus = active && !active.closest(".v-overlay") ? active : path;
  }

  // Focus has already moved on, so a closing dialog leaves it where it is.
  function forgetFocus() {
    returnFocus = null;
  }

  async function restoreFocus() {
    const target = returnFocus;
    returnFocus = null;
    await nextTick();
    const element = typeof target === "string" ? rowElement(target) : target;
    if (element?.isConnected) element.focus();
    else if (target !== null) focusFolder();
  }

  return {
    focusFolder,
    forgetFocus,
    rememberFocus,
    restoreFocus,
    rowElement
  };
}

export { useVibe64FileAreaFocus };
