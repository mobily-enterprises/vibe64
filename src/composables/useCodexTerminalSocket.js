import { unref } from "vue";

function assignRef(target, value) {
  if (target && typeof target === "object" && "value" in target) {
    target.value = value;
  }
}

function useCodexTerminalSocket({
  canUseTerminal,
  componentMounted,
  isTerminalSessionNotFound,
  onConnected,
  onError,
  onMessage,
  onMissingTerminal,
  sessionId,
  terminalSessionId,
  terminalStatus,
  webSocketUrl
} = {}) {
  let socket = null;
  let socketOpenPromise = null;
  let reconnectTimer = null;

  function clearReconnect() {
    if (!reconnectTimer) {
      return;
    }
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function closeSocket() {
    clearReconnect();
    const currentSocket = socket;
    socket = null;
    socketOpenPromise = null;
    if (
      currentSocket &&
      currentSocket.readyState !== WebSocket.CLOSED &&
      currentSocket.readyState !== WebSocket.CLOSING
    ) {
      currentSocket.close();
    }
  }

  function shouldReconnect() {
    return Boolean(
      unref(componentMounted) &&
      unref(canUseTerminal) &&
      unref(terminalSessionId) &&
      unref(terminalStatus) !== "exited"
    );
  }

  function scheduleReconnect() {
    if (reconnectTimer || !shouldReconnect()) {
      return;
    }
    reconnectTimer = window.setTimeout(async () => {
      reconnectTimer = null;
      if (!unref(terminalSessionId) || socket || unref(terminalStatus) === "exited") {
        return;
      }
      const connected = await connect();
      if (!connected && unref(terminalSessionId) && unref(terminalStatus) === "disconnected") {
        scheduleReconnect();
      }
    }, 1200);
  }

  async function connect() {
    if (!unref(terminalSessionId) || !unref(sessionId)) {
      return false;
    }
    if (socket?.readyState === WebSocket.OPEN) {
      return true;
    }
    if (socketOpenPromise) {
      return socketOpenPromise;
    }

    assignRef(terminalStatus, unref(terminalStatus) || "connecting");
    socketOpenPromise = new Promise((resolve) => {
      let settled = false;
      const nextSocket = new WebSocket(webSocketUrl(unref(sessionId), unref(terminalSessionId)));
      socket = nextSocket;

      const settle = (ready) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(ready);
      };

      nextSocket.addEventListener("open", () => {
        if (socket !== nextSocket) {
          settle(false);
          return;
        }
        clearReconnect();
        onConnected?.();
        settle(true);
      });

      nextSocket.addEventListener("message", (event) => {
        if (socket !== nextSocket) {
          return;
        }
        onMessage?.(event.data);
      });

      nextSocket.addEventListener("error", () => {
        if (socket !== nextSocket) {
          settle(false);
          return;
        }
        onError?.("Terminal stream failed.");
        settle(false);
      });

      nextSocket.addEventListener("close", (event) => {
        const activeSocketClosed = socket === nextSocket;
        if (activeSocketClosed) {
          socket = null;
        } else {
          settle(false);
          return;
        }
        socketOpenPromise = null;
        settle(false);
        if (isTerminalSessionNotFound?.(event.reason)) {
          onMissingTerminal?.();
          return;
        }
        if (unref(terminalStatus) !== "exited") {
          assignRef(terminalStatus, unref(terminalSessionId) ? "disconnected" : "");
          scheduleReconnect();
        }
      });
    });

    return socketOpenPromise;
  }

  async function sendSocketMessage(message) {
    if (!(await connect()) || socket?.readyState !== WebSocket.OPEN) {
      throw new Error("Terminal stream is not connected.");
    }
    socket.send(JSON.stringify(message));
  }

  async function send(data) {
    await sendSocketMessage({
      data: String(data || ""),
      type: "input"
    });
  }

  async function resize({
    cols,
    rows
  } = {}) {
    await sendSocketMessage({
      cols,
      rows,
      type: "resize"
    });
  }

  return {
    clearReconnect,
    closeSocket,
    connect,
    resize,
    scheduleReconnect,
    send
  };
}

export {
  useCodexTerminalSocket
};
