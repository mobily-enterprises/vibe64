import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { io } from "socket.io-client";

import {
  createServer,
  createSignalShutdownHandler
} from "../../server.js";
import {
  closeTerminalSession,
  readTerminalSession,
  startTerminalSession
} from "@local/vibe64-execution/server/terminalSessions";

test("signal shutdown exits cleanly after Fastify closes", async () => {
  const events = [];
  let timeoutCleared = false;
  const handler = createSignalShutdownHandler({
    app: {
      async close() {
        events.push("close");
      },
      log: testLogger(events)
    },
    clearTimeoutFn() {
      timeoutCleared = true;
    },
    exitProcess(code) {
      events.push(`exit:${code}`);
    },
    beforeClose(signal) {
      events.push(`before:${signal}`);
    },
    closeRuntimeTerminals() {
      events.push("close-terminals");
    },
    setTimeoutFn() {
      return {
        unref() {
          events.push("unref");
        }
      };
    },
    shutdownTimeoutMs: 1000
  });

  await handler("SIGTERM");

  assert.equal(timeoutCleared, true);
  assert.deepEqual(events, [
    "info:Stopping vibe64 server.",
    "unref",
    "before:SIGTERM",
    "close-terminals",
    "close",
    "info:Stopped vibe64 server.",
    "exit:0"
  ]);
});

test("signal shutdown forces exit when Fastify close stalls", async () => {
  const events = [];
  let timeoutCallback = null;
  const handler = createSignalShutdownHandler({
    app: {
      close() {
        events.push("close");
        return new Promise(() => {});
      },
      log: testLogger(events),
      server: {
        closeAllConnections() {
          events.push("close-all");
        },
        closeIdleConnections() {
          events.push("close-idle");
        }
      }
    },
    exitProcess(code) {
      events.push(`exit:${code}`);
    },
    closeRuntimeTerminals() {
      events.push("close-terminals");
    },
    setTimeoutFn(callback) {
      timeoutCallback = callback;
      return {
        unref() {
          events.push("unref");
        }
      };
    },
    shutdownTimeoutMs: 1000
  });

  void handler("SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof timeoutCallback, "function");
  timeoutCallback();

  assert.deepEqual(events, [
    "info:Stopping vibe64 server.",
    "unref",
    "close-terminals",
    "close",
    "error:Vibe64 server shutdown timed out; forcing process exit.",
    "close-idle",
    "close-all",
    "exit:1"
  ]);
});

test("signal shutdown begins Fastify feature shutdown without waiting for terminal close", async () => {
  let releaseTerminalClose;
  const terminalCloseHeld = new Promise((resolve) => {
    releaseTerminalClose = resolve;
  });
  const events = [];
  const handler = createSignalShutdownHandler({
    app: {
      async close() {
        events.push("close");
      },
      log: testLogger(events)
    },
    closeRuntimeTerminals() {
      events.push("close-terminals");
      return terminalCloseHeld;
    },
    exitProcess(code) {
      events.push(`exit:${code}`);
    },
    setTimeoutFn() {
      return { unref() {} };
    },
    shutdownTimeoutMs: 1000
  });

  const closing = handler("SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events, [
    "info:Stopping vibe64 server.",
    "close-terminals",
    "close"
  ]);
  releaseTerminalClose();
  await closing;
  assert.deepEqual(events.slice(-2), [
    "info:Stopped vibe64 server.",
    "exit:0"
  ]);
});

test("signal shutdown settles capability runtime before Fastify while terminal close continues", async () => {
  let releaseCapabilityRuntime;
  const capabilityRuntimeHeld = new Promise((resolve) => {
    releaseCapabilityRuntime = resolve;
  });
  let releaseTerminalClose;
  const terminalCloseHeld = new Promise((resolve) => {
    releaseTerminalClose = resolve;
  });
  const events = [];
  const handler = createSignalShutdownHandler({
    app: {
      async close() {
        events.push("fastify");
      },
      log: testLogger(events),
      vibe64CapabilityRuntime: {
        shutdown() {
          events.push("capability-runtime");
          return capabilityRuntimeHeld;
        }
      }
    },
    closeRuntimeTerminals() {
      events.push("runtime-terminals");
      return terminalCloseHeld;
    },
    exitProcess(code) {
      events.push(`exit:${code}`);
    },
    setTimeoutFn() {
      return { unref() {} };
    },
    shutdownTimeoutMs: 1000
  });

  const closing = handler("SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [
    "info:Stopping vibe64 server.",
    "runtime-terminals",
    "capability-runtime"
  ]);

  releaseCapabilityRuntime();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events.slice(-1), ["fastify"]);
  releaseTerminalClose();
  await closing;
  assert.deepEqual(events.slice(-2), [
    "info:Stopped vibe64 server.",
    "exit:0"
  ]);
});

