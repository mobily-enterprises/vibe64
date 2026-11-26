import assert from "node:assert/strict";
import { ChildProcess, spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runCaptureCommand, stopCaptureExecution } from "../../packages/vibe64-execution/src/server/engines/capture.js";
import {
  COMMAND_SPAWNER_FAILED,
  execFileCommand,
  spawnCommand,
  startCommandSpawner
} from "../../packages/vibe64-execution/src/server/engines/commandSpawner.js";
import { START_RECORD_CAP } from "../../packages/vibe64-execution/src/server/engines/commandExecutor.js";
import { processGroupHasLiveMember } from "../../packages/vibe64-execution/src/server/runtime/processStart.js";
import { gitIdentityEnv } from "../../packages/vibe64-execution/src/server/env/gitIdentityEnv.js";
import { endRunningCommands } from "../../server/lib/stopGate.js";
import { processRuns } from "../fixtures/processGroupMembers.js";

// The rules of the editor's command spawner (packages/vibe64-execution/src/server/engines/commandSpawner.js), one
// test each. This process sends its commands to a spawner, as the editor server does from its boot. The capture
// engine's own results and messages, which run on top of it, are pinned by vibe64CaptureCommand.unit.test.js, in a
// process that runs its commands itself and again through a spawner (vibe64CaptureThroughSpawner.unit.test.js). Its
// spawners count as stuck after STUCK_MS instead of the editor's 5 s, so the tests about a stuck spawner wait that long.
const STUCK_MS = 1_500;
startCommandSpawner({ stuckAfterMs: STUCK_MS });
const posix = { skip: process.platform === "win32" };
const linux = { skip: process.platform !== "linux" };
const env = { PATH: process.env.PATH };
const SPAWNER_PROCESS = fileURLToPath(new URL(
  "../../packages/vibe64-execution/src/server/engines/commandSpawnerProcess.js", import.meta.url
));
const CAPTURE_MODULE = new URL("../../packages/vibe64-execution/src/server/engines/capture.js", import.meta.url).href;
const SPAWNER_MODULE = new URL("../../packages/vibe64-execution/src/server/engines/commandSpawner.js", import.meta.url).href;
const EDITOR_PROBE = fileURLToPath(new URL("fixtures/commandSpawnerEditorProbe.mjs", import.meta.url));

/** Resolves with everything one spawnCommand child reports, in order. */
function events(child) {
  const seen = [];
  return new Promise((resolve) => {
    child.on("spawn", () => seen.push(["spawn", child.pid]));
    child.on("stdout", (chunk) => seen.push(["stdout", String(chunk), Date.now()]));
    child.on("stderr", (chunk) => seen.push(["stderr", String(chunk)]));
    child.on("error", (error) => seen.push(["error", error.code, error.message]));
    child.on("close", (code, signal) => {
      seen.push(["close", code, signal, Date.now()]);
      resolve(seen);
    });
  });
}

/** The spawner's pid: the parent of the commands it starts. */
async function spawnerPid() {
  const { stdout } = await execFileCommand("sh", ["-c", "echo $PPID"], { env });
  return Number(stdout.trim());
}

/**
 * This process's spawner, as a ChildProcess, while a command runs (which holds it). Tests reach it to see its exit
 * or to make it say something; the editor's code never hands it out.
 */
function runningSpawner() {
  return process._getActiveHandles().find((handle) => handle instanceof ChildProcess &&
    handle.spawnargs[1] === SPAWNER_PROCESS && handle.exitCode === null && handle.signalCode === null);
}

/** Holds this process's event loop, as a busy editor's is held: it reads nothing from its spawner meanwhile. */
function holdEventLoop(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

async function waitUntil(check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

/** What a promise settles with, or `late` if it has not settled after `milliseconds`. */
function within(promise, milliseconds, late = "nothing") {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(late), milliseconds))]);
}

function readPid(file) {
  return existsSync(file) && readFileSync(file, "utf8").endsWith("\n") ? Number(readFileSync(file, "utf8")) : undefined;
}

function killGroups(pids) {
  for (const pid of pids) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already ended.
    }
  }
}

test("a command's output reaches the editor as the command writes it, not when it ends", posix, async () => {
  const seen = await events(spawnCommand("sh", ["-c", "echo first; sleep 0.3; echo second >&2; echo third"], { env }));
  const first = seen.find(([type, text]) => type === "stdout" && text === "first\n");
  const close = seen.at(-1);
  assert.ok(first, JSON.stringify(seen));
  assert.ok(close[3] - first[2] >= 250, "the first line arrived while the command still ran");
  assert.deepEqual(seen.filter(([type]) => type === "stderr"), [["stderr", "second\n"]]);
  assert.equal(seen.filter(([type]) => type === "stdout").map(([, text]) => text).join(""), "first\nthird\n");
  assert.deepEqual(close.slice(0, 3), ["close", 0, null]);
});

