// How the editor server's process records its own abnormal end (crashRecords.js keeps the records).
//
// A started server holds a running marker for its whole life, its heartbeat rewritten every 30 s. An uncaught error
// or an unhandled rejection is recorded from Node's uncaught-exception monitor, synchronously, before Node prints it
// and exits with code 1 as it always does: nothing here catches the error or keeps the process running. Any other
// exit with a non-zero code is recorded from the exit handler, a failed stop by the stop handler; each removes the
// marker once its record is written. A clean stop removes the marker and records nothing, and so does a stop that
// overran its deadline, which is still the stop that was asked for (server.js ends the watch before its exit 1). The
// next start finds the marker of a process that died with neither (SIGKILL, an out-of-memory kill, power loss) and
// records it as stopped without a trace, with its last heartbeat and the exit the host gave. Either record is written
// with its activeTurns still to count (activeTurnsPending): the next start counts the turns still marked working,
// which only that crash can have left so, before anything resumes them.

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  CRASH_KIND,
  crashRecordId,
  listRunningMarkers,
  readVibe64CrashRecords,
  recordVibe64CrashActiveTurns,
  removeRunningMarkerFile,
  removeRunningMarkerSync,
  rewriteRunningMarker,
  takeLastExit,
  writeCrashRecordSync,
  writeRunningMarkerSync
} from "./crashRecords.js";
import { logOperationalEvent, sanitizeLogText } from "./logging.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

const HEARTBEAT_MS = 30_000;
const MAX_MESSAGE_CHARS = 4000;
const MAX_STACK_CHARS = 16_000;
const MAX_CAUSES = 3;

const text = (value, limit) => sanitizeLogText(String(value ?? "")).slice(0, limit);

/**
 * What a record keeps of what was thrown: its name, message, code and stack with up to three causes, secrets
 * redacted as the log redacts them.
 * @param {unknown} value
 */
function crashError(value) {
  if (!value || typeof value !== "object") {
    return { name: typeof value === "string" ? "Error" : `Thrown ${typeof value}`, message: text(value, MAX_MESSAGE_CHARS), code: null, stack: null };
  }
  const error = /** @type {any} */ (value);
  const stacks = [];
  for (let cause = error, depth = 0; cause && typeof cause === "object" && depth <= MAX_CAUSES; cause = cause.cause, depth += 1) {
    const stack = String(cause.stack || `${cause.name || "Error"}: ${cause.message || ""}`);
    stacks.push(depth === 0 ? stack : `Caused by: ${stack}`);
  }
  for (const inner of Array.isArray(error.errors) ? error.errors.slice(0, MAX_CAUSES) : []) {
    stacks.push(`Including: ${String(inner?.stack || inner?.message || inner)}`);
  }
  return {
    name: text(error.name || "Error", 200),
    message: text(error.message, MAX_MESSAGE_CHARS),
    code: error.code === undefined || error.code === null ? null : text(error.code, 200),
    stack: text(stacks.join("\n"), MAX_STACK_CHARS)
  };
}

/** The kernel's start time of a process (Linux's /proc/<pid>/stat field 22), which a reused pid does not share; null elsewhere. */
function processStartTicks(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] || null;
  } catch {
    return null;
  }
}

