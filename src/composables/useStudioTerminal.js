import { computed, nextTick, ref } from "vue";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

const MAX_TERMINAL_OUTPUT_LENGTH = 160000;

function trimTerminalOutput(output) {
  const text = String(output || "");
  return text.length <= MAX_TERMINAL_OUTPUT_LENGTH ? text : text.slice(text.length - MAX_TERMINAL_OUTPUT_LENGTH);
}

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
  const terminalStarting = ref(false);

  let terminalInstance = null;
  let terminalFitAddon = null;
  let terminalSocket = null;
  let terminalSocketOpenPromise = null;
  let terminalDataDisposable = null;
  let terminalResizeHandler = null;
  let terminalLatestOutput = "";
  let terminalOutputOffset = 0;
  let terminalSetupPromise = null;

  const notifySessionUpdate = resolveCallback(onSessionUpdate, () => null);
  const notifyStatusUpdate = resolveCallback(onStatusUpdate, () => null);
  const resolveWebSocketUrl = resolveCallback(webSocketUrl, () => "");
  const terminalExited = computed(() => terminalStatus.value === "exited");

  async function setupTerminalUi() {
    if (terminalInstance) {
      await nextTick();
      terminalFitAddon?.fit();
      return true;
    }
    if (terminalSetupPromise) {
      return terminalSetupPromise;
    }

    terminalSetupPromise = (async () => {
      await nextTick();
      if (terminalInstance) {
        terminalFitAddon?.fit();
        return true;
      }
      if (!terminalHost.value) {
        return false;
      }
      terminalHost.value.replaceChildren();
      terminalInstance = new Terminal({
        convertEol: true,
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
      terminalFitAddon.fit();
      terminalDataDisposable = terminalInstance.onData((data) => {
        void sendTerminalData(data);
      });
      terminalResizeHandler = () => {
        terminalFitAddon?.fit();
      };
      window.addEventListener("resize", terminalResizeHandler);
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
    terminalSocketOpenPromise = null;
    if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
      socket.close();
    }
  }

  function disposeTerminalUi() {
    closeTerminalSocket();
    terminalDataDisposable?.dispose?.();
    terminalDataDisposable = null;
    if (terminalResizeHandler) {
      window.removeEventListener("resize", terminalResizeHandler);
      terminalResizeHandler = null;
    }
    terminalInstance?.dispose?.();
    terminalInstance = null;
    terminalFitAddon = null;
    terminalSetupPromise = null;
    terminalOutputOffset = 0;
  }

  function resetTerminalDisplay() {
    terminalLatestOutput = "";
    terminalOutputOffset = 0;
    terminalInstance?.reset?.();
  }

  function resetTerminalSessionState() {
    terminalSessionId.value = "";
    terminalStatus.value = "";
    terminalCommandPreview.value = "";
    terminalExitCode.value = null;
    terminalError.value = "";
  }

  function writeTerminalOutput(output) {
    terminalLatestOutput = trimTerminalOutput(output);
    if (!terminalInstance) {
      return;
    }
    if (terminalLatestOutput.length < terminalOutputOffset) {
      terminalOutputOffset = 0;
      terminalInstance.reset();
    }
    const chunk = terminalLatestOutput.slice(terminalOutputOffset);
    if (chunk) {
      terminalInstance.write(chunk);
      terminalOutputOffset = terminalLatestOutput.length;
    }
  }

  function appendTerminalOutput(chunk) {
    const outputChunk = String(chunk || "");
    if (!outputChunk) {
      return;
    }
    terminalLatestOutput = trimTerminalOutput(`${terminalLatestOutput}${outputChunk}`);
    if (terminalInstance) {
      terminalInstance.write(outputChunk);
      terminalOutputOffset = terminalLatestOutput.length;
    }
  }

  function applyTerminalSession(session = {}, {
    fallbackStatus = ""
  } = {}) {
    const terminalSession = session && typeof session === "object" && !Array.isArray(session) ? session : {};
    terminalSessionId.value = String(terminalSession.id || "");
    terminalStatus.value = String(terminalSession.status || fallbackStatus || "");
    terminalExitCode.value = terminalStatus.value === "exited" ? terminalSession.exitCode ?? null : null;
    terminalCommandPreview.value = String(terminalSession.commandPreview || "");
    writeTerminalOutput(terminalSession.output || "");
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

    if (message?.type === "error") {
      terminalError.value = String(message.error || "Terminal stream failed.");
    }
  }

  async function connectTerminalSocket() {
    if (!terminalSessionId.value) {
      return false;
    }
    if (terminalSocket?.readyState === WebSocket.OPEN) {
      return true;
    }
    if (terminalSocketOpenPromise) {
      return terminalSocketOpenPromise;
    }

    const socketUrl = String(resolveWebSocketUrl(terminalSessionId.value) || "");
    if (!socketUrl) {
      return false;
    }

    terminalSocketOpenPromise = new Promise((resolve) => {
      let settled = false;
      const socket = new WebSocket(socketUrl);
      terminalSocket = socket;
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
        }
        terminalSocketOpenPromise = null;
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

  async function sendCtrlC() {
    await sendTerminalData("\u0003");
  }

  return {
    applyTerminalSession,
    closeTerminalSocket,
    connectTerminalSocket,
    disposeTerminalUi,
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
    terminalSessionId,
    terminalStarting,
    terminalStatus
  };
}

export {
  useStudioTerminal
};
