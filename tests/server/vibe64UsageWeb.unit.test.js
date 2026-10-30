import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { SESSION_SOURCE_PATH_AUTHORITY_MANAGED } from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import { readGenesisCallWeb } from "../../packages/vibe64-system-graph/src/server/genesisCities.js";
import {
  USAGE_QUERY_LIMITS,
  buildCallIndex,
  buildSnapshotIndex,
  createCallWebCache,
  createUsageService,
  joinFunctions,
  readCallsWeb,
  readEntries,
  readFunction,
  readImportsWeb,
  releaseCallWeb
} from "../../packages/vibe64-system-graph/src/server/usageWeb.js";

// Usage queries over the shared usage-map fixtures: a small project, its
// Machine City with entry points, its call web and one recording's join case.
const fixture = (name) => new URL(`../fixtures/usage-map/${name}`, import.meta.url);
const json = async (name) => JSON.parse(await readFile(fixture(name), "utf8"));
const machine = await json("machine-city.json");
const callWeb = await json("call-web.json");
const LAYOUT = { groups: [
  { id: "entry", title: "Entry points", kind: "layer", subsystems: [{ root: "bin" }, { root: "server" }] },
  { id: "features", title: "Features", kind: "layer", subsystems: [{ root: "src" }, { root: "packages/sessions" }, { root: "packages/reports" }] },
  { id: "shared", title: "Shared code", kind: "layer", subsystems: [{ root: "packages/core" }] }
] };
// Function ids are opaque: tests find them in the fixture by file and start.
function fn(file, line, column) {
  const found = callWeb.functions.find((item) => callWeb.files[item.file].path === file && item.start.line === line && item.start.column === column && item.kind !== "module");
  assert.ok(found, `${file}:${line}:${column} is not a function in the fixture call web`);
  return found.id;
}
const moduleOf = (file) => callWeb.functions.find((item) => callWeb.files[item.file].path === file && item.kind === "module").id;
const snapshot = (city = machine, layout = LAYOUT) => buildSnapshotIndex({ city, exists: true, builtAt: "2026-10-30T10:00:00.000Z" }, layout);
const index = snapshot();
const calls = buildCallIndex(callWeb);
const entry = (id) => index.entryById.get(id);
const PAGE = "entry:page:src/pages/SessionsPage.vue";
const COMPONENT = "entry:component:src/components/SessionList.vue";
const CLI = "entry:cli-command:package.json#bin/demo";
const ROUTE_GET = "entry:route:http:demo:GET:/api/sessions";

// No usage response may describe an edge whose ends it does not also return.
function assertBoundedEdges(response, nodesKey) {
  const ids = new Set((response[nodesKey] || []).map((node) => node.id));
  for (const edge of response.edges || []) {
    assert.ok(ids.has(edge.from) && ids.has(edge.to), `${edge.from} → ${edge.to} leaves the returned ${nodesKey}`);
  }
  assert.ok((response.edges || []).length <= ids.size * ids.size);
  assert.ok(Buffer.byteLength(JSON.stringify(response)) <= USAGE_QUERY_LIMITS.responseBytes);
}

