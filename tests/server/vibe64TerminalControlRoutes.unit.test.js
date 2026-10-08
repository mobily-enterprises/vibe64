import assert from "node:assert/strict";
import test from "node:test";

import {
  registerRoutes as registerTerminalRoutes
} from "../../packages/vibe64-terminals/src/server/registerRoutes.js";
import {
  createTerminalActions,
  ACTION_CREATE_TEMPORARY_CONVERSATION,
  ACTION_START_TEMPORARY_CONVERSATION_TURN
} from "../../packages/vibe64-terminals/src/server/actions.js";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";

function registerRoutes(http, options) {
  const actions = createActionCatalogue();
  actions.register({ contributorId: "terminals", domain: "terminals", actions: createTerminalActions(options).map((action) => ({
    channels: ["api", "automation"], surfaces: ["app"], ...action
  })) });
  registerVibe64ActionContext(actions, { projectContext: options.projectContext,
    resolveUser: async ({ request }) => request?.vibe64User || { username: "owner", role: "owner" },
    authorizeProject: async () => {}
  });
  registerTerminalRoutes({ router: { register(method, path, routeOptions, handler) {
    http.router.register(method, path, routeOptions, (request, reply) => {
      request.executeAction ||= ({ actionId, input }) => actions.execute({ actionId, input,
        context: { channel: "api", surface: "app", requestMeta: { request } } });
      return handler(request, reply);
    });
  } } }, options);
}

function terminalControlRouteApp(service) {
  const registeredRoutes = [];
  const websocketRoutes = [];
  return {
    fastify: {
      get(path, options, handler) {
        websocketRoutes.push({
          handler,
          options,
          path
        });
      }
    },
    http: {
      router: {
        register(method, path, options, handler) {
          registeredRoutes.push({
            handler,
            method,
            options,
            path
          });
        }
      }
    },
    registeredRoutes,
    service,
    websocketRoutes
  };
}

async function runRoute(app, {
  body = {},
  method = "GET",
  path,
  params = {}
} = {}) {
  const route = findRegisteredRoute(app, {
    method,
    path
  });
  assert.ok(route, `Expected route ${method} ${path}`);
  const reply = testReply();
  await route.handler({
    input: {
      body
    },
    params
  }, reply);
  return reply;
}

test("terminal control routes expose snapshot, text checks, exact text, and narrow keys", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const writes = [];
      let output = "ready prompt";
      const createdAt = new Date(Date.now() - 4000).toISOString();
      const service = {
        closeAgentTerminal() {
          return {
            closed: true,
            ok: true
          };
        },
        async readAgentTerminal(_sessionId, terminalSessionId) {
          return {
            commandPreview: "codex",
            createdAt,
            id: terminalSessionId,
            inputVersion: writes.length,
            lastInputAt: "",
            lastOutputAt: createdAt,
            ok: true,
            output,
            outputVersion: 1,
            status: "running"
          };
        },
        async writeAgentTerminal(_sessionId, terminalSessionId, data) {
          writes.push({
            data,
            terminalSessionId
          });
          output += data;
          return this.readAgentTerminal(_sessionId, terminalSessionId);
        }
      };
      const app = terminalControlRouteApp(service);
      registerRoutes(app.http, {
        fastify: app.fastify,
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app",
        terminals: app.service,
        uploads: { readSingleMultipartFile() {} }
      });
      assert.equal(findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/command-terminal/:terminalSessionId/control/text`
      }), null);
      const path = `${apiRouteBase}/vibe64/sessions/:sessionId/agent-terminal/:terminalSessionId`;
      const params = routeProjectParams({
        sessionId: "session-1",
        terminalSessionId: "terminal-1"
      });

    const quiet = await runRoute(app, {
      method: "GET",
      params,
      path: `${path}/control/quiet`
    });
    assert.equal(quiet.statusCode, 200);
    assert.equal(quiet.payload.quiet, true);
    assert.equal(quiet.payload.quietThresholdMs, 3000);

    const check = await runRoute(app, {
      body: {
        text: "ready prompt"
      },
      method: "POST",
      params,
      path: `${path}/control/check-text`
    });
    assert.equal(check.statusCode, 200);
    assert.equal(check.payload.containsText, true);
    assert.equal(check.payload.checkedTextLength, "ready prompt".length);

    const text = await runRoute(app, {
      body: {
        text: "echo hi\n"
      },
      method: "POST",
      params,
      path: `${path}/control/text`
    });
    assert.equal(text.statusCode, 200);
    assert.deepEqual(writes.at(-1), {
      data: "echo hi\n",
      terminalSessionId: "terminal-1"
    });

    const key = await runRoute(app, {
      body: {
        key: "escape"
      },
      method: "POST",
      params,
      path: `${path}/control/key`
    });
    assert.equal(key.statusCode, 200);
    assert.deepEqual(writes.at(-1), {
      data: "\u001b",
      terminalSessionId: "terminal-1"
    });
    });
  });
});

test("assistant terminal control text uses the server Vibe64 user instead of body spoofing", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const app = terminalControlRouteApp({
        async writeAgentTerminal(sessionId, terminalSessionId, data, input) {
          calls.push({
            data,
            input,
            sessionId,
            terminalSessionId
          });
          return {
            id: terminalSessionId,
            ok: true,
            output: data,
            status: "running"
          };
        }
      });
      registerRoutes(app.http, {
        fastify: app.fastify,
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app",
        terminals: app.service,
        uploads: { readSingleMultipartFile() {} }
      });

      const serverUser = {
        email: "owner@example.com"
      };
      const route = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/agent-terminal/:terminalSessionId/control/text`
      });
      assert.ok(route, "Expected assistant terminal text route");
      const reply = testReply();

      await route.handler({
        input: {
          body: {
            attachmentIds: ["11111111-1111-4111-8111-111111111111"],
            originId: "tab:owner",
            text: "Please push.\r",
            vibe64User: {
              email: "spoof@example.com"
            }
          }
        },
        params: routeProjectParams({
          sessionId: "session-1",
          terminalSessionId: "terminal-1"
        }),
        vibe64User: serverUser
      }, reply);

      assert.equal(reply.statusCode, 200);
      assert.deepEqual(calls, [
        {
          data: "Please push.\r",
          input: {
            attachmentIds: ["11111111-1111-4111-8111-111111111111"],
            originId: "tab:owner",
            sessionId: "session-1",
            terminalSessionId: "terminal-1",
            trackGitActor: true,
            vibe64User: serverUser
          },
          sessionId: "session-1",
          terminalSessionId: "terminal-1"
        }
      ]);
    });
  });
});

