import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderer } from "vue";
import {
  useVibe64HeadlessCommandRunner
} from "../../src/composables/useVibe64HeadlessCommandRunner.js";

describe("useVibe64HeadlessCommandRunner", () => {
  let originalWebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    FakeWebSocket.autoOpen = true;
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
  });

  it("runs a command terminal action and keeps successful output internal", async () => {
    const closeCommandTerminal = vi.fn(async () => ({
      ok: true
    }));
    const startCommandTerminal = vi.fn(async () => ({
      commandPreview: "npm install",
      id: "terminal-1",
      ok: true,
      output: "",
      status: "running"
    }));
    const runner = useVibe64HeadlessCommandRunner({
      closeCommandTerminal,
      startCommandTerminal,
      webSocketUrl: (sessionId, terminalSessionId) => `ws://studio/${sessionId}/${terminalSessionId}`
    });

    const resultPromise = runner.runCommandAction({
      action: {
        id: "install_dependencies",
        label: "Install dependencies"
      },
      input: {
        packageManager: "npm"
      },
      sessionId: "session-1"
    });

    await vi.waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe("ws://studio/session-1/terminal-1");
    expect(runner.commandPreview.value).toBe("npm install");
    expect(runner.status.value).toBe("running");
    socket.sendMessage({
      chunk: "installed\n",
      type: "output"
    });
    expect(runner.output.value).toBe("installed\n");
    socket.sendMessage({
      exitCode: 0,
      status: "exited",
      type: "status"
    });

    await expect(resultPromise).resolves.toMatchObject({
      actionId: "install_dependencies",
      ok: true,
      output: "installed\n"
    });
    expect(startCommandTerminal).toHaveBeenCalledWith("session-1", {
      actionId: "install_dependencies",
      advanceOnSuccess: false,
      input: {
        packageManager: "npm"
      }
    });
    expect(closeCommandTerminal).toHaveBeenCalledWith("session-1", "terminal-1");
    expect(runner.running.value).toBe(false);
    expect(runner.status.value).toBe("");
  });

  it("returns terminal output when the command exits with an error", async () => {
    const runner = useVibe64HeadlessCommandRunner({
      closeCommandTerminal: vi.fn(async () => ({
        ok: true
      })),
      startCommandTerminal: vi.fn(async () => ({
        commandPreview: "git clone",
        id: "terminal-2",
        metadata: {
          attemptedCommand: "bash -lc 'git clone https://github.com/example/project.git /tmp/worktree'"
        },
        ok: true,
        output: "starting\n",
        status: "running"
      })),
      webSocketUrl: () => "ws://studio/session-1/terminal-2"
    });

    const resultPromise = runner.runCommandAction({
      action: {
        id: "create_source",
        label: "Create session clone"
      },
      sessionId: "session-1"
    });

    await vi.waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    FakeWebSocket.instances[0].sendMessage({
      chunk: "fatal: branch exists\n",
      type: "output"
    });
    expect(runner.output.value).toBe("starting\nfatal: branch exists\n");
    FakeWebSocket.instances[0].sendMessage({
      exitCode: 1,
      status: "exited",
      type: "status"
    });

    await expect(resultPromise).resolves.toMatchObject({
      actionId: "create_source",
      attemptedCommand: "bash -lc 'git clone https://github.com/example/project.git /tmp/worktree'",
      error: "Create session clone failed with exit code 1.",
      exitCode: 1,
      ok: false,
      output: "starting\nfatal: branch exists\n"
    });
  });

  it("preserves server conflict metadata when a command start is rejected", async () => {
    const closeCommandTerminal = vi.fn(async () => ({
      ok: true
    }));
    const runner = useVibe64HeadlessCommandRunner({
      closeCommandTerminal,
      startCommandTerminal: vi.fn(async () => {
        const error = new Error("This step is already complete.");
        error.code = "vibe64_action_disabled";
        error.details = {
          operationOutcome: "state_rejected",
          refreshRecommended: true
        };
        error.status = 409;
        throw error;
      }),
      webSocketUrl: () => "ws://studio/session-1/terminal-conflict"
    });

    await expect(runner.runCommandAction({
      action: {
        id: "create_source",
        label: "Create session clone"
      },
      sessionId: "session-1"
    })).resolves.toMatchObject({
      actionId: "create_source",
      code: "vibe64_action_disabled",
      error: "This step is already complete.",
      ok: false,
      operationOutcome: "state_rejected",
      refreshRecommended: true,
      status: 409,
      terminalSessionId: ""
    });
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(closeCommandTerminal).not.toHaveBeenCalled();
  });

  it("attaches to an already running session command terminal", async () => {
    const closeCommandTerminal = vi.fn(async () => ({
      ok: true
    }));
    const runner = useVibe64HeadlessCommandRunner({
      closeCommandTerminal,
      startCommandTerminal: vi.fn(async () => ({
        actionId: "create_source",
        actionLabel: "Create session clone",
        code: "vibe64_command_execution_claimed",
        commandPreview: "git clone",
        ok: true,
        operationOutcome: "command_already_running",
        refreshRecommended: true,
        terminalSessionId: "terminal-existing",
        terminalStatus: "running"
      })),
      webSocketUrl: (sessionId, terminalSessionId) => `ws://studio/${sessionId}/${terminalSessionId}`
    });

    const resultPromise = runner.runCommandAction({
      action: {
        id: "install_dependencies",
        label: "Install dependencies"
      },
      sessionId: "session-1"
    });

    await vi.waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe("ws://studio/session-1/terminal-existing");
    expect(runner.commandPreview.value).toBe("git clone");
    expect(runner.status.value).toBe("running");
    socket.sendMessage({
      chunk: "worktree ready\n",
      type: "output"
    });
    socket.sendMessage({
      exitCode: 0,
      status: "exited",
      type: "status"
    });

    await expect(resultPromise).resolves.toMatchObject({
      actionId: "create_source",
      ok: true,
      output: "worktree ready\n",
      terminalSessionId: "terminal-existing"
    });
    expect(closeCommandTerminal).toHaveBeenCalledWith("session-1", "terminal-existing");
    expect(runner.running.value).toBe(false);
  });

  it("accepts an already finished session command without opening a websocket", async () => {
    const closeCommandTerminal = vi.fn(async () => ({
      ok: true
    }));
    const runner = useVibe64HeadlessCommandRunner({
      closeCommandTerminal,
      startCommandTerminal: vi.fn(async () => ({
        actionId: "create_source",
        actionLabel: "Create session clone",
        code: "vibe64_command_execution_claimed",
        commandLifecyclePhase: "done",
        ok: true,
        operationOutcome: "command_already_finished",
        refreshRecommended: true
      })),
      webSocketUrl: () => "ws://studio/session-1/unused"
    });

    await expect(runner.runCommandAction({
      action: {
        id: "create_source",
        label: "Create session clone"
      },
      sessionId: "session-1"
    })).resolves.toMatchObject({
      actionId: "create_source",
      ok: true,
      terminalSessionId: ""
    });
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(closeCommandTerminal).not.toHaveBeenCalled();
    expect(runner.running.value).toBe(false);
  });

  it("can stop a running command and preserve its output as a failure", async () => {
    const closeCommandTerminal = vi.fn(async () => ({
      ok: true
    }));
    const runner = useVibe64HeadlessCommandRunner({
      closeCommandTerminal,
      startCommandTerminal: vi.fn(async () => ({
        commandPreview: "npx --no-install jskit helper-map update",
        id: "terminal-3",
        ok: true,
        output: "indexing\n",
        status: "running"
      })),
      webSocketUrl: () => "ws://studio/session-1/terminal-3"
    });

    const resultPromise = runner.runCommandAction({
      action: {
        id: "update_code_index",
        label: "Update code index"
      },
      sessionId: "session-1"
    });

    await vi.waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    FakeWebSocket.instances[0].sendMessage({
      chunk: "still indexing\n",
      type: "output"
    });

    expect(runner.stopCommandAction()).toBe(true);

    await expect(resultPromise).resolves.toMatchObject({
      actionId: "update_code_index",
      error: "Update code index was stopped before it finished.",
      exitCode: null,
      ok: false,
      output: "indexing\nstill indexing\n"
    });
    expect(closeCommandTerminal).toHaveBeenCalledWith("session-1", "terminal-3");
    expect(runner.running.value).toBe(false);
  });

  it("reattaches after an accidental socket disconnect without stopping the command", async () => {
    const { closeCommandTerminal, runner } = commandRunnerFixture({
      startResponse: {
        output: "cloning\n",
      },
      terminalSessionId: "terminal-reconnect"
    });
    const resultPromise = runCreateSource(runner);
    const firstSocket = await waitForSocketCount(1);
    firstSocket.disconnect();
    const reconnectedSocket = await waitForSocketCount(2);
    expect(closeCommandTerminal).not.toHaveBeenCalled();
    expect(runner.running.value).toBe(true);

    reconnectedSocket.sendMessage({
      chunk: "done\n",
      type: "output"
    });
    reconnectedSocket.sendMessage({
      exitCode: 0,
      status: "exited",
      type: "status"
    });

    await expect(resultPromise).resolves.toMatchObject({
      actionId: "create_source",
      ok: true,
      output: "cloning\ndone\n"
    });
    expect(closeCommandTerminal).toHaveBeenCalledWith("session-1", "terminal-reconnect");
  });

  it("backs off repeated connections until the terminal sends an authoritative snapshot", async () => {
    vi.useFakeTimers();
    const { closeCommandTerminal, runner } = commandRunnerFixture({
      reconnectDelayMs: 5,
      reconnectMaxDelayMs: 20,
      terminalSessionId: "terminal-backoff"
    });
    const resultPromise = runCreateSource(runner);
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWebSocket.instances).toHaveLength(1);

    FakeWebSocket.instances[0].disconnect();
    await vi.advanceTimersByTimeAsync(5);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1].disconnect();
    await vi.advanceTimersByTimeAsync(9);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    FakeWebSocket.instances[2].sendMessage({
      session: {
        id: "terminal-backoff",
        status: "running"
      },
      type: "snapshot"
    });
    FakeWebSocket.instances[2].disconnect();
    await vi.advanceTimersByTimeAsync(5);
    expect(FakeWebSocket.instances).toHaveLength(4);

    expect(runner.stopCommandAction()).toBe(true);
    await expect(resultPromise).resolves.toMatchObject({
      ok: false
    });
    expect(closeCommandTerminal).toHaveBeenCalledWith("session-1", "terminal-backoff");
  });

  it("makes a missing server terminal retryable without issuing a destructive close", async () => {
    const { closeCommandTerminal, runner } = commandRunnerFixture({
      startCommandTerminal: vi.fn(async () => ({
        actionId: "create_source",
        actionLabel: "Create session clone",
        commandPreview: "git clone",
        ok: true,
        operationOutcome: "command_already_running",
        terminalSessionId: "terminal-missing",
        terminalStatus: "running"
      })),
      terminalSessionId: "terminal-missing"
    });
    const resultPromise = runCreateSource(runner);
    const socket = await waitForSocketCount(1);
    socket.sendMessage({
      code: "terminal_session_not_found",
      error: "Terminal session not found.",
      type: "error"
    });

    await expect(resultPromise).resolves.toMatchObject({
      code: "vibe64_command_terminal_lost",
      error: "Create session clone lost its server terminal. Retry the command.",
      ok: false
    });
    expect(closeCommandTerminal).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(runner.running.value).toBe(false);
  });

  it("detaches a stale observer without stopping the server command", async () => {
    const { closeCommandTerminal, runner } = commandRunnerFixture({
      startResponse: {
        output: "installing\n"
      },
      terminalSessionId: "terminal-observer"
    });
    const firstResult = runCreateSource(runner);
    const firstSocket = await waitForSocketCount(1);

    expect(runner.detachCommandObserver()).toBe(true);
    await expect(firstResult).resolves.toMatchObject({
      code: "vibe64_command_observer_detached",
      ok: false
    });
    expect(firstSocket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(closeCommandTerminal).not.toHaveBeenCalled();
    expect(runner.running.value).toBe(false);

    const secondResult = runCreateSource(runner);
    const secondSocket = await waitForSocketCount(2);
    secondSocket.sendMessage({
      exitCode: 0,
      status: "exited",
      type: "status"
    });

    await expect(secondResult).resolves.toMatchObject({
      actionId: "create_source",
      ok: true
    });
    expect(closeCommandTerminal).toHaveBeenCalledWith("session-1", "terminal-observer");
  });

  it("detaches on component unmount without stopping the server command", async () => {
    const { app, closeCommandTerminal, runner } = commandRunnerFixture({
      mounted: true,
      startResponse: {
        output: "cloning\n"
      },
      terminalSessionId: "terminal-detach"
    });
    const resultPromise = runCreateSource(runner);
    await vi.waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(runner.running.value).toBe(true);
    });

    app.unmount();

    await expect(resultPromise).resolves.toMatchObject({
      code: "vibe64_command_observer_detached",
      ok: false
    });
    expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED);
    expect(closeCommandTerminal).not.toHaveBeenCalled();
    expect(runner.running.value).toBe(false);
  });

  it("does not attach after unmount while the command start request is pending", async () => {
    let finishStart;
    const { app, closeCommandTerminal, runner } = commandRunnerFixture({
      mounted: true,
      startCommandTerminal: vi.fn(() => new Promise((resolve) => {
        finishStart = resolve;
      })),
      terminalSessionId: "terminal-late"
    });
    const resultPromise = runCreateSource(runner);
    await vi.waitFor(() => {
      expect(typeof finishStart).toBe("function");
    });

    app.unmount();

    await expect(resultPromise).resolves.toMatchObject({
      code: "vibe64_command_observer_detached",
      ok: false
    });
    finishStart({
      id: "terminal-late",
      ok: true,
      status: "running"
    });
    await Promise.resolve();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(closeCommandTerminal).not.toHaveBeenCalled();
  });

  it("stops during a pending websocket handshake", async () => {
    FakeWebSocket.autoOpen = false;
    const { closeCommandTerminal, runner } = commandRunnerFixture({
      startResponse: {
        output: "cloning\n",
      },
      terminalSessionId: "terminal-connecting"
    });
    const resultPromise = runCreateSource(runner);
    await waitForSocketCount(1);

    expect(runner.stopCommandAction()).toBe(true);

    await expect(resultPromise).resolves.toMatchObject({
      error: "Create session clone was stopped before it finished.",
      ok: false
    });
    expect(closeCommandTerminal).toHaveBeenCalledWith("session-1", "terminal-connecting");
    expect(runner.running.value).toBe(false);
  });
});