test("entries list every kind present, searched, filtered and paged in a stable order", () => {
  const all = readEntries(index, {});
  assert.deepEqual(all.kinds, [
    { kind: "page", count: 1 }, { kind: "component", count: 1 }, { kind: "route", count: 2 }, { kind: "action", count: 2 },
    { kind: "library-export", count: 1 }, { kind: "cli-command", count: 1 }, { kind: "program-operation", count: 1 }, { kind: "test", count: 1 }
  ]);
  assert.equal(all.entries.length, 10);
  assert.equal(all.nextCursor, null);
  assert.deepEqual(all.entries[0], { id: PAGE, kind: "page", title: "Sessions", file: "src/pages/SessionsPage.vue", subsystemId: "directory:src", hasCalls: true });
  assert.equal(all.entries.find((item) => item.kind === "cli-command").subsystemId, "directory:bin");

  const searched = readEntries(index, { q: "SESSIONS" });
  assert.ok(searched.entries.every((item) => `${item.title}\n${item.file}`.toLowerCase().includes("sessions")));
  assert.deepEqual(readEntries(index, { q: "bin/demo" }).entries.map((item) => item.id), [CLI]);
  const routes = readEntries(index, { kind: "route", q: "sessions" });
  assert.deepEqual(routes.entries.map((item) => item.title), ["GET /api/sessions", "POST /api/sessions"]);
  assert.equal(routes.kinds.find((item) => item.kind === "action").count, 2, "kind counts follow the search, not the kind filter");

  const first = readEntries(index, { limit: 4 });
  const second = readEntries(index, { limit: 4, cursor: first.nextCursor });
  const third = readEntries(index, { limit: 4, cursor: second.nextCursor });
  assert.equal(first.nextCursor, "4");
  assert.equal(third.nextCursor, null);
  assert.deepEqual([...first.entries, ...second.entries, ...third.entries].map((item) => item.id), all.entries.map((item) => item.id));
  assert.equal(readEntries(index, { limit: 900 }).limits.limit, 200);
  assert.throws(() => readEntries(index, { kind: "widget" }), { code: "vibe64_invalid_usage_entry_kind" });
  assert.throws(() => readEntries(index, { q: "x".repeat(81) }), { code: "vibe64_invalid_usage_search" });
  assert.throws(() => readEntries(index, { cursor: "-1" }), { code: "vibe64_invalid_usage_cursor" });
});

test("a project without a call web still lists entries, without calls", () => {
  const withoutCalls = snapshot({ ...machine, architecture: { ...machine.architecture, callWeb: null } });
  assert.equal(withoutCalls.snapshot.callWebIdentity, null);
  assert.ok(readEntries(withoutCalls, {}).entries.every((item) => item.hasCalls === false));
  const response = readCallsWeb(withoutCalls, null, withoutCalls.entryById.get(CLI), {});
  assert.deepEqual(response.subsystems.map((item) => item.functionCount), response.subsystems.map(() => 0));
  assert.equal(response.functions, undefined);
});

test("Imports follow resolved imports only, never type-only ones", () => {
  const page = readImportsWeb(index, entry(PAGE), {});
  assert.deepEqual(page.files.map(({ path: filePath, depth }) => [filePath, depth]), [
    ["src/pages/SessionsPage.vue", 0], ["src/components/SessionList.vue", 1], ["src/api/sessionsClient.js", 2]
  ]);
  assert.equal(page.unresolvedImports, 1, "SessionList.vue imports `vue`, outside the project");
  assert.deepEqual(page.subsystems.filter((item) => item.reached).map((item) => [item.id, item.fileCount, item.group]), [["directory:src", 3, "features"]]);
  assert.equal(page.subsystems.length, index.subsystems.length, "untouched subsystems are listed, unreached");
  assert.deepEqual(page.groups.map((group) => group.id), ["entry", "features", "shared"]);
  assertBoundedEdges(page, "files");

  const cli = readImportsWeb(index, entry(CLI), {});
  const reached = cli.files.map((file) => file.path);
  assert.ok(reached.includes("packages/sessions/src/server/store.ts"));
  assert.ok(!reached.includes("packages/core/src/shared/sessionShape.ts"), "store.ts only imports sessionShape.ts for types");
  assert.deepEqual(cli.crossings, [
    { fromSubsystemId: "directory:bin", toSubsystemId: "directory:packages/core", count: 1 },
    { fromSubsystemId: "directory:bin", toSubsystemId: "directory:packages/sessions", count: 1 },
    { fromSubsystemId: "directory:packages/sessions", toSubsystemId: "directory:packages/core", count: 1 }
  ]);
  assertBoundedEdges(cli, "files");

  const zoomed = readImportsWeb(index, entry(CLI), { subsystemId: "directory:packages/sessions" });
  assert.deepEqual(zoomed.files.map((file) => file.path), ["packages/sessions/src/server/service.js", "packages/sessions/src/server/store.ts"]);
  assert.deepEqual(zoomed.edges, [{ from: "file:packages/sessions/src/server/service.js", to: "file:packages/sessions/src/server/store.ts" }]);
  assertBoundedEdges(zoomed, "files");
});

