import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  runCaptureCommand,
  stopCaptureExecution
} from "../../packages/vibe64-execution/src/server/engines/capture.js";

// Capture results are read by their callers' own checks: Studio health matches
// "Command failed with exit code N:", operator CLI and Git diagnosis match
// "spawn <file> ENOENT", and workspace setup reads that from the output. These
// cases pin the result shape and messages capture commands have always had.
const posix = { skip: process.platform === "win32" };
const env = { PATH: process.env.PATH };

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-capture-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

const capture = (command, args, options = {}) => withRoot((root) => runCaptureCommand(command, args, {
  cwd: root, env, timeout: 10_000, ...options
}));

test("a capture keeps stdout and stderr apart and interleaves both as output", posix, async () => {
  const result = await capture("sh", ["-c", "printf 'out1\\n'; sleep 0.1; printf 'err1\\n' >&2; sleep 0.1; printf 'out2'"]);
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.code, "");
  assert.equal(result.error, "");
  assert.equal(result.stdout, "out1\nout2");
  assert.equal(result.stderr, "err1\n");
  assert.equal(result.output, "out1\nerr1\nout2");
  assert.equal(result.timedOut, false);
});

test("a failing command reports its exit code in the message callers match", posix, async () => {
  const result = await capture("sh", ["-c", "echo nope >&2; exit 3"]);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 3);
  assert.equal(result.code, "");
  assert.equal(result.error, "Command failed with exit code 3: sh -c 'echo nope >&2; exit 3'");
  assert.match(result.error, /^Command failed with exit code \d+:/u);
  assert.equal(result.output, "nope");
});

test("a failure without output reports its message as the output", posix, async () => {
  const result = await capture("sh", ["-c", "exit 2"]);
  assert.equal(result.output, "Command failed with exit code 2: sh -c 'exit 2'");
});

test("a missing command names the spawn failure", posix, async () => {
  const result = await capture("vibe64-missing-command", ["a b", "it's"]);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.code, "vibe64_command_capture_failed");
  assert.equal(result.error,
    "Command failed with ENOENT: vibe64-missing-command 'a b' 'it'\\''s'\nspawn vibe64-missing-command ENOENT");
  assert.match(result.error, /\bspawn \S+ (?:ENOENT|EACCES)\b/u);
  assert.match(result.output, /\bspawn (\S+) ENOENT\b/u);
  assert.equal(result.signal, "");
});

test("a missing working directory is named with the spawn failure", posix, async () => {
  const result = await withRoot((root) => runCaptureCommand("sh", ["-c", "true"], {
    cwd: path.join(root, "gone"), env
  }));
  assert.equal(result.code, "vibe64_command_capture_failed");
  assert.match(result.error,
    /^Command failed with ENOENT: sh -c true\nThe "cwd" option is invalid: \/.+\/gone\.\nENOENT: no such file or directory, stat '\/.+\/gone'\nspawn sh ENOENT$/u);
});

test("a timeout stops the command and says so", posix, async () => {
  const started = Date.now();
  const result = await capture("sleep", ["5"], { timeout: 200 });
  assert.ok(Date.now() - started < 4_000);
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.code, "vibe64_command_capture_timed_out");
  assert.equal(result.signal, "SIGTERM");
  assert.equal(result.error, "Command timed out after 200 milliseconds: sleep 5");
});

test("a timed-out command that ignores SIGTERM is killed five seconds later", posix, async () => {
  const result = await capture("sh", ["-c", "trap '' TERM; while :; do sleep 0.1; done"], { timeout: 200 });
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, "SIGKILL");
  assert.match(result.error,
    /^Command timed out after 200 milliseconds and was forcefully terminated after 5000 milliseconds: sh -c /u);
});

test("a command ended by a signal is reported with that signal", posix, async () => {
  const result = await capture("sh", ["-c", "kill -TERM $$"]);
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.signal, "SIGTERM");
  assert.equal(result.error, "Command was killed with SIGTERM (Termination): sh -c 'kill -TERM $$'");
});

test("input reaches the command's stdin and only the given environment does", posix, async () => {
  const echoed = await capture("cat", [], { input: "hello\n" });
  assert.equal(echoed.stdout, "hello\n");
  const environment = await capture("sh", ["-c", "env"], { env: { ...env, VIBE64_ONLY: "1" } });
  assert.match(environment.stdout, /^VIBE64_ONLY=1$/mu);
  assert.doesNotMatch(environment.stdout, /^HOME=/mu);
});

test("base64 output encodes each stream's bytes", posix, async () => {
  const result = await capture("sh", ["-c", "printf '\\377\\376abc'; sleep 0.1; printf 'xy' >&2"], { outputEncoding: "base64" });
  const stdout = Buffer.from([0xff, 0xfe, 0x61, 0x62, 0x63]);
  assert.equal(result.outputEncoding, "base64");
  assert.equal(result.stdout, stdout.toString("base64"));
  assert.equal(result.stderr, Buffer.from("xy").toString("base64"));
  assert.equal(result.output, Buffer.concat([stdout, Buffer.from("xy")]).toString("base64"));
});

test("output observers see output as it arrives, and a failing observer changes nothing", posix, async () => {
  const seen = [];
  const result = await capture("sh", ["-c", "echo a; sleep 0.1; echo b >&2"], {
    onOutput(text) {
      seen.push(text);
      throw new Error("observer failure");
    }
  });
  assert.equal(result.ok, true);
  assert.equal(seen.join(""), "a\nb\n");
  assert.equal(result.output, "a\nb");
});

test("output past maxBuffer stops being read and fails the command with its first part kept", posix, async () => {
  const result = await capture("sh", ["-c", "echo started >&2; exec yes"], { maxBuffer: 1000 });
  assert.equal(result.ok, false);
  assert.equal(result.stdout, "y\n".repeat(500));
  assert.equal(result.stderr, "started\n");
  // The command kept writing to the output nobody reads any more.
  assert.equal(result.signal, "SIGPIPE");
  assert.equal(result.error, "Command's stdout was larger than 1000 characters: sh -c 'echo started >&2; exec yes'\nmaxBuffer exceeded");
});

test("an aborted capture stops its command and reports the cancellation", posix, async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const started = Date.now();
  const result = await capture("sleep", ["5"], { signal: controller.signal });
  assert.ok(Date.now() - started < 4_000);
  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_command_cancelled");
  const early = await capture("sleep", ["5"], { signal: AbortSignal.abort() });
  assert.equal(early.code, "vibe64_command_cancelled");
});

test("its owner stops a running capture by execution id", posix, async () => {
  const execution = { id: "capture-stop-1", state: "running" };
  const running = capture("sleep", ["5"], { execution });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(await stopCaptureExecution("capture-stop-1"), {
    executionId: "capture-stop-1", ok: true, scopeEmpty: true
  });
  const result = await running;
  assert.equal(result.ok, false);
  assert.equal(result.signal, "SIGTERM");
  assert.equal(result.error, "Command was killed with SIGTERM (Termination): sleep 5");
  assert.equal(result.execution.state, "finished");
  assert.equal((await stopCaptureExecution("capture-stop-1")).code, "vibe64_execution_not_found");
});
