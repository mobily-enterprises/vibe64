// commandSpawner starts every finite command: the commands Vibe64 waits for, such as Git, the execution helper through
// sudo, a tool's --version, an account lookup or a packaging tool. commandExecutor.js holds the one spawn() call that
// starts them; this module decides, once per process, where that executor runs, and gives callers Node's spawn() and
// execFile() for it: spawnCommand() and execFileCommand().
//
// The rule: the editor server sends every finite command to its spawner, started at boot; small short-lived processes
// (the session work child, CLIs, tests) run the same executor in themselves, because a spawner there costs more than
// their own fork.
//
// Why the editor needs a spawner. On Linux, Node starts a command by forking the process that asks: libuv clones it,
// without CLONE_VM or CLONE_VFORK, and waits until the child has exec'd, so the asking process's main thread stops for
// a copy of the page tables of its whole heap. Measured on a test host (Node 26.5, libuv 1.52.1; `git --version`), a
// direct start held the main thread for 10.1 ms (median) at 158 MB of RSS and for 33.2 ms at 1.5 GB, and a burst of 12,
// as one page's route runs, for 97 and 422 ms. A large project's editor under normal page polling spent 9.8 s of 72 s of
// its main-thread time there. Through the spawner, a small process the editor starts while it is small, a start
// holds it for 0.14 to 0.17 ms at both sizes, and the command also finishes sooner: 13 ms instead of 17 and 37.5.
// Why a small process does not. Starting a spawner costs a Node startup, about 85 ms: in a fresh process, 13 Git
// commands took 72.5 ms with the executor in the process itself and 196 ms with a spawner of its own.
//
// The mode is set once. A process runs commands in itself until it calls startCommandSpawner(), as the editor server
// does at boot (server.js, before it accepts requests). From then on every command of that process goes to a spawner,
// and nothing ever runs a command in that process again: a spawner that dies is replaced by a new one for the next
// command, never by the executor in the editor.
//
// Policy is not here. runVibe64Command, cwdPolicy, the permission policy, a host's managed execution and the server's
// stop gate approve a command before it reaches spawnCommand, and the executor starts exactly what it is given: the
// env its caller passes, always, and a missing cwd is this process's own, as with Node's spawn.
//
// The only files that start processes directly start long-lived processes, once per owner, each needing a terminal, a
// file descriptor or a channel of its own (tests/server/commandSpawnerOwnership.unit.test.js keeps this list true):
//   - commandExecutor.js, where finite commands start, and this file, which starts the spawner;
//   - engines/terminalSessions.js: a runtime terminal needs a pseudo-terminal (node-pty), once per terminal;
//   - engines/detached.js: a detached service writes to its log file and outlives the request, once per service,
//     and starts the reaper that holds its process groups, once per editor;
//   - engines/stdioBridge.js: an AI engine's stdio bridge, once per engine;
//   - env/gitIdentityEnv.js: the synchronous Git identity read a terminal's environment needs (spawnSync), which
//     cannot wait for a reply;
//   - packages/vibe64-database-tools/src/server/sqliteClient.js: a SQLite worker with its own IPC channel, once per
//     connection.
//
// What the spawner refuses. Its channel is the IPC socketpair Node creates when this module starts it: no path names
// it, Linux cannot reopen it through /proc/<pid>/fd, and no command inherits it (every command gets its own stdin,
// stdout and stderr, and Node marks the channel close-on-exec). It runs as the editor (the same user, groups, cgroup,
// umask and limits, nothing set or raised) with an empty environment of its own, so a command gets only the env sent
// with it. It refuses any message it does not know by exiting.
//
// The spawner's lifecycle. Started at boot, while the editor is small; held only while commands run, as a running
// command is held, so it never keeps a process alive by itself. The editor's stop needs nothing from it: the stop ends
// each command's process group itself, with kill(2), and the spawner ignores the stop signals, so it reports the
// commands still running until the editor exits, which ends it. If it dies or stops answering, its commands fail with
// vibe64_command_spawner_failed, naming it (runCaptureCommand then ends each one's process group), and the next command
// starts a new spawner. It is stuck when a spawn or kill goes unanswered for STUCK_AFTER_MS, the grace a timed-out
// command gets before SIGKILL; the editor then kills it.

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { constants } from "node:os";
import { fileURLToPath } from "node:url";

