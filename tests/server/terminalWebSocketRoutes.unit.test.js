import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
  const projectContext = createStudioProjectContext({
    explicitProjectsRoot: projectsRoot,
    env: {},
    home: projectsRoot
  });
  await projectContext.createWorkspaceProjectRecord({ slug });
  try {
    return await callback({
      projectContext,
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
    await withProjectRequestContext(async ({ projectContext, slug }) => {
      registerTerminalWebSocketRoute(fastify, {
        projectContext,
        routePath: "/api/app/:slug/unit/sessions/:sessionId/terminal/:terminalSessionId/ws",
        service,
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
        headers: { host: "example.com", origin: "http://example.com" },
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
        headers: { host: "example.com", origin: "http://example.com" },
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

test("terminal websocket guard requires authenticated same-origin requests for hosted terminals", async () => {
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
    const service = {};

    await withProjectRequestContext(async ({ projectContext, slug }) => {
      registerTerminalWebSocketRoute(fastify, {
        projectContext,
        routePath: "/api/app/:slug/unit/sessions/:sessionId/terminal/:terminalSessionId/ws",
        service,
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
        protocol: "https",
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
      for (const origin of [undefined, "null", "https://attacker.example", "https://example.com:444"]) {
        const foreign = testSocket();
        fastify.registered.handler(foreign, {
          protocol: "https",
          headers: { host: "example.com", ...(origin === undefined ? {} : { origin }) },
          ip: "10.0.0.8", vibe64User: { email: "owner@example.com" }
        });
        assert.equal(foreign.closed.code, 1008, String(origin));
        assert.equal(foreign.handlers.message, undefined, "rejected sockets cannot write terminal input");
        assert.equal(foreign.sent.length, 1);
      }
    });
  } finally {
    if (previousBypass == null) {
      delete process.env[LOCALHOST_CHECK_BYPASS_ENV];
    } else {
      process.env[LOCALHOST_CHECK_BYPASS_ENV] = previousBypass;
    }
  }
});

test("terminal websocket preserves rapid input order across delayed writes and a failed write", async () => {
  let handler;
  let releaseFirst;
  let firstStarted;
  const started = new Promise(resolve => { firstStarted = resolve; });
  const blocked = new Promise(resolve => { releaseFirst = resolve; });
  const received = [];
  const written = [];
  const service = {};
  registerTerminalWebSocketRoute({
    get(_path, _options, routeHandler) { handler = routeHandler; }
  }, {
    projectScoped: false,
    routePath: "/terminal/ws",
    service,
    subscribe() { return { unsubscribe() {} }; },
    async write(resolvedService, { data, sessionId, terminalSessionId, request }) {
      assert.equal(resolvedService, service);
      assert.equal(sessionId, "session-1");
      assert.equal(terminalSessionId, "terminal-1");
      assert.equal(request.vibe64User.email, "owner@example.com");
      received.push(data);
      if (data === "K") {
        firstStarted();
        await blocked;
      }
      if (data === "!") throw new Error("Input rejected.");
      written.push(data);
      return { ok: true };
    }
  });
  const socket = testSocket();
  handler(socket, {
    protocol: "https",
    headers: { host: "example.com", origin: "https://example.com" },
    ip: "10.0.0.8",
    params: { sessionId: "session-1", terminalSessionId: "terminal-1" },
    vibe64User: { email: "owner@example.com" }
  });
  await waitForSocketMessages(socket, 1);
  const input = data => socket.handlers.message(Buffer.from(JSON.stringify({ type: "input", data })));
  const first = input("K");
  await started;
  const rest = [input("O"), input("."), input("\r")];
  try {
    await delay(0);
    assert.deepEqual(received, ["K"], "later keystrokes must wait for the first write");
  } finally {
    releaseFirst();
    await Promise.all([first, ...rest]);
  }
  assert.equal(written.join(""), "KO.\r", "Enter must not overtake pending input");
  await Promise.all([input("!"), input("next")]);
  assert.deepEqual(written, ["K", "O", ".", "\r", "next"]);
  assert.deepEqual(socket.sent.at(-1), { error: "Input rejected.", type: "error" });
  socket.handlers.close();
});
