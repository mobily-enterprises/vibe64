// The crash records of one Vibe64 installation: every abnormal end of its editor server, kept in its system root for
// the people who can fix what caused it (the editor's red banner and Crashes page) and for a host's own reports
// (Vibe64 Online's VPS report reads them with readVibe64CrashRecords, as it reads working turns).
//
//   <systemRoot>/crashes/records/<id>.json   one record per abnormal end; ids sort by the time they were recorded
//   <systemRoot>/crashes/running/<pid>-<instance>.json
//                                            one marker per running editor server, removed when it stops cleanly or
//                                            has recorded its crash: one left by a process that is gone is a process
//                                            that died without a trace (SIGKILL, an out-of-memory kill, power loss)
//   <systemRoot>/crashes/removed.json        how many of the oldest records the cap removed, so none goes silently
//   <systemRoot>/crashes/last-exit.json      optional: how the previous process ended, written by a host whose
//                                            supervisor knows (systemd's ExecStopPost has SERVICE_RESULT, EXIT_CODE
//                                            and EXIT_STATUS), taken into the next record of a process with no trace
//
// Folders are 0700 and files 0600, as the rest of the system root's state. A record is written whole (a temporary
// file renamed into place, synced) and only ever changed to add how many interrupted turns were resumed or who
// acknowledged it. This file imports only Node, so a host's tool can read the records under a small memory bound.

import { randomBytes } from "node:crypto";
import {
  closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeSync
} from "node:fs";
import { readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { serializeByKey, writeJsonFileAtomic } from "./atomicFile.js";

const CRASHES_DIR = "crashes";
const RECORDS_DIR = "records";
const RUNNING_DIR = "running";
const REMOVED_FILE = "removed.json";
const LAST_EXIT_FILE = "last-exit.json";
/** The records kept: past it the oldest go, and removed.json counts them. */
const CRASH_RECORDS_LIMIT = 100;
const CRASH_KIND = Object.freeze({
  FATAL_ERROR: "fatal-error",
  STOPPED_WITHOUT_TRACE: "stopped-without-trace"
});
const KINDS = new Set(Object.values(CRASH_KIND));
/** A record is a few kilobytes (its stack at most 16 000 characters); a larger file is not one of ours. */
const MAX_RECORD_BYTES = 256 * 1024;
const RECORD_ID_PATTERN = /^\d{8}T\d{9}Z-\d+-[0-9a-f]{4}$/u;
const MARKER_NAME_PATTERN = /^(\d+)-[0-9a-f]{8}\.json$/u;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
/** Each root's acknowledgements and resumed counts, one at a time. */
const pendingUpdates = new Map();

function crashesRoot(systemRoot) {
  if (!path.isAbsolute(String(systemRoot || ""))) throw new Error("Crash records live in an absolute system root.");
  return path.join(systemRoot, CRASHES_DIR);
}

const recordsFolder = (systemRoot) => path.join(crashesRoot(systemRoot), RECORDS_DIR);
const runningFolder = (systemRoot) => path.join(crashesRoot(systemRoot), RUNNING_DIR);
const recordPath = (systemRoot, id) => path.join(recordsFolder(systemRoot), `${id}.json`);

/**
 * A new record's id: when it is recorded (2026-11-24T04:18:05.123Z gives 20261124T041805123Z), the process and four
 * random hex digits, so ids sort by time and two processes recording in the same millisecond never collide.
 * @param {string} at an ISO time
 * @param {number} pid
 */
function crashRecordId(at, pid) {
  return `${at.replace(/[-:.]/gu, "")}-${pid}-${randomBytes(2).toString("hex")}`;
}

function isMissing(error) {
  return error?.code === "ENOENT";
}

/** The value written whole as JSON, synced, before this returns; what the dying process uses. */
function writeJsonFileAtomicSync(filePath, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    const descriptor = openSync(temporary, "wx", FILE_MODE);
    try {
      writeSync(descriptor, text);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, filePath);
  } finally {
    rmSync(temporary, { force: true });
  }
  const folder = openSync(directory, "r");
  try {
    fsyncSync(folder);
  } finally {
    closeSync(folder);
  }
}

