import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";
import {
  routeProjectParams,
  testReply,
  testRouteApp,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

test("Vibe64 feature routes centralize route metadata and action dispatch", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      const routes = createVibe64FeatureRoutes(app.http, {
        localRequestMessage: "Local only.",
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app",
        tags: ["studio", "unit-test"]
      });

    routes.actionRoute("POST", "/sessions/:sessionId/action", {
      actionId: "unit.action",
      body: { type: "object" },
      bodyLimit: 123456,
      buildInput(request) {
        return {
          body: routes.requestBody(request),
          sessionId: request.params.sessionId
        };
      },
      summary: "Run a unit action."
    });

    assert.equal(app.registeredRoutes.length, 1);
    const route = app.registeredRoutes[0];
    assert.equal(route.method, "POST");
    assert.equal(route.path, `${apiRouteBase}/vibe64/sessions/:sessionId/action`);
    assert.equal(route.options.auth, "public");
    assert.equal(route.options.surface, "app");
    assert.deepEqual(route.options.meta, {
      summary: "Run a unit action.",
      tags: ["studio", "unit-test"]
    });
    assert.deepEqual(route.options.body, { type: "object" });
    assert.equal(route.options.bodyLimit, 123456);

    const reply = testReply();
    await route.handler({
      body: {
        ignored: true
      },
      input: {
        body: {
          text: "from validator"
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
        sessionId: "session-1"
      }
    });
    });
  });
});

test("Vibe64 feature routes support service response status overrides", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ projectContext }) => {
      const app = testRouteApp();
      const routes = createVibe64FeatureRoutes(app.http, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app",
        tags: ["studio", "unit-test"]
      });

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
    });
  });
});

test("Vibe64 feature routes can register global routes without project params", async () => {
  await withLocalRequestBypass(async () => {
    const app = testRouteApp();
    const routes = createVibe64FeatureRoutes(app.http, {
      routeRelativePath: "vibe64/connections",
      routeSurface: "app",
      projectScoped: false
    });

    routes.actionRoute("GET", "", {
      actionId: "unit.connections.read",
      summary: "Read global connections."
    });

    assert.equal(app.registeredRoutes.length, 1);
    const route = app.registeredRoutes[0];
    assert.equal(route.method, "GET");
    assert.equal(route.path, "/api/vibe64/connections");

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

test("feature errors retain their JSON body while response hooks are asynchronous", async () => {
  await withLocalRequestBypass(async () => withRouteProject(async ({ apiBase, projectContext }) => {
    const app = testRouteApp();
    const routes = createVibe64FeatureRoutes(app.http, {
      projectContext, routeRelativePath: "vibe64", routeSurface: "app"
    });
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
    const routes = createVibe64FeatureRoutes(app.http, {
      localRequestMessage: "Local only.",
      projectContext: {
        projectCatalogEnabled: true,
        projectsRoot: "/projects",
        async readWorkspaceProject() {
          throw Object.assign(new Error("This practice project was deleted. Its lesson is still in Learning."), {
            code: "vibe64_practice_project_deleted", statusCode: 404 });
        }
      },
      routeRelativePath: "vibe64",
      routeSurface: "app"
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
