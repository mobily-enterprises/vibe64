// A turn that ends without finishing and without the person stopping it: what ended it, the permanent red entry in
// its chat's history, the note its AI gets when Vibe64 resumes it, when Vibe64 resumes it, and the rule that stops a
// crash loop.
//
// A server run is one editor process's life. Each writes a small record in the system root as it starts and adds its
// stop as it shuts down; a run whose record has no stop ended without shutting down. A turn's request names the run
// that sent it (`serverRunId`), so the next run tells an orderly stop, an update (the stopped run's version differs)
// and an unexpected one apart, and the crash record (vibe64-core's crashRecords.js) names what crashed.

import { randomUUID } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "@local/vibe64-core/server/atomicFile";
import { crashForInterruptedTurn, recordVibe64CrashResumedTurns } from "@local/vibe64-core/server/crashRecords";
import { crashMessage } from "@local/vibe64-core/shared/crashText";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import {
  TURN_INTERRUPTION_CAUSES as INTERRUPTION_CAUSE,
  turnInterruptionLines,
  turnInterruptionLoopError,
  utcClock
} from "../shared/turnInterruptionText.js";

/**
 * A resumed turn interrupted again within this time after its resume is a crash loop: Vibe64 stops resuming it, says
 * so and offers Continue. systemd restarts a crashed editor within seconds and the editor is ready again well inside a
 * minute, so a turn that brings the server down (or keeps losing its engine) is interrupted again within a minute or
 * two of each resume. Ten minutes catches that with room for a slow start, while a long turn or goal hit by two
 * unrelated restarts (two releases hours apart, say) still resumes each time.
 */
const TURN_RESUME_LOOP_WINDOW_MS = 10 * 60_000;
/** A turn the AI service's overload or a lost connection ended is resumed after this wait, which lets it recover. */
const TURN_RESUME_BACKOFF_MS = 30_000;
const SERVER_RUNS_DIR = "server-runs";
const SERVER_RUNS_KEPT = 20;
const INTERRUPTIONS_KEPT = 5;
const RUN_ID_PATTERN = /^[0-9a-f-]{36}$/u;

/**
 * When a process started, in clock ticks since boot (field 22 of Linux's /proc/<pid>/stat), or null where there is
 * no /proc. With its pid it names one process: a pid reused after a crash has another start.
 * @param {number | string} pid
 */
async function processStart(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    // The command name (field 2) is parenthesised and may hold spaces; the fields after it are plain.
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] || null;
  } catch {
    return null;
  }
}

/** The app's version, read once from the package.json at the repository root; null when unreadable. */
let appVersion;
async function readAppVersion() {
  if (appVersion !== undefined) return appVersion;
  try {
    const manifest = JSON.parse(await readFile(new URL("../../../../package.json", import.meta.url), "utf8"));
    appVersion = typeof manifest.version === "string" && manifest.version ? manifest.version : null;
  } catch {
    appVersion = null;
  }
  return appVersion;
}

/**
 * This editor process's run: its record in `<systemRoot>/server-runs`, written as it starts; its planned stop; how an
 * earlier run ended, seen from this one; and how many of the turns a crash interrupted it resumed, which the crash's
 * record keeps. Without a system root nothing is written and an earlier run reads as unknown.
 * @param {{ systemRoot?: string, now?: () => number, logger?: object }} options
 */
