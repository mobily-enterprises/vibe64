import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { listProjectRuntimeRoots } from "./projectState.js";
import { SESSION_TIMELINE_DIRECTORY, SESSION_TIMELINE_KINDS, sessionTimelinePaths } from "./sessionTimeline.js";
import { resolveDefaultLocalEditorSystemRoot, VIBE64_SYSTEM_ROOT_ENV } from "./studioRoots.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

// `vibe64 timeline`: a session's timeline (sessionTimeline.js) in plain words,
// or as JSON lines for tools. It only reads the state folder it is given.

const USAGE = `Usage: vibe64 timeline [SESSION] [options]

Without SESSION, lists the sessions that have a timeline, most recent first.
With SESSION, prints what happened in that session, oldest first.

Options:
  --since TIME      only events at or after TIME: an ISO time, or a time back
                    from now such as 90s, 30m, 2h or 7d
  --until TIME      only events before TIME
  --kind KINDS      only these kinds, separated by commas:
                    ${SESSION_TIMELINE_KINDS.join(", ")}
  --project NAME    the project folder, when several projects have SESSION
  --state-root DIR  the Vibe64 state folder (default: $${VIBE64_SYSTEM_ROOT_ENV}, else
                    this user's own, such as ~/.local/state/vibe64)
  --json            one JSON object per line, for tools
  --help            show this help
`;

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const DURATION_PATTERN = /^(\d+(?:\.\d+)?)(s|m|h|d)$/u;
const DURATION_MS = Object.freeze({ s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 });

const HEADLINES = Object.freeze({
  "turn.started": "Turn started",
  "turn.steered": "Message added to the running turn",
  "turn.refused": "Message not sent",
  "turn.running": "Turn running",
  "turn.finished": "Turn finished",
  "turn.failed": "Turn failed",
  "turn.interrupted": "Turn interrupted",
  "turn.cancelled": "Turn cancelled",
  "turn.timed-out": "Turn stopped at its deadline",
  "turn.observation-lost": "Vibe64 lost sight of the turn",
  "turn.ended": "Turn ended",
  "turn.cancel-requested": "Cancel requested",
  "turn.stop-requested": "Stop requested",
  "conversation.created": "Conversation created",
  "conversation.deleted": "Conversation deleted",
  "conversation.closed": "Conversation closed",
  "conversation.engine-session-closed": "AI engine session closed",
  "conversation.task-started": "AI task started",
  "conversation.task-closed": "AI task closed",
  "process.started": "AI engine process started",
  "process.start-failed": "AI engine process could not start",
  "process.exited": "AI engine process exited",
  "process.stopped": "AI engine process stopped by Vibe64",
  "connection.connected": "Browser tab connected",
  "connection.reconnected": "Browser tab reconnected",
  "connection.disconnected": "Browser tab disconnected",
  "connection.left": "Browser tab left the session",
  "request.failed": "Request failed",
  "server.stopping": "Vibe64 server stopping"
});

const CHAT_NAMES = Object.freeze({
  "ai-task": "AI task window",
  colleague: "Colleague",
  main: "Main chat",
  temporary: "temporary chat"
});

