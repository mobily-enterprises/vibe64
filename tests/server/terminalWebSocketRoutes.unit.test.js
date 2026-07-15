import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import {
  LOCALHOST_CHECK_BYPASS_ENV
} from "@local/vibe64-core/server/localhostCheckBypass";
import {
  registerTerminalWebSocketRoute
} from "@local/vibe64-core/server/terminalWebSocketRoutes";
import {
  currentProjectScopeKey
} from "@local/vibe64-core/server/projectRequestContext";
import {
  createStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";

async function withProjectRequestContext(callback) {
  const projectsRoot = await mkdtemp(path.join(tmpdir(), "vibe64-ws-projects-"));
  const slug = "alpha_1";
  await mkdir(path.join(projectsRoot, slug), {
    recursive: true
  });
  try {
    return await callback({
      projectContext: createStudioProjectContext({
        explicitProjectsRoot: projectsRoot,
        env: {},
        home: projectsRoot
      }),
      slug
    });
  } finally {
    await rm(projectsRoot, {
      force: true,
      recursive: true
    });
  }
}

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

async function waitForSocketMessages(socket, count) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (socket.sent.length >= count) {
      return;
    }
    await delay(5);
  }
}

test("terminal websocket routes register through JSKIT app ownership", async () => {
  const previousBypass = process.env[LOCALHOST_CHECK_BYPASS_ENV];
  process.env[LOCALHOST_CHECK_BYPASS_ENV] = "1";
  try {
    const calls = [];
    let subscriptionFailure = null;
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

    await withProjectRequestContext(async ({ projectContext, slug }) => {
      registerTerminalWebSocketRoute(app, {
        projectContext,
        routePath: "/api/app/:slug/unit/sessions/:sessionId/terminal/:terminalSessionId/ws",
        serviceId: "feature.unit-terminal.service",
        serviceUnavailableMessage: "Unit terminal service is unavailable.",
        subscribe(resolvedService, { request, sessionId, subscriber, terminalSessionId }) {
          assert.equal(resolvedService, service);
          calls.push(["subscribe", sessionId, terminalSessionId, request.vibe64User?.email || "", currentProjectScopeKey()]);
          if (subscriptionFailure) {
            return subscriptionFailure;
          }
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
        resize(resolvedService, { cols, request, rows, sessionId, terminalSessionId }) {
          assert.equal(resolvedService, service);
          calls.push(["resize", sessionId, terminalSessionId, cols, rows, request.vibe64User?.email || "", currentProjectScopeKey()]);
          return {
            ok: true
          };
        },
        write(resolvedService, { data, request, sessionId, terminalSessionId }) {
          assert.equal(resolvedService, service);
          calls.push(["write", sessionId, terminalSessionId, data, request.vibe64User?.email || "", currentProjectScopeKey()]);
          return {
            ok: true
          };
        }
      });

      assert.equal(fastify.registered.path, "/api/app/:slug/unit/sessions/:sessionId/terminal/:terminalSessionId/ws");
      assert.deepEqual(fastify.registered.options, {
        websocket: true
      });

      const socket = testSocket();
      fastify.registered.handler(socket, {
        headers: {},
        ip: "10.0.0.8",
        params: {
          sessionId: "session-1",
          slug,
          terminalSessionId: "terminal-1"
        },
        vibe64User: {
          email: "owner@example.com"
        }
      });
      await waitForSocketMessages(socket, 2);

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
        ["subscribe", "session-1", "terminal-1", "owner@example.com", `project:${slug}`],
        ["write", "session-1", "terminal-1", "hello", "owner@example.com", `project:${slug}`],
        ["resize", "session-1", "terminal-1", 120, 40, "owner@example.com", `project:${slug}`],
        ["unsubscribe"]
      ]);

      subscriptionFailure = {
        code: "terminal_session_not_found",
        error: "Terminal session not found.",
        ok: false
      };
      const missing = testSocket();
      fastify.registered.handler(missing, {
        headers: {},
        ip: "10.0.0.8",
        params: {
          sessionId: "session-1",
          slug,
          terminalSessionId: "terminal-missing"
        },
        vibe64User: {
          email: "owner@example.com"
        }
      });
      await waitForSocketMessages(missing, 1);
      assert.deepEqual(missing.sent, [
        {
          code: "terminal_session_not_found",
          error: "Terminal session not found.",
          type: "error"
        }
      ]);
      assert.equal(missing.closed.code, 1008);
    });
  } finally {
    if (previousBypass == null) {
      delete process.env[LOCALHOST_CHECK_BYPASS_ENV];
    } else {
      process.env[LOCALHOST_CHECK_BYPASS_ENV] = previousBypass;
    }
  }
});

test("terminal websocket guard accepts authenticated non-loopback requests", async () => {
  const previousBypass = process.env[LOCALHOST_CHECK_BYPASS_ENV];
  delete process.env[LOCALHOST_CHECK_BYPASS_ENV];
  try {
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
          return {};
        }
        throw new Error(`Unknown token ${token}.`);
      }
    };

    await withProjectRequestContext(async ({ projectContext, slug }) => {
      registerTerminalWebSocketRoute(app, {
        projectContext,
        routePath: "/api/app/:slug/unit/sessions/:sessionId/terminal/:terminalSessionId/ws",
        serviceId: "feature.unit-terminal.service",
        serviceUnavailableMessage: "Unit terminal service is unavailable.",
        subscribe(_service, { terminalSessionId }) {
          return {
            terminalSessionId,
            unsubscribe() {}
          };
        },
        write() {
          return {
            ok: true
          };
        }
      });

      const rejected = testSocket();
      fastify.registered.handler(rejected, {
        headers: {
          host: "example.com",
          origin: "https://example.com"
        },
        ip: "10.0.0.8",
        params: {
          sessionId: "session-1",
          slug,
          terminalSessionId: "terminal-1"
        }
      });
      assert.equal(rejected.closed.code, 1008);

      const accepted = testSocket();
      fastify.registered.handler(accepted, {
        headers: {
          host: "example.com",
          origin: "https://example.com"
        },
        ip: "10.0.0.8",
        params: {
          sessionId: "session-1",
          slug,
          terminalSessionId: "terminal-1"
        },
        vibe64User: {
          email: "owner@example.com"
        }
      });
      await waitForSocketMessages(accepted, 1);

      assert.equal(accepted.closed, null);
      assert.deepEqual(accepted.sent, [
        {
          session: {
            terminalSessionId: "terminal-1"
          },
          type: "snapshot"
        }
      ]);
    });
  } finally {
    if (previousBypass == null) {
      delete process.env[LOCALHOST_CHECK_BYPASS_ENV];
    } else {
      process.env[LOCALHOST_CHECK_BYPASS_ENV] = previousBypass;
    }
  }
});
