import assert from "node:assert/strict";
import test from "node:test";

import { createAiStudioFeatureRoutes } from "@local/ai-studio-core/server/featureRoutes";
import {
  testReply,
  testRouteApp,
  withLocalRequestBypass
} from "./aiStudioRouteTestHelpers.js";

test("AI Studio feature routes centralize route metadata and action dispatch", async () => {
  await withLocalRequestBypass(async () => {
    const app = testRouteApp();
    const routes = createAiStudioFeatureRoutes(app, {
      localRequestMessage: "Local only.",
      routeRelativePath: "ai-studio",
      routeSurface: "home",
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
    assert.equal(route.path, "/api/ai-studio/sessions/:sessionId/action");
    assert.equal(route.options.auth, "public");
    assert.equal(route.options.surface, "home");
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
      params: {
        sessionId: "session-1"
      },
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

test("AI Studio feature routes support service response status overrides", async () => {
  await withLocalRequestBypass(async () => {
    const app = testRouteApp();
    const routes = createAiStudioFeatureRoutes(app, {
      routeRelativePath: "ai-studio",
      routeSurface: "home",
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
    await app.registeredRoutes[0].handler({}, missingReply);
    assert.equal(missingReply.statusCode, 404);

    const closeReply = testReply();
    await app.registeredRoutes[1].handler({}, closeReply);
    assert.equal(closeReply.statusCode, 200);
  });
});
