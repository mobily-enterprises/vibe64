// commandSpawner starts every finite command: the commands Vibe64 waits for, such as Git, the execution helper through
// sudo, a tool's --version, an account lookup or a packaging tool. commandExecutor.js holds the one spawn() call that
// starts them; this module decides, once per process, where that executor runs, and gives callers Node's spawn() and
// execFile() for it: spawnCommand() and execFileCommand(), reached through @local/vibe64-execution/server/commandSpawner.
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
// Policy is not here. The gateway's commands (runVibe64Command) are approved by cwdPolicy, the permission policy, a
// host's managed execution and the server's stop gate before they reach spawnCommand; the few files that call these
// starters directly, for Vibe64's own fixed tools, skip those checks (tests/server/executionGatewayBypass.unit.test.js
// lists them). The executor starts exactly what it is given: the env its caller passes, always, as Node's spawn passes
// it (each value as text, an undefined one left out), in an absolute working directory, this process's own by default.
//
// Which files start processes themselves, and why, is listed once, with each file's count of uses, in
// tests/server/commandSpawnerOwnership.unit.test.js: this file, which starts the spawner, commandExecutor.js, the
// editor's long-lived processes (each once per owner, needing a terminal, a file descriptor or a channel of its own),
// the one finite exception (the synchronous Git identity read a terminal's environment needs), and the programs that
// are not the editor.
//
// What the spawner refuses. Its channel is the IPC socketpair Node creates when this module starts it: no path names
// it, Linux cannot reopen it through /proc/<pid>/fd, and no command inherits it or the spawner's pipe of start records
// (every command gets its own stdin, stdout and stderr, and Node opens both close-on-exec). It runs as the editor (the
// same user, groups, cgroup, umask and limits, nothing set or raised) with an environment holding only the editor's
// NODE_OPTIONS, so a command gets only the env sent with it. It refuses any message it does not know by exiting. The
// editor refuses a call it cannot carry out (a command or argument that is not a string, input that is neither text
// nor bytes, a relative working directory, an option or stdio it does not take, an unknown signal) by throwing to that
// caller, before anything is sent.
//
// The spawner's lifecycle. Started at boot, while the editor is small, and checked there: the editor runs one command
// through it (assertCommandSpawnerRuns) and refuses to start when it cannot, since an editor whose spawner runs nothing
// answers every request while every command fails (a release without commandSpawnerProcess.js did); held only while
// commands run, as a running command is held, so it never keeps a process alive by itself. Each command is a session
// leader (setsid, outside Windows), so it leads its own process group and has no controlling terminal: a terminal's
// Ctrl-C does not reach it, and it cannot prompt on /dev/tty. The editor's stop needs nothing from the spawner: the
// stop ends each command's process group itself (endCommands), with kill(2), and the spawner ignores SIGHUP, SIGINT and
// SIGTERM, so it reports the commands still running until the editor exits. However the editor ends (a stop, a crash,
// kill -9, Ctrl-C), its end closes the spawner's channel, and the spawner ends each command still running as the
// detached reaper does (SIGTERM to its process group, then SIGKILL to a group still there after 3 s) and exits: no
// command outlives the editor. When the spawner dies, sends a message the editor does not know, or leaves a spawn or
// kill unanswered for STUCK_AFTER_MS, the editor kills it and sends it nothing more: the next command starts a new
// spawner. Once its channel and its pipe of start records have both closed, each of its commands fails with
// vibe64_command_spawner_failed, naming it, and each one's process group is ended as a stop ends one (SIGTERM, then
// SIGKILL, each signalled only while the group has members) before the command closes.
//
// Why STUCK_AFTER_MS, 5 s. The spawner answers each spawn and kill as soon as it reads it, in well under a millisecond
// of its own time; what delays an answer is the machine (a starved CPU, swapping), never the command. 5 s is the grace
// a timed-out capture already gets between SIGTERM and SIGKILL: a spawner silent that long has stopped. The verdict
// waits for the editor's own next turn (checkStuck), so an editor that was busy itself does not count its spawner
// stuck. What a wrong verdict costs: the spawner is killed and every command it was running fails and is ended, which
// the next command recovers from with a new spawner; a right one stops a caller from waiting for ever.
//
// Every started command's pid is in a pipe the editor owns before the spawner does anything else, so a spawner's death
// never leaves a command the editor cannot end. The spawner writes each start's id and pid there in the same
// synchronous step as the spawn() that started it; the pipe keeps what was written after the spawner dies, and the
// editor reads it to its end, however much output was still waiting on the channel. At most START_RECORD_CAP
// (commandExecutor.js) records wait unread; at the cap the spawner starts nothing more until the editor has read them,
// so a record's write never waits. The one exception is an outside SIGKILL or OOM kill of the spawner between spawn()
// returning and that write, a few microseconds with nothing between them; a command started then runs unknown to the
// editor (on a managed host, the host's managed execution stops its unit by execution id when the command fails).

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SIGNALS, START_RECORD_BYTES, createCommandExecutor, describeMessage } from "./commandExecutor.js";
import { drainProcessGroup } from "./detached.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