function createServerRun({ systemRoot = "", now = Date.now, logger = null } = {}) {
  const id = randomUUID();
  const startedAt = new Date(now()).toISOString();
  const folder = systemRoot ? path.join(systemRoot, SERVER_RUNS_DIR) : "";
  const record = { id, pid: process.pid, processStart: null, startedAt, version: null, stoppedAt: null, stopReason: "" };
  const fileOf = runId => path.join(folder, `${runId}.json`);
  // Each crash this run met: how many of its interrupted turns it resumed, and the count's latest write.
  const crashResumes = new Map();
  const warn = (error, message) => {
    if (!logger) return;
    logOperationalEvent(logger, "warn", {
      component: "vibe64.turn_resume",
      event: "vibe64.turn_resume.server_run_record_failed",
      error: error?.message,
      code: error?.code
    }, message);
  };

  async function write() {
    if (!folder) return;
    await writeFileAtomic(fileOf(id), `${JSON.stringify(record)}\n`, { directoryMode: 0o770, fileMode: 0o660 });
  }

  /** An earlier run's record, or null when it is unknown. @param {string} runId */
  async function read(runId) {
    if (!folder || !RUN_ID_PATTERN.test(String(runId || ""))) return null;
    try {
      return JSON.parse(await readFile(fileOf(runId), "utf8"));
    } catch {
      return null;
    }
  }

  // The run that started last before this one, which a task left without its sender's run was left by.
  let previousRunId = "";
  // Writes this run's record, finds the one before it and removes the oldest beyond those kept. Never throws.
  const started = (async () => {
    record.version = await readAppVersion();
    record.processStart = await processStart(process.pid);
    try {
      await write();
      if (!folder) return;
      const names = (await readdir(folder)).filter(name => name.endsWith(".json") && RUN_ID_PATTERN.test(name.slice(0, -5)));
      const runs = (await Promise.all(names.map(async name => ({ name, id: name.slice(0, -5), at: (await read(name.slice(0, -5)))?.startedAt || "" }))))
        .sort((left, right) => left.at.localeCompare(right.at));
      previousRunId = runs.filter(run => run.id !== id && run.at <= startedAt).at(-1)?.id || "";
      for (const run of runs.slice(0, Math.max(0, runs.length - SERVER_RUNS_KEPT))) {
        if (run.id !== id && run.id !== previousRunId) await rm(path.join(folder, run.name), { force: true });
      }
    } catch (error) {
      warn(error, "This server run's record could not be written; the turns it leaves are reported without their cause.");
    }
  })();

  /** Records that this run is shutting down in order. Never throws. @param {string} reason */
  async function recordPlannedStop(reason = "server-shutdown") {
    await started;
    if (record.stoppedAt) return;
    record.stoppedAt = new Date(now()).toISOString();
    record.stopReason = String(reason || "server-shutdown");
    try {
      await write();
    } catch (error) {
      warn(error, "This server run's planned stop could not be recorded; its interrupted turns will read as an unexpected stop.");
    }
  }

  /**
   * How the run that sent a turn ended, or null when it is this run (which has not ended).
   * @param {string} runId the request's `serverRunId`; "" for a request an older Vibe64 sent
   * @returns {Promise<{ cause: string, at: string, crashMessage?: string, crashId?: string, unknownRun?: boolean } | null>}
   */
  async function endOf(runId) {
    if (runId === id) return null;
    await started;
    const previous = await read(runId);
    if (previous?.stoppedAt) {
      const updated = Boolean(previous.version && record.version && previous.version !== record.version);
      return { cause: updated ? INTERRUPTION_CAUSE.UPDATE : INTERRUPTION_CAUSE.RESTART, at: previous.stoppedAt };
    }
    // No stop recorded: the run ended without shutting down, or it is unknown (an older Vibe64 sent the turn, or its
    // record is gone). A known run's first crash record from its start on says what happened and when; an unknown
    // run's start is unknown, so no record is taken for its own.
    const crash = systemRoot && previous?.startedAt
      ? await crashForInterruptedTurn({ systemRoot, startedAt: previous.startedAt }).catch(() => null)
      : null;
    if (crash) return { cause: INTERRUPTION_CAUSE.CRASH, at: crash.at || startedAt, crashMessage: crashMessage(crash), crashId: crash.id };
    return { cause: INTERRUPTION_CAUSE.CRASH, at: startedAt, ...(previous ? {} : { unknownRun: true }) };
  }

  /** How the run before this one ended, for work left without naming the run that sent it. */
  async function previousEnd() {
    await started;
    return endOf(previousRunId);
  }

  /**
   * Whether the process of an earlier run still runs: during a brief overlap (a restart that starts the next server
   * before the last has exited) its turns are its own, so this run leaves them to it. Its pid must still name the
   * same process: on Linux its start must match too, so a pid reused after a crash, or one on another machine after a
   * move, reads as ended.
   * @param {string} runId
   */
  async function isRunning(runId) {
    if (!runId || runId === id) return false;
    const previous = await read(runId);
    const pid = Number(previous?.pid);
    if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) return false;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code !== "EPERM") return false;
    }
    if (!previous.processStart) return true;
    return await processStart(pid) === previous.processStart;
  }

  /**
   * Counts one interrupted turn of a crash, resumed or not, into the crash's record (its `resumed`). Never throws.
   * @param {string} crashId
   * @param {boolean} resumed
   */
  async function countCrashTurn(crashId, resumed) {
    if (!systemRoot || !crashId) return;
    const counted = crashResumes.get(crashId) || { resumed: 0, write: Promise.resolve() };
    if (resumed) counted.resumed += 1;
    const total = counted.resumed;
    counted.write = counted.write.then(() => recordVibe64CrashResumedTurns({ systemRoot, id: crashId, resumed: total }))
      .catch(error => warn(error, "The crash record could not be told how many interrupted turns were resumed."));
    crashResumes.set(crashId, counted);
    await counted.write;
  }

  return Object.freeze({
    id,
    startedAt,
    started,
    endOf,
    previousEnd,
    isRunning,
    recordPlannedStop,
    read,
    countCrashTurn
  });
}

