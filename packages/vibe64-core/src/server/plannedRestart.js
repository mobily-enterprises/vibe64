// A planned restart, as everything in the editor's process sees it (plannedRestartNotice.js has the notice's rules).
// One reader follows the host's notice file: while a valid notice is in force, every crucial operation is refused
// with a plain sentence naming the restart time, and what already runs is left alone. The reader keeps its own
// durable record of each notice, keyed by its id, in the editor's state: the chats told about it, the crucial
// operations and session commands running when it came and when the editor stopped, and how it ended.
//
// How a notice ends:
// - The editor stops while it is in force and starts again at or after a minute before its restart time, finding no
//   notice file: it restarted. The chats that were working resume (their resume names what was stopped), and the
//   editor's banner says so once.
// - It expires, or the host removes it, while the editor runs, or the editor starts again earlier than that: it did
//   not happen. The chats told about it hear so; nothing needs clearing.
//
// One process runs one editor server at a time: each server configures the reader as it starts
// (configurePlannedRestart), and everything else reads that one (plannedRestart()).

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { writeFileAtomic, serializeByKey } from "./atomicFile.js";
import { logOperationalEvent } from "./logging.js";
import { sha256Hex } from "./sha256Hex.js";
import {
  PLANNED_RESTART_REFUSAL_CODE,
  crucialOperationLabel,
  plannedRestartNoticeFrom,
  plannedRestartRefusalMessage,
  plannedRestartResumeMessage,
  plannedRestartWarning,
  readBootId
} from "./plannedRestartNotice.js";

const RECORD_SCHEMA = "vibe64.planned-restart-record.v1";
const RECORD_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/u;
// How often the notice file is read; a notice gives five minutes' warning.
const POLL_MS = 5_000;
// An editor that started at or after this long before the restart time, with no notice file, is the restarted one.
const RESTART_START_SLACK_MS = 60_000;
const RECORDS_KEPT = 20;
const LISTED_MAX = 50;
const COMMAND_TEXT_MAX = 200;
// How long after a restart the editor's banner may still say what it stopped.
const RESTARTED_SHOWN_MS = 30 * 60_000;

const component = "vibe64.planned_restart";
const commandText = command => String(command || "").replace(/\s+/gu, " ").trim().slice(0, COMMAND_TEXT_MAX);

/**
 * @param {object} [options]
 * @param {string} [options.noticeFile] the host's notice path; without one no notice is ever read
 * @param {string} [options.recordsRoot] where the durable records live; without one nothing is recorded
 * @param {object} [options.logger]
 * @param {() => number} [options.now]
 * @param {() => string} [options.bootId] this machine's boot id
 * @param {number} [options.startedAtMs] when this editor process started
 * @param {number} [options.pollMs]
 */
