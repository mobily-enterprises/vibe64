import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CRASH_RECORDS_LIMIT,
  MARKER_NAME_PATTERN,
  acknowledgeVibe64Crashes,
  crashForInterruptedTurn,
  crashRecordId,
  readVibe64CrashRecords,
  recordVibe64CrashResumedTurns,
  writeCrashRecordSync
} from "@local/vibe64-core/server/crashRecords";
import { crashError, markerProcessAlive, recordUntracedStops, startCrashWatch } from "@local/vibe64-core/server/crashWatch";
import { crashBugReport, crashMessage, crashTurnsText } from "@local/vibe64-core/shared/crashText";
import { createCrashService } from "../../packages/studio-health/src/server/crashes.js";

// The crash records (crashRecords.js) and how a server's process records its own end (crashWatch.js): what a record
// holds, the cap that keeps the newest 100 and counts the rest, who acknowledged and when, what a member sees, and
// the two ways a process ends: one that records its own crash and one that leaves only its running marker behind.

const CRASH_WATCH = fileURLToPath(new URL("../../packages/vibe64-core/src/server/crashWatch.js", import.meta.url));
const SILENT = { info() {}, warn() {}, error() {}, debug() {} };

async function systemRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-crash-records-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function fatalRecord(at, overrides = {}) {
  return {
    id: crashRecordId(at, 4242),
    at,
    pid: 4242,
    kind: "fatal-error",
    origin: "uncaughtException",
    error: { name: "Error", message: "read ECONNRESET", code: "ECONNRESET", stack: "Error: read ECONNRESET\n    at TCP.onStreamRead" },
    uptimeSeconds: 61,
    version: "vibe64@0.1.81",
    activeTurns: 2,
    resumed: null,
    acknowledged: null,
    ...overrides
  };
}

const minute = (n) => new Date(Date.UTC(2026, 10, 24, 4, n, 5)).toISOString();
const crashes = (root) => path.join(root, "crashes");

test("a record is written whole, private, and read back newest first with the count nobody acknowledged", async (t) => {
  const root = await systemRoot(t);
  const older = fatalRecord(minute(1));
  const newer = fatalRecord(minute(2), { kind: "stopped-without-trace", error: null, lastHeartbeatAt: minute(1), exit: null });
  writeCrashRecordSync({ systemRoot: root, record: older });
  writeCrashRecordSync({ systemRoot: root, record: newer });

  const read = await readVibe64CrashRecords({ systemRoot: root });
  assert.deepEqual(read.records.map((record) => record.id), [newer.id, older.id]);
  assert.deepEqual(read.records[1], older);
  assert.equal(read.unacknowledged, 2);
  assert.deepEqual(read.removed, { count: 0, unacknowledged: 0, lastRemovedAt: null });
  assert.equal((await stat(path.join(crashes(root), "records"))).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(crashes(root), "records", `${older.id}.json`))).mode & 0o777, 0o600);
  assert.deepEqual((await readdir(path.join(crashes(root), "records"))).sort(), [`${older.id}.json`, `${newer.id}.json`].sort(),
    "no temporary file is left beside the records");
});

