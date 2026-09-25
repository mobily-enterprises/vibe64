import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

import {
  ACTION_PREVIEW_MODEL_ROUTING,
  ACTION_READ_MODEL_ROUTING_WORKFLOWS,
  ACTION_READ_ACCOUNTS,
  ACTION_READ_ACCOUNT_AUTH_SESSION,
  ACTION_SAVE_GIT_IDENTITY,
  ACTION_SAVE_PERSONAL_AI_PROFILE
} from "../../packages/vibe64-accounts/src/server/actions.js";
import { registerRoutes } from "../../packages/vibe64-accounts/src/server/registerRoutes.js";
import { currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

function testAccountRouteRuntime() {
  const registeredRoutes = [];
  return {
    accounts: {
      async subscribeAuthTerminal() {
        return null;
      }
    },
    fastify: {
      get(path, options, handler) {
        registeredRoutes.push({ handler, method: "GET", options, path });
      }
    },
    http: {
      router: {
        register(method, path, options, handler) {
          registeredRoutes.push({ handler, method, options, path });
        }
      }
    },
    registeredRoutes
  };
}

test("workspace account terminal accepts authorization input without a selected project", async () => {
  const runtime = testAccountRouteRuntime();
  const calls = [];
  const vibe64User = { email: "owner@example.test", role: "owner" };
  const input = { sessionId: "claude-login", vibe64User };
  const denied = { ok: false, error: "Account access denied." };
  let allowAccess = true;
  runtime.accounts = {
    subscribeAuthTerminal(received, subscriber) {
      assert.deepEqual(received, input);
      assert.equal(currentProjectScopeKey(), "global");
      if (!allowAccess) return denied;
      subscriber({ type: "output", data: "Paste code here if prompted > " });
      return { id: received.sessionId, status: "running", unsubscribe() { calls.push("unsubscribe"); } };
    },
    writeAuthTerminal(received, data) {
      assert.deepEqual(received, input);
      assert.equal(currentProjectScopeKey(), "global");
      calls.push(["write", data]);
      return { ok: true };
    },
    resizeAuthTerminal(received, size) {
      assert.deepEqual(received, input);
      calls.push(["resize", size]);
      return { ok: true };
    }
  };
  registerRoutes(runtime.http, {
    accounts: runtime.accounts,
    fastify: runtime.fastify,
    projectScoped: false,
    routeRelativePath: "vibe64/accounts",
    routeSurface: "app"
  });
  const route = findRegisteredRoute(runtime, {
    method: "GET",
    path: "/api/vibe64/accounts/auth/:terminalSessionId/ws"
  });
  assert.ok(route);
  const sent = [];
  const socket = new EventEmitter();
  socket.readyState = 1;
  socket.send = (payload) => sent.push(JSON.parse(payload));
  socket.close = (code) => calls.push(["close", code]);
  const request = {
    headers: { host: "studio.example.test", origin: "https://studio.example.test" },
    ip: "10.0.0.8",
    params: { terminalSessionId: input.sessionId },
    vibe64User
  };
  route.handler(socket, request);
  await setImmediate();
  assert.deepEqual(sent, [
    { type: "output", data: "Paste code here if prompted > " },
    { type: "snapshot", session: { id: input.sessionId, status: "running" } }
  ]);
  socket.emit("message", Buffer.from(JSON.stringify({ type: "input", data: "test-code\r" })));
  socket.emit("message", Buffer.from(JSON.stringify({ type: "resize", cols: 100, rows: 30 })));
  await setImmediate();
  socket.emit("close");
  assert.deepEqual(calls, [["write", "test-code\r"], ["resize", { cols: 100, rows: 30 }], "unsubscribe"]);

  allowAccess = false;
  sent.length = 0;
  route.handler(socket, request);
  await setImmediate();
  assert.deepEqual(sent, [{ type: "error", error: denied.error }]);
  assert.deepEqual(calls.at(-1), ["close", 1008]);
});

test("accounts read route omits signed-in user in local editor mode", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const runtime = testAccountRouteRuntime();
      registerRoutes(runtime.http, {
        accounts: runtime.accounts,
        fastify: runtime.fastify,
        projectContext,
        routeRelativePath: "vibe64/accounts",
        routeSurface: "app"
      });

      const route = findRegisteredRoute(runtime, {
        method: "GET",
        path: `${apiRouteBase}/vibe64/accounts`
      });
      assert.ok(route);

      let executedAction = null;
      const reply = testReply();
      await route.handler({
        input: {
          query: {}
        },
        params: routeProjectParams(),
        async executeAction(action) {
          executedAction = action;
          return {
            accounts: [],
            ok: true
          };
        }
      }, reply);

      assert.equal(reply.statusCode, 200);
      assert.deepEqual(executedAction, {
        actionId: ACTION_READ_ACCOUNTS,
        input: {}
      });
    });
  });
});

