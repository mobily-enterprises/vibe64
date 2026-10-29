import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DAEMON_USERNAME_PREFIX, assertEnabledForVibe64, consumeManagedExecutionRequestPayload, deploymentServiceUnit,
  ensureManagedServiceProcessOwnership, helperChildEnv, parseEnvironmentFile, managedExecutionState, managedExecutionOomBoundary, managedExecutionStopTimeoutMs,
  managedExecutionTaskLimitCounters, managedExecutionTaskLimitJournal, openManagedExecutionReceipts,
  releaseEndedManagedExecutions, stopManagedExecution, stopManagedServiceUnit,
  upgradeReleaseServiceUnits } from "../../packages/vibe64-execution/src/host/execHelper.js";
import {
  RUNTIME_PACKS,
  VIBE64_INTERACTIVE_RUNTIME_PACKS
} from "../../packages/vibe64-execution/src/server/runtime/runtimePacks.js";

const HELPER_SOURCE_URL = new URL("../../packages/vibe64-execution/src/host/execHelper.js", import.meta.url);
// The workspace daemon account the helper serves, as the helper names it.
const daemonUser = (workspace) => `${DAEMON_USERNAME_PREFIX}${workspace}`;

const oomUnit = `vibe64-exec-test-${"c".repeat(32)}.service`;
const oomWork = "/vibe64.slice/vibe64-test.slice/vibe64-test-work.slice";
const oomProject = `${oomWork}/vibe64-test-work-p${"a".repeat(64)}.slice`;
const oomSession = `${oomProject}/vibe64-test-work-p${"a".repeat(64)}-s${"b".repeat(64)}.slice`;
const oomWorkflow = `${oomSession}/vibe64-test-work-p${"a".repeat(64)}-s${"b".repeat(64)}-w${"d".repeat(32)}.slice`;
const oomExecution = `${oomWorkflow}/${oomUnit}`;
const oomQuery = { unitName: oomUnit, workspace: "test", startedAt: 1000, until: 3000 };

test("a collected unit cannot overwrite the runner's exit and task-denial receipt with systemd defaults", () => {
  const startedAt = "2026-10-14T00:05:31.000Z";
  const exitObservedAt = "2026-10-14T00:06:05.000Z";
  const taskLimit = { source: "cgroup-pids-events", scope: "execution", count: 1 };
  const state = managedExecutionState(oomUnit, "execution", {}, {
    query: () => ({ stdout: "LoadState=not-found\nActiveState=inactive\nResult=success\nExecMainCode=0\nExecMainStatus=0\nTasksMax=9999\n" }),
    readResult: () => ({ executionId: "execution", startedAt, exitObservedAt,
      result: "exit-code", execMainCode: "exited", execMainStatus: "23", taskLimit, tasksPeak: "128" })
  });
  assert.equal(state.loadState, "recorded");
  assert.equal(state.result, "exit-code");
  assert.equal(state.execMainStatus, "23");
  assert.equal(state.startedAt, startedAt);
  assert.equal(state.exitObservedAt, exitObservedAt);
  assert.equal(state.tasksPeak, "128");
  assert.equal(state.tasksMax, "0", "a disappeared unit has no observed current limit");
  assert.deepEqual(state.taskLimit, taskLimit);
});

test("task denial counters prove only the boundary their mount semantics identify", () => {
  const mount = "37 28 0:31 / /sys/fs/cgroup rw - cgroup2 cgroup2 rw,nsdelegate";
  const values = { "/proc/self/mountinfo": mount,
    "/group/pids.events.local": "max 3\n", "/group/pids.events": "max 5\n" };
  const read = (name) => { if (!(name in values)) throw new Error("missing"); return values[name]; };
  assert.deepEqual(managedExecutionTaskLimitCounters("/group", read),
    { source: "cgroup-pids-events", scope: "execution", count: 3 });
  values["/proc/self/mountinfo"] += ",pids_localevents";
  assert.equal(managedExecutionTaskLimitCounters("/group", read).scope, "unknown");
  values["/proc/self/mountinfo"] = mount;
  values["/group/pids.events.local"] = "max 0\n";
  assert.deepEqual(managedExecutionTaskLimitCounters("/group", read),
    { source: "cgroup-pids-events", scope: "unknown", count: 5 });
  values["/group/pids.events"] = "max 0\n";
  assert.equal(managedExecutionTaskLimitCounters("/group", read), null);
  values["/group/pids.events"] = "max 9007199254740992\n";
  assert.equal(managedExecutionTaskLimitCounters("/group", read), null);
  assert.equal(managedExecutionTaskLimitCounters("/missing", read), null);
});

test("kernel fork-denial records identify the owned activity, never invent the binding ancestor or denial count", () => {
  const line = (group = oomExecution, time = "2000000") => JSON.stringify({ __REALTIME_TIMESTAMP: time,
    MESSAGE: `cgroup: fork rejected by pids controller in ${group}` });
  assert.deepEqual(managedExecutionTaskLimitJournal(line(), oomQuery), {
    source: "kernel-journal", scope: "unknown", count: null, recordedAt: "1970-01-01T00:00:02.000Z"
  });
  for (const text of [line(oomExecution.replace(oomUnit, `other-${oomUnit}`)),
    line(oomExecution.replaceAll("vibe64-test", "vibe64-foreign")), line(`${oomExecution}/..`),
    line(oomExecution, "999000"), line(oomExecution, "3001000"), line(oomExecution, "NaN"),
    "invalid", "", Array(65).fill(line()).join("\n"), "x".repeat(128 * 1024 + 1)
  ]) assert.equal(managedExecutionTaskLimitJournal(text, oomQuery), null);
});
function oomLine(group, { taskGroup = oomExecution, time = "2000000", constraint = "CONSTRAINT_MEMCG" } = {}) {
  return JSON.stringify({ __REALTIME_TIMESTAMP: time,
    MESSAGE: `oom-kill:constraint=${constraint},nodemask=(null),cpuset=/,mems_allowed=0,${group ? `oom_memcg=${group}` : "global_oom"},task_memcg=${taskGroup},task=node,pid=123,uid=1000` });
}

test("kernel OOM attribution distinguishes the exceeded group from the victim's group", () => {
  for (const [group, scope] of [
    [oomExecution, "execution"], [oomWorkflow, "workflow"], [oomSession, "session"],
    [oomProject, "project"], [oomWork, "workspace_work"], ["/vibe64.slice/vibe64-test.slice", "workspace"],
    ["/vibe64.slice", "platform"]
  ]) {
    assert.deepEqual(managedExecutionOomBoundary(oomLine(group), oomQuery), {
      source: "kernel-journal", scope, cgroup: group, recordedAt: "1970-01-01T00:00:02.000Z"
    });
  }
  assert.equal(managedExecutionOomBoundary(oomLine("", { constraint: "CONSTRAINT_NONE" }), oomQuery).scope, "host");
});