test(`only the newest ${CRASH_RECORDS_LIMIT} records are kept, and the removed ones are counted, never dropped silently`, async (t) => {
  const root = await systemRoot(t);
  const written = [];
  for (let index = 0; index < CRASH_RECORDS_LIMIT + 3; index += 1) {
    const record = fatalRecord(new Date(Date.UTC(2026, 10, 24, 0, 0, index)).toISOString(), {
      acknowledged: index === 1 ? { at: minute(0), by: { username: "ana", displayName: "Ana" } } : null
    });
    writeCrashRecordSync({ systemRoot: root, record });
    written.push(record);
  }
  const read = await readVibe64CrashRecords({ systemRoot: root });
  assert.equal(read.records.length, CRASH_RECORDS_LIMIT);
  assert.deepEqual(read.records.map((record) => record.id), written.slice(3).map((record) => record.id).reverse());
  assert.equal(read.removed.count, 3);
  assert.equal(read.removed.unacknowledged, 2, "the one already acknowledged is counted as removed, not as waiting");
  assert.equal(typeof read.removed.lastRemovedAt, "string");
  assert.equal(read.unacknowledged, CRASH_RECORDS_LIMIT + 2);

  const { acknowledged } = await acknowledgeVibe64Crashes({ systemRoot: root, through: written.at(-1).id, by: { username: "ana", displayName: "Ana" } });
  assert.equal(acknowledged, CRASH_RECORDS_LIMIT + 2);
  const after = await readVibe64CrashRecords({ systemRoot: root });
  assert.equal(after.unacknowledged, 0);
  assert.deepEqual(after.removed, { ...read.removed, unacknowledged: 0 });
});

test("acknowledging records who and when, up to the newest crash shown; a later crash stays to be seen", async (t) => {
  const root = await systemRoot(t);
  const first = fatalRecord(minute(1));
  const shown = fatalRecord(minute(2));
  const later = fatalRecord(minute(3));
  for (const record of [first, shown, later]) writeCrashRecordSync({ systemRoot: root, record });

  const at = "2026-11-24T05:00:00.000Z";
  const result = await acknowledgeVibe64Crashes({ systemRoot: root, through: shown.id, by: { username: "ana", displayName: "Ana Owner" }, at });
  assert.deepEqual(result, { acknowledged: 2 });
  const { records, unacknowledged } = await readVibe64CrashRecords({ systemRoot: root });
  assert.deepEqual(records.map((record) => record.acknowledged), [
    null,
    { at, by: { username: "ana", displayName: "Ana Owner" } },
    { at, by: { username: "ana", displayName: "Ana Owner" } }
  ]);
  assert.equal(unacknowledged, 1);
  const stored = JSON.parse(await readFile(path.join(crashes(root), "records", `${shown.id}.json`), "utf8"));
  assert.deepEqual(stored.acknowledged, { at, by: { username: "ana", displayName: "Ana Owner" } }, "the acknowledgement is on disk");
  await assert.rejects(acknowledgeVibe64Crashes({ systemRoot: root, through: "../x", by: {} }), TypeError);
});

test("the owner's banner has the error; a member's has only when and the AI work, and a member can't read or acknowledge", async (t) => {
  const root = await systemRoot(t);
  const record = fatalRecord(minute(2), { resumed: 2 });
  writeCrashRecordSync({ systemRoot: root, record });
  const service = createCrashService({ systemRoot: root });
  const owner = { username: "ana", displayName: "Ana", role: "owner" };
  const member = { username: "bea", displayName: "Bea", role: "member" };

  const forOwner = await service.summary({ vibe64User: owner });
  assert.equal(forOwner.canAcknowledge, true);
  assert.equal(forOwner.unacknowledged, 1);
  assert.equal(forOwner.latest.error.message, "read ECONNRESET");
  assert.equal(forOwner.latest.error.stack, record.error.stack, "Copy for a bug report copies the whole record");

  const forMember = await service.summary({ vibe64User: member });
  assert.deepEqual(forMember, {
    ok: true,
    canAcknowledge: false,
    unacknowledged: 1,
    latest: { id: record.id, at: record.at, kind: "fatal-error", lastHeartbeatAt: null, activeTurns: 2, resumed: 2 }
  });
  await assert.rejects(service.list({ vibe64User: member }), { statusCode: 403, code: "vibe64_owner_required" });
  await assert.rejects(service.acknowledge({ vibe64User: member, through: record.id }), { statusCode: 403, code: "vibe64_owner_required" });
  assert.equal((await service.summary({ vibe64User: member })).unacknowledged, 1, "a member's refused acknowledgement changes nothing");

  // The person at their own computer has no signed-in user: they own it, and their account name is recorded.
  assert.equal((await service.list({})).records.length, 1);
  assert.deepEqual(await service.acknowledge({ through: record.id }), { ok: true, acknowledged: 1 });
  const [acknowledged] = (await readVibe64CrashRecords({ systemRoot: root })).records;
  assert.equal(acknowledged.acknowledged.by.username, os.userInfo().username);
  assert.deepEqual(await service.summary({ vibe64User: member }), { ok: true, canAcknowledge: false, unacknowledged: 0, latest: null });
});

