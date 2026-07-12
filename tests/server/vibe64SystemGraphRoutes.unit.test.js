import assert from "node:assert/strict";
import { test } from "node:test";

import {
  registerRoutes
} from "../../packages/vibe64-system-graph/src/server/registerRoutes.js";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  testRouteApp,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

test("System graph registers the active-session-only API and forwards opaque keys", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const service = {
        async readStatus(input) {
          calls.push({ input, method: "readStatus" });
          return {
            ok: true,
            status: "current"
          };
        },
        async readEntity(input) {
          calls.push({ input, method: "readEntity" });
          return {
            ok: true
          };
        }
      };
      const app = testRouteApp();
      const make = app.make.bind(app);
      app.make = (token) => token === "feature.vibe64-system-graph.service" ? service : make(token);
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

      const expectedRoutes = [
        ["GET", "/status"],
        ["GET", "/overview"],
        ["GET", "/entities/:entityKey"],
        ["GET", "/entities/:entityKey/evidence"],
        ["GET", "/files/:fileKey/constellation"],
        ["GET", "/findings"],
        ["POST", "/updates"],
        ["GET", "/updates/:updateId/stream"],
        ["POST", "/findings/:findingId/accept"]
      ];
      for (const [method, suffix] of expectedRoutes) {
        assert.ok(findRegisteredRoute(app, {
          method,
          path: `${apiRouteBase}/vibe64/system-graph/sessions/:sessionId${suffix}`
        }), `${method} ${suffix} was not registered`);
      }

      const statusRoute = findRegisteredRoute(app, {
        method: "GET",
        path: `${apiRouteBase}/vibe64/system-graph/sessions/:sessionId/status`
      });
      const statusReply = testReply();
      await statusRoute.handler({
        params: routeProjectParams({
          sessionId: "session-1"
        })
      }, statusReply);
      assert.equal(statusReply.statusCode, 200);

      const entityRoute = findRegisteredRoute(app, {
        method: "GET",
        path: `${apiRouteBase}/vibe64/system-graph/sessions/:sessionId/entities/:entityKey`
      });
      await entityRoute.handler({
        params: routeProjectParams({
          entityKey: "opaque-key",
          sessionId: "session-1"
        })
      }, testReply());
      assert.deepEqual(calls, [{
        input: {
          sessionId: "session-1"
        },
        method: "readStatus"
      }, {
        input: {
          entityKey: "opaque-key",
          sessionId: "session-1"
        },
        method: "readEntity"
      }]);
    });
  });
});
