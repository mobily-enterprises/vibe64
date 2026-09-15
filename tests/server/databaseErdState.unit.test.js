import assert from "node:assert/strict";
import test from "node:test";
import { actorKey, readErdLayout, readWorkspace, saveErdLayout, saveSnippet } from "../../packages/vibe64-database-tools/src/server/sessionState.js";
import { createService } from "../../packages/vibe64-database-tools/src/server/service.js";
import { createDatabaseLayoutChangedPublisher } from "../../packages/vibe64-database-tools/src/server/events.js";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { dataOverviewSchema } from "../fixtures/dataOverviewSchema.js";
import { inspectErdLayout } from "../../packages/vibe64-database-tools/src/server/erdLayout.js";

function stateStore() {
  const records = new Map();
  return {
    async readArtifact(session, path) { return records.get(`${session}:${path}`) || ""; },
    async writeJsonArtifact(session, path, value) { records.set(`${session}:${path}`, JSON.stringify(value)); }
  };
}
test("ERD positions, views, groups, pins and focus are shared across users, not sessions", async () => {
  const store = stateStore();
  const actor = { username: "owner" };
  const diagram = {
    nodes: [{ table: "public.orders", x: 240, y: 160, pinned: true, expanded: true, group: "sales" }],
    groups: [{ id: "sales", name: "Sales" }], columnMode: "all", focusTable: "public.orders", activeGroup: "sales",
    viewport: { x: -25, y: 15, zoom: 0.7 }
  };
  const saved = await saveErdLayout(store, "session", { ...diagram, views: [{ ...diagram, id: "overview", name: "Sales overview" }] });
  assert.deepEqual(await readErdLayout(store, "session", actor), saved);
  assert.equal(saved.nodes[0].pinned, true);
  assert.equal(saved.views[0].nodes[0].expanded, true);
  assert.equal(saved.views[0].groups[0].name, "Sales");
  assert.equal(saved.views[0].viewport.zoom, 0.7);
  assert.deepEqual(await readErdLayout(store, "session", { username: "other" }), saved);
  assert.equal(saved.revision, 1);
  assert.equal((await readErdLayout(store, "other-session", actor)).nodes.length, 0);
});
test("ERD normalization bounds stored fields and uses keys mode for an empty workspace", async () => {
  const store = stateStore();
  assert.equal((await readErdLayout(store)).columnMode, "keys");
  const saved = await saveErdLayout(store, "session", { nodes: [{ table: "t", x: Infinity, y: -Infinity }], views: [{ id: "a", name: "a", viewport: { zoom: 100 } }], columnMode: "invalid" });
  assert.equal(saved.nodes[0].x, 0);
  assert.equal(saved.nodes[0].y, 0);
  assert.equal(saved.views[0].viewport.zoom, 1.8);
  assert.equal(saved.columnMode, "keys");
  const longGroup = `erd-auto:${"schema_name.".repeat(10)}table`;
  assert.equal((await saveErdLayout(store, "session", { activeGroup: longGroup })).activeGroup, longGroup);
  await assert.rejects(saveErdLayout(store, "session", { nodes: Array.from({ length: 2001 }, () => ({ table: "t" })) }), { code: "vibe64_database_erd_layout_too_large" });
});

test("an existing user's layout is adopted once without losing the old artifact", async () => {
  const store = stateStore();
  const alice = { username: "alice" };
  const bob = { username: "bob" };
  const oldPath = `database/erd-layout-${actorKey(alice)}.json`;
  await store.writeJsonArtifact("session", oldPath, { nodes: [{ table: "orders", x: 100, y: 200 }] });
  await store.writeJsonArtifact("session", `database/erd-layout-${actorKey(bob)}.json`, { nodes: [{ table: "orders", x: 900, y: 900 }] });
  const adopted = await readErdLayout(store, "session", alice);
  assert.equal(adopted.revision, 1);
  assert.equal(adopted.nodes[0].x, 100);
  assert.deepEqual(await readErdLayout(store, "session", bob), adopted);
  const moved = await saveErdLayout(store, "session", { ...adopted, nodes: [{ table: "orders", x: 500, y: 400 }] });
  assert.equal(moved.revision, 2);
  assert.deepEqual(await readErdLayout(store, "session", alice), moved);
  assert.equal(JSON.parse(await store.readArtifact("session", oldPath)).nodes[0].x, 100);
  await saveSnippet(store, "session", alice, { name: "Private SQL", sql: "SELECT 1" });
  assert.equal((await readWorkspace(store, "session", bob)).snippets.length, 0);
});

test("shared saves serialize and assign revisions in persisted order", async () => {
  const store = stateStore();
  const layouts = await Promise.all([1, 2, 3].map((x) => saveErdLayout(store, "session", { nodes: [{ table: "orders", x, y: 0 }] })));
  assert.deepEqual(layouts.map((layout) => layout.revision), [1, 2, 3]);
  assert.deepEqual(await readErdLayout(store, "session"), layouts[2]);
});

