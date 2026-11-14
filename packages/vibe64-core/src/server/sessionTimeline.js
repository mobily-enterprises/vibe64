import { appendFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { sanitizeLogText } from "./logging.js";
import { currentProjectRuntimeRoot } from "./projectRequestContext.js";

// A session's timeline says what happened to it: its turns, conversations, AI
// engine processes, browser connections and failed requests, one JSON line per
// event in <projectRuntimeRoot>/timeline/<sessionId>.jsonl, beside the
// session's state. A line holds event metadata only (ids, states, codes,
// reasons and who asked), never message text, prompts, tool output, secrets
// or file contents; each value is a short string, a number or a boolean.
//
// Recording costs its caller one line built in memory: the lines of a tick are
// appended together after it, without fsync, and a failed append loses only
// those lines. A file that would pass SESSION_TIMELINE_FILE_BYTES first moves
// to <sessionId>.1.jsonl, replacing the older one, and a burst larger than a
// file keeps its newest file's worth, so a session keeps two bounded files at
// most, in memory as on disk; files untouched for SESSION_TIMELINE_RETENTION_MS are
// removed. Files are created for the workspace's own user only (0600 in a
// 0700 folder), and nothing sends them anywhere: `vibe64 timeline` reads them.

const SESSION_TIMELINE_DIRECTORY = "timeline";
const SESSION_TIMELINE_FILE_BYTES = 1024 * 1024;
const SESSION_TIMELINE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const SESSION_TIMELINE_KINDS = Object.freeze(["turn", "conversation", "process", "connection", "request", "server"]);
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const VALUE_MAX_CHARACTERS = 200;
const FIELD_LIMIT = 24;
const WRITER_LIMIT = 256;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const FIELD_NAME_PATTERN = /^[a-z][A-Za-z0-9]{0,39}$/u;

/**
 * The file a session's timeline is appended to, and the older file it rotates to.
 * @param {string} projectRuntimeRoot
 * @param {string} sessionId
 */
function sessionTimelinePaths(projectRuntimeRoot, sessionId) {
  const directory = path.join(projectRuntimeRoot, SESSION_TIMELINE_DIRECTORY);
  return Object.freeze({
    current: path.join(directory, `${sessionId}.jsonl`),
    directory,
    previous: path.join(directory, `${sessionId}.1.jsonl`)
  });
}

/**
 * A field's value as the timeline keeps it: trimmed, secrets redacted and cut
 * to VALUE_MAX_CHARACTERS; a finite number or a boolean as it is; anything
 * else (objects, arrays, empty values) is left out.
 * @param {unknown} value
 */
function timelineValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const text = sanitizeLogText(value).replace(/\s+/gu, " ").trim();
  if (!text) return undefined;
  return text.length > VALUE_MAX_CHARACTERS ? `${text.slice(0, VALUE_MAX_CHARACTERS - 1)}…` : text;
}

/**
 * One event as its line holds it, or null when it names no known kind or no event.
 * @param {Record<string, unknown>} event
 * @param {Date} at
 */
function timelineLine(event, at) {
  const kind = timelineValue(event?.kind);
  const name = timelineValue(event?.event);
  if (!SESSION_TIMELINE_KINDS.includes(kind) || !name) return null;
  const line = { at: at.toISOString(), kind, event: name };
  let fields = 0;
  for (const [field, value] of Object.entries(event)) {
    if (field === "kind" || field === "event" || field === "at" || !FIELD_NAME_PATTERN.test(field)) continue;
    const kept = timelineValue(value);
    if (kept === undefined) continue;
    line[field] = kept;
    if (++fields >= FIELD_LIMIT) break;
  }
  return `${JSON.stringify(line)}\n`;
}

/**
 * A timeline writer. The server uses the module's one writer; tests make
 * their own with smaller bounds and their own clock.
 * @param {object} [options]
 * @param {number} [options.fileBytes] the size a file rotates at
 * @param {number} [options.retentionMs] how long an untouched file is kept
 * @param {() => number} [options.now]
 */