test("temporary AI creation and turns use the authenticated Vibe64 actor", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = terminalControlRouteApp({});
      registerRoutes(app.http, {
        fastify: app.fastify,
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app",
        terminals: app.service,
        uploads: { readSingleMultipartFile() {} }
      });
      const vibe64User = {
        displayName: "Ada Account",
        preferredName: "Ada",
        username: "ada"
      };
      const calls = [];
      const executeAction = async (action) => {
        calls.push(action);
        return { ok: true };
      };
      const createRoute = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/temporary-conversations`
      });
      const turnRoute = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/temporary-conversations/:conversationId/turns`
      });
      assert.ok(createRoute);
      assert.ok(turnRoute);

      await createRoute.handler({
        body: {
          vibe64User: { username: "spoofed" }
        },
        executeAction,
        params: routeProjectParams({ sessionId: "session-1" }),
        vibe64User
      }, testReply());
      await turnRoute.handler({
        body: {
          attachmentIds: ["22222222-2222-4222-8222-222222222222"],
          message: "Explain the failure.",
          vibe64User: { username: "spoofed" }
        },
        executeAction,
        params: routeProjectParams({
          conversationId: "conversation-1",
          sessionId: "session-1"
        }),
        vibe64User
      }, testReply());

      assert.deepEqual(calls, [
        {
          actionId: ACTION_CREATE_TEMPORARY_CONVERSATION,
          input: {
            sessionId: "session-1"
          }
        },
        {
          actionId: ACTION_START_TEMPORARY_CONVERSATION_TURN,
          input: {
            attachmentIds: ["22222222-2222-4222-8222-222222222222"],
            conversationId: "conversation-1",
            message: "Explain the failure.",
            sessionId: "session-1"
          }
        }
      ]);
    });
  });
});

