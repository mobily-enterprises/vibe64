import assert from "node:assert/strict";
import { test } from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

import { createSystemGraphActions } from "../../packages/vibe64-system-graph/src/server/actions.js";
import { registerUsageRoutes } from "../../packages/vibe64-system-graph/src/server/usageRoutes.js";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  testRouteApp,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

const USAGE_ROUTES = [
  ["GET", "/usage/entries", "readUsageEntries", "usage.entries.read", { query: { kind: "route", q: "sessions", cursor: "50", limit: "20", ignored: "x" } }, { kind: "route", q: "sessions", cursor: "50", limit: 20 }],
  ["GET", "/usage/web", "readUsageWeb", "usage.web.read", { query: { entryId: "entry:page:a.vue", mode: "calls", certainty: "exact", subsystemId: "directory:src", maxNodes: "300", _: "1" } }, { entryId: "entry:page:a.vue", mode: "calls", certainty: "exact", subsystemId: "directory:src", maxNodes: 300 }],
  ["GET", "/usage/function", "readUsageFunction", "usage.function.read", { query: { functionId: "fn:src/a.js#1:1" } }, { functionId: "fn:src/a.js#1:1" }],
  ["POST", "/usage/join", "joinUsage", "usage.join", { body: { functions: [{ path: "src/a.js", hash: "sha256:a", name: "", start: { line: 1, column: 1 } }], sessionId: "other" } }, { functions: [{ path: "src/a.js", hash: "sha256:a", name: "", start: { line: 1, column: 1 } }] }]
];

test("usage queries are System Graph read actions on session routes with Architecture's authority", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext, slug }) => {
      const calls = [];
      const user = { username: "member", role: "member" };
      let allowed = true;
      const service = Object.fromEntries(USAGE_ROUTES.map(([, , method]) => [method, async (input) => {
        calls.push({ method, input, project: currentProjectRequestContext().slug });
        return { ok: true };
      }]));
      const app = testRouteApp();
      const actions = createActionCatalogue();
      actions.register({ contributorId: "graph", domain: "graph", actions: createSystemGraphActions({ systemGraph: service }).map((action) => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
      registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => user,
        async authorizeProject() { if (!allowed) throw Object.assign(new Error("Access revoked"), { statusCode: 403 }); }
      });
      registerUsageRoutes({ router: { register(method, routePath, options, handler) { app.registeredRoutes.push({ handler, method, options, path: routePath }); } } }, {
        projectContext, routeRelativePath: "vibe64", routeSurface: "app"
      });
      assert.equal(app.registeredRoutes.length, USAGE_ROUTES.length);

      for (const [method, suffix, serviceMethod, operation, request, input] of USAGE_ROUTES) {
        const actionId = `vibe64.system-graph.${operation}`;
        const definition = actions.listDefinitions().find((action) => action.id === actionId);
        assert.equal(definition.kind, "query", `${actionId} is a read`);
        assert.equal(definition.extensions.assistant.exclude, true, `${actionId} is not offered to the assistant`);
        const route = findRegisteredRoute(app, { method, path: `${apiRouteBase}/vibe64/system-graph/sessions/:sessionId${suffix}` });
        assert.ok(route, `${method} ${suffix} was not registered`);
        assert.equal(route.options.surface, "app");
        if (method === "POST") assert.equal(route.options.bodyLimit, 1024 * 1024);
        const httpRequest = {
          params: routeProjectParams({ sessionId: "session-1" }),
          ...request,
          executeAction({ actionId: requested, input: actionInput }) {
            assert.equal(requested, actionId);
            return actions.execute({ actionId: requested, input: actionInput, context: { channel: "api", surface: "app", requestMeta: { request: httpRequest } } });
          }
        };
        const reply = testReply();
        await route.handler(httpRequest, reply);
        assert.equal(reply.statusCode, 200);
        assert.deepEqual(calls.at(-1), { method: serviceMethod, input: { sessionId: "session-1", ...input, vibe64User: user }, project: slug });
        allowed = false;
        await assert.rejects(route.handler(httpRequest, testReply()), { statusCode: 403 });
        allowed = true;
      }
      assert.equal(calls.length, USAGE_ROUTES.length);

      const invalid = (input) => actions.execute({ actionId: "vibe64.system-graph.usage.web.read", input: { projectSlug: slug, sessionId: "session-1", ...input }, context: { channel: "automation", surface: "app" } });
      await assert.rejects(invalid({ entryId: "entry:a", mode: "recording" }), { code: "ACTION_VALIDATION_FAILED" });
      await assert.rejects(invalid({ entryId: "entry:a", mode: "calls", maxNodes: 1001 }), { code: "ACTION_VALIDATION_FAILED" });
      await assert.rejects(invalid({ mode: "calls" }), { code: "ACTION_VALIDATION_FAILED" });
      await assert.rejects(actions.execute({ actionId: "vibe64.system-graph.usage.entries.read", input: { projectSlug: slug, sessionId: "session-1", q: "x".repeat(81) }, context: { channel: "automation", surface: "app" } }), { code: "ACTION_VALIDATION_FAILED" });
      await assert.rejects(actions.execute({ actionId: "vibe64.system-graph.usage.join", input: { projectSlug: slug, sessionId: "session-1", functions: [{ path: "a.js", hash: "h", name: "", start: { line: 0, column: 1 } }] }, context: { channel: "automation", surface: "app" } }), { code: "ACTION_VALIDATION_FAILED" });
      assert.equal(calls.length, USAGE_ROUTES.length, "rejected input never reaches the service");
    });
  });
});
