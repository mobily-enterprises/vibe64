import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { appendFile, cp, mkdir, mkdtemp, open, readFile, readdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { USAGE_RECORDING_LIMITS, USAGE_RECORDING_RETENTION } from "@local/vibe64-usage-recording/shared/contract";
import { admitUsageRecording } from "../../packages/vibe64-usage-recording/src/server/admission.js";
import { createService } from "../../packages/vibe64-usage-recording/src/server/service.js";
import {
  createTraceReader,
  readInteractions,
  readJsonFile,
  recordingRequestRows,
  unionFunctions,
  writeJsonFile
} from "../../packages/vibe64-usage-recording/src/server/traceStore.js";

const exec = promisify(execFile);
const FIXTURE = new URL("../fixtures/usage-map/recording/", import.meta.url);
const RECORDING_ID = "rec_fixture2usagemap3web";
const HASH = `sha256:${"c".repeat(64)}`;
const at = "2026-10-30T10:00:00.000Z";
const header = (pid) => ({ type: "header", schema: "vibe64.usage-trace.v1", runtime: "nodejs", runtimeVersion: "26.5.0", pid, startedAt: at });
const declare = (fileIndex, functionIndex, file, line) => [
  { type: "file", fileIndex, path: file, hash: HASH },
  { type: "function", functionIndex, fileIndex, name: `f${line}`, start: { line, column: 1 }, end: { line: line + 1, column: 2 } }
];
const ndjson = (lines) => lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n") + "\n";

async function temporary(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-usage-store-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  return root;
}

function fixtureService(sessionRoot, nowIso) {
  const session = { sessionId: "session-fixture", status: "active", sessionRoot, metadata: {} };
  const service = createService({
    admission: admitUsageRecording,
    now: () => Date.parse(nowIso),
    project: { createRuntime: async () => ({ getSession: async () => session, getSessionWithoutSource(sessionId) { return this.getSession(sessionId); } }), createRuntimeWithoutSource(options) { return this.createRuntime(options); } },
    terminals: {}
  });
  return (method, input = {}) => runWithProjectRequestContext({ slug: "demo" },
    () => service[method]({ sessionId: "session-fixture", ...input }));
}

const fixtureJson = async (name) => JSON.parse(await readFile(new URL(`api/${name}`, FIXTURE), "utf8"));

test("the recording API answers the shared fixture exactly", async (t) => {
  const sessionRoot = await temporary(t);
  const directory = path.join(sessionRoot, "usage-recordings", RECORDING_ID);
  await mkdir(directory, { recursive: true });
  for (const name of await readdir(FIXTURE)) {
    if (name !== "api") await cp(new URL(name, FIXTURE), path.join(directory, name));
  }
  const call = fixtureService(sessionRoot, "2026-10-30T10:03:20.000Z");

  // The process's start-up work is the first, background row.
  assert.deepEqual(await call("readCurrent"), await fixtureJson("current.json"));
  assert.deepEqual(await call("list"), await fixtureJson("list.json"));
  assert.deepEqual(await call("readRequests", { recordingId: RECORDING_ID }), await fixtureJson("requests.json"));
  assert.deepEqual(await call("readRequests", { recordingId: RECORDING_ID, includeEmpty: true }), await fixtureJson("requests-include-empty.json"));
  for (const requestId of ["bg_4242", "r_000002", "r_000003", "r_000004"]) {
    assert.deepEqual(await call("readRequestFunctions", { recordingId: RECORDING_ID, requestId }), await fixtureJson(`request-functions/${requestId}.json`));
  }
  // Paging, search and the background scope.
  const firstPage = await call("readRequests", { recordingId: RECORDING_ID, limit: 2 });
  assert.deepEqual([firstPage.requests.map((row) => row.id), firstPage.nextCursor], [["bg_4242", "r_000002"], "2"]);
  assert.deepEqual((await call("readRequests", { recordingId: RECORDING_ID, cursor: "2" })).requests.map((row) => row.id), ["r_000003", "r_000004"]);
  assert.deepEqual((await call("readRequests", { recordingId: RECORDING_ID, q: "post" })).requests.map((row) => row.id), ["r_000003"]);
  // Newest first pages from the end; total counts the matching requests, not the start-up row.
  const newest = await call("readRequests", { recordingId: RECORDING_ID, limit: 2, order: "newest" });
  assert.deepEqual([newest.requests.map((row) => row.id), newest.nextCursor, newest.total], [["r_000004", "r_000003"], "2", 3]);
  assert.deepEqual((await call("readRequests", { recordingId: RECORDING_ID, cursor: "2", order: "newest" })).requests.map((row) => row.id), ["r_000002", "bg_4242"]);
  assert.equal((await call("readRequests", { recordingId: RECORDING_ID, q: "post" })).total, 1);
  // One request by its id, with its click, whatever the other filters say.
  const named = await call("readRequests", { recordingId: RECORDING_ID, requestId: "r_000004", q: "post", limit: 1 });
  assert.deepEqual([named.requests.map((row) => row.id), named.interactions.map((row) => row.id), named.total], [["r_000004"], ["i_0001"], 1]);
  assert.deepEqual((await call("readRequests", { recordingId: RECORDING_ID, requestId: "r_000001" })).requests.map((row) => row.id), ["r_000001"]);
  const functions = await call("readRequestFunctions", { recordingId: RECORDING_ID, requestId: "r_000004", limit: 5 });
  assert.deepEqual([functions.functions.length, functions.total, functions.truncated], [5, 16, true]);
  const startUp = await call("readRequestFunctions", { recordingId: RECORDING_ID, requestId: "bg_4242" });
  assert.deepEqual([startUp.functions.length, startUp.functions[0].name, startUp.truncated], [7, "createLogger", false]);
  await assert.rejects(call("readRequestFunctions", { recordingId: RECORDING_ID, requestId: "x_1" }), { statusCode: 404 });
  await assert.rejects(call("readRequests", { recordingId: "rec_aaaaaaaaaaaaaaaaaaaa" }), { statusCode: 404 });
  // The click's own read: its two requests as one list, as the usage-map spec serves it.
  const click = await call("readInteractionFunctions", { recordingId: RECORDING_ID, interactionId: "i_0001" });
  const tagged = await Promise.all(["r_000003", "r_000004"].map((requestId) => fixtureJson(`request-functions/${requestId}.json`)));
  const { requestCount, ...interaction } = (await fixtureJson("requests.json")).interactions[0];
  assert.equal(requestCount, 2);
  assert.deepEqual(click, { functions: unionFunctions(tagged.map((answer) => answer.functions)), total: 21, truncated: false, requests: ["r_000003", "r_000004"], interaction });
});

test("a click's requests are read as one list: only its own, counts added up, cut once at the limit", async (t) => {
  const sessionRoot = await temporary(t);
  const recordingId = "rec_clickclickclickclick";
  const directory = path.join(sessionRoot, "usage-recordings", recordingId);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "recording.json"), JSON.stringify({
    schema: "vibe64.usage-recording.v1", id: recordingId, sessionId: "session-fixture", state: "stopped", target: { id: "preview", kind: "web", label: "Preview" },
    runtimes: ["nodejs"], tracers: [], startedAt: at, stoppedAt: "2026-10-30T10:01:00.000Z", stopReason: "person",
    counts: { requests: 3, functions: 1602 }, truncated: false, dismissedAt: null, sourceIdentity: null
  }));
  const request = (number, interaction) => ({ id: `r_00000${number}`, seq: number, method: "GET", path: "/api/items", status: 200,
    startedAt: `2026-10-30T10:00:0${number}.000Z`, durationMs: 1, interaction });
  // Two requests the click started, and one between them that it did not.
  await writeFile(path.join(directory, "requests.ndjson"), ndjson([request(1, "i_0001"), request(2, null), request(3, "i_0001")]));
  await writeFile(path.join(directory, "interactions.ndjson"), ndjson([
    { id: "i_0001", at, label: "button \"Save\"", kind: "click", componentFile: "src/Save.vue" },
    { id: "i_0002", at, label: "link \"Home\"", kind: "click", componentFile: null }
  ]));
  // Functions 0-1,599 sit at lines 1-1,600 of one file. The first request runs
  // 0-999 once each, the third 500-1,599 twice each: 1,600 different functions,
  // though neither request alone reaches the 1,500 limit. Function 1,600 runs in
  // all three, so it is plumbing; 1,601 runs only in the untagged request.
  const ran = (from, to, count) => Array.from({ length: to - from + 1 }, (_, offset) => [from + offset, count]);
  await writeFile(path.join(directory, "hits-nodejs-10.ndjson"), ndjson([
    header(10),
    { type: "tracer", state: "idle" },
    { type: "file", fileIndex: 0, path: "lib/items.js", hash: HASH },
    ...Array.from({ length: 1602 }, (_, index) => ({ type: "function", functionIndex: index, fileIndex: 0, name: `f${index}`,
      start: { line: index + 1, column: 1 }, end: { line: index + 1, column: 9 } })),
    ...[1, 2, 3].map((number) => ({ type: "scope", scope: `r_00000${number}`, kind: "request", startedAt: `2026-10-30T10:00:0${number}.000Z` })),
    { type: "hits", scope: "r_000001", counts: [...ran(0, 999, 1), [1600, 1]] },
    { type: "hits", scope: "r_000002", counts: [[1600, 1], [1601, 1]] },
    { type: "hits", scope: "r_000003", counts: [...ran(500, 1599, 2), [1600, 1]] }
  ]));
  const call = fixtureService(sessionRoot, "2026-10-30T10:02:00.000Z");
  const read = (interactionId, extra = {}) => call("readInteractionFunctions", { recordingId, interactionId, ...extra });

  const first = await read("i_0001");
  assert.deepEqual([first.functions.length, first.total, first.truncated, first.requests], [1500, 1601, true, ["r_000001", "r_000003"]]);
  assert.deepEqual(first.interaction, { id: "i_0001", label: "button \"Save\"", kind: "click", componentFile: "src/Save.vue" });
  const byName = (functions) => new Map(functions.map((fn) => [fn.name, fn]));
  const counted = byName(first.functions);
  assert.deepEqual(["f0", "f499", "f500", "f999", "f1000"].map((name) => counted.get(name).count), [1, 1, 3, 3, 2]);
  assert.deepEqual(first.functions.slice(0, 2).map((fn) => fn.start.line), [1, 2], "in file and line order");
  const rest = await read("i_0001", { cursor: "1500" });
  assert.deepEqual([rest.functions.length, rest.total, rest.truncated], [101, 1601, false]);
  const later = byName(rest.functions);
  assert.deepEqual([later.get("f1599").count, later.get("f1600").count, later.get("f1600").plumbing, later.get("f1599").plumbing], [2, 2, true, false]);
  assert.equal(later.has("f1601"), false, "the untagged request's own function is not the click's");
  // The request list says how many requests each click started, whatever page it reads.
  const listed = await call("readRequests", { recordingId, limit: 1 });
  assert.deepEqual(listed.interactions.map(({ id, requestCount }) => [id, requestCount]), [["i_0001", 2]]);

  // A click that started no request has nothing to show; one the recording does not hold is not found.
  assert.deepEqual(await read("i_0002"), {
    functions: [], total: 0, truncated: false, requests: [], interaction: { id: "i_0002", label: "link \"Home\"", kind: "click", componentFile: null }
  });
  for (const unknown of ["i_0009", "i_1;drop", "r_000001", ""]) {
    await assert.rejects(read(unknown), { statusCode: 404, code: "vibe64_usage_recording_interaction_not_found" }, unknown);
  }
});