test("Calls start from a component's own functions and cross transports through bridges", () => {
  const response = readCallsWeb(index, calls, entry(COMPONENT), {});
  const byId = new Map(response.functions.map((item) => [item.id, item]));
  for (const start of [moduleOf("src/components/SessionList.vue"), fn("src/components/SessionList.vue", 8, 1), fn("src/components/SessionList.vue", 12, 1)]) {
    assert.equal(byId.get(start)?.depth, 0, `${start} starts the web`);
  }
  assert.equal(byId.get(fn("packages/sessions/src/server/routes.js", 5, 50)).reach, "exact", "the exact bridge reaches the GET route handler");
  assert.equal(byId.get(fn("packages/sessions/src/server/routes.js", 6, 51)).reach, "probable", "the probable bridge reaches the POST route handler");
  assert.equal(byId.get(fn("packages/core/src/shared/text.js", 1, 8)).reach, "probable");
  assert.deepEqual(response.subsystems.filter((item) => item.functionCount).map(({ id, functionCount, exact, probable }) => [id, functionCount, exact, probable]), [
    ["directory:packages/core", 1, 0, 1], ["directory:packages/sessions", 10, 2, 8], ["directory:src", 5, 5, 0]
  ]);
  assert.deepEqual(response.crossings, [
    { fromSubsystemId: "directory:packages/sessions", toSubsystemId: "directory:packages/core", exact: 1, probable: 0 },
    { fromSubsystemId: "directory:src", toSubsystemId: "directory:packages/sessions", exact: 1, probable: 1 }
  ]);
  assert.ok(response.edges.some((edge) => edge.method === "operation" && edge.from === fn("src/api/sessionsClient.js", 1, 8) && edge.certainty === "exact"));
  assert.deepEqual(response.functions.map((item) => item.depth), [...response.functions.map((item) => item.depth)].sort((left, right) => left - right));
  assertBoundedEdges(response, "functions");

  const exact = readCallsWeb(index, calls, entry(COMPONENT), { certainty: "exact" });
  assert.deepEqual(exact.functions.map((item) => item.id).sort(), [
    fn("packages/sessions/src/server/routes.js", 5, 50), fn("packages/sessions/src/server/routes.js", 9, 1),
    fn("src/api/sessionsClient.js", 1, 8), fn("src/api/sessionsClient.js", 6, 8),
    moduleOf("src/components/SessionList.vue"), fn("src/components/SessionList.vue", 12, 1), fn("src/components/SessionList.vue", 8, 1)
  ].sort());
  assert.ok(exact.edges.every((edge) => edge.certainty === "exact"));
  assertBoundedEdges(exact, "functions");
});

test("Calls honour entry functions, report unresolved calls and zoom into one subsystem", () => {
  const route = readCallsWeb(index, calls, entry(ROUTE_GET), {});
  assert.equal(route.functions[0].id, fn("packages/sessions/src/server/routes.js", 5, 50));
  assert.ok(!route.functions.some((item) => item.file === "src/components/SessionList.vue"), "Calls never walk backwards to callers");
  const runAction = route.functions.find((item) => item.name === "runAction");
  assert.deepEqual([runAction.callCount, runAction.calledByCount], [2, 1]);

  const cli = readCallsWeb(index, calls, entry(CLI), {});
  assert.deepEqual(cli.unresolved, [{ fromFunctionId: fn("bin/demo.js", 7, 1), callee: "logger.info", start: { line: 9, column: 35 } }]);
  assert.equal(cli.unresolvedTotal, 1);

  const zoomed = readCallsWeb(index, calls, entry(COMPONENT), { subsystemId: "directory:packages/sessions" });
  assert.equal(zoomed.functions.length, 10);
  assert.ok(zoomed.functions.every((item) => item.subsystemId === "directory:packages/sessions"));
  assert.ok(zoomed.edges.length > 0);
  assertBoundedEdges(zoomed, "functions");
  assert.throws(() => readCallsWeb(index, calls, entry(COMPONENT), { subsystemId: "directory:nowhere" }), { code: "vibe64_usage_subsystem_not_found" });
  assert.throws(() => readCallsWeb(index, calls, entry(COMPONENT), { certainty: "likely" }), { code: "vibe64_invalid_usage_certainty" });
});