test("accounts auth-session route preserves scoped slug params", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const runtime = testAccountRouteRuntime();
      registerRoutes(runtime.http, {
        accounts: runtime.accounts,
        fastify: runtime.fastify,
        projectContext,
        routeRelativePath: "vibe64/accounts",
        routeSurface: "app"
      });

      const route = findRegisteredRoute(runtime, {
        method: "GET",
        path: `${apiRouteBase}/vibe64/accounts/auth/:sessionId`
      });
      assert.ok(route);

      const paramsValidation = route.options.params.schema.patch(routeProjectParams({
        sessionId: "auth-session-1"
      }));
      assert.deepEqual(paramsValidation.errors, {});
      assert.equal(paramsValidation.validatedObject.slug, "unit_project");
      assert.equal(paramsValidation.validatedObject.sessionId, "auth-session-1");

      let executedAction = null;
      const reply = testReply();
      await route.handler({
        params: routeProjectParams({
          sessionId: "auth-session-1"
        }),
        async executeAction(action) {
          executedAction = action;
          return {
            account: {
              id: "codex"
            },
            id: "auth-session-1",
            ok: true,
            status: "authenticating"
          };
        }
      }, reply);

      assert.equal(reply.statusCode, 200);
      assert.deepEqual(executedAction, {
        actionId: ACTION_READ_ACCOUNT_AUTH_SESSION,
        input: {
          sessionId: "auth-session-1"
        }
      });
    });
  });
});

