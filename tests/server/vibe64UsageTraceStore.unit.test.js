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
import { createVibe64SessionStore } from "@local/vibe64-runtime/server";
import { USAGE_RECORDING_LIMITS, USAGE_RECORDING_RETENTION } from "@local/vibe64-usage-recording/shared/contract";
import { createService } from "../../packages/vibe64-usage-recording/src/server/service.js";
import {
  createTraceReader,
  readInteractions,
  readJsonFile,
  readRequestLog,
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
    now: () => Date.parse(nowIso),
    projectService: { createRuntime: async () => ({ getSession: async () => session }) },
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
  const functions = await call("readRequestFunctions", { recordingId: RECORDING_ID, requestId: "r_000004", limit: 5 });
  assert.deepEqual([functions.functions.length, functions.total, functions.truncated], [5, 16, true]);
  const startUp = await call("readRequestFunctions", { recordingId: RECORDING_ID, requestId: "bg_4242" });
  assert.deepEqual([startUp.functions.length, startUp.functions[0].name, startUp.truncated], [7, "createLogger", false]);
  await assert.rejects(call("readRequestFunctions", { recordingId: RECORDING_ID, requestId: "x_1" }), { statusCode: 404 });
  await assert.rejects(call("readRequests", { recordingId: "rec_aaaaaaaaaaaaaaaaaaaa" }), { statusCode: 404 });
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

test("recording files are read only as regular files within their caps, and written through no link", async (t) => {
  const directory = await temporary(t);
  const outside = await temporary(t);
  const request = (id) => ({ id, seq: Number(id.slice(2)), method: "GET", path: "/api/x", status: 200, startedAt: at, durationMs: 1, interaction: null });
  const log = path.join(directory, "requests.ndjson");
  // A log linked elsewhere is not read.
  await writeFile(path.join(outside, "requests.ndjson"), ndjson([request("r_000001")]));
  await symlink(path.join(outside, "requests.ndjson"), log);
  assert.deepEqual(await readRequestLog(directory), []);
  // A log is read up to 8 MiB: a line after that is not.
  await rm(log);
  const filler = `${"x".repeat(60 * 1024)}\n`;
  await writeFile(log, ndjson([request("r_000001")]) + filler.repeat(Math.ceil(8 * 1024 * 1024 / filler.length)) + ndjson([request("r_000002")]));
  assert.deepEqual((await readRequestLog(directory)).map((row) => row.id), ["r_000001"]);
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