function createSessionTimelineWriter({
  fileBytes = SESSION_TIMELINE_FILE_BYTES,
  retentionMs = SESSION_TIMELINE_RETENTION_MS,
  now = Date.now
} = {}) {
  // One writer per file: its queued lines, its known size (null until read once) and its append chain.
  const writers = new Map();
  // When each folder was last swept for old files, and the sweeps still running.
  const sweeps = new Map();
  const sweeping = new Set();

  function writerFor(projectRuntimeRoot, sessionId) {
    const key = `${projectRuntimeRoot}\n${sessionId}`;
    let writer = writers.get(key);
    if (writer) {
      writers.delete(key);
    } else {
      writer = {
        paths: sessionTimelinePaths(projectRuntimeRoot, sessionId),
        projectRuntimeRoot,
        sessionId,
        lines: [],
        queuedLength: 0,
        size: null,
        pending: null
      };
    }
    writers.set(key, writer);
    if (writers.size > WRITER_LIMIT) {
      for (const [file, candidate] of writers) {
        if (writers.size <= WRITER_LIMIT) break;
        if (!candidate.pending) writers.delete(file);
      }
    }
    return writer;
  }

  async function sweep(directory) {
    const cutoff = now() - retentionMs;
    const names = await readdir(directory).catch(() => []);
    const writerOf = new Map();
    for (const writer of writers.values()) {
      writerOf.set(writer.paths.current, writer);
      writerOf.set(writer.paths.previous, writer);
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const file = path.join(directory, name);
      const writer = writerOf.get(file);
      const info = await stat(file).catch(() => null);
      if (!info?.isFile() || info.mtimeMs >= cutoff || writer?.pending) continue;
      await unlink(file).catch(() => {});
      // Its writer reads the size again before its next line.
      if (writer) writer.size = null;
    }
  }

  function sweepWhenDue(directory) {
    const last = sweeps.get(directory) || 0;
    if (now() - last < SWEEP_INTERVAL_MS) return;
    sweeps.set(directory, now());
    const work = sweep(directory).finally(() => sweeping.delete(work));
    sweeping.add(work);
  }

  async function append(writer) {
    const { lines } = writer;
    writer.lines = [];
    writer.queuedLength = 0;
    if (!lines.length) return;
    let text = lines.join("");
    let bytes = Buffer.byteLength(text);
    if (bytes > fileBytes) {
      // A burst larger than a file keeps its newest lines, as rotation does (and always the newest one).
      let start = lines.length - 1;
      let kept = Buffer.byteLength(lines[start]);
      while (start > 0 && kept + Buffer.byteLength(lines[start - 1]) <= fileBytes) kept += Buffer.byteLength(lines[--start]);
      text = lines.slice(start).join("");
      bytes = kept;
    }
    try {
      if (writer.size === null) {
        await mkdir(writer.paths.directory, { recursive: true, mode: 0o700 });
        writer.size = (await stat(writer.paths.current).catch(() => null))?.size || 0;
      }
      sweepWhenDue(writer.paths.directory);
      if (writer.size > 0 && writer.size + bytes > fileBytes) {
        await rename(writer.paths.current, writer.paths.previous).catch((error) => {
          if (error?.code !== "ENOENT") throw error;
        });
        writer.size = 0;
      }
      await appendFile(writer.paths.current, text, { encoding: "utf8", mode: 0o600 });
      writer.size += bytes;
    } catch {
      // The timeline never fails the work it describes; the next append reads the file's size again.
      writer.size = null;
    }
  }

  function schedule(writer) {
    if (writer.pending) return;
    writer.pending = new Promise((resolve) => {
      setImmediate(() => {
        append(writer).finally(() => {
          writer.pending = null;
          if (writer.lines.length) schedule(writer);
          resolve();
        });
      });
    });
  }

  /**
   * Queues one event for a session's timeline. It returns at once, and false
   * when it recorded nothing: no project, an invalid session id, or an event
   * without a known kind and a name.
   * @param {string} sessionId
   * @param {Record<string, unknown>} event `{ kind, event, ...fields }`
   * @param {{ projectRuntimeRoot?: string }} [options] the project, else the current request's
   */
  function record(sessionId, event, options = {}) {
    try {
      const root = String(options.projectRuntimeRoot ?? currentProjectRuntimeRoot() ?? "").trim();
      const id = String(sessionId || "").trim();
      if (!path.isAbsolute(root) || !SESSION_ID_PATTERN.test(id)) return false;
      const line = timelineLine(event, new Date(now()));
      if (!line) return false;
      const writer = writerFor(root, id);
      writer.lines.push(line);
      writer.queuedLength += line.length;
      if (writer.queuedLength > 2 * fileBytes) {
        // A burst within one tick is held to about a file's worth of its newest lines; append trims it exactly.
        let drop = 0;
        while (writer.queuedLength > fileBytes && drop < writer.lines.length - 1) writer.queuedLength -= writer.lines[drop++].length;
        writer.lines.splice(0, drop);
      }
      schedule(writer);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Queues one event for every session this writer has written to since the
   * server started, such as the server stopping.
   * @param {Record<string, unknown>} event
   */
  function recordForActiveSessions(event) {
    let recorded = 0;
    for (const writer of [...writers.values()]) {
      if (record(writer.sessionId, event, { projectRuntimeRoot: writer.projectRuntimeRoot })) recorded += 1;
    }
    return recorded;
  }

  /** Waits until every queued line has been appended and every sweep has finished. */
  async function flush() {
    while (sweeping.size || [...writers.values()].some((writer) => writer.pending)) {
      await Promise.all([...sweeping, ...[...writers.values()].map((writer) => writer.pending)]);
    }
  }

  return Object.freeze({
    flush,
    record,
    recordForActiveSessions
  });
}

const serverTimeline = createSessionTimelineWriter();

/**
 * @param {string} sessionId
 * @param {Record<string, unknown>} event `{ kind, event, ...fields }`
 * @param {{ projectRuntimeRoot?: string }} [options]
 */
function recordSessionTimelineEvent(sessionId, event, options = {}) {
  return serverTimeline.record(sessionId, event, options);
}

/** @param {Record<string, unknown>} event */
function recordSessionTimelineEventForActiveSessions(event) {
  return serverTimeline.recordForActiveSessions(event);
}

function flushSessionTimeline() {
  return serverTimeline.flush();
}

/**
 * Where a request came from, for an event's `trigger`: the HTTP method and
 * route of the request that is running it, or "".
 * @param {{ method?: string, routeOptions?: { url?: string }, url?: string } | null | undefined} request
 */
function timelineRequestTrigger(request) {
  const route = String(request?.routeOptions?.url || "").trim();
  const method = String(request?.method || "").trim();
  return route ? `${method} ${route}`.trim() : "";
}

/**
 * Who a person is in a timeline: their username, else their id, or "" (never their email).
 * @param {{ username?: string, id?: string | number, uid?: string | number } | null | undefined} user
 */
function timelineActor(user) {
  return String(user?.username || user?.id || user?.uid || "").trim();
}

export {
  SESSION_TIMELINE_DIRECTORY,
  SESSION_TIMELINE_FILE_BYTES,
  SESSION_TIMELINE_KINDS,
  SESSION_TIMELINE_RETENTION_MS,
  createSessionTimelineWriter,
  flushSessionTimeline,
  recordSessionTimelineEvent,
  recordSessionTimelineEventForActiveSessions,
  sessionTimelinePaths,
  timelineActor,
  timelineRequestTrigger
};