function currentBootId() {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * Whether the process a marker names is still that server: the same boot, a process with that pid this account can
 * signal, started when the marker says (where the system tells; otherwise any live process of ours with that pid).
 */
function markerProcessAlive({ pid, marker }, {
  bootId = currentBootId(),
  startTicks = processStartTicks,
  signal = process.kill.bind(process)
} = {}) {
  if (!marker) return false;
  if (marker.bootId && bootId && marker.bootId !== bootId) return false;
  try {
    signal(pid, 0);
  } catch {
    // ESRCH: gone; EPERM: another account's process, which no server of this root runs as.
    return false;
  }
  const ticks = startTicks(pid);
  if (marker.processStart && ticks) return marker.processStart === ticks;
  if (pid === process.pid) return Math.abs(Date.parse(marker.processStartedAt) - processStartedAtMs()) < 5000;
  return true;
}

function processStartedAtMs() {
  return Date.now() - process.uptime() * 1000;
}

/**
 * At a server's start, before anything resumes work: each running marker whose process is gone becomes a record of a
 * process that stopped without a trace, with its last heartbeat, and the newest with the exit the host gave. Then
 * the newest record, when its turns are still to count, gets the turns still marked working.
 * @param {object} options
 * @param {string} options.systemRoot
 * @param {() => Promise<number>} options.countActiveTurns
 * @param {RuntimeLogger} options.logger
 * @param {() => Date} [options.now]
 * @param {(entry: { pid: number, marker: any }) => boolean} [options.alive]
 * @returns {Promise<object[]>} the new records
 */
async function recordUntracedStops({ systemRoot, countActiveTurns, logger, now = () => new Date(), alive = markerProcessAlive }) {
  const dead = (await listRunningMarkers({ systemRoot })).filter((entry) => !alive(entry));
  const lastExit = await takeLastExit({ systemRoot });
  const recorded = [];
  const detectedAt = now().toISOString();
  dead.sort((a, b) => String(a.marker?.heartbeatAt || "").localeCompare(String(b.marker?.heartbeatAt || "")));
  for (const [index, { file, pid, marker }] of dead.entries()) {
    const lastHeartbeatAt = typeof marker?.heartbeatAt === "string" ? marker.heartbeatAt : null;
    const startedAt = Date.parse(marker?.startedAt);
    const record = {
      id: crashRecordId(detectedAt, pid),
      at: detectedAt,
      pid,
      kind: CRASH_KIND.STOPPED_WITHOUT_TRACE,
      error: null,
      uptimeSeconds: lastHeartbeatAt && Number.isFinite(startedAt)
        ? Math.max(0, Math.round((Date.parse(lastHeartbeatAt) - startedAt) / 1000))
        : null,
      version: typeof marker?.version === "string" ? marker.version : "",
      activeTurns: null,
      activeTurnsPending: true,
      resumed: null,
      lastHeartbeatAt,
      exit: index === dead.length - 1 ? lastExit : null,
      acknowledged: null
    };
    writeCrashRecordSync({ systemRoot, record });
    await removeRunningMarkerFile(file);
    recorded.push(record);
    logOperationalEvent(logger, "error", {
      component: "server-lifecycle",
      event: "vibe64.server.stopped_without_trace",
      crashId: record.id,
      pid,
      lastHeartbeatAt,
      exit: record.exit
    }, "The previous Vibe64 server stopped without a trace; recorded it as a crash.");
  }
  const [latest] = (await readVibe64CrashRecords({ systemRoot })).records;
  if (latest?.activeTurnsPending === true) {
    const activeTurns = await countActiveTurns().catch(() => null);
    if (Number.isSafeInteger(activeTurns)) await recordVibe64CrashActiveTurns({ systemRoot, id: latest.id, activeTurns });
  }
  return recorded;
}

/**
 * Watches a started server's process for its end, from now until stop(): see the top of this file.
 * @param {object} options
 * @param {string} options.systemRoot
 * @param {string} options.version what is running, such as vibe64@0.1.81
 * @param {RuntimeLogger} options.logger
 * @param {NodeJS.Process | import("node:events").EventEmitter} [options.processRef]
 * @param {number} [options.heartbeatMs]
 */
function startCrashWatch({ systemRoot, version, logger, processRef = process, heartbeatMs = HEARTBEAT_MS }) {
  const startedAt = new Date().toISOString();
  const marker = {
    pid: process.pid,
    instance: randomBytes(4).toString("hex"),
    processStart: processStartTicks(process.pid),
    processStartedAt: new Date(processStartedAtMs()).toISOString(),
    bootId: currentBootId(),
    version,
    startedAt,
    heartbeatAt: startedAt
  };
  writeRunningMarkerSync({ systemRoot, marker });
  let ended = false;
  // A crash whose record could not be written leaves its marker, so the next start records it.
  let markerKept = false;
  const heartbeat = setInterval(() => {
    marker.heartbeatAt = new Date().toISOString();
    rewriteRunningMarker({ systemRoot, marker }).then(() => {
      // A stop or a recorded crash while this write was under way removed the marker before the write put it back.
      if (ended && !markerKept) removeRunningMarkerSync({ systemRoot, marker });
    }, (error) => logOperationalEvent(logger, "warn", {
      component: "server-lifecycle",
      event: "vibe64.server.heartbeat_failed",
      error
    }, "Could not write the server's running marker."));
  }, heartbeatMs);
  heartbeat.unref();

  /** Writes the record of this process's end, once; a marker stays when it cannot, so the next start records it. */
  function record(error, origin) {
    if (ended) return null;
    ended = true;
    clearInterval(heartbeat);
    const at = new Date().toISOString();
    const entry = {
      id: crashRecordId(at, process.pid),
      at,
      pid: process.pid,
      kind: CRASH_KIND.FATAL_ERROR,
      origin,
      error: crashError(error),
      uptimeSeconds: Math.round(process.uptime()),
      version,
      activeTurns: null,
      activeTurnsPending: true,
      resumed: null,
      acknowledged: null
    };
    try {
      writeCrashRecordSync({ systemRoot, record: entry });
      removeRunningMarkerSync({ systemRoot, marker });
    } catch (writeError) {
      markerKept = true;
      process.stderr.write(`Vibe64 could not record its crash: ${writeError.stack}\n`);
    }
    try {
      logOperationalEvent(logger, "error", {
        component: "server-lifecycle",
        event: "vibe64.server.crashed",
        crashId: entry.id,
        origin,
        error: entry.error
      }, "Vibe64 server crashed; recorded it.");
    } catch {
      // Node prints the error itself as the process ends.
    }
    return entry;
  }

  const onFatal = (error, origin) => record(error, origin === "unhandledRejection" ? "unhandledRejection" : "uncaughtException");
  const onExit = (code) => {
    if (ended) return;
    if (code === 0) {
      stop();
      return;
    }
    record(Object.assign(new Error(`Vibe64 exited with code ${code}.`), { code: `exit_${code}` }), "exit");
  };
  processRef.on("uncaughtExceptionMonitor", onFatal);
  processRef.on("exit", onExit);

  /** A clean end: the marker goes and nothing is recorded. */
  function stop() {
    if (!ended) {
      ended = true;
      clearInterval(heartbeat);
      removeRunningMarkerSync({ systemRoot, marker });
    }
    processRef.off("uncaughtExceptionMonitor", onFatal);
    processRef.off("exit", onExit);
  }

  return Object.freeze({
    /** Records a stop that failed or overran (the process then exits with code 1). */
    recordStopFailure: (error) => record(error, "stop"),
    stop
  });
}

export { HEARTBEAT_MS, crashError, markerProcessAlive, recordUntracedStops, startCrashWatch };
