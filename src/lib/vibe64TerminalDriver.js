function normalizeTerminalSessionId(value = "") {
  return String(value || "").trim();
}

function normalizeDriverCallback(callback) {
  return typeof callback === "function" ? callback : () => null;
}

function createWebSocketTerminalDriver({
  closeSession = null,
  webSocketUrl
} = {}) {
  if (typeof webSocketUrl !== "function") {
    throw new TypeError("webSocketUrl must be a function.");
  }

  return {
    closeSession: typeof closeSession === "function" ? closeSession : null,
    reconnectOnDisconnect: true,

    openConnection({ onEvent = null, sessionId = "" } = {}) {
      const normalizedSessionId = normalizeTerminalSessionId(sessionId);
      if (!normalizedSessionId) {
        throw new Error("Terminal session id is required.");
      }

      const notify = normalizeDriverCallback(onEvent);
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
        notify({
          intentional: closedByClient,
          type: "disconnected"
        });
      };

      socket.addEventListener("open", () => {
        settleReady(true);
        notify({
          type: "connected"
        });
      });
      socket.addEventListener("message", (event) => {
        try {
          notify(JSON.parse(String(event.data || "")));
        } catch {
          notify({
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
  };
}

function validateTerminalDriver(driver) {
  if (!driver || typeof driver !== "object" || Array.isArray(driver)) {
    throw new TypeError("Terminal driver must be an object.");
  }
  if (typeof driver.openConnection !== "function") {
    throw new TypeError("Terminal driver must provide openConnection().");
  }
  return driver;
}

export {
  createWebSocketTerminalDriver,
  validateTerminalDriver
};
