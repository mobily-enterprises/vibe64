import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { endCaptures, runCaptureCommand } from "../../packages/vibe64-execution/src/server/engines/capture.js";
import {
  COMMAND_SPAWNER_FAILED,
  STUCK_AFTER_MS,
  execFileCommand,
  spawnCommand,
  startCommandSpawner
} from "../../packages/vibe64-execution/src/server/engines/commandSpawner.js";
import { processGroupHasLiveMember } from "../../packages/vibe64-execution/src/server/runtime/processStart.js";
import { processRuns } from "../fixtures/processGroupMembers.js";

// The rules of the editor's command spawner (packages/vibe64-execution/src/server/engines/commandSpawner.js), one
// test each. This process sends its commands to a spawner, as the editor server does from its boot. The capture
// engine's own results and messages, which run on top of it, are pinned by vibe64CaptureCommand.unit.test.js, in a
// process that runs its commands itself and again through a spawner (vibe64CaptureThroughSpawner.unit.test.js).
startCommandSpawner();
const posix = { skip: process.platform === "win32" };
const linux = { skip: process.platform !== "linux" };
const env = { PATH: process.env.PATH };
const SPAWNER_PROCESS = fileURLToPath(new URL(
  "../../packages/vibe64-execution/src/server/engines/commandSpawnerProcess.js", import.meta.url
));

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

test("kill signals a running command, its signal reaches the editor, and kill answers false once it has exited", posix, async () => {
  const child = spawnCommand("sleep", ["30"], { env });
  const seen = events(child);
  await child.spawned;
  assert.equal(child.kill("SIGTERM"), true);
  assert.deepEqual((await seen).at(-1).slice(0, 3), ["close", null, "SIGTERM"]);
  assert.equal(child.kill("SIGKILL"), false);
  assert.throws(() => child.kill("SIGNOPE"), { code: "ERR_UNKNOWN_SIGNAL" });
});

test("a command that cannot start fails with Node's own spawn error and nothing follows it", posix, async () => {
  const child = spawnCommand("vibe64-missing-command", [], { env });
  const errors = [];
  child.on("error", (error) => errors.push(error));
  assert.equal(await child.spawned, undefined);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "ENOENT");
  assert.equal(errors[0].message, "spawn vibe64-missing-command ENOENT");
  await assert.rejects(spawnCommand("sh", ["-c", "true"], { env: { BAD: "a\u0000b" } }).spawned, {
    code: "ERR_INVALID_ARG_VALUE"
  });
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
  const { ended, scopeEmpty } = await endCaptures({ termTimeoutMs: 75, killTimeoutMs: 75 });
  assert.equal(ended, 1);
  assert.equal(scopeEmpty, true);
  assert.equal(await processGroupHasLiveMember(groupId), false);
  assert.equal((await running).signal, "SIGTERM");
});

test("a spawner that dies mid-command fails its commands naming it, their groups are ended, and the next command starts a new one", posix, async () => {
  let lines = "";
  const running = runCaptureCommand("sh", ["-c", "echo $PPID $$; sleep 30 & wait"], {
    env,
    onOutput: (text) => {
      lines += text;
    },
    timeout: 30_000
  });
  assert.ok(await waitUntil(() => lines.includes("\n")));
  const [deadSpawner, groupId] = lines.trim().split(" ").map(Number);
  process.kill(deadSpawner, "SIGKILL");
  const result = await running;
  assert.equal(result.ok, false);
  assert.equal(result.code, COMMAND_SPAWNER_FAILED);
  assert.match(result.error, /^Command failed with vibe64_command_spawner_failed: sh -c /u);
  assert.match(result.error, /Vibe64's command spawner stopped \(signal SIGKILL\) while this command ran\./u);
  assert.equal(await processGroupHasLiveMember(groupId), false);
  // The next command goes to a new spawner: once a process uses a spawner, it never runs a command itself.
  const next = await runCaptureCommand("sh", ["-c", "echo $PPID"], { env });
  assert.equal(next.ok, true);
  assert.notEqual(Number(next.stdout.trim()), deadSpawner);
  assert.notEqual(Number(next.stdout.trim()), process.pid);
  assert.match(readFileSync(`/proc/${Number(next.stdout.trim())}/cmdline`, "utf8"), /commandSpawnerProcess\.js/u);
});

test("a spawner that dies with output still waiting for the editor leaves no command running unknown to it, and the commands it reported end as usual", linux, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-spawner-backlog-"));
  const reported = path.join(root, "reported.pid");
  const unreported = path.join(root, "unreported.pid");
  t.after(async () => {
    for (const file of [reported, unreported]) {
      if (existsSync(file)) {
        try {
          process.kill(-Number(readFileSync(file, "utf8")), "SIGKILL");
        } catch {
          // Already ended.
        }
      }
    }
    await rm(root, { recursive: true, force: true });
  });
  const spawner = await spawnerPid();
  // While the editor reads nothing, a command fills the channel with output: the spawner's own queue holds what the
  // socket cannot, behind which an answer would wait.
  const flooding = runCaptureCommand("sh", ["-c", `echo $$ > ${reported}; head -c 8000000 /dev/zero; exec sleep 30`], {
    env,
    timeout: 30_000
  });
  holdEventLoop(1_000);
  const late = spawnCommand("sh", ["-c", `echo $$ > ${unreported}; exec sleep 30`], { env });
  const lateFailure = new Promise((resolve) => late.once("error", resolve));
  holdEventLoop(1_000);
  process.kill(spawner, "SIGKILL");
  holdEventLoop(200);

  // A command the editor does not know never started.
  assert.equal((await lateFailure).code, COMMAND_SPAWNER_FAILED);
  const started = existsSync(unreported) ? Number(await readFile(unreported, "utf8")) : undefined;
  assert.equal(late.pid, started, "a command that started is one the editor knows, and one it does not know never started");
  // The command whose start was reported fails naming the spawner, and its group is ended, as for any spawner death.
  const flooded = await flooding;
  assert.equal(flooded.code, COMMAND_SPAWNER_FAILED);
  assert.equal(await processGroupHasLiveMember(Number(await readFile(reported, "utf8"))), false);
});

