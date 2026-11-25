import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { processGroupHasLiveMember, readProcessStart } from "@local/vibe64-execution/server";
import { drainProcessGroup, processGroupMembers } from "../../packages/vibe64-execution/src/server/engines/detached.js";
import { awaitManagedExecutionGroupExit } from "../../packages/vibe64-execution/src/host/managedExecution.js";
import { acquireUpgradeLock } from "../../packages/vibe64-core/src/server/stateUpgradeLock.js";
import { liveProcessGroupMembers, processGroupMembersLeftRunning } from "../fixtures/processGroupMembers.js";

// A process whose main thread calls pthread_exit while another thread runs: Linux then shows its thread group leader as
// a zombie (Z) in /proc/<pid>/stat, with num_threads 2, for as long as the process runs. Every check of a process or a
// group once read that Z as an ended process, so a stop reported a process gone that was still running. python3 calls
// libc's pthread_exit through ctypes; the second thread writes a counter, which shows the process running, and the
// process ignores SIGTERM, so only a stop that sees it running and goes on to SIGKILL ends it.
const ZOMBIE_LEADER = `
import ctypes, signal, sys, threading, time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
def beat():
    n = 0
    while True:
        n += 1
        with open(sys.argv[1], "w") as f:
            f.write(str(n))
        time.sleep(0.02)
threading.Thread(target=beat, daemon=True).start()
time.sleep(0.1)
ctypes.CDLL(None).pthread_exit(None)
`;
const LINUX_ONLY = process.platform === "linux" ? false : "a zombie thread group leader is Linux's";

async function statFields(pid) {
  const text = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");
  return text ? text.slice(text.lastIndexOf(")") + 2).split(" ") : [];
}

/** A process in its own group whose leader is a zombie while its second thread runs, and whether it still runs. */
async function zombieLeader(t) {
  const folder = await mkdtemp(path.join(os.tmpdir(), "vibe64-zombie-leader-"));
  const beat = path.join(folder, "beat");
  const child = spawn("python3", ["-c", ZOMBIE_LEADER, beat], { detached: true, stdio: "ignore" });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  t.after(async () => {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      // It has already ended.
    }
    await exited;
    await rm(folder, { recursive: true, force: true });
  });
  const deadline = Date.now() + 5000;
  for (;;) {
    const [state, , , , , , , , , , , , , , , , , threads] = await statFields(child.pid);
    if (state === "Z" && Number(threads) === 2 && await readFile(beat, "utf8").catch(() => "")) break;
    assert.ok(Date.now() < deadline, `python3 did not leave a zombie leader with a running thread (state ${state}, threads ${threads})`);
    await delay(10);
  }
  return {
    pid: child.pid,
    exited,
    async running() {
      const before = Number(await readFile(beat, "utf8").catch(() => "0"));
      await delay(150);
      return Number(await readFile(beat, "utf8").catch(() => "0")) > before;
    }
  };
}

/** Asserts the stop that just returned left the process ended: gone, or a zombie on its last thread, writing no more. */
async function assertEnded(leader, name) {
  const [state, , , , , , , , , , , , , , , , , threads] = await statFields(leader.pid);
  assert.ok(state === undefined || (state === "Z" && Number(threads) === 1),
    `${name} returned with the process still running (state ${state}, threads ${threads})`);
  assert.equal(await leader.running(), false, `${name} ended its second thread`);
}

// Each check, against a process of its own.
test("processGroupHasLiveMember counts a zombie leader whose second thread runs", { skip: LINUX_ONLY }, async (t) => {
  const leader = await zombieLeader(t);
  assert.equal(await processGroupHasLiveMember(leader.pid), true);
  assert.equal(await leader.running(), true, "the second thread still runs");
});

test("readProcessStart reports the threads a zombie leader's process still has", { skip: LINUX_ONLY }, async (t) => {
  const leader = await zombieLeader(t);
  const start = await readProcessStart(leader.pid);
  assert.equal(start.status, "exact");
  assert.equal(start.state, "Z");
  assert.equal(start.threads, 2);
});

