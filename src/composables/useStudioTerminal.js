import { computed, nextTick, ref } from "vue";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  reportableTerminalSize,
  terminalResizeErrorMessage
} from "@/lib/studioTerminalSize.js";
import "@xterm/xterm/css/xterm.css";

function resolveCallback(callback, fallback) {
  return typeof callback === "function" ? callback : fallback;
}

function useStudioTerminal({
  onSessionUpdate = null,
  onStatusUpdate = null,
  webSocketUrl = null
} = {}) {
  const terminalHost = ref(null);
  const terminalSessionId = ref("");
  const terminalStatus = ref("");
  const terminalCommandPreview = ref("");
  const terminalError = ref("");
  const terminalExitCode = ref(null);
  const terminalMetadata = ref({});
  const terminalOutput = ref("");
  const terminalStarting = ref(false);

  let terminalInstance = null;
  let terminalFitAddon = null;
  let terminalSocket = null;
  let terminalSocketSessionId = "";
  let terminalSocketOpenPromise = null;
  let terminalSocketOpenSessionId = "";
  let terminalDataDisposable = null;
  let terminalResizeHandler = null;
  let terminalResizeObserver = null;
  let terminalReportedCols = 0;
  let terminalReportedRows = 0;
  let terminalLatestOutput = "";
  let terminalOutputOffset = 0;
  let terminalSetupPromise = null;

  const notifySessionUpdate = resolveCallback(onSessionUpdate, () => null);
  const notifyStatusUpdate = resolveCallback(onStatusUpdate, () => null);
  const resolveWebSocketUrl = resolveCallback(webSocketUrl, () => "");
  const terminalExited = computed(() => terminalStatus.value === "exited");

  function resetReportedTerminalSize() {
    terminalReportedCols = 0;
    terminalReportedRows = 0;
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
      return;
    }
    terminalFitAddon.fit();
    terminalInstance.refresh?.(0, Math.max(0, terminalInstance.rows - 1));
    void sendTerminalResize();
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
        void sendTerminalData(data);
      });
      terminalResizeHandler = () => {
        fitTerminalUi();
      };
      window.addEventListener("resize", terminalResizeHandler);
      if (typeof ResizeObserver !== "undefined") {
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
    resetReportedTerminalSize();
  }

  function disposeTerminalUi() {
    closeTerminalSocket();
    disposeTerminalDisplay();
  }

  function resetTerminalDisplay() {
    terminalLatestOutput = "";
    terminalOutputOffset = 0;
    terminalOutput.value = "";
    resetReportedTerminalSize();
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

  function writeTerminalOutput(output) {
    terminalLatestOutput = String(output || "");
    terminalOutput.value = terminalLatestOutput;
    if (!terminalInstance) {
      return;
    }
    if (terminalLatestOutput.length < terminalOutputOffset) {
      terminalInstance.reset();
      terminalOutputOffset = 0;
    }
    const outputChunk = terminalLatestOutput.slice(terminalOutputOffset);
    if (outputChunk) {
      terminalInstance.write(outputChunk, scrollTerminalToBottom);
    }
    terminalOutputOffset = terminalLatestOutput.length;
  }

  function appendTerminalOutput(chunk) {
    const outputChunk = String(chunk || "");
    if (!outputChunk) {
      return;
    }
    terminalLatestOutput += outputChunk;
    terminalOutput.value = terminalLatestOutput;
    if (!terminalInstance) {
      return;
    }
    terminalInstance.write(outputChunk, scrollTerminalToBottom);
    terminalOutputOffset = terminalLatestOutput.length;
  }

  function applyTerminalSession(session = {}, {
    fallbackStatus = ""
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
    writeTerminalOutput(terminalSession.output || "");
    void sendTerminalResize();
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
      appendTerminalOutput(message.chunk);
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
    terminalHost,
    terminalMetadata,
    terminalOutput,
    terminalSessionId,
    terminalStarting,
    terminalStatus
  };
}

export {
  useStudioTerminal
};
