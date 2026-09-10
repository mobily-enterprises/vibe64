import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { dataOverviewCoverage, validateDataOverview } from "../../packages/vibe64-database-tools/src/shared/dataOverview.js";
import { dataOverviewGraph, routeOverviewEdges } from "../../packages/vibe64-database-tools/src/client/dataOverviewModel.js";
import { erdObstacles, erdPathClear } from "../../packages/vibe64-database-tools/src/client/erdRouting.js";
import { readDataOverview } from "../../packages/vibe64-database-tools/src/server/dataOverview.js";
import { createService } from "../../packages/vibe64-database-tools/src/server/service.js";
import { createService as createSourceEditor } from "../../packages/vibe64-source-editor/src/server/service.js";
import { bookingOverview, dataOverviewSchema } from "../fixtures/dataOverviewSchema.js";
import { denseErdSchema } from "../fixtures/denseErdSchema.js";

test("broad actors contain every physical table exactly once without rendering internal edges", () => {
  const schema = dataOverviewSchema();
  const definition = validateDataOverview(bookingOverview());
  const collapsed = dataOverviewGraph(schema, definition);
  assert.equal(collapsed.nodes.length, 4);
  assert.equal(collapsed.coverage.classified, 7);
  assert.deepEqual(collapsed.coverage.others, ["public.audit_log"]);
  assert.ok(!collapsed.edges.some((edge) => edge.data.relationships.some((rel) => rel.id === "invoice_groups_checklists")));
  assert.deepEqual(collapsed.groups.flatMap((group) => group.tables).sort(), schema.tables.map((table) => table.qualifiedName).sort());
  assert.ok(collapsed.groups.find((group) => group.table === "public.bookings").tables.includes("public.transactions"));
});

test("smaller actors keep boundary relationships and exact invoice-group endpoints and cardinalities", () => {
  const schema = dataOverviewSchema();
  const graph = dataOverviewGraph(schema, bookingOverview({ split: true }));
  const edge = graph.edges.find((edge) => edge.target === "actor:public.checklists");
  assert.equal(edge.source, "actor:public.bookings");
  assert.equal(edge.label, "1 : 0..N");
  assert.equal(edge.data.relationships[0].referencedTable, "public.invoice_groups");

});

test("multiple actual constraints between actors remain individually inspectable", () => {
  const schema = dataOverviewSchema();
  schema.relationships.push({ ...schema.relationships[2], id: "billing_contact", constraintName: "billing_contact", columns: ["billing_contact_id"] });
  const edge = dataOverviewGraph(schema, bookingOverview()).edges.find((entry) => entry.source === "actor:public.contacts" && entry.target === "actor:public.bookings");
  assert.equal(edge.label, "2 relationships");
  assert.equal(edge.data.relationships.length, 2);
  assert.equal(edge.data.relationships[1].cardinality.parent, "?..1");
});

test("collapsed card area grows with table count, never exceeding twice the smallest card", () => {
  const graph = dataOverviewGraph(dataOverviewSchema(), bookingOverview());
  const actors = graph.nodes.filter((node) => node.type === "actor").sort((a, b) => a.data.count - b.data.count);
  const areas = actors.map((node) => node.dimensions.width * node.dimensions.height);
  assert.ok(areas.at(-1) > areas[0]);
  assert.ok(areas.at(-1) / areas[0] <= 2);
  assert.deepEqual(areas, [...areas].sort((a, b) => a - b));
  const one = dataOverviewGraph(dataOverviewSchema(), { version: 1, actors: [] });
  assert.ok(Number.isFinite(one.nodes[0].dimensions.width));
  const missing = dataOverviewGraph({ tables: [] }, bookingOverview());
  assert.ok(missing.nodes.every((node) => Number.isFinite(node.dimensions.width)));
});