test("trace lines are validated, merged per scope and kept per process", async (t) => {
  const directory = await temporary(t);
  await writeFile(path.join(directory, "hits-nodejs-10.ndjson"), ndjson([
    { type: "tracer", state: "ready" },
    header(10),
    { type: "tracer", state: "ready" },
    ...declare(0, 0, "lib/a.mjs", 3),
    "not json",
    `{"type":"diagnostic","code":"X","path":"${"p".repeat(USAGE_RECORDING_LIMITS.traceLineBytes)}"}`,
    { type: "function", functionIndex: 1, fileIndex: 9, name: "lost", start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
    { type: "hits", scope: "r_000001", counts: [[0, 2], [7, 1]] },
    { type: "scope", scope: "r_000001", kind: "request", startedAt: at },
    { type: "hits", scope: "r_000001", counts: [[0, 3]] },
    { type: "scope", scope: "r_000001", kind: "request", startedAt: at, endedAt: "2026-10-30T10:00:01.000Z" },
    { type: "file", fileIndex: 1, path: "../outside.js", hash: HASH },
    header(10)
  ]));
  // A second process: its own index space, a null count and a partial line.
  const second = path.join(directory, "hits-php-11-2.ndjson");
  await writeFile(second, ndjson([
    { ...header(11), runtime: "php" },
    { type: "tracer", state: "ready" },
    ...declare(0, 0, "lib/b.php", 8),
    { type: "scope", scope: "r_000001", kind: "request", startedAt: at },
    { type: "hits", scope: "r_000001", counts: [[0, null]] }
  ]) + '{"type":"hits","scope":"r_000002"');
  await writeFile(path.join(directory, "hits-ruby-12.ndjson"), ndjson([header(12)]));

  const reader = createTraceReader(directory);
  await reader.poll();
  // Before the header, not JSON, too long, an undeclared file, an unknown
  // function, a path outside the source root and a second header.
  assert.deepEqual(reader.problems(), { malformedLines: 7, diagnostics: 0, skippedFiles: 0 });
  assert.deepEqual(reader.scopeFunctions("r_000001").map(({ path: file, name, count }) => ({ file, name, count })), [
    { file: "lib/a.mjs", name: "f3", count: 5 },
    { file: "lib/b.php", name: "f8", count: null }
  ]);
  assert.equal(reader.scopes().get("r_000001").endedAt, "2026-10-30T10:00:01.000Z");
  assert.deepEqual(reader.counts(), { requests: 1, functions: 2 });
  // The partial line completes on the next poll.
  await appendFile(second, ',"counts":[[0,1]]}\n');
  await reader.poll();
  assert.deepEqual(reader.scopeFunctions("r_000002").map(({ name, count }) => ({ name, count })), [{ name: "f8", count: 1 }]);
  assert.equal(reader.problems().malformedLines, 7);
});

test("the launch readiness check is its own row, outside the counts and plumbing", async (t) => {
  const directory = await temporary(t);
  await writeFile(path.join(directory, "requests.ndjson"), ndjson([
    { id: "r_000001", seq: 1, method: "GET", path: "/api/items", status: 200, startedAt: "2026-10-30T10:00:02.000Z", durationMs: 4, interaction: null }
  ]));
  await writeFile(path.join(directory, "hits-nodejs-10.ndjson"), ndjson([
    header(10),
    { type: "tracer", state: "ready" },
    ...declare(0, 0, "server/health.js", 3),
    ...declare(1, 1, "server/items.js", 9),
    { type: "scope", scope: "r_000000", kind: "request", startedAt: "2026-10-30T10:00:01.000Z" },
    { type: "hits", scope: "r_000000", counts: [[0, 1]] },
    { type: "scope", scope: "r_000001", kind: "request", startedAt: "2026-10-30T10:00:02.000Z" },
    { type: "hits", scope: "r_000001", counts: [[0, 1], [1, 1]] },
    { type: "scope", scope: "l_10_1", kind: "local-request", label: "GET /api/items", startedAt: "2026-10-30T10:00:03.000Z" },
    { type: "hits", scope: "l_10_1", counts: [[0, 1], [1, 1]] },
    { type: "scope", scope: "r_000002", kind: "request", startedAt: "2026-10-30T10:00:04.000Z" },
    { type: "hits", scope: "r_000002", counts: [[0, 1], [1, 1]] }
  ]));
  const reader = createTraceReader(directory);
  await reader.poll();
  assert.deepEqual(reader.counts(), { requests: 3, functions: 2 });
  const rows = await recordingRequestRows(directory, reader);
  assert.deepEqual(rows.map(({ id, kind, method, path: requestPath, status }) => ({ id, kind, method, path: requestPath, status })), [
    { id: "r_000000", kind: "readiness", method: null, path: null, status: null },
    { id: "r_000001", kind: undefined, method: "GET", path: "/api/items", status: 200 },
    { id: "l_10_1", kind: undefined, method: "GET", path: "/api/items", status: null },
    { id: "r_000002", kind: undefined, method: null, path: null, status: null }
  ]);
  assert.equal(rows[0].functionCount, 1);
});

test("trace reads stop at the per-process and per-recording size limits", async (t) => {
  const directory = await temporary(t);
  const line = `${JSON.stringify({ type: "diagnostic", code: "PARSE_FAILED", path: `lib/${"x".repeat(60 * 1024)}.mjs` })}\n`;
  const perFile = Math.ceil((USAGE_RECORDING_LIMITS.hitsBytesPerProcess + 1024 * 1024) / line.length);
  for (const pid of [1, 2, 3]) {
    await writeFile(path.join(directory, `hits-nodejs-${pid}.ndjson`), ndjson([header(pid)]) + line.repeat(perFile));
  }
  const reader = createTraceReader(directory);
  await reader.poll();
  assert.equal(reader.hitsBytes(), USAGE_RECORDING_LIMITS.hitsBytesPerRecording);
  const single = await temporary(t);
  await writeFile(path.join(single, "hits-nodejs-1.ndjson"), ndjson([header(1)]) + line.repeat(perFile));
  const one = createTraceReader(single);
  await one.poll();
  assert.equal(one.hitsBytes(), USAGE_RECORDING_LIMITS.hitsBytesPerProcess + USAGE_RECORDING_LIMITS.traceLineBytes);
});

// "blocked" when a read waits on a FIFO; the FIFOs are then opened for
// writing and closed, so the waiting read ends.
async function unlessBlocked(read, fifos) {
  const result = await Promise.race([read, delay(1000).then(() => "blocked")]);
  if (result !== "blocked") return result;
  for (const fifo of fifos) await (await open(fifo, constants.O_WRONLY | constants.O_NONBLOCK).catch(() => null))?.close();
  await read;
  return result;
}

// The ids of a recording's request rows before any trace is read: only the Preview proxy's request log.
async function loggedRequestIds(directory) {
  return (await recordingRequestRows(directory, createTraceReader(directory))).map((row) => row.id);
}

test("recording files are read only as regular files within their caps, and written through no link", async (t) => {
  const directory = await temporary(t);
  const outside = await temporary(t);
  const request = (id) => ({ id, seq: Number(id.slice(2)), method: "GET", path: "/api/x", status: 200, startedAt: at, durationMs: 1, interaction: null });
  const log = path.join(directory, "requests.ndjson");
  // A log linked elsewhere is not read.
  await writeFile(path.join(outside, "requests.ndjson"), ndjson([request("r_000001")]));
  await symlink(path.join(outside, "requests.ndjson"), log);
  assert.deepEqual(await loggedRequestIds(directory), []);
  // A log is read up to 8 MiB: a line after that is not.
  await rm(log);
  const filler = `${"x".repeat(60 * 1024)}\n`;
  await writeFile(log, ndjson([request("r_000001")]) + filler.repeat(Math.ceil(8 * 1024 * 1024 / filler.length)) + ndjson([request("r_000002")]));
  assert.deepEqual(await loggedRequestIds(directory), ["r_000001"]);
  // A FIFO is never waited on, as a log or as a hits file; a linked hits file is not read.
  const fifos = [path.join(directory, "interactions.ndjson"), path.join(directory, "hits-nodejs-7.ndjson")];
  await exec("mkfifo", fifos);
  assert.deepEqual(await unlessBlocked(readInteractions(directory), fifos), []);
  await writeFile(path.join(outside, "hits.ndjson"), ndjson([header(8), { type: "tracer", state: "ready" }, ...declare(0, 0, "lib/a.mjs", 3),
    { type: "hits", scope: "r_000001", counts: [[0, 1]] }]));
  await symlink(path.join(outside, "hits.ndjson"), path.join(directory, "hits-nodejs-8.ndjson"));
  const reader = createTraceReader(directory);
  assert.equal(await unlessBlocked(reader.poll(), fifos), undefined);
  assert.deepEqual(reader.counts(), { requests: 0, functions: 0 });
  // A file Vibe64 replaces is written to a new temporary file, never through
  // a link placed where it writes; a linked JSON file is not read.
  const target = path.join(outside, "target.json");
  await writeFile(target, "unchanged");
  await symlink(target, path.join(directory, `recording.json.${process.pid}.tmp`));
  await writeJsonFile(path.join(directory, "recording.json"), { state: "recording" });
  assert.equal(await readFile(target, "utf8"), "unchanged");
  assert.deepEqual(await readJsonFile(path.join(directory, "recording.json")), { state: "recording" });
  await symlink(path.join(directory, "recording.json"), path.join(directory, "linked.json"));
  assert.equal(await readJsonFile(path.join(directory, "linked.json")), null);
});

test("a session keeps its newest recordings within the count, size and age limits", async (t) => {
  const sessionRoot = await temporary(t);
  const now = Date.parse("2026-10-30T12:00:00.000Z");
  const recordingsRoot = path.join(sessionRoot, "usage-recordings");
  const ids = [];
  for (let index = 0; index < 14; index += 1) {
    const id = `rec_${String.fromCharCode(97 + index).repeat(20)}`;
    ids.push(id);
    const directory = path.join(recordingsRoot, id);
    await mkdir(directory, { recursive: true });
    // Newest first: a; b is too big for the size budget; m and n are older than the age limit.
    const startedAt = index < 12 ? now - (index + 1) * 60_000 : now - USAGE_RECORDING_RETENTION.maxAgeMs - index * 60_000;
    await writeFile(path.join(directory, "recording.json"), JSON.stringify({
      schema: "vibe64.usage-recording.v1", id, sessionId: "session-fixture", state: "stopped", target: { id: "preview", kind: "web", label: "Preview" },
      runtimes: ["nodejs"], tracers: [], startedAt: new Date(startedAt).toISOString(), stoppedAt: new Date(startedAt + 1000).toISOString(),
      stopReason: "person", counts: { requests: 0, functions: 0 }, truncated: false, dismissedAt: null, sourceIdentity: null
    }));
    if (index === 1) {
      await writeFile(path.join(directory, "hits-nodejs-1.ndjson"), "");
      await truncate(path.join(directory, "hits-nodejs-1.ndjson"), USAGE_RECORDING_RETENTION.maxBytes);
    }
  }
  await writeFile(path.join(recordingsRoot, "notes.txt"), "kept: not a recording");
  await fixtureService(sessionRoot, new Date(now).toISOString())("readCurrent");
  const kept = (await readdir(recordingsRoot)).sort();
  assert.deepEqual(kept, [ids[0], ...ids.slice(2, 11), "notes.txt"].sort());
});

test("an archived session takes no recordings or architecture caches with it", async (t) => {
  const root = await temporary(t);
  const store = createVibe64SessionStore({ projectContextRoot: path.join(root, "project"), projectRuntimeRoot: path.join(root, "state") });
  await mkdir(path.join(root, "project"));
  await store.createSession({ sessionId: "archived-one", runtimeKind: "genesis" });
  const paths = store.paths("archived-one");
  await mkdir(path.join(paths.sessionRoot, "usage-recordings", RECORDING_ID), { recursive: true });
  await writeFile(path.join(paths.sessionRoot, "usage-recordings", RECORDING_ID, "recording.json"), "{}");
  await mkdir(path.join(paths.sessionRoot, "architecture-cache", "jskit"), { recursive: true });
  await writeFile(path.join(paths.sessionRoot, "architecture-cache", "jskit", "jskit-calls.json"), "{}");
  await writeFile(path.join(paths.sessionRoot, "kept.txt"), "kept");
  await store.writeMetadataValue("archived-one", "session_closing_reason", "closing");
  await store.writeStatus("archived-one", "archived");
  await store.publishSessionArchive("archived-one");
  const listing = (await exec("tar", ["-tzf", path.join(paths.archivedSessionsRoot, "archived-one.tar.gz")])).stdout;
  assert.ok(listing.includes("kept.txt"));
  assert.ok(!listing.includes("usage-recordings"));
  assert.ok(!listing.includes("architecture-cache"));
  await assert.rejects(readdir(path.join(paths.sessionRoot, "usage-recordings")), { code: "ENOENT" });
});
