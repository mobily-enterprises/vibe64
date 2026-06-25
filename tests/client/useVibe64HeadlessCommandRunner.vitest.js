import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useVibe64HeadlessCommandRunner
} from "../../src/composables/useVibe64HeadlessCommandRunner.js";

describe("useVibe64HeadlessCommandRunner", () => {
  let originalWebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    FakeWebSocket.instances.length = 0;
    globalThis.WebSocket = FakeWebSocket;
  });

  afterEach(() => {
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
        id: "create_worktree",
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
      actionId: "create_worktree",
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
        error.status = 409;
        throw error;
      }),
      webSocketUrl: () => "ws://studio/session-1/terminal-conflict"
    });

    await expect(runner.runCommandAction({
      action: {
        id: "create_worktree",
        label: "Create session clone"
      },
      sessionId: "session-1"
    })).resolves.toMatchObject({
      actionId: "create_worktree",
      code: "vibe64_action_disabled",
      error: "This step is already complete.",
      ok: false,
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
        actionId: "create_worktree",
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
      actionId: "create_worktree",
      ok: true,
      output: "worktree ready\n",
      terminalSessionId: "terminal-existing"
    });
    expect(closeCommandTerminal).not.toHaveBeenCalled();
    expect(runner.running.value).toBe(false);
  });

  it("accepts an already finished session command without opening a websocket", async () => {
    const closeCommandTerminal = vi.fn(async () => ({
      ok: true
    }));
    const runner = useVibe64HeadlessCommandRunner({
      closeCommandTerminal,
      startCommandTerminal: vi.fn(async () => ({
        actionId: "create_worktree",
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
        id: "create_worktree",
        label: "Create session clone"
      },
      sessionId: "session-1"
    })).resolves.toMatchObject({
      actionId: "create_worktree",
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
});

class FakeWebSocket {
  static CLOSED = 3;
  static CLOSING = 2;
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.listeners = new Map();
    this.readyState = FakeWebSocket.OPEN;
    this.url = url;
    FakeWebSocket.instances.push(this);
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