const SPAWNER_PATH = fileURLToPath(new URL("./commandSpawnerProcess.js", import.meta.url));
const COMMAND_SPAWNER_FAILED = "vibe64_command_spawner_failed";
// The grace a command gets after SIGTERM before SIGKILL when a capture's timeout ends it (execa 9's), and so the time
// a spawner gets to answer before the editor counts it stuck.
const FORCE_KILL_DELAY_MS = 5_000;
const STUCK_AFTER_MS = FORCE_KILL_DELAY_MS;
// Node's execFile default.
const EXEC_FILE_MAX_BUFFER = 1024 * 1024;
// The boot check's command, a Node start, takes about 0.1 s through a new spawner; this only ends a hang.
const BOOT_CHECK_TIMEOUT_MS = 30_000;
const SPAWN_OPTIONS = new Set(["cwd", "env", "input", "stdio"]);
const EXEC_FILE_OPTIONS = new Set(["cwd", "env", "maxBuffer", "timeout"]);
const STDIO = new Set(["ignore", "pipe"]);
const ANSWERS = new Set(["spawn", "spawn-refused", "kill"]);
const REPORTS = new Set([...ANSWERS, "error", "stdout", "stderr", "input-error", "exit", "close"]);

// Where this process's commands start: its spawner once startCommandSpawner() has run, else the executor in itself.
let usesSpawner = false;
// When this process's spawners count as stuck; only tests set another.
let stuckAfterMs = STUCK_AFTER_MS;
/**
 * Every command still running outside Windows, with when it was asked for: the server's stop ends them (endCommands).
 * @type {Set<{ child: CommandChild, ending: boolean, startedAt: number }>}
 */
const liveCommands = new Set();
/** @type {ReturnType<typeof startSpawner> | ReturnType<typeof startInProcess> | null} */
let current = null;

/**
 * One finite command. Its events are a ChildProcess's: "spawn", "error" (only while one is listened to), "exit" and
 * "close" with (code, signal), and "stdout" and "stderr" with each chunk as a Buffer, plus "input-error" when writing
 * its input failed. A command that never started, spawn() refusing it included, has one "error" and then "close".
 */
class CommandChild extends EventEmitter {
  /** @type {number | undefined} */
  pid = undefined;
  /** @type {number | null} */
  exitCode = null;
  /** @type {string | null} */
  signalCode = null;
  /** Resolves with the pid once the command started, with undefined when it did not; it never rejects. */
  spawned;
  #table;
  #id;
  #ended = false;
  #failedToStart = false;
  #notReading = new Set();
  #spawnedResolvers = Promise.withResolvers();

  constructor(table, id) {
    super();
    this.#table = table;
    this.#id = id;
    this.spawned = this.#spawnedResolvers.promise;
  }