function commandRunnerFixture({
  mounted = false,
  reconnectDelayMs = 0,
  reconnectMaxDelayMs,
  startCommandTerminal = null,
  startResponse = {},
  terminalSessionId
} = {}) {
  const closeCommandTerminal = vi.fn(async () => ({ ok: true }));
  const runStartCommandTerminal = startCommandTerminal || vi.fn(async () => ({
    commandPreview: "git clone",
    id: terminalSessionId,
    ok: true,
    status: "running",
    ...startResponse
  }));
  const options = {
    closeCommandTerminal,
    reconnectDelayMs,
    reconnectMaxDelayMs,
    startCommandTerminal: runStartCommandTerminal,
    webSocketUrl: () => `ws://studio/session-1/${terminalSessionId}`
  };
  let app = null;
  let runner;
  if (mounted) {
    app = testRenderer().createApp({
      setup() {
        runner = useVibe64HeadlessCommandRunner(options);
        return () => null;
      }
    });
    app.mount({
      children: [],
      type: "root"
    });
  } else {
    runner = useVibe64HeadlessCommandRunner(options);
  }
  return {
    app,
    closeCommandTerminal,
    runner,
    startCommandTerminal: runStartCommandTerminal
  };
}

function runCreateSource(runner) {
  return runner.runCommandAction({
    action: {
      id: "create_source",
      label: "Create session clone"
    },
    sessionId: "session-1"
  });
}

