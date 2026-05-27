import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCALHOST_CHECK_BYPASS_ENV
} from "@local/vibe64-core/server/localhostCheckBypass";
import {
  registerTerminalWebSocketRoute
} from "@local/vibe64-core/server/terminalWebSocketRoutes";

function testSocket() {
  const handlers = {};
  const sent = [];
  return {
    closed: null,
    handlers,
    readyState: 1,
    sent,
    close(code, reason) {
      this.closed = {
        code,
        reason
      };
    },
    on(event, handler) {
      handlers[event] = handler;
    },
    send(payload) {
      sent.push(JSON.parse(payload));
    }
  };
}

function waitForPromiseQueue() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

test("terminal websocket routes register through JSKIT app ownership", async () => {
  const previousBypass = process.env[LOCALHOST_CHECK_BYPASS_ENV];
  process.env[LOCALHOST_CHECK_BYPASS_ENV] = "1";
  try {
    const calls = [];
    const service = {};
    const fastify = {
      registered: null,
      get(path, options, handler) {
        this.registered = {
          handler,
          options,
          path
        };
      }
    };
    const app = {
      make(token) {
        if (token === "jskit.fastify") {
          return fastify;
        }
        if (token === "feature.unit-terminal.service") {
          return service;
        }
        throw new Error(`Unknown token ${token}.`);
      }
    };

    registerTerminalWebSocketRoute(app, {
      routePath: "/api/unit/sessions/:sessionId/terminal/:terminalSessionId/ws",
      serviceId: "feature.unit-terminal.service",
      serviceUnavailableMessage: "Unit terminal service is unavailable.",
      subscribe(resolvedService, { sessionId, subscriber, terminalSessionId }) {
        assert.equal(resolvedService, service);
        calls.push(["subscribe", sessionId, terminalSessionId]);
        subscriber({
          line: "ready",
          type: "terminal.output"
        });
        return {
          terminalSessionId,
          unsubscribe() {
            calls.push(["unsubscribe"]);
          }
        };
      },
      resize(resolvedService, { cols, rows, sessionId, terminalSessionId }) {
        assert.equal(resolvedService, service);
        calls.push(["resize", sessionId, terminalSessionId, cols, rows]);
        return {
          ok: true
        };
      },
      write(resolvedService, { data, sessionId, terminalSessionId }) {
        assert.equal(resolvedService, service);
        calls.push(["write", sessionId, terminalSessionId, data]);
        return {
          ok: true
        };
      }
    });

    assert.equal(fastify.registered.path, "/api/unit/sessions/:sessionId/terminal/:terminalSessionId/ws");
    assert.deepEqual(fastify.registered.options, {
      websocket: true
    });

    const socket = testSocket();
    fastify.registered.handler(socket, {
      headers: {},
      ip: "10.0.0.8",
      params: {
        sessionId: "session-1",
        terminalSessionId: "terminal-1"
      }
    });
    await waitForPromiseQueue();

    assert.deepEqual(socket.sent, [
      {
        line: "ready",
        type: "terminal.output"
      },
      {
        session: {
          terminalSessionId: "terminal-1"
        },
        type: "snapshot"
      }
    ]);

    await socket.handlers.message(Buffer.from(JSON.stringify({
      data: "hello",
      type: "input"
    })));
    await socket.handlers.message(Buffer.from(JSON.stringify({
      cols: 120,
      rows: 40,
      type: "resize"
    })));
    socket.handlers.close();

    assert.deepEqual(calls, [
      ["subscribe", "session-1", "terminal-1"],
      ["write", "session-1", "terminal-1", "hello"],
      ["resize", "session-1", "terminal-1", 120, 40],
      ["unsubscribe"]
    ]);
  } finally {
    if (previousBypass == null) {
      delete process.env[LOCALHOST_CHECK_BYPASS_ENV];
    } else {
      process.env[LOCALHOST_CHECK_BYPASS_ENV] = previousBypass;
    }
  }
});
