import assert from "node:assert/strict";
import { test } from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createSystemGraphActions } from "../../packages/vibe64-system-graph/src/server/actions.js";

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
    await withRouteProject(async ({ apiRouteBase, projectContext, slug }) => {
      const calls = [];
      const user = { username: "member", role: "member" };
      let allowed = true;
      const service = Object.fromEntries([
        "readSubsystems",
        "readStatus",
        "readMachineCity",
        "readProgramCity",
        "refresh"
      ].map((method) => [method, async (input) => {
        const project = currentProjectRequestContext();
        calls.push({ input, method, project: project.slug, actor: project.vibe64User });
        return { ok: true };
      }]));
      const app = testRouteApp();
      const actions = createActionCatalogue();
      actions.register({ contributorId: "graph", domain: "graph", actions: createSystemGraphActions({ systemGraph: service }).map((action) => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
      registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => user,
        async authorizeProject() { if (!allowed) throw Object.assign(new Error("Access revoked"), { statusCode: 403 }); }
      });
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
        ["GET", "/subsystems", "readSubsystems", "subsystems.read"],
        ["GET", "/status", "readStatus", "status.read"],
        ["GET", "/cities/machine", "readMachineCity", "machine.read"],
        ["GET", "/cities/program", "readProgramCity", "program.read"],
        ["POST", "/refresh", "refresh", "refresh"]
      ];
      for (const [method, suffix, serviceMethod, operation] of routes) {
        const route = findRegisteredRoute(app, {
          method,
          path: `${apiRouteBase}/vibe64/system-graph/sessions/:sessionId${suffix}`
        });
        assert.ok(route, `${method} ${suffix} was not registered`);
        const reply = testReply();
        const request = {
          params: routeProjectParams({ sessionId: "session-1" }),
          executeAction({ actionId, input }) {
            assert.equal(actionId, `vibe64.system-graph.${operation}`);
            return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request } } });
          }
        };
        const execute = (input = { sessionId: "session-1", projectSlug: slug }) => actions.execute({ actionId: `vibe64.system-graph.${operation}`, input, context: { channel: "automation", surface: "app" } });
        await route.handler(request, reply);
        assert.equal(reply.statusCode, 200);
        const fromHttp = calls.at(-1);
        assert.deepEqual(fromHttp, { method: serviceMethod, input: { sessionId: "session-1", vibe64User: user }, project: slug, actor: user });
        await execute();
        assert.deepEqual(calls.at(-1), fromHttp);
        const count = calls.length;
        allowed = false;
        await assert.rejects(route.handler(request, testReply()), { statusCode: 403 });
        await assert.rejects(execute(), { statusCode: 403 });
        assert.equal(calls.length, count);
        allowed = true;
        await assert.rejects(execute({ projectSlug: slug }), { code: "ACTION_VALIDATION_FAILED" });
        await assert.rejects(execute({ projectSlug: slug, sessionId: "session-1", vibe64User: { role: "owner" } }), { code: "ACTION_VALIDATION_FAILED" });
      }
      assert.equal(calls.length, 10);
      assert.equal(app.registeredRoutes.length, 5);
    });
  });
});