test("coverage preserves renamed/missing references and includes new and unclassified tables", () => {
  const schema = dataOverviewSchema();
  schema.tables = schema.tables.filter((table) => table.name !== "invoice_groups");
  const coverage = dataOverviewCoverage(schema, bookingOverview());
  assert.deepEqual(coverage.missing, ["public.invoice_groups"]);
  assert.deepEqual(coverage.others, ["public.audit_log"]);
  assert.equal(coverage.classified + coverage.others.length, coverage.total);
});

test("reviewed Other tables stay reviewed while new schema tables remain pending", () => {
  const schema = dataOverviewSchema();
  const definition = validateDataOverview({ ...bookingOverview(), abstraction: "high", reviewedTables: schema.tables.map((table) => table.qualifiedName) });
  assert.deepEqual(dataOverviewCoverage(schema, definition).unreviewed, []);
  assert.deepEqual(dataOverviewCoverage(schema, definition).others, ["public.audit_log"]);
  schema.tables.push({ name: "new_table", qualifiedName: "public.new_table" });
  assert.deepEqual(dataOverviewCoverage(schema, definition).unreviewed, ["public.new_table"]);
  const old = dataOverviewCoverage(schema, bookingOverview());
  assert.deepEqual(old.unreviewed, ["public.audit_log", "public.new_table"]);
  assert.throws(() => validateDataOverview({ ...definition, abstraction: "invented" }));
  assert.throws(() => validateDataOverview({ ...definition, reviewedTables: ["public.audit_log", "public.audit_log"] }));
  assert.throws(() => validateDataOverview({ ...definition, reviewedTables: [null] }));
});

test("not-abstract definitions support a separate actor for all 135 tables", () => {
  const tables = Array.from({ length: 135 }, (_, index) => `public.table_${index}`);
  const definition = validateDataOverview({ version: 1, abstraction: "none", reviewedTables: tables, actors: tables.map((table) => ({ table, name: table, description: "", tables: [table] })) });
  assert.equal(definition.actors.length, 135);
  assert.equal(dataOverviewCoverage({ tables: tables.map((qualifiedName) => ({ qualifiedName })) }, definition).unreviewed.length, 0);
});

test("logical rings place every actor exactly once and reject physical supporting tables as actors", () => {
  const value = { ...bookingOverview(), rings: [["public.contacts", "public.bookings"], ["public.dogs"]] };
  assert.deepEqual(validateDataOverview(value).rings, value.rings);
  for (const rings of [[["public.contacts"]], [["public.contacts", "public.bookings", "public.bookings"]], [["public.contacts", "public.bookings", "public.invoice_groups"]], [[]]]) {
    assert.throws(() => validateDataOverview({ ...value, rings }), /rings|ring/);
  }
});

test("overview routes avoid intervening actors instead of hiding a direct relation behind a card", () => {
  const nodes = ["contacts", "dogs", "bookings"].map((id, index) => ({ id, position: { x: index * 450, y: 0 }, dimensions: { width: 340, height: 152 } }));
  const [route] = routeOverviewEdges(nodes, [{ id: "direct", source: "contacts", target: "bookings" }]);
  assert.equal(route.obstructed, false);
  assert.equal(erdPathClear(route.points, erdObstacles(nodes, 48), "contacts", "bookings"), true);
});

test("overview connections face their neighbour in every direction and keep a clear corridor around other cards", () => {
  for (const [dx, dy, sourceSide, targetSide] of [[1200, 0, "right", "left"], [-1200, 0, "left", "right"], [0, 800, "bottom", "top"], [0, -800, "top", "bottom"]]) {
    const nodes = [
      { id: "source", position: { x: 0, y: 0 }, dimensions: { width: 340, height: 152 } },
      { id: "middle", position: { x: dx / 2, y: dy / 2 }, dimensions: { width: 340, height: 152 } },
      { id: "target", position: { x: dx, y: dy }, dimensions: { width: 340, height: 152 } }
    ];
    const [route] = routeOverviewEdges(nodes, [{ id: "link", source: "source", target: "target" }]);
    assert.equal(route.sourceHandle, `out-${sourceSide}`);
    assert.equal(route.targetHandle, `in-${targetSide}`);
    assert.equal(route.obstructed, false);
    assert.equal(erdPathClear(route.points, erdObstacles(nodes, 48), "source", "target"), true);
  }
});

