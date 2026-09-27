import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createActions as createCurrentAppActions } from "../../packages/current-app/src/server/actions.js";
import { createActions as createHealthActions } from "../../packages/studio-health/src/server/actions.js";
import { registerRoutes as registerCurrentApp } from "../../packages/current-app/src/server/registerRoutes.js";
import { registerRoutes as registerHealth } from "../../packages/studio-health/src/server/registerRoutes.js";
import { findRegisteredRoute, routeProjectParams, testReply, testRouteApp, withLocalRequestBypass, withRouteProject } from "./vibe64RouteTestHelpers.js";

test("current-app and Studio Health inspections resolve current actor and their different project scopes", async () => {
  await withLocalRequestBypass(() => withRouteProject(async ({ apiRouteBase, projectContext, slug }) => {
    const app = testRouteApp();
    const actions = createActionCatalogue();
    let user = { uid: 42, username: "member", role: "member" };
    let allowed = true;
    let projectChecks = 0;
    const calls = [];
    const capture = (name) => async (input) => {
      calls.push({ name, input, slug: currentProjectRequestContext()?.slug });
      return { ok: true, inspection: name };
    };
    const definitions = [
      ...createCurrentAppActions({ currentApp: { inspectCurrentApp: capture("current-app") } }),
      ...createHealthActions({ studioHealth: { inspect: capture("health") } })
    ];
    actions.register({ contributorId: "inspection", domain: "inspection", actions: definitions.map((definition) => ({
      channels: ["api", "automation"], surfaces: ["app"], ...definition
    })) });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => user,
      async authorizeProject() { projectChecks += 1; if (!allowed) throw Object.assign(new Error("Project access revoked"), { statusCode: 403 }); }
    });
    registerCurrentApp(app.http, { projectContext, routeSurface: "app", routeRelativePath: "studio/current-app" });
    registerHealth(app.http);
    const direct = (actionId, input) => actions.execute({ actionId, input, context: { channel: "automation", surface: "app" } });
    const cases = [
      ["vibe64.current-app.read", `${apiRouteBase}/studio/current-app`, { sessionId: "session" }, { projectSlug: slug }],
      ["vibe64.studio-health.read", "/api/studio/health", {}, {}]
    ];
    for (const [actionId, path, input, scope] of cases) {
      const route = findRegisteredRoute(app, { method: "GET", path });
      assert.ok(route, path);
      const request = { params: scope.projectSlug ? routeProjectParams(slug) : {}, query: input, vibe64User: { uid: 666, role: "owner" } };
      request.executeAction = ({ actionId, input }) => actions.execute({ actionId, input,
        context: { channel: "api", surface: route.options.surface, requestMeta: { request } } });
      const reply = testReply();
      const before = calls.length;
      await route.handler(request, reply);
      assert.equal(reply.statusCode, 200);
      assert.deepEqual(await direct(actionId, { ...input, ...scope }), reply.payload);
      assert.deepEqual(calls[before], calls[before + 1]);
      assert.equal(calls[before].input.vibe64User, user);
      assert.equal(calls[before].slug, scope.projectSlug);
      const count = calls.length;
      await assert.rejects(direct(actionId, { ...input, ...scope, vibe64User: { role: "owner" } }), { code: "ACTION_VALIDATION_FAILED" });
      user = null;
      await assert.rejects(direct(actionId, { ...input, ...scope }), { statusCode: 401 });
      assert.equal(calls.length, count);
      user = { uid: 42, username: "member", role: "member" };
    }
    allowed = false;
    await assert.rejects(direct("vibe64.current-app.read", { projectSlug: slug }), { statusCode: 403 });
    const before = projectChecks;
    await direct("vibe64.studio-health.read", {});
    assert.equal(projectChecks, before, "Workspace health remains usable when a selected project is inaccessible.");
    await assert.rejects(direct("vibe64.studio-health.read", { projectSlug: slug }), { code: "ACTION_VALIDATION_FAILED" });
    assert.deepEqual(createServiceToolCatalog(actions).resolveToolSet({ surface: "app" }).tools, []);
  }));
});
