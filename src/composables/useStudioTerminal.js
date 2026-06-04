import { computed, nextTick, ref, unref } from "vue";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  reportableTerminalSize,
  terminalResizeErrorMessage
} from "@/lib/studioTerminalSize.js";
import { createStudioTerminalRenderOutputFilter } from "@/lib/studioTerminalRenderOutput.js";
import "@xterm/xterm/css/xterm.css";

function resolveCallback(callback, fallback) {
  return typeof callback === "function" ? callback : fallback;
}

function useStudioTerminal({
  liveResize = true,
  onOutput = null,
  onSessionUpdate = null,
  onStatusUpdate = null,
  onUserData = null,
  readOnly = false,
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
  let terminalFocusInHandler = null;
  let terminalFocusOutHandler = null;
  let terminalWindowBlurHandler = null;
  let terminalResizeHandler = null;
  let terminalResizeObserver = null;
  let terminalReportedCols = 0;
  let terminalReportedRows = 0;
  let terminalInitialResizeReported = false;
  let terminalInitialFitDone = false;
  let terminalLatestOutput = "";
  let terminalOutputOffset = 0;
  let terminalOutputVersion = 0;
  let terminalSetupPromise = null;
  const terminalRenderOutputFilter = createStudioTerminalRenderOutputFilter();

  const notifyOutput = resolveCallback(onOutput, () => null);
  const notifySessionUpdate = resolveCallback(onSessionUpdate, () => null);
  const notifyStatusUpdate = resolveCallback(onStatusUpdate, () => null);
  const notifyUserData = resolveCallback(onUserData, () => null);
  const resolveWebSocketUrl = resolveCallback(webSocketUrl, () => "");
  const terminalExited = computed(() => terminalStatus.value === "exited");

  function terminalReadOnly() {
    return Boolean(typeof readOnly === "function" ? readOnly() : unref(readOnly));
  }

  function terminalLiveResize() {
    return Boolean(typeof liveResize === "function" ? liveResize() : unref(liveResize));
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
    if (!terminalLiveResize() && terminalInitialFitDone) {
      return true;
    }
    terminalFitAddon.fit();
    terminalInstance.refresh?.(0, Math.max(0, terminalInstance.rows - 1));
    const size = terminalCurrentSize();
    if (size) {
      terminalInitialFitDone = true;
    }
    void sendTerminalResize();
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
      terminalHost.value.replaceChildren();
      terminalInstance = new Terminal({
        cursorBlink: false,
        disableStdin: false,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        theme: {
          background: "#101216",
          foreground: "#f5f7fb"
        }
      });
      terminalFitAddon = new FitAddon();
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
      if (terminalLiveResize()) {
        window.addEventListener("resize", terminalResizeHandler);
      }
      if (terminalLiveResize() && typeof ResizeObserver !== "undefined") {
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
    terminalInstance?.dispose?.();
    terminalInstance = null;
    terminalFitAddon = null;
    terminalSetupPromise = null;
    terminalOutputOffset = 0;
    terminalRenderOutputFilter.reset();
    terminalInitialFitDone = false;
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
    terminalRenderOutputFilter.reset();
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
      terminalRenderOutputFilter.reset();
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
    const renderChunk = terminalRenderOutputFilter.filter(outputChunk);
    if (renderChunk) {
      terminalInstance.write(renderChunk, scrollTerminalToBottom);
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
    const renderChunk = terminalRenderOutputFilter.filter(outputChunk);
    if (renderChunk) {
      terminalInstance.write(renderChunk, scrollTerminalToBottom);
    }
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

  async function sendCtrlC() {
    await sendTerminalData("\u0003");
  }

  async function focusTerminal() {
    if (!(await setupTerminalUi())) {
      return false;
    }
    terminalInstance?.focus?.();
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
