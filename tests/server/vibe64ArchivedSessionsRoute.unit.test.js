// History asks GET .../sessions/archived for its newest sessions with only
// sessionLimit. The route once sent an absent page field to the action as "",
// which the action refuses as a whole number, so the plain read and History's
// own first page answered 400.
import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext, createVibe64ActionPolicy } from "@local/vibe64-core/server/actionContext";

import { createSessionActions } from "../../packages/vibe64-sessions/src/server/sessionActions.js";
import { createSessionCatalogue } from "../../packages/vibe64-sessions/src/server/sessionCatalogue.js";
import { registerRoutes } from "../../packages/vibe64-sessions/src/server/registerRoutes.js";
import { findRegisteredRoute, testRouteApp, withRouteProject } from "./vibe64RouteTestHelpers.js";

const owner = { username: "local", role: "owner" };

test("archived sessions read over HTTP with only the page fields the query names, and refuse a bad one", async () => {
  await withRouteProject(async ({ apiBase, apiRouteBase, projectContext }) => {
    const summaries = Array.from({ length: 45 }, (_, i) => ({ sessionId: `session-${String(i).padStart(2, "0")}`,
      status: "archived", archivedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
    const newestFirst = summaries.map(({ sessionId }) => sessionId).reverse();
    const catalogue = createSessionCatalogue({
      project: { createRuntimeWithoutSource: async () => ({ listSessionSummaries: async () => summaries.slice() }) },
      publishSessionChanged: async () => {},
      sessionPresence: { close() {} },
      terminals: {}
    });
    const actions = createActionCatalogue({ policy: createVibe64ActionPolicy({ localhostCheckBypassed: false }) });
    actions.register({ contributorId: "archived-pages", domain: "vibe64", actions: createSessionActions({ sessions: catalogue })
      .filter((action) => action.id === "vibe64.sessions.archived.list")
      .map((action) => ({ ...action, channels: ["api", "automation"], surfaces: ["app"] })) });
    registerVibe64ActionContext(actions, { projectContext,
      resolveUser: async ({ request }) => request?.vibe64User || owner, authorizeProject: async () => {} });
    const app = testRouteApp();
    registerRoutes(app.http, { localhostCheckBypassed: true, projectContext });
    const route = findRegisteredRoute(app, { method: "GET", path: `${apiRouteBase}/vibe64/sessions/archived` });
    assert.ok(route, "the archived sessions route is registered");

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
      const read = (query) => server.inject({ method: "GET", url: `${apiBase}/vibe64/sessions/archived${query}` });
      const ids = (response) => response.json().sessions.map(({ sessionId }) => sessionId);

      const first = await read("?sessionLimit=30");
      assert.equal(first.statusCode, 200, first.body);
      assert.deepEqual(ids(first), newestFirst.slice(0, 30), "History's first page: the newest 30");
      assert.equal(first.json().nextSessionOffset, 30);

      const next = await read("?sessionLimit=30&sessionOffset=30");
      assert.equal(next.statusCode, 200, next.body);
      assert.deepEqual(ids(next), newestFirst.slice(30));
      assert.equal(next.json().nextSessionOffset, null);

      const whole = await read("");
      assert.equal(whole.statusCode, 200, whole.body);
      assert.deepEqual(ids(whole), newestFirst, "without a page size the list stays complete");
      assert.equal(whole.json().sessionCount, undefined);

      for (const [query, field] of [["sessionLimit=0", "sessionLimit"], ["sessionLimit=abc", "sessionLimit"],
        ["sessionLimit=", "sessionLimit"], ["sessionLimit=30&sessionOffset=-1", "sessionOffset"]]) {
        const refused = await read(`?${query}`);
        assert.equal(refused.statusCode, 400, `${query}: ${refused.body}`);
        assert.equal(refused.json().code, "ACTION_VALIDATION_FAILED", query);
        assert.deepEqual(Object.keys(refused.json().fieldErrors), [field], query);
      }
    } finally {
      await server.close();
    }
  });
});
