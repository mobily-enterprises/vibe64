import { nextTick, ref, unref } from "vue";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

const CODEX_TERMINAL_SCROLLBACK_LINES = 50000;

function useCodexTerminalViewport({
  expanded,
  onData,
  visible
} = {}) {
  const terminalHost = ref(null);
  const terminalFocused = ref(false);
  const terminalSelectedText = ref("");

  let terminalInstance = null;
  let terminalFitAddon = null;
  let terminalDataDisposable = null;
  let terminalSelectionDisposable = null;
  let terminalFocusInHandler = null;
  let terminalFocusOutHandler = null;
  let terminalDocumentFocusInHandler = null;
  let terminalOutsidePointerHandler = null;
  let terminalWindowBlurHandler = null;
  let terminalResizeHandler = null;
  let terminalSetupPromise = null;
  let terminalOutputOffset = 0;
  let terminalDisplayOutput = "";

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
    terminalFocused.value = true;
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

  function fitTerminal() {
    terminalFitAddon?.fit();
  }

  function resetTerminal() {
    terminalInstance?.reset?.();
    terminalOutputOffset = 0;
    terminalDisplayOutput = "";
  }

  function clearTerminalDisplay() {
    terminalOutputOffset = 0;
    terminalDisplayOutput = "";
  }

  function writeTerminalDisplay(output) {
    const displayOutput = String(output || "");
    if (!terminalInstance) {
      terminalDisplayOutput = displayOutput;
      terminalOutputOffset = displayOutput.length;
      return;
    }
    if (
      displayOutput.length < terminalOutputOffset ||
      !displayOutput.startsWith(terminalDisplayOutput.slice(0, terminalOutputOffset))
    ) {
      terminalOutputOffset = 0;
      terminalInstance.reset();
    }
    const chunk = displayOutput.slice(terminalOutputOffset);
    if (chunk) {
      terminalInstance.write(chunk);
    }
    terminalDisplayOutput = displayOutput;
    terminalOutputOffset = displayOutput.length;
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
        convertEol: true,
        cursorBlink: true,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        scrollback: CODEX_TERMINAL_SCROLLBACK_LINES,
        theme: {
          background: "#101216",
          foreground: "#f5f7fb"
        }
      });
      terminalFitAddon = new FitAddon();
      terminalInstance.loadAddon(terminalFitAddon);
      terminalInstance.open(terminalHost.value);
      if (unref(expanded) && unref(visible)) {
        terminalFitAddon.fit();
      }
      terminalOutputOffset = 0;
      writeTerminalDisplay(terminalDisplayOutput);
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
      terminalResizeHandler = fitTerminal;
      window.addEventListener("resize", terminalResizeHandler);
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

  function disposeTerminalUi() {
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
    if (terminalResizeHandler) {
      window.removeEventListener("resize", terminalResizeHandler);
      terminalResizeHandler = null;
    }
    terminalInstance?.dispose?.();
    terminalInstance = null;
    terminalFitAddon = null;
    terminalOutputOffset = 0;
    terminalDisplayOutput = "";
    terminalFocused.value = false;
    terminalSelectedText.value = "";
  }

  return {
    clearTerminalDisplay,
    disposeTerminalUi,
    fitTerminal,
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
