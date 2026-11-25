import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { managedExecutionExitType } from "../../packages/vibe64-execution/src/host/managedExecution.js";
import { linuxProcessStat, processEnded } from "../../packages/vibe64-execution/src/server/runtime/processEnded.js";
import { execHelperSource as helperSource } from "../fixtures/execHelperSource.js";

// An agent's command is a detached job, and a job is a task: nothing it starts outlives it. Its unit ends when its
// runner ends, so systemd stops whatever the command left running, however it left it (`&`, nohup, setsid, a double
// fork; screen -dm is setsid and a fork), where before the unit kept it until the session closed: a test suite the
// session's AI started "fully detached" outlived its command, the turn, Stop and editor restarts (25 Nov 2026). Work the
// agent's own tool keeps in its background mode is untouched, since that command is still running. A service's unit
// (Preview, the assistant, a browser) and a finite capture's still run while any of their processes does.

test("a detached job's unit ends with its runner; every other execution's runs while any of its processes does", async () => {
  assert.equal(managedExecutionExitType("job", "detached"), "main");
  for (const kind of ["assistant", "browser", "control", "preview", "service", "terminal"]) {
    assert.equal(managedExecutionExitType(kind, "detached"), "cgroup", kind);
  }
  // A finite capture's caller waits for its descendants, and an interactive terminal's for its own.
  assert.equal(managedExecutionExitType("job", "capture"), "cgroup");
  assert.equal(managedExecutionExitType("terminal", "pty"), "cgroup");

  const source = await helperSource();
  const args = source.slice(source.indexOf("const systemdArgs = ["), source.indexOf('const started = spawnSync("systemd-run"'));
  assert.match(args, /"--property=KillMode=control-group",\n {4}`--property=ExitType=\$\{managedExecutionExitType\(kind, mode\)\}`,/u);
  assert.equal(args.match(/--property=ExitType/gu).length, 1);
});

// The same unit properties on this machine's own systemd, through the user's manager: no root, and skipped without one.
function userManagerSkipReason() {
  if (process.platform !== "linux") return "it needs systemd";
  const probe = spawnSync("systemd-run", ["--user", "--quiet", "--wait", "--collect", "true"], { encoding: "utf8", timeout: 15_000 });
  return probe.status === 0 ? false : "it needs a systemd user manager (systemd-run --user)";
}

const LEFTOVERS = ["background", "nohup", "setsid", "double-fork"];

// The unit's command, a script beside its pids (systemd would expand a `$` given on its command line): it leaves a
// process running each way, then runs until the test releases it.
const COMMAND = [
  'dir="$1"',
  'sleep 300 & echo $! > "$dir/background"',
  'nohup sleep 300 > /dev/null 2>&1 & echo $! > "$dir/nohup"',
  "setsid sh -c 'echo $$ > \"$1/setsid\"; exec sleep 300' sh \"$dir\" &",
  "( sh -c 'echo $$ > \"$1/double-fork\"; exec sleep 300' sh \"$dir\" & )",
  'while [ ! -e "$dir/release" ]; do sleep 0.1; done'
].join("\n");

function processStart(pid) {
  try {
    const stat = linuxProcessStat(readFileSync(`/proc/${pid}/stat`, "utf8"));
    return stat && !processEnded(stat) ? stat.startTimeTicks : "";
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return "";
    throw error;
  }
}

async function until(check, what, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${typeof what === "function" ? what() : what}`);
    await delay(50);
  }
}

/** Starts the command in a transient unit with the helper's lifetime properties for KIND, as MODE. */
async function startUnit(t, kind) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "v64-job-containment-"));
  const unit = `v64-job-containment-${randomUUID()}.service`;
  t.after(async () => {
    spawnSync("systemctl", ["--user", "stop", unit], { timeout: 30_000 });
    spawnSync("systemctl", ["--user", "reset-failed", unit], { timeout: 15_000 });
    await rm(dir, { force: true, recursive: true });
  });
  await writeFile(path.join(dir, "command.sh"), `${COMMAND}\n`);
  const started = spawnSync("systemd-run", [
    "--user", "--quiet", `--unit=${unit}`, "--service-type=exec", "--collect",
    "--property=KillMode=control-group",
    `--property=ExitType=${managedExecutionExitType(kind, "detached")}`,
    "--property=TimeoutStopSec=10s",
    "/bin/sh", path.join(dir, "command.sh"), dir
  ], { encoding: "utf8", timeout: 30_000 });
  assert.equal(started.status, 0, started.stderr);
  await until(() => LEFTOVERS.every((name) => existsSync(path.join(dir, name)) &&
    /^\d+$/u.test(readFileSync(path.join(dir, name), "utf8").trim())), "each leftover's pid");
  const pids = Object.fromEntries(LEFTOVERS.map((name) => {
    const pid = Number(readFileSync(path.join(dir, name), "utf8").trim());
    return [name, { pid, start: processStart(pid) }];
  }));
  const running = () => Object.entries(pids)
    .filter(([, entry]) => entry.start && processStart(entry.pid) === entry.start).map(([name]) => name);
  const active = () => spawnSync("systemctl", ["--user", "is-active", unit], { encoding: "utf8" }).stdout.trim();
  const mainPid = () => spawnSync("systemctl", ["--user", "show", "--property=MainPID", "--value", unit], { encoding: "utf8" }).stdout.trim();
  return { active, dir, mainPid, running };
}

test("an agent's command keeps its background work while it runs, and ends what it left running when it ends", {
  skip: userManagerSkipReason()
}, async (t) => {
  const job = await startUnit(t, "job");
  // While the command runs, everything it started runs.
  assert.deepEqual(job.running(), LEFTOVERS);
  assert.equal(job.active(), "active");

  await writeFile(path.join(job.dir, "release"), "");
  await until(() => job.running().length === 0, () => `the job's leftovers to stop (still running: ${job.running().join(", ")})`);
  await until(() => job.active() !== "active" && job.active() !== "deactivating", "the job's unit to end");
});

test("a service keeps what its first process leaves running after that process ends", {
  skip: userManagerSkipReason()
}, async (t) => {
  const service = await startUnit(t, "service");
  await writeFile(path.join(service.dir, "release"), "");
  await until(() => service.mainPid() === "0", "the service's first process to end");
  // Its unit and every process it left are still there, as a service's are.
  assert.deepEqual(service.running(), LEFTOVERS);
  assert.equal(service.active(), "active");
});