test("a record's resumed turns are recorded, and an interrupted turn finds the crash that stopped it", async (t) => {
  const root = await systemRoot(t);
  const early = fatalRecord(minute(1));
  const crash = fatalRecord(minute(10));
  for (const record of [early, crash]) writeCrashRecordSync({ systemRoot: root, record });

  assert.equal((await crashForInterruptedTurn({ systemRoot: root, startedAt: minute(5) }))?.id, crash.id);
  assert.equal(await crashForInterruptedTurn({ systemRoot: root, startedAt: minute(20) }), null,
    "a turn started after every crash was stopped some other way");
  assert.equal((await recordVibe64CrashResumedTurns({ systemRoot: root, id: crash.id, resumed: 1 })).resumed, 1);
  const [stored] = (await readVibe64CrashRecords({ systemRoot: root })).records;
  assert.equal(stored.resumed, 1);
  assert.equal(crashTurnsText(stored), "1 of the 2 AI turns that were running were resumed; the others were stopped.");
  assert.equal(await recordVibe64CrashResumedTurns({ systemRoot: root, id: crashRecordId(minute(30), 1), resumed: 1 }), null);
  await assert.rejects(recordVibe64CrashResumedTurns({ systemRoot: root, id: crash.id, resumed: -1 }), TypeError);
});

test("a record that can't be read is shown as unreadable, not counted, and not lost", async (t) => {
  const root = await systemRoot(t);
  const id = crashRecordId(minute(3), 7);
  await mkdir(path.join(crashes(root), "records"), { recursive: true });
  await writeFile(path.join(crashes(root), "records", `${id}.json`), "{ half a record");
  const { records, unacknowledged } = await readVibe64CrashRecords({ systemRoot: root });
  assert.equal(records[0].kind, "unreadable");
  assert.equal(records[0].at, minute(3), "its time is the one its id names");
  assert.equal(unacknowledged, 0);
  assert.equal(crashMessage(records[0]), "its crash record could not be read");
});

test("a crash keeps the error's name, message, code and causes, with secrets redacted as the log redacts them", () => {
  const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
  const error = Object.assign(new TypeError("request failed with Authorization: Bearer abc.def.ghi", { cause }), { code: "E_FETCH" });
  const kept = crashError(error);
  assert.equal(kept.name, "TypeError");
  assert.equal(kept.code, "E_FETCH");
  assert.doesNotMatch(`${kept.message}\n${kept.stack}`, /abc\.def\.ghi/u);
  assert.match(kept.stack, /^TypeError: request failed/u);
  assert.match(kept.stack, /Caused by: Error: connect ECONNREFUSED/u);
  assert.deepEqual(crashError("plain words"), { name: "Error", message: "plain words", code: null, stack: null });
  assert.equal(crashMessage({ kind: "fatal-error", error: kept }), `TypeError: ${kept.message}`);
  assert.equal(crashMessage({ kind: "fatal-error", error: { name: "Error", message: "read ECONNRESET" } }), "read ECONNRESET");
  assert.equal(crashMessage({ kind: "stopped-without-trace", exit: { result: "oom-kill", code: "killed", status: "KILL" } }),
    "it stopped without a trace (oom-kill, killed, KILL)");
  const report = crashBugReport(fatalRecord(minute(2)));
  assert.match(report, /^Vibe64 crash: read ECONNRESET\n/u);
  assert.match(report, /Version: vibe64@0\.1\.81/u);
  assert.match(report, /Error: Error: read ECONNRESET \(code ECONNRESET\)/u);
  assert.match(report, /at TCP\.onStreamRead/u);
});