test("maxNodes keeps function and file lists out of whole-web responses", () => {
  const overview = readCallsWeb(index, calls, entry(COMPONENT), { maxNodes: 4 });
  assert.equal(overview.functions, undefined, "16 reached functions do not fit 4 nodes: subsystems only");
  assert.equal(overview.edges, undefined);
  assert.equal(overview.truncated, false);
  assert.equal(overview.limits.maxNodes, 4);
  const zoomed = readCallsWeb(index, calls, entry(COMPONENT), { maxNodes: 4, subsystemId: "directory:packages/sessions" });
  assert.equal(zoomed.functions.length, 4);
  assert.equal(zoomed.truncated, true);
  assertBoundedEdges(zoomed, "functions");
  assert.equal(readCallsWeb(index, calls, entry(COMPONENT), { maxNodes: 5000 }).limits.maxNodes, 1000);
  const files = readImportsWeb(index, entry(CLI), { maxNodes: 2 });
  assert.equal(files.files, undefined);
  const filesZoomed = readImportsWeb(index, entry(CLI), { maxNodes: 1, subsystemId: "directory:packages/sessions" });
  assert.deepEqual([filesZoomed.files.length, filesZoomed.truncated, filesZoomed.edges.length], [1, true, 0]);
});

// A synthetic chain of long-named functions, each with unresolved calls.
function syntheticWeb(count, { nameLength = 8, unresolvedPerFunction = 0 } = {}) {
  const file = "src/chain.js";
  const functions = Array.from({ length: count }, (_, position) => ({
    id: `fn:${file}#f${position}`, file: 0, name: `f${position}`.padEnd(nameLength, "x"), kind: "function",
    start: { line: position + 1, column: 1 }, end: { line: position + 1, column: 9 }
  }));
  const site = (position) => ({ start: { line: position + 1, column: 2 }, end: { line: position + 1, column: 3 } });
  const chain = functions.slice(1).map((_, position) => ({ from: position, targets: [position + 1], certainty: "exact", method: "checker", callee: "next", site: site(position) }));
  const unresolved = functions.flatMap((_, position) => Array.from({ length: unresolvedPerFunction }, () => ({ from: position, targets: [], certainty: "unresolved", method: "none", callee: "handler", site: site(position) })));
  const document = { schema: "genesis.call-web.v1", sourceIdentity: "sha256:synthetic", files: [{ path: file, hash: "sha256:chain", subsystemId: "directory:src", coverage: "generic" }], functions, calls: [...chain, ...unresolved], bridges: [], diagnostics: [] };
  const city = structuredClone(machine);
  city.architecture.entryPoints = [{ id: "entry:test:chain", kind: "test", title: "chain", file, functionIds: [functions[0].id], resolution: "resolved", evidence: [] }];
  return { index: snapshot(city), calls: buildCallIndex(document), entry: "entry:test:chain" };
}

test("responses stay within 1 MiB, 50 unresolved items and 200 rows per function list", () => {
  const large = syntheticWeb(1000, { nameLength: 1500 });
  const capped = readCallsWeb(large.index, large.calls, large.index.entryById.get(large.entry), { maxNodes: 1000, subsystemId: "directory:src" });
  assert.equal(capped.truncated, true);
  assert.ok(capped.functions.length < 1000 && capped.functions.length > 0);
  assertBoundedEdges(capped, "functions");

  const noisy = syntheticWeb(3, { unresolvedPerFunction: 30 });
  const response = readCallsWeb(noisy.index, noisy.calls, noisy.index.entryById.get(noisy.entry), {});
  assert.equal(response.unresolved.length, 50);
  assert.equal(response.unresolvedTotal, 90);

  const busy = syntheticWeb(2, { unresolvedPerFunction: 250 });
  const detail = readFunction(busy.index, busy.calls, { functionId: busy.calls.functions[0].id });
  assert.equal(detail.unresolved.length, 200);
  assert.equal(detail.totals.unresolved, 250);
  assert.equal(detail.truncated, true);
});