import { createCommandExecutor, describeMessage } from "./commandExecutor.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

const SPAWNER_PATH = fileURLToPath(new URL("./commandSpawnerProcess.js", import.meta.url));
const COMMAND_SPAWNER_FAILED = "vibe64_command_spawner_failed";
const STUCK_AFTER_MS = 5_000;

// Where this process's commands start: its spawner once startCommandSpawner() has run, else the executor in itself.
let usesSpawner = false;
/** @type {ReturnType<typeof startSpawner> | ReturnType<typeof startInProcess> | null} */
let current = null;

/**
 * One finite command. Its events are a ChildProcess's: "spawn", "error" (only while one is listened to), "exit" and
 * "close" with (code, signal), and "stdout" and "stderr" with each chunk as a Buffer, plus "input-error" when writing
 * its input failed. After an "error" from a command that never started, nothing follows.
 */
class CommandChild extends EventEmitter {
  /** @type {number | undefined} */
  pid = undefined;
  /** @type {number | null} */
  exitCode = null;
  /** @type {string | null} */
  signalCode = null;
  /** Resolves with the pid once the command started, with undefined when it did not, and rejects when spawn refused. */
  spawned;
  #channel;
  #id;
  #ended = false;
  #notReading = new Set();
  #spawnedResolvers = Promise.withResolvers();

  constructor(channel, id) {
    super();
    this.#channel = channel;
    this.#id = id;
    this.spawned = this.#spawnedResolvers.promise;
    // A caller that never asks for the pid must not see an unhandled rejection.
    this.spawned.catch(() => {});
  }