test("a spawner that stops answering is stopped, and the command waiting on it fails naming it", { ...posix, timeout: 30_000 }, async () => {
  const stuck = await spawnerPid();
  process.kill(stuck, "SIGSTOP");
  const started = Date.now();
  const result = await runCaptureCommand("sh", ["-c", "true"], { env, timeout: 60_000 });
  assert.ok(Date.now() - started >= STUCK_AFTER_MS - 100);
  assert.equal(result.code, COMMAND_SPAWNER_FAILED);
  assert.match(result.error, new RegExp(`command spawner did not answer for ${STUCK_AFTER_MS} ms and was stopped`, "u"));
  assert.ok(await waitUntil(() => !processRuns(stuck)), "the stuck spawner was killed");
  assert.equal((await runCaptureCommand("sh", ["-c", "true"], { env })).ok, true);
});

test("a started command holds no channel to the spawner: its only open files are its stdin, stdout and stderr", linux, async () => {
  const { stdout } = await execFileCommand("sh", ["-c", "ls /proc/$$/fd"], { env });
  assert.deepEqual(stdout.split(/\s+/u).filter(Boolean).sort(), ["0", "1", "2"]);
});

test("no other process can open the spawner's channel through /proc, and the spawner starts with no environment but its channel's", linux, async () => {
  const pid = await spawnerPid();
  const channel = readdirSync(`/proc/${pid}/fd`).find((fd) => fd === "3");
  assert.equal(channel, "3");
  assert.throws(() => openSync(`/proc/${pid}/fd/3`, "w"), { code: "ENXIO" });
  // Node names the channel to the child in these two, and removes them from its process.env as it starts.
  const names = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").filter(Boolean).map((entry) => entry.split("=")[0]);
  assert.deepEqual(names.sort(), ["NODE_CHANNEL_FD", "NODE_CHANNEL_SERIALIZATION_MODE"]);
});

test("the spawner refuses a message it does not know: it runs nothing and stops", posix, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-spawner-refuse-"));
  try {
    const marker = path.join(root, "ran");
    const spawner = spawn(process.execPath, [SPAWNER_PROCESS], {
      env: {},
      serialization: "advanced",
      stdio: ["ignore", "ignore", "pipe", "ipc"]
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

test("the spawner never keeps the editor's process alive, ignores stop signals, and ends when the editor ends", posix, async () => {
  const editorSource = `
    import { execFileCommand, startCommandSpawner } from ${JSON.stringify(new URL("../../packages/vibe64-execution/src/server/engines/commandSpawner.js", import.meta.url).href)};
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

  // A running editor's spawner survives SIGTERM and SIGINT, and ends when the editor is killed.
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
    process.kill(heldSpawner, "SIGTERM");
    process.kill(heldSpawner, "SIGINT");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(processRuns(heldSpawner), true);
    held.kill("SIGKILL");
    assert.ok(await waitUntil(() => !processRuns(heldSpawner)), "the spawner ended with its editor");
  } finally {
    held.kill("SIGKILL");
  }
});