test("a marker's process is alive only while that same process, of that boot, still runs", () => {
  const marker = { processStart: "100", processStartedAt: new Date().toISOString(), bootId: "boot-a" };
  const live = { signal() {}, startTicks: () => "100", bootId: "boot-a" };
  assert.equal(markerProcessAlive({ pid: 99999, marker }, live), true);
  assert.equal(markerProcessAlive({ pid: 99999, marker }, { ...live, bootId: "boot-b" }), false, "a reboot since");
  assert.equal(markerProcessAlive({ pid: 99999, marker }, { ...live, startTicks: () => "200" }), false, "the pid was reused");
  assert.equal(markerProcessAlive({ pid: 99999, marker }, {
    ...live,
    signal() { throw Object.assign(new Error("gone"), { code: "ESRCH" }); }
  }), false);
  assert.equal(markerProcessAlive({ pid: 99999, marker: null }, live), false, "a marker that can't be read");
});

test("a watched process records any non-zero exit, records nothing on a clean one, and its stop leaves nothing", async (t) => {
  const root = await systemRoot(t);
  const fakeProcess = new EventEmitter();
  const watch = startCrashWatch({ systemRoot: root, version: "vibe64@test", logger: SILENT, processRef: fakeProcess });
  assert.equal((await readdir(path.join(crashes(root), "running"))).length, 1, "a running server holds its marker");
  fakeProcess.emit("exit", 3);
  const [record] = (await readVibe64CrashRecords({ systemRoot: root })).records;
  assert.equal(record.kind, "fatal-error");
  assert.equal(record.origin, "exit");
  assert.equal(record.error.message, "Vibe64 exited with code 3.");
  assert.equal(record.version, "vibe64@test");
  assert.equal(record.activeTurns, null);
  assert.equal(record.activeTurnsPending, true, "the next start counts the turns it left working");
  assert.deepEqual(await readdir(path.join(crashes(root), "running")), []);
  watch.stop();
  assert.equal(fakeProcess.listenerCount("exit"), 0);

  const clean = new EventEmitter();
  startCrashWatch({ systemRoot: root, version: "vibe64@test", logger: SILENT, processRef: clean });
  clean.emit("exit", 0);
  assert.deepEqual(await readdir(path.join(crashes(root), "running")), []);
  assert.equal((await readVibe64CrashRecords({ systemRoot: root })).records.length, 1, "a clean end records nothing");
  assert.equal(clean.listenerCount("exit"), 0);

  const stopping = new EventEmitter();
  const failed = startCrashWatch({ systemRoot: root, version: "vibe64@test", logger: SILENT, processRef: stopping });
  failed.recordStopFailure(Object.assign(new Error("Vibe64 did not stop within 8000 ms; still running: fastify."), { code: "vibe64_shutdown_timeout" }));
  stopping.emit("exit", 1);
  const { records } = await readVibe64CrashRecords({ systemRoot: root });
  assert.deepEqual(records.map((entry) => entry.origin).sort(), ["exit", "stop"], "the exit after a recorded stop adds nothing");
  assert.equal(records.find((entry) => entry.origin === "stop").error.code, "vibe64_shutdown_timeout");
});

