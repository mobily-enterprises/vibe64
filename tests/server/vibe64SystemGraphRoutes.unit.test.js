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

test("System graph exposes only native Genesis City status, reads, and synchronous refresh", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const service = Object.fromEntries([
        "readSubsystems",
        "readStatus",
        "readMachineCity",
        "readProgramCity",
        "refresh"
      ].map((method) => [method, async (input) => {
        calls.push({ input, method });
        return { ok: true };
      }]));
      const app = testRouteApp();
      const http = {
        router: {
          register(method, path, options, handler) {
            app.registeredRoutes.push({ handler, method, options, path });
          }
        }
      };
      registerRoutes(http, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app",
        systemGraph: service
      });

      const routes = [
        ["GET", "/subsystems", "readSubsystems"],
        ["GET", "/status", "readStatus"],
        ["GET", "/cities/machine", "readMachineCity"],
        ["GET", "/cities/program", "readProgramCity"],
        ["POST", "/refresh", "refresh"]
      ];
      for (const [method, suffix] of routes) {
        const route = findRegisteredRoute(app, {
          method,
          path: `${apiRouteBase}/vibe64/system-graph/sessions/:sessionId${suffix}`
        });
        assert.ok(route, `${method} ${suffix} was not registered`);
        const reply = testReply();
        await route.handler({
          params: routeProjectParams({ sessionId: "session-1" })
        }, reply);
        assert.equal(reply.statusCode, 200);
      }

      assert.deepEqual(calls, routes.map(([, , method]) => ({
        input: { sessionId: "session-1" },
        method
      })));
      assert.equal(app.registeredRoutes.length, 5);
    });
  });
});
