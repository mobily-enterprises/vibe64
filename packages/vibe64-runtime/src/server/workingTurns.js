// Which Main chat turns are working now in a system root's projects, read from the agent runs the session store
// writes (sessionRecords.js writeAgentRunEvent: one file per engine transport in each active session's agent-runs
// folder). A session is working while any of its runs is in an active state, as the session list shows it
// (sessionRecordFiles.js readAgentRunActivityFromPaths); an assistant waiting at its prompt has its runs ended.
//
// It is for a tool that tells a host's work from outside the editor, under a small memory bound and with broad read
// access, such as one that decides whether restarting the editor now would interrupt a turn. It imports only Node and
// the run states (agentRunStates.js), reads only runs' and events' states and times (never a message or an error),
// opens each run without following a link, reads none larger than MAX_AGENT_RUN_BYTES, and remembers each run's
// answer until its file changes. Its folder names are those of projectState.js (EXTERNAL_PROJECT_LOCAL_ROOTS_DIR,
// sessions) and sessionStoreLayout.js (active, agent-runs); tests/server/workingTurns.unit.test.js holds it to them
// and to the session store's own answer.

import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import { AGENT_RUN_ID_PATTERN, runStateIsActive } from "./agentRunStates.js";

const PROJECTS_DIR = "projects";
const ACTIVE_SESSIONS_DIR = path.join("sessions", "active");
const AGENT_RUNS_DIR = "agent-runs";
/**
 * A run keeps its last two turns' events (agentRunHistory.js moves earlier ones to its history), so only a very long
 * turn, or a run an earlier release grew before the 20261125-agent-run-history upgrade, comes near this. A run larger
 * than this is not read, and counts as working with its start unknown: a tool deciding whether a restart would
 * interrupt a turn must not take a run it could not read for ended.
 */
const MAX_AGENT_RUN_BYTES = 4 * 1024 * 1024;
const RUN_CACHE_LIMIT = 1024;
/** Each run file's answer while its identity (device, inode, size, change times) is the same. */
const runCache = new Map();

/**
 * The turn a run record says is working, or null: it started at the first of the run's last events that are all in
 * an active state (a run's own `startedAt` is its first turn's, which may be long gone), or at the run's start
 * when it has no events; null when nothing names the time.
 * @param {any} record
 * @returns {{ startedAt: string | null } | null}
 */
function workingTurnOfRun(record) {
  if (!record || typeof record !== "object" || Array.isArray(record) || !runStateIsActive(record.state)) return null;
  const events = Array.isArray(record.events) ? record.events : [];
  if (events.length === 0) return { startedAt: typeof record.startedAt === "string" ? record.startedAt : null };
  let startedAt = null;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || typeof event !== "object" || !runStateIsActive(event.state)) break;
    if (typeof event.at === "string") startedAt = event.at;
  }
  return { startedAt };
}

/**
 * A run file's working turn: null when it is not a regular file, is gone, cannot be read or parsed, or is not working.
 * @param {string} filePath
 * @returns {Promise<{ startedAt: string | null } | null>}
 */
async function readRunTurn(filePath) {
  const info = await lstat(filePath, { bigint: true }).catch(() => null);
  if (!info?.isFile()) return null;
  if (info.size > BigInt(MAX_AGENT_RUN_BYTES)) return { startedAt: null };
  const identity = `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  const cached = runCache.get(filePath);
  if (cached?.identity === identity) return cached.turn;
  let file;
  let turn;
  try {
    file = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
    const opened = await file.stat();
    if (!opened.isFile()) return null;
    if (opened.size > MAX_AGENT_RUN_BYTES) return { startedAt: null };
    // One byte more than the file held, so a file that grew since cannot make the read unbounded.
    const buffer = Buffer.alloc(opened.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > opened.size) return null;
    turn = workingTurnOfRun(JSON.parse(buffer.subarray(0, size).toString("utf8")));
  } catch {
    return null;
  } finally {
    await file?.close();
  }
  runCache.delete(filePath);
  runCache.set(filePath, { identity, turn });
  if (runCache.size > RUN_CACHE_LIMIT) runCache.delete(runCache.keys().next().value);
  return turn;
}

/** The names of a folder's real subfolders (never a link), sorted; none when it is not one. @param {string} folder */
async function subfolderNames(folder) {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

/**
 * The turn a session's Main chat is working, or null: of its runs in an active state, the one that started first.
 * @param {string} sessionRoot an active session's folder
 */
async function sessionWorkingTurn(sessionRoot) {
  const runsRoot = path.join(sessionRoot, AGENT_RUNS_DIR);
  if (!(await lstat(runsRoot).catch(() => null))?.isDirectory()) return null;
  const names = (await readdir(runsRoot).catch(() => []))
    .filter((name) => name.endsWith(".json") && AGENT_RUN_ID_PATTERN.test(name.slice(0, -".json".length)))
    .sort();
  let working = null;
  for (const name of names) {
    const turn = await readRunTurn(path.join(runsRoot, name));
    if (turn && (!working || (turn.startedAt !== null && (working.startedAt === null || turn.startedAt < working.startedAt)))) {
      working = turn;
    }
  }
  return working;
}

/**
 * The Main chat turns working now in a system root's projects (its `projects/<slug>` folders are the projects'
 * runtime roots), by project folder and session folder, each with when its turn started (null when its run does not
 * say, or is too large to read). Temporary chats, AI tasks and Colleague keep no agent runs, so their turns are not
 * here.
 * @param {{ systemRoot: string }} options
 * @returns {Promise<Array<{ projectSlug: string, sessionId: string, startedAt: string | null }>>}
 */
async function readVibe64WorkingTurns({ systemRoot }) {
  if (!path.isAbsolute(systemRoot || "")) throw new Error("Working turns are read from an absolute system root.");
  const projectsRoot = path.join(systemRoot, PROJECTS_DIR);
  const turns = [];
  for (const projectSlug of await subfolderNames(projectsRoot)) {
    const sessionsRoot = path.join(projectsRoot, projectSlug, ACTIVE_SESSIONS_DIR);
    for (const sessionId of await subfolderNames(sessionsRoot)) {
      const turn = await sessionWorkingTurn(path.join(sessionsRoot, sessionId));
      if (turn) turns.push({ projectSlug, sessionId, startedAt: turn.startedAt });
    }
  }
  return turns;
}

export { AGENT_RUNS_DIR, MAX_AGENT_RUN_BYTES, PROJECTS_DIR, readVibe64WorkingTurns, runStateIsActive };
