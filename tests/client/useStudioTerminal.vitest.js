import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const xtermMock = vi.hoisted(() => {
  class FakeTerminal {
    static instances = [];

    constructor(options = {}) {
      this.cols = 93;
      this.options = options;
      this.rows = 28;
      FakeTerminal.instances.push(this);
    }

    dispose() {}
    focus() {}
    hasSelection() {
      return false;
    }
    loadAddon() {}
    open() {}
    onData() {
      return {
        dispose() {}
      };
    }
    onSelectionChange() {
      return {
        dispose() {}
      };
    }
    refresh() {}
    reset() {}
    scrollToBottom() {}
    write(_chunk, callback) {
      callback?.();
    }
  }

  class FakeFitAddon {
    fit() {}
  }

  return {
    FakeFitAddon,
    FakeTerminal,
    loadXtermModules: vi.fn()
  };
});

vi.mock("@xterm/xterm", () => ({
  Terminal: xtermMock.FakeTerminal
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: xtermMock.FakeFitAddon
}));

vi.mock("@/lib/xtermModuleLoader.js", () => ({
  loadXtermModules: xtermMock.loadXtermModules
}));

import {
  INVALID_TERMINAL_SIZE_ERROR,
  STUDIO_TERMINAL_SCROLLBACK_ROWS,
  reportableTerminalSize,
  terminalResizeErrorMessage
} from "../../src/lib/studioTerminalSize.js";
import {
  useStudioTerminal
} from "../../src/composables/useStudioTerminal.js";

describe("useStudioTerminal", () => {
  let originalWebSocket;
  let originalWindow;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    originalWindow = globalThis.window;
    FakeWebSocket.instances.length = 0;
    xtermMock.FakeTerminal.instances.length = 0;
    xtermMock.loadXtermModules.mockReset();
    xtermMock.loadXtermModules.mockResolvedValue({
      FitAddon: xtermMock.FakeFitAddon,
      Terminal: xtermMock.FakeTerminal
    });
    globalThis.WebSocket = FakeWebSocket;
    globalThis.window = {
      addEventListener() {},
      clearTimeout: globalThis.clearTimeout,
      removeEventListener() {},
      setTimeout: globalThis.setTimeout
    };
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    globalThis.window = originalWindow;
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

  it("uses the shared finite client scrollback", async () => {
    const terminal = useStudioTerminal({
      webSocketUrl: (terminalId) => `ws://terminal/${terminalId}`
    });
    terminal.terminalHost.value = fakeTerminalHost();

    await terminal.setupTerminalUi();

    expect(xtermMock.FakeTerminal.instances[0]?.options.scrollback).toBe(STUDIO_TERMINAL_SCROLLBACK_ROWS);
  });

  it("aborts terminal setup when the host is cleared while modules load", async () => {
    let resolveModules;
    xtermMock.loadXtermModules.mockReturnValueOnce(new Promise((resolve) => {
      resolveModules = resolve;
    }));
    const terminal = useStudioTerminal({
      webSocketUrl: (terminalId) => `ws://terminal/${terminalId}`
    });
    terminal.terminalHost.value = fakeTerminalHost();

    const setup = terminal.setupTerminalUi();
    await flushPromises();
    expect(resolveModules).toBeTypeOf("function");

    terminal.terminalHost.value = null;
    resolveModules({
      FitAddon: xtermMock.FakeFitAddon,
      Terminal: xtermMock.FakeTerminal
    });

    await expect(setup).resolves.toBe(false);
    expect(xtermMock.FakeTerminal.instances).toHaveLength(0);
  });

  it("removes host listeners from the mounted terminal host when the ref changes", async () => {
    const terminal = useStudioTerminal({
      webSocketUrl: (terminalId) => `ws://terminal/${terminalId}`
    });
    const mountedHost = fakeTerminalHost();
    const replacementHost = fakeTerminalHost();
    terminal.terminalHost.value = mountedHost;

    await terminal.setupTerminalUi();
    terminal.terminalHost.value = replacementHost;
    terminal.disposeTerminalUi();

    expect(mountedHost.removeEventListener).toHaveBeenCalledWith("focusin", expect.any(Function));
    expect(mountedHost.removeEventListener).toHaveBeenCalledWith("focusout", expect.any(Function));
    expect(replacementHost.removeEventListener).not.toHaveBeenCalled();
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

  it("does not send repeated resize control messages when live resize is disabled", async () => {
    const terminal = useStudioTerminal({
      liveResize: false,
      webSocketUrl: (terminalId) => `ws://terminal/${terminalId}`
    });
    terminal.terminalHost.value = fakeTerminalHost();

    await terminal.setupTerminalUi();
    terminal.applyTerminalSession({
      id: "terminal-1",
      status: "running"
    });

    const firstSocket = FakeWebSocket.instances[0];
    firstSocket.dispatch("open");
    await flushPromises();

    expect(firstSocket.sentMessages()).toEqual([{
      cols: 93,
      rows: 28,
      type: "resize"
    }]);

    terminal.closeTerminalSocket();
    terminal.applyTerminalSession({
      id: "terminal-1",
      status: "running"
    });
    await terminal.setupTerminalUi();
    await flushPromises();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(firstSocket.sentMessages()).toHaveLength(1);
  });
});

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function fakeTerminalHost() {
  return {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    replaceChildren: vi.fn()
  };
}

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
