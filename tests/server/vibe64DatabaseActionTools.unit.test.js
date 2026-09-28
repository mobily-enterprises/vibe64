import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createDatabaseActions } from "../../packages/vibe64-database-tools/src/server/actions.js";
import { withRouteProject } from "./vibe64RouteTestHelpers.js";

async function withDatabaseTools(run) {
  await withRouteProject(async ({ projectContext, slug }) => {
    const state = {
      allowed: true, actor: { username: "member", role: "member" },
      result: {
        ok: true,
        connection: { developmentDatabaseScope: "session", password: "private-password", host: "private-host" },
        schema: { database: "catalogue", engine: "postgresql", refreshedAt: "2026-09-29T00:00:00.000Z",
          tables: [{ schema: "public", name: "private-table", columns: [{ name: "private-column" }] }] },
        activeQueries: [{ queryId: "query-1", readOnly: true, startedAt: "2026-09-29T00:01:00.000Z", cancellable: false,
          sql: "private-sql", connection: "private-driver" }],
        defaultQuery: "private-sql", workspace: { snippets: ["private-sql"] }, layout: "private-layout", rows: ["private-row"]
      }
    };
    const calls = [];
    const databaseTools = Object.fromEntries(["readState", "refreshSchema", "cancelQuery"].map((method) => [method, async (input) => {
      calls.push({ input, method, context: currentProjectRequestContext() });
      return state.result;
    }]));
    const actions = createActionCatalogue();
    actions.register({ contributorId: "database", domain: "database", actions: createDatabaseActions({ databaseTools })
      .map((action) => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => state.actor,
      authorizeProject() { if (!state.allowed) throw Object.assign(new Error("Access revoked"), { statusCode: 403 }); } });
    const catalog = createServiceToolCatalog(actions);
    const context = { channel: "automation", surface: "app" };
    const toolSet = catalog.resolveToolSet(context);
    const execute = (operation, input = {}) => {
      const tool = toolSet.tools.find(({ actionId }) => actionId === `vibe64.database.${operation}`);
      assert.ok(tool);
      assert.doesNotThrow(() => catalog.toOpenAiToolSchema(tool));
      return catalog.executeToolCall({ toolName: tool.name, toolSet, context,
        argumentsText: JSON.stringify({ projectSlug: slug, sessionId: "session-a", ...input }) });
    };
    await run({ actions, calls, execute, slug, state, toolSet });
  });
}

test("database control tools share native authority and project/session identity without disclosing SQL or connections", async () => {
  await withDatabaseTools(async ({ actions, calls, execute, slug, state, toolSet }) => {
    assert.deepEqual(toolSet.tools.map(({ actionId }) => actionId).sort(), [
      "vibe64.database.query.cancel", "vibe64.database.schema.refresh", "vibe64.database.state.read"
    ]);
    const summary = { database: "catalogue", engine: "postgresql", refreshedAt: state.result.schema.refreshedAt, objectCount: 1, schemaCount: 1 };
    const response = await execute("state.read");
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(response.result, { ok: true, schema: summary, developmentDatabaseScope: "session", queryCount: 1, queriesTruncated: false,
      activeQueries: [{ queryId: "query-1", readOnly: true, startedAt: state.result.activeQueries[0].startedAt, cancellable: false }] });
    assert.equal(JSON.stringify(response).includes("private"), false);
    const apiResult = await actions.execute({ actionId: "vibe64.database.state.read", input: { projectSlug: slug, sessionId: "session-a" },
      context: { channel: "api", surface: "app" } });
    assert.equal(apiResult, state.result, "the Database UI keeps its original full result");
    const refreshed = await execute("schema.refresh", { source: "user" });
    assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
    assert.deepEqual(refreshed.result, { ok: true, schema: summary });
    assert.equal(calls.at(-1).input.source, "user");
    for (const cancelled of [false, true]) {
      state.result = { ok: true, queryId: "query-1", cancelled };
      const stopped = await execute("query.cancel", { queryId: "query-1" });
      assert.equal(stopped.ok, true, JSON.stringify(stopped));
      assert.deepEqual(stopped.result, state.result, "cancellation is a receipt, not proof that execution settled");
      assert.equal(calls.at(-1).input.queryId, "query-1");
    }
    assert.equal(calls.every(({ input, context }) => input.vibe64User === state.actor && input.sessionId === "session-a" && context.slug === slug), true);
  });
});

test("database tool summaries bound activity and metadata and keep native failure details in the UI", async () => {
  await withDatabaseTools(async ({ execute, state }) => {
    state.result.schema.database = "D".repeat(600);
    state.result.activeQueries = Array.from({ length: 51 }, (_, index) => ({
      queryId: `query-${index}`, readOnly: false, startedAt: "2026-09-29T00:01:00.000Z", cancellable: true
    }));
    let response = await execute("state.read");
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.result.schema.database.length, 512);
    assert.equal(response.result.queryCount, 51);
    assert.equal(response.result.queriesTruncated, true);
    assert.equal(response.result.activeQueries.length, 50);
    assert.equal(response.result.activeQueries.at(-1).queryId, "query-49");
    state.result.activeQueries = [];
    response = await execute("state.read");
    assert.equal(response.result.queryCount, 0);
    assert.equal(response.result.queriesTruncated, false);
    assert.deepEqual(response.result.activeQueries, []);
    state.result = { ok: false, code: "driver_failed", error: "private-sql and private-connection" };
    for (const operation of ["state.read", "schema.refresh", "query.cancel"]) {
      response = await execute(operation, operation === "query.cancel" ? { queryId: "query-1" } : {});
      assert.equal(response.ok, true, JSON.stringify(response));
      assert.equal(response.result.ok, false);
      assert.equal(response.result.code, "driver_failed");
      assert.equal(JSON.stringify(response).includes("private"), false);
    }
  });
});

test("database controls reject missing identity, SQL and forged authority before services and recheck revoked access", async () => {
  await withDatabaseTools(async ({ calls, execute, state }) => {
    for (const operation of ["state.read", "schema.refresh", "query.cancel"]) {
      const input = operation === "query.cancel" ? { queryId: "query-1" } : {};
      for (const invalid of [{ sessionId: undefined }, { vibe64User: { role: "owner" } }, { sourceRoot: "/private" }, { sql: "select 1" }]) {
        assert.equal((await execute(operation, { ...input, ...invalid })).ok, false, `${operation}: ${JSON.stringify(invalid)}`);
      }
    }
    assert.equal((await execute("query.cancel")).ok, false);
    assert.equal(calls.length, 0);
    state.allowed = false;
    for (const operation of ["state.read", "schema.refresh", "query.cancel"]) {
      assert.equal((await execute(operation, operation === "query.cancel" ? { queryId: "query-1" } : {})).ok, false);
    }
    assert.equal(calls.length, 0);
  });
});
