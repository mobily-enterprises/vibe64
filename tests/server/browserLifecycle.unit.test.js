import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  createBrowserLifecycleMonitor,
  sendBrowserLifecycleState
} from "../../server/lib/browserLifecycle.js";

test("browser lifecycle monitor shuts down after the last client disconnects", async () => {
  const timer = fakeTimer();
  const shutdowns = [];
  const messages = [];
  const monitor = createBrowserLifecycleMonitor({
    clearTimeoutFn: timer.clearTimeout,
    closeServer: async (reason) => {
      shutdowns.push(reason);
    },
    logger: {
      info(message) {
        messages.push(message);
      }
    },
    setTimeoutFn: timer.setTimeout
  });
  monitor.enableShutdown();

  const socket = new EventEmitter();
  monitor.registerClient(socket);
  assert.equal(monitor.activeClientCount(), 1);

  socket.emit("close");
  assert.equal(monitor.activeClientCount(), 0);
  assert.equal(timer.pendingDelay(), 1000);
  assert.deepEqual(messages, [
    "Browser window disconnected. Terminating in 1 second..."
  ]);

  await timer.runPending();
  assert.deepEqual(shutdowns, ["browser-lifecycle-disconnected"]);
  assert.deepEqual(messages, [
    "Browser window disconnected. Terminating in 1 second...",
    "Closing Vibe64 because the browser window disconnected."
  ]);
});

test("browser lifecycle monitor cancels shutdown when a client reconnects", async () => {
  const timer = fakeTimer();
  const shutdowns = [];
  const monitor = createBrowserLifecycleMonitor({
    clearTimeoutFn: timer.clearTimeout,
    closeServer: async (reason) => {
      shutdowns.push(reason);
    },
    setTimeoutFn: timer.setTimeout
  });
  monitor.enableShutdown();

  const firstSocket = new EventEmitter();
  monitor.registerClient(firstSocket);
  firstSocket.emit("close");
  assert.equal(timer.hasPendingTimer(), true);

  const secondSocket = new EventEmitter();
  monitor.registerClient(secondSocket);
  assert.equal(timer.hasPendingTimer(), false);

  await timer.runPending();
  assert.deepEqual(shutdowns, []);
});

test("browser lifecycle monitor closes registered sockets when stopped", () => {
  const timer = fakeTimer();
  const closeCalls = [];
  const monitor = createBrowserLifecycleMonitor({
    setTimeoutFn: timer.setTimeout
  });
  monitor.enableShutdown();

  const socket = new EventEmitter();
  socket.close = (code, reason) => {
    closeCalls.push({
      code,
      reason
    });
    socket.emit("close");
  };

  monitor.registerClient(socket);
  assert.equal(monitor.activeClientCount(), 1);

  monitor.stop();

  assert.equal(monitor.activeClientCount(), 0);
  assert.deepEqual(closeCalls, [
    {
      code: 1001,
      reason: "Vibe64 server is stopping."
    }
  ]);
  assert.equal(timer.hasPendingTimer(), false);
});

test("browser lifecycle monitor is passive until shutdown is enabled", async () => {
  const timer = fakeTimer();
  const monitor = createBrowserLifecycleMonitor({
    clearTimeoutFn: timer.clearTimeout,
    setTimeoutFn: timer.setTimeout
  });

  const socket = new EventEmitter();
  monitor.registerClient(socket);
  socket.emit("close");

  assert.equal(timer.hasPendingTimer(), false);
});

test("browser lifecycle state tells the client whether server disconnect should close the browser", () => {
  const sentMessages = [];
  const monitor = createBrowserLifecycleMonitor();
  const socket = {
    send(message) {
      sentMessages.push(JSON.parse(message));
    }
  };

  sendBrowserLifecycleState(socket, monitor);
  monitor.enableShutdown();
  sendBrowserLifecycleState(socket, monitor);

  assert.deepEqual(sentMessages, [
    {
      closeBrowserOnDisconnect: false,
      type: "browser-lifecycle-state"
    },
    {
      closeBrowserOnDisconnect: true,
      type: "browser-lifecycle-state"
    }
  ]);
});

function fakeTimer() {
  let pendingTimer = null;
  return {
    clearTimeout(timer) {
      if (pendingTimer === timer) {
        pendingTimer = null;
      }
    },
    hasPendingTimer() {
      return Boolean(pendingTimer);
    },
    pendingDelay() {
      return pendingTimer?.delayMs ?? null;
    },
    async runPending() {
      const timer = pendingTimer;
      pendingTimer = null;
      if (timer) {
        await timer.callback();
      }
    },
    setTimeout(callback, delayMs) {
      pendingTimer = {
        callback,
        delayMs
      };
      return pendingTimer;
    }
  };
}