test("kernel OOM evidence excludes other executions, workspaces, times and placement constraints", () => {
  for (const line of [
    oomLine(oomWork, { taskGroup: oomExecution.replace(oomUnit, `other-${oomUnit}`) }),
    oomLine(oomWork, { taskGroup: oomExecution.replaceAll("vibe64-test", "vibe64-foreign") }),
    oomLine(oomWork, { time: "999000" }), oomLine(oomWork, { time: "3001000" }),
    oomLine(oomWork, { time: "NaN" }), oomLine(`${oomWork}/sibling.slice`),
    oomLine("", { constraint: "CONSTRAINT_CPUSET" }),
    oomLine("", { constraint: "CONSTRAINT_MEMORY_POLICY" }),
    JSON.stringify({ MESSAGE: "Killed process 123 (node)" }), "invalid", ""
  ]) assert.equal(managedExecutionOomBoundary(line, oomQuery), null, line);
});

test("conflicting or truncated kernel evidence stays unknown and repeated evidence is bounded", () => {
  assert.equal(managedExecutionOomBoundary([oomLine(oomWork), oomLine(oomExecution)].join("\n"), oomQuery), null);
  assert.equal(managedExecutionOomBoundary(Array(65).fill(oomLine(oomWork)).join("\n"), oomQuery), null);
  assert.equal(managedExecutionOomBoundary("x".repeat(128 * 1024 + 1), oomQuery), null);
  const result = managedExecutionOomBoundary([oomLine(oomWork, { time: "2100000" }), oomLine(oomWork)].join("\n"), oomQuery);
  assert.equal(result.recordedAt, "1970-01-01T00:00:02.100Z");
  assert.deepEqual(Object.keys(result).sort(), ["cgroup", "recordedAt", "scope", "source"]);
});

test("long kernel OOM records require an adjacent same-boot continuation, not timestamp proximity alone", () => {
  const full = JSON.parse(oomLine(oomWorkflow));
  const [prefix, suffix] = full.MESSAGE.split(",task_memcg=");
  const first = { ...full, MESSAGE: `${prefix},task_memcg=`, __SEQNUM_ID: "1".repeat(32),
    _BOOT_ID: "2".repeat(32), __SEQNUM: "17", _SOURCE_MONOTONIC_TIMESTAMP: "1000" };
  const second = { ...first, MESSAGE: suffix, __SEQNUM: "18", _SOURCE_MONOTONIC_TIMESTAMP: "1020" };
  const text = (next) => [next, first].map((entry) => JSON.stringify(entry)).join("\n");
  assert.equal(managedExecutionOomBoundary(text(second), oomQuery)?.scope, "workflow");
  for (const change of [{ __SEQNUM: "19" }, { __SEQNUM_ID: "3".repeat(32) }, { _BOOT_ID: "3".repeat(32) },
    { _SOURCE_MONOTONIC_TIMESTAMP: "900" }, { _SOURCE_MONOTONIC_TIMESTAMP: "1001001" },
    { MESSAGE: suffix.replace(oomUnit, "foreign.service") }, { MESSAGE: suffix.replace(/,task=.*/u, "") }
  ]) assert.equal(managedExecutionOomBoundary(text({ ...second, ...change }), oomQuery), null);
});

async function helperSource() {
  return readFile(HELPER_SOURCE_URL, "utf8");
}

test("execution helper waits for a delayed nonblocking stdin payload", async () => {
  const child = spawn(process.execPath, [
    new URL(HELPER_SOURCE_URL).pathname,
    "execute"
  ], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk || "");
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  child.stdin.end("{}\n");
  const exitCode = await new Promise((resolve) => child.once("close", resolve));

  assert.equal(exitCode, 2);
  assert.match(stderr, /rejected a non-normalized execution payload/u);
  assert.doesNotMatch(stderr, /EAGAIN|resource temporarily unavailable/u);
});

// Run as a script, the helper's main() starts while the module is still being
// evaluated, so a constant declared below that call would not exist yet.
test("execution helper starts only after every module declaration is initialized", async () => {
  const source = await helperSource();
  const start = source.indexOf("if (import.meta.main)");
  const declarations = [...source.matchAll(/^(?:const|let|class) /gmu)].map((match) => match.index);
  assert.ok(start > 0 && declarations.length > 0);
  assert.ok(declarations.every((index) => index < start), "every module constant is declared before main() runs");
});

test("execution helper source is the real host helper, not the package stub", async () => {
  const source = await helperSource();

  assert.match(source, /const ALLOWED_OPERATIONS = new Set/u);
  assert.match(source, /"github-api-command"/u);
  assert.match(source, /"github-workflow-command"/u);
  assert.match(source, /"health-status"/u);
  assert.match(source, /"vibe64-command"/u);
  assert.doesNotMatch(source, /has not been installed from this source package/u);
});

test("execution helper preserves operation and command allowlists", async () => {
  const source = await helperSource();

  assert.match(source, /if \(!ALLOWED_OPERATIONS\.has\(operation\)\)/u);
  assert.match(source, /"account-status"/u);
  assert.match(source, /if \(!ALLOWED_COMMANDS\.has\(command\)\)/u);
  assert.match(source, /Vibe64 exec helper rejected an unknown operation/u);
  assert.match(source, /Vibe64 exec helper rejected an unknown command/u);
});

test("execution Stop lets systemd run service cleanup before signalling the cgroup", async () => {
  const source = await helperSource();
  const stop = source.slice(source.indexOf('function stopManagedExecution('), source.indexOf('function assertNormalizedPayload('));
  const firstStop = stop.indexOf('["stop", "--no-block", unitName]');
  assert.ok(firstStop > 0);
  assert.doesNotMatch(stop.slice(0, firstStop), /SIGTERM|SIGKILL|kill-who/u);
  assert.match(stop.slice(firstStop), /SIGKILL/u, "unresponsive descendants still have bounded forced cleanup");
});

// Each finite capture is its own transient unit, and systemd's Starting,
// Started, Deactivated and Consumed lines for each one filled host journals.
// Its result reaches the caller; notices, warnings and errors (a failed result,
// a failing exit, an OOM kill) still reach the journal. Interactive terminals
// and agents keep the default level, so sudo's informational audit of commands
// run there is kept.
test("finite captures keep systemd's routine unit lines out of the journal", async () => {
  const source = await helperSource();
  const args = source.slice(source.indexOf("const systemdArgs = ["), source.indexOf('const started = spawnSync("systemd-run"'));
  assert.match(args, /\.\.\.\(mode === "capture" \? \["--property=LogLevelMax=notice", "--wait", "--pipe"\] : \[\]\)/u);
  assert.match(args, /\.\.\.\(mode === "pty" \? \["--wait", "--pty"\] : \[\]\)/u);
  assert.equal(args.match(/LogLevelMax/gu).length, 1);
});

