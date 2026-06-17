import assert from "node:assert/strict";
import test from "node:test";

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
      const routes = createVibe64FeatureRoutes(app, {
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
      const routes = createVibe64FeatureRoutes(app, {
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
    });
  });
});

test("Vibe64 feature routes can register global routes without project params", async () => {
  await withLocalRequestBypass(async () => {
    const app = testRouteApp();
    const routes = createVibe64FeatureRoutes(app, {
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