  /**
   * Sends the command a signal, as ChildProcess.kill does: false once it has exited, ended or never started.
   * @param {NodeJS.Signals | number} [signal]
   */
  kill(signal = "SIGTERM") {
    if (!SIGNALS.has(signal)) {
      throw Object.assign(new TypeError(`Unknown signal: ${String(signal)}`), { code: "ERR_UNKNOWN_SIGNAL" });
    }
    if (this.#ended || this.exitCode !== null || this.signalCode !== null) return false;
    this.#table.request({ type: "kill", id: this.#id, signal });
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
    this.#table.send({ type: "stop-reading", id: this.#id, stream });
  }

  /** The spawner's record of this command's start: its pid, which may come before the spawner's answer. */
  started(pid) {
    this.pid ??= pid;
    this.#spawnedResolvers.resolve(this.pid);
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
      // Node's spawn throws here, so no close comes from it: the command fails as one that never started.
      this.#end();
      this.#spawnedResolvers.resolve(undefined);
      this.#emitError(executorError(message.error));
      this.emit("close", null, null);
    } else if (message.type === "error") {
      if (message.final) {
        this.#failedToStart = true;
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

  /**
   * The spawner is gone: the command fails, naming it, unless it had already failed to start. One that started leads
   * its own process group, which outlives the spawner: the group is ended as a stop ends one, and then the command
   * closes.
   */
  fail(reason) {
    const { pid } = this;
    this.#end();
    this.#spawnedResolvers.resolve(pid);
    if (!this.#failedToStart) {
      this.#emitError(Object.assign(new Error(`Vibe64's command spawner ${reason}.`), { code: COMMAND_SPAWNER_FAILED }));
    }
    if (pid === undefined) {
      this.emit("close", null, null);
      return;
    }
    const ended = process.platform === "win32" ? Promise.resolve() : drainProcessGroup(pid).catch(() => false);
    void ended.then(() => this.emit("close", null, null));
  }

  #emitError(error) {
    if (this.listenerCount("error") > 0) this.emit("error", error);
  }

  #end() {
    if (this.#ended) return;
    this.#ended = true;
    this.#table.forget(this.#id);
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

function invalidCall(code, message) {
  return Object.assign(new TypeError(message), { code });
}

function refuseUnknownOptions(options, known, starter) {
  const unknown = Object.keys(options).filter((name) => !known.has(name));
  if (unknown.length > 0) throw invalidCall("ERR_INVALID_ARG_VALUE", `${starter} does not take ${unknown.join(", ")}.`);
}

/**
 * The commands of one channel to an executor, by id. `send` delivers a message that needs no answer and `request` a
 * spawn or kill, which the executor answers; either throws, sending nothing, for a message the channel cannot carry.
 * `onBusy` and `onIdle` run when its first command starts and when its last one ends.
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
      try {
        table.request({ type: "spawn", id, command, args, input, options });
      } catch (error) {
        // Nothing was sent, so nothing about it will come.
        table.forget(id);
        throw error;
      }
      return child;
    },
    send,
    request,
    /** A command ended: nothing more about it is expected. */
    forget(id) {
      if (children.delete(id) && children.size === 0) onIdle();
    },
    /** The spawner recorded that it started a command; one that has already ended is no longer here. */
    started(id, pid) {
      children.get(id)?.started(pid);
    },
    /** Hands one message from the executor to its command; an answer about one that has ended is dropped. */
    receive(message) {
      children.get(message.id)?.receive(message);
    }
  };
  return table;
}

/** The executor in this process, for a process that never starts a spawner. */
function startInProcess() {
  const deliver = (message) => receive(message);
  const table = commandTable({ send: deliver, request: deliver, onBusy: () => {}, onIdle: () => {} });
  const { receive } = createCommandExecutor({
    // Like the spawner's answers, the executor's arrive after the caller has had its turn to listen.
    send: (message) => {
      queueMicrotask(() => table.receive(message));
      return true;
    },
    refuse: (message) => {
      throw new TypeError(`The command executor does not know this message (${describeMessage(message)}).`);
    },
    // The editor is this process, which knows each command as spawn() returns.
    recordStart: null
  });
  return table;
}

/** Starts a spawner and returns this process's side of it. */
function startSpawner() {
  const spawnerProcess = spawn(process.execPath, [SPAWNER_PATH], {
    cwd: "/",
    // Only what Node itself reads: the test host's path guard reaches the spawner this way, as it reaches every Node
    // process a test starts.
    env: process.env.NODE_OPTIONS ? { NODE_OPTIONS: process.env.NODE_OPTIONS } : {},
    serialization: "advanced",
    stdio: ["ignore", "ignore", "inherit", "ipc", "pipe"],
    windowsHide: true
  });
  const startRecords = spawnerProcess.stdio[4];
  let unanswered = 0;
  let progressAt = performance.now();
  let watchdog = null;
  let failed = false;
  let stopReason = "";
  let exitReason = "";
  let channelClosed = false;
  let recordsClosed = false;
  // It is held, as a running command is, only while commands run.
  const hold = (held) => {
    if (failed) return;
    for (const handle of [spawnerProcess, spawnerProcess.channel, startRecords]) {
      if (held) handle?.ref();
      else handle?.unref();
    }
  };
  const send = (message) => {
    if (!failed) spawnerProcess.send(message, () => {});
  };
  // Every spawn and kill is answered at once, so one left unanswered shows a stuck spawner. A request counts once it
  // has been sent, and the wait is measured from the request that found nothing outstanding, or the last answer.
  const request = (message) => {
    if (failed) return;
    send(message);
    if (unanswered === 0) progressAt = performance.now();
    unanswered += 1;
    watchdog ??= setTimeout(checkStuck, stuckAfterMs).unref();
  };
  const table = commandTable({ send, request, onBusy: () => hold(true), onIdle: () => hold(false) });

  // A late timer on a starved event loop is not a stuck spawner: the decision waits for the loop's next turn, after
  // the input already waiting has been read, so answers that arrived in time count.
  function checkStuck() {
    watchdog = null;
    setImmediate(() => {
      if (unanswered === 0 || failed || stopReason) return;
      const waited = performance.now() - progressAt;
      if (waited < stuckAfterMs) {
        watchdog = setTimeout(checkStuck, stuckAfterMs - waited).unref();
        return;
      }
      stop(`did not answer for ${stuckAfterMs} ms and was stopped`);
    });
  }

  // No command goes to it any more; the next one starts a new spawner.
  function retire() {
    if (current === table) current = null;
  }

  function stop(reason) {
    if (stopReason || failed) return;
    stopReason = reason;
    retire();
    spawnerProcess.kill("SIGKILL");
  }

  // Its commands fail once it has exited and both its channel and its start records have closed: what it wrote before
  // it died, the pids of the commands it started among them, has then all been read.
  function failWhenGone() {
    if (exitReason && channelClosed && recordsClosed) failAll(stopReason || exitReason);
  }

  function failAll(reason) {
    if (failed) return;
    hold(false);
    failed = true;
    clearTimeout(watchdog);
    retire();
    for (const child of [...table.children.values()]) child.fail(reason);
  }

  spawnerProcess.on("message", (message) => {
    if (!REPORTS.has(message?.type) || !Number.isSafeInteger(message.id)) {
      stop("sent a message the editor does not know and was stopped");
      return;
    }
    if (ANSWERS.has(message.type)) {
      unanswered = Math.max(0, unanswered - 1);
      progressAt = performance.now();
      if (unanswered === 0) {
        clearTimeout(watchdog);
        watchdog = null;
      }
    }
    table.receive(message);
  });
  let partial = Buffer.alloc(0);
  startRecords.on("data", (chunk) => {
    const bytes = partial.length > 0 ? Buffer.concat([partial, chunk]) : chunk;
    const count = Math.floor(bytes.length / START_RECORD_BYTES);
    for (let offset = 0; offset < count * START_RECORD_BYTES; offset += START_RECORD_BYTES) {
      table.started(Number(bytes.readBigUInt64LE(offset)), bytes.readUInt32LE(offset + 8));
    }
    partial = bytes.subarray(count * START_RECORD_BYTES);
    if (count > 0) send({ type: "starts-read", count });
  });
  // A read error ends the records as their end does: "close" follows it.
  startRecords.on("error", () => {});
  startRecords.once("close", () => {
    recordsClosed = true;
    failWhenGone();
  });
  spawnerProcess.once("error", (error) => failAll(`could not run (${error.message})`));
  spawnerProcess.once("exit", (code, signal) => {
    exitReason = `stopped (${signal ? `signal ${signal}` : `exit code ${code}`}) while this command ran`;
    retire();
    failWhenGone();
  });
  spawnerProcess.once("disconnect", () => {
    channelClosed = true;
    failWhenGone();
  });
  hold(false);
  return table;
}

/**
 * Sends every later command of this process to a spawner, started now, while the process is small. The editor server
 * calls it at boot. It cannot be undone.
 * @param {{ stuckAfterMs?: number }} [options] stuckAfterMs, for tests only: when a spawner counts as stuck, in ms
 */
function startCommandSpawner({ stuckAfterMs: stuckAfter } = {}) {
  if (stuckAfter !== undefined) {
    if (!Number.isSafeInteger(stuckAfter) || stuckAfter <= 0) {
      throw invalidCall("ERR_INVALID_ARG_VALUE", "A spawner's stuck delay is a positive whole number of ms.");
    }
    stuckAfterMs = stuckAfter;
  }
  if (usesSpawner && current) return;
  usesSpawner = true;
  current = startSpawner();
}

/**
 * The environment as Node's spawn passes it: each value as text, and a name whose value is undefined left out.
 * @param {RuntimeEnv} env
 */
function environmentText(env) {
  const text = {};
  for (const name of Object.keys(env)) {
    if (env[name] !== undefined) text[name] = `${env[name]}`;
  }
  return text;
}

/**
 * Starts a finite command, as Node's spawn would start it in this process, with exactly the environment given, as a
 * session leader (outside Windows). It throws, starting nothing, for a call it cannot carry out.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ cwd?: string, env: RuntimeEnv, input?: string | Uint8Array | null, stdio?: ("ignore" | "pipe")[] }} options
 *   cwd is absolute, this process's own by default; stdio is [stdin, stdout, stderr], ["ignore", "pipe", "pipe"] by
 *   default; a stdin of "pipe" receives `input` and then ends.
 * @returns {CommandChild}
 */
function spawnCommand(command, args, options) {
  refuseUnknownOptions(options, SPAWN_OPTIONS, "spawnCommand");
  const { cwd = process.cwd(), env, input = null, stdio = ["ignore", "pipe", "pipe"] } = options;
  if (typeof command !== "string" || command === "") throw invalidCall("ERR_INVALID_ARG_TYPE", "A command is a non-empty string.");
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
    throw invalidCall("ERR_INVALID_ARG_TYPE", "A command's arguments are strings.");
  }
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) {
    throw invalidCall("ERR_INVALID_ARG_VALUE", `A command's working directory is an absolute path, not ${JSON.stringify(cwd)}.`);
  }
  if (!env || typeof env !== "object") throw invalidCall("ERR_INVALID_ARG_TYPE", "A command needs the environment it runs with.");
  if (input !== null && typeof input !== "string" && !(input instanceof Uint8Array)) {
    throw invalidCall("ERR_INVALID_ARG_TYPE", "A command's input is a string or bytes.");
  }
  if (!Array.isArray(stdio) || stdio.length !== 3 || !stdio.every((entry) => STDIO.has(entry))) {
    throw invalidCall("ERR_INVALID_ARG_VALUE", "A command's stdio is three of \"ignore\" and \"pipe\".");
  }
  const commandOptions = { cwd, detached: process.platform !== "win32", env: environmentText(env), stdio: [...stdio] };
  if (usesSpawner) startCommandSpawner();
  else current ??= startInProcess();
  const startedAt = Date.now();
  const child = current.start(command, [...args], commandOptions, input);
  if (commandOptions.detached) {
    const live = { child, ending: false, startedAt };
    liveCommands.add(live);
    child.once("close", () => liveCommands.delete(live));
  }
  return child;
}