/** A server run that records nothing, for callers without a system root: every turn is this run's own. */
const NO_SERVER_RUN = Object.freeze({
  id: "",
  startedAt: "",
  started: Promise.resolve(),
  endOf: async () => null,
  previousEnd: async () => null,
  isRunning: async () => false,
  recordPlannedStop: async () => {},
  read: async () => null,
  countCrashTurn: async () => {}
});

// What an engine adds to its own failure message, which the red entry replaces with what Vibe64 did.
const SEND_A_MESSAGE_HINT = /\s*(The conversation so far is saved|Saved file changes remain)[;,.]?\s*(send a message to continue)?\.?\s*$/iu;
const SIGN_IN = /not (signed|logged) in|sign in again|log in again|please (log|sign) in|authentication (failed|error)|invalid (api key|credentials|token)|unauthori[sz]ed|\b401\b|oauth token (has )?expired/iu;
const USAGE_LIMIT = /usage limit|limit reached|limit (was )?exceeded|out of credit|credit balance|insufficient (credit|quota|funds)|quota exceeded|hit your limit/iu;
const OVERLOADED = /overloaded|\b529\b|\b503\b|temporarily unavailable|service unavailable|rate.?limit|too many requests|\b429\b/iu;
const CONNECTION = /connection (to|with) .* (was )?lost|observation was lost|econnreset|econnrefused|etimedout|socket hang up|network error|fetch failed|connection (closed|reset|error)/iu;

/**
 * How a turn that ended while this run sent it ended, when it did not complete and was not cancelled: its engine died,
 * its connection was lost, the AI service was overloaded, the account needs signing in or reached its limit, or the AI
 * reported another error. null for a turn that completed, was cancelled, or left nothing to say.
 * @param {{ state?: string, error?: string, observationError?: string }} run the ended agent run
 * @returns {{ cause: string, detail: string } | null}
 */
function turnEnding(run = {}) {
  const state = String(run.state || "");
  if (!["interrupted", "failed", "timed_out"].includes(state)) return null;
  const error = String(run.error || "").trim();
  const detail = error.replace(SEND_A_MESSAGE_HINT, "").trim();
  const observation = String(run.observationError || "").trim();
  if (/stopped unexpectedly/iu.test(error)) return { cause: INTERRUPTION_CAUSE.ENGINE, detail };
  if (USAGE_LIMIT.test(error)) return { cause: INTERRUPTION_CAUSE.USAGE_LIMIT, detail };
  if (SIGN_IN.test(error)) return { cause: INTERRUPTION_CAUSE.SIGN_IN, detail };
  if (observation || CONNECTION.test(error)) return { cause: INTERRUPTION_CAUSE.CONNECTION, detail: observation || detail };
  if (OVERLOADED.test(error)) return { cause: INTERRUPTION_CAUSE.OVERLOADED, detail };
  if (state === "failed" || state === "timed_out" || error) return { cause: INTERRUPTION_CAUSE.FAILED, detail };
  return null;
}

/**
 * When Vibe64 resumes a turn this cause ended: at once, after the backoff, or never (the person signs in, waits for
 * the limit, or reads the error first).
 * @param {string} cause
 * @returns {"now" | "later" | "never"}
 */
function resumePolicy(cause) {
  if ([INTERRUPTION_CAUSE.CRASH, INTERRUPTION_CAUSE.RESTART, INTERRUPTION_CAUSE.UPDATE, INTERRUPTION_CAUSE.ENGINE].includes(cause)) return "now";
  if ([INTERRUPTION_CAUSE.CONNECTION, INTERRUPTION_CAUSE.OVERLOADED].includes(cause)) return "later";
  return "never";
}