test("a command's input reaches its stdin, and the command's exit code reaches the editor", posix, async () => {
  const seen = await events(spawnCommand("sh", ["-c", "cat; exit 3"], { env, input: "typed\n", stdio: ["pipe", "pipe", "pipe"] }));
  assert.equal(seen.find(([type]) => type === "stdout")?.[1], "typed\n");
  assert.deepEqual(seen.at(-1).slice(0, 3), ["close", 3, null]);
});

test("kill signals a running command, by name or number, its signal reaches the editor, and kill answers false once it has exited", posix, async () => {
  const child = spawnCommand("sleep", ["30"], { env });
  const seen = events(child);
  await child.spawned;
  assert.equal(child.kill(os.constants.signals.SIGTERM), true);
  assert.deepEqual((await seen).at(-1).slice(0, 3), ["close", null, "SIGTERM"]);
  assert.equal(child.kill("SIGKILL"), false);
  assert.throws(() => child.kill("SIGNOPE"), { code: "ERR_UNKNOWN_SIGNAL" });
});

/** What a call throws or rejects with: Node's code when it has one, else its error's name and message. */
async function outcomeOf(call) {
  try {
    await call();
    return "nothing thrown";
  } catch (error) {
    return typeof error.code === "string" ? error.code : `${error.name}: ${error.message}`;
  }
}

test("a call that cannot be carried out throws to its caller alone, and the spawner and every other command carry on", posix, async () => {
  const spawner = await spawnerPid();
  const other = runCaptureCommand("sh", ["-c", "sleep 0.5; echo carried on"], { env, timeout: 30_000 });
  const running = spawnCommand("sleep", ["30"], { env });
  running.on("error", () => {});
  const runningClosed = new Promise((resolve) => running.once("close", (code, signal) => resolve(signal)));
  await running.spawned;
  const calls = {
    "no command": () => spawnCommand(null, [], { env }),
    "an argument that is not a string": () => spawnCommand("echo", [1], { env }),
    "input that is neither text nor bytes": () => spawnCommand("cat", [], { env, input: 5, stdio: ["pipe", "pipe", "pipe"] }),
    "a relative working directory": () => spawnCommand("pwd", [], { cwd: "relative", env }),
    "an option it does not know": () => spawnCommand("true", [], { env, shell: true }),
    "a stdio it does not carry": () => spawnCommand("true", [], { env, stdio: ["inherit", "pipe", "pipe"] }),
    "an execFileCommand option it does not know": () => execFileCommand("true", [], { env, killSignal: "SIGKILL" }),
    "a signal number that is not one": () => running.kill(99),
    "signal 0": () => running.kill(0)
  };
  const outcomes = {};
  for (const [name, call] of Object.entries(calls)) outcomes[name] = await outcomeOf(call);
  running.kill("SIGTERM");
  const result = await other;
  assert.deepEqual({
    outcomes,
    running: await runningClosed,
    other: result.ok ? result.stdout.trim() : result.error,
    sameSpawner: (await spawnerPid()) === spawner
  }, {
    outcomes: {
      "no command": "ERR_INVALID_ARG_TYPE",
      "an argument that is not a string": "ERR_INVALID_ARG_TYPE",
      "input that is neither text nor bytes": "ERR_INVALID_ARG_TYPE",
      "a relative working directory": "ERR_INVALID_ARG_VALUE",
      "an option it does not know": "ERR_INVALID_ARG_VALUE",
      "a stdio it does not carry": "ERR_INVALID_ARG_VALUE",
      "an execFileCommand option it does not know": "ERR_INVALID_ARG_VALUE",
      "a signal number that is not one": "ERR_UNKNOWN_SIGNAL",
      "signal 0": "ERR_UNKNOWN_SIGNAL"
    },
    running: "SIGTERM",
    other: "carried on",
    sameSpawner: true
  });
});

