import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runVibe64Command } from "@local/vibe64-execution/server";

// A timed-out command can leave a member this process may not signal, such as
// the root-owned child a sudo helper leaves. The kernel then answers EPERM.
function denyGroupSignals() {
  const realKill = process.kill;
  const groups = new Set();
  process.kill = function kill(pid, signal) {
    if (Number(pid) < 0 && signal !== 0) {
      groups.add(-Number(pid));
      throw Object.assign(new Error("kill EPERM"), { code: "EPERM", errno: -1, syscall: "kill" });
    }
    return realKill.call(process, pid, signal);
  };
  return {
    groups,
    restore() {
      process.kill = realKill;
      for (const pgid of groups) {
        try { realKill.call(process, -pgid, "SIGKILL"); } catch { /* ended */ }
      }
    }
  };
}

test("a timed-out capture whose processes cannot all be stopped still reports the timeout", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-capture-drain-"));
  const denied = denyGroupSignals();
  let result;
  try {
    result = await runVibe64Command({
      command: "sh", args: ["-c", "sleep 30 </dev/null >/dev/null 2>&1 & exec sleep 30"], cwd: root,
      mode: "capture", purpose: "codex", timeout: 300
    });
  } finally {
    denied.restore();
    await rm(root, { force: true, recursive: true });
  }
  assert.equal(result.ok, false);
  // The scope is still not proven empty, so its owner keeps the cleanup duty.
  assert.equal(result.code, "vibe64_execution_drain_failed");
  assert.notEqual(result.execution?.state, "finished");
  // The command did not finish: it timed out, and the result says so.
  assert.equal(result.timedOut, true);
  assert.match(result.error, /^The command timed out, and its execution scope did not become empty/u);
  assert.doesNotMatch(result.error, /finished/u);
  if (process.platform === "linux") {
    assert.match(result.error, /\bsleep\b/u, "the error names what is left");
    assert.ok(result.remainingProcesses.some(({ command }) => command === "sleep"));
  }
});