test("a function lists its calls, callers and unresolved calls with their certainty", () => {
  const runAction = readFunction(index, calls, { functionId: fn("packages/sessions/src/server/routes.js", 9, 1) });
  assert.equal(runAction.function.name, "runAction");
  assert.equal(runAction.function.coverage, "adapter:jskit");
  assert.deepEqual(runAction.calls.map((row) => [row.target.id, row.certainty, row.method, row.callee]), [
    [fn("packages/sessions/src/server/actions.js", 4, 40), "probable", "receiver-name", "action.execute"],
    [fn("packages/sessions/src/server/actions.js", 5, 42), "probable", "receiver-name", "action.execute"]
  ]);
  assert.deepEqual(runAction.calledBy.map((row) => [row.source.id, row.certainty, row.method]), [
    [fn("packages/sessions/src/server/routes.js", 5, 50), "exact", "checker"],
    [fn("packages/sessions/src/server/routes.js", 6, 51), "exact", "checker"]
  ]);
  const client = readFunction(index, calls, { functionId: fn("src/api/sessionsClient.js", 1, 8) });
  assert.deepEqual(client.calls.map((row) => [row.target.id, row.method, row.callee, row.start]), [
    [fn("packages/sessions/src/server/routes.js", 5, 50), "operation", "GET /api/sessions", null]
  ]);
  const handler = readFunction(index, calls, { functionId: fn("server/router.js", 18, 3) });
  assert.deepEqual(handler.unresolved, [{ callee: "handler", start: { line: 20, column: 34 } }]);
  assert.throws(() => readFunction(index, calls, { functionId: "fn:nowhere" }), { code: "vibe64_usage_function_not_found" });
  assert.throws(() => readFunction(index, null, { functionId: runAction.function.id }), { code: "vibe64_usage_function_not_found" });
});

