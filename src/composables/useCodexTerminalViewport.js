import { nextTick, ref, unref } from "vue";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

const CODEX_TERMINAL_SCROLLBACK_LINES = 50000;

function useCodexTerminalViewport({
  expanded,
  onData,
  onResize,
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
  let terminalResizeObserver = null;
  let pendingFitFrame = null;
  let terminalSetupPromise = null;
  let terminalReportedCols = 0;
  let terminalReportedRows = 0;
  let pendingTerminalDisplay = "";

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

  function terminalCanFit() {
    return Boolean(terminalInstance && terminalFitAddon && unref(expanded) && unref(visible));
  }

  function fitTerminal(options = {}) {
    if (!terminalCanFit()) {
      return;
    }
    terminalFitAddon.fit();
    reportTerminalSize(options);
    terminalInstance.refresh?.(0, Math.max(0, terminalInstance.rows - 1));
  }

  function markTerminalSizeReported({
    cols,
    rows
  } = {}) {
    terminalReportedCols = cols;
    terminalReportedRows = rows;
  }

  function resetReportedTerminalSize() {
    terminalReportedCols = 0;
    terminalReportedRows = 0;
  }

  function reportTerminalSize({
    forceResize = false
  } = {}) {
    const cols = Number(terminalInstance?.cols || 0);
    const rows = Number(terminalInstance?.rows || 0);
    if (!cols || !rows || (!forceResize && cols === terminalReportedCols && rows === terminalReportedRows)) {
      return;
    }
    const size = {
      cols,
      rows
    };
    const resizeResult = onResize?.(size);
    if (resizeResult && typeof resizeResult.then === "function") {
      resizeResult.then((resized) => {
        if (resized !== false) {
          markTerminalSizeReported(size);
        }
      }).catch(() => null);
      return;
    }
    if (resizeResult !== false) {
      markTerminalSizeReported(size);
    }
  }

  function cancelScheduledFit() {
    if (pendingFitFrame === null) {
      return;
    }
    const cancelFrame = typeof window.cancelAnimationFrame === "function"
      ? window.cancelAnimationFrame.bind(window)
      : window.clearTimeout.bind(window);
    cancelFrame(pendingFitFrame);
    pendingFitFrame = null;
  }

  function scheduleTerminalFit() {
    if (pendingFitFrame !== null || !terminalCanFit()) {
      return;
    }
    const requestFrame = typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame.bind(window)
      : window.setTimeout.bind(window);
    pendingFitFrame = requestFrame(() => {
      pendingFitFrame = null;
      fitTerminal();
    });
  }

  function resetTerminal() {
    terminalInstance?.reset?.();
    pendingTerminalDisplay = "";
    resetReportedTerminalSize();
  }

  function clearTerminalDisplay() {
    pendingTerminalDisplay = "";
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
      return;
    }
    pendingTerminalDisplay += chunk;
  }

  function writeTerminalDisplay(output) {
    const displayOutput = String(output || "");
    pendingTerminalDisplay = displayOutput;
    if (!terminalInstance) {
      return;
    }
    terminalInstance.reset();
    terminalInstance.write(displayOutput, scrollTerminalToBottom);
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
        fitTerminal();
      }
      writeTerminalDisplay(pendingTerminalDisplay);
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
      terminalResizeHandler = scheduleTerminalFit;
      window.addEventListener("resize", terminalResizeHandler);
      if (typeof ResizeObserver !== "undefined") {
        terminalResizeObserver = new ResizeObserver(scheduleTerminalFit);
        terminalResizeObserver.observe(terminalHost.value);
      }
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
    if (terminalResizeHandler) {
      window.removeEventListener("resize", terminalResizeHandler);
      terminalResizeHandler = null;
    }
    terminalResizeObserver?.disconnect?.();
    terminalResizeObserver = null;
    cancelScheduledFit();
    terminalInstance?.dispose?.();
    terminalInstance = null;
    terminalFitAddon = null;
    resetReportedTerminalSize();
    if (!preserveDisplay) {
      pendingTerminalDisplay = "";
    }
    terminalFocused.value = false;
    terminalSelectedText.value = "";
  }

  return {
    appendTerminalDisplay,
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