test("Learning output registration retains original builders and exposes no manual terminal or unrelated routes", async () => {
  const calls = [];
  const service = {};
  const app = terminalControlRouteApp(service);
  const attemptId = "12345678-1234-4234-8234-123456789abc";
  registerTerminalRoutes(app.http, { fastify: app.fastify, learningScoped: true, routeSurface: "app", terminals: service,
    actions: { execute: async () => { throw new Error("This registration case does not grant practice authority."); } } });
  const base = "/api/learning/:learningAttemptId/vibe64/sessions/:sessionId";
  const expected = [
    ["GET", "/outputs"], ["POST", "/output-runs"], ["POST", "/output-runs/open"],
    ["POST", "/preview-identity"], ["POST", "/output-runs/:terminalSessionId/stop"],
    ["GET", "/output-runs/:terminalSessionId/terminal"], ["DELETE", "/output-runs/:terminalSessionId/terminal"],
    ["GET", "/output-results/:resultId"], ["POST", "/agent-session"]
  ];
  for (const [method, suffix] of expected)
    assert.ok(findRegisteredRoute(app, { method, path: `${base}${suffix}` }), `${method} ${suffix}`);
  assert.equal(app.registeredRoutes.length, expected.length);
  assert.equal(app.websocketRoutes.length, 1);
  assert.equal(app.websocketRoutes[0].path, `${base}/output-runs/:terminalSessionId/terminal/ws`);
  assert.equal(app.registeredRoutes.some(route => /agent-terminal|codex-terminal|temporary|attachment|control\//u.test(route.path)), false);
  await withLocalRequestBypass(async () => {
    const route = findRegisteredRoute(app, { method: "POST", path: `${base}/output-runs` });
    const request = { params: { learningAttemptId: attemptId, sessionId: "saved-initial" },
      input: { body: { outputTargetId: "app", forceRestart: true, learningAttemptId: "caller-attempt", vibe64User: { username: "invented" } } },
      executeAction(action) { calls.push(action); return { ok: true }; } };
    await route.handler(request, testReply());
    assert.deepEqual(calls, [{ actionId: "vibe64.terminals.output-target.start", input: {
      outputTargetId: "app", forceRestart: true, sessionId: "saved-initial", learningAttemptId: attemptId
    } }]);
  });
});

test("Learning output socket reauthorizes its exact tuple and refuses raw input and late attachment", async () => {
  const { runWithProjectRequestContext, currentProjectScopeKey } = await import("@local/vibe64-core/server/projectRequestContext");
  const { setTimeout: delay } = await import("node:timers/promises");
  const attemptId = "12345678-1234-4234-8234-123456789abc";
  const scope = { learningScope: { learnerId: "42", attemptId, noExercise: false } };
  const authorityCalls = [];
  const serviceCalls = [];
  let late = null;
  const app = terminalControlRouteApp({
    subscribeOutputTargetTerminal(sessionId, terminalSessionId, subscriber) {
      serviceCalls.push(["subscribe", sessionId, terminalSessionId, currentProjectScopeKey()]);
      subscriber({ type: "terminal.output", line: "ready" });
      return { id: terminalSessionId, unsubscribe() { serviceCalls.push(["unsubscribe"]); } };
    },
    resizeOutputTargetTerminal(sessionId, terminalSessionId, size) {
      serviceCalls.push(["resize", sessionId, terminalSessionId, size, currentProjectScopeKey()]); return { ok: true };
    }, writeOutputTargetTerminal() { throw new Error("Learning raw input reached the original PTY owner."); }
  });
  registerTerminalRoutes(app.http, { fastify: app.fastify, learningScoped: true, routeSurface: "app", terminals: app.service,
    actions: { async execute(operation) {
      authorityCalls.push(operation);
      if (late) { late.enter(); await late.promise; }
      // Controlled original internal grant wire. Original Core/saved-state
      // authorization is proved by its owning tests, not invented by this fixture.
      return { project: { ...scope, runLearningOperation: operation => runWithProjectRequestContext(scope, operation) } };
    } } });
  function socket() {
    const handlers = {}, sent = [];
    return { handlers, sent, readyState: 1, on(name, callback) { handlers[name] = callback; },
      send(value) { sent.push(JSON.parse(value)); }, close() { handlers.close?.(); } };
  }
  const request = { protocol: "https", headers: { host: "example.com", origin: "https://example.com" }, ip: "10.0.0.8",
    vibe64User: { uid: "42", username: "owner", role: "owner" }, params: { learningAttemptId: attemptId, sessionId: "saved-initial", terminalSessionId: "output-1" } };
  const active = socket(); app.websocketRoutes[0].handler(active, request);
  for (let index = 0; index < 20 && active.sent.length < 2; index += 1) await delay(5);
  assert.deepEqual(serviceCalls[0], ["subscribe", "saved-initial", "output-1", `learning:${JSON.stringify(["42", attemptId])}`]);
  assert.equal(active.sent.at(-1).type, "snapshot");
  await active.handlers.message(Buffer.from(JSON.stringify({ type: "resize", cols: 90, rows: 25 })));
  assert.equal(authorityCalls.length, 2);
  for (const operation of authorityCalls) {
    assert.equal(operation.actionId, "vibe64.sessions.conversation.context.read");
    assert.deepEqual(operation.input, { sessionId: "saved-initial", learningAttemptId: attemptId });
    assert.equal(operation.context.channel, "internal");
    assert.equal(operation.context.requestMeta.request, request);
  }
  assert.equal(serviceCalls.at(-1)[0], "resize");
  await active.handlers.message(Buffer.from(JSON.stringify({ type: "input", data: "arbitrary command" })));
  assert.equal(authorityCalls.length, 2);
  assert.match(active.sent.at(-1).error, /read-only console/);
  active.handlers.close(); assert.deepEqual(serviceCalls.at(-1), ["unsubscribe"]);
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  late = { enter, promise: new Promise(resolve => { release = resolve; }) };
  const abandoned = socket(); app.websocketRoutes[0].handler(abandoned, request);
  await entered; abandoned.handlers.close(); release(); await delay(10);
  assert.equal(serviceCalls.filter(([kind]) => kind === "subscribe").length, 1);
  assert.deepEqual(abandoned.sent, []);
});