test("an environment the channel cannot carry throws to its caller and leaves no request waiting, so the spawner is not stopped as stuck", { ...posix, timeout: 30_000 }, async () => {
  const spawner = await spawnerPid();
  // It runs past the watchdog's limit, so a request left counted as unanswered would stop the spawner under it.
  const other = runCaptureCommand("sh", ["-c", `sleep ${(STUCK_MS + 1_000) / 1_000}; echo carried on`], {
    env,
    timeout: 30_000
  });
  // Node's spawn makes each environment value text; a Symbol cannot be.
  const outcome = await outcomeOf(() => spawnCommand("true", [], { env: { ...env, BAD: Symbol("bad") } }));
  const result = await other;
  assert.deepEqual({
    outcome,
    other: result.ok ? result.stdout.trim() : result.error,
    sameSpawner: (await spawnerPid()) === spawner
  }, { outcome: "TypeError: Cannot convert a Symbol value to a string", other: "carried on", sameSpawner: true });
});

test("a command that cannot start fails with Node's own spawn error and then closes, as a ChildProcess does, also when spawn refuses it", posix, async () => {
  const everything = async (child) => {
    const seen = [];
    for (const name of ["spawn", "error", "exit", "close", "stdout", "stderr", "input-error"]) {
      child.on(name, (value, signal) => seen.push(name === "close" ? [name, value, signal] : [name, value?.code]));
    }
    const pid = await child.spawned;
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { pid, seen };
  };
  // A missing command, then two spawn() refuses: an environment value over Linux's 128 KiB, and one with a NUL byte.
  assert.deepEqual(await everything(spawnCommand("vibe64-missing-command", [], { env })), {
    pid: undefined,
    seen: [["error", "ENOENT"], ["close", -2, null]]
  });
  assert.deepEqual(await everything(spawnCommand("true", [], { env: { ...env, BIG: "x".repeat(200_000) } })), {
    pid: undefined,
    seen: [["error", "E2BIG"], ["close", null, null]]
  });
  assert.deepEqual(await everything(spawnCommand("true", [], { env: { BAD: "a\u0000b" } })), {
    pid: undefined,
    seen: [["error", "ERR_INVALID_ARG_VALUE"], ["close", null, null]]
  });
  const error = await new Promise((resolve) => spawnCommand("vibe64-missing-command", [], { env }).once("error", resolve));
  assert.equal(error.message, "spawn vibe64-missing-command ENOENT");
});

test("the Git identity read settles when spawn refuses git's environment, so no caller waits on it for ever", posix, async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "v64-spawner-identity-"));
  try {
    const read = gitIdentityEnv({ env: {}, gitConfig: { cwd: home, env: { ...env, HOME: home, BIG: "x".repeat(200_000) } } });
    assert.notEqual(await within(read, 5_000, "never settled"), "never settled");
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("execFileCommand resolves with a command's output and rejects with its exit code, as execFile does", posix, async () => {
  assert.deepEqual(await execFileCommand("sh", ["-c", "printf out; printf err >&2"], { env }), {
    stderr: "err",
    stdout: "out"
  });
  await assert.rejects(execFileCommand("sh", ["-c", "printf partial; exit 2"], { env }), {
    code: 2,
    signal: null,
    stdout: "partial"
  });
  await assert.rejects(execFileCommand("sleep", ["30"], { env, timeout: 100 }), { signal: "SIGTERM" });
  await assert.rejects(execFileCommand("vibe64-missing-command", [], { env }), { code: "ENOENT" });
});

test("execFileCommand caps each output at maxBuffer and says it killed a command only when it did, as execFile does", posix, async () => {
  const failure = (running) => running.then(() => null, (error) => error);
  const capped = await failure(execFileCommand("sh", ["-c", "head -c 2000000 /dev/zero; exec sleep 5"], { env }));
  const small = await failure(execFileCommand("sh", ["-c", "printf 12345"], { env, maxBuffer: 3 }));
  const ownSignal = await failure(execFileCommand("sh", ["-c", "kill -TERM $$"], { env }));
  const timedOut = await failure(execFileCommand("sleep", ["30"], { env, timeout: 100 }));
  assert.deepEqual({
    capped: [capped?.name, capped?.code, capped?.message, capped?.stdout?.length],
    small: [small?.code, small?.stdout],
    ownSignal: [ownSignal?.signal, ownSignal?.killed],
    timedOut: [timedOut?.signal, timedOut?.killed]
  }, {
    capped: ["RangeError", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", "stdout maxBuffer length exceeded", 1024 * 1024],
    small: ["ERR_CHILD_PROCESS_STDIO_MAXBUFFER", "123"],
    ownSignal: ["SIGTERM", false],
    timedOut: ["SIGTERM", true]
  });
});

test("a capture's timeout ends its command through the spawner", posix, async () => {
  const result = await runCaptureCommand("sleep", ["30"], { env, timeout: 200 });
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, "SIGTERM");
  assert.equal(result.error, "Command timed out after 200 milliseconds: sleep 30");
});

test("the editor's stop ends the whole process group of a command the spawner started", posix, async () => {
  let groupId = 0;
  const running = runCaptureCommand("sh", ["-c", "sleep 30 & echo $$; wait"], {
    env,
    onOutput: (text) => {
      groupId ||= Number(text.trim());
    },
    timeout: 30_000
  });
  assert.ok(await waitUntil(() => groupId > 0));
  const { ended, scopeEmpty } = await endRunningCommands();
  assert.equal(ended, 1);
  assert.equal(scopeEmpty, true);
  assert.equal(await processGroupHasLiveMember(groupId), false);
  assert.equal((await running).signal, "SIGTERM");
});

test("the editor's stop ends every command it started, a plain spawnCommand and execFileCommand as well as a capture", posix, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-spawner-stop-all-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const pidFile = (name) => path.join(root, `${name}.pid`);
  const run = (name) => ["sh", ["-c", `echo $$ > ${pidFile(name)}; exec sleep 30`]];
  const plain = spawnCommand(...run("plain"), { env });
  const plainClosed = new Promise((resolve) => plain.once("close", (code, signal) => resolve(signal)));
  const execFile = execFileCommand(...run("execFile"), { env }).catch((error) => error.signal);
  const capture = runCaptureCommand(...run("capture"), { env, timeout: 30_000 });
  const names = ["plain", "execFile", "capture"];
  assert.ok(await waitUntil(() => names.every((name) => readPid(pidFile(name)))));
  const pids = names.map((name) => readPid(pidFile(name)));
  t.after(() => killGroups(pids));
  const { ended, scopeEmpty } = await endRunningCommands();
  assert.deepEqual({
    ended,
    scopeEmpty,
    endedBy: [await within(plainClosed, 5_000), await within(execFile, 5_000), (await capture).signal],
    running: pids.filter((pid) => processRuns(pid)).length
  }, { ended: 3, scopeEmpty: true, endedBy: ["SIGTERM", "SIGTERM", "SIGTERM"], running: 0 });
});

