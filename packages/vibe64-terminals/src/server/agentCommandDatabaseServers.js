// A database server an agent session command starts among its own processes ends with that command, at the latest at
// the command's 30-minute limit, and every test using it fails then. While a command runs, its processes are read every
// 5 seconds, and the first database server among them is reported once, so the AI hears it at once and moves to the
// session's own database server, which runs outside agent commands.
//
// A command's processes are what its stop ends: on a host that runs each command in a systemd unit of its own, every
// process in that unit's control group and the groups below it, which setsid, a daemon's double fork and a new parent
// never leave; elsewhere, its process group. A process is a database server by the name of its executable
// (/proc/<pid>/exe): never by the command's text, and never by its environment, which holds secrets. A process whose
// executable cannot be read, another user's, is not one.

import { appendFile, readdir, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { linuxProcessStat, processEnded } from "@local/vibe64-execution/server/processEnded";
import { databaseServerInCommandNotice } from "./agentSessionCommandRun.js";

const DATABASE_SERVER_EXECUTABLES = Object.freeze(new Set(["mariadbd", "mysqld", "postgres"]));
const DATABASE_SERVER_SCAN_MS = 5000;
// Control groups a unit made below its own, as deep as a delegated unit's go.
const CONTROL_GROUP_DEPTH = 4;

/** The unified-hierarchy control group a /proc/<pid>/cgroup text names, or "". */
function controlGroupPath(text = "") {
  const line = String(text || "").split("\n").find((candidate) => candidate.startsWith("0::"));
  return line ? line.slice(3).trim() : "";
}

/** Every process in `group` and the groups below it. */
async function controlGroupProcessIds(group, depth = 0) {
  const ids = String(await readFile(path.join(group, "cgroup.procs"), "utf8").catch(() => ""))
    .split("\n").map(Number).filter((pid) => Number.isSafeInteger(pid) && pid > 0);
  if (depth >= CONTROL_GROUP_DEPTH) return ids;
  for (const entry of await readdir(group, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) ids.push(...await controlGroupProcessIds(path.join(group, entry.name), depth + 1));
  }
  return ids;
}

/** Every running process of process group `groupId`. */
async function processGroupIds(groupId, procRoot) {
  const ids = [];
  for (const entry of await readdir(procRoot).catch(() => [])) {
    if (!/^\d+$/u.test(entry)) continue;
    const stat = linuxProcessStat(await readFile(path.join(procRoot, entry, "stat"), "utf8").catch(() => ""));
    if (stat?.groupId === groupId && !processEnded(stat)) ids.push(Number(entry));
  }
  return ids;
}

/**
 * The processes of the command whose runner is `runnerPid`: its own control group's when it has one (a group that is
 * neither this server's nor one holding it), otherwise its process group's.
 * @param {number} runnerPid
 * @param {{ procRoot?: string, cgroupRoot?: string }} [roots] where /proc and the cgroup2 mount are (tests give others)
 */
async function commandProcessIds(runnerPid, { procRoot = "/proc", cgroupRoot = "/sys/fs/cgroup" } = {}) {
  const read = (pid, name) => readFile(path.join(procRoot, String(pid), name), "utf8").catch(() => "");
  const group = controlGroupPath(await read(runnerPid, "cgroup"));
  const own = controlGroupPath(await read("self", "cgroup"));
  if (group && group !== "/" && group !== own && !own.startsWith(`${group}/`)) {
    return controlGroupProcessIds(path.join(cgroupRoot, group));
  }
  const stat = linuxProcessStat(await read(runnerPid, "stat"));
  return stat && stat.groupId > 0 ? processGroupIds(stat.groupId, procRoot) : [];
}

/**
 * The first database server among the command's processes, by its executable's name, or null.
 * @param {number} runnerPid
 * @param {{ procRoot?: string, cgroupRoot?: string }} [roots]
 * @returns {Promise<{ executable: string, pid: number } | null>}
 */
async function commandDatabaseServer(runnerPid, roots = {}) {
  const procRoot = roots.procRoot || "/proc";
  for (const pid of await commandProcessIds(runnerPid, roots)) {
    const target = await readlink(path.join(procRoot, String(pid), "exe")).catch(() => "");
    const executable = path.basename(target.replace(/ \(deleted\)$/u, ""));
    if (DATABASE_SERVER_EXECUTABLES.has(executable)) return { executable, pid };
  }
  return null;
}

/**
 * Reads a running command's processes every `intervalMs` until it reports a database server among them, once, or is
 * stopped. The runner writes its process ID to `pidPath` as it starts.
 * @param {{ pidPath: string, onFound: (server: { executable: string, pid: number }) => Promise<unknown> | unknown,
 *   intervalMs?: number, roots?: { procRoot?: string, cgroupRoot?: string } }} options
 * @returns {() => void} stops the reading
 */
function watchCommandDatabaseServers({ pidPath, onFound, intervalMs = DATABASE_SERVER_SCAN_MS, roots = {} }) {
  if (process.platform !== "linux") return () => {};
  let stopped = false;
  let timer = null;
  async function scan() {
    const runnerPid = Number.parseInt(await readFile(pidPath, "utf8").catch(() => ""), 10);
    const found = runnerPid > 0 ? await commandDatabaseServer(runnerPid, roots).catch(() => null) : null;
    if (stopped) return;
    if (found) {
      stopped = true;
      await Promise.resolve().then(() => onFound(found)).catch(() => null);
      return;
    }
    schedule();
  }
  function schedule() {
    timer = setTimeout(() => {
      void scan().catch(() => null);
    }, intervalMs);
    timer.unref();
  }
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/**
 * How the session command service watches each running command for a database server among its processes, and tells
 * the AI of the first one, once: in the command's output at once, and as Vibe64's note to the main chat, which a
 * running turn hears now and otherwise its next message leads with (mainChatNote.js).
 * @param {object} options
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} options.logger
 * @param {import("./agentCommandRepeats.js").NoteAgent} options.noteAgent
 * @param {(store: object, sessionId: string, binding: object) => Promise<{ actor: object | null }>} options.requestTurn
 *   the session's current request, whose person the note is for
 * @param {number} [options.intervalMs]
 * @param {string} [options.procRoot] tests give their own /proc
 * @param {string} [options.cgroupRoot] and cgroup2 mount
 * @returns {(command: { context: { store: object, binding: { projectSlug: string } }, executionId: string,
 *   outputPath: string, pidPath: string, sessionId: string }) => () => void} starts watching a command, and answers
 *   what stops it
 */
function commandDatabaseServerWatch(options) {
  const { logger, noteAgent, requestTurn, intervalMs, procRoot, cgroupRoot } = options;
  return function watch(command) {
    const { context, executionId, outputPath, pidPath } = command;
    const sessionId = String(command.sessionId || "").trim();
    async function tell(server) {
      const notice = databaseServerInCommandNotice(server);
      logOperationalEvent(logger, "warn", {
        component: "vibe64.agent_session_command",
        event: "vibe64.agent_session_command.database_server",
        executable: server.executable,
        executionId,
        pid: server.pid,
        sessionId
      }, "An agent command started a database server among its own processes.");
      await appendFile(outputPath, `\n${notice}\n`).catch(() => null);
      const turn = await requestTurn(context.store, sessionId, context.binding).catch(() => null);
      await noteAgent(sessionId, notice, { actor: turn?.actor || null, projectSlug: context.binding.projectSlug, nextTurn: true });
    }
    return watchCommandDatabaseServers({ pidPath, intervalMs, roots: { procRoot, cgroupRoot }, onFound: tell });
  };
}

export {
  commandDatabaseServer,
  DATABASE_SERVER_EXECUTABLES,
  commandDatabaseServerWatch,
  watchCommandDatabaseServers
};