function createPlannedRestart({
  noticeFile = "",
  recordsRoot = "",
  logger = silentLogger,
  now = Date.now,
  bootId = readBootId,
  startedAtMs = Date.now(),
  pollMs = POLL_MS
} = {}) {
  const machineBootId = noticeFile ? String(bootId() || "") : "";
  let notice = null;
  let record = null;
  let fileSeen = false;
  let restarted = null;
  let polling = null;
  let pollTimer = null;
  let expiryTimer = null;
  let ready = null;
  const warned = new Set();
  const listeners = new Set();
  const crucial = new Map();
  const commands = new Map();
  const writes = new Map();

  const warn = (event, fields, message) => logOperationalEvent(logger, "warn", { component, event: `${component}.${event}`, ...fields }, message);
  const recordFile = id => path.join(recordsRoot, `${id}.json`);
  const current = () => (notice && now() < notice.expiresAtMs ? notice : null);
  const noticeOf = saved => ({ id: saved.id, restartAt: saved.restartAt, expiresAt: saved.expiresAt, reason: saved.reason,
    restartAtMs: Date.parse(saved.restartAt), expiresAtMs: Date.parse(saved.expiresAt) });

  function emit(event) {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        warn("listener_failed", { error: error?.message }, "A planned restart listener failed.");
      }
    }
  }

  function snapshot() {
    return {
      operations: [...crucial.values()].slice(0, LISTED_MAX),
      commands: [...commands.values()].slice(0, LISTED_MAX)
    };
  }

  /** Writes the record, after every earlier write of it. A failure is logged: the gate itself never depends on it. */
  function save(saved) {
    if (!recordsRoot) return Promise.resolve();
    const text = `${JSON.stringify(saved)}\n`;
    return serializeByKey(writes, saved.id, () => writeFileAtomic(recordFile(saved.id), text, { directoryMode: 0o770, fileMode: 0o660 }))
      .catch(error => warn("record_failed", { noticeId: saved.id, error: error?.message }, "The planned restart's record could not be written."));
  }

  async function readRecords() {
    if (!recordsRoot) return [];
    const names = await readdir(recordsRoot).catch(() => []);
    const records = await Promise.all(names.filter(name => RECORD_NAME.test(name)).map(async name => {
      try {
        const saved = JSON.parse(await readFile(path.join(recordsRoot, name), "utf8"));
        return saved?.schema === RECORD_SCHEMA && `${saved.id}.json` === name ? saved : null;
      } catch {
        return null;
      }
    }));
    return records.filter(Boolean).sort((left, right) => String(left.noticedAt).localeCompare(String(right.noticedAt)));
  }

  async function pruneRecords() {
    const records = await readRecords();
    for (const old of records.slice(0, Math.max(0, records.length - RECORDS_KEPT))) {
      if (old.id !== record?.id) await rm(recordFile(old.id), { force: true }).catch(() => null);
    }
  }

  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    if (!notice) return;
    const expiring = notice;
    expiryTimer = setTimeout(() => {
      if (notice === expiring) end("expired");
    }, Math.max(0, expiring.expiresAtMs - now()) + 5);
    expiryTimer.unref?.();
  }

  function begin(next, savedRecord) {
    notice = next;
    if (savedRecord?.state === "in-force") {
      // The window goes on after an earlier stop of this editor: the next stop is the one its record names.
      record = { ...savedRecord, restartAt: next.restartAt, expiresAt: next.expiresAt, reason: next.reason, stoppedAt: null, atRestart: null };
      void save(record);
      scheduleExpiry();
      return;
    }
    record = {
      schema: RECORD_SCHEMA,
      id: next.id,
      restartAt: next.restartAt,
      expiresAt: next.expiresAt,
      reason: next.reason,
      bootId: next.bootId,
      state: "in-force",
      noticedAt: new Date(now()).toISOString(),
      chats: [],
      atNotice: snapshot(),
      stoppedAt: null,
      atRestart: null,
      endedAt: null,
      restartedAt: null
    };
    void save(record).then(pruneRecords);
    scheduleExpiry();
    logOperationalEvent(logger, "warn", { component, event: `${component}.notice_started`, noticeId: next.id,
      restartAt: next.restartAt, expiresAt: next.expiresAt }, "A planned restart notice is in force: crucial operations are paused.");
    emit({ type: "started", notice: next, record });
  }

  function end(cause) {
    const ended = notice;
    const endedRecord = record;
    notice = null;
    record = null;
    clearTimeout(expiryTimer);
    if (!ended || !endedRecord) return;
    const saved = { ...endedRecord, state: cause, endedAt: new Date(now()).toISOString() };
    void save(saved);
    logOperationalEvent(logger, "warn", { component, event: `${component}.notice_ended`, noticeId: ended.id, cause },
      "The planned restart did not happen: crucial operations are open again.");
    emit({ type: "ended", notice: ended, cause, record: saved });
  }

  /** Reads the notice file once and follows what it says now. */
  async function readNotice() {
    let text = null;
    try {
      text = await readFile(noticeFile, "utf8");
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error?.code)) {
        const key = `read:${error?.code}`;
        if (!warned.has(key)) {
          warned.add(key);
          warn("notice_unreadable", { code: error?.code, error: error?.message }, "The planned restart notice could not be read; it is ignored.");
        }
      }
    }
    fileSeen = text !== null;
    const parsed = text === null ? null : plannedRestartNoticeFrom(text, { bootId: machineBootId, nowMs: now() });
    if (parsed?.ignored) {
      // One warning for each notice the file holds, however often it is read again.
      const key = sha256Hex(`${parsed.ignored}\n${text}`);
      if (!warned.has(key)) {
        warned.add(key);
        warn("notice_ignored", { reason: parsed.ignored }, `The planned restart notice is ignored: ${parsed.ignored}.`);
      }
    }
    return { next: parsed?.notice || null, text };
  }

  async function follow({ next }, savedRecords = null) {
    if (notice && (!next || next.id !== notice.id)) end(now() >= notice.expiresAtMs ? "expired" : "cancelled");
    if (!next) return;
    if (notice?.id === next.id) {
      if (notice.restartAtMs !== next.restartAtMs || notice.expiresAtMs !== next.expiresAtMs || notice.reason !== next.reason) {
        begin(next, record);
      }
      return;
    }
    const known = savedRecords || await readRecords();
    begin(next, known.find(saved => saved.id === next.id) || null);
  }

  async function poll() {
    if (!noticeFile) return;
    if (polling) return polling;
    polling = (async () => follow(await readNotice()))().catch(error => {
      warn("poll_failed", { error: error?.message }, "The planned restart notice could not be followed.");
    }).finally(() => {
      polling = null;
    });
    return polling;
  }

  /**
   * The editor's first look: a record this process's start shows restarted, ended or still in force, then the notice
   * as it is. Never rejects.
   */
  async function decide() {
    const savedRecords = await readRecords();
    const seen = noticeFile ? await readNotice() : { next: null, text: null };
    for (const saved of savedRecords.filter(entry => entry.state === "in-force")) {
      if (seen.next?.id === saved.id) continue;
      const startedLate = startedAtMs >= Date.parse(saved.restartAt) - RESTART_START_SLACK_MS;
      if (startedLate && !fileSeen) {
        restarted = { ...saved, state: "restarted", restartedAt: new Date(startedAtMs).toISOString() };
        await save(restarted);
        logOperationalEvent(logger, "warn", { component, event: `${component}.restarted`, noticeId: saved.id },
          "The editor restarted for the planned restart: what was working resumes.");
        emit({ type: "restarted", record: restarted });
      } else {
        const ended = { ...saved, state: "cancelled", endedAt: new Date(now()).toISOString() };
        await save(ended);
        emit({ type: "ended", notice: noticeOf(saved), cause: "cancelled", record: ended });
      }
    }
    await follow(seen, savedRecords);
  }

  /** Starts following the notice file; resolves once this process's start is decided. Never rejects. */
  function start() {
    if (ready) return ready;
    ready = decide().catch(error => warn("start_failed", { error: error?.message }, "The planned restart records could not be read."));
    if (noticeFile && pollMs > 0) {
      pollTimer = setInterval(() => void poll(), pollMs);
      pollTimer.unref?.();
    }
    return ready;
  }

  function stop() {
    clearInterval(pollTimer);
    clearTimeout(expiryTimer);
    pollTimer = null;
    listeners.clear();
  }

  /**
   * A crucial operation's refusal while a notice is in force, or null. `typicalMs` is how long the operation usually
   * takes: one that would not finish before the restart is refused, which every start in the window is.
   * @param {{ operation: string, label?: string, typicalMs?: number, after?: string }} input
   * @returns {{ code: string, message: string, restartAt: string } | null}
   */
  function refusal({ operation, label = "", typicalMs: _typicalMs = 0, after = "" } = {}) {
    const active = current();
    if (!active) return null;
    return {
      code: PLANNED_RESTART_REFUSAL_CODE,
      message: plannedRestartRefusalMessage(active, operation, { label, after }),
      restartAt: active.restartAt
    };
  }

  /** Throws a crucial operation's refusal while a notice is in force. */
  function refuse(operation, options = {}) {
    const refused = refusal({ ...options, operation });
    if (!refused) return;
    throw new AppError(409, refused.message, {
      code: refused.code,
      details: { restartAt: refused.restartAt, operation }
    });
  }

  /**
   * Refuses a crucial operation while a notice is in force; otherwise records it as running until `end()`, so the
   * notice's record names it when the notice comes or the editor stops.
   * @param {string} operation
   * @param {{ sessionId?: string, label?: string }} [options]
   */
  function beginCrucial(operation, { sessionId = "", label = "" } = {}) {
    refuse(operation, { label });
    const token = randomUUID();
    crucial.set(token, { operation, label: crucialOperationLabel(operation, label), sessionId: String(sessionId || "") });
    let ended = false;
    return Object.freeze({
      end() {
        if (ended) return;
        ended = true;
        crucial.delete(token);
      }
    });
  }

  /** A session command running until `end()`, named by the notice's record. */
  function trackCommand(sessionId, command) {
    const token = randomUUID();
    commands.set(token, { sessionId: String(sessionId || ""), command: commandText(command) });
    return Object.freeze({ end: () => void commands.delete(token) });
  }

  /** The note for an AI turn starting now, or "" outside the window. */
  function warning() {
    const active = current();
    return active ? plannedRestartWarning(active, now()) : "";
  }

  /**
   * Records a chat told about the notice in force: steered, or a turn led by the note.
   * @param {{ sessionId: string, conversationId?: string, sessionName?: string, steered?: boolean }} chat
   */
  function noteTold({ sessionId, conversationId = "", sessionName = "", steered = false }) {
    if (!current() || !record) return;
    const key = `${sessionId}\n${conversationId}`;
    if (record.chats.some(chat => `${chat.sessionId}\n${chat.conversationId}` === key) || record.chats.length >= LISTED_MAX) return;
    record = { ...record, chats: [...record.chats, { sessionId, conversationId, sessionName: String(sessionName || ""), steered }] };
    void save(record);
  }

  /** Records, as the editor stops in the window, what it stops. Synchronous: the stop never waits. */
  function recordStop() {
    if (!current() || !record || !recordsRoot || record.stoppedAt) return;
    record = { ...record, stoppedAt: new Date(now()).toISOString(), atRestart: snapshot() };
    try {
      mkdirSync(recordsRoot, { recursive: true, mode: 0o770 });
      const temporary = path.join(recordsRoot, `.${record.id}.${process.pid}.stop`);
      writeFileSync(temporary, `${JSON.stringify(record)}\n`, { mode: 0o660 });
      renameSync(temporary, recordFile(record.id));
    } catch (error) {
      warn("stop_record_failed", { noticeId: record.id, error: error?.message }, "The planned restart's stop could not be recorded.");
    }
  }

  /** What the restart stopped in one session, in words. */
  function stoppedIn(saved, sessionId) {
    const at = saved.atRestart || saved.atNotice || { operations: [], commands: [] };
    return [
      "your turn",
      ...at.operations.filter(entry => entry.sessionId === sessionId).map(entry => entry.label),
      ...at.commands.filter(entry => entry.sessionId === sessionId).map(entry => `the command \`${entry.command}\``)
    ];
  }

  /**
   * The note that leads a turn this process resumes after the planned restart, or "" when it did not restart for one.
   * @param {{ sessionId: string }} chat
   */
  async function resumeNote({ sessionId }) {
    await (ready || Promise.resolve());
    if (!restarted) return "";
    const at = Date.parse(restarted.stoppedAt || restarted.restartAt);
    return plannedRestartResumeMessage(at, stoppedIn(restarted, String(sessionId || "")));
  }

  /** What the editor's banner shows: the notice in force, and for a while after the restart what it stopped. */
  function status() {
    const active = current();
    const names = new Map((restarted?.chats || []).map(chat => [chat.sessionId, chat.sessionName]));
    const at = restarted ? restarted.atRestart || restarted.atNotice : null;
    const shown = restarted && now() - Date.parse(restarted.restartedAt) < RESTARTED_SHOWN_MS;
    return {
      active: active ? { id: active.id, restartAt: active.restartAt, expiresAt: active.expiresAt, reason: active.reason } : null,
      restarted: shown ? {
        id: restarted.id,
        restartedAt: restarted.stoppedAt || restarted.restartAt,
        reason: restarted.reason,
        sessions: [...new Set(restarted.chats.map(chat => chat.sessionId))].length,
        stopped: [
          ...at.operations.map(entry => ({ label: entry.label, sessionName: names.get(entry.sessionId) || "" })),
          ...at.commands.map(entry => ({ label: `the command ${entry.command}`, sessionName: names.get(entry.sessionId) || "" }))
        ]
      } : null
    };
  }

  /** @param {(event: { type: string, notice?: object, cause?: string, record: object }) => void} listener */
  function onChange(listener) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }

  return Object.freeze({
    beginCrucial,
    current,
    noteTold,
    onChange,
    poll,
    get ready() {
      return ready || Promise.resolve();
    },
    recordStop,
    refusal,
    refuse,
    restartedRecord: () => restarted,
    resumeNote,
    start,
    status,
    stop,
    trackCommand,
    warning
  });
}