test("when the editor ends in any way, the commands it started end with it: Ctrl-C on its process group, or kill -9", { ...linux, timeout: 30_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-spawner-editor-ends-"));
  const started = [];
  t.after(async () => {
    killGroups(started);
    await rm(root, { force: true, recursive: true });
  });
  // An editor that has started its spawner, then one command each through execFileCommand, runCaptureCommand and
  // spawnCommand, ends.
  const endEditor = async (how) => {
    const dir = path.join(root, how.replace(/\W/gu, ""));
    const editor = spawn(process.execPath, [EDITOR_PROBE, dir], { detached: true, env: process.env, stdio: "ignore" });
    started.push(editor.pid);
    const exited = new Promise((resolve) => editor.once("exit", resolve));
    const files = ["execFile", "capture", "spawn"].map((name) => path.join(dir, `${name}.pid`));
    assert.ok(await waitUntil(() => files.every(readPid), 10_000), `${how}: the editor started its commands`);
    const pids = files.map(readPid);
    started.push(...pids);
    if (how === "Ctrl-C") process.kill(-editor.pid, "SIGINT");
    else process.kill(editor.pid, "SIGKILL");
    await exited;
    await waitUntil(() => pids.every((pid) => !processRuns(pid)), 5_000);
    return pids.filter((pid) => processRuns(pid)).length;
  };
  assert.deepEqual({
    "Ctrl-C": await endEditor("Ctrl-C"),
    "kill -9": await endEditor("kill -9")
  }, { "Ctrl-C": 0, "kill -9": 0 });
});

test("a stuck verdict counts the answers already waiting: an editor whose event loop was held past the limit keeps a spawner that answered", posix, async () => {
  const spawner = await spawnerPid();
  // From a known point of the loop (its check phase), so the watchdog's timer comes due before the answer is read.
  await new Promise((resolve) => setImmediate(resolve));
  const asked = runCaptureCommand("sh", ["-c", "echo $PPID"], { env, timeout: 30_000 });
  // The spawner answers at once; the answer waits, unread, while this process's loop is held past the stuck limit.
  holdEventLoop(STUCK_MS + 500);
  const result = await asked;
  // The command may have finished during the hold either way: what a wrong verdict leaves is a killed spawner.
  const next = await runCaptureCommand("sh", ["-c", "echo $PPID"], { env, timeout: 30_000 });
  assert.deepEqual({
    ok: result.ok,
    error: result.error,
    spawnerRuns: processRuns(spawner),
    nextOnSameSpawner: Number(next.stdout.trim()) === spawner
  }, { ok: true, error: "", spawnerRuns: true, nextOnSameSpawner: true });
});

