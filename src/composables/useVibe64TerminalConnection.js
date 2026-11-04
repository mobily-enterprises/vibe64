import { ref } from "vue";
import { terminalResizeErrorMessage } from "@/lib/studioTerminalSize.js";

/**
 * The live stream to a terminal's current session: it opens the driver's
 * connection, reconnects after an unintended disconnect, sends input and size
 * reports, and handles the stream's own messages. Messages about the session
 * itself (snapshot, output, metadata, status) go to `applySessionMessage`.
 * `readTerminalSize()` reads the display's current size.
 * @param {{
 *   driver: import("@/lib/vibe64TerminalDriver.js").Vibe64TerminalDriver,
 *   terminalSessionId: import("vue").Ref<string>,
 *   terminalStatus: import("vue").Ref<string>,
 *   terminalError: import("vue").Ref<string>,
 *   emitTerminalEvent: (type: string, payload?: object) => object,
 *   applySessionMessage: (message: object) => void,
 *   notifyUserData: (input: string) => void,
 *   readTerminalSize: () => ({ cols: number, rows: number } | null),
 *   liveResize: () => boolean,
 *   resizeReportDelay: () => number,
 *   reconnectDelay: number,
 *   reconnectMaxDelay: number
 * }} options
 */
function useVibe64TerminalConnection({
  driver,
  terminalSessionId,
  terminalStatus,
  terminalError,
  emitTerminalEvent,
  applySessionMessage,
  notifyUserData,
  readTerminalSize,
  liveResize,
  resizeReportDelay,
  reconnectDelay,
  reconnectMaxDelay
}) {
  const terminalConnectionStatus = ref("detached");
  let terminalConnection = null;
  let terminalConnectionGeneration = 0;
  let terminalConnectionSessionId = "";
  let terminalConnectionOpenPromise = null;
  let terminalConnectionOpenSessionId = "";
  let terminalReconnectAttempt = 0;
  let terminalReconnectBlocked = false;
  let terminalReconnectTimer = null;
  let terminalResizeReportTimer = null;
  let terminalReportedCols = 0;
  let terminalReportedRows = 0;
  let terminalInitialResizeReported = false;

  function currentSessionId() {
    return String(terminalSessionId.value || "");
  }

  function resetReportedTerminalSize() {
    terminalReportedCols = 0;
    terminalReportedRows = 0;
  }

  function resetInitialTerminalResize() {
    terminalInitialResizeReported = false;
  }

  function terminalSizeAlreadyReported(size = {}) {
    return size.cols === terminalReportedCols && size.rows === terminalReportedRows;
  }

  function cancelTerminalResizeReport() {
    if (terminalResizeReportTimer) {
      window.clearTimeout(terminalResizeReportTimer);
      terminalResizeReportTimer = null;
    }
  }

  function clearTerminalReconnect({
    resetAttempt = true
  } = {}) {
    if (terminalReconnectTimer !== null) {
      globalThis.clearTimeout(terminalReconnectTimer);
      terminalReconnectTimer = null;
    }
    if (resetAttempt) {
      terminalReconnectAttempt = 0;
    }
  }

  function allowTerminalReconnect() {
    terminalReconnectBlocked = false;
  }

  function releaseTerminalConnection(status) {
    const connection = terminalConnection;
    const disconnectedSessionId = terminalConnectionSessionId || currentSessionId();
    terminalConnectionGeneration += 1;
    terminalConnection = null;
    terminalConnectionSessionId = "";
    terminalConnectionOpenPromise = null;
    terminalConnectionOpenSessionId = "";
    terminalConnectionStatus.value = status;
    resetReportedTerminalSize();
    return {
      connection,
      sessionId: disconnectedSessionId
    };
  }

  function closeTerminalSocket() {
    clearTerminalReconnect();
    terminalReconnectBlocked = false;
    const {
      connection,
      sessionId: disconnectedSessionId
    } = releaseTerminalConnection("detached");
    connection?.close();
    if (connection) {
      emitTerminalEvent("disconnected", {
        intentional: true,
        sessionId: disconnectedSessionId
      });
    }
  }

  function terminalCanReconnect(sessionId) {
    return Boolean(
      driver.reconnectOnDisconnect === true &&
      !terminalReconnectBlocked &&
      sessionId &&
      sessionId === currentSessionId() &&
      terminalStatus.value !== "exited"
    );
  }

  function scheduleTerminalReconnect(sessionId) {
    if (terminalReconnectTimer !== null || !terminalCanReconnect(sessionId)) {
      return false;
    }
    const delayMs = Math.min(
      reconnectMaxDelay,
      reconnectDelay * (2 ** terminalReconnectAttempt)
    );
    terminalReconnectAttempt += 1;
    terminalConnectionStatus.value = "reconnecting";
    emitTerminalEvent("reconnecting", {
      attempt: terminalReconnectAttempt,
      delayMs,
      sessionId
    });
    terminalReconnectTimer = globalThis.setTimeout(async () => {
      terminalReconnectTimer = null;
      if (!terminalCanReconnect(sessionId)) {
        return;
      }
      if (!(await connectTerminalSocket())) {
        scheduleTerminalReconnect(sessionId);
      }
    }, delayMs);
    return true;
  }

  function recoverTerminalConnection(sessionId) {
    const { connection } = releaseTerminalConnection("disconnected");
    connection?.close();
    scheduleTerminalReconnect(sessionId);
  }

  function handleTerminalConnectionEvent(message, {
    generation,
    sessionId
  } = {}) {
    if (
      generation !== terminalConnectionGeneration ||
      sessionId !== terminalConnectionSessionId
    ) {
      return;
    }

    if (message?.type === "connected") {
      clearTerminalReconnect({
        resetAttempt: false
      });
      terminalReconnectBlocked = false;
      terminalConnectionStatus.value = "connected";
      terminalError.value = "";
      emitTerminalEvent("connected");
      return;
    }

    if (message?.type === "disconnected") {
      terminalConnectionStatus.value = "disconnected";
      emitTerminalEvent("disconnected", {
        intentional: message.intentional === true
      });
      if (message.intentional !== true) {
        recoverTerminalConnection(sessionId);
      }
      return;
    }

    if (message?.type === "snapshot") {
      terminalReconnectAttempt = 0;
      applySessionMessage(message);
      return;
    }

    if (["output", "metadata", "status"].includes(message?.type)) {
      applySessionMessage(message);
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
      emitTerminalEvent("stream-error", {
        code: String(message.code || ""),
        error
      });
      terminalReconnectBlocked = true;
      clearTerminalReconnect();
      terminalError.value = error;
    }
  }

  async function connectTerminalSocket() {
    if (!terminalSessionId.value) {
      return false;
    }
    if (terminalConnectionSessionId && terminalConnectionSessionId !== terminalSessionId.value) {
      closeTerminalSocket();
    }
    if (terminalConnection?.isOpen() && terminalConnectionSessionId === terminalSessionId.value) {
      return true;
    }
    if (terminalConnectionOpenPromise && terminalConnectionOpenSessionId === terminalSessionId.value) {
      return terminalConnectionOpenPromise;
    }
    if (terminalConnectionOpenPromise) {
      closeTerminalSocket();
    }

    const connectionSessionId = terminalSessionId.value;
    const generation = terminalConnectionGeneration + 1;
    terminalConnectionGeneration = generation;
    terminalConnectionSessionId = connectionSessionId;
    terminalConnectionOpenSessionId = connectionSessionId;
    terminalConnectionStatus.value = "connecting";
    try {
      terminalConnection = driver.openConnection({
        onEvent(message) {
          handleTerminalConnectionEvent(message, {
            generation,
            sessionId: connectionSessionId
          });
        },
        sessionId: connectionSessionId
      });
    } catch {
      terminalConnectionStatus.value = "disconnected";
      scheduleTerminalReconnect(connectionSessionId);
      return false;
    }
    const connection = terminalConnection;
    terminalConnectionOpenPromise = Promise.resolve(connection?.ready).then((ready) => {
      if (
        generation === terminalConnectionGeneration &&
        connectionSessionId === terminalConnectionSessionId
      ) {
        terminalConnectionStatus.value = ready ? "connected" : "disconnected";
        if (ready) {
          terminalError.value = "";
        } else {
          scheduleTerminalReconnect(connectionSessionId);
        }
      }
      return Boolean(ready);
    }).catch(() => {
      if (generation === terminalConnectionGeneration) {
        terminalConnectionStatus.value = "disconnected";
        scheduleTerminalReconnect(connectionSessionId);
      }
      return false;
    }).finally(() => {
      if (generation === terminalConnectionGeneration) {
        terminalConnectionOpenPromise = null;
        terminalConnectionOpenSessionId = "";
      }
    });

    return terminalConnectionOpenPromise;
  }

  async function sendTerminalData(data, {
    source = "program"
  } = {}) {
    if (!terminalSessionId.value || terminalStatus.value === "exited") {
      return false;
    }
    const input = String(data || "");
    if (source === "user") {
      notifyUserData(input);
    }
    emitTerminalEvent("input", {
      data: input,
      source
    });
    if (!(await connectTerminalSocket()) || !terminalConnection?.isOpen()) {
      terminalError.value = "Terminal stream is not connected.";
      return false;
    }
    try {
      return Boolean(await terminalConnection.sendInput(input));
    } catch (error) {
      terminalError.value = String(error?.message || error || "Terminal input failed.");
      return false;
    }
  }

  async function sendTerminalResize() {
    cancelTerminalResizeReport();
    if (!terminalSessionId.value || terminalStatus.value === "exited") {
      return false;
    }
    if (!liveResize() && terminalInitialResizeReported) {
      return false;
    }
    const size = readTerminalSize();
    if (!size || terminalSizeAlreadyReported(size)) {
      return false;
    }
    if (!(await connectTerminalSocket()) || !terminalConnection?.isOpen()) {
      return false;
    }
    terminalReportedCols = size.cols;
    terminalReportedRows = size.rows;
    if (!await terminalConnection.sendResize(size)) {
      return false;
    }
    emitTerminalEvent("resize", size);
    if (!liveResize()) {
      terminalInitialResizeReported = true;
    }
    return true;
  }

  function scheduleTerminalResizeReport() {
    if (!terminalReportedCols || !terminalReportedRows) {
      void sendTerminalResize();
      return;
    }
    const delay = resizeReportDelay();
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

  return {
    allowTerminalReconnect,
    cancelTerminalResizeReport,
    clearTerminalReconnect,
    closeTerminalSocket,
    connectTerminalSocket,
    resetInitialTerminalResize,
    resetReportedTerminalSize,
    scheduleTerminalResizeReport,
    sendTerminalData,
    sendTerminalResize,
    terminalConnectionStatus
  };
}

export {
  useVibe64TerminalConnection
};
