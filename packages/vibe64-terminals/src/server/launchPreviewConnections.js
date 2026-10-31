// A Preview proxy's open connections: tracking and idle timeouts, paired upgrade sockets, and closing them all.

import { vibe64SessionDebugError } from "@local/vibe64-runtime/server/sessionDebugLog";
import { previewProxyDebugLog } from "./launchPreviewDebugLog.js";
import { unlinkIfExists } from "./launchPreviewListening.js";

const DEFAULT_PREVIEW_PROXY_SOCKET_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

function destroyPreviewSocket(socket) {
  try {
    if (socket && !socket.destroyed) {
      socket.destroy();
    }
  } catch {
    // Socket cleanup must be best effort.
  }
}

function destroyPreviewRequest(request) {
  try {
    request.destroy();
  } catch {
    // Request cleanup must be best effort.
  }
}

function createPreviewProxyConnectionTracker({
  socketIdleTimeoutMs = DEFAULT_PREVIEW_PROXY_SOCKET_IDLE_TIMEOUT_MS
} = {}) {
  const sockets = new Set();
  const requests = new Set();

  function trackSocket(socket, label = "") {
    if (!socket) {
      return socket;
    }
    // The HTTP pool replaces the idle timeout when a socket becomes free.
    // Restore our request window on reuse without adding another listener.
    if (sockets.has(socket)) {
      if (Number.isSafeInteger(socketIdleTimeoutMs) && socketIdleTimeoutMs > 0) {
        socket.setTimeout(socketIdleTimeoutMs);
      }
      return socket;
    }
    sockets.add(socket);
    if (Number.isSafeInteger(socketIdleTimeoutMs) && socketIdleTimeoutMs > 0) {
      socket.setTimeout(socketIdleTimeoutMs, () => {
        previewProxyDebugLog("server.launchPreviewProxy.socket.timeout", {
          label
        });
        destroyPreviewSocket(socket);
      });
    }
    socket.once("close", () => {
      sockets.delete(socket);
    });
    return socket;
  }

  function trackRequest(request, label = "") {
    if (!request || requests.has(request)) {
      return request;
    }
    requests.add(request);
    const cleanup = () => {
      requests.delete(request);
    };
    request.once("close", cleanup);
    request.once("error", cleanup);
    request.once("abort", cleanup);
    request.once("socket", (socket) => {
      trackSocket(socket, `${label}:socket`);
    });
    return request;
  }

  function destroyAll() {
    for (const request of [...requests]) {
      destroyPreviewRequest(request);
    }
    for (const socket of [...sockets]) {
      destroyPreviewSocket(socket);
    }
    requests.clear();
    sockets.clear();
  }

  return {
    destroyAll,
    sockets,
    trackRequest,
    trackSocket
  };
}

function bindPreviewProxySocketPair(left, right, {
  tracker
}) {
  tracker.trackSocket(left, "browser-upgrade");
  tracker.trackSocket(right, "upstream-upgrade");
  // Preview WebSockets, including Vite HMR, legitimately stay open while a
  // browser is backgrounded. Their lifetime is owned by the proxy registry.
  left.setTimeout(0);
  right.setTimeout(0);
  let closed = false;
  const closeBoth = () => {
    if (closed) {
      return;
    }
    closed = true;
    destroyPreviewSocket(left);
    destroyPreviewSocket(right);
  };
  left.once("close", closeBoth);
  left.once("end", closeBoth);
  left.once("error", closeBoth);
  left.once("timeout", closeBoth);
  right.once("close", closeBoth);
  right.once("end", closeBoth);
  right.once("error", closeBoth);
  right.once("timeout", closeBoth);
  return closeBoth;
}

function safeSocketWrite(socket, chunk) {
  try {
    if (!socket.destroyed && socket.writable) {
      socket.write(chunk);
    }
  } catch (error) {
    recordPreviewUpgradeSocketError("server.launchPreviewProxy.upgrade.browserSocketWriteError")(error);
    socket.destroy();
  }
}

function recordPreviewUpgradeSocketError(event) {
  return (error) => {
    previewProxyDebugLog(event, {
      error: vibe64SessionDebugError(error)
    });
  };
}

function trackPreviewServerSockets(server, {
  tracker
}) {
  server.on("connection", (socket) => {
    tracker.trackSocket(socket, "browser");
  });
}

async function closePreviewServer({
  listen = {},
  server,
  tracker
}) {
  await new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
    server.closeAllConnections();
    tracker.destroyAll();
  });
  if (listen.socketPath) {
    await unlinkIfExists(listen.socketPath);
  }
}

export {
  bindPreviewProxySocketPair,
  closePreviewServer,
  createPreviewProxyConnectionTracker,
  DEFAULT_PREVIEW_PROXY_SOCKET_IDLE_TIMEOUT_MS,
  recordPreviewUpgradeSocketError,
  safeSocketWrite,
  trackPreviewServerSockets
};
