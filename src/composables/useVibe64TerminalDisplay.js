import { nextTick, ref } from "vue";
import { isDynamicImportError } from "@jskit-ai/kernel/client/asyncModuleRecovery";
import {
  useShellAsyncModuleRecoveryRuntime
} from "@jskit-ai/shell-web/client/asyncModuleRecovery";
import {
  STUDIO_TERMINAL_SCROLLBACK_ROWS,
  reportableTerminalSize,
  terminalTranscriptTail
} from "@/lib/studioTerminalSize.js";
import { loadXtermModules } from "@/lib/xtermModuleLoader.js";

function normalizedOutputVersion(value) {
  const version = Number(value || 0);
  return Number.isFinite(version) && version > 0 ? version : 0;
}

/**
 * A terminal's screen: the one xterm instance on its host element, its focus,
 * selection and fitted size, and the bounded transcript it shows. Typed input
 * and size changes go to the `connection`; each transcript change is reported
 * through `reportOutput(outputEvent)`. `terminalHost` holds the element the
 * terminal mounts on.
 * @param {{
 *   connection: ReturnType<typeof import("./useVibe64TerminalConnection.js").useVibe64TerminalConnection>,
 *   terminalHost: import("vue").Ref<HTMLElement | null>,
 *   terminalError: import("vue").Ref<string>,
 *   readOnly: () => boolean,
 *   fitOnResize: () => boolean,
 *   reportOutput: (outputEvent: { output: string, outputVersion: number, source: string, chunk?: string }) => void
 * }} options
 */