test("the detached engine names a zombie leader whose second thread runs as a member", { skip: LINUX_ONLY }, async (t) => {
  const leader = await zombieLeader(t);
  assert.deepEqual((await processGroupMembers(leader.pid)).map(({ pid }) => pid), [leader.pid]);
});

test("the detached engine's stop goes on to SIGKILL a zombie leader whose second thread ignores SIGTERM", { skip: LINUX_ONLY }, async (t) => {
  const leader = await zombieLeader(t);
  // SIGTERM, then the group read until empty or SIGKILL.
  assert.equal(await drainProcessGroup(leader.pid, { termTimeoutMs: 300, killTimeoutMs: 3000 }), true);
  await assertEnded(leader, "the detached stop");
});

test("the managed execution runner's wait goes on to SIGKILL a zombie leader whose second thread ignores SIGTERM", { skip: LINUX_ONLY }, async (t) => {
  const leader = await zombieLeader(t);
  // The runner's wait after its SIGTERM: the rest of the grace, then SIGKILL.
  process.kill(-leader.pid, "SIGTERM");
  await awaitManagedExecutionGroupExit({ pid: leader.pid }, Date.now());
  await assertEnded(leader, "the managed execution runner's wait");
});

test("the state upgrade lock a zombie leader whose second thread runs holds is not taken over", { skip: LINUX_ONLY }, async (t) => {
  const leader = await zombieLeader(t);
  const folder = await mkdtemp(path.join(os.tmpdir(), "vibe64-zombie-lock-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const lockPath = path.join(folder, "apply.lock");
  const bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
  const [, , , , , , , , , , , , , , , , , , , started] = await statFields(leader.pid);
  await writeFile(lockPath, `${JSON.stringify({ pid: leader.pid, bootId, started })}\n`);
  assert.equal(await acquireUpgradeLock(lockPath), null);
});

test("the test helper names a zombie leader whose second thread runs at once, as a member that is not exiting", { skip: LINUX_ONLY }, async (t) => {
  const leader = await zombieLeader(t);
  assert.deepEqual(liveProcessGroupMembers(leader.pid).map(({ pid, state, exiting }) => ({ pid, state, exiting })),
    [{ pid: leader.pid, state: "Z", exiting: false }]);
  const startedAt = Date.now();
  assert.equal((await processGroupMembersLeftRunning(leader.pid)).length, 1);
  assert.ok(Date.now() - startedAt < 500, "named at once, not followed as an exiting member");
});

test("a plain zombie, every thread ended and its parent yet to reap it, has ended", { skip: LINUX_ONLY }, async (t) => {
  // sh starts a short child in a group of its own, then execs into a sleep that never reaps it.
  const folder = await mkdtemp(path.join(os.tmpdir(), "vibe64-plain-zombie-"));
  const pidFile = path.join(folder, "pid");
  const holder = spawn("sh", ["-c", 'setsid sleep 0.05 >/dev/null 2>&1 & echo $! > "$1"; exec sleep 30', "sh", pidFile], { stdio: "ignore" });
  const exited = new Promise((resolve) => holder.once("exit", resolve));
  t.after(async () => {
    holder.kill("SIGTERM");
    await exited;
    await rm(folder, { recursive: true, force: true });
  });
  const deadline = Date.now() + 5000;
  let zombie = 0;
  for (;;) {
    zombie = Number(await readFile(pidFile, "utf8").catch(() => "0"));
    const [state] = zombie ? await statFields(zombie) : [];
    if (state === "Z") break;
    assert.ok(Date.now() < deadline, `the short child did not become a zombie (state ${state})`);
    await delay(10);
  }
  const [, , group, , , , , , , , , , , , , , , threads] = await statFields(zombie);
  assert.equal(Number(group), zombie, "the zombie leads its own group");
  assert.equal(Number(threads), 1, "a plain zombie counts its own thread only");
  const start = await readProcessStart(zombie);
  assert.equal(start.state, "Z");
  assert.equal(start.threads, 1);
  assert.equal(await processGroupHasLiveMember(zombie), false, "a group left with only a plain zombie has no live member");
  assert.deepEqual(await processGroupMembers(zombie), []);
  assert.deepEqual(liveProcessGroupMembers(zombie), []);
});