// readable-check: allow module-state - shared resource: one editor server per process follows one notice file, which every operation's gate reads
let processPlannedRestart = createPlannedRestart();

/**
 * Makes this the process's reader, replacing (and stopping) the one before; the next server of a process that runs
 * several, as tests do, starts with its own.
 * @param {Parameters<typeof createPlannedRestart>[0]} options
 */
function configurePlannedRestart(options) {
  processPlannedRestart.stop();
  processPlannedRestart = createPlannedRestart(options);
  return processPlannedRestart;
}

/** The process's planned restart reader. */
function plannedRestart() {
  return processPlannedRestart;
}

/**
 * Throws a crucial operation's refusal while a planned restart notice is in force.
 * @param {string} operation an id from CRUCIAL_OPERATIONS
 * @param {{ label?: string, after?: string }} [options]
 */
function refuseDuringPlannedRestart(operation, options) {
  processPlannedRestart.refuse(operation, options);
}

/**
 * Refuses a crucial operation while a notice is in force; otherwise tracks it until `end()`.
 * @param {string} operation
 * @param {{ sessionId?: string, label?: string }} [options]
 */
function beginCrucialOperation(operation, options) {
  return processPlannedRestart.beginCrucial(operation, options);
}

export {
  beginCrucialOperation,
  configurePlannedRestart,
  createPlannedRestart,
  plannedRestart,
  refuseDuringPlannedRestart
};