test("a capture can be stopped, by its execution or by the server's stop, the moment it is asked for, before the spawner has answered", posix, async () => {
  const execution = { id: "v64-spawner-stop-at-once" };
  const stoppedRun = runCaptureCommand("sleep", ["30"], { env, execution, timeout: 3_000 });
  const stopped = await stopCaptureExecution(execution.id);
  const endedRun = runCaptureCommand("sleep", ["30"], { env, timeout: 3_000 });
  const { ended } = await endRunningCommands(Date.now() + 1);
  const endedBy = (result) => result.timedOut ? "its own timeout" : result.signal;
  assert.deepEqual({
    stopped: stopped.ok ? "stopped" : stopped.code,
    stoppedBy: endedBy(await stoppedRun),
    ended,
    endedBy: endedBy(await endedRun)
  }, { stopped: "stopped", stoppedBy: "SIGTERM", ended: 1, endedBy: "SIGTERM" });
});

test("a capture whose start is refused settles at once and leaves no timer running", posix, async () => {
  // A process that runs its commands itself, timed until it exits: a capture left unsettled would hold it until its
  // timeout.
  const source = `
    import { runCaptureCommand } from ${JSON.stringify(CAPTURE_MODULE)};
    const result = await runCaptureCommand("sh", ["-c", "true"], { env: { BAD: "a\\u0000b" }, timeout: 4000 });
    process.stdout.write(result.code);
  `;
  const begun = performance.now();
  const child = spawn(process.execPath, ["--input-type=module", "-e", source], { env, stdio: ["ignore", "pipe", "inherit"] });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  await new Promise((resolve) => child.once("exit", resolve));
  const exitedAfter = performance.now() - begun;
  assert.equal(output, "vibe64_command_capture_failed");
  assert.ok(exitedAfter < 2_000, `the process exited ${Math.round(exitedAfter)} ms after it started`);
});

test("a spawner that dies mid-command fails each of its commands naming it and ends each one's process group, for a capture, a plain command and execFileCommand alike, and the next command starts a new spawner", posix, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-spawner-death-"));
  const marker = (name) => path.join(root, `${name}.pid`);
  t.after(async () => {
    killGroups(["plain", "execfile"].map((name) => readPid(marker(name))).filter(Boolean));
    await rm(root, { force: true, recursive: true });
  });
  let lines = "";
  const capture = runCaptureCommand("sh", ["-c", "echo $PPID $$; sleep 30 & wait"], {
    env,
    onOutput: (text) => {
      lines += text;
    },
    timeout: 30_000
  });
  const plain = spawnCommand("sh", ["-c", `echo $$ > ${marker("plain")}; exec sleep 30`], { env });
  const plainFailure = new Promise((resolve) => plain.once("error", resolve));
  const execFiled = execFileCommand("sh", ["-c", `echo $$ > ${marker("execfile")}; exec sleep 30`], {
    env,
    timeout: 20_000
  }).then(() => null, (error) => error);
  assert.ok(await waitUntil(() => lines.includes("\n") && readPid(marker("plain")) && readPid(marker("execfile"))));
  const [deadSpawner, captureGroup] = lines.trim().split(" ").map(Number);
  process.kill(deadSpawner, "SIGKILL");
  const result = await capture;
  assert.equal(result.ok, false);
  assert.equal(result.code, COMMAND_SPAWNER_FAILED);
  assert.match(result.error, /^Command failed with vibe64_command_spawner_failed: sh -c /u);
  assert.match(result.error, /Vibe64's command spawner stopped \(signal SIGKILL\) while this command ran\./u);
  assert.equal((await plainFailure).code, COMMAND_SPAWNER_FAILED);
  assert.equal((await execFiled)?.code, COMMAND_SPAWNER_FAILED);
  assert.deepEqual({
    capture: await processGroupHasLiveMember(captureGroup),
    plain: await waitUntil(() => !processRuns(readPid(marker("plain"))), 5_000),
    execFile: await waitUntil(() => !processRuns(readPid(marker("execfile"))), 5_000)
  }, { capture: false, plain: true, execFile: true }, "every command the dead spawner started has ended");
  // The next command goes to a new spawner: once a process uses a spawner, it never runs a command itself.
  const next = await runCaptureCommand("sh", ["-c", "echo $PPID"], { env });
  assert.equal(next.ok, true);
  assert.notEqual(Number(next.stdout.trim()), deadSpawner);
  assert.notEqual(Number(next.stdout.trim()), process.pid);
  assert.match(readFileSync(`/proc/${Number(next.stdout.trim())}/cmdline`, "utf8"), /commandSpawnerProcess\.js/u);
});