test("signal shutdown closes a real upgraded Socket.IO connection through capability shutdown", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-signal-socket-"));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = `signal-socket-${process.pid}`;
  let app = null;
  let socket = null;
  const events = [];

  try {
    app = await createServer({
      managedSourceRoot: path.join(temporaryRoot, "managed"),
      projectsRoot: path.join(temporaryRoot, "projects"),
      systemRoot: path.join(temporaryRoot, "state")
    });
    const address = await app.listen({
      host: "127.0.0.1",
      port: 0
    });
    socket = io(address, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"]
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Socket.IO connection timed out.")), 2000);
      socket.once("connect", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once("connect_error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    const capabilityRuntime = app.vibe64CapabilityRuntime;
    assert.equal(typeof capabilityRuntime?.shutdown, "function");
    const shutdownCapabilityRuntime = capabilityRuntime.shutdown.bind(capabilityRuntime);
    const fastifyClose = app.close.bind(app);
    app.vibe64CapabilityRuntime = {
      async shutdown() {
        events.push("capability-runtime");
        await shutdownCapabilityRuntime();
      }
    };
    app.close = async () => {
      events.push("fastify");
      await fastifyClose();
    };
    const handler = createSignalShutdownHandler({
      app,
      closeRuntimeTerminals() {
        events.push("runtime-terminals");
      },
      exitProcess(code) {
        events.push(`exit:${code}`);
      },
      shutdownTimeoutMs: 5000
    });
    const disconnected = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(
        new Error("Socket.IO connection did not observe server shutdown.")
      ), 5000);
      socket.once("disconnect", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await handler("SIGTERM");
    await disconnected;

    assert.deepEqual(events, [
      "runtime-terminals",
      "capability-runtime",
      "fastify",
      "exit:0"
    ]);
    assert.equal(socket.connected, false);
  } finally {
    socket?.close();
    await app?.close().catch(() => null);
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("signal shutdown reaches Fastify feature shutdown when pre-close cleanup fails", async () => {
  const events = [];
  const handler = createSignalShutdownHandler({
    app: {
      async close() {
        events.push("close");
      },
      log: testLogger(events)
    },
    beforeClose() {
      events.push("before-close");
      throw new Error("pre-close failed");
    },
    closeRuntimeTerminals() {
      events.push("close-terminals");
    },
    exitProcess(code) {
      events.push(`exit:${code}`);
    },
    setTimeoutFn() {
      return { unref() {} };
    },
    shutdownTimeoutMs: 1000
  });

  await handler("SIGTERM");

  assert.deepEqual(events, [
    "info:Stopping vibe64 server.",
    "before-close",
    "close-terminals",
    "close",
    "error:Failed to stop vibe64 server cleanly.",
    "exit:1"
  ]);
});

test("signal shutdown reaches Fastify close when capability shutdown fails", async () => {
  const events = [];
  const handler = createSignalShutdownHandler({
    app: {
      async close() {
        events.push("close");
      },
      log: testLogger(events),
      vibe64CapabilityRuntime: {
        async shutdown() {
          events.push("capability-runtime");
          throw new Error("capability shutdown failed");
        }
      }
    },
    closeRuntimeTerminals() {
      events.push("close-terminals");
    },
    exitProcess(code) {
      events.push(`exit:${code}`);
    },
    setTimeoutFn() {
      return { unref() {} };
    },
    shutdownTimeoutMs: 1000
  });

  await handler("SIGTERM");

  assert.deepEqual(events, [
    "info:Stopping vibe64 server.",
    "close-terminals",
    "capability-runtime",
    "close",
    "error:Failed to stop vibe64 server cleanly.",
    "exit:1"
  ]);
});

test("signal shutdown kills a terminal child and forces exit while stop cleanup is pending", async () => {
  const namespace = `server-shutdown-held-stop-${process.pid}`;
  let releaseStopHook = () => null;
  const heldStopHook = new Promise((resolve) => {
    releaseStopHook = resolve;
  });
  const session = startTerminalSession({
    args: [
      "-lc",
      `"${process.execPath}" -e 'process.stdin.resume(); setInterval(() => {}, 1000);' & ` +
        "child=$!; printf 'shell:%s child:%s\\n' \"$$\" \"$child\"; wait \"$child\""
    ],
    command: "bash",
    commandPreview: "bash shutdown held stop fixture",
    namespace,
    async onStop() {
      await heldStopHook;
    }
  });
  let processIds = [];
  for (let attempt = 0; attempt < 80 && processIds.length < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const match = readTerminalSession(session.id, { namespace }).output.match(/shell:(\d+) child:(\d+)/u);
    processIds = match ? match.slice(1).map(Number) : [];
  }
  assert.equal(processIds.length, 2);
  assert.equal(processIds.every((pid) => Number.isSafeInteger(pid) && pid > 1), true);

  const events = [];
  let timeoutCallback;
  const handler = createSignalShutdownHandler({
    app: {
      async close() {
        events.push("fastify");
      },
      log: testLogger(events)
    },
    closeRuntimeTerminals() {
      return closeTerminalSession(session.id, {
        namespace
      });
    },
    exitProcess(code) {
      events.push(`exit:${code}`);
    },
    setTimeoutFn(callback) {
      timeoutCallback = callback;
      return { unref() {} };
    },
    shutdownTimeoutMs: 2000
  });

  const closing = handler("SIGTERM");
  try {
    for (let attempt = 0; attempt < 80 && processIds.some(processIsAlive); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    assert.equal(processIds.every((pid) => !processIsAlive(pid)), true);
    assert.equal(events.includes("fastify"), true);
    assert.equal(events.some((event) => event.startsWith("exit:")), false);
    timeoutCallback();
    assert.equal(events.includes("error:Vibe64 server shutdown timed out; forcing process exit."), true);
    assert.deepEqual(events.slice(-1), ["exit:1"]);
  } finally {
    releaseStopHook();
    await closing;
    await closeTerminalSession(session.id, {
      namespace
    }).catch(() => null);
  }
  assert.deepEqual(events.filter((event) => event.startsWith("exit:")), ["exit:1"]);
});

test("signal shutdown stops runtime terminals before a stalled Fastify close", async () => {
  const namespace = "server-shutdown-running-terminal-test";
  const session = startTerminalSession({
    args: [
      "-e",
      "console.log(`child:${process.pid}`); process.stdin.resume(); setInterval(() => {}, 1000);"
    ],
    command: process.execPath,
    commandPreview: "node shutdown fixture",
    namespace
  });
  let childPid = 0;
  for (let attempt = 0; attempt < 80 && !childPid; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const match = readTerminalSession(session.id, { namespace }).output.match(/child:(\d+)/u);
    childPid = Number(match?.[1] || 0);
  }
  assert.equal(Number.isSafeInteger(childPid) && childPid > 1, true);

  let closeStarted = false;
  let timeoutCallback = null;
  const exits = [];
  const handler = createSignalShutdownHandler({
    app: {
      close() {
        closeStarted = true;
        return new Promise(() => {});
      },
      log: testLogger([]),
      server: {}
    },
    exitProcess(code) {
      exits.push(code);
    },
    setTimeoutFn(callback) {
      timeoutCallback = callback;
      return {
        unref() {}
      };
    },
    shutdownTimeoutMs: 1000
  });

  void handler("SIGTERM");
  for (let attempt = 0; attempt < 80 && !closeStarted; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.equal(closeStarted, true);
  for (let attempt = 0; attempt < 80 &&
    (processIsAlive(childPid) || readTerminalSession(session.id, { namespace }).ok); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(processIsAlive(childPid), false);
  assert.equal(readTerminalSession(session.id, { namespace }).ok, false);
  timeoutCallback();
  assert.deepEqual(exits, [1]);
});

function testLogger(events) {
  return {
    error(_fields, message) {
      events.push(`error:${message}`);
    },
    info(_fields, message) {
      events.push(`info:${message}`);
    }
  };
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}
