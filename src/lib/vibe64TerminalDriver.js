function normalizeTerminalSessionId(value = "") {
  return String(value || "").trim();
}

function normalizeDriverCallback(callback) {
  return typeof callback === "function" ? callback : () => null;
}

function terminalDriverError(error, fallback) {
  return String(error?.message || error || fallback);
}

function createWebSocketTerminalDriver({
  closeSession = null,
  readSession = null,
  startSession = null,
  webSocketUrl
} = {}) {
  if (typeof webSocketUrl !== "function") {
    throw new TypeError("webSocketUrl must be a function.");
  }

  return {
    closeSession: typeof closeSession === "function" ? closeSession : null,
    readSession: typeof readSession === "function" ? readSession : null,
    startSession: typeof startSession === "function" ? startSession : null,

    openConnection({ onEvent = null, sessionId = "" } = {}) {
      const normalizedSessionId = normalizeTerminalSessionId(sessionId);
      if (!normalizedSessionId) {
        throw new Error("Terminal session id is required.");
      }

      const notify = normalizeDriverCallback(onEvent);
      const socket = new WebSocket(String(webSocketUrl(normalizedSessionId) || ""));
      let closedByClient = false;
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
        notify({
          error: "Terminal stream failed.",
          type: "error"
        });
      });
      socket.addEventListener("close", () => {
        settleReady(false);
        notify({
          intentional: closedByClient,
          type: "disconnected"
        });
        if (!closedByClient) {
          notify({
            error: "Terminal stream closed before the session finished.",
            type: "error"
          });
        }
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

function createPollingTerminalDriver({
  closeSession = null,
  pollIntervalMs = 750,
  readSession,
  startSession = null,
  writeInput = null
} = {}) {
  if (typeof readSession !== "function") {
    throw new TypeError("readSession must be a function.");
  }
  const interval = Number(pollIntervalMs);
  if (!Number.isFinite(interval) || interval <= 0) {
    throw new TypeError("pollIntervalMs must be a positive number.");
  }

  return {
    closeSession: typeof closeSession === "function" ? closeSession : null,
    readSession,
    startSession: typeof startSession === "function" ? startSession : null,

    openConnection({ onEvent = null, sessionId = "" } = {}) {
      const normalizedSessionId = normalizeTerminalSessionId(sessionId);
      if (!normalizedSessionId) {
        throw new Error("Terminal session id is required.");
      }

      const notify = normalizeDriverCallback(onEvent);
      let active = true;
      let latestOutput = "";
      let pollTimer = null;
      let polling = false;

      const schedulePoll = () => {
        if (!active || pollTimer) {
          return;
        }
        pollTimer = globalThis.setTimeout(() => {
          pollTimer = null;
          void poll();
        }, interval);
      };

      const poll = async () => {
        if (!active || polling) {
          return false;
        }
        polling = true;
        try {
          const session = await readSession(normalizedSessionId);
          if (!active) {
            return false;
          }
          const nextOutput = String(session?.output || "");
          const replaceOutput = Boolean(latestOutput && !nextOutput.startsWith(latestOutput));
          latestOutput = nextOutput;
          notify({
            replaceOutput,
            session: session || {},
            type: "snapshot"
          });
          if (String(session?.status || "") !== "exited") {
            schedulePoll();
          }
          return true;
        } catch (error) {
          if (active) {
            notify({
              error: terminalDriverError(error, "Terminal polling failed."),
              type: "error"
            });
            schedulePoll();
          }
          return false;
        } finally {
          polling = false;
        }
      };

      const ready = poll().then((connected) => {
        if (active && connected) {
          notify({
            type: "connected"
          });
        }
        return connected;
      });

      return {
        close() {
          if (!active) {
            return;
          }
          active = false;
          if (pollTimer) {
            globalThis.clearTimeout(pollTimer);
            pollTimer = null;
          }
          notify({
            type: "disconnected"
          });
        },
        isOpen() {
          return active;
        },
        ready,
        async sendInput(data) {
          if (!active || typeof writeInput !== "function") {
            return false;
          }
          await writeInput(normalizedSessionId, String(data || ""));
          return true;
        },
        sendResize() {
          return false;
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
  createPollingTerminalDriver,
  createWebSocketTerminalDriver,
  validateTerminalDriver
};