test("recorded functions join exactly, by name and line, as stale or not at all", async () => {
  const request = await json("recording/api/join/r_000004-request.json");
  const expected = await json("recording/api/join/r_000004-response.json");
  const response = joinFunctions(index, calls, request);
  assert.deepEqual(response.joined, expected.joined);
  assert.deepEqual(new Set(response.joined.map((item) => item.join)), new Set(["exact", "name-line", "stale", "none"]));
  assert.deepEqual(response.subsystems, expected.subsystems);
  const unique = [...new Map(expected.edges.map((edge) => [`${edge.from}>${edge.to}`, edge])).values()];
  assert.deepEqual(response.edges, unique, "two calls between the same functions draw one arrow");
  for (const edge of response.edges) {
    for (const end of [edge.from, edge.to]) assert.ok(["exact", "name-line"].includes(response.joined[end].join), "no arrows for stale or unjoined functions");
  }

  const missing = joinFunctions(index, calls, { functions: [{ path: "packages/reports/README.md", hash: "sha256:x", name: "", start: { line: 1, column: 1 } }] });
  assert.deepEqual(missing.joined, [{ index: 0, functionId: null, subsystemId: "directory:packages/reports", join: "none" }]);

  // Without a call web the Machine City hash still separates stale files.
  const scanned = machine.architecture.files.find((file) => file.path === "bin/demo.js");
  const withoutCalls = joinFunctions(index, null, { functions: [
    { path: "bin/demo.js", hash: scanned.hash, name: "main", start: { line: 7, column: 1 } },
    { path: "bin/demo.js", hash: "sha256:changed", name: "main", start: { line: 7, column: 1 } }
  ] });
  assert.deepEqual(withoutCalls.joined.map((item) => item.join), ["none", "stale"]);
  assert.deepEqual(withoutCalls.edges, []);
  // A function outside the scan's calls says why, when that is known: Git did
  // not ignore the call web, or the scan reads no calls in its file's language.
  assert.equal("reason" in withoutCalls.joined[0], false);
  assert.equal("reason" in withoutCalls.joined[1], false);
  assert.equal("reason" in missing.joined[0], false);
  const notIgnored = snapshot({ ...machine, architecture: { ...machine.architecture, callWeb: null,
    diagnostics: [{ code: "CALL_WEB_NOT_IGNORED", path: ".genesis/call-web.json", message: "Add `/.genesis/call-web.json` to .gitignore" }] } });
  assert.equal(notIgnored.snapshot.callWebProblem, "not-ignored");
  assert.equal(index.snapshot.callWebProblem, null);
  assert.equal(joinFunctions(notIgnored, null, { functions: [{ path: "bin/demo.js", hash: scanned.hash, name: "main", start: { line: 7, column: 1 } }] }).joined[0].reason, "not-ignored");
  const undeclared = buildCallIndex({ ...callWeb, files: callWeb.files.map((file) => (file.path === "bin/demo.js" ? { ...file, coverage: "none" } : file)) });
  assert.deepEqual(joinFunctions(index, undeclared, { functions: [{ path: "bin/demo.js", hash: scanned.hash, name: "main", start: { line: 7, column: 1 } }] }).joined,
    [{ index: 0, functionId: null, subsystemId: scanned.subsystemId, join: "none", reason: "language" }]);
  assert.throws(() => joinFunctions(index, calls, { functions: Array.from({ length: 1501 }, () => request.functions[0]) }), { code: "vibe64_invalid_usage_join_size" });

  // A function opening its file shares 1:1 with the file's top-level code.
  const opening = structuredClone(callWeb);
  const demo = opening.files.findIndex((file) => file.path === "bin/demo.js");
  opening.functions.push({ id: "fn:bin/demo.js#opening", file: demo, name: "main", kind: "function", start: { line: 1, column: 1 }, end: { line: 3, column: 2 } });
  const shared = joinFunctions(index, buildCallIndex(opening), { functions: ["main", "", "<module>"].map((name) => ({ path: "bin/demo.js", hash: opening.files[demo].hash, name, start: { line: 1, column: 1 } })) });
  assert.deepEqual(shared.joined.map((item) => item.functionId), ["fn:bin/demo.js#opening", moduleOf("bin/demo.js"), moduleOf("bin/demo.js")]);
});

test("PHP records join by name and line, closures not at all, and file bodies to the module", () => {
  // PHP keeps no columns: every recorded start is column 1, methods carry
  // their bare name, closures are named "" and a file's body is "" at 1:1.
  const php = structuredClone(callWeb);
  const path = "packages/sessions/src/server/SessionController.php";
  const file = php.files.push({ path, hash: "sha256:php", subsystemId: "directory:packages/sessions", coverage: "generic" }) - 1;
  const declared = [
    { id: `fn:${path}#module`, kind: "module", name: "", start: { line: 1, column: 1 }, end: { line: 30, column: 2 } },
    { id: `fn:${path}#12:5`, kind: "method", name: "index", container: "SessionController", start: { line: 12, column: 5 }, end: { line: 20, column: 6 } },
    { id: `fn:${path}#14:22`, kind: "function", name: "", start: { line: 14, column: 22 }, end: { line: 16, column: 10 } }
  ];
  php.functions.push(...declared.map((item) => ({ ...item, file })));
  const recorded = [
    { name: "index", start: { line: 12, column: 1 } },
    { name: "", start: { line: 14, column: 1 } },
    { name: "", start: { line: 1, column: 1 } }
  ].map((item) => ({ path, hash: "sha256:php", ...item }));
  const joined = joinFunctions(index, buildCallIndex(php), { functions: recorded }).joined;
  assert.deepEqual(joined.map((item) => [item.join, item.functionId]), [
    ["name-line", `fn:${path}#12:5`],
    ["none", null],
    ["exact", `fn:${path}#module`]
  ]);
});