function readRemovedSync(systemRoot) {
  try {
    const removed = JSON.parse(readFileSync(path.join(crashesRoot(systemRoot), REMOVED_FILE), "utf8"));
    return {
      count: Number.isSafeInteger(removed?.count) && removed.count > 0 ? removed.count : 0,
      unacknowledged: Number.isSafeInteger(removed?.unacknowledged) && removed.unacknowledged > 0 ? removed.unacknowledged : 0,
      lastRemovedAt: typeof removed?.lastRemovedAt === "string" ? removed.lastRemovedAt : null
    };
  } catch {
    return { count: 0, unacknowledged: 0, lastRemovedAt: null };
  }
}

function recordIdsSync(systemRoot) {
  try {
    return readdirSync(recordsFolder(systemRoot)).flatMap(recordIdOfFile).sort();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

function recordIdOfFile(name) {
  const id = name.endsWith(".json") ? name.slice(0, -".json".length) : "";
  return RECORD_ID_PATTERN.test(id) ? [id] : [];
}

/**
 * Keeps the newest CRASH_RECORDS_LIMIT records: the others are removed, oldest first, and removed.json counts them
 * (and those of them nobody had acknowledged) before they go.
 */
function capRecordsSync(systemRoot, { now }) {
  const ids = recordIdsSync(systemRoot);
  const excess = ids.slice(0, Math.max(0, ids.length - CRASH_RECORDS_LIMIT));
  if (excess.length === 0) return 0;
  const removed = readRemovedSync(systemRoot);
  const unacknowledged = excess.filter((id) => !parseRecordText(id, readRecordTextSync(systemRoot, id))?.acknowledged).length;
  writeJsonFileAtomicSync(path.join(crashesRoot(systemRoot), REMOVED_FILE), {
    count: removed.count + excess.length,
    unacknowledged: removed.unacknowledged + unacknowledged,
    lastRemovedAt: now
  });
  for (const id of excess) rmSync(recordPath(systemRoot, id), { force: true });
  return excess.length;
}

function readRecordTextSync(systemRoot, id) {
  try {
    return readFileSync(recordPath(systemRoot, id), "utf8");
  } catch {
    return "";
  }
}

/**
 * Writes a new record, synced before this returns, then keeps the newest CRASH_RECORDS_LIMIT. Synchronous: a process
 * that is ending writes it from its uncaught-exception monitor and its exit handler.
 * @param {{ systemRoot: string, record: object }} options
 * @returns {{ removed: number }} how many old records the cap removed
 */
function writeCrashRecordSync({ systemRoot, record }) {
  if (!RECORD_ID_PATTERN.test(String(record?.id || "")) || !KINDS.has(record.kind)) {
    throw new TypeError("A crash record needs its id and kind.");
  }
  writeJsonFileAtomicSync(recordPath(systemRoot, record.id), record);
  return { removed: capRecordsSync(systemRoot, { now: new Date().toISOString() }) };
}

/** A record's text as the record, or one that says it cannot be read (kept, so nothing vanishes unseen). */
function parseRecordText(id, text) {
  try {
    const record = JSON.parse(text);
    if (record && typeof record === "object" && KINDS.has(record.kind) && typeof record.at === "string") {
      return { ...record, id };
    }
  } catch {
    // Reported below as unreadable.
  }
  return {
    id,
    at: idTime(id),
    kind: "unreadable",
    error: { name: "Unreadable", message: "This crash record could not be read.", code: null, stack: null },
    acknowledged: null
  };
}

/** The time an id names (20261124T041805123Z → 2026-11-24T04:18:05.123Z). */
function idTime(id) {
  const [, d, t] = /^(\d{8})T(\d{9})Z/u.exec(id) || [];
  return d ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}.${t.slice(6)}Z` : "";
}

async function readRecord(systemRoot, id) {
  const text = await readFile(recordPath(systemRoot, id), "utf8").catch((error) => (isMissing(error) ? null : ""));
  if (text === null) return null;
  return parseRecordText(id, text.length > MAX_RECORD_BYTES ? "" : text);
}

async function recordIds(systemRoot) {
  const names = await readdir(recordsFolder(systemRoot)).catch((error) => {
    if (isMissing(error)) return [];
    throw error;
  });
  return names.flatMap(recordIdOfFile).sort();
}

/**
 * Every crash record of a system root, newest first, how many nobody has acknowledged yet (the removed ones among
 * them), and what the cap removed. The writer keeps at most CRASH_RECORDS_LIMIT, so this reads at most that many.
 * @param {{ systemRoot: string }} options
 */
async function readVibe64CrashRecords({ systemRoot }) {
  const ids = (await recordIds(systemRoot)).reverse().slice(0, CRASH_RECORDS_LIMIT);
  const records = [];
  for (const id of ids) {
    const record = await readRecord(systemRoot, id);
    if (record) records.push(record);
  }
  const removed = readRemovedSync(systemRoot);
  return {
    records,
    // An unreadable record can't be acknowledged, so it is shown, not counted.
    unacknowledged: records.filter((record) => record.kind !== "unreadable" && !record.acknowledged).length + removed.unacknowledged,
    removed
  };
}

/**
 * Records who acknowledged the crashes, and when: every record not yet acknowledged up to and including `through`
 * (the newest the person was shown; one recorded after it stays unacknowledged), and the removed ones.
 * @param {{ systemRoot: string, through: string, by: { username: string, displayName: string }, at?: string }} options
 * @returns {Promise<{ acknowledged: number }>}
 */
async function acknowledgeVibe64Crashes({ systemRoot, through, by, at = new Date().toISOString() }) {
  if (!RECORD_ID_PATTERN.test(String(through || ""))) throw new TypeError("Acknowledging names the newest crash shown.");
  const acknowledged = { at, by: { username: String(by?.username || ""), displayName: String(by?.displayName || "") } };
  return serializeByKey(pendingUpdates, crashesRoot(systemRoot), async () => {
    let count = 0;
    for (const id of await recordIds(systemRoot)) {
      if (id > through) break;
      const record = await readRecord(systemRoot, id);
      if (!record || record.acknowledged || record.kind === "unreadable") continue;
      await writeRecord(systemRoot, { ...record, acknowledged });
      count += 1;
    }
    const removed = readRemovedSync(systemRoot);
    if (removed.unacknowledged > 0) {
      count += removed.unacknowledged;
      await writeJsonFileAtomic(path.join(crashesRoot(systemRoot), REMOVED_FILE), { ...removed, unacknowledged: 0 }, {
        directoryMode: DIRECTORY_MODE,
        fileMode: FILE_MODE
      });
    }
    return { acknowledged: count };
  });
}

function writeRecord(systemRoot, record) {
  const { id, ...stored } = record;
  return writeJsonFileAtomic(recordPath(systemRoot, id), { id, ...stored }, { directoryMode: DIRECTORY_MODE, fileMode: FILE_MODE });
}

/**
 * Records how many of the turns a crash interrupted were resumed after the restart (the record's `resumed`; null
 * until someone says).
 * @param {{ systemRoot: string, id: string, resumed: number }} options
 * @returns {Promise<object | null>} the record as now stored, or null when there is none with that id
 */
async function recordVibe64CrashResumedTurns({ systemRoot, id, resumed }) {
  if (!RECORD_ID_PATTERN.test(String(id || "")) || !Number.isSafeInteger(resumed) || resumed < 0) {
    throw new TypeError("Resumed turns are a count for one crash record.");
  }
  return serializeByKey(pendingUpdates, crashesRoot(systemRoot), async () => {
    const record = await readRecord(systemRoot, id);
    if (!record || record.kind === "unreadable") return null;
    const next = { ...record, resumed };
    await writeRecord(systemRoot, next);
    return next;
  });
}

/**
 * Sets how many turns were working when the crash happened on a record still to count them (activeTurnsPending):
 * the next start counts the turns still marked working, which only that crash can have left so.
 */
async function recordVibe64CrashActiveTurns({ systemRoot, id, activeTurns }) {
  return serializeByKey(pendingUpdates, crashesRoot(systemRoot), async () => {
    const record = await readRecord(systemRoot, id);
    if (!record || record.activeTurnsPending !== true) return record;
    const { activeTurnsPending: _counted, ...rest } = record;
    const next = { ...rest, activeTurns };
    await writeRecord(systemRoot, next);
    return next;
  });
}

/**
 * The crash that interrupted a turn started at `startedAt`: the first recorded at or after it, or null (a turn that
 * started after every crash was stopped some other way, such as a restart for an update).
 * @param {{ systemRoot: string, startedAt: string }} options
 */
async function crashForInterruptedTurn({ systemRoot, startedAt }) {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return null;
  for (const id of await recordIds(systemRoot)) {
    if (Date.parse(idTime(id)) < started) continue;
    const record = await readRecord(systemRoot, id);
    if (record && record.kind !== "unreadable") return record;
  }
  return null;
}

/** Writes a running server's marker (its heartbeat rewrites it). */
function writeRunningMarkerSync({ systemRoot, marker }) {
  writeJsonFileAtomicSync(path.join(runningFolder(systemRoot), `${marker.pid}-${marker.instance}.json`), marker);
}

/**
 * Rewrites a running server's marker for its heartbeat, unsynced, and never makes its folder: one that is gone (a
 * test's system root removed under a server it left running) stays gone, and this resolves false.
 */
async function rewriteRunningMarker({ systemRoot, marker }) {
  const file = path.join(runningFolder(systemRoot), `${marker.pid}-${marker.instance}.json`);
  const temporary = `${path.join(path.dirname(file), `.${path.basename(file)}`)}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(marker), { flag: "wx", mode: FILE_MODE });
    await rename(temporary, file);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}

