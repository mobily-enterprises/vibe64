import assert from "node:assert/strict";
import test from "node:test";

import {
  createSignalShutdownHandler
} from "../../server.js";

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
  assert.equal(typeof timeoutCallback, "function");
  timeoutCallback();

  assert.deepEqual(events, [
    "info:Stopping vibe64 server.",
    "unref",
    "close",
    "error:Vibe64 server shutdown timed out; forcing process exit.",
    "close-idle",
    "close-all",
    "exit:1"
  ]);
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