test("the call-web cache keeps one web per session, two sessions, and drops idle ones", async () => {
  let clock = 0;
  const cache = createCallWebCache({ now: () => clock });
  const loads = [];
  const load = (name) => () => { loads.push(name); return { name }; };
  assert.deepEqual(await cache.read("a", "sha256:1", load("a1")), { name: "a1" });
  await cache.read("a", "sha256:1", load("a1-again"));
  assert.deepEqual(loads, ["a1"], "an unchanged identity reuses the parsed web");
  await cache.read("a", "sha256:2", load("a2"));
  assert.deepEqual(loads, ["a1", "a2"], "a new identity reloads");
  assert.equal(cache.size, 1, "one web per session");
  await cache.read("b", "sha256:1", load("b1"));
  clock += 1;
  await cache.read("a", "sha256:2", load("a2-again"));
  await cache.read("c", "sha256:1", load("c1"));
  assert.equal(cache.size, 2);
  await cache.read("b", "sha256:1", load("b1-again"));
  assert.deepEqual(loads.slice(-2), ["c1", "b1-again"], "the least recently used session was evicted");
  clock += 2 * 60 * 1000 - 1;
  cache.sweep();
  assert.equal(cache.size, 2, "a web read within two minutes stays");
  clock += 1;
  cache.sweep();
  assert.equal(cache.size, 0, "two idle minutes release every web");
  await assert.rejects(cache.read("a", "sha256:3", () => { throw new Error("broken"); }), /broken/u);
  assert.equal(cache.size, 0, "a failed load is not kept");
  cache.clear();
});

test("an idle call web is released by its own timer, with no further query", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  const cache = createCallWebCache();
  await cache.read("a", "sha256:1", () => ({ name: "a1" }));
  t.mock.timers.tick(2 * 60 * 1000 - 1);
  assert.equal(cache.size, 1, "a web read within two minutes stays");
  t.mock.timers.tick(1);
  assert.equal(cache.size, 0, "two idle minutes release it without anyone asking");
  cache.clear();
});

function projectServiceFor(root) {
  return {
    async createRuntime() {
      return {
        async getSession(sessionId) {
          return { sessionId, metadata: { source_kind: "session_clone", source_path: root, source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED } };
        }
      };
    }
  };
}

