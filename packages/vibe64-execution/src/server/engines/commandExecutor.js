// The command executor: the one place a finite command is started. commandSpawner.js explains why and where it runs:
// in the command spawner's process for the editor, or in a small process that never starts a spawner.
//
// It is a dumb executor. It decides nothing: each command reaching it was approved by the editor's checks, and it
// starts exactly that command with Node's spawn, with the options it is given, and reports what happens to it.
//
// Messages it receives:
//   { type: "spawn", id, command, args, options: { cwd, env, detached, stdio }, input }
//   { type: "kill", id, signal }
//   { type: "stop-reading", id, stream }        stream is "stdout" or "stderr"
// Messages it sends, each naming the command by its id:
//   { type: "spawn", id, pid }                   the answer to spawn: pid is undefined when it did not start
//   { type: "spawn-refused", id, error }         the answer to spawn when spawn() threw: nothing started
//   { type: "kill", id, sent }                   the answer to kill
//   { type: "error", id, error, final }          a ChildProcess "error"; final when the command never started
//   { type: "stdout" | "stderr", id, chunk }     output, as Buffers
//   { type: "input-error", id, error }           writing the command's input failed
//   { type: "exit", id, code, signal }
//   { type: "close", id, code, signal }          the last message about a command that started
// It refuses any other message (`refuse`), so the two sides never guess at each other.

import { spawn } from "node:child_process";

/**
 * @param {object} channel
 * @param {(message: object) => boolean} channel.send delivers one message; false while its backlog is full
 * @param {(onDrained: () => void) => void} channel.whenDrained calls back once a full backlog has drained
 * @param {(message: unknown) => void} channel.refuse called with a message it does not know
 * @returns {(message: unknown) => void} receives one message
 */
function createCommandExecutor({ send: deliver, whenDrained, refuse }) {
  const children = new Map();
  let paused = false;

  // While the channel's backlog is full, the commands' output waits instead of piling up here.
  function send(message) {
    if (deliver(message) || paused) return;
    setOutputFlowing(false);
    whenDrained(() => setOutputFlowing(true));
  }

  function setOutputFlowing(flowing) {
    paused = !flowing;
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
        detached: options.detached === true,
        env: options.env,
        stdio: options.stdio,
        windowsHide: true
      });
    } catch (error) {
      send({ type: "spawn-refused", id, error: errorFields(error) });
      return;
    }
    children.set(id, child);
    send({ type: "spawn", id, pid: child.pid });
    child.on("error", (error) => {
      // A command that never started sends nothing more.
      const final = child.pid === undefined;
      if (final) children.delete(id);
      send({ type: "error", id, error: errorFields(error), final });
    });
    for (const name of ["stdout", "stderr"]) {
      child[name]?.on("data", (chunk) => send({ type: name, id, chunk }));
      if (paused) child[name]?.pause();
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

  return function receive(message) {
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
  };
}

function knownMessage(message, children) {
  if (!message || typeof message !== "object" || !Number.isSafeInteger(message.id)) return false;
  if (message.type === "spawn") {
    return !children.has(message.id) && typeof message.command === "string" && Array.isArray(message.args) &&
      Boolean(message.options) && typeof message.options === "object";
  }
  if (message.type === "kill") return typeof message.signal === "string" || typeof message.signal === "number";
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
  createCommandExecutor,
  describeMessage
};