test("agent ERD moves retain exact routed paths, reject stale batches and preserve unrelated state", async () => {
  const store = stateStore();
  const schema = dataOverviewSchema();
  await store.writeJsonArtifact("session", "database/schema.json", schema);
  store.readSession = async (sessionId) => ({ sessionId });
  const published = [];
  const service = createService({
    projectService: {
      createSessionStore: async () => store,
      sessionDatabaseEnvironment: async () => ({ databaseToolEnvironment: {
        contract: "vibe64.database-tool-environment.v1", kind: "postgresql",
        read: { host: "127.0.0.1", port: 5432, database: schema.database, username: "reader" },
        write: { host: "127.0.0.1", port: 5432, database: schema.database, username: "writer" }
      } })
    },
    withKnex: () => assert.fail("Layout inspection and movement cannot query records"),
    publishLayoutChanged: async (id) => published.push(id)
  });
  const saved = await saveErdLayout(store, "session", {
    nodes: schema.tables.map((table, i) => ({ table: table.qualifiedName, x: i * 600, y: i * 100, pinned: i === 0 })),
    groups: [{ id: "bookkeeping", name: "Bookkeeping" }],
    views: [{ id: "original", name: "Original", nodes: [] }], viewport: { x: 20, y: 40, zoom: .6 }
  });
  const before = await service.readErd({ sessionId: "session" });
  assert.equal(before.ok, true, JSON.stringify(before));
  assert.equal(before.connections.length, schema.relationships.length);
  assert.ok(before.connections.every((route) => route.points.length >= 2 && route.length > 0));
  assert.deepEqual(before.connections[0].parent, { table: "public.contacts", column: "id" });
  assert.equal(before.nodes[0].width, 296);
  assert.equal(before.nodes[0].pinned, true);
  const changes = { revision: before.revision, moves: [{ table: "public.addresses", x: 400, y: 0 }] };
  const moved = await service.moveErdTables({ sessionId: "session", changes });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  assert.equal(moved.revision, before.revision + 1);
  assert.equal(moved.nodes[1].x, 400);
  assert.ok(moved.connections[0].length < before.connections[0].length);
  const current = await readErdLayout(store, "session");
  assert.deepEqual(current.views, saved.views);
  assert.deepEqual(current.groups, saved.groups);
  assert.deepEqual(current.viewport, saved.viewport);
  assert.deepEqual(current.nodes[0], saved.nodes[0]);
  assert.deepEqual(inspectErdLayout(schema, current).inspection.connections, moved.connections);
  const reopened = await service.readErd({ sessionId: "session" });
  assert.deepEqual(reopened.connections, moved.connections);
  assert.equal((await service.moveErdTables({ sessionId: "session", changes })).code, "vibe64_database_erd_layout_conflict");
  assert.deepEqual(await readErdLayout(store, "session"), current);
  const pinned = await service.moveErdTables({ sessionId: "session", changes: {
    revision: moved.revision, moves: [{ table: "public.contacts", x: 200, y: 100 }]
  } });
  assert.equal(pinned.code, "vibe64_database_erd_table_pinned");
  const invalid = await service.moveErdTables({ sessionId: "session", changes: {
    revision: moved.revision, moves: [{ table: "public.addresses", x: 100, y: 100 }, { table: "other.missing", x: 0, y: 0 }]
  } });
  assert.equal(invalid.code, "vibe64_database_erd_moves_invalid");
  assert.deepEqual(await readErdLayout(store, "session"), current);
  assert.equal((await service.readErd({ sessionId: "session", vibe64User: { role: "member" } })).code, "vibe64_owner_required");
  const undo = await service.moveErdTables({ sessionId: "session", changes: { revision: moved.revision, moves: moved.previousMoves } });
  assert.equal(undo.ok, true);
  assert.deepEqual((await readErdLayout(store, "session")).nodes, saved.nodes);
  assert.deepEqual(published, ["session", "session"]);
  assert.equal((await readErdLayout(store, "other-session")).nodes.length, 0);
});

test("revision checks happen inside the serialized layout write", async () => {
  const store = stateStore();
  const saved = await saveErdLayout(store, "session", { nodes: [] });
  const results = await Promise.allSettled([1, 2].map((x) => saveErdLayout(store, "session", {
    nodes: [{ table: "t", x, y: 0 }]
  }, { expectedRevision: saved.revision })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "vibe64_database_erd_layout_conflict");
});

test("service publishes a scoped hint only after a successful shared save, without executing SQL", async () => {
  const store = stateStore();
  store.readSession = async (sessionId) => ({ sessionId, projectSlug: "ignored-session-slug" });
  const events = [];
  const service = createService({
    projectService: {
      createSessionStore: async () => store,
      sessionDatabaseEnvironment: async () => ({ databaseToolEnvironment: {
        contract: "vibe64.database-tool-environment.v1", kind: "postgresql",
        read: { host: "127.0.0.1", port: 5432, database: "test", username: "reader" },
        write: { host: "127.0.0.1", port: 5432, database: "test", username: "writer" }
      } })
    },
    withKnex: () => assert.fail("ERD persistence must not execute SQL"),
    publishLayoutChanged: createDatabaseLayoutChangedPublisher({ async publish(event) {
      assert.equal((await readErdLayout(store, "session", { username: "bob" })).nodes[0].x, 100);
      events.push(event);
    } })
  });
  const layout = { nodes: [{ table: "orders", x: 100, y: 200 }] };
  const result = await runWithProjectRequestContext({ slug: "project" }, () => service.saveLayout({
    sessionId: "session", vibe64User: { username: "alice", role: "owner" }, layout
  }));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.layout.revision, 1);
  assert.deepEqual(events[0].realtime, {
    audience: "all_clients", event: "vibe64.database.layout.changed",
    payload: { projectSlug: "project", sessionId: "session" }
  });
  assert.equal((await service.saveLayout({ sessionId: "session", vibe64User: { role: "member" }, layout })).code, "vibe64_owner_required");
  store.writeJsonArtifact = async () => { throw new Error("disk unavailable"); };
  assert.equal((await service.saveLayout({ sessionId: "session", layout })).ok, false);
  assert.equal(events.length, 1);
});
