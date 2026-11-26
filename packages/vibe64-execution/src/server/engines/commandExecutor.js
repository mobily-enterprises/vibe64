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
//
// It starts a command only once every message it sent before has been written to the channel, and holds the commands'
// output meanwhile, so the answer carrying the new pid is written in the same step that starts it, never queued behind
// output in this process's memory: a spawner that dies after that step has handed the pid on. The messages that came
// after a held spawn wait behind it, in order.

import { spawn } from "node:child_process";

/**
 * @param {object} channel
 * @param {(message: object) => boolean} channel.send delivers one message; false while its backlog is full
 * @param {() => boolean} channel.written true once every message sent so far has been written
 * @param {(onWritten: () => void) => void} channel.whenWritten calls back once every message sent so far has been written
 * @param {(message: unknown) => void} channel.refuse called with a message it does not know
 * @returns {(message: unknown) => void} receives one message
 */
function createCommandExecutor({ send: deliver, written, whenWritten, refuse }) {
  const children = new Map();
  const waiting = [];
  let backlogFull = false;
  let holdingSpawn = false;

  // While the channel's backlog is full, the commands' output waits instead of piling up here.
  function send(message) {
    if (deliver(message) || backlogFull) return;
    backlogFull = true;
    updateOutputFlow();
    whenWritten(() => {
      backlogFull = false;
      updateOutputFlow();
    });
  }

  function updateOutputFlow() {
    const flowing = !backlogFull && !holdingSpawn;
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
      if (backlogFull) child[name]?.pause();
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

  // Handles the messages in order; a spawn waits until everything sent before it has been written.
  function handleWaiting() {
    while (waiting.length > 0 && !holdingSpawn) {
      if (waiting[0]?.type === "spawn" && !written()) {
        holdingSpawn = true;
        updateOutputFlow();
        whenWritten(() => {
          holdingSpawn = false;
          handleWaiting();
          updateOutputFlow();
        });
        return;
      }
      handle(waiting.shift());
    }
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

  return function receive(message) {
    waiting.push(message);
    handleWaiting();
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
