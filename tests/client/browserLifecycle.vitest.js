import { describe, expect, it, vi } from "vitest";

import {
  BROWSER_LIFECYCLE_DISCONNECTED_EVENT,
  BROWSER_LIFECYCLE_WEBSOCKET_PATH,
  connectBrowserLifecycleSocket
} from "../../src/lib/browserLifecycle.js";

describe("browser lifecycle socket", () => {
  it("closes the browser window when the server-enabled lifecycle socket closes", () => {
    const browserWindow = fakeBrowserWindow();
    const WebSocketCtor = fakeWebSocketConstructor();

    connectBrowserLifecycleSocket({
      browserWindow,
      WebSocketCtor
    });
    const socket = WebSocketCtor.instances[0];

    expect(socket.url).toBe(`ws://localhost:4100${BROWSER_LIFECYCLE_WEBSOCKET_PATH}`);

    socket.dispatch("open");
    socket.dispatch("message", {
      data: JSON.stringify({
        closeBrowserOnDisconnect: true,
        type: "browser-lifecycle-state"
      })
    });
    socket.dispatch("close");

    expect(browserWindow.close).toHaveBeenCalledTimes(1);
  });

  it("does not close the browser window when lifecycle shutdown is disabled", () => {
    const browserWindow = fakeBrowserWindow();
    const WebSocketCtor = fakeWebSocketConstructor();
    const disconnected = vi.fn();
    browserWindow.addEventListener(BROWSER_LIFECYCLE_DISCONNECTED_EVENT, disconnected);

    connectBrowserLifecycleSocket({
      browserWindow,
      WebSocketCtor
    });
    const socket = WebSocketCtor.instances[0];

    socket.dispatch("open");
    socket.dispatch("message", {
      data: JSON.stringify({
        closeBrowserOnDisconnect: false,
        type: "browser-lifecycle-state"
      })
    });
    socket.dispatch("close");

    expect(browserWindow.close).not.toHaveBeenCalled();
    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(disconnected.mock.calls[0][0].detail).toEqual({
      closeBrowserOnDisconnect: false
    });
  });

  it("does not close the browser window during page unload", () => {
    const browserWindow = fakeBrowserWindow();
    const WebSocketCtor = fakeWebSocketConstructor();

    connectBrowserLifecycleSocket({
      browserWindow,
      WebSocketCtor
    });
    const socket = WebSocketCtor.instances[0];

    socket.dispatch("open");
    socket.dispatch("message", {
      data: JSON.stringify({
        closeBrowserOnDisconnect: true,
        type: "browser-lifecycle-state"
      })
    });
    browserWindow.dispatch("pagehide");
    socket.dispatch("close");

    expect(browserWindow.close).not.toHaveBeenCalled();
    expect(browserWindow.dispatchEvent).not.toHaveBeenCalled();
  });

  it("does not close the browser window when the lifecycle connection is stopped locally", () => {
    const browserWindow = fakeBrowserWindow();
    const WebSocketCtor = fakeWebSocketConstructor();

    const connection = connectBrowserLifecycleSocket({
      browserWindow,
      WebSocketCtor
    });
    const socket = WebSocketCtor.instances[0];

    socket.dispatch("open");
    socket.dispatch("message", {
      data: JSON.stringify({
        closeBrowserOnDisconnect: true,
        type: "browser-lifecycle-state"
      })
    });
    connection.close();

    expect(browserWindow.close).not.toHaveBeenCalled();
    expect(browserWindow.dispatchEvent).not.toHaveBeenCalled();
  });
});

function fakeBrowserWindow() {
  const listeners = new Map();
  return {
    close: vi.fn(),
    dispatch(eventName) {
      listeners.get(eventName)?.();
    },
    dispatchEvent: vi.fn((event) => {
      listeners.get(event?.type)?.(event);
    }),
    location: {
      host: "localhost:4100",
      protocol: "http:"
    },
    addEventListener: vi.fn((eventName, handler) => {
      listeners.set(eventName, handler);
    }),
    removeEventListener: vi.fn((eventName, handler) => {
      if (listeners.get(eventName) === handler) {
        listeners.delete(eventName);
      }
    })
  };
}

function fakeWebSocketConstructor() {
  return class FakeWebSocket {
    static instances = [];

    constructor(url) {
      this.listeners = new Map();
      this.url = url;
      FakeWebSocket.instances.push(this);
    }

    addEventListener(eventName, handler) {
      this.listeners.set(eventName, handler);
    }

    close() {
      this.dispatch("close");
    }

    dispatch(eventName, event = {}) {
      this.listeners.get(eventName)?.(event);
    }
  };
}
