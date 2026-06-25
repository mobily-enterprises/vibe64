import { computed, nextTick, ref, unref } from "vue";
import { isDynamicImportError } from "@jskit-ai/kernel/client/asyncModuleRecovery";
import {
  useShellAsyncModuleRecoveryRuntime
} from "@jskit-ai/shell-web/client/asyncModuleRecovery";
import {
  STUDIO_TERMINAL_SCROLLBACK_ROWS,
  reportableTerminalSize,
  terminalResizeErrorMessage
} from "@/lib/studioTerminalSize.js";
import { loadXtermModules } from "@/lib/xtermModuleLoader.js";

function resolveCallback(callback, fallback) {
  return typeof callback === "function" ? callback : fallback;
}

function useStudioTerminal({
  fitOnResize = null,
  liveResize = true,
  onOutput = null,
  onSessionUpdate = null,
  onStatusUpdate = null,
  onUserData = null,
  readOnly = false,
  resizeReportDelayMs = 0,
  webSocketUrl = null
} = {}) {
  const terminalHost = ref(null);
  const terminalSessionId = ref("");
  const terminalStatus = ref("");
  const terminalCommandPreview = ref("");
  const terminalError = ref("");
  const terminalExitCode = ref(null);
  const terminalFocused = ref(false);
  const terminalMetadata = ref({});
  const terminalOutput = ref("");
  const terminalSelectedText = ref("");
  const terminalStarting = ref(false);

  let terminalInstance = null;
  let terminalFitAddon = null;
  let terminalSocket = null;
  let terminalSocketSessionId = "";
  let terminalSocketOpenPromise = null;
  let terminalSocketOpenSessionId = "";
  let terminalDataDisposable = null;
  let terminalSelectionDisposable = null;
  let terminalScrollDisposable = null;
  let terminalFocusInHandler = null;
  let terminalFocusOutHandler = null;
  let terminalWindowBlurHandler = null;
  let terminalResizeHandler = null;
  let terminalResizeReportTimer = null;
  let terminalResizeObserver = null;
  let terminalReportedCols = 0;
  let terminalReportedRows = 0;
  let terminalInitialResizeReported = false;
  let terminalLatestOutput = "";
  let terminalOutputOffset = 0;
  let terminalOutputVersion = 0;
  let terminalFollowOutput = true;
  let terminalSetupPromise = null;

  const notifyOutput = resolveCallback(onOutput, () => null);
  const notifySessionUpdate = resolveCallback(onSessionUpdate, () => null);
  const notifyStatusUpdate = resolveCallback(onStatusUpdate, () => null);
  const notifyUserData = resolveCallback(onUserData, () => null);
  const resolveWebSocketUrl = resolveCallback(webSocketUrl, () => "");
  const asyncModuleRecoveryRuntime = useShellAsyncModuleRecoveryRuntime();
  const terminalExited = computed(() => terminalStatus.value === "exited");

  function terminalReadOnly() {
    return Boolean(typeof readOnly === "function" ? readOnly() : unref(readOnly));
  }

  function terminalLiveResize() {
    return Boolean(typeof liveResize === "function" ? liveResize() : unref(liveResize));
  }

  function terminalFitOnResize() {
    if (fitOnResize === null || typeof fitOnResize === "undefined") {
      return terminalLiveResize();
    }
    return Boolean(typeof fitOnResize === "function" ? fitOnResize() : unref(fitOnResize));
  }

  function terminalResizeReportDelay() {
    const delay = Number(typeof resizeReportDelayMs === "function"
      ? resizeReportDelayMs()
      : unref(resizeReportDelayMs));
    return Number.isFinite(delay) && delay > 0 ? delay : 0;
  }

  function normalizedOutputVersion(value) {
    const version = Number(value || 0);
    return Number.isFinite(version) && version > 0 ? version : 0;
  }

  function resetReportedTerminalSize() {
    terminalReportedCols = 0;
    terminalReportedRows = 0;
  }

  function resetInitialTerminalResize() {
    terminalInitialResizeReported = false;
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

  function terminalSizeAlreadyReported(size = {}) {
    return size.cols === terminalReportedCols && size.rows === terminalReportedRows;
  }

  function fitTerminalUi() {
    if (!terminalFitAddon || !terminalInstance) {
      return false;
    }
    terminalFitAddon.fit();
    terminalInstance.refresh?.(0, Math.max(0, terminalInstance.rows - 1));
    const size = terminalCurrentSize();
    scheduleTerminalResizeReport();
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
      terminalHost.value.replaceChildren();
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
      terminalInstance.open(terminalHost.value);
      fitTerminalUi();
      terminalDataDisposable = terminalInstance.onData((data) => {
        if (terminalReadOnly()) {
          return;
        }
        notifyUserData(data);
        void sendTerminalData(data);
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
      terminalHost.value.addEventListener("focusin", terminalFocusInHandler);
      terminalHost.value.addEventListener("focusout", terminalFocusOutHandler);
      window.addEventListener("blur", terminalWindowBlurHandler);
      terminalResizeHandler = () => {
        fitTerminalUi();
      };
      if (terminalFitOnResize()) {
        window.addEventListener("resize", terminalResizeHandler);
      }
      if (terminalFitOnResize() && typeof ResizeObserver !== "undefined") {
        terminalResizeObserver = new ResizeObserver(() => {
          fitTerminalUi();
        });
        terminalResizeObserver.observe(terminalHost.value);
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

  function closeTerminalSocket() {
    const socket = terminalSocket;
    terminalSocket = null;
    terminalSocketSessionId = "";
    terminalSocketOpenPromise = null;
    terminalSocketOpenSessionId = "";
    resetReportedTerminalSize();
    if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
      socket.close();
    }
  }

  function disposeTerminalDisplay() {
    terminalDataDisposable?.dispose?.();
    terminalDataDisposable = null;
    terminalSelectionDisposable?.dispose?.();
    terminalSelectionDisposable = null;
    terminalScrollDisposable?.dispose?.();
    terminalScrollDisposable = null;
    if (terminalFocusInHandler) {
      terminalHost.value?.removeEventListener("focusin", terminalFocusInHandler);
      terminalFocusInHandler = null;
    }
    if (terminalFocusOutHandler) {
      terminalHost.value?.removeEventListener("focusout", terminalFocusOutHandler);
      terminalFocusOutHandler = null;
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
    if (terminalResizeReportTimer) {
      window.clearTimeout(terminalResizeReportTimer);
      terminalResizeReportTimer = null;
    }
    terminalInstance?.dispose?.();
    terminalInstance = null;
    terminalFitAddon = null;
    terminalSetupPromise = null;
    terminalOutputOffset = 0;
    terminalFollowOutput = true;
    terminalFocused.value = false;
    terminalSelectedText.value = "";
    resetReportedTerminalSize();
  }

  function disposeTerminalUi() {
    closeTerminalSocket();
    disposeTerminalDisplay();
  }

  function resetTerminalDisplay() {
    terminalLatestOutput = "";
    terminalOutputOffset = 0;
    terminalOutputVersion = 0;
    terminalOutput.value = "";
    terminalFollowOutput = true;
    resetReportedTerminalSize();
    resetInitialTerminalResize();
    terminalInstance?.reset?.();
  }

  function resetTerminalSessionState() {
    terminalSessionId.value = "";
    terminalStatus.value = "";
    terminalCommandPreview.value = "";
    terminalExitCode.value = null;
    terminalError.value = "";
    terminalMetadata.value = {};
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
    outputVersion = 0
  } = {}) {
    const previousOutput = terminalLatestOutput;
    const nextOutput = String(output || "");
    const nextOutputVersion = normalizedOutputVersion(outputVersion);
    if (
      nextOutputVersion &&
      terminalOutputVersion &&
      nextOutputVersion < terminalOutputVersion
    ) {
      return false;
    }
    if (previousOutput && !nextOutput.startsWith(previousOutput)) {
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
      notifyOutput({
        outputVersion: terminalOutputVersion,
        output: terminalLatestOutput,
        source: "snapshot"
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
    terminalLatestOutput += outputChunk;
    terminalOutputVersion = Math.max(terminalOutputVersion, nextOutputVersion);
    terminalOutput.value = terminalLatestOutput;
    notifyOutput({
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

  function applyTerminalSession(session = {}, {
    fallbackStatus = "",
    preserveOutput = false,
    resize = true
  } = {}) {
    const terminalSession = session && typeof session === "object" && !Array.isArray(session) ? session : {};
    const nextTerminalSessionId = String(terminalSession.id || "");
    const terminalSessionChanged = Boolean(
      nextTerminalSessionId &&
      terminalSessionId.value &&
      nextTerminalSessionId !== terminalSessionId.value
    );
    if (terminalSessionChanged) {
      closeTerminalSocket();
      resetTerminalDisplay();
    }
    terminalSessionId.value = nextTerminalSessionId;
    terminalStatus.value = String(terminalSession.status || fallbackStatus || "");
    terminalExitCode.value = terminalStatus.value === "exited" ? terminalSession.exitCode ?? null : null;
    terminalCommandPreview.value = String(terminalSession.commandPreview || "");
    terminalMetadata.value = terminalSession.metadata &&
      typeof terminalSession.metadata === "object" &&
      !Array.isArray(terminalSession.metadata)
      ? terminalSession.metadata
      : {};
    if (!preserveOutput || Object.hasOwn(terminalSession, "output")) {
      writeTerminalOutput(terminalSession.output || "", {
        outputVersion: terminalSession.outputVersion
      });
    }
    if (resize) {
      void sendTerminalResize();
    }
    notifySessionUpdate(terminalSession);
    notifyStatusUpdate({
      closeError: String(terminalSession.closeError || ""),
      exitCode: terminalExitCode.value,
      id: terminalSessionId.value,
      status: terminalStatus.value
    });
  }

  function handleTerminalSocketMessage(rawMessage) {
    let message;
    try {
      message = JSON.parse(String(rawMessage || ""));
    } catch {
      terminalError.value = "Terminal stream returned an invalid message.";
      return;
    }

    if (message?.type === "snapshot") {
      applyTerminalSession(message.session || {});
      return;
    }

    if (message?.type === "output") {
      appendTerminalOutput(message.chunk, {
        outputVersion: message.outputVersion
      });
      return;
    }

    if (message?.type === "metadata") {
      terminalMetadata.value = message.metadata &&
        typeof message.metadata === "object" &&
        !Array.isArray(message.metadata)
        ? message.metadata
        : {};
      notifySessionUpdate({
        id: terminalSessionId.value,
        metadata: terminalMetadata.value,
        status: terminalStatus.value
      });
      return;
    }

    if (message?.type === "status") {
      terminalStatus.value = String(message.status || terminalStatus.value || "");
      terminalExitCode.value = message.status === "exited" ? message.exitCode ?? null : null;
      notifyStatusUpdate({
        closeError: String(message.closeError || ""),
        exitCode: terminalExitCode.value,
        id: terminalSessionId.value,
        status: terminalStatus.value
      });
      return;
    }

    if (message?.type === "resize.error") {
      return;
    }

    if (message?.type === "error") {
      const error = String(message.error || "Terminal stream failed.");
      if (terminalResizeErrorMessage(error)) {
        return;
      }
      terminalError.value = error;
    }
  }

  async function connectTerminalSocket() {
    if (!terminalSessionId.value) {
      return false;
    }
    if (terminalSocketSessionId && terminalSocketSessionId !== terminalSessionId.value) {
      closeTerminalSocket();
    }
    if (terminalSocket?.readyState === WebSocket.OPEN && terminalSocketSessionId === terminalSessionId.value) {
      return true;
    }
    if (terminalSocketOpenPromise && terminalSocketOpenSessionId === terminalSessionId.value) {
      return terminalSocketOpenPromise;
    }
    if (terminalSocketOpenPromise) {
      closeTerminalSocket();
    }

    const socketUrl = String(resolveWebSocketUrl(terminalSessionId.value) || "");
    if (!socketUrl) {
      return false;
    }

    const socketSessionId = terminalSessionId.value;
    terminalSocketOpenPromise = new Promise((resolve) => {
      let settled = false;
      const socket = new WebSocket(socketUrl);
      terminalSocket = socket;
      terminalSocketSessionId = socketSessionId;
      terminalSocketOpenSessionId = socketSessionId;
      const settle = (ready) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(ready);
      };
      socket.addEventListener("open", () => {
        terminalError.value = "";
        settle(true);
      });
      socket.addEventListener("message", (event) => {
        handleTerminalSocketMessage(event.data);
      });
      socket.addEventListener("error", () => {
        terminalError.value = "Terminal stream failed.";
        settle(false);
      });
      socket.addEventListener("close", () => {
        if (terminalSocket === socket) {
          terminalSocket = null;
          terminalSocketSessionId = "";
        }
        if (terminalSocketOpenSessionId === socketSessionId) {
          terminalSocketOpenPromise = null;
          terminalSocketOpenSessionId = "";
        }
        settle(false);
      });
    });

    return terminalSocketOpenPromise;
  }

  async function sendTerminalData(data) {
    if (!terminalSessionId.value || terminalStatus.value === "exited") {
      return false;
    }
    if (!(await connectTerminalSocket()) || terminalSocket?.readyState !== WebSocket.OPEN) {
      terminalError.value = "Terminal stream is not connected.";
      return false;
    }
    terminalSocket.send(JSON.stringify({
      data: String(data || ""),
      type: "input"
    }));
    return true;
  }

  async function sendTerminalResize() {
    if (terminalResizeReportTimer) {
      window.clearTimeout(terminalResizeReportTimer);
      terminalResizeReportTimer = null;
    }
    if (!terminalSessionId.value || terminalStatus.value === "exited") {
      return false;
    }
    if (!terminalLiveResize() && terminalInitialResizeReported) {
      return false;
    }
    const size = terminalCurrentSize();
    if (!size || terminalSizeAlreadyReported(size)) {
      return false;
    }
    if (!(await connectTerminalSocket()) || terminalSocket?.readyState !== WebSocket.OPEN) {
      return false;
    }
    terminalReportedCols = size.cols;
    terminalReportedRows = size.rows;
    terminalSocket.send(JSON.stringify({
      cols: size.cols,
      rows: size.rows,
      type: "resize"
    }));
    if (!terminalLiveResize()) {
      terminalInitialResizeReported = true;
    }
    return true;
  }

  function scheduleTerminalResizeReport() {
    if (!terminalReportedCols || !terminalReportedRows) {
      void sendTerminalResize();
      return;
    }
    const delay = terminalResizeReportDelay();
    if (!delay) {
      void sendTerminalResize();
      return;
    }
    if (terminalResizeReportTimer) {
      window.clearTimeout(terminalResizeReportTimer);
    }
    terminalResizeReportTimer = window.setTimeout(() => {
      terminalResizeReportTimer = null;
      void sendTerminalResize();
    }, delay);
  }

  async function sendCtrlC() {
    await sendTerminalData("\u0003");
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
    applyTerminalSession,
    closeTerminalSocket,
    connectTerminalSocket,
    disposeTerminalDisplay,
    disposeTerminalUi,
    focusTerminal,
    resetTerminalDisplay,
    resetTerminalSessionState,
    sendCtrlC,
    sendTerminalData,
    setupTerminalUi,
    terminalCommandPreview,
    terminalError,
    terminalExited,
    terminalExitCode,
    terminalFocused,
    terminalHost,
    terminalMetadata,
    terminalOutput,
    terminalSelectedText,
    terminalSessionId,
    terminalStarting,
    terminalStatus
  };
}

export {
  useStudioTerminal
};
