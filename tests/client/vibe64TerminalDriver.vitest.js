import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createWebSocketTerminalDriver,
  validateTerminalDriver
} from "../../src/lib/vibe64TerminalDriver.js";

describe("Vibe64 terminal drivers", () => {
  let originalWebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("normalizes the Studio websocket protocol behind one connection contract", async () => {
    const events = [];
    const driver = createWebSocketTerminalDriver({
      webSocketUrl: (sessionId) => `ws://terminal/${sessionId}`
    });
    const connection = driver.openConnection({
      onEvent: (event) => events.push(event),
      sessionId: "terminal-1"
    });
    const socket = FakeWebSocket.instances[0];

    socket.dispatch("open");
    await expect(connection.ready).resolves.toBe(true);
    socket.dispatch("message", {
      data: JSON.stringify({
        chunk: "hello",
        outputVersion: 2,
        type: "output"
      })
    });
    expect(connection.sendInput("y")).toBe(true);
    expect(connection.sendResize({
      cols: 90,
      rows: 30
    })).toBe(true);

    expect(events).toEqual([
      { type: "connected" },
      {
        chunk: "hello",
        outputVersion: 2,
        type: "output"
      }
    ]);
    expect(socket.sentMessages()).toEqual([
      {
        data: "y",
        type: "input"
      },
      {
        cols: 90,
        rows: 30,
        type: "resize"
      }
    ]);
  });

  it("reports unexpected websocket loss as a recoverable disconnection", async () => {
    const events = [];
    const driver = createWebSocketTerminalDriver({
      webSocketUrl: (sessionId) => `ws://terminal/${sessionId}`
    });
    const connection = driver.openConnection({
      onEvent: (event) => events.push(event),
      sessionId: "terminal-1"
    });
    const socket = FakeWebSocket.instances[0];

    socket.dispatch("open");
    await connection.ready;
    socket.disconnect();

    expect(events).toEqual([
      { type: "connected" },
      {
        intentional: false,
        type: "disconnected"
      }
    ]);
  });

  it("rejects incomplete drivers at the composition boundary", () => {
    expect(() => validateTerminalDriver()).toThrow(/object/u);
    expect(() => validateTerminalDriver({})).toThrow(/openConnection/u);
    expect(validateTerminalDriver({
      openConnection() {}
    })).toEqual(expect.objectContaining({
      openConnection: expect.any(Function)
    }));
  });
});

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.listeners = new Map();
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(eventName, handler) {
    this.listeners.set(eventName, handler);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close");
  }

  disconnect() {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatch("close");
  }

  dispatch(eventName, event = {}) {
    if (eventName === "open") {
      this.readyState = FakeWebSocket.OPEN;
    }
    this.listeners.get(eventName)?.(event);
  }

  send(message) {
    this.sent.push(JSON.parse(String(message || "{}")));
  }

  sentMessages() {
    return this.sent;
  }
}