function durationText(milliseconds) {
  const seconds = Math.round(Number(milliseconds) / 1000);
  if (seconds < 120) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 120 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

// Each known field in reading order, worded; the rest follow as name=value.
const FIELD_WORDS = Object.freeze([
  ["engine", (value) => `engine ${value}`],
  ["turn", (value) => `turn ${value}`],
  ["thread", (value) => `thread ${value}`],
  ["message", (value) => `message ${value}`],
  ["operation", (value) => `${value}`],
  ["execution", (value) => `process ${value}`],
  ["pid", (value) => `pid ${value}`],
  ["exitCode", (value) => `exit code ${value}`],
  ["signal", (value) => `signal ${value}`],
  ["taskLimit", (value) => (value ? "it reached its task limit" : "")],
  ["tab", (value) => `tab ${value}`],
  ["user", (value) => `user ${value}`],
  ["by", (value) => `asked by ${value}`],
  ["offlineMs", (value) => `after ${durationText(value)} offline`],
  ["reason", (value) => `reason: ${value}`],
  ["status", (value) => `status ${value}`],
  ["state", (value) => `state ${value}`],
  ["ok", (value) => (value === false ? "it did not succeed" : "")],
  ["code", (value) => `code ${value}`],
  ["error", (value) => `error: ${value}`],
  ["trigger", (value) => `via ${value}`]
]);
const WORDED_FIELDS = new Set(["at", "kind", "event", "chat", "conversation", "method", "route", "project", "session",
  ...FIELD_WORDS.map(([field]) => field)]);

/**
 * One event in plain words: its time, what happened, then its details.
 * @param {Record<string, unknown>} event
 */
function describeTimelineEvent(event) {
  const details = [];
  if (event.method || event.route) details.push(`${event.method || ""} ${event.route || ""}`.trim());
  if (event.chat || event.conversation) {
    const chat = CHAT_NAMES[event.chat] || event.chat || "conversation";
    details.push(event.conversation ? `${chat} ${event.conversation}` : chat);
  }
  for (const [field, words] of FIELD_WORDS) {
    const text = event[field] === undefined || event[field] === "" ? "" : words(event[field]);
    if (text) details.push(text);
  }
  for (const [field, value] of Object.entries(event)) {
    if (!WORDED_FIELDS.has(field)) details.push(`${field}=${value}`);
  }
  const headline = HEADLINES[`${event.kind}.${event.event}`] || `${event.kind} ${event.event}`;
  return `${event.at}  ${headline}${details.length ? ` (${details.join("; ")})` : ""}`;
}

function usageError(message) {
  return Object.assign(new Error(message), { usage: true });
}

/**
 * A --since or --until value as epoch milliseconds, or null when not given.
 * @param {string | undefined} value
 * @param {number} now
 * @param {string} option
 */
function parseTime(value, now, option) {
  if (value === undefined) return null;
  const duration = DURATION_PATTERN.exec(String(value).trim());
  if (duration) return now - Number(duration[1]) * DURATION_MS[duration[2]];
  const time = Date.parse(String(value));
  if (Number.isNaN(time)) throw usageError(`${option} needs an ISO time or a time back from now such as 30m: ${value}`);
  return time;
}

function parseKinds(value) {
  if (value === undefined) return null;
  const kinds = String(value).split(",").map((kind) => kind.trim()).filter(Boolean);
  const unknown = kinds.filter((kind) => !SESSION_TIMELINE_KINDS.includes(kind));
  if (!kinds.length || unknown.length) {
    throw usageError(`--kind takes ${SESSION_TIMELINE_KINDS.join(", ")}; not ${unknown.join(", ") || "nothing"}.`);
  }
  return new Set(kinds);
}

/**
 * @param {string[]} argv
 * @param {{ env: Record<string, string | undefined>, now: number }} context
 */
function parseTimelineArguments(argv, { env, now }) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean" },
        json: { type: "boolean" },
        kind: { type: "string" },
        project: { type: "string" },
        since: { type: "string" },
        "state-root": { type: "string" },
        until: { type: "string" }
      }
    });
  } catch (error) {
    throw usageError(error.message);
  }
  const { positionals, values } = parsed;
  if (positionals.length > 1) throw usageError("Name one session at most.");
  const sessionId = positionals[0] || "";
  if (sessionId && !SESSION_ID_PATTERN.test(sessionId)) throw usageError(`Not a session id: ${sessionId}`);
  const stateRoot = String(values["state-root"] || env[VIBE64_SYSTEM_ROOT_ENV] || "").trim() ||
    resolveDefaultLocalEditorSystemRoot({ env });
  return Object.freeze({
    help: values.help === true,
    json: values.json === true,
    kinds: parseKinds(values.kind),
    project: String(values.project || "").trim(),
    sessionId,
    since: parseTime(values.since, now, "--since"),
    stateRoot: path.resolve(stateRoot),
    until: parseTime(values.until, now, "--until")
  });
}

/**
 * Every session timeline under a state folder, most recently written first.
 * @param {string} stateRoot
 */
async function listSessionTimelines(stateRoot) {
  const timelines = new Map();
  for (const projectRuntimeRoot of await listProjectRuntimeRoots(stateRoot)) {
    const directory = path.join(projectRuntimeRoot, SESSION_TIMELINE_DIRECTORY);
    for (const name of await readdir(directory).catch(() => [])) {
      const sessionId = name.replace(/(\.1)?\.jsonl$/u, "");
      if (sessionId === name || !SESSION_ID_PATTERN.test(sessionId)) continue;
      const info = await stat(path.join(directory, name)).catch(() => null);
      if (!info?.isFile()) continue;
      const key = `${projectRuntimeRoot}\n${sessionId}`;
      const entry = timelines.get(key) ||
        { project: path.basename(projectRuntimeRoot), projectRuntimeRoot, sessionId, bytes: 0, updatedMs: 0 };
      entry.bytes += info.size;
      entry.updatedMs = Math.max(entry.updatedMs, info.mtimeMs);
      timelines.set(key, entry);
    }
  }
  return [...timelines.values()].sort((left, right) => right.updatedMs - left.updatedMs);
}