test("accounts git identity route preserves scoped user input", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const runtime = testAccountRouteRuntime();
      registerRoutes(runtime.http, {
        accounts: runtime.accounts,
        fastify: runtime.fastify,
        projectContext,
        routeRelativePath: "vibe64/accounts",
        routeSurface: "app"
      });

      const route = findRegisteredRoute(runtime, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/accounts/git-identity`
      });
      assert.ok(route);

      let executedAction = null;
      const reply = testReply();
      await route.handler({
        body: {
          gitUserEmail: "tony@example.test",
          gitUserName: "Tony"
        },
        params: routeProjectParams(),
        async executeAction(action) {
          executedAction = action;
          return {
            ok: true
          };
        }
      }, reply);

      assert.equal(reply.statusCode, 200);
      assert.deepEqual(executedAction, {
        actionId: ACTION_SAVE_GIT_IDENTITY,
        input: {
          gitUserEmail: "tony@example.test",
          gitUserName: "Tony"
        }
      });
    });
  });
});

test("accounts personal profile route accepts a standalone preferred name", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const runtime = testAccountRouteRuntime();
      registerRoutes(runtime.http, {
        accounts: runtime.accounts,
        fastify: runtime.fastify,
        projectContext,
        routeRelativePath: "vibe64/accounts",
        routeSurface: "app"
      });

      const route = findRegisteredRoute(runtime, {
        method: "PATCH",
        path: `${apiRouteBase}/vibe64/accounts/personal-ai-profile`
      });
      assert.ok(route);

      let executedAction = null;
      const reply = testReply();
      await route.handler({
        body: {
          preferredName: "Ada"
        },
        params: routeProjectParams(),
        async executeAction(action) {
          executedAction = action;
          return {
            ok: true,
            personalProfile: {
              available: true,
              preferredName: "Ada",
              scope: "installation",
              version: 1
            }
          };
        }
      }, reply);

      assert.equal(reply.statusCode, 200);
      assert.deepEqual(executedAction, {
        actionId: ACTION_SAVE_PERSONAL_AI_PROFILE,
        input: {
          preferredName: "Ada"
        }
      });
    });
  });
});

test("curated Codex routes use trusted request identity and accept only curated provider ids", async () => {
  await withLocalRequestBypass(async () => {
    const runtime = testAccountRouteRuntime();
    registerRoutes(runtime.http, { accounts: runtime.accounts, fastify: runtime.fastify,
      projectScoped: false, routeRelativePath: "vibe64/accounts", routeSurface: "app" });
    for (const [method, suffix] of [["GET", ""], ["PATCH", ""], ["POST", "/remove"]]) {
      const route = findRegisteredRoute(runtime, { method, path: `/api/vibe64/accounts/codex-providers${suffix}` });
      assert.ok(route);
      if (method !== "GET") {
        assert.notDeepEqual(route.options.body.schema.patch({ modelProviderId: "https://custom.invalid" }).errors, {});
        assert.deepEqual(route.options.body.schema.patch({ modelProviderId: "deepseek", apiKey: "fixture" }).errors, {});
      }
      let action;
      const member = { role: "member", username: "member" };
      await route.handler({ vibe64User: member,
        input: { body: { modelProviderId: "deepseek", apiKey: "fixture", vibe64User: { role: "owner" } } },
        async executeAction(value) { action = value; return { ok: true, providers: [] }; }
      }, testReply());
      assert.deepEqual(action.input.vibe64User, member);
      assert.ok(action.actionId);
    }
  });
});

test("routing draft preview uses trusted request identity and carries explicit helper review", async () => {
  await withLocalRequestBypass(async () => {
    const runtime = testAccountRouteRuntime();
    registerRoutes(runtime.http, { accounts: runtime.accounts, fastify: runtime.fastify,
      projectScoped: false, routeRelativePath: "vibe64/accounts", routeSurface: "app" });
    const route = findRegisteredRoute(runtime, { method: "POST", path: "/api/vibe64/accounts/model-routing/preview" });
    assert.ok(route);
    const body = { revision: 4, orchestrators: {}, reviewedHelperWorkflows: ["codex"], vibe64User: { role: "owner" } };
    assert.deepEqual(route.options.body.schema.patch(body).errors, {});
    for (const vibe64User of [{ role: "member", username: "member" }, undefined]) {
      let action;
      await route.handler({ vibe64User, input: { body },
        async executeAction(value) { action = value; return { ok: true }; }
      }, testReply());
      assert.equal(action.actionId, ACTION_PREVIEW_MODEL_ROUTING);
      assert.deepEqual(action.input.reviewedHelperWorkflows, ["codex"]);
      assert.deepEqual(action.input.vibe64User, vibe64User);
    }
  });
});

test("workflow choices use the lightweight action and trusted request identity", async () => {
  await withLocalRequestBypass(async () => {
    const runtime = testAccountRouteRuntime();
    registerRoutes(runtime.http, { accounts: runtime.accounts, fastify: runtime.fastify,
      projectScoped: false, routeRelativePath: "vibe64/accounts", routeSurface: "app" });
    const route = findRegisteredRoute(runtime, { method: "GET", path: "/api/vibe64/accounts/model-routing/workflows" });
    assert.ok(route);
    const member = { role: "member", username: "member" };
    let action;
    await route.handler({ vibe64User: member, input: { query: { vibe64User: { role: "owner" } } },
      async executeAction(value) { action = value; return { ok: true, workflows: [] }; }
    }, testReply());
    assert.equal(action.actionId, ACTION_READ_MODEL_ROUTING_WORKFLOWS);
    assert.deepEqual(action.input.vibe64User, member);
  });
});