test("whatever output waits unread, a spawner that dies leaves no command the editor cannot end: each started command's pid reaches it through a pipe of its own", { ...linux, timeout: 90_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-spawner-backlog-"));
  const started = [];
  t.after(async () => {
    killGroups(started);
    await rm(root, { force: true, recursive: true });
  });
  // Unread output fills the channel, then the spawner's own queue: none; just past about 128 KB, where a pid answer
  // starts to wait in the spawner's memory behind it; and far past it.
  const sizes = [0, 131 * 1024, 8_000_000];
  const outcomes = {};
  for (const bytes of sizes) {
    const reported = path.join(root, `reported-${bytes}.pid`);
    const unreported = path.join(root, `unreported-${bytes}.pid`);
    const spawner = await spawnerPid();
    // While the editor reads nothing, a command writes `bytes` of output and goes quiet.
    const flooding = runCaptureCommand("sh", ["-c", `echo $$ > ${reported}; head -c ${bytes} /dev/zero; exec sleep 30`], {
      env,
      timeout: 30_000
    });
    holdEventLoop(500);
    const late = spawnCommand("sh", ["-c", `echo $$ > ${unreported}; exec sleep 30`], { env });
    const lateFailure = new Promise((resolve) => late.once("error", resolve));
    holdEventLoop(500);
    process.kill(spawner, "SIGKILL");
    holdEventLoop(200);

    const failure = await within(lateFailure, 10_000);
    const latePid = readPid(unreported);
    if (latePid) started.push(latePid);
    if (readPid(reported)) started.push(readPid(reported));
    const flooded = await within(flooding, 10_000);
    outcomes[bytes] = {
      failed: failure?.code,
      started: latePid !== undefined,
      pidKnown: late.pid === latePid,
      ended: latePid !== undefined && await waitUntil(() => !processRuns(latePid), 5_000),
      flooded: flooded?.code,
      floodEnded: !(await processGroupHasLiveMember(readPid(reported)))
    };
  }
  const expected = {
    failed: COMMAND_SPAWNER_FAILED,
    started: true,
    pidKnown: true,
    ended: true,
    flooded: COMMAND_SPAWNER_FAILED,
    floodEnded: true
  };
  assert.deepEqual(outcomes, Object.fromEntries(sizes.map((bytes) => [bytes, expected])));
});

test(`at most ${START_RECORD_CAP} commands start while the editor reads none of their pids, and the rest start once it reads`, { ...linux, timeout: 30_000 }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-spawner-cap-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const startedFile = path.join(root, "started");
  const asked = START_RECORD_CAP + 10;
  await spawnerPid();
  const started = () => (existsSync(startedFile) ? readFileSync(startedFile, "utf8").trim().split("\n").length : 0);
  // Requests the channel's socket cannot take wait in this process until its loop runs, so the spawner never sees them
  // while the loop is held: each request is kept small (no environment), and the test checks that none waits here.
  const children = Array.from({ length: asked }, () => spawnCommand("/bin/sh", ["-c", `echo $$ >> ${startedFile}`], { env: {} }));
  const waitingHere = process._getActiveHandles().filter((handle) => handle?.constructor?.name === "Pipe")
    .reduce((bytes, pipe) => bytes + pipe.writeQueueSize, 0);
  assert.equal(waitingHere, 0, "every spawn request reached the spawner's channel");
  // While this process's loop is held, it reads no pid. A command shows it started by its own write, which can lag its
  // spawn on a loaded host: the hold lasts until the cap's commands have all written (5 s at most), then 500 ms more,
  // in which no command past the cap may start.
  const deadline = Date.now() + 5_000;
  while (started() < START_RECORD_CAP && Date.now() < deadline) holdEventLoop(25);
  holdEventLoop(500);
  const startedUnread = started();
  const codes = await Promise.all(children.map((child) => new Promise((resolve) => child.once("close", resolve))));
  assert.deepEqual({
    startedUnread,
    codes: [...new Set(codes)],
    startedInAll: started()
  }, { startedUnread: START_RECORD_CAP, codes: [0], startedInAll: asked });
});