test("strict definitions reject ambiguous membership, missing roots, oversized and malformed input", () => {
  for (const change of [
    (value) => { value.actors[1].tables.push("public.contacts"); },
    (value) => { value.actors[0].tables = ["public.addresses"]; },
    (value) => { value.actors[0].name = "x".repeat(121); },
    (value) => { value.actors[0].tables.push(null); },
    (value) => { value.version = 2; },
    (value) => { value.actors[0].sql = "SELECT 1"; }
  ]) { const value = bookingOverview(); change(value); assert.throws(() => validateDataOverview(value), /Data overview:/u); }
  assert.throws(() => validateDataOverview(null));
  assert.deepEqual(validateDataOverview({ version: 1, actors: [] }), { version: 1, actors: [] });
});

test("130-table overview creates only actor nodes and keeps complete membership", () => {
  const schema = denseErdSchema();
  const definition = { version: 1, actors: Array.from({ length: 13 }, (_, index) => ({
    name: `Actor ${index}`, table: `public.table_${index * 10}`, description: "Supporting tables", tables: schema.tables.slice(index * 10, index * 10 + 10).map((table) => table.qualifiedName)
  })) };
  const collapsed = dataOverviewGraph(schema, definition);
  assert.equal(collapsed.nodes.length, 13);
  assert.deepEqual(collapsed.groups.flatMap((group) => group.tables).sort(), schema.tables.map((table) => table.qualifiedName).sort());
  assert.equal(schema.relationships.length, 479);
});

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "data-overview-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const source = path.join(root, "sessions/active/test/source");
  await mkdir(source, { recursive: true });
  const session = { sessionId: "test", metadata: { source_kind: "session_clone", source_path: source, source_path_authority: "managed_session_source" } };
  return { root, source, session, file: path.join(source, "data-overview.json") };
}

test("read source definition safely; missing, invalid, oversized and symlink files do not hide the database", async (t) => {
  const { root, file, session } = await fixture(t);
  assert.equal((await readDataOverview(session)).present, false);
  await writeFile(file, JSON.stringify(bookingOverview()));
  assert.equal((await readDataOverview(session)).definition.actors.length, 3);
  await writeFile(file, "broken");
  const invalid = await readDataOverview(session);
  assert.ok(invalid.error); assert.ok(invalid.hash); assert.equal(invalid.definition.actors.length, 0);
  await writeFile(file, "x".repeat(256 * 1024 + 1));
  assert.match((await readDataOverview(session)).error, /256 KiB/u);
  await rm(file);
  const outside = path.join(root, "outside.json");
  await writeFile(outside, JSON.stringify(bookingOverview()));
  await symlink(outside, file);
  assert.ok((await readDataOverview(session)).error);
  assert.equal((await readDataOverview(session)).definition.actors.length, 0);
});

