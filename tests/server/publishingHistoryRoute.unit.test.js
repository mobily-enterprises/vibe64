// GET .../publishing/releases reads the page size from its query only when the
// query names one. An absent limit once reached the action as a field set to
// undefined, which the action's input refuses, so a plain history read
// answered 400.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { registerVibe64ActionContext, createVibe64ActionPolicy } from "@local/vibe64-core/server/actionContext";

import { createPublishingActions } from "../../packages/vibe64-publishing/src/server/publishingActions.js";
import { registerRoutes } from "../../packages/vibe64-publishing/src/server/registerRoutes.js";
import { createPublishingService } from "../../packages/vibe64-publishing/src/server/service.js";
import { createReleaseHistoryStore } from "../../packages/vibe64-publishing/src/server/state/releaseHistoryStore.js";
import { findRegisteredRoute, testRouteApp, withRouteProject } from "./vibe64RouteTestHelpers.js";

const owner = { username: "local", role: "owner" };

test("release history answers the default page without a limit, honours a valid limit and refuses a bad one", async () => {
  await withRouteProject(async ({ apiBase, apiRouteBase, projectContext, slug }) => {
    const runtimeRoot = path.join(projectContext.projectsRoot, ".runtime", slug);
    let clock = Date.parse("2026-10-23T10:00:00.000Z");
    const now = () => new Date(clock += 60_000).toISOString();
    const history = createReleaseHistoryStore({ runtimeRoot: path.join(runtimeRoot, "publishing"), now });
    for (let index = 0; index < 35; index += 1) await history.create({ kind: "dry-run", status: "succeeded" });
    const newestFirst = (await history.list({ limit: 35 })).map(({ id }) => id);

    const roots = Object.fromEntries(["personalRoot", "toolchainsRoot", "cacheRoot"]
      .map((name) => [name, path.join(projectContext.projectsRoot, ".publishing", name)]));
    const publishing = createPublishingService({ env: {}, logger: silentLogger, project: { readCurrentProject: async () => ({}) }, roots, now,
      runCommand: async () => { throw new Error("Reading release history runs no command."); } });
    const runtimeProjectContext = { ...projectContext, async readWorkspaceProject(options) {
      const result = await projectContext.readWorkspaceProject(options);
      return { ...result, project: { ...result.project, projectRuntimeRoot: runtimeRoot } };
    } };
    const actions = createActionCatalogue({ policy: createVibe64ActionPolicy({ localhostCheckBypassed: false }) });
    actions.register({ contributorId: "publishing", domain: "publishing", actions: createPublishingActions({ publishing }) });
    registerVibe64ActionContext(actions, { projectContext: runtimeProjectContext,
      resolveUser: async ({ request }) => request?.vibe64User || owner, authorizeProject: async () => {} });
    const app = testRouteApp();
    registerRoutes(app.http, { localhostCheckBypassed: true, projectContext: runtimeProjectContext, publishing });
    const route = findRegisteredRoute(app, { method: "GET", path: `${apiRouteBase}/vibe64/publishing/releases` });
    assert.ok(route, "the release history route is registered");

    const server = Fastify();
    server.decorateRequest("executeAction", function executeAction({ actionId, input }) {
      return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request: this } } });
    });
    server.addHook("preHandler", async (request) => { request.vibe64User = owner; });
    // The refusal with the fields it names, as the application's error handler answers it.
    server.setErrorHandler((error, _request, reply) => reply.code(error.statusCode || 500)
      .send({ code: error.code, fieldErrors: error.details?.fieldErrors || {} }));
    server.get(route.path, route.handler);
    try {
      const read = (query) => server.inject({ method: "GET", url: `${apiBase}/vibe64/publishing/releases${query}` });

      const plain = await read("");
      assert.equal(plain.statusCode, 200, plain.body);
      assert.deepEqual(plain.json().releases.map(({ id }) => id), newestFirst.slice(0, 30), "without a limit, the newest 30");

      const five = await read("?limit=5");
      assert.equal(five.statusCode, 200, five.body);
      assert.deepEqual(five.json().releases.map(({ id }) => id), newestFirst.slice(0, 5));

      for (const limit of ["", "0", "101", "2.5", "abc"]) {
        const refused = await read(`?limit=${limit}`);
        assert.equal(refused.statusCode, 400, `limit=${limit}: ${refused.body}`);
        assert.equal(refused.json().code, "ACTION_VALIDATION_FAILED", `limit=${limit}`);
        assert.deepEqual(Object.keys(refused.json().fieldErrors), ["limit"], `limit=${limit}`);
      }
    } finally {
      await server.close();
    }
  });
});
