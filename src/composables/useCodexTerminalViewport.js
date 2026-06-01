import { nextTick, ref } from "vue";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

const CODEX_TERMINAL_COLS = 100;
const CODEX_TERMINAL_ROWS = 28;
const CODEX_TERMINAL_SCROLLBACK_LINES = 50000;

function useCodexTerminalViewport({
  onData
} = {}) {
  const terminalHost = ref(null);
  const terminalFocused = ref(false);
  const terminalSelectedText = ref("");

  let terminalInstance = null;
  let terminalDataDisposable = null;
  let terminalSelectionDisposable = null;
  let terminalFocusInHandler = null;
  let terminalFocusOutHandler = null;
  let terminalDocumentFocusInHandler = null;
  let terminalOutsidePointerHandler = null;
  let terminalWindowBlurHandler = null;
  let terminalSetupPromise = null;

  function updateSelection() {
    terminalSelectedText.value = terminalInstance?.hasSelection?.()
      ? terminalInstance.getSelection()
      : "";
    return terminalSelectedText.value;
  }

  function syncFocus() {
    const host = terminalHost.value;
    const activeElement = document.activeElement;
    terminalFocused.value = Boolean(host && activeElement && host.contains(activeElement));
  }

  function focusTerminal() {
    terminalInstance?.focus?.();
    syncFocus();
    window.setTimeout(syncFocus, 0);
  }

  function blurTerminal() {
    terminalInstance?.blur?.();
    terminalFocused.value = false;
  }

  function handleDocumentPointerDown(event) {
    const host = terminalHost.value;
    const target = event.target;
    if (!host || !(target instanceof Node) || host.contains(target)) {
      return;
    }
    blurTerminal();
  }

  function resetTerminal() {
    return undefined;
  }

  function clearTerminalDisplay() {
    return undefined;
  }

  function scrollTerminalToBottom() {
    terminalInstance?.scrollToBottom?.();
  }

  function appendTerminalDisplay(outputChunk) {
    const chunk = String(outputChunk || "");
    if (!chunk) {
      return;
    }
    if (terminalInstance) {
      terminalInstance.write(chunk, scrollTerminalToBottom);
    }
  }

  function writeTerminalDisplay(output) {
    appendTerminalDisplay(output);
  }

  async function setupTerminalUi() {
    if (terminalInstance) {
      return true;
    }
    if (terminalSetupPromise) {
      return terminalSetupPromise;
    }

    terminalSetupPromise = (async () => {
      await nextTick();
      if (!terminalHost.value) {
        return false;
      }
      terminalInstance = new Terminal({
        cols: CODEX_TERMINAL_COLS,
        cursorBlink: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        rows: CODEX_TERMINAL_ROWS,
        scrollback: CODEX_TERMINAL_SCROLLBACK_LINES,
        theme: {
          background: "#101216",
          foreground: "#f5f7fb"
        }
      });
      terminalInstance.open(terminalHost.value);
      terminalDataDisposable = terminalInstance.onData((data) => {
        onData?.(data);
      });
      terminalFocusInHandler = () => {
        terminalFocused.value = true;
      };
      terminalFocusOutHandler = () => {
        window.setTimeout(syncFocus, 0);
      };
      terminalDocumentFocusInHandler = () => {
        window.setTimeout(syncFocus, 0);
      };
      terminalOutsidePointerHandler = handleDocumentPointerDown;
      terminalWindowBlurHandler = () => {
        terminalFocused.value = false;
      };
      terminalHost.value.addEventListener("focusin", terminalFocusInHandler);
      terminalHost.value.addEventListener("focusout", terminalFocusOutHandler);
      document.addEventListener("focusin", terminalDocumentFocusInHandler, true);
      document.addEventListener("pointerdown", terminalOutsidePointerHandler, true);
      window.addEventListener("blur", terminalWindowBlurHandler);
      terminalSelectionDisposable = terminalInstance.onSelectionChange(updateSelection);
      return true;
    })();

    try {
      return await terminalSetupPromise;
    } finally {
      terminalSetupPromise = null;
    }
  }

  function visibleTerminalText() {
    const buffer = terminalInstance?.buffer?.active;
    if (!buffer || !terminalInstance) {
      return "";
    }
    const startLine = Math.max(0, buffer.baseY + buffer.viewportY);
    const endLine = Math.min(buffer.length, startLine + terminalInstance.rows);
    const lines = [];
    for (let lineIndex = startLine; lineIndex < endLine; lineIndex += 1) {
      lines.push(buffer.getLine(lineIndex)?.translateToString(true) || "");
    }
    return lines.join("\n").trim();
  }

  function disposeTerminalUi({
    preserveDisplay = false
  } = {}) {
    terminalDataDisposable?.dispose?.();
    terminalDataDisposable = null;
    terminalSelectionDisposable?.dispose?.();
    terminalSelectionDisposable = null;
    if (terminalFocusInHandler) {
      terminalHost.value?.removeEventListener("focusin", terminalFocusInHandler);
      terminalFocusInHandler = null;
    }
    if (terminalFocusOutHandler) {
      terminalHost.value?.removeEventListener("focusout", terminalFocusOutHandler);
      terminalFocusOutHandler = null;
    }
    if (terminalDocumentFocusInHandler) {
      document.removeEventListener("focusin", terminalDocumentFocusInHandler, true);
      terminalDocumentFocusInHandler = null;
    }
    if (terminalOutsidePointerHandler) {
      document.removeEventListener("pointerdown", terminalOutsidePointerHandler, true);
      terminalOutsidePointerHandler = null;
    }
    if (terminalWindowBlurHandler) {
      window.removeEventListener("blur", terminalWindowBlurHandler);
      terminalWindowBlurHandler = null;
    }
    terminalInstance?.dispose?.();
    terminalInstance = null;
    void preserveDisplay;
    terminalFocused.value = false;
    terminalSelectedText.value = "";
  }

  return {
    appendTerminalDisplay,
    clearTerminalDisplay,
    disposeTerminalUi,
    focusTerminal,
    resetTerminal,
    setupTerminalUi,
    terminalFocused,
    terminalHost,
    terminalSelectedText,
    visibleTerminalText,
    writeTerminalDisplay
  };
}

export {
  useCodexTerminalViewport
};