function removeRunningMarkerSync({ systemRoot, marker }) {
  rmSync(path.join(runningFolder(systemRoot), `${marker.pid}-${marker.instance}.json`), { force: true });
}

/**
 * Every running marker: its file's pid, and its contents (null when they cannot be read, as after a power cut).
 * @returns {Promise<Array<{ file: string, pid: number, marker: any }>>}
 */
async function listRunningMarkers({ systemRoot }) {
  const folder = runningFolder(systemRoot);
  const names = await readdir(folder).catch((error) => {
    if (isMissing(error)) return [];
    throw error;
  });
  const markers = [];
  for (const name of names.sort()) {
    const match = MARKER_NAME_PATTERN.exec(name);
    if (!match) continue;
    const file = path.join(folder, name);
    const marker = await readFile(file, "utf8").then(JSON.parse).catch(() => null);
    markers.push({ file, pid: Number(match[1]), marker: marker && typeof marker === "object" ? marker : null });
  }
  return markers;
}

async function removeRunningMarkerFile(file) {
  await rm(file, { force: true });
}

/**
 * How the previous process ended, as the host wrote it, and the file removed: `{ result, code, status }` strings
 * (systemd's SERVICE_RESULT, EXIT_CODE, EXIT_STATUS), or null when the host wrote none.
 */
async function takeLastExit({ systemRoot }) {
  const file = path.join(crashesRoot(systemRoot), LAST_EXIT_FILE);
  const text = await readFile(file, "utf8").catch(() => null);
  if (text === null) return null;
  await rm(file, { force: true });
  try {
    const value = JSON.parse(text);
    const field = (name) => (typeof value?.[name] === "string" || typeof value?.[name] === "number" ? String(value[name]).slice(0, 80) : null);
    return { result: field("result"), code: field("code"), status: field("status") };
  } catch {
    return { result: null, code: null, status: text.trim().slice(0, 80) || null };
  }
}

export {
  CRASH_KIND,
  CRASH_RECORDS_LIMIT,
  MARKER_NAME_PATTERN,
  acknowledgeVibe64Crashes,
  crashForInterruptedTurn,
  crashRecordId,
  crashesRoot,
  listRunningMarkers,
  readVibe64CrashRecords,
  recordVibe64CrashActiveTurns,
  recordVibe64CrashResumedTurns,
  removeRunningMarkerFile,
  removeRunningMarkerSync,
  rewriteRunningMarker,
  takeLastExit,
  writeCrashRecordSync,
  writeRunningMarkerSync
};