test("real source-editor persistence creates complete JSON, detects stale edits and isolates sessions without SQL", async (t) => {
  const { root, file, session } = await fixture(t);
  const schema = dataOverviewSchema();
  const events = [];
  const projectService = {
    createRuntime: async () => ({ getSession: async () => session, store: { runSessionExclusive: async (_id, _lock, operation) => ({ acquired: true, value: await operation() }) } }),
    createSessionStore: async () => ({ readSession: async () => session, readArtifact: async (_id, key) => key === "database/schema.json" ? JSON.stringify(schema) : "" }),
    sessionDatabaseEnvironment: async () => ({ databaseToolEnvironment: { contract: "vibe64.database-tool-environment.v1", kind: "postgresql", read: { host: "127.0.0.1", port: 5432, database: "erd_test", username: "reader" }, write: { host: "127.0.0.1", port: 5432, database: "erd_test", username: "writer" } } })
  };
  const sourceEditor = createSourceEditor({ projectService, temporaryRoot: root });
  t.after(() => sourceEditor.close());
  const service = createService({ projectService, sourceEditor, publishLayoutChanged: async (id) => events.push(id), withKnex: () => assert.fail("Overview must not query data") });
  const input = { sessionId: "test", definition: bookingOverview() };
  const created = await service.saveOverview(input);
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.deepEqual(JSON.parse(await readFile(file)), bookingOverview());
  assert.equal(events.length, 1);
  const stale = await service.saveOverview(input);
  assert.equal(stale.code, "vibe64_database_overview_conflict");
  const saved = await service.saveOverview({ ...input, definition: bookingOverview({ split: true }), baseHash: created.overview.hash });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const outdated = await service.saveOverview({ ...input, baseHash: created.overview.hash });
  assert.equal(outdated.code, "vibe64_database_overview_conflict");
  const denied = await service.saveOverview({ ...input, vibe64User: { role: "collaborator" } });
  assert.equal(denied.code, "vibe64_owner_required");
  const read = await service.readOverview({ sessionId: "test" });
  assert.equal(read.valid, true); assert.equal(read.coverage.classified, 7);
  assert.equal(read.schema.tables.length, schema.tables.length);
  assert.deepEqual(read.schema.relationships, schema.relationships);
  assert.deepEqual(read.schema.tables[0].columns.map((column) => column.name), schema.tables[0].columns.map((column) => column.name));
  assert.match(read.instructions, /relationship distance|Relationship distance/u);
  const second = await fixture(t);
  assert.equal((await readDataOverview(second.session)).present, false);
  assert.equal(events.length, 2);
});


test("main connections select exact physical constraints without discarding the full graph", () => {
  const schema = dataOverviewSchema();
  const original = structuredClone(schema);
  const definition = validateDataOverview({ ...bookingOverview(), mainRelationships: [schema.relationships[1].id] });
  const main = dataOverviewGraph(schema, definition);
  assert.equal(main.edges.length, 1);
  assert.deepEqual(main.edges.flatMap((edge) => edge.data.relationships.map((rel) => rel.id)), definition.mainRelationships);
  assert.ok(dataOverviewGraph(schema, definition, { allRelationships: true }).edges.length > main.edges.length);
  assert.deepEqual(schema, original);
  assert.equal(dataOverviewGraph(schema, { ...definition, mainRelationships: [] }).edges.length, 0);
  assert.deepEqual(dataOverviewCoverage(schema, { ...definition, mainRelationships: ["removed"] }).missingRelationships, ["removed"]);
  for (const mainRelationships of [null, "fk", [null], ["id", "id"], ["x".repeat(1025)]]) {
    assert.throws(() => validateDataOverview({ ...definition, mainRelationships }), /mainRelationships|relationship ID/);
  }
});


test("manual actor positions accept finite coordinates and reject unrelated table IDs", () => {
  const value = { ...bookingOverview(), positions: { "public.bookings": { x: -125.5, y: 700 }, "other-tables": { x: 100, y: -50 } } };
  assert.deepEqual(validateDataOverview(value).positions, value.positions);
  assert.deepEqual(validateDataOverview({ ...value, positions: {} }).positions, {});
  for (const position of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: 1000001, y: 0 }, { x: "5", y: 0 }, { x: 0 }, { x: 0, y: 0, extra: true }]) {
    assert.throws(() => validateDataOverview({ ...value, positions: { "public.bookings": position } }));
  }
  assert.throws(() => validateDataOverview({ ...value, positions: { "public.checklists": { x: 0, y: 0 } } }));
  assert.throws(() => validateDataOverview({ ...value, positions: [] }));
});