  /**
   * Sends the command a signal, as ChildProcess.kill does: false once it has exited, ended or never started.
   * @param {NodeJS.Signals | number} [signal]
   */
  kill(signal = "SIGTERM") {
    if (typeof signal === "string" && !Object.hasOwn(constants.signals, signal)) {
      throw Object.assign(new TypeError(`Unknown signal: ${signal}`), { code: "ERR_UNKNOWN_SIGNAL" });
    }
    if (this.#ended || this.exitCode !== null || this.signalCode !== null) return false;
    this.#channel.request({ type: "kill", id: this.#id, signal });
    return true;
  }

  /**
   * Stops reading one of its outputs, as destroying a ChildProcess stream does: the command gets SIGPIPE when it
   * writes there again, and output already on its way is dropped.
   * @param {"stdout" | "stderr"} stream
   */
  stopReading(stream) {
    if (this.#ended || this.#notReading.has(stream)) return;
    this.#notReading.add(stream);
    this.#channel.send({ type: "stop-reading", id: this.#id, stream });
  }

  /** Handles one message from the executor about this command. */
  receive(message) {
    if (message.type === "spawn") {
      this.pid = message.pid;
      if (message.pid !== undefined) {
        this.#spawnedResolvers.resolve(message.pid);
        this.emit("spawn");
      }
    } else if (message.type === "spawn-refused") {
      this.#end();
      this.#spawnedResolvers.reject(executorError(message.error));
    } else if (message.type === "error") {
      if (message.final) {
        this.#end();
        this.#spawnedResolvers.resolve(undefined);
      }
      this.#emitError(executorError(message.error));
    } else if (message.type === "stdout" || message.type === "stderr") {
      if (!this.#notReading.has(message.type)) this.emit(message.type, asBuffer(message.chunk));
    } else if (message.type === "input-error") {
      this.emit("input-error", executorError(message.error));
    } else if (message.type === "exit") {
      this.exitCode = message.code;
      this.signalCode = message.signal;
      this.emit("exit", message.code, message.signal);
    } else if (message.type === "close") {
      this.#end();
      this.emit("close", message.code, message.signal);
    }
  }

  /** The spawner is gone: the command fails, naming it. Its process group is its runner's to end. */
  fail(reason) {
    const started = this.pid !== undefined;
    this.#end();
    this.#spawnedResolvers.resolve(this.pid);
    this.#emitError(Object.assign(new Error(`Vibe64's command spawner ${reason}.`), { code: COMMAND_SPAWNER_FAILED }));
    if (started) this.emit("close", null, null);
  }

  #emitError(error) {
    if (this.listenerCount("error") > 0) this.emit("error", error);
  }

  #end() {
    if (this.#ended) return;
    this.#ended = true;
    this.#channel.forget(this.#id);
  }
}

function asBuffer(chunk) {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

function executorError({ name, message, ...fields } = {}) {
  const ErrorType = { RangeError, TypeError }[name] || Error;
  const error = new ErrorType(message);
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) error[key] = value;
  }
  return error;
}

/**
 * The commands of one channel to an executor, by id. `send` delivers a message that needs no answer and `request` a
 * spawn or kill, which the executor answers; `onBusy` and `onIdle` run when its first command starts and when its last
 * one ends.
 */
function commandTable({ send, request, onBusy, onIdle }) {
  /** @type {Map<number, CommandChild>} */
  const children = new Map();
  let nextId = 1;
  const table = {
    children,
    /** Starts one command: its CommandChild hears everything the executor says about it. */
    start(command, args, options, input) {
      const id = nextId++;
      const child = new CommandChild(table, id);
      children.set(id, child);
      if (children.size === 1) onBusy();
      table.request({ type: "spawn", id, command, args, input, options });
      return child;
    },
    send,
    request,
    /** A command ended: nothing more about it is expected. */
    forget(id) {
      if (children.delete(id) && children.size === 0) onIdle();
    },
    /** Hands one message from the executor to its command. */
    receive(message) {
      children.get(message?.id)?.receive(message);
    }
  };
  return table;
}

/** The executor in this process, for a process that never starts a spawner. */
function startInProcess() {
  const deliver = (message) => receive(message);
  const table = commandTable({ send: deliver, request: deliver, onBusy: () => {}, onIdle: () => {} });
  const receive = createCommandExecutor({
    // Like the spawner's answers, the executor's arrive after the caller has had its turn to listen.
    send: (message) => {
      queueMicrotask(() => table.receive(message));
      return true;
    },
    // Its messages never wait in a backlog.
    whenDrained: () => {},
    refuse: (message) => {
      throw new TypeError(`The command executor does not know this message (${describeMessage(message)}).`);
    }
  });
  return table;
}

/** Starts a spawner and returns this process's side of it. */
function startSpawner() {
  const spawnerProcess = spawn(process.execPath, [SPAWNER_PATH], {
    cwd: "/",
    env: {},
    serialization: "advanced",
    stdio: ["ignore", "ignore", "inherit", "ipc"],
    windowsHide: true
  });
  let unanswered = 0;
  let lastAnswerAt = Date.now();
  let watchdog = null;
  let failed = false;
  // It is held, as a running command is, only while commands run.
  const hold = (held) => {
    if (failed) return;
    for (const handle of [spawnerProcess, spawnerProcess.channel]) {
      if (held) handle?.ref();
      else handle?.unref();
    }
  };
  const send = (message) => {
    if (!failed) spawnerProcess.send(message, () => {});
  };
  // Every spawn and kill is answered at once, so one left unanswered shows a stuck spawner.
  const request = (message) => {
    if (failed) return;
    unanswered += 1;
    watchdog ??= setTimeout(checkStuck, STUCK_AFTER_MS).unref();
    send(message);
  };
  const table = commandTable({ send, request, onBusy: () => hold(true), onIdle: () => hold(false) });

  // A late timer on a starved event loop is not a stuck spawner: the decision waits for the loop's next turn, after
  // the input already waiting has been read, so answers that arrived in time count.
  function checkStuck() {
    watchdog = null;
    setImmediate(() => {
      if (unanswered === 0 || failed) return;
      const waited = Date.now() - lastAnswerAt;
      if (waited < STUCK_AFTER_MS) {
        watchdog = setTimeout(checkStuck, STUCK_AFTER_MS - waited).unref();
        return;
      }
      failAll(`did not answer for ${STUCK_AFTER_MS} ms and was stopped`);
      spawnerProcess.kill("SIGKILL");
    });
  }

  function failAll(reason) {
    if (failed) return;
    hold(false);
    failed = true;
    clearTimeout(watchdog);
    if (current === table) current = null;
    for (const child of [...table.children.values()]) child.fail(reason);
  }

  spawnerProcess.on("message", (message) => {
    if (["spawn", "spawn-refused", "kill"].includes(message?.type)) {
      unanswered = Math.max(0, unanswered - 1);
      lastAnswerAt = Date.now();
    }
    table.receive(message);
  });
  spawnerProcess.once("error", (error) => failAll(`could not run (${error.message})`));
  spawnerProcess.once("exit", (code, signal) => {
    failAll(`stopped (${signal ? `signal ${signal}` : `exit code ${code}`}) while this command ran`);
  });
  hold(false);
  return table;
}

/**
 * Sends every later command of this process to a spawner, started now, while the process is small. The editor server
 * calls it at boot. It cannot be undone.
 */
function startCommandSpawner() {
  if (usesSpawner && current) return;
  usesSpawner = true;
  current = startSpawner();
}

/**
 * Starts a finite command, as Node's spawn would start it in this process, with exactly the environment given.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ cwd?: string, detached?: boolean, env: RuntimeEnv, input?: string | Uint8Array | null,
 *   stdio?: ("ignore" | "pipe")[] }} options stdio is [stdin, stdout, stderr], ["ignore", "pipe", "pipe"] by default;
 *   a stdin of "pipe" receives `input` and then ends.
 * @returns {CommandChild}
 */
function spawnCommand(command, args, {
  cwd = process.cwd(),
  detached = false,
  env,
  input = null,
  stdio = ["ignore", "pipe", "pipe"]
}) {
  if (!env || typeof env !== "object") throw new TypeError("A command needs the environment it runs with.");
  if (usesSpawner) startCommandSpawner();
  else current ??= startInProcess();
  return current.start(command, [...args], { cwd, detached, env: { ...env }, stdio: [...stdio] }, input);
}

/**
 * Runs a finite command and resolves with its output, as Node's promisified execFile does: an exit other than 0, a
 * signal or a failed start rejects with an error carrying code (the exit code, or the start's error code), signal,
 * stdout and stderr. `timeout` sends SIGTERM once it passes.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ cwd?: string, env: RuntimeEnv, timeout?: number }} options
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function execFileCommand(command, args, { cwd, env, timeout = 0 }) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, { cwd, env });
    const output = { stderr: [], stdout: [] };
    let startError = null;
    let finished = false;
    const timer = timeout > 0 ? setTimeout(() => child.kill("SIGTERM"), timeout) : null;
    const text = (name) => Buffer.concat(output[name]).toString("utf8");
    const finish = (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const stdout = text("stdout");
      const stderr = text("stderr");
      if (!startError && code === 0) {
        resolve({ stderr, stdout });
        return;
      }
      const error = startError || new Error(`Command failed: ${[command, ...args].join(" ")}\n${stderr}`);
      reject(Object.assign(error, {
        ...(startError ? {} : { code, killed: signal !== null, signal }),
        stderr,
        stdout
      }));
    };
    child.on("stdout", (chunk) => output.stdout.push(chunk));
    child.on("stderr", (chunk) => output.stderr.push(chunk));
    child.on("error", (error) => {
      startError ||= error;
      if (child.pid === undefined) finish(null, null);
    });
    child.spawned.catch((error) => {
      startError ||= error;
      finish(null, null);
    });
    child.once("close", finish);
  });
}

export {
  COMMAND_SPAWNER_FAILED,
  STUCK_AFTER_MS,
  execFileCommand,
  spawnCommand,
  startCommandSpawner
};
