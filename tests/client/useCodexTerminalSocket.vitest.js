import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { useCodexTerminalSocket } from "../../src/composables/useCodexTerminalSocket.js";

describe("useCodexTerminalSocket", () => {
  let originalWebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("ignores late events from a locally closed socket", async () => {
    const onMessage = vi.fn();
    const terminalStatus = ref("running");
    const terminalSessionId = ref("terminal-old");
    const socket = useCodexTerminalSocket({
      canUseTerminal: ref(true),
      componentMounted: ref(true),
      onMessage,
      sessionId: ref("session-1"),
      terminalSessionId,
      terminalStatus,
      webSocketUrl: (sessionId, currentTerminalSessionId) => `ws://terminal/${sessionId}/${currentTerminalSessionId}`
    });

    const firstConnect = socket.connect();
    const oldSocket = FakeWebSocket.instances[0];
    oldSocket.dispatch("open");
    await expect(firstConnect).resolves.toBe(true);

    socket.closeSocket();
    oldSocket.dispatch("message", {
      data: "old output"
    });
    oldSocket.dispatch("close");

    terminalSessionId.value = "terminal-new";
    const secondConnect = socket.connect();
    const newSocket = FakeWebSocket.instances[1];
    newSocket.dispatch("open");
    await expect(secondConnect).resolves.toBe(true);

    oldSocket.dispatch("message", {
      data: "late old output"
    });
    newSocket.dispatch("message", {
      data: "new output"
    });

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith("new output");
    expect(terminalStatus.value).toBe("running");
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

  dispatch(eventName, event = {}) {
    this.listeners.get(eventName)?.(event);
  }
}