// A person's sudo rules or setuid programs never lift a command run as them:
// the runner starts with no new privileges, set by setpriv itself so that no
// systemd drop-in can switch it off. The daemon's own executions are unchanged.
test("a person's managed execution can never gain privileges above that person", async () => {
  const source = await helperSource();
  const args = source.slice(source.indexOf("const systemdArgs = ["), source.indexOf('const started = spawnSync("systemd-run"'));
  assert.match(args, /\.\.\.\(targetUser\.username !== owner\.username \? \["\/usr\/bin\/setpriv", "--no-new-privs", "--"\] : \[\]\),\n {4}helperPath,\n {4}"run-managed",/u);
  assert.equal(args.match(/no-new-privs/gu).length, 1);
  const target = source.slice(source.indexOf("function managedExecutionTargetUser("), source.indexOf("function managedExecutionId("));
  assert.match(target, /if \(targetUser\.username !== owner\.username\) \{\n {4}assertActablePerson\(owner, targetUser\);/u,
    "every other target must be a registered person without administrator power");
});

// A unit that ignores SIGTERM: its scope empties only once it is force-killed.
function unresponsiveUnit({ initiallyEmpty = false } = {}) {
  let clock = 0;
  let killed = initiallyEmpty;
  const commands = [];
  const released = [];
  return {
    commands,
    released,
    killedAt: () => commands.find((entry) => entry.args[0] === "kill")?.at ?? null,
    options: {
      run: (command, args) => {
        commands.push({ at: clock, command, args });
        if (args[0] === "kill") killed = true;
        return { status: 0, stdout: "" };
      },
      readState: () => ({ scopeEmpty: killed, unitName: "unit.service" }),
      removeRuntime: () => released.push(clock),
      now: () => clock,
      wait: (milliseconds) => { clock += milliseconds; }
    }
  };
}

// Conversation stops ask for 3 s; a managed stop waited for the unit's 10 s
// TimeoutStopSec, longer than the server's 8 s shutdown deadline.
test("execution Stop force-kills an unresponsive unit at the caller's bound", () => {
  const bounded = unresponsiveUnit();
  const result = stopManagedExecution("unit.service", "execution", {}, { termTimeoutMs: 3000, ...bounded.options });
  assert.equal(result.scopeEmpty, true);
  assert.equal(result.stopped, true);
  assert.ok(bounded.killedAt() >= 3000 && bounded.killedAt() < 3100, `killed at ${bounded.killedAt()} ms`);
  assert.deepEqual(bounded.commands.map(({ args }) => args.join(" ")), [
    "stop --no-block unit.service",
    "kill --kill-who=all --signal=SIGKILL unit.service",
    "stop unit.service",
    "reset-failed unit.service"
  ]);
  assert.equal(bounded.released.length, 1, "the runtime receipt directory is released once the scope is empty");
  const unbounded = unresponsiveUnit();
  stopManagedExecution("unit.service", "execution", {}, unbounded.options);
  assert.ok(unbounded.killedAt() >= 15_000, "without a bound the helper keeps its 15 s limit");
});

// An agent service keeps its private home, configuration and data in its own
// receipt, so the Stop or release-ended that removes that receipt removes them
// too, even after the server that started it lost its handle.
test("a service's private directory lives in its receipt and is named to the unit", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-exec-private-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const targetUser = { gid: process.getgid(), uid: process.getuid() };
  const directory = path.join(root, "executions");
  const receipts = openManagedExecutionReceipts(directory, { ...targetUser, create: true, legacyUid: targetUser.uid });
  t.after(() => receipts.close());
  const [service, finite] = ["d", "e"].map((digit) => `${digit.repeat(8)}-0000-4000-8000-${digit.repeat(12)}`);
  const runnerCommand = async (executionId, options) => {
    receipts.create(executionId, targetUser, { args: [], command: "/bin/true", cwd: "/", env: { LANG: "C" }, executionId }, options);
    return JSON.parse(await readFile(path.join(directory, executionId, "command.json"), "utf8"));
  };

  const privateDirectory = path.join(directory, service, "private");
  assert.deepEqual((await runnerCommand(service, { privateDirectory: true })).env,
    { LANG: "C", VIBE64_EXECUTION_PRIVATE_DIR: privateDirectory });
  const created = await stat(privateDirectory);
  assert.deepEqual([created.isDirectory(), created.mode & 0o777, created.uid], [true, 0o700, targetUser.uid]);
  assert.deepEqual((await runnerCommand(finite)).env, { LANG: "C" });
  assert.deepEqual(await readdir(path.join(directory, finite)), ["command.json"]);
  assert.match(await helperSource(), /\}, \{ privateDirectory: mode === "detached" \}\);/u,
    "only detached executions, the services, get one");

  receipts.remove(service);
  assert.equal(existsSync(privateDirectory), false, "removing the receipt removes its private directory");
});

test("execution Stop of an ended unit only releases its receipt and failed record", () => {
  const ended = unresponsiveUnit({ initiallyEmpty: true });
  const result = stopManagedExecution("unit.service", "execution", {}, { termTimeoutMs: 3000, ...ended.options });
  assert.equal(result.scopeEmpty, true);
  assert.equal(result.stopped, false);
  assert.deepEqual(ended.commands.map(({ args }) => args.join(" ")), ["reset-failed unit.service"]);
  assert.deepEqual(ended.released, [0]);
});

test("execution Stop bounds are whole milliseconds up to the helper's limit", () => {
  assert.equal(managedExecutionStopTimeoutMs(undefined), 15_000);
  assert.equal(managedExecutionStopTimeoutMs(3000), 3000);
  assert.equal(managedExecutionStopTimeoutMs(30_000), 15_000);
  assert.equal(managedExecutionStopTimeoutMs(0), 0);
  for (const invalid of [-1, 1.5, "3000", Number.NaN]) {
    assert.throws(() => managedExecutionStopTimeoutMs(invalid), /invalid managed execution stop timeout/u);
  }
});

test("an inspection reports that the runner stopped its child because the controller went away", () => {
  const state = (receipt) => managedExecutionState(oomUnit, "execution", {}, {
    query: () => ({ stdout: "LoadState=loaded\nActiveState=failed\nResult=exit-code\nExecMainCode=1\nExecMainStatus=1\n" }),
    readResult: () => ({ executionId: "execution", execMainCode: "killed", execMainStatus: "SIGTERM", signal: "SIGTERM", ...receipt })
  });
  assert.equal(state({ controllerLeaseClosed: true }).controllerLeaseClosed, true);
  assert.equal(state({}).controllerLeaseClosed, false);
  assert.equal(state({ controllerLeaseClosed: "yes" }).controllerLeaseClosed, false);
});

test("a new execution never waits for another member of its work slice to stop", async () => {
  // Production: a cancelled OpenCode service ignored SIGTERM for its 30 s
  // TimeoutStopSec, and `systemctl start` on the already active work slice held
  // every new execution, including a GitHub access check, behind that stop.
  const source = await helperSource();
  const configure = source.slice(source.indexOf("function configureManagedExecutionWorkSlice("),
    source.indexOf("function managedWorkflowIdentity("));
  const check = configure.indexOf('["is-active", "--quiet", sliceName]');
  const start = configure.indexOf('["start", sliceName]');
  assert.ok(check > 0 && start > check, "the slice is started only after proving it inactive");
  assert.match(configure.slice(check, start), /status !== 0/u);
});

