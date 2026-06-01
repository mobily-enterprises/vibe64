import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INVALID_TERMINAL_SIZE_ERROR,
  reportableTerminalSize,
  terminalResizeErrorMessage
} from "../../src/lib/studioTerminalSize.js";
import {
  useStudioTerminal
} from "../../src/composables/useStudioTerminal.js";

describe("useStudioTerminal", () => {
  let originalWebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("does not report transient terminal sizes that the PTY server rejects", () => {
    expect(reportableTerminalSize({
      cols: 19,
      rows: 30
    })).toBeNull();
    expect(reportableTerminalSize({
      cols: 80,
      rows: 4
    })).toBeNull();
    expect(reportableTerminalSize({
      cols: Number.NaN,
      rows: 30
    })).toBeNull();
  });

  it("normalizes valid terminal sizes before sending resize messages", () => {
    expect(reportableTerminalSize({
      cols: 120.8,
      rows: 32.4
    })).toEqual({
      cols: 120,
      rows: 32
    });
  });

  it("recognizes resize failures as non-fatal terminal messages", () => {
    expect(terminalResizeErrorMessage(INVALID_TERMINAL_SIZE_ERROR)).toBe(true);
    expect(terminalResizeErrorMessage("Terminal stream failed.")).toBe(false);
  });

  it("can refresh terminal metadata without erasing the current byte transcript", () => {
    const onOutput = vi.fn();
    const terminal = useStudioTerminal({
      onOutput,
      webSocketUrl: (terminalId) => `ws://terminal/${terminalId}`
    });

    terminal.applyTerminalSession({
      id: "terminal-1",
      output: "initial output",
      status: "running"
    });
    terminal.applyTerminalSession({
      commandPreview: "codex",
      id: "terminal-1",
      status: "running"
    }, {
      preserveOutput: true
    });

    expect(terminal.terminalOutput.value).toBe("initial output");
    expect(onOutput).toHaveBeenCalledTimes(1);
  });

  it("notifies byte-stream observers when websocket output arrives", async () => {
    const onOutput = vi.fn();
    const terminal = useStudioTerminal({
      onOutput,
      webSocketUrl: (terminalId) => `ws://terminal/${terminalId}`
    });

    terminal.applyTerminalSession({
      id: "terminal-1",
      status: "running"
    });
    const connected = terminal.connectTerminalSocket();
    const socket = FakeWebSocket.instances[0];
    socket.dispatch("open");
    await expect(connected).resolves.toBe(true);

    socket.dispatch("message", {
      data: JSON.stringify({
        chunk: "hello",
        type: "output"
      })
    });

    expect(terminal.terminalOutput.value).toBe("hello");
    expect(onOutput).toHaveBeenCalledWith({
      chunk: "hello",
      output: "hello",
      outputVersion: 0,
      source: "append"
    });
  });

  it("ignores stale snapshots that arrive after newer websocket output", async () => {
    const terminal = useStudioTerminal({
      webSocketUrl: (terminalId) => `ws://terminal/${terminalId}`
    });

    terminal.applyTerminalSession({
      id: "terminal-1",
      output: "old",
      outputVersion: 1,
      status: "running"
    });
    const connected = terminal.connectTerminalSocket();
    const socket = FakeWebSocket.instances[0];
    socket.dispatch("open");
    await expect(connected).resolves.toBe(true);

    socket.dispatch("message", {
      data: JSON.stringify({
        chunk: " plus new",
        outputVersion: 2,
        type: "output"
      })
    });
    socket.dispatch("message", {
      data: JSON.stringify({
        session: {
          id: "terminal-1",
          output: "old",
          outputVersion: 1,
          status: "running"
        },
        type: "snapshot"
      })
    });

    expect(terminal.terminalOutput.value).toBe("old plus new");
  });

  it("ignores equal-version snapshots that do not extend the current output", () => {
    const terminal = useStudioTerminal({
      webSocketUrl: (terminalId) => `ws://terminal/${terminalId}`
    });

    terminal.applyTerminalSession({
      id: "terminal-1",
      output: "draft in progress",
      outputVersion: 4,
      status: "running"
    });
    terminal.applyTerminalSession({
      id: "terminal-1",
      output: "draft",
      outputVersion: 4,
      status: "running"
    });

    expect(terminal.terminalOutput.value).toBe("draft in progress");
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
    if (eventName === "open") {
      this.readyState = FakeWebSocket.OPEN;
    }
    this.listeners.get(eventName)?.(event);
  }
}
