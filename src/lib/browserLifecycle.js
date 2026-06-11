import {
  resolveWebSocketUrl
} from "@/lib/studioUrls.js";

const BROWSER_LIFECYCLE_WEBSOCKET_PATH = "/api/studio/browser-lifecycle/ws";

function noopLifecycleConnection() {
  return {
    close() {}
  };
}

function connectBrowserLifecycleSocket({
  browserWindow = typeof window !== "undefined" ? window : null,
  WebSocketCtor = typeof WebSocket !== "undefined" ? WebSocket : null
} = {}) {
  if (!browserWindow || typeof WebSocketCtor !== "function") {
    return noopLifecycleConnection();
  }

  let socket = null;
  let connected = false;
  let closeBrowserOnDisconnect = false;
  let pageUnloading = false;
  let stopped = false;

  const markPageUnloading = () => {
    pageUnloading = true;
  };
  const removeUnloadListeners = () => {
    browserWindow.removeEventListener?.("beforeunload", markPageUnloading);
    browserWindow.removeEventListener?.("pagehide", markPageUnloading);
  };
  const closeWindowIfServerDisconnected = () => {
    removeUnloadListeners();
    if (connected && closeBrowserOnDisconnect && !stopped && !pageUnloading) {
      browserWindow.close?.();
    }
  };
  const receiveLifecycleState = (event) => {
    try {
      const message = JSON.parse(String(event?.data || ""));
      if (message?.type === "browser-lifecycle-state") {
        closeBrowserOnDisconnect = message.closeBrowserOnDisconnect === true;
      }
    } catch {
      // Ignore non-lifecycle messages on this private control socket.
    }
  };

  browserWindow.addEventListener?.("beforeunload", markPageUnloading);
  browserWindow.addEventListener?.("pagehide", markPageUnloading);

  try {
    socket = new WebSocketCtor(resolveWebSocketUrl(BROWSER_LIFECYCLE_WEBSOCKET_PATH, browserWindow));
  } catch {
    removeUnloadListeners();
    return noopLifecycleConnection();
  }

  socket.addEventListener?.("open", () => {
    connected = true;
  });
  socket.addEventListener?.("message", receiveLifecycleState);
  socket.addEventListener?.("close", closeWindowIfServerDisconnected);

  return {
    close() {
      stopped = true;
      removeUnloadListeners();
      socket?.close?.();
    }
  };
}

export {
  BROWSER_LIFECYCLE_WEBSOCKET_PATH,
  connectBrowserLifecycleSocket
};