/**
 * Ends the commands still running that were asked for before `startedBefore` (epoch ms; all by default), one whose
 * spawner has not answered yet included: SIGTERM to each one's process group once its pid is known, then SIGKILL to a
 * group still there after `termTimeoutMs`. Each one's caller gets its command's end as usual, killed by that signal.
 * The server's stop calls it. Never throws.
 * @param {{ startedBefore?: number, termTimeoutMs?: number, killTimeoutMs?: number }} [options]
 * @returns {Promise<{ ended: number, scopeEmpty: boolean }>} `ended` counts the commands no earlier call was ending
 */
async function endCommands({ startedBefore = Infinity, termTimeoutMs = 100, killTimeoutMs = 100 } = {}) {
  const ending = [...liveCommands].filter((live) => live.startedAt < startedBefore);
  const ended = ending.filter((live) => !live.ending).length;
  const drained = await Promise.all(ending.map(async (live) => {
    live.ending = true;
    const pid = await live.child.spawned;
    return pid === undefined || drainProcessGroup(pid, { termTimeoutMs, killTimeoutMs }).catch(() => false);
  }));
  return { ended, scopeEmpty: drained.every(Boolean) };
}

/**
 * Runs a finite command and resolves with its output, as Node's promisified execFile does: an exit other than 0, a
 * signal or a failed start rejects with an error carrying code (the exit code, or the start's error code), signal,
 * killed (true when a timeout or maxBuffer here sent the signal), cmd, stdout and stderr. `timeout` sends SIGTERM once
 * it passes; past `maxBuffer` bytes on either output, reading stops, the command gets SIGTERM, and the call rejects
 * with ERR_CHILD_PROCESS_STDIO_MAXBUFFER.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ cwd?: string, env: RuntimeEnv, maxBuffer?: number, timeout?: number }} options
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function execFileCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    refuseUnknownOptions(options, EXEC_FILE_OPTIONS, "execFileCommand");
    const { cwd, env, maxBuffer = EXEC_FILE_MAX_BUFFER, timeout = 0 } = options;
    const child = spawnCommand(command, args, { cwd, env });
    const output = { stderr: [], stdout: [] };
    const length = { stderr: 0, stdout: 0 };
    let failure = null;
    let killed = false;
    let finished = false;
    const kill = () => {
      killed = true;
      child.kill("SIGTERM");
    };
    const timer = timeout > 0 ? setTimeout(kill, timeout) : null;
    const text = (name) => Buffer.concat(output[name]).toString("utf8");
    const collect = (name) => (chunk) => {
      if (failure) return;
      const room = maxBuffer - length[name];
      if (chunk.length <= room) {
        output[name].push(chunk);
        length[name] += chunk.length;
        return;
      }
      output[name].push(chunk.subarray(0, room));
      failure = Object.assign(new RangeError(`${name} maxBuffer length exceeded`), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
      child.stopReading("stdout");
      child.stopReading("stderr");
      kill();
    };
    const finish = (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const stdout = text("stdout");
      const stderr = text("stderr");
      if (!failure && code === 0 && signal === null) {
        resolve({ stderr, stdout });
        return;
      }
      const cmd = [command, ...args].join(" ");
      const error = failure || Object.assign(new Error(`Command failed: ${cmd}\n${stderr}`), { code, killed, signal });
      reject(Object.assign(error, { cmd, stderr, stdout }));
    };
    child.on("stdout", collect("stdout"));
    child.on("stderr", collect("stderr"));
    child.on("error", (error) => {
      failure ||= error;
    });
    child.once("close", finish);
  });
}

/**
 * Runs one command, `node --version`, as every command of this process runs (through its spawner once
 * startCommandSpawner() has run), and throws when it cannot, saying so. The editor server checks its new spawner this
 * way at boot.
 */
async function assertCommandSpawnerRuns() {
  try {
    await execFileCommand(process.execPath, ["--version"], { env: {}, timeout: BOOT_CHECK_TIMEOUT_MS });
  } catch (error) {
    throw Object.assign(
      new Error(`Vibe64's command spawner could not run a command, and every command goes through it: ${error.message}`),
      { code: COMMAND_SPAWNER_FAILED, cause: error }
    );
  }
}

export {
  COMMAND_SPAWNER_FAILED,
  FORCE_KILL_DELAY_MS,
  STUCK_AFTER_MS,
  assertCommandSpawnerRuns,
  endCommands,
  execFileCommand,
  spawnCommand,
  startCommandSpawner
};