test("a command asked for once the spawner has exited goes to a new spawner, even before the dead one's channel has closed", { ...linux, timeout: 30_000 }, async () => {
  // Output the editor has not read keeps the dead spawner's channel open after its exit, until that output is read.
  const flooding = runCaptureCommand("sh", ["-c", "head -c 8000000 /dev/zero; exec sleep 30"], { env, timeout: 30_000 });
  const spawner = runningSpawner();
  const asked = new Promise((resolve) => spawner.once("exit", () => {
    resolve(spawnCommand("sh", ["-c", "echo $PPID"], { env }));
  }));
  holdEventLoop(500);
  process.kill(spawner.pid, "SIGKILL");
  holdEventLoop(200);
  const next = await asked;
  let parent = "";
  next.on("stdout", (chunk) => {
    parent += chunk;
  });
  const outcome = await within(new Promise((resolve) => {
    next.once("error", (error) => resolve(error.code));
    next.once("close", (code) => resolve(code));
  }), 10_000);
  await flooding;
  assert.deepEqual({ outcome, newSpawner: Number(parent.trim()) !== spawner.pid && Number(parent.trim()) > 0 }, {
    outcome: 0,
    newSpawner: true
  });
});

test("a message from the spawner that the editor does not know means a broken spawner: its commands fail naming it, and end", posix, async () => {
  const outcomes = [];
  for (const message of [{ type: "unknown", id: 1 }, { type: "stdout", chunk: Buffer.from("no id") }]) {
    const running = spawnCommand("sleep", ["30"], { env });
    const failure = new Promise((resolve) => running.once("error", resolve));
    const closed = new Promise((resolve) => running.once("close", resolve));
    const pid = await running.spawned;
    const spawner = runningSpawner();
    spawner.emit("message", message);
    const error = await within(failure, 2_000);
    await within(closed, 5_000);
    outcomes.push({
      code: error?.code,
      message: error?.message,
      commandEnded: await waitUntil(() => !processRuns(pid), 5_000),
      spawnerEnded: await waitUntil(() => !processRuns(spawner.pid), 5_000)
    });
    killGroups([pid]);
  }
  const expected = {
    code: COMMAND_SPAWNER_FAILED,
    message: "Vibe64's command spawner sent a message the editor does not know and was stopped.",
    commandEnded: true,
    spawnerEnded: true
  };
  assert.deepEqual(outcomes, [expected, expected]);
});

test("a spawner that stops answering is stopped, and the command waiting on it fails naming it", { ...posix, timeout: 30_000 }, async () => {
  const stuck = await spawnerPid();
  process.kill(stuck, "SIGSTOP");
  const started = Date.now();
  const result = await runCaptureCommand("sh", ["-c", "true"], { env, timeout: 60_000 });
  assert.ok(Date.now() - started >= STUCK_MS - 100);
  assert.equal(result.code, COMMAND_SPAWNER_FAILED);
  assert.match(result.error, new RegExp(`command spawner did not answer for ${STUCK_MS} ms and was stopped`, "u"));
  assert.ok(await waitUntil(() => !processRuns(stuck)), "the stuck spawner was killed");
  assert.equal((await runCaptureCommand("sh", ["-c", "true"], { env })).ok, true);
});

test("a request made long after the spawner's last answer gets its full time to be answered", { ...posix, timeout: 30_000 }, async () => {
  // An answered request leaves nothing outstanding; a later one, made just before the first one's timer would have
  // struck, is not counted stuck for the time the spawner sat idle.
  const spawner = await spawnerPid();
  await new Promise((resolve) => setTimeout(resolve, STUCK_MS - 300));
  process.kill(spawner, "SIGSTOP");
  const next = runCaptureCommand("sh", ["-c", "echo $PPID"], { env, timeout: 30_000 });
  await new Promise((resolve) => setTimeout(resolve, 900));
  process.kill(spawner, "SIGCONT");
  const result = await next;
  assert.deepEqual({ ok: result.ok, error: result.error, sameSpawner: Number(result.stdout.trim()) === spawner }, {
    ok: true,
    error: "",
    sameSpawner: true
  });
});

test("a started command holds no channel to the spawner: its only open files are its stdin, stdout and stderr", linux, async () => {
  const { stdout } = await execFileCommand("sh", ["-c", "ls /proc/$$/fd"], { env });
  assert.deepEqual(stdout.split(/\s+/u).filter(Boolean).sort(), ["0", "1", "2"]);
});

