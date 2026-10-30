import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";
import {
  routeProjectParams,
  testReply,
  testRouteApp,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

function projectRoutes(app, { projectContext = null, localRequestMessage, tags = ["studio", "unit-test"] } = {}) {
  return createActionRouteScope(vibe64RouteHttp(app.http, { tags }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({ localRequestMessage, projectContext })
  });
}

test("Vibe64 route scopes centralize route metadata and action dispatch", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      const routes = projectRoutes(app, { localRequestMessage: "Local only.", projectContext });

      routes.actionRoute("POST", "/sessions/:sessionId/action", {
        actionId: "unit.action",
        body: { type: "object" },
        bodyLimit: 123456,
        buildInput(request) {
          return {
            body: requestBody(request),
            query: requestQuery(request),
            sessionId: request.params.sessionId
          };
        },
        summary: "Run a unit action."
      });

      assert.equal(app.registeredRoutes.length, 1);
      const route = app.registeredRoutes[0];
      assert.equal(route.method, "POST");
      assert.equal(route.path, `${apiRouteBase}/vibe64/sessions/:sessionId/action`);
      assert.deepEqual(route.options, {
        actionId: "unit.action",
        auth: "public",
        surface: "app",
        meta: {
          summary: "Run a unit action.",
          tags: ["studio", "unit-test"]
        },
        body: { type: "object" },
        bodyLimit: 123456
      });

      const reply = testReply();
      await route.handler({
        body: {
          ignored: true
        },
        input: {
          body: {
            text: "from validator"
          },
          query: {
            page: "2"
          }
        },
        params: routeProjectParams({
          sessionId: "session-1"
        }),
        async executeAction(action) {
          return {
            action,
            ok: true
          };
        }
      }, reply);

      assert.equal(reply.statusCode, 200);
      assert.deepEqual(reply.payload.action, {
        actionId: "unit.action",
        input: {
          body: {
            text: "from validator"
          },
          query: {
            page: "2"
          },
          sessionId: "session-1"
        }
      });
    });
  });
});

test("Vibe64 route scopes support service response status overrides", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ projectContext }) => {
      const app = testRouteApp();
      const routes = projectRoutes(app, { projectContext });

      routes.serviceRoute("GET", "/missing", {
        failureStatus: 404,
        summary: "Read missing resource."
      }, () => {
        return {
          ok: false
        };
      });

      routes.serviceRoute("DELETE", "/close", {
        statusCode: 200,
        summary: "Close resource."
      }, () => {
        return {
          ok: false
        };
      });

      routes.serviceRoute("GET", "/forbidden", {
        failureStatus: 404,
        summary: "Read forbidden resource."
      }, () => {
        return {
          code: "unit_forbidden",
          ok: false,
          statusCode: 403
        };
      });

      routes.actionRoute("GET", "/created", {
        actionId: "unit.created",
        statusCode: (response) => response.created ? 201 : 200,
        summary: "Create a resource."
      });

      routes.serviceRoute("GET", "/plain-failure", { summary: "Fail without a status." }, () => ({ ok: false }));

      const missingReply = testReply();
      await app.registeredRoutes[0].handler({
        params: routeProjectParams()
      }, missingReply);
      assert.equal(missingReply.statusCode, 404);

      const closeReply = testReply();
      await app.registeredRoutes[1].handler({
        params: routeProjectParams()
      }, closeReply);
      assert.equal(closeReply.statusCode, 200);

      const forbiddenReply = testReply();
      await app.registeredRoutes[2].handler({
        params: routeProjectParams()
      }, forbiddenReply);
      assert.equal(forbiddenReply.statusCode, 403);

      const createdReply = testReply();
      await app.registeredRoutes[3].handler({
        params: routeProjectParams(),
        async executeAction() { return { ok: true, created: true }; }
      }, createdReply);
      assert.equal(createdReply.statusCode, 201);

      const plainFailureReply = testReply();
      await app.registeredRoutes[4].handler({ params: routeProjectParams() }, plainFailureReply);
      assert.equal(plainFailureReply.statusCode, 400);

      for (const route of app.registeredRoutes) {
        assert.equal(Object.hasOwn(route.options, "statusCode"), false, "status options stay with the handler");
        assert.equal(Object.hasOwn(route.options, "failureStatus"), false, "status options stay with the handler");
      }
    });
  });
});

test("Vibe64 route scopes can register global routes without project params", async () => {
  await withLocalRequestBypass(async () => {
    const app = testRouteApp();
    const routes = createActionRouteScope(vibe64RouteHttp(app.http), {
      relativePath: "vibe64/connections",
      surface: "app",
      wrapHandler: vibe64RouteHandler({ projectScoped: false })
    });

    routes.actionRoute("GET", "", {
      actionId: "unit.connections.read",
      summary: "Read global connections."
    });

    assert.equal(app.registeredRoutes.length, 1);
    const route = app.registeredRoutes[0];
    assert.equal(route.method, "GET");
    assert.equal(route.path, "/api/vibe64/connections");
    assert.deepEqual(route.options.meta, { tags: [], summary: "Read global connections." });

    const reply = testReply();
    await route.handler({
      params: {},
      async executeAction(action) {
        return {
          action,
          ok: true
        };
      }
    }, reply);

    assert.equal(reply.statusCode, 200);
    assert.deepEqual(reply.payload.action, {
      actionId: "unit.connections.read",
      input: {}
    });
  });
});