/** The second line's outcome for a cause Vibe64 never resumes. @param {string} cause */
function neverResumedOutcome(cause) {
  if (cause === INTERRUPTION_CAUSE.SIGN_IN) return "sign-in";
  if (cause === INTERRUPTION_CAUSE.USAGE_LIMIT) return "usage-limit";
  return "not-resumed";
}

/**
 * The red entry's system message. Its id names the interrupted turn, the interruption and the outcome, so each is
 * written once however many processes or passes see it (a conversation never stores a message id twice).
 * @param {{ key: string, cause: string, at: string, detail?: string, crashMessage?: string, unknownRun?: boolean }} interruption
 * @param {string} outcome resumed, resuming, loop, stopped, sign-in, usage-limit, not-resumed, uncertain or failed
 * @param {{ error?: string, goal?: boolean, resumeAt?: string }} [options]
 */
function interruptionNotice(interruption, outcome, { error = "", goal = false, resumeAt = "" } = {}) {
  const entry = {
    cause: interruption.cause,
    at: interruption.at,
    outcome,
    ...(interruption.detail ? { detail: String(interruption.detail).slice(0, 500) } : {}),
    ...(interruption.crashMessage ? { crashMessage: String(interruption.crashMessage).slice(0, 500) } : {}),
    ...(interruption.unknownRun ? { unknownRun: true } : {}),
    ...(error ? { error: String(error).slice(0, 500) } : {}),
    ...(goal ? { goal: true } : {}),
    ...(resumeAt ? { resumeAt } : {})
  };
  return {
    messageId: `vibe64-turn-interrupted:${interruption.key}:${outcome}`,
    text: turnInterruptionLines(entry, utcClock).join("\n"),
    data: { vibe64TurnInterruption: entry }
  };
}

/**
 * The note that leads the resumed turn's message to the AI.
 * @param {{ cause: string, at: string, detail?: string, crashMessage?: string, unknownRun?: boolean }} interruption
 */
function resumeNoteForAi(interruption) {
  const [headline] = turnInterruptionLines({ ...interruption, outcome: "resumed" }, utcClock);
  return `[Vibe64 note: your previous turn was interrupted. ${headline} Vibe64 resumed this conversation. Your work ` +
    "so far is kept. Before repeating any step, check the state of what you were doing (files, Git, commands you " +
    "started, anything half-done), then continue.]";
}

/**
 * The crash-loop rule: an interruption of a turn resumed less than TURN_RESUME_LOOP_WINDOW_MS earlier is not resumed.
 * The interruptions to save come back newest last and bounded; an interruption seen before (another pass, another
 * process) is `repeated` and decides nothing again.
 * @param {Array<{ key: string, at: string, cause: string, resumedAt?: string | null }> | undefined} history
 * @param {{ key: string, at: string, cause: string }} interruption
 * @param {number} nowMs
 * @param {{ resumes?: boolean }} [options] whether the cause is one Vibe64 resumes at all
 */
function nextTurnInterruptions(history, interruption, nowMs, { resumes = true } = {}) {
  const previous = Array.isArray(history) ? history : [];
  const seen = previous.find(entry => entry?.key === interruption.key);
  if (seen) return { history: previous, resume: Boolean(seen.resumedAt), loop: false, repeated: true, entry: seen };
  const lastResume = Date.parse(previous.at(-1)?.resumedAt || "");
  const loop = resumes && Number.isFinite(lastResume) && nowMs - lastResume < TURN_RESUME_LOOP_WINDOW_MS;
  const resume = resumes && !loop;
  const entry = {
    key: interruption.key,
    at: interruption.at,
    cause: interruption.cause,
    resumedAt: resume ? new Date(nowMs).toISOString() : null
  };
  return { history: [...previous, entry].slice(-INTERRUPTIONS_KEPT), resume, loop, repeated: false, entry };
}

export {
  INTERRUPTION_CAUSE,
  NO_SERVER_RUN,
  TURN_RESUME_BACKOFF_MS,
  TURN_RESUME_LOOP_WINDOW_MS,
  createServerRun,
  interruptionNotice,
  neverResumedOutcome,
  nextTurnInterruptions,
  resumeNoteForAi,
  resumePolicy,
  turnEnding,
  turnInterruptionLoopError as interruptionLoopError
};