function useVibe64TerminalDisplay({
  connection,
  terminalHost,
  terminalError,
  readOnly,
  fitOnResize,
  reportOutput
}) {
  const terminalFocused = ref(false);
  const terminalOutput = ref("");
  const terminalSelectedText = ref("");
  const asyncModuleRecoveryRuntime = useShellAsyncModuleRecoveryRuntime();

  let terminalInstance = null;
  let terminalFitAddon = null;
  let terminalDataDisposable = null;
  let terminalSelectionDisposable = null;
  let terminalScrollDisposable = null;
  let terminalFocusInHandler = null;
  let terminalFocusOutHandler = null;
  let terminalWindowBlurHandler = null;
  let terminalResizeHandler = null;
  let terminalResizeObserver = null;
  let terminalLatestOutput = "";
  let terminalOutputOffset = 0;
  let terminalOutputVersion = 0;
  let terminalFollowOutput = true;
  let terminalSetupPromise = null;
  let terminalMountedHost = null;

  function currentOutputVersion() {
    return terminalOutputVersion;
  }

  function updateTerminalSelection() {
    terminalSelectedText.value = terminalInstance?.hasSelection?.()
      ? terminalInstance.getSelection()
      : "";
  }

  function terminalViewportAtBottom() {
    const buffer = terminalInstance?.buffer?.active;
    if (!buffer) {
      return true;
    }
    const viewportY = Number(buffer.viewportY);
    const baseY = Number(buffer.baseY);
    if (!Number.isFinite(viewportY) || !Number.isFinite(baseY)) {
      return true;
    }
    return viewportY >= baseY;
  }

  function updateTerminalFollowOutput() {
    terminalFollowOutput = terminalViewportAtBottom();
  }

  function syncTerminalFocus() {
    const host = terminalHost.value;
    const activeElement = document.activeElement;
    terminalFocused.value = Boolean(host && activeElement && host.contains(activeElement));
  }

  function terminalCurrentSize() {
    return reportableTerminalSize({
      cols: terminalInstance?.cols,
      rows: terminalInstance?.rows
    });
  }

  function fitTerminalUi() {
    if (!terminalFitAddon || !terminalInstance) {
      return false;
    }
    terminalFitAddon.fit();
    terminalInstance.refresh?.(0, Math.max(0, terminalInstance.rows - 1));
    const size = terminalCurrentSize();
    connection.scheduleTerminalResizeReport();
    return Boolean(size);
  }

  async function setupTerminalUi() {
    if (terminalInstance) {
      await nextTick();
      fitTerminalUi();
      return true;
    }
    if (terminalSetupPromise) {
      return terminalSetupPromise;
    }

    terminalSetupPromise = (async () => {
      await nextTick();
      if (terminalInstance) {
        fitTerminalUi();
        return true;
      }
      if (!terminalHost.value) {
        return false;
      }
      const host = terminalHost.value;
      let terminalLibrary;
      try {
        terminalLibrary = await loadXtermModules();
      } catch (error) {
        terminalError.value = "Terminal module could not load. Check your connection and retry.";
        asyncModuleRecoveryRuntime?.notify?.(error, {
          label: "Terminal",
          stale: isDynamicImportError(error)
        });
        return false;
      }
      if (!terminalHost.value || terminalHost.value !== host) {
        return false;
      }
      host.replaceChildren();
      terminalInstance = new terminalLibrary.Terminal({
        cursorBlink: false,
        disableStdin: false,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        scrollback: STUDIO_TERMINAL_SCROLLBACK_ROWS,
        theme: {
          background: "#101216",
          foreground: "#f5f7fb"
        }
      });
      terminalFitAddon = new terminalLibrary.FitAddon();
      terminalInstance.loadAddon(terminalFitAddon);
      terminalInstance.open(host);
      terminalMountedHost = host;
      fitTerminalUi();
      terminalDataDisposable = terminalInstance.onData((data) => {
        if (readOnly()) {
          return;
        }
        void connection.sendTerminalData(data, {
          source: "user"
        });
      });
      terminalSelectionDisposable = terminalInstance.onSelectionChange(updateTerminalSelection);
      terminalScrollDisposable = terminalInstance.onScroll?.(updateTerminalFollowOutput) || null;
      terminalFocusInHandler = () => {
        terminalFocused.value = true;
      };
      terminalFocusOutHandler = () => {
        window.setTimeout(syncTerminalFocus, 0);
      };
      terminalWindowBlurHandler = () => {
        terminalFocused.value = false;
      };
      host.addEventListener("focusin", terminalFocusInHandler);
      host.addEventListener("focusout", terminalFocusOutHandler);
      window.addEventListener("blur", terminalWindowBlurHandler);
      terminalResizeHandler = () => {
        fitTerminalUi();
      };
      if (fitOnResize()) {
        window.addEventListener("resize", terminalResizeHandler);
      }
      if (fitOnResize() && typeof ResizeObserver !== "undefined") {
        terminalResizeObserver = new ResizeObserver(() => {
          fitTerminalUi();
        });
        terminalResizeObserver.observe(host);
      }
      writeTerminalOutput(terminalLatestOutput);
      return true;
    })();

    try {
      return await terminalSetupPromise;
    } finally {
      terminalSetupPromise = null;
    }
  }

  function disposeTerminalDisplay() {
    terminalDataDisposable?.dispose?.();
    terminalDataDisposable = null;
    terminalSelectionDisposable?.dispose?.();
    terminalSelectionDisposable = null;
    terminalScrollDisposable?.dispose?.();
    terminalScrollDisposable = null;
    const mountedHost = terminalMountedHost || terminalHost.value;
    if (terminalFocusInHandler) {
      mountedHost?.removeEventListener("focusin", terminalFocusInHandler);
      terminalFocusInHandler = null;
    }
    if (terminalFocusOutHandler) {
      mountedHost?.removeEventListener("focusout", terminalFocusOutHandler);
      terminalFocusOutHandler = null;
    }
    terminalMountedHost = null;
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
    connection.cancelTerminalResizeReport();
    terminalInstance?.dispose?.();
    terminalInstance = null;
    terminalFitAddon = null;
    terminalSetupPromise = null;
    terminalOutputOffset = 0;
    terminalFollowOutput = true;
    terminalFocused.value = false;
    terminalSelectedText.value = "";
    connection.resetReportedTerminalSize();
  }

  function resetTerminalDisplay() {
    terminalLatestOutput = "";
    terminalOutputOffset = 0;
    terminalOutputVersion = 0;
    terminalOutput.value = "";
    terminalFollowOutput = true;
    connection.resetReportedTerminalSize();
    connection.resetInitialTerminalResize();
    terminalInstance?.reset?.();
  }

  function scrollTerminalToBottom() {
    terminalInstance?.scrollToBottom?.();
    terminalFollowOutput = true;
  }

  function scrollTerminalToBottomIfFollowing() {
    if (terminalFollowOutput) {
      scrollTerminalToBottom();
    }
  }

  function writeTerminalOutput(output, {
    outputVersion = 0,
    replace = false
  } = {}) {
    const previousOutput = terminalLatestOutput;
    const nextOutput = terminalTranscriptTail(output);
    const nextOutputVersion = normalizedOutputVersion(outputVersion);
    if (
      nextOutputVersion &&
      terminalOutputVersion &&
      nextOutputVersion < terminalOutputVersion
    ) {
      return false;
    }
    if (replace) {
      terminalInstance?.reset?.();
      terminalOutputOffset = 0;
    } else if (previousOutput && !nextOutput.startsWith(previousOutput)) {
      if (!nextOutputVersion || nextOutputVersion <= terminalOutputVersion) {
        return false;
      }
      terminalInstance?.reset?.();
      terminalOutputOffset = 0;
    }
    terminalLatestOutput = nextOutput;
    terminalOutputVersion = Math.max(terminalOutputVersion, nextOutputVersion);
    terminalOutput.value = terminalLatestOutput;
    if (terminalLatestOutput !== previousOutput) {
      reportOutput({
        outputVersion: terminalOutputVersion,
        output: terminalLatestOutput,
        source: replace ? "replacement" : "snapshot"
      });
    }
    if (!terminalInstance) {
      return;
    }
    if (terminalLatestOutput.length < terminalOutputOffset) {
      terminalInstance.reset();
      terminalOutputOffset = 0;
    }
    const outputChunk = terminalLatestOutput.slice(terminalOutputOffset);
    if (outputChunk) {
      terminalInstance.write(outputChunk, scrollTerminalToBottomIfFollowing);
    }
    terminalOutputOffset = terminalLatestOutput.length;
    return true;
  }

  function appendTerminalOutput(chunk, {
    outputVersion = 0
  } = {}) {
    const outputChunk = String(chunk || "");
    if (!outputChunk) {
      return false;
    }
    const nextOutputVersion = normalizedOutputVersion(outputVersion);
    if (
      nextOutputVersion &&
      terminalOutputVersion &&
      nextOutputVersion <= terminalOutputVersion
    ) {
      return false;
    }
    // The PTY stream is incremental; this string is only its reconnect,
    // matcher, and copy tail. Keeping complete terminal history here made
    // every active Codex repaint rescan and copy an ever-growing transcript
    // (hundreds of MB in seconds for long sessions). Keep history bounded at
    // its owner instead of masking the feedback with timers or throttles.
    terminalLatestOutput = terminalTranscriptTail(terminalLatestOutput + outputChunk);
    terminalOutputVersion = Math.max(terminalOutputVersion, nextOutputVersion);
    terminalOutput.value = terminalLatestOutput;
    reportOutput({
      chunk: outputChunk,
      output: terminalLatestOutput,
      outputVersion: terminalOutputVersion,
      source: "append"
    });
    if (!terminalInstance) {
      return true;
    }
    terminalInstance.write(outputChunk, scrollTerminalToBottomIfFollowing);
    terminalOutputOffset = terminalLatestOutput.length;
    return true;
  }

  async function focusTerminal() {
    if (!(await setupTerminalUi())) {
      return false;
    }
    try {
      terminalInstance?.focus?.();
    } catch (error) {
      terminalError.value = String(error?.message || error || "Terminal focus failed.");
      return false;
    }
    syncTerminalFocus();
    return true;
  }

  return {
    appendTerminalOutput,
    currentOutputVersion,
    disposeTerminalDisplay,
    focusTerminal,
    resetTerminalDisplay,
    setupTerminalUi,
    terminalCurrentSize,
    terminalFocused,
    terminalOutput,
    terminalSelectedText,
    writeTerminalOutput
  };
}

export {
  useVibe64TerminalDisplay
};