test("a Vibe64 route's project scope must match its path", () => {
  const app = testRouteApp();
  const global = createActionRouteScope(vibe64RouteHttp(app.http), {
    relativePath: "vibe64", surface: "app", wrapHandler: vibe64RouteHandler()
  });
  assert.throws(() => global.actionRoute("GET", "/status", { actionId: "unit.status.read" }),
    /GET \/api\/vibe64\/status is project-scoped, so it must be under \/api\/app\/:slug/u);
  const project = createActionRouteScope(vibe64RouteHttp(app.http), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE, relativePath: "vibe64", surface: "app",
    wrapHandler: vibe64RouteHandler({ projectScoped: false })
  });
  assert.throws(() => project.serviceRoute("GET", "/status", {}, () => ({ ok: true })),
    /\/api\/app\/:slug\/vibe64\/status is not project-scoped, so it must not be under \/api\/app\/:slug/u);
  assert.equal(app.registeredRoutes.length, 0);
  assert.throws(() => vibe64RouteHttp({}), /requires runtime\.http with router\.register/u);
});

test("Vibe64 routes refuse requests that are not from this computer before running anything", async () => {
  const app = testRouteApp();
  let ran = 0;
  const routes = projectRoutes(app, {
    localRequestMessage: "Local only.",
    projectContext: { async readWorkspaceProject() { ran += 1; return { project: {} }; } }
  });
  routes.actionRoute("GET", "/state", { actionId: "unit.state.read", summary: "Read state." });
  const reply = testReply();
  await app.registeredRoutes[0].handler({
    headers: { host: "studio.example.test", origin: "https://other.example.test" },
    ip: "10.0.0.8",
    params: routeProjectParams(),
    async executeAction() { ran += 1; return { ok: true }; }
  }, reply);
  assert.equal(reply.statusCode, 403);
  assert.deepEqual(reply.payload, {
    ok: false,
    errors: [{
      code: "studio_local_request_required",
      message: "Local only.",
      repairCommand: "Open Studio on localhost or 127.0.0.1."
    }]
  });
  assert.equal(ran, 0);
});

test("feature errors retain their JSON body while response hooks are asynchronous", async () => {
  await withLocalRequestBypass(async () => withRouteProject(async ({ apiBase, projectContext }) => {
    const app = testRouteApp();
    const routes = projectRoutes(app, { projectContext });
    const busy = { ok: false, code: "vibe64_agent_write_mode_busy", retryable: true,
      error: "The assistant is still reconnecting. Wait until it is ready, then try again." };
    routes.serviceRoute("GET", "/busy", {}, () => busy);
    routes.actionRoute("GET", "/busy-action", {
      actionId: "unit.busy.read", summary: "Read a busy action."
    });
    const actionReply = testReply();
    const actionRoute = app.registeredRoutes.find(route => route.path.endsWith("/busy-action"));
    await actionRoute.handler({
      params: routeProjectParams(), async executeAction() { return busy; }
    }, actionReply);
    assert.equal(actionReply.statusCode, 409);
    assert.deepEqual(actionReply.payload, busy);
    const server = Fastify();
    server.addHook("onSend", async (_request, _reply, payload) => {
      if (payload) await new Promise((resolve) => setImmediate(resolve));
      return payload;
    });
    for (const route of app.registeredRoutes) server.route({ method: route.method, url: route.path, handler: route.handler });
    try {
      const response = await server.inject({ method: "GET", url: `${apiBase}/vibe64/busy` });
      assert.equal(response.statusCode, 409);
      assert.equal(response.body, JSON.stringify(busy));
      const invalidProject = await server.inject({ method: "GET", url: "/api/app/bad!/vibe64/busy" });
      assert.equal(invalidProject.statusCode, 422);
      assert.equal(invalidProject.json().errors[0].code, "vibe64_invalid_project_slug");
    } finally {
      await server.close();
    }
  }));
});

test("a deleted practice project's page requests are a clean not-found with its code", async () => {
  await withLocalRequestBypass(async () => {
    const app = testRouteApp();
    let handled = 0;
    const routes = projectRoutes(app, {
      localRequestMessage: "Local only.",
      projectContext: {
        projectCatalogEnabled: true,
        projectsRoot: "/projects",
        async readWorkspaceProject() {
          throw Object.assign(new Error("This practice project was deleted. Its lesson is still in Learning."), {
            code: "vibe64_practice_project_deleted", statusCode: 404 });
        }
      }
    });
    routes.serviceRoute("GET", "/ping", { summary: "Ping." }, async () => { handled += 1; return { ok: true }; });
    const reply = testReply();
    await app.registeredRoutes[0].handler({ params: routeProjectParams() }, reply);
    assert.equal(reply.statusCode, 404);
    assert.equal(reply.payload.code, "vibe64_practice_project_deleted");
    assert.deepEqual(reply.payload.errors, [{ code: "vibe64_practice_project_deleted",
      message: "This practice project was deleted. Its lesson is still in Learning." }]);
    assert.equal(handled, 0);
  });
});
