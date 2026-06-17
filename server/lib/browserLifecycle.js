import {
  isLocalStudioRequest
} from "@local/vibe64-core/server/localStudioRequest";

const BROWSER_LIFECYCLE_WEBSOCKET_PATH = "/api/studio/browser-lifecycle/ws";
const DEFAULT_BROWSER_LIFECYCLE_SHUTDOWN_DELAY_MS = 1000;

function shutdownDelayLabel(delayMs = DEFAULT_BROWSER_LIFECYCLE_SHUTDOWN_DELAY_MS) {
  const seconds = Math.max(1, Math.round(Number(delayMs || 0) / 1000));
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

function sendBrowserLifecycleState(socket, monitor) {
  socket.send(JSON.stringify({
    closeBrowserOnDisconnect: monitor.isShutdownEnabled(),
    type: "browser-lifecycle-state"
  }));
}

function createBrowserLifecycleMonitor({
  clearTimeoutFn = clearTimeout,
  closeServer = async () => {},
  logger = null,
  setTimeoutFn = setTimeout,
  shutdownDelayMs = DEFAULT_BROWSER_LIFECYCLE_SHUTDOWN_DELAY_MS
} = {}) {
  const clients = new Map();
  let shutdownEnabled = false;
  let shutdownTimer = null;
  let nextClientId = 1;
  let serverClosing = false;

  function clearShutdownTimer() {
    if (!shutdownTimer) {
      return;
    }
    clearTimeoutFn(shutdownTimer);
    shutdownTimer = null;
  }

  function scheduleShutdown() {
    if (!shutdownEnabled || serverClosing || clients.size > 0 || shutdownTimer) {
      return;
    }

    logger?.info?.(`Browser window disconnected. Terminating in ${shutdownDelayLabel(shutdownDelayMs)}...`);
    shutdownTimer = setTimeoutFn(async () => {
      shutdownTimer = null;
      if (!shutdownEnabled || serverClosing || clients.size > 0) {
        return;
      }

      serverClosing = true;
      logger?.info?.("Closing Vibe64 because the browser window disconnected.");
      try {
        await closeServer("browser-lifecycle-disconnected");
      } catch (error) {
        logger?.error?.({ err: error }, "Browser lifecycle shutdown failed.");
      }
    }, shutdownDelayMs);
  }

  function registerClient(socket) {
    const clientId = nextClientId;
    nextClientId += 1;
    clients.set(clientId, socket);
    clearShutdownTimer();

    let removed = false;
    const removeClient = () => {
      if (removed) {
        return;
      }
      removed = true;
      clients.delete(clientId);
      scheduleShutdown();
    };

    socket.on("close", removeClient);
    socket.on("error", removeClient);
    return {
      clientId,
      remove: removeClient
    };
  }

  function enableShutdown(nextCloseServer = closeServer) {
    if (typeof nextCloseServer === "function") {
      closeServer = nextCloseServer;
    }
    shutdownEnabled = true;
  }

  function stop() {
    shutdownEnabled = false;
    serverClosing = true;
    clearShutdownTimer();
    const sockets = Array.from(clients.values());
    clients.clear();
    for (const socket of sockets) {
      try {
        socket?.close?.(1001, "Vibe64 server is stopping.");
      } catch {
        // Shutdown is already in progress; continue closing the remaining clients.
      }
    }
  }

  return {
    activeClientCount() {
      return clients.size;
    },
    enableShutdown,
    isShutdownEnabled() {
      return shutdownEnabled;
    },
    registerClient,
    stop
  };
}

function registerBrowserLifecycleWebSocketRoute(app, monitor) {
  app.get(
    BROWSER_LIFECYCLE_WEBSOCKET_PATH,
    { websocket: true },
    (socket, request) => {
      if (!isLocalStudioRequest(request)) {
        socket.close(1008, "Open Studio on localhost or 127.0.0.1.");
        return;
      }
      monitor.registerClient(socket);
      sendBrowserLifecycleState(socket, monitor);
    }
  );
}

export {
  BROWSER_LIFECYCLE_WEBSOCKET_PATH,
  createBrowserLifecycleMonitor,
  registerBrowserLifecycleWebSocketRoute,
  sendBrowserLifecycleState
};