async function waitForSocketCount(expectedCount) {
  await vi.waitFor(() => {
    expect(FakeWebSocket.instances).toHaveLength(expectedCount);
  });
  return FakeWebSocket.instances[expectedCount - 1];
}

function testRenderer() {
  return createRenderer({
    createComment: (text) => ({ text, type: "comment" }),
    createElement: (type) => ({ children: [], parent: null, type }),
    createText: (text) => ({ text, type: "text" }),
    insert: (child, parent) => {
      child.parent = parent;
      parent.children.push(child);
    },
    nextSibling: () => null,
    parentNode: (node) => node.parent,
    patchProp: () => null,
    remove: () => null,
    setElementText: (element, text) => {
      element.text = text;
    },
    setText: (node, text) => {
      node.text = text;
    }
  });
}

class FakeWebSocket {
  static CLOSED = 3;
  static CLOSING = 2;
  static CONNECTING = 0;
  static OPEN = 1;
  static autoOpen = true;
  static instances = [];

  constructor(url) {
    this.listeners = new Map();
    this.readyState = FakeWebSocket.CONNECTING;
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      if (FakeWebSocket.autoOpen && this.readyState === FakeWebSocket.CONNECTING) {
        this.readyState = FakeWebSocket.OPEN;
        this.emit("open", {});
      }
    });
  }

  addEventListener(eventName, listener) {
    const listeners = this.listeners.get(eventName) || [];
    listeners.push(listener);
    this.listeners.set(eventName, listeners);
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  disconnect() {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  sendMessage(message) {
    this.emit("message", {
      data: JSON.stringify(message)
    });
  }

  emit(eventName, event) {
    for (const listener of this.listeners.get(eventName) || []) {
      listener(event);
    }
  }
}
