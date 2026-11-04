import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * A live connection to one terminal session: whether it is open, when it is ready, and the input and size reports
 * it sends.
 * @typedef {object} Vibe64TerminalDriverConnection
 * @property {() => void} close
 * @property {() => boolean} isOpen
 * @property {Promise<boolean>} ready Settles true once the connection opens, false when it fails first.
 * @property {(data: string) => boolean} sendInput
 * @property {(size: { cols: number, rows: number }) => boolean} sendResize
 */

/**
 * How a terminal reaches its sessions: it opens a live connection to one, and may start and close sessions itself.
 * @typedef {object} Vibe64TerminalDriver
 * @property {(options: { onEvent: (message: object) => void, sessionId: string }) => Vibe64TerminalDriverConnection} openConnection
 * @property {boolean} reconnectOnDisconnect Whether a connection lost without being closed opens again.
 * @property {(input: object) => Promise<object>} [startSession] Present when the driver starts sessions itself.
 * @property {(sessionId: string) => Promise<unknown>} [closeSession] Present when closing a terminal stops its process.
 */

/**
 * The driver for terminal sessions the server streams over a WebSocket: `webSocketUrl(sessionId)` names a
 * session's stream, and `closeSession(sessionId)`, when given, stops the session's process as its terminal closes.
 * @param {{
 *   closeSession?: (sessionId: string) => Promise<unknown>,
 *   webSocketUrl: (sessionId: string) => string
 * }} options
 * @returns {Vibe64TerminalDriver}
 */
function createWebSocketTerminalDriver({
  closeSession,
  webSocketUrl
}) {
  /**
   * @param {{ onEvent: (message: object) => void, sessionId: string }} options
   * @returns {Vibe64TerminalDriverConnection}
   */
  function openConnection({ onEvent, sessionId }) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      throw new Error("Terminal session id is required.");
    }

    const socket = new WebSocket(String(webSocketUrl(normalizedSessionId) || ""));
    let closedByClient = false;
    let disconnected = false;
    let readySettled = false;
    let resolveReady;
    const ready = new Promise((resolve) => {
      resolveReady = resolve;
    });
    const settleReady = (connected) => {
      if (readySettled) {
        return;
      }
      readySettled = true;
      resolveReady(connected);
    };
    const notifyDisconnected = () => {
      if (disconnected) {
        return;
      }
      disconnected = true;
      onEvent({
        intentional: closedByClient,
        type: "disconnected"
      });
    };

    socket.addEventListener("open", () => {
      settleReady(true);
      onEvent({
        type: "connected"
      });
    });
    socket.addEventListener("message", (event) => {
      try {
        onEvent(JSON.parse(String(event.data || "")));
      } catch {
        onEvent({
          error: "Terminal stream returned an invalid message.",
          type: "error"
        });
      }
    });
    socket.addEventListener("error", () => {
      settleReady(false);
      notifyDisconnected();
    });
    socket.addEventListener("close", () => {
      settleReady(false);
      notifyDisconnected();
    });

    function socketIsOpen() {
      return socket.readyState === WebSocket.OPEN;
    }

    return {
      close() {
        if (socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
          closedByClient = true;
          socket.close();
        }
      },
      isOpen: socketIsOpen,
      ready,
      sendInput(data) {
        if (!socketIsOpen()) {
          return false;
        }
        socket.send(JSON.stringify({
          data: String(data || ""),
          type: "input"
        }));
        return true;
      },
      sendResize({ cols, rows } = {}) {
        if (!socketIsOpen()) {
          return false;
        }
        socket.send(JSON.stringify({
          cols,
          rows,
          type: "resize"
        }));
        return true;
      }
    };
  }

  return Object.freeze({
    closeSession,
    openConnection,
    reconnectOnDisconnect: true
  });
}

export {
  createWebSocketTerminalDriver
};