test("the service answers each query with the snapshot and reloads a changed call web", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "vibe64-usage-"));
  const root = path.join(temporary, "sessions", "active", "s1", "source");
  await mkdir(root, { recursive: true });
  try {
    let city = machine;
    const reads = [];
    const cache = createCallWebCache();
    const service = createUsageService({
      projectService: projectServiceFor(root),
      cityReader: async () => ({ builtAt: "2026-10-30T10:00:00.000Z", city, exists: true, kind: "machine", path: ".genesis/machine-city.json" }),
      callWebReader: async (sourceRoot, architecture) => { reads.push([sourceRoot, architecture.callWeb.identity]); return callWeb; },
      layoutReader: async () => LAYOUT,
      callWebCache: cache
    });
    const entries = await service.readUsageEntries({ sessionId: "s1" });
    assert.equal(entries.ok, true, entries.error);
    assert.deepEqual(entries.snapshot, {
      sourceIdentity: machine.architecture.sourceHash,
      callWebIdentity: machine.architecture.callWeb.identity,
      callWebProblem: null,
      builtAt: "2026-10-30T10:00:00.000Z",
      stale: false
    });
    assert.deepEqual(reads, [], "listing entries never loads the call web");
    const web = await service.readUsageWeb({ sessionId: "s1", entryId: COMPONENT, mode: "calls" });
    assert.equal(web.ok, true);
    assert.equal(web.functions.length, 16);
    await service.readUsageFunction({ sessionId: "s1", functionId: fn("src/api/sessionsClient.js", 1, 8) });
    assert.equal(reads.length, 1);

    city = structuredClone(machine);
    city.architecture.callWeb.identity = "sha256:next";
    city.architecture.diagnostics = [{ code: "ARCHITECTURE_UI_STALE", message: "UI observations need refresh." }];
    const next = await service.readUsageWeb({ sessionId: "s1", entryId: CLI, mode: "imports" });
    assert.equal(next.snapshot.stale, true);
    assert.deepEqual(reads.length, 1, "Imports never need the call web");
    await service.joinUsage({ sessionId: "s1", functions: [] });
    assert.deepEqual(reads.at(-1), [root, "sha256:next"]);

    const unknown = await service.readUsageWeb({ sessionId: "s1", entryId: "entry:nowhere", mode: "calls" });
    assert.deepEqual([unknown.ok, unknown.code], [false, "vibe64_usage_entry_not_found"]);
    const badMode = await service.readUsageWeb({ sessionId: "s1", entryId: CLI, mode: "recording" });
    assert.equal(badMode.code, "vibe64_invalid_usage_mode");
    cache.clear();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a scan's release drops the session's parsed call web from the service's own cache", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "vibe64-usage-"));
  const root = path.join(temporary, "sessions", "active", "s1", "source");
  await mkdir(root, { recursive: true });
  try {
    let reads = 0;
    const service = createUsageService({
      projectService: projectServiceFor(root),
      cityReader: async () => ({ builtAt: "2026-10-30T10:00:00.000Z", city: machine, exists: true, kind: "machine", path: ".genesis/machine-city.json" }),
      callWebReader: async () => { reads += 1; return callWeb; },
      layoutReader: async () => LAYOUT
    });
    await service.readUsageWeb({ sessionId: "s1", entryId: COMPONENT, mode: "calls" });
    await service.readUsageWeb({ sessionId: "s1", entryId: COMPONENT, mode: "calls" });
    assert.equal(reads, 1, "the parsed web serves repeated queries");
    releaseCallWeb(root);
    await service.readUsageWeb({ sessionId: "s1", entryId: COMPONENT, mode: "calls" });
    assert.equal(reads, 2, "after the release the next query parses it again");
    releaseCallWeb(root);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("the call web is read only as the exact bytes the Machine City names", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-call-web-"));
  try {
    const bytes = await readFile(fixture("call-web.json"));
    const architecture = machine.architecture;
    assert.equal(await readGenesisCallWeb(root, { ...architecture, callWeb: null }), null);
    await assert.rejects(readGenesisCallWeb(root, architecture, { validate: (document) => document }), { code: "vibe64_genesis_call_web_missing" });
    await mkdir(path.join(root, ".genesis"));
    await writeFile(path.join(root, ".genesis/call-web.json"), bytes);
    const validated = [];
    const document = await readGenesisCallWeb(root, architecture, { validate: (value, files) => { validated.push(files); return value; } });
    assert.deepEqual(document, callWeb);
    assert.equal(validated[0], architecture.files, "Genesis validates it against this snapshot's files");
    assert.equal(`sha256:${createHash("sha256").update(bytes).digest("hex")}`, architecture.callWeb.identity);
    await writeFile(path.join(root, ".genesis/call-web.json"), Buffer.concat([bytes, Buffer.from(" ")]));
    await assert.rejects(readGenesisCallWeb(root, architecture, { validate: (value) => value }), { code: "vibe64_genesis_call_web_changed" });
    await assert.rejects(readGenesisCallWeb(root, { ...architecture, callWeb: { ...architecture.callWeb, path: "../call-web.json" } }), { code: "vibe64_invalid_genesis_call_web" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the call web is read only as a regular file of at most 64 MiB", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-call-web-"));
  try {
    const architecture = machine.architecture;
    const file = path.join(root, ".genesis/call-web.json");
    const elsewhere = path.join(root, "elsewhere.json");
    await mkdir(path.join(root, ".genesis"));
    await writeFile(elsewhere, await readFile(fixture("call-web.json")));
    await symlink(elsewhere, file);
    await assert.rejects(readGenesisCallWeb(root, architecture, { validate: (value) => value }),
      { code: "vibe64_invalid_genesis_call_web", message: "The call web must be a regular file." });
    await rm(file);
    await writeFile(file, "");
    await truncate(file, 64 * 1024 * 1024 + 1);
    await assert.rejects(readGenesisCallWeb(root, architecture, { validate: (value) => value }),
      { code: "vibe64_invalid_genesis_call_web", message: "The call web is larger than 64 MiB." });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