test("execution helper default PATH includes every first-class runtime pack", async () => {
  const source = await helperSource();

  assert.match(source, /\/opt\/vibe64\/runtime-packs\/operator-clis\/bin/u);
  assert.match(source, /\/opt\/vibe64\/runtime-packs\/node26\/bin/u);
  assert.match(source, /\/opt\/vibe64\/runtime-packs\/git\/bin/u);
  assert.match(source, /\/opt\/vibe64\/runtime-packs\/gh\/bin/u);
  assert.match(source, /\/opt\/vibe64\/runtime-packs\/mariadb\/bin/u);
  assert.match(source, /\/opt\/vibe64\/runtime-packs\/postgresql\/bin/u);
  assert.match(source, /PATH: DEFAULT_PATH/u);
});

test("execution helper gives release services the shared runtime PATH", async () => {
  const source = await helperSource();

  assert.match(source, /Environment=PATH=\$\{systemdUnitSafeValue\(DEFAULT_PATH\)\}/u);
  assert.match(source, /`ExecStart=\$\{systemdUnitSafeValue\(startScript\)\}`/u);
  assert.match(source, /StartLimitIntervalSec=60/u);
  assert.match(source, /StartLimitBurst=5/u);
  assert.match(source, /runRootCommandAllowFailure\("systemctl", \[\s*"reset-failed",\s*unitName/u);
});

test("execution helper gives daemon-owned services the shared primary group", async () => {
  const source = await helperSource();

  assert.match(source, /function serviceAccountUnitLines\(owner = \{\}\)/u);
  assert.equal(source.match(/\.\.\.serviceAccountUnitLines\(owner\)/gu)?.length, 2);
  assert.match(source, /`Group=\$\{VIBE64_GROUP\}`/u);
  assert.match(source, /"SupplementaryGroups=nix-users"/u);
  assert.match(source, /"UMask=0007"/u);
  assert.doesNotMatch(source, /`Group=\$\{systemdUnitSafeValue\(owner\.username\)\}`/u);
});

test("execution helper reports bounded release service diagnostics", async () => {
  const source = await helperSource();

  assert.match(source, /action === "inspect"/u);
  assert.match(source, /function inspectDeploymentServiceUnit/u);
  assert.match(source, /ActiveState,SubState,Result,ExecMainCode,ExecMainStatus,NRestarts/u);
  assert.match(source, /runRootCommandAllowFailure\("journalctl"/u);
  assert.match(source, /"--lines=80"/u);
});

test("execution helper gives release services explicit managed-service dependencies", async () => {
  const source = await helperSource();

  assert.match(source, /assertValidManagedServiceUnitName\(requiredUnit, owner\)/u);
  assert.match(source, /`After=\$\{\["network-online\.target", \.\.\.dependencies\]\.join\(" "\)\}`/u);
  assert.match(source, /`Requires=\$\{dependencies\.join\(" "\)\}`/u);
});

test("execution helper manages provider-neutral simple and forking services", async () => {
  const source = await helperSource();

  assert.match(source, /"managed-service"/u);
  assert.match(source, /function handleManagedServiceOperation/u);
  assert.match(source, /function assertValidManagedServiceProcessModel/u);
  assert.match(source, /function installSystemdUnit/u);
  assert.match(source, /const workspace = workspaceFromDaemonUsername\(username\)/u);
  assert.match(source, /processModel !== "forking" && processModel !== "simple"/u);
  assert.match(source, /normalizedProcessModel === "forking" \? \[`PIDFile=/u);
  assert.match(source, /Restart=on-failure/u);
  assert.match(source, /function ensureManagedServiceProcessOwnership/u);
  assert.match(source, /processUid !== owner\.uid/u);
  assert.match(source, /processBelongsToSystemdUnit\(pid, unitName\)/u);
  assert.match(source, /runRootCommandAllowFailure\("systemctl", \[\s*"stop",\s*unitName/u);
  assert.doesNotMatch(source, /function handleMariaDb|function handlePostgres|function handleRedis/u);
});

// A managed service runs only while its owner has a use for it: install-start
// starts it without a boot target, a release service that Requires= it starts
// it at boot, and Stop leaves it stopped and disabled with its data in place.
function managedServiceHost({ active = "active", enabled = "enabled", requiredBy = "", dependents = {} } = {}) {
  const commands = [];
  return {
    commands,
    query: (command, args) => {
      commands.push(args.join(" "));
      if (args[0] === "show") return { status: 0, stdout: `${requiredBy}\n` };
      if (args[0] === "is-active") {
        const state = args[1] === "db.service" ? active : dependents[args[1]] ?? "";
        return { status: state === "active" ? 0 : 3, stdout: `${state}\n` };
      }
      if (args[0] === "is-enabled") return { status: enabled === "enabled" ? 0 : 1, stdout: `${enabled}\n` };
      return { status: 0, stdout: "" };
    }
  };
}

test("managed service Stop stops and disables an unused service without touching its data", () => {
  const host = managedServiceHost({ requiredBy: "vibe64-release-a.service", dependents: { "vibe64-release-a.service": "inactive" } });
  assert.deepEqual(stopManagedServiceUnit("db.service", host), { ok: true, requiredBy: [], state: "stopped" });
  assert.deepEqual(host.commands, [
    "show db.service --property=RequiredBy --value",
    "is-active vibe64-release-a.service",
    "is-active db.service",
    "stop db.service",
    "is-enabled db.service",
    "disable db.service"
  ]);
});

test("managed service Stop of a stopped, disabled service changes nothing", () => {
  const host = managedServiceHost({ active: "inactive", enabled: "static" });
  assert.deepEqual(stopManagedServiceUnit("db.service", host), { ok: true, requiredBy: [], state: "inactive" });
  assert.deepEqual(host.commands, [
    "show db.service --property=RequiredBy --value",
    "is-active db.service",
    "is-enabled db.service"
  ]);
});

test("managed service Stop refuses while a running or unreadable unit requires the service", () => {
  for (const state of ["active", "activating", "deactivating", ""]) {
    const host = managedServiceHost({ requiredBy: "vibe64-release-a.service vibe64-release-b.service",
      dependents: { "vibe64-release-a.service": "failed", "vibe64-release-b.service": state } });
    assert.deepEqual(stopManagedServiceUnit("db.service", host),
      { ok: true, requiredBy: ["vibe64-release-b.service"], state: "required" }, state);
    assert.equal(host.commands.some((command) => /^(stop|disable) /u.test(command)), false,
      "systemd would stop the release with the service it requires");
  }
});

test("managed services have no boot target; install-start no longer enables them", async () => {
  const source = await helperSource();
  const managed = source.slice(source.indexOf("function managedServiceUnit("), source.indexOf("function systemdUnitSafeValue("));
  assert.doesNotMatch(managed, /\[Install\]|WantedBy=/u);
  const operation = source.slice(source.indexOf("function handleManagedServiceOperation("),
    source.indexOf("function ensureManagedServiceProcessOwnership("));
  assert.match(operation, /action === "stop"/u);
  assert.match(operation, /enable: false/u);
  const release = source.slice(source.indexOf("function deploymentServiceUnit("), source.indexOf("function managedServiceUnit("));
  assert.match(release, /WantedBy=multi-user\.target/u, "release services still start at boot and pull in their databases");
});

test("execution helper rejects payloads that did not pass gateway normalization", async () => {
  const source = await helperSource();

  assert.match(source, /const EXEC_HELPER_PAYLOAD_SCHEMA = "vibe64\.exec-helper\.payload"/u);
  assert.match(source, /function assertNormalizedPayload/u);
  assert.match(source, /Vibe64 exec helper rejected a non-normalized execution payload/u);
});

test("execution helper lets account and GitHub API commands run from the target user home", async () => {
  const source = await helperSource();

  assert.match(source, /operation === "account-auth-terminal" \|\|\s+operation === "account-status" \|\|\s+operation === "github-api-command"/u);
  assert.match(source, /return resolveAllowedUserHomePath\(normalized, targetUser\)/u);
});

test("execution helper admits hosted project state only for the daemon's own generic commands", async () => {
  const source = await helperSource();

  assert.match(source, /operation === "vibe64-command" &&\s+targetUser\.username === ownerUsername/u);
  assert.match(source, /const ownerProjectStateRoot = path\.join\(\s+targetUser\.home,\s+"\.local",\s+"state",\s+"vibe64",\s+"projects"/u);
  assert.match(source, /const stateRoot = canonicalPath\(ownerProjectStateRoot\)/u);
});

test("execution helper runs platform health checks from the workspace temp root", async () => {
  const source = await helperSource();

  assert.match(source, /operation === "health-status"/u);
  assert.match(source, /return workspaceTempRoot\(ownerUsername\)/u);
});

test("execution helper limits assistant services outside projects to their exact private workspaces", async () => {
  const source = await helperSource();

  assert.match(source, /"codex-app-server"/u);
  assert.match(source, /"opencode-app-server"/u);
  assert.match(source, /operation === "codex-app-server"/u);
  assert.match(source, /operation === "opencode-app-server"/u);
  assert.match(source, /const runtimeBases = \[managedExecutionRuntimeBase\(\{ username: ownerUsername \}\)\]/u);
  assert.match(source, /runtimeBases\.push\(path\.join\("\/run\/user", String\(targetUid\)\)\)/u);
  assert.match(source, /for \(const runtimeBase of runtimeBases\)/u);
  assert.match(source, /path\.join\(runtimeBase, "vibe64", "agent-providers"\)/u);
  assert.match(source, /providerRoot === "codex-app-server"/u);
  assert.match(source, /providerRoot === "opencode"/u);
  assert.match(source, /\^codex-app-server-\[a-f0-9\]\{12\}\$/u);
  assert.match(source, /operation === "codex-app-server" && parts\.length === 1/u);
  assert.match(source, /parts\.length === 2/u);
  assert.match(source, /parts\[1\] === "workspace"/u);
});

test("execution helper limits release service paths to deployment release state", async () => {
  const source = await helperSource();

  assert.match(source, /assertSafeDeploymentServicePath\(payload\.workingDirectory, owner, "workingDirectory"\)/u);
  assert.match(source, /function pathIsDeploymentReleasePath/u);
  assert.match(source, /parts\[1\] === "deployments"/u);
  assert.match(source, /parts\[2\] === "releases"/u);
  assert.match(source, /parts\[4\] === "artifact" \|\| parts\[4\] === "service"/u);
  assert.doesNotMatch(source, /resolveAllowedProjectPath\(candidatePath, ownerUsername\)/u);
});

test("execution helper uses runuser instead of direct initgroups setuid flow", async () => {
  const source = await helperSource();

  assert.match(source, /spawnSync\("\/usr\/bin\/setpriv", \[\n {4}"--no-new-privs", "--", "\/usr\/sbin\/runuser",/u);
  assert.doesNotMatch(source, /process\.initgroups/u);
  assert.doesNotMatch(source, /process\.setuid/u);
  assert.doesNotMatch(source, /process\.setgid/u);
});

test("execution helper creates collaborative files instead of repairing them later", async () => {
  const source = await helperSource();

  assert.match(source, /assertInGroup = assertUserInGroup[\s\S]+assertInGroup\(targetUser\.username, VIBE64_GROUP\)/u);
  assert.match(source, /process\.umask\(0o007\)/u);
  assert.doesNotMatch(source, /repair-managed-project-permissions/u);
  assert.doesNotMatch(source, /handleManagedProjectPermissionRepair/u);
});

test("execution helper centrally assigns the shared workspace TMPDIR", async () => {
  const source = await helperSource();

  assert.match(source, /const MANAGED_ROOT = "\/var\/lib\/vibe64"/u);
  assert.match(source, /helperChildEnv\(payload\.env \|\| \{\}, targetUser, owner\.username, operation\)/u);
  assert.match(source, /helperChildEnv\(payload\.env \|\| \{\}, targetUser, owner\.username, commandOperation\)/u);
  assert.match(source, /env\.TMPDIR = workspaceTempRoot\(ownerUsername\)/u);
  assert.equal(
    source.match(/Environment=TMPDIR=\$\{systemdUnitSafeValue\(workspaceTempRoot\(owner\.username\)\)\}/gu)?.length,
    2
  );
  assert.doesNotMatch(source, /actorTemp|FLOCK_PATH|mkdtemp/u);
});

test("execution helper preserves only OpenCode private environment roots", async () => {
  const source = await helperSource();

  assert.match(source, /operation === "opencode-app-server"/u);
  assert.match(source, /managedExecutionRuntimeBase\(\{ username: ownerUsername \}\)[\s\S]+"agent-providers",[\s\S]+"opencode"/u);
  for (const name of [
    "HOME",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME"
  ]) {
    assert.match(source, new RegExp(`"${name}"`, "u"));
  }
  assert.match(source, /!path\.isAbsolute\(requested\) \|\| relativePathParts\(providerRoot, requested\)\.length === 0/u);
  assert.match(source, /rejected OpenCode \$\{name\} outside its provider runtime/u);
});

test("managed executions can traverse their private workspace runtime directory", async () => {
  const source = await helperSource();

  assert.match(source, /openWorkspaceExecutionReceipts\(owner, \{ create: true, gid: groupId \}\)/u);
  assert.match(source, /function managedExecutionRuntimeBase\(owner = \{\}\)/u);
  assert.match(source, /ensureWorkspaceRuntimeBase\(runtimeBase, \{ gid, uid: owner\.uid \}\)/u);
  assert.match(source, /fchmodSync\(descriptor, 0o2750\)/u);
});

// The workspace's receipt directory sits in its daemon's runtime directory,
// which the daemon can rearrange. Whatever link it plants there, root neither
// follows it nor writes to, re-modes or re-owns the link's target.
test("execution receipts follow no planted link and never touch its target", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-exec-receipts-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  // A group this process may give its own files, so a group change shows.
  const otherGroup = process.getgroups().find((gid) => gid !== process.getgid()) ?? process.getgid();
  const ids = { gid: otherGroup, legacyUid: process.getuid(), uid: process.getuid() };
  const targetUser = { gid: otherGroup, uid: process.getuid() };
  const [planted, fresh, later] = ["a", "b", "c"].map((digit) => `${digit.repeat(8)}-0000-4000-8000-${digit.repeat(12)}`);
  const command = (executionId) => ({ args: [], command: "/bin/true", cwd: "/", env: {}, executionId });
  const victim = path.join(root, "victim");
  await mkdir(victim, { mode: 0o755 });
  const before = await stat(victim);
  const untouched = async () => {
    const after = await stat(victim);
    assert.deepEqual([after.mode, after.uid, after.gid], [before.mode, before.uid, before.gid], "the link's target keeps its mode and owner");
    assert.deepEqual(await readdir(victim), [], "nothing is written through the link");
  };

  // A link in place of the receipt directory.
  await mkdir(path.join(root, "linked"));
  await symlink(victim, path.join(root, "linked", "executions"));
  assert.throws(() => openManagedExecutionReceipts(path.join(root, "linked", "executions"), { ...ids, create: true }));
  await untouched();

  // A link in place of one receipt.
  const directory = path.join(root, "executions");
  const receipts = openManagedExecutionReceipts(directory, { ...ids, create: true });
  t.after(() => receipts.close());
  await symlink(victim, path.join(directory, planted));
  assert.throws(() => receipts.create(planted, targetUser, command(planted)), { code: "EEXIST" });
  await untouched();
  receipts.remove(planted);
  await untouched();
  assert.deepEqual(await readdir(directory), [], "removing that receipt removes only the link");

  receipts.create(fresh, targetUser, command(fresh));
  const created = await stat(path.join(directory, fresh));
  const runnerCommand = path.join(directory, fresh, "command.json");
  assert.deepEqual([created.mode & 0o777, created.gid], [0o700, otherGroup]);
  assert.deepEqual([(await stat(runnerCommand)).mode & 0o777, (await stat(runnerCommand)).gid], [0o600, otherGroup]);
  assert.equal(JSON.parse(await readFile(runnerCommand, "utf8")).executionId, fresh);
  assert.deepEqual([(await stat(directory)).mode & 0o777, (await stat(directory)).gid], [0o750, otherGroup]);

  // The path is replaced by a link after root opened the directory.
  await rename(directory, path.join(root, "moved"));
  await symlink(victim, directory);
  receipts.create(later, targetUser, command(later));
  await untouched();
  assert.ok(existsSync(path.join(root, "moved", later, "command.json")), "root keeps working in the directory it opened");

  // A directory someone else owns is refused.
  assert.throws(() => openManagedExecutionReceipts(path.join(root, "moved"), { ...ids, legacyUid: 0, uid: 0 }), /owned by another user/u);
});

test("runtime pack lists stay in step: interactive order and the helper PATH cover every pack", () => {
  assert.deepEqual([...VIBE64_INTERACTIVE_RUNTIME_PACKS].sort(), Object.keys(RUNTIME_PACKS).sort());

  // The helper's own PATH names the pack folder; public tests must not.
  const packMarker = "/runtime-packs/";
  const helperPackDirs = helperChildEnv({}, { home: "/home/alice", username: "alice" }, daemonUser("alice"), "command")
    .PATH.split(":")
    .filter((entry) => entry.includes(packMarker))
    .map((entry) => entry.slice(entry.indexOf(packMarker) + packMarker.length));
  const packBinDirs = new Set(Object.values(RUNTIME_PACKS).flatMap((pack) => pack.binDirs));
  for (const dir of helperPackDirs) {
    assert.ok(packBinDirs.has(dir) || dir === "policy-bin" || dir === "guard-bin", `unknown helper PATH entry ${dir}`);
  }
  for (const [runtime, pack] of Object.entries(RUNTIME_PACKS)) {
    assert.ok(pack.binDirs.some((dir) => helperPackDirs.includes(dir)), `helper PATH misses runtime ${runtime}`);
  }
});

test("a starting controller releases every receipt and failed unit record except those it owns or that still run", () => {
  const owner = { username: daemonUser("test") };
  const id = (digit) => `${digit.repeat(8)}-0000-4000-8000-00000000000${digit}`;
  const unit = (executionId) => `vibe64-exec-test-${executionId.replaceAll("-", "")}.service`;
  const [owned, running, failed, collected, orphanFailed] = ["a", "b", "c", "d", "e"].map(id);
  const removed = [];
  const reset = [];
  let closed = 0;
  const options = (status = 0) => ({
    listUnits: () => ({ status, stdout: [
      `${unit(owned)} loaded failed failed Vibe64 job execution`,
      `${unit(running)} loaded active running Vibe64 job execution`,
      `${unit(failed)} loaded failed failed Vibe64 job execution`,
      `${unit(orphanFailed)} loaded failed failed Vibe64 job execution`
    ].join("\n") }),
    openReceipts: () => ({
      close: () => { closed += 1; },
      entries: () => [owned, running, failed, collected, "not-an-execution", owned.toUpperCase()],
      remove: (executionId) => removed.push(executionId)
    }),
    resetFailed: (unitNames) => reset.push(...unitNames)
  });
  assert.throws(() => releaseEndedManagedExecutions(owner, [owned], options(1)), /could not list/u);
  assert.deepEqual([removed, reset], [[], []], "an unproven unit inventory releases nothing");
  assert.throws(() => releaseEndedManagedExecutions(owner, "all", options()), /bounded list/u);

  assert.deepEqual(releaseEndedManagedExecutions(owner, [owned], options()), { ok: true, released: 2, reset: 2 });
  assert.deepEqual(removed, [failed, collected], "the owned receipt and the running unit's are kept");
  assert.equal(closed, 1, "the receipt directory is opened once and closed");
  assert.deepEqual(reset, [unit(failed), unit(orphanFailed)], "the owned failed unit keeps its record");
});

// Root reads these files from directories the daemon or an execution's target
// user can rearrange. Whatever they plant there, root reads only their own
// regular file, never waits on it, never echoes it and never removes anything
// outside that directory.
const SECRET = "root:$y$j9T$secret-hash-0123456789:19000:0:99999:7:::\n";
const DEAD_PID = "2147483646";
const echoesNothing = (error) => !String(error?.message).includes("secret-hash") && !String(error?.message).includes("root:");

async function plantedRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-exec-reads-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const victim = path.join(root, "victim");
  await mkdir(victim);
  await writeFile(path.join(victim, "secret"), SECRET);
  return { root, victim };
}

// A read that waits on a FIFO would stall this whole test process, so those run
// in a child process stopped after a bound.
function helperInChild(expression, input) {
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const helper = await import(${JSON.stringify(HELPER_SOURCE_URL.href)});
    const input = JSON.parse(process.argv[1]);
    try { process.stdout.write(JSON.stringify({ value: await (${expression}) ?? null })); }
    catch (error) { process.stdout.write(JSON.stringify({ error: String(error?.message || error) })); }
  `, JSON.stringify(input)], { encoding: "utf8", timeout: 5000 });
  assert.equal(child.signal, null, "the read returned instead of waiting on the FIFO");
  return JSON.parse(child.stdout);
}

test("a payload file is read only as the daemon's regular file in its workspace payload directory", async (t) => {
  const { root, victim } = await plantedRoot(t);
  const owner = { uid: process.getuid(), username: daemonUser("test") };
  const consume = (file, as = owner) => consumeManagedExecutionRequestPayload(file, as, { managedRoot: root });
  const directory = path.join(root, "test", "tmp", "managed-execution-payloads");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const payload = { operation: "managed-execution", schema: "vibe64.exec-helper.payload", schemaVersion: 1 };

  await writeFile(path.join(directory, "a.json"), JSON.stringify(payload));
  assert.deepEqual(consume(path.join(directory, "a.json")), payload);
  assert.equal(existsSync(path.join(directory, "a.json")), false, "the payload is consumed");

  for (const elsewhere of [path.join(victim, "secret"), path.join(directory, "..", "..", "..", "victim", "secret"),
    `${directory}/./b.json`, `${directory}/.hidden`]) {
    assert.throws(() => consume(elsewhere), (error) => echoesNothing(error) && /unsafe managed execution payload path/u.test(error.message));
  }
  await writeFile(path.join(directory, "not-json.json"), SECRET);
  assert.throws(() => consume(path.join(directory, "not-json.json")), echoesNothing);
  await symlink(path.join(victim, "secret"), path.join(directory, "linked.json"));
  assert.throws(() => consume(path.join(directory, "linked.json")), echoesNothing);
  await writeFile(path.join(directory, "large.json"), " ".repeat(1024 * 1024 + 1));
  assert.throws(() => consume(path.join(directory, "large.json")), /too large/u);
  await writeFile(path.join(directory, "other.json"), JSON.stringify(payload));
  assert.throws(() => consume(path.join(directory, "other.json"), { ...owner, uid: owner.uid + 1 }));
  assert.equal(existsSync(path.join(directory, "other.json")), true, "another user's file is left in place");
  execFileSync("mkfifo", [path.join(directory, "fifo.json")]);
  assert.ok(helperInChild("helper.consumeManagedExecutionRequestPayload(input.file, input.owner, { managedRoot: input.root })",
    { file: path.join(directory, "fifo.json"), owner, root }).error);

  // A link in place of the payload directory: the target's file of that name
  // is neither read nor removed.
  await writeFile(path.join(victim, "payload.json"), JSON.stringify(payload));
  await rename(directory, `${directory}.real`);
  await symlink(victim, directory);
  assert.throws(() => consume(path.join(directory, "payload.json")));
  assert.equal(await readFile(path.join(victim, "payload.json"), "utf8"), JSON.stringify(payload));
  assert.equal(await readFile(path.join(victim, "secret"), "utf8"), SECRET);
});

test("the helper reads no payload file outside its workspace payload directory", async (t) => {
  const { root, victim } = await plantedRoot(t);
  const fifo = path.join(root, "fifo");
  execFileSync("mkfifo", [fifo]);
  const helperPath = new URL(HELPER_SOURCE_URL).pathname;
  const run = (...args) => spawnSync(process.execPath, [helperPath, "execute", ...args], {
    encoding: "utf8", env: { ...process.env, SUDO_USER: os.userInfo().username }, timeout: 5000
  });
  for (const args of [[path.join(victim, "secret")], [fifo], [path.join(victim, "secret"), "extra"]]) {
    const result = run(...args);
    assert.equal(result.signal, null, `the helper returned for ${args.join(" ")}`);
    assert.equal(result.status, 2);
    assert.ok(echoesNothing({ message: result.stderr }), result.stderr);
  }
  assert.equal(await readFile(path.join(victim, "secret"), "utf8"), SECRET);
});

test("a user's Vibe64 membership is read only as the daemon's regular file", async (t) => {
  const { root, victim } = await plantedRoot(t);
  const home = path.join(root, "home");
  const users = path.join(home, ".local", "state", "vibe64", "users");
  await mkdir(users, { recursive: true });
  const owner = { home, uid: process.getuid(), username: daemonUser("test") };
  const active = (username) => JSON.stringify({ status: "active", username });
  await writeFile(path.join(users, "alice.json"), active("alice"));
  await writeFile(path.join(users, "bob.json"), JSON.stringify({ status: "disabled", username: "bob" }));
  await writeFile(path.join(users, "erin.json"), SECRET);
  await symlink(path.join(victim, "secret"), path.join(users, "carol.json"));

  assert.doesNotThrow(() => assertEnabledForVibe64(owner, "alice"));
  for (const username of ["bob", "carol", "erin", "frank"]) {
    assert.throws(() => assertEnabledForVibe64(owner, username), (error) => echoesNothing(error) && /not enabled/u.test(error.message));
  }
  assert.throws(() => assertEnabledForVibe64({ ...owner, uid: owner.uid + 1 }, "alice"), /not enabled/u);
  execFileSync("mkfifo", [path.join(users, "gina.json")]);
  assert.match(helperInChild("helper.assertEnabledForVibe64(input.owner, 'gina')", { owner }).error, /not enabled/u);

  // A link in place of the membership directory.
  await writeFile(path.join(victim, "dave.json"), active("dave"));
  await rename(users, `${users}.real`);
  await symlink(victim, users);
  assert.throws(() => assertEnabledForVibe64(owner, "dave"), /not enabled/u);
});

test("a managed service PID file is read and removed only through its own directory", async (t) => {
  const { root, victim } = await plantedRoot(t);
  const workspaceRoot = path.join(root, "test");
  const run = path.join(workspaceRoot, "services", "db", "run");
  await mkdir(run, { recursive: true });
  const owner = { uid: process.getuid(), username: daemonUser("test") };
  const ensure = (pidFile) => ensureManagedServiceProcessOwnership({ owner, pidFile, unitName: "vibe64-test-db.service", workspaceRoot });

  await writeFile(path.join(run, "db.pid"), `${DEAD_PID}\n`);
  ensure(path.join(run, "db.pid"));
  assert.equal(existsSync(path.join(run, "db.pid")), false, "a stale PID file is removed");
  assert.doesNotThrow(() => ensure(path.join(workspaceRoot, "services", "other", "run", "db.pid")), "a missing directory has nothing to remove");

  await writeFile(path.join(victim, "db.pid"), `${DEAD_PID}\n`);
  await symlink(path.join(victim, "db.pid"), path.join(run, "db.pid"));
  assert.throws(() => ensure(path.join(run, "db.pid")));
  await rm(path.join(run, "db.pid"));
  execFileSync("mkfifo", [path.join(run, "db.pid")]);
  assert.ok(helperInChild("helper.ensureManagedServiceProcessOwnership(input)",
    { owner, pidFile: path.join(run, "db.pid"), unitName: "vibe64-test-db.service", workspaceRoot }).error);

  // A link in place of the PID file's directory after its path was checked.
  await rename(run, `${run}.real`);
  await symlink(victim, run);
  assert.throws(() => ensure(path.join(run, "db.pid")));
  assert.equal(await readFile(path.join(victim, "db.pid"), "utf8"), `${DEAD_PID}\n`, "the link target's PID file stays");
});

test("an execution's result is read only as its target user's regular file in its receipt", async (t) => {
  const { root, victim } = await plantedRoot(t);
  const directory = path.join(root, "executions");
  const ids = { gid: process.getgid(), legacyUid: process.getuid(), uid: process.getuid() };
  const receipts = openManagedExecutionReceipts(directory, { ...ids, create: true });
  t.after(() => receipts.close());
  const [written, linked, large, fifo] = ["a", "b", "c", "d"].map((digit) => `${digit.repeat(8)}-0000-4000-8000-${digit.repeat(12)}`);
  const result = (executionId) => ({ executionId, execMainStatus: "7", schema: "vibe64.managed-execution.result", schemaVersion: 1 });
  for (const executionId of [written, linked, large, fifo]) {
    receipts.create(executionId, { gid: ids.gid, uid: ids.uid }, { args: [], command: "/bin/true", cwd: "/", env: {}, executionId });
  }

  await writeFile(path.join(directory, written, "result.json"), JSON.stringify(result(written)));
  assert.deepEqual(receipts.result(written), result(written));
  await writeFile(path.join(victim, "result.json"), JSON.stringify(result(linked)));
  await symlink(path.join(victim, "result.json"), path.join(directory, linked, "result.json"));
  assert.deepEqual(receipts.result(linked), {}, "a link is not followed");
  await writeFile(path.join(directory, large, "result.json"), JSON.stringify({ ...result(large), padding: " ".repeat(256 * 1024) }));
  assert.deepEqual(receipts.result(large), {}, "an oversized result is not read");
  assert.deepEqual(receipts.result(`${"e".repeat(8)}-0000-4000-8000-${"e".repeat(12)}`), {}, "a missing receipt has no result");
  execFileSync("mkfifo", [path.join(directory, fifo, "result.json")]);
  assert.deepEqual(helperInChild(`(() => {
    const receipts = helper.openManagedExecutionReceipts(input.directory, input.ids);
    try { return receipts.result(input.fifo); } finally { receipts.close(); }
  })()`, { directory, fifo, ids }).value, {});
});

// Release environment files keep systemd's EnvironmentFile= syntax, but the
// service's own user loads them, so root never reads one.
test("release environment files are parsed with systemd's EnvironmentFile= rules", () => {
  const text = [
    "# comment", "; comment", "",
    'QUOTED="a\\"b\\\\c\\nd\\$e"',
    "SINGLE='lit $x \\\\n'",
    "  SPACED =  value with spaces  ",
    "ESCAPED=un\\ quoted",
    'JOINED="multi\\', 'line"',
    "EMPTY=",
    "1INVALID=x", "NOEQUALS", "LAST=end"
  ].join("\n");
  assert.deepEqual(parseEnvironmentFile(text), {
    EMPTY: "", ESCAPED: "un quoted", JOINED: "multiline", LAST: "end",
    QUOTED: 'a"b\\c\\nd$e', SINGLE: "lit $x \\\\n", SPACED: "value with spaces"
  });
});

test("a release service unit loads its environment as its user, then becomes its start script", async (t) => {
  const unit = deploymentServiceUnit({
    environmentFile: "/release/service/environment", helperPath: "/helper/vibe64-exec-helper",
    owner: { username: daemonUser("test") }, requiredUnits: [], startScript: "/release/service/start.sh",
    unitName: "vibe64-release-test.service", workingDirectory: "/release/workspace"
  });
  assert.doesNotMatch(unit, /^EnvironmentFile=/mu, "systemd does not read the environment file as root");
  assert.match(unit, /^ExecStart=\/helper\/vibe64-exec-helper run-release-service "\/release\/service\/environment" "\/release\/service\/start\.sh"$/mu);

  const root = await mkdtemp(path.join(os.tmpdir(), "v64-release-service-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const environmentFile = path.join(root, "environment");
  const startScript = path.join(root, "start.sh");
  await writeFile(environmentFile, 'RELEASE_TEST_KEY="from-file"\nPORT="4100"\n', { mode: 0o600 });
  await writeFile(startScript, '#!/bin/sh\nprintf "%s %s %s %s" "$$" "$RELEASE_TEST_KEY" "$PORT" "$KEPT"\n', { mode: 0o700 });
  const child = spawn(process.execPath, [new URL(HELPER_SOURCE_URL).pathname, "run-release-service", environmentFile, startScript], {
    env: { KEPT: "unit-environment", PATH: "/usr/bin:/bin", PORT: "1" }, stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  const status = await new Promise((resolve) => child.once("close", resolve));
  assert.equal(status, 0);
  assert.equal(output, `${child.pid} from-file 4100 unit-environment`, "the helper's process became the start script, with the file's values over the unit's");
});

test("host installation rewrites release units written by the old helper, then reloads systemd once", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "v64-release-units-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const helperPath = "/helper/vibe64-exec-helper";
  const current = deploymentServiceUnit({
    environmentFile: "/release/service/environment", helperPath,
    owner: { username: daemonUser("test") }, requiredUnits: ["vibe64-db-test.service"], startScript: "/release/service/start.sh",
    unitName: "vibe64-release-test.service", workingDirectory: "/release/workspace"
  });
  // The old helper wrote the same unit, with systemd reading the environment
  // file and ExecStart= naming the start script itself.
  const old = current
    .replace(/^(WorkingDirectory=.*)$/mu, "$1\nEnvironmentFile=/release/service/environment")
    .replace(/^ExecStart=.*$/mu, "ExecStart=/release/service/start.sh");
  const unrelated = "[Service]\nEnvironmentFile=/other/environment\nExecStart=/other/start.sh\n";
  await writeFile(path.join(directory, "vibe64-release-test.service"), old, { mode: 0o644 });
  await writeFile(path.join(directory, "vibe64-release-current.service"), current, { mode: 0o644 });
  await writeFile(path.join(directory, "vibe64-managed-other.service"), unrelated, { mode: 0o644 });
  await writeFile(path.join(directory, "elsewhere"), old, { mode: 0o644 });
  await symlink(path.join(directory, "elsewhere"), path.join(directory, "vibe64-release-link.service"));
  let reloads = 0;
  const upgrade = () => upgradeReleaseServiceUnits({ helperPath, reload: () => { reloads += 1; }, unitDirectory: directory });

  upgrade();
  assert.equal(await readFile(path.join(directory, "vibe64-release-test.service"), "utf8"), current,
    "the old unit is now exactly what the current helper writes");
  assert.equal((await stat(path.join(directory, "vibe64-release-test.service"))).mode & 0o777, 0o644);
  assert.equal(await readFile(path.join(directory, "vibe64-release-current.service"), "utf8"), current);
  assert.equal(await readFile(path.join(directory, "vibe64-managed-other.service"), "utf8"), unrelated);
  assert.equal(await readFile(path.join(directory, "elsewhere"), "utf8"), old, "a link is never followed");
  assert.deepEqual((await readdir(directory)).sort(), ["elsewhere", "vibe64-managed-other.service",
    "vibe64-release-current.service", "vibe64-release-link.service", "vibe64-release-test.service"]);
  assert.equal(reloads, 1);

  upgrade();
  assert.equal(reloads, 1, "nothing left to rewrite, so systemd is not reloaded again");
});