/** A child process that holds a crash watch on `root`, then runs `then` (module code). */
function watchedChild(root, then) {
  const source = [
    `import { startCrashWatch } from ${JSON.stringify(CRASH_WATCH)};`,
    `startCrashWatch({ systemRoot: ${JSON.stringify(root)}, version: "vibe64@child", logger: console, heartbeatMs: 50 });`,
    "process.stdout.write(\"watching\\n\");",
    then
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return { child, exited: once(child, "exit"), stderr: () => stderr };
}

test("a child process whose promise rejects unhandled records it and still exits with code 1", async (t) => {
  const root = await systemRoot(t);
  const { exited, stderr } = watchedChild(root, "setTimeout(() => Promise.reject(Object.assign(new Error(\"lost the socket\"), { code: \"ECONNRESET\" })), 10);");
  const [code] = await exited;
  assert.equal(code, 1, stderr());
  assert.match(stderr(), /lost the socket/u, "Node still prints the error");
  const [record] = (await readVibe64CrashRecords({ systemRoot: root })).records;
  assert.equal(record.kind, "fatal-error");
  assert.equal(record.origin, "unhandledRejection");
  assert.deepEqual([record.error.name, record.error.message, record.error.code], ["Error", "lost the socket", "ECONNRESET"]);
  assert.deepEqual(await readdir(path.join(crashes(root), "running")), []);
});

test("a process killed with SIGKILL leaves its marker, and the next start records it with its last heartbeat and the host's exit", async (t) => {
  const root = await systemRoot(t);
  const { child, exited } = watchedChild(root, "setInterval(() => {}, 1000);");
  await once(child.stdout, "data");
  await new Promise((resolve) => setTimeout(resolve, 200));
  child.kill("SIGKILL");
  await exited;
  assert.equal((await readVibe64CrashRecords({ systemRoot: root })).records.length, 0, "a killed process records nothing itself");
  // Killed while its heartbeat rewrote the marker, it also leaves that write's temporary file, which no reader takes.
  const markers = async () => (await readdir(path.join(crashes(root), "running"))).filter((name) => MARKER_NAME_PATTERN.test(name));
  const [marker] = await markers();
  assert.match(marker, new RegExp(`^${child.pid}-`, "u"));
  // The host's supervisor says how it ended (systemd's ExecStopPost can write this).
  await writeFile(path.join(crashes(root), "last-exit.json"), JSON.stringify({ result: "signal", code: "killed", status: "KILL" }));

  const recorded = await recordUntracedStops({ systemRoot: root, countActiveTurns: async () => 2, logger: SILENT });
  assert.equal(recorded.length, 1);
  const [record] = (await readVibe64CrashRecords({ systemRoot: root })).records;
  assert.equal(record.kind, "stopped-without-trace");
  assert.equal(record.pid, child.pid);
  assert.equal(record.error, null);
  assert.equal(record.version, "vibe64@child");
  assert.equal(typeof record.lastHeartbeatAt, "string");
  assert.ok(Number.isInteger(record.uptimeSeconds));
  assert.deepEqual(record.exit, { result: "signal", code: "killed", status: "KILL" });
  assert.equal(record.activeTurns, 2, "the turns it left working are counted at that start");
  assert.equal(record.activeTurnsPending, undefined);
  assert.equal(record.acknowledged, null);
  assert.deepEqual(await markers(), []);
  assert.deepEqual((await readdir(crashes(root))).sort(), ["records", "running"], "the host's exit file is taken");

  // A start after a clean stop finds nothing, and counts nothing again.
  assert.deepEqual(await recordUntracedStops({ systemRoot: root, countActiveTurns: async () => 5, logger: SILENT }), []);
  assert.equal((await readVibe64CrashRecords({ systemRoot: root })).records[0].activeTurns, 2);
});

test("the next start leaves the marker of a server that is still running alone", async (t) => {
  const root = await systemRoot(t);
  const watch = startCrashWatch({ systemRoot: root, version: "vibe64@test", logger: SILENT, processRef: new EventEmitter() });
  t.after(() => watch.stop());
  assert.deepEqual(await recordUntracedStops({ systemRoot: root, countActiveTurns: async () => 0, logger: SILENT }), []);
  assert.equal((await readdir(path.join(crashes(root), "running"))).length, 1);
  assert.equal((await readVibe64CrashRecords({ systemRoot: root })).records.length, 0);
});