test("no other process can open the spawner's channel through /proc, and the spawner's environment holds only its channel's names and the editor's NODE_OPTIONS", linux, async () => {
  const pid = await spawnerPid();
  const channel = readdirSync(`/proc/${pid}/fd`).find((fd) => fd === "3");
  assert.equal(channel, "3");
  assert.throws(() => openSync(`/proc/${pid}/fd/3`, "w"), { code: "ENXIO" });
  // Node names the channel to the child in these two, and removes them from its process.env as it starts.
  const entries = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").filter(Boolean);
  const names = entries.map((entry) => entry.split("=")[0]);
  const nodeOptions = process.env.NODE_OPTIONS ? ["NODE_OPTIONS"] : [];
  assert.deepEqual(names.sort(), ["NODE_CHANNEL_FD", "NODE_CHANNEL_SERIALIZATION_MODE", ...nodeOptions].sort());
  if (process.env.NODE_OPTIONS) assert.ok(entries.includes(`NODE_OPTIONS=${process.env.NODE_OPTIONS}`));
});

test("the test host's path guard reaches the spawner: no command runs in a system location through it either", {
  skip: !String(process.env.NODE_OPTIONS || "").includes("test-host-path-guard") &&
    "runs where the tests load the host path guard (tooling/run-targeted-tests.mjs)"
}, async () => {
  const refused = spawnCommand("pwd", [], { cwd: "/etc", env });
  const error = await within(new Promise((resolve) => refused.once("error", resolve)), 5_000);
  assert.deepEqual({ message: error?.message, pid: await within(refused.spawned, 1_000, "rejected or pending") }, {
    message: "test changed a system location: /etc (spawn cwd)",
    pid: undefined
  });
});

test("the spawner refuses a message it does not know: it runs nothing and stops", posix, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-spawner-refuse-"));
  try {
    const marker = path.join(root, "ran");
    const spawner = spawn(process.execPath, [SPAWNER_PROCESS], {
      env: {},
      serialization: "advanced",
      stdio: ["ignore", "ignore", "pipe", "ipc", "pipe"]
    });
    let stderr = "";
    spawner.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const exited = new Promise((resolve) => spawner.once("exit", (code) => resolve(code)));
    // A spawn without its options is not a message the editor sends.
    spawner.send({ type: "spawn", id: 1, command: "touch", args: [marker] });
    assert.equal(await exited, 70);
    assert.match(stderr, /refused a message it does not know \(type "spawn"\) and stops/u);
    assert.equal(existsSync(marker), false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("the spawner never keeps the editor's process alive, ignores SIGHUP, SIGINT and SIGTERM, and ends when the editor ends", posix, async () => {
  const editorSource = `
    import { execFileCommand, startCommandSpawner } from ${JSON.stringify(SPAWNER_MODULE)};
    startCommandSpawner();
    const { stdout } = await execFileCommand("sh", ["-c", "echo $PPID"], { env: { PATH: process.env.PATH } });
    process.stdout.write(stdout);
  `;
  // An editor whose last command finished exits by itself.
  const quiet = spawn(process.execPath, ["--input-type=module", "-e", editorSource], { env, stdio: ["ignore", "pipe", "inherit"] });
  let output = "";
  quiet.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const quietExit = await Promise.race([
    new Promise((resolve) => quiet.once("exit", (code) => resolve(code))),
    new Promise((resolve) => setTimeout(() => resolve("still running"), 10_000))
  ]);
  quiet.kill("SIGKILL");
  assert.equal(quietExit, 0);
  const finishedSpawner = Number(output.trim());
  assert.ok(await waitUntil(() => !processRuns(finishedSpawner)), "its spawner ended with it");

  // A running editor's spawner survives SIGHUP, SIGTERM and SIGINT, and ends when the editor is killed.
  const held = spawn(process.execPath, ["--input-type=module", "-e", `${editorSource}; setInterval(() => {}, 1000);`], {
    env,
    stdio: ["ignore", "pipe", "inherit"]
  });
  let heldOutput = "";
  held.stdout.on("data", (chunk) => {
    heldOutput += chunk;
  });
  try {
    assert.ok(await waitUntil(() => heldOutput.includes("\n"), 10_000));
    const heldSpawner = Number(heldOutput.trim());
    for (const signal of ["SIGHUP", "SIGTERM", "SIGINT"]) process.kill(heldSpawner, signal);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(processRuns(heldSpawner), true);
    held.kill("SIGKILL");
    assert.ok(await waitUntil(() => !processRuns(heldSpawner)), "the spawner ended with its editor");
  } finally {
    held.kill("SIGKILL");
  }
});