/**
 * A session's events, oldest first, within the window and kinds asked for.
 * A line that cannot be read (a torn last write) is skipped.
 * @param {string} projectRuntimeRoot
 * @param {string} sessionId
 * @param {{ since?: number | null, until?: number | null, kinds?: Set<string> | null }} [filter]
 */
async function readSessionTimeline(projectRuntimeRoot, sessionId, { since = null, until = null, kinds = null } = {}) {
  const paths = sessionTimelinePaths(projectRuntimeRoot, sessionId);
  const events = [];
  for (const file of [paths.previous, paths.current]) {
    const text = await readFile(file, "utf8").catch((error) => {
      if (error?.code === "ENOENT") return "";
      throw error;
    });
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const at = Date.parse(event?.at);
      if (Number.isNaN(at) || (since !== null && at < since) || (until !== null && at >= until)) continue;
      if (kinds && !kinds.has(event.kind)) continue;
      events.push(event);
    }
  }
  return events;
}

function writeLine(stream, text) {
  stream.write(`${text}\n`);
}

async function printList(options, stdout) {
  const timelines = await listSessionTimelines(options.stateRoot);
  const shown = timelines.filter((timeline) => !options.project || timeline.project === options.project);
  for (const timeline of shown) {
    const updatedAt = new Date(timeline.updatedMs).toISOString();
    if (options.json) {
      writeLine(stdout, JSON.stringify({ project: timeline.project, session: timeline.sessionId, bytes: timeline.bytes, updatedAt }));
    } else {
      writeLine(stdout, `${updatedAt}  ${timeline.project} ${timeline.sessionId}  ${Math.ceil(timeline.bytes / 1024)} KB`);
    }
  }
  if (!shown.length && !options.json) writeLine(stdout, `No session timelines under ${options.stateRoot}.`);
  return 0;
}

async function printSession(options, stdout, stderr) {
  const matches = (await listSessionTimelines(options.stateRoot)).filter((timeline) => (
    timeline.sessionId === options.sessionId && (!options.project || timeline.project === options.project)
  ));
  if (matches.length !== 1) {
    writeLine(stderr, matches.length
      ? `Session ${options.sessionId} is in several projects (${matches.map(({ project }) => project).join(", ")}); add --project NAME.`
      : `No timeline for session ${options.sessionId} under ${options.stateRoot}. Run vibe64 timeline to list them.`);
    return 1;
  }
  const [{ project, projectRuntimeRoot }] = matches;
  const events = await readSessionTimeline(projectRuntimeRoot, options.sessionId, options);
  for (const event of events) {
    writeLine(stdout, options.json ? JSON.stringify({ project, session: options.sessionId, ...event }) : describeTimelineEvent(event));
  }
  if (!events.length && !options.json) writeLine(stdout, "No events in that window.");
  return 0;
}

/**
 * Runs `vibe64 timeline`, answering its exit status: 0 done, 1 not found or unreadable, 2 a usage error.
 * @param {string[]} argv the arguments after `timeline`
 * @param {object} io
 * @param {RuntimeEnv} io.env the environment, which the entry point passes
 * @param {{ write(text: string): unknown }} [io.stdout]
 * @param {{ write(text: string): unknown }} [io.stderr]
 * @param {number} [io.now]
 */
async function runSessionTimelineCli(argv, {
  env,
  stdout = process.stdout,
  stderr = process.stderr,
  now = Date.now()
}) {
  let options;
  try {
    options = parseTimelineArguments(argv, { env, now });
  } catch (error) {
    writeLine(stderr, `${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    stdout.write(USAGE);
    return 0;
  }
  try {
    return options.sessionId ? await printSession(options, stdout, stderr) : await printList(options, stdout);
  } catch (error) {
    writeLine(stderr, `vibe64 timeline could not read ${options.stateRoot}: ${error.message}`);
    return 1;
  }
}

export {
  describeTimelineEvent,
  listSessionTimelines,
  readSessionTimeline,
  runSessionTimelineCli
};
