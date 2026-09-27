import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createDatabaseActions } from "../../packages/vibe64-database-tools/src/server/actions.js";
import { registerRoutes } from "../../packages/vibe64-database-tools/src/server/registerRoutes.js";
import { findRegisteredRoute, routeProjectParams, testReply, testRouteApp, withLocalRequestBypass, withRouteProject } from "./vibe64RouteTestHelpers.js";

test("all ordinary database HTTP operations execute their authorized action and retain required inputs", async () => {
  await withLocalRequestBypass(() => withRouteProject(async ({ apiRouteBase, projectContext, slug }) => {
    const cases = [
      ["GET", "", "state.read", "readState", {}],
      ["POST", "/schema/refresh", "schema.refresh", "refreshSchema", { source: "user" }],
      ["POST", "/queries", "query.run", "runQuery", { queryId: "query-1", sql: "select 1", readOnly: true }],
      ["POST", "/queries/:queryId/cancel", "query.cancel", "cancelQuery", { queryId: "query-1" }],
      ["PATCH", "/cells", "cell.update", "updateCell", { edit: { table: "items" }, value: null }],
      ["POST", "/rows", "row.insert", "insertRow", { table: { name: "items" }, values: { name: "Apples" } }],
      ["POST", "/rows/delete", "row.delete", "deleteRow", { table: { name: "items" }, key: { id: 1 }, confirmed: true }],
      ["POST", "/lookups/search", "lookup.search", "searchLookup", { relationshipId: "fk-1", search: "Apple" }],
      ["PUT", "/layout", "layout.save", "saveLayout", { layout: { nodes: [] } }],
      ["PUT", "/overview", "overview.save", "saveOverview", { definition: { actors: [] } }],
      ["PUT", "/snippets", "snippet.save", "saveSnippet", { snippet: { sql: "select 1" } }],
      ["DELETE", "/snippets/:snippetId", "snippet.delete", "deleteSnippet", { snippetId: "snippet-1" }],
      ["POST", "/assistant", "assistant.ask", "askAssistant", { messages: [{ role: "user", text: "Explain the schema" }] }]
    ];
    const calls = [];
    let allowed = true;
    let result = { ok: true };
    const user = { uid: 42, username: "member", role: "member" };
    const databaseTools = Object.fromEntries(cases.map(([, , , method]) => [method, async (input) => {
      calls.push({ method, input, project: currentProjectRequestContext().slug });
      return result;
    }]));
    const actions = createActionCatalogue();
    actions.register({ contributorId: "database", domain: "database", actions: createDatabaseActions({ databaseTools })
      .map((action) => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => user,
      authorizeProject: async () => { if (!allowed) throw Object.assign(new Error("Revoked"), { statusCode: 403 }); } });
    const app = testRouteApp();
    registerRoutes(app.http, { projectContext, routeRelativePath: "vibe64", routeSurface: "app" });
    assert.equal(createServiceToolCatalog(actions).resolveToolSet({ surface: "app" }).tools.length, 0,
      "Database engineering is not exposed to Colleague just because it has an action");
    for (const [method, suffix, operation, serviceMethod, input] of cases) {
      const actionId = `vibe64.database.${operation}`;
      const route = findRegisteredRoute(app, { method, path: `${apiRouteBase}/vibe64/database/sessions/:sessionId${suffix}` });
      assert.ok(route, operation);
      let actionInput;
      const request = {
        params: routeProjectParams({ sessionId: "session-1", queryId: "query-1", snippetId: "snippet-1" }),
        input: { body: { ...input, vibe64User: { role: "owner" }, sessionId: "forged-session" } },
        vibe64User: user,
        executeAction({ actionId: dispatched, input }) {
          assert.equal(dispatched, actionId);
          assert.equal(Object.hasOwn(input, "vibe64User"), false);
          actionInput = input;
          return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request } } });
        }
      };
      const reply = testReply();
      await route.handler(request, reply);
      assert.equal(reply.payload.ok, true, operation);
      const http = calls.at(-1);
      assert.deepEqual(http, { method: serviceMethod, input: { ...input, sessionId: "session-1", vibe64User: user }, project: slug });
      await actions.execute({ actionId, input: { ...actionInput, projectSlug: slug }, context: { channel: "automation", surface: "app" } });
      assert.deepEqual(calls.at(-1), http);
      const before = calls.length;
      allowed = false;
      await assert.rejects(route.handler(request, testReply()), { statusCode: 403 });
      await assert.rejects(actions.execute({ actionId, input: { ...actionInput, projectSlug: slug }, context: { channel: "automation", surface: "app" } }), { statusCode: 403 });
      assert.equal(calls.length, before);
      allowed = true;
      if (serviceMethod === "updateCell") {
        result = { ok: false, code: "vibe64_database_edit_conflict", error: "The cell changed." };
        const conflict = testReply();
        await route.handler(request, conflict);
        assert.equal(conflict.statusCode, 409);
        assert.deepEqual(conflict.payload, result);
        result = { ok: true };
      }
    }
    for (const input of [
      { projectSlug: slug, sessionId: "session-1", queryId: "query-1", sql: "select 1" },
      { projectSlug: slug, queryId: "query-1", sql: "select 1", readOnly: true },
      { projectSlug: slug, sessionId: "session-1", queryId: "query-1", sql: "select 1", readOnly: true, vibe64User: { role: "owner" } }
    ]) await assert.rejects(actions.execute({ actionId: "vibe64.database.query.run", input,
      context: { channel: "automation", surface: "app" } }), { code: "ACTION_VALIDATION_FAILED" });
    assert.equal(calls.length, 27);
  }));
});
