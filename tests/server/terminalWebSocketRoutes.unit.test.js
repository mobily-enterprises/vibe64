import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import {
  registerTerminalWebSocketRoute
} from "@local/vibe64-core/server/terminalWebSocketRoutes";
import {
  currentProjectScopeKey
} from "@local/vibe64-core/server/projectRequestContext";
import {
  createStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import { registerRoutes } from "../../packages/vibe64-terminals/src/server/registerRoutes.js";
import { createServiceSessionTerminals } from "../../packages/vibe64-terminals/src/server/serviceSessionTerminals.js";
import { testRouteApp } from "./vibe64RouteTestHelpers.js";

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
      localhostCheckBypassed: true,
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
});

test("terminal websocket guard requires authenticated same-origin requests for signed-in terminals", async () => {
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
      localhostCheckBypassed: false,
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
    localhostCheckBypassed: false,
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

test("terminal websocket close during original project authority read never attaches an observer", async () => {
  await withProjectRequestContext(async ({ projectContext, slug }) => {
    let enter;
    let release;
    const entered = new Promise(resolve => { enter = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    const delayedProject = Object.create(projectContext);
    Object.defineProperty(delayedProject, "readWorkspaceProject", { value: async (...args) => {
      enter(); await blocked;
      return projectContext.readWorkspaceProject(...args);
    } });
    let handler;
    let subscriptions = 0;
    registerTerminalWebSocketRoute({ get(_path, _options, callback) { handler = callback; } }, {
      localhostCheckBypassed: false, projectContext: delayedProject, routePath: "/terminal/ws", service: {},
      subscribe() { subscriptions += 1; return { unsubscribe() {} }; }, write() {}
    });
    const socket = testSocket();
    handler(socket, { protocol: "https", headers: { host: "example.com", origin: "https://example.com" },
      ip: "10.0.0.8", params: { slug, sessionId: "session-1", terminalSessionId: "terminal-1" },
      vibe64User: { email: "owner@example.com" } });
    await entered;
    socket.handlers.close(); release();
    await delay(10);
    assert.equal(subscriptions, 0);
    assert.deepEqual(socket.sent, []);
    assert.equal(socket.handlers.message, undefined);
  });
});

test("terminal websocket releases a late observer exactly once without snapshot or queued input", async () => {
  let handler;
  let enter;
  let release;
  let subscriber;
  let isClosed;
  const entered = new Promise(resolve => { enter = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  let releases = 0;
  let writes = 0;
  registerTerminalWebSocketRoute({ get(_path, _options, callback) { handler = callback; } }, {
    localhostCheckBypassed: false, projectScoped: false, routePath: "/terminal/ws", service: {},
    async subscribe(_service, context) {
      subscriber = context.subscriber; isClosed = context.isClosed; enter(); await blocked;
      return { terminalSessionId: "terminal-1", unsubscribe() { releases += 1; } };
    }, write() { writes += 1; }
  });
  const socket = testSocket();
  handler(socket, { protocol: "https", headers: { host: "example.com", origin: "https://example.com" },
    ip: "10.0.0.8", params: { sessionId: "session-1", terminalSessionId: "terminal-1" },
    vibe64User: { email: "owner@example.com" } });
  await entered;
  assert.equal(isClosed(), false);
  socket.handlers.close(); socket.handlers.error();
  assert.equal(isClosed(), true);
  await socket.handlers.message(Buffer.from(JSON.stringify({ type: "input", data: "late" })));
  subscriber({ type: "terminal.output", line: "late" }); release();
  await delay(10);
  assert.equal(releases, 1);
  assert.equal(writes, 0);
  assert.deepEqual(socket.sent, []);
});

test("global Codex terminal stream and resize refuse a member without Codex access", async () => {
  const owner = { email: "owner@example.com", role: "owner" };
  const member = { email: "member@example.com", role: "member" };
  const codexCalls = [];
  const terminals = createServiceSessionTerminals({
    codex: { terminals: {
      subscribeGlobalTerminal(terminalSessionId) {
        codexCalls.push(["subscribe", terminalSessionId]);
        return { terminalSessionId, unsubscribe() {} };
      },
      resizeGlobalTerminal(terminalSessionId, size) {
        codexCalls.push(["resize", terminalSessionId, size.cols, size.rows]);
        return { ok: true };
      }
    } },
    sessionAgent: {
      async requireAssistantAccessForEngine(engineId, options) {
        assert.equal(engineId, "codex");
        if (options.vibe64User?.role !== "owner") {
          throw Object.assign(new Error("Only the workspace owner can use this personal AI connection."), {
            code: "vibe64_assistant_owner_required"
          });
        }
      }
    }
  });
  const app = testRouteApp();
  await withProjectRequestContext(async ({ projectContext, slug }) => {
    registerRoutes(app.http, { fastify: app.fastify, localhostCheckBypassed: false, projectContext, terminals });
    const route = app.registeredRoutes.find(({ path: routePath }) => routePath.endsWith("/codex-terminal/:terminalSessionId/ws"));
    const request = (vibe64User) => ({
      protocol: "https",
      headers: { host: "example.com", origin: "https://example.com" },
      ip: "10.0.0.8",
      params: { slug, terminalSessionId: "terminal-1" },
      vibe64User
    });

    const refused = testSocket();
    route.handler(refused, request(member));
    await waitForSocketMessages(refused, 1);
    assert.equal(refused.closed?.code, 1008);
    assert.equal(refused.sent[0].code, "vibe64_assistant_owner_required");
    assert.deepEqual(codexCalls, [], "a member never sees the terminal's snapshot or output");

    const watched = testSocket();
    route.handler(watched, request(owner));
    await waitForSocketMessages(watched, 1);
    assert.equal(watched.closed, null);
    assert.deepEqual(watched.sent, [{ session: { terminalSessionId: "terminal-1" }, type: "snapshot" }]);
    await watched.handlers.message(Buffer.from(JSON.stringify({ cols: 120, rows: 40, type: "resize" })));
    watched.handlers.close();
    assert.deepEqual(codexCalls, [["subscribe", "terminal-1"], ["resize", "terminal-1", 120, 40]]);
  });

  await assert.rejects(
    terminals.resizeGlobalCodexTerminal("terminal-1", { cols: 80, rows: 24 }, { vibe64User: member }),
    { code: "vibe64_assistant_owner_required" }
  );
  assert.equal(codexCalls.length, 2, "a member cannot resize the owner's terminal");
});
