// The command executor: the one place a finite command is started. commandSpawner.js explains why and where it runs:
// in the command spawner's process for the editor, or in a small process that never starts a spawner.
//
// It is a dumb executor. It decides nothing: each command reaching it was approved by the editor's checks, and it
// starts exactly that command with Node's spawn, with the options it is given, and reports what happens to it.
//
// Messages it receives:
//   { type: "spawn", id, command, args, options: { cwd, detached, env, stdio }, input }
//   { type: "kill", id, signal }
//   { type: "stop-reading", id, stream }        stream is "stdout" or "stderr"
//   { type: "starts-read", count }              the editor has read `count` more start records
// Messages it sends, each naming the command by its id:
//   { type: "spawn", id, pid }                   the answer to spawn: pid is undefined when it did not start
//   { type: "spawn-refused", id, error }         the answer to spawn when spawn() threw: nothing started
//   { type: "kill", id, sent }                   the answer to kill
//   { type: "error", id, error, final }          a ChildProcess "error"; final when the command never started
//   { type: "stdout" | "stderr", id, chunk }     output, as Buffers
//   { type: "input-error", id, error }           writing the command's input failed
//   { type: "exit", id, code, signal }
//   { type: "close", id, code, signal }          the last message about a command spawn() did not refuse
// It refuses any other message (`refuse`), so the two sides never guess at each other.
//
// In the spawner, each command that starts is also recorded (`recordStart`), in the same synchronous step as the
// spawn() that started it and before this process does anything else: its id and pid, as a START_RECORD_BYTES record,
// into a pipe only the editor reads, which keeps what was written after this process dies. At most START_RECORD_CAP
// records wait there unread; at the cap, the messages that follow wait, in order, until the editor says it has read
// more, so the pipe never fills and a record's write never waits.

import { spawn } from "node:child_process";
import { constants } from "node:os";

// An id (64 bits) and a pid (32 bits), little-endian.
const START_RECORD_BYTES = 12;
// Linux keeps each small write to a socket pair as its own buffer: at the default buffer size, a test host's pipe held
// 180 records before a write would wait, so the cap stays well under it.
const START_RECORD_CAP = 64;
const SIGNALS = new Set([...Object.keys(constants.signals), ...Object.values(constants.signals)]);

/**
 * @param {object} channel
 * @param {(message: object, onWritten: () => void) => boolean} channel.send delivers one message and calls onWritten
 *   once it has been written; false while the channel's backlog is full
 * @param {(message: unknown) => void} channel.refuse called with a message it does not know
 * @param {((id: number, pid: number) => void) | null} channel.recordStart records a started command where the editor
 *   reads it even after this process dies; null where the editor is this process
 * @returns {{ receive: (message: unknown) => void, endAll: (graceMs: number) => Promise<void> }} receive takes one
 *   message; endAll ends every command still running, as the detached reaper ends a group: SIGTERM to each one's
 *   process group, then SIGKILL to the groups still there after graceMs
 */
function createCommandExecutor({ send: deliver, refuse, recordStart }) {
  const children = new Map();
  const waiting = [];
  let unreadStarts = 0;
  let pausedBy = null;

  // While the channel's backlog is full, the commands' output waits in their pipes instead of piling up here; it flows
  // again once the message that filled the backlog has been written.
  function send(message) {
    const delivered = deliver(message, () => {
      if (pausedBy !== message) return;
      pausedBy = null;
      setOutputFlowing(true);
    });
    if (delivered || pausedBy) return;
    pausedBy = message;
    setOutputFlowing(false);
  }

  function setOutputFlowing(flowing) {
    for (const child of children.values()) {
      for (const stream of [child.stdout, child.stderr]) {
        if (flowing) stream?.resume();
        else stream?.pause();
      }
    }
  }

  function start({ id, command, args, options, input }) {
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        detached: options.detached,
        env: options.env,
        stdio: options.stdio,
        windowsHide: true
      });
    } catch (error) {
      send({ type: "spawn-refused", id, error: errorFields(error) });
      return;
    }
    if (recordStart && child.pid !== undefined) {
      recordStart(id, child.pid);
      unreadStarts += 1;
    }
    children.set(id, child);
    send({ type: "spawn", id, pid: child.pid });
    // A command that never started gets its close next, as a ChildProcess does.
    child.on("error", (error) => send({ type: "error", id, error: errorFields(error), final: child.pid === undefined }));
    for (const name of ["stdout", "stderr"]) {
      child[name]?.on("data", (chunk) => send({ type: name, id, chunk }));
      if (pausedBy) child[name]?.pause();
    }
    if (child.stdin) {
      child.stdin.on("error", (error) => send({ type: "input-error", id, error: errorFields(error) }));
      child.stdin.end(input ?? undefined);
    }
    child.on("exit", (code, signal) => send({ type: "exit", id, code, signal }));
    child.on("close", (code, signal) => {
      if (!children.delete(id)) return;
      send({ type: "close", id, code, signal });
    });
  }

  function handle(message) {
    if (!knownMessage(message, children)) {
      refuse(message);
    } else if (message.type === "spawn") {
      start(message);
    } else if (message.type === "kill") {
      const child = children.get(message.id);
      send({ type: "kill", id: message.id, sent: child ? child.kill(message.signal) : false });
    } else {
      children.get(message.id)?.[message.stream]?.destroy();
    }
  }

  // Handles the messages in order while fewer than START_RECORD_CAP starts wait unread.
  function handleWaiting() {
    while (waiting.length > 0 && unreadStarts < START_RECORD_CAP) handle(waiting.shift());
  }

  function receive(message) {
    if (message?.type !== "starts-read") {
      waiting.push(message);
    } else if (Number.isSafeInteger(message.count) && message.count > 0 && message.count <= unreadStarts) {
      unreadStarts -= message.count;
    } else {
      refuse(message);
    }
    handleWaiting();
  }

  async function endAll(graceMs) {
    const running = [...children.values()].filter((child) => child.pid !== undefined);
    const signal = (name) => {
      for (const child of running) signalGroup(child, name);
    };
    signal("SIGTERM");
    const deadline = Date.now() + graceMs;
    while (running.some(groupRuns) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    signal("SIGKILL");
  }

  return Object.freeze({
    endAll,
    receive
  });
}

// Each command leads its own process group outside Windows; there, only the command itself can be signalled.
function signalGroup(child, signal) {
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // An ended group needs nothing more.
  }
}

function groupRuns(child) {
  if (process.platform === "win32") return child.exitCode === null && child.signalCode === null;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function knownMessage(message, children) {
  if (!message || typeof message !== "object" || !Number.isSafeInteger(message.id)) return false;
  if (message.type === "spawn") {
    const { options } = message;
    return !children.has(message.id) && typeof message.command === "string" && Array.isArray(message.args) &&
      Boolean(options) && typeof options === "object" && typeof options.cwd === "string" &&
      Boolean(options.env) && typeof options.env === "object" && Array.isArray(options.stdio);
  }
  if (message.type === "kill") return SIGNALS.has(message.signal);
  return message.type === "stop-reading" && ["stdout", "stderr"].includes(message.stream);
}

function errorFields(error) {
  const { code, errno, path, spawnargs, syscall } = error || {};
  return { code, errno, message: String(error?.message ?? error), name: error?.name, path, spawnargs, syscall };
}

/** A short description of a refused message, which names its type and never its contents. */
function describeMessage(message) {
  return message && typeof message === "object" ? `type ${JSON.stringify(String(message.type))}` : typeof message;
}

export {
  SIGNALS,
  START_RECORD_BYTES,
  START_RECORD_CAP,
  createCommandExecutor,
  describeMessage
};
