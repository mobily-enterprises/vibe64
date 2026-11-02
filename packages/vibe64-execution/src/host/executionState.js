// A managed execution's state, measurements and limit evidence, and stopping and releasing executions.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { MANAGED_EXECUTION_ID_PATTERN, managedExecutionId, managedExecutionUnitName } from "./executionIdentity.js";
import { openAllExecutionReceipts, readManagedExecutionResult } from "./executionReceipts.js";
import { runRootCommandAllowFailure, safeUsername, workspaceFromDaemonUsername } from "./hostAccounts.js";
import { knownCounter, managedWorkflowCounters } from "./managedWorkflows.js";

const MANAGED_EXECUTION_STOP_TIMEOUT_MS = 15_000;
const MANAGED_EXECUTION_RELEASE_KEEP_MAX = 4096;

function managedRunnerCgroupMeasurements() {
  const membership = String(readFileSync("/proc/self/cgroup", "utf8") || "")
    .split("\n")
    .find((line) => line.startsWith("0::"));
  const relative = String(membership || "").slice(3).replace(/^\/+/, "");
  const cgroupPath = relative ? path.join("/sys/fs/cgroup", relative) : "";
  if (!cgroupPath || !existsSync(cgroupPath)) {
    return {};
  }
  const cpu = cgroupKeyValues(path.join(cgroupPath, "cpu.stat"));
  const memoryEvents = cgroupKeyValues(path.join(cgroupPath, "memory.events"));
  const io = cgroupIoTotals(path.join(cgroupPath, "io.stat"));
  return {
    resourceCounters: managedWorkflowCounters(cgroupPath),
    cpuUsageNSec: String(Number(cpu.usage_usec || 0) * 1000),
    ioReadBytes: String(io.readBytes),
    ioWriteBytes: String(io.writeBytes),
    memoryCurrent: cgroupSingleValue(path.join(cgroupPath, "memory.current")),
    memoryPeak: cgroupSingleValue(path.join(cgroupPath, "memory.peak")),
    memorySwapCurrent: cgroupSingleValue(path.join(cgroupPath, "memory.swap.current")),
    oomKillCount: String(Number(memoryEvents.oom_kill || 0)),
    taskLimit: managedExecutionTaskLimitCounters(cgroupPath),
    tasksCurrent: cgroupSingleValue(path.join(cgroupPath, "pids.current")),
    tasksPeak: cgroupSingleValue(path.join(cgroupPath, "pids.peak"))
  };
}

function cgroupSingleValue(filePath = "") {
  try {
    const value = String(readFileSync(filePath, "utf8") || "0").trim();
    return /^[0-9]+$/u.test(value) ? value : "0";
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "0";
    }
    throw error;
  }
}

function managedExecutionTaskLimitCounters(cgroupPath, read = readFileSync) {
  if (!cgroupPath) return null;
  try {
    const counter = (name) => {
      try { return knownCounter(/^max\s+(\d+)$/mu.exec(read(path.join(cgroupPath, name), "utf8"))?.[1]); }
      catch { return null; }
    };
    const local = counter("pids.events.local");
    const total = counter("pids.events");
    const count = local > 0 ? local : total;
    if (!(count > 0)) return null;
    // With pids_localevents, "max" counts originating fork failures, not
    // enforcement at this boundary. Never attribute those to this group's cap.
    const mount = read("/proc/self/mountinfo", "utf8").split("\n").find((line) =>
      line.split(" ")[4] === "/sys/fs/cgroup" && line.includes(" - cgroup2 "));
    return { source: "cgroup-pids-events", count,
      scope: local > 0 && mount && !mount.split(/[ ,]/u).includes("pids_localevents") ? "execution" : "unknown" };
  } catch { return null; } // Diagnostics must not prevent exit/cleanup recording.
}

function cgroupKeyValues(filePath = "") {
  try {
    return Object.fromEntries(String(readFileSync(filePath, "utf8") || "")
      .split(/\r?\n/u)
      .flatMap((line) => {
        const [key, value] = line.trim().split(/\s+/u);
        return key && /^[0-9]+$/u.test(value || "") ? [[key, value]] : [];
      }));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function cgroupIoTotals(filePath = "") {
  let text = "";
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { readBytes: 0, writeBytes: 0 };
    }
    throw error;
  }
  let readBytes = 0;
  let writeBytes = 0;
  for (const line of String(text || "").split(/\r?\n/u)) {
    for (const field of line.trim().split(/\s+/u).slice(1)) {
      const [key, value] = field.split("=");
      if (key === "rbytes") readBytes += Number(value || 0);
      if (key === "wbytes") writeBytes += Number(value || 0);
    }
  }
  return { readBytes, writeBytes };
}

function managedExecutionState(unitName = "", executionId = "", owner = {}, {
  query = runRootCommandAllowFailure,
  readResult = readManagedExecutionResult
} = {}) {
  const stateResult = query("systemctl", [
    "show",
    unitName,
    "--no-pager",
    "--timestamp=us+utc",
    "--property=LoadState,ActiveState,SubState,Result,ExecMainCode,ExecMainStatus,ExecMainStartTimestamp,ExecMainExitTimestamp,MainPID,ControlGroup,MemoryCurrent,MemoryPeak,MemorySwapCurrent,TasksCurrent,TasksMax,CPUUsageNSec,IOReadBytes,IOWriteBytes"
  ]);
  let values = {};
  for (const line of String(stateResult.stdout || "").split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    if (separator > 0) {
      values[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  // systemctl supplies defaults even for a collected transient unit. They
  // describe no execution and must not replace the runner's saved receipt.
  if (values.LoadState === "not-found") {
    values = { LoadState: "not-found" };
  }
  const controlGroup = String(values.ControlGroup || "").trim();
  const cgroupPath = controlGroup
    ? path.join("/sys/fs/cgroup", controlGroup.replace(/^\/+/, ""))
    : "";
  const counters = managedWorkflowCounters(cgroupPath);
  // Delegated services can put every process in child groups. Only the
  // hierarchical populated counter proves the whole execution empty.
  const scopeEmpty = cgroupPath && existsSync(cgroupPath) ? counters.scopeEmpty : true;
  const recorded = executionId ? readResult(owner, executionId) : {};
  // Prefer the runner's child-exit observation to the later wrapper exit.
  // systemd still supplies evidence if OOM killed the runner before its receipt.
  const runnerExit = Date.parse(recorded.exitObservedAt || "");
  const exitTimeSource = Number.isFinite(runnerExit) ? "runner" : "systemd";
  const exitTime = Number.isFinite(runnerExit) ? runnerExit : Date.parse(values.ExecMainExitTimestamp || "");
  const exitObservedAt = Number.isFinite(exitTime) && exitTime > 0 && exitTime <= Date.now()
    ? new Date(exitTime).toISOString() : "";
  return {
    resourceCounters: recorded.resourceCounters || counters,
    activeState: String(values.ActiveState || (recorded.executionId ? "inactive" : "unknown")),
    controlGroup,
    cpuUsageNSec: maximumCounter(values.CPUUsageNSec, recorded.cpuUsageNSec),
    execMainCode: String(values.ExecMainCode || recorded.execMainCode || ""),
    execMainStatus: String(values.ExecMainStatus || recorded.execMainStatus || ""),
    exitObservedAt,
    exitTimeSource: exitObservedAt ? exitTimeSource : "",
    ioReadBytes: maximumCounter(values.IOReadBytes, recorded.ioReadBytes),
    ioWriteBytes: maximumCounter(values.IOWriteBytes, recorded.ioWriteBytes),
    loadState: String(
      values.LoadState && values.LoadState !== "not-found"
        ? values.LoadState
        : recorded.executionId
          ? "recorded"
          : "not-found"
    ),
    mainPid: String(values.MainPID || "0"),
    memoryCurrent: maximumCounter(values.MemoryCurrent, recorded.memoryCurrent),
    memoryPeak: maximumCounter(values.MemoryPeak, recorded.memoryPeak),
    memorySwapCurrent: maximumCounter(values.MemorySwapCurrent, recorded.memorySwapCurrent),
    oomKillCount: maximumCounter(recorded.oomKillCount),
    taskLimit: recorded.taskLimit || managedExecutionTaskLimitCounters(cgroupPath),
    result: String(values.Result || recorded.result || ""),
    signal: String(recorded.signal || ""),
    controllerLeaseClosed: recorded.controllerLeaseClosed === true,
    scopeEmpty,
    startedAt: values.ExecMainStartTimestamp || recorded.startedAt || "",
    subState: String(values.SubState || "unknown"),
    tasksCurrent: maximumCounter(values.TasksCurrent, recorded.tasksCurrent),
    tasksPeak: maximumCounter(recorded.tasksPeak),
    tasksMax: String(values.TasksMax || "0"),
    unitName
  };
}

function maximumCounter(...values) {
  return String(values.reduce((maximum, value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > maximum ? number : maximum;
  }, 0));
}

function writeManagedExecutionState(unitName = "", executionId = "", owner = {}) {
  const state = managedExecutionState(unitName, executionId, owner);
  let oomBoundary = null;
  let taskLimit = state.taskLimit;
  const startedAt = Date.parse(state.startedAt);
  const exitedAt = Date.parse(state.exitObservedAt);
  if ((state.result === "oom-kill" || Number(state.oomKillCount) > 0) &&
      startedAt > 0 && exitedAt >= startedAt) {
    // Failure-only, current-boot lookup. Never forward raw journal messages or
    // infer the binding limit from a configured maximum or victim's cgroup.
    const until = Math.min(Date.now(), exitedAt + 1000);
    const journal = spawnSync("journalctl", [
      "-k", "--boot=0", "--no-pager", "--output=json",
      "--output-fields=__REALTIME_TIMESTAMP,__SEQNUM_ID,__SEQNUM,_BOOT_ID,_SOURCE_MONOTONIC_TIMESTAMP,MESSAGE",
      "--lines=65", "--case-sensitive=yes",
      `--since=@${startedAt / 1000}`, `--until=@${until / 1000}`,
      `--grep=^oom-kill:|^/[^,]*/${unitName.replaceAll(".", "\\.")}(?:/[^,]*)?,task=`
    ], { encoding: "utf8", timeout: 2000, maxBuffer: 128 * 1024 });
    if (!journal.error && journal.status === 0) {
      oomBoundary = managedExecutionOomBoundary(journal.stdout, {
        unitName, workspace: workspaceFromDaemonUsername(owner.username), startedAt, until
      });
    }
  }
  if (!taskLimit && state.result && state.result !== "success" && startedAt > 0 && exitedAt >= startedAt) {
    const until = Math.min(Date.now(), exitedAt + 1000);
    const journal = spawnSync("journalctl", [
      "-k", "--boot=0", "--no-pager", "--output=json", "--output-fields=__REALTIME_TIMESTAMP,MESSAGE",
      "--lines=65", "--case-sensitive=yes", `--since=@${startedAt / 1000}`, `--until=@${until / 1000}`,
      `--grep=^cgroup: fork rejected by pids controller in /.*${unitName.replaceAll(".", "\\.")}(?:/|$)`
    ], { encoding: "utf8", timeout: 2000, maxBuffer: 128 * 1024 });
    if (!journal.error && journal.status === 0) taskLimit = managedExecutionTaskLimitJournal(journal.stdout, {
      unitName, workspace: workspaceFromDaemonUsername(owner.username), startedAt, until
    });
  }
  process.stdout.write(`${JSON.stringify({
    executionId,
    ok: true,
    ...state,
    oomBoundary,
    taskLimit
  })}\n`);
}

function managedExecutionTaskLimitJournal(text, { unitName, workspace, startedAt, until }) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 128 * 1024) return null;
  const lines = text.trim().split(/\r?\n/u);
  if (lines.length > 64) return null;
  for (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const time = Number(entry?.__REALTIME_TIMESTAMP) / 1000;
    if (!Number.isFinite(time) || time < startedAt || time > until) continue;
    const group = typeof entry.MESSAGE === "string" &&
      /^cgroup: fork rejected by pids controller in (\/[a-zA-Z0-9_./-]{1,2048})$/u.exec(entry.MESSAGE)?.[1];
    if (!group) continue;
    const parts = group.split("/");
    const workIndex = parts.indexOf(`vibe64-${workspace}-work.slice`);
    if (parts[1] !== "vibe64.slice" || workIndex < 2 || parts.indexOf(unitName) <= workIndex ||
        parts.some((part, index) => index > 0 && (!part || part === "." || part === ".."))) continue;
    // The kernel logs the origin of the denied fork, NOT its limiting ancestor.
    // It logs only the first denial, so the number of journal rows is no count.
    return { source: "kernel-journal", scope: "unknown", count: null, recordedAt: new Date(time).toISOString() };
  }
  return null;
}

function managedExecutionOomBoundary(text, { unitName, workspace, startedAt, until }) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 128 * 1024) return null;
  const lines = text.trim().split(/\r?\n/u);
  if (lines.length > 64) return null; // A truncated search is not complete evidence.
  const entries = lines.flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  let evidence = null;
  for (const entry of entries) {
    const time = Number(entry?.__REALTIME_TIMESTAMP) / 1000;
    if (!Number.isFinite(time) || time < startedAt || time > until) continue;
    let message = entry.MESSAGE;
    if (typeof message === "string" && message.startsWith("oom-kill:") && message.endsWith(",task_memcg=")) {
      // Linux serializes OOM reports with oom_lock, but pr_cont can split long
      // group paths. Join only the immediately adjacent journal record in the
      // same boot/sequence, with a complete victim suffix and close kernel time.
      const next = entries.find((candidate) => /^[a-f0-9]{32}$/u.test(entry.__SEQNUM_ID || "") &&
        candidate?.__SEQNUM_ID === entry.__SEQNUM_ID && candidate?._BOOT_ID === entry._BOOT_ID &&
        /^[a-f0-9]{32}$/u.test(entry._BOOT_ID || "") && Number.isSafeInteger(Number(entry.__SEQNUM)) &&
        Number(candidate.__SEQNUM) === Number(entry.__SEQNUM) + 1 &&
        Number(candidate._SOURCE_MONOTONIC_TIMESTAMP) >= Number(entry._SOURCE_MONOTONIC_TIMESTAMP) &&
        Number(candidate._SOURCE_MONOTONIC_TIMESTAMP) - Number(entry._SOURCE_MONOTONIC_TIMESTAMP) <= 1_000_000 &&
        /^\/[a-zA-Z0-9_./-]+,task=[^,]+,pid=\d+,uid=\d+$/u.test(candidate.MESSAGE || ""));
      if (next) message += next.MESSAGE;
    }
    const match = typeof message === "string" && message.match(
      /^oom-kill:constraint=(CONSTRAINT_[A-Z_]+),.*?,(?:oom_memcg=(\/[^,]+)|(global_oom)),task_memcg=(\/[^,]+),task=/u
    );
    if (!match) continue;
    const [, constraint, memoryGroup, globalOom, taskGroup] = match;
    const parts = taskGroup.split("/");
    const workIndex = parts.indexOf(`vibe64-${workspace}-work.slice`);
    const executionIndex = parts.indexOf(unitName);
    if (parts[1] !== "vibe64.slice" || workIndex < 2 || executionIndex <= workIndex ||
        parts.some((part, index) => index > 0 && (part === "." || part === ".." || !/^[a-zA-Z0-9_.-]+$/u.test(part)))) continue;
    let scope;
    if (constraint === "CONSTRAINT_NONE" && globalOom) {
      scope = "host";
    } else if (constraint === "CONSTRAINT_MEMCG" && memoryGroup &&
        (taskGroup === memoryGroup || taskGroup.startsWith(`${memoryGroup}/`))) {
      const boundary = memoryGroup.split("/").at(-1);
      const executionGroup = parts.slice(0, executionIndex + 1).join("/");
      scope = memoryGroup === executionGroup || memoryGroup.startsWith(`${executionGroup}/`) ? "execution"
        : boundary === `vibe64-${workspace}-work.slice` ? "workspace_work"
        : boundary === `vibe64-${workspace}.slice` ? "workspace"
        : boundary === "vibe64.slice" ? "platform"
        : /-work-p[a-f0-9]{64}-s[a-f0-9]{64}-w[a-f0-9]{32}\.slice$/u.test(boundary) ? "workflow"
        : /-work-p[a-f0-9]{64}-s[a-f0-9]{64}\.slice$/u.test(boundary) ? "session"
        : /-work-p[a-f0-9]{64}\.slice$/u.test(boundary) ? "project" : "ancestor";
    } else {
      return null; // Placement constraints are not proof of host exhaustion.
    }
    const cgroup = memoryGroup || "";
    if (evidence && evidence.cgroup !== cgroup) return null;
    if (!evidence || time > Date.parse(evidence.recordedAt)) {
      evidence = { source: "kernel-journal", scope, cgroup, recordedAt: new Date(time).toISOString() };
    }
  }
  return evidence;
}

// A caller may bound how long a stop waits after SIGTERM before force-killing,
// up to the helper's own limit. The unit's 10 s TimeoutStopSec stays systemd's
// own escalation for longer requests.
function managedExecutionStopTimeoutMs(value) {
  if (value === undefined || value === null) {
    return MANAGED_EXECUTION_STOP_TIMEOUT_MS;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Vibe64 exec helper rejected an invalid managed execution stop timeout.");
  }
  return Math.min(value, MANAGED_EXECUTION_STOP_TIMEOUT_MS);
}

function stopManagedExecution(unitName = "", executionId = "", owner = {}, {
  termTimeoutMs = MANAGED_EXECUTION_STOP_TIMEOUT_MS,
  run = runRootCommandAllowFailure,
  readState = () => managedExecutionState(unitName, executionId, owner),
  removeRuntime = () => {
    const receipts = openAllExecutionReceipts(owner);
    try {
      receipts.remove(executionId);
    } finally {
      receipts.close();
    }
  },
  now = Date.now,
  wait = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
} = {}) {
  const initial = readState();
  if (!initial.scopeEmpty) {
    // Let the unit's ExecStop finish owned cleanup before systemd signals its
    // cgroup. Killing first can interrupt delegated container shutdown hooks.
    // The stop is queued, so the caller's bound, not TimeoutStopSec, decides
    // when unresponsive processes are force-killed.
    run("systemctl", ["stop", "--no-block", unitName]);
  }
  const deadline = now() + termTimeoutMs;
  let state = initial.scopeEmpty ? initial : readState();
  while (!state.scopeEmpty && now() < deadline) {
    wait(25);
    state = readState();
  }
  if (!state.scopeEmpty) {
    run("systemctl", [
      "kill",
      "--kill-who=all",
      "--signal=SIGKILL",
      unitName
    ]);
  }
  if (!initial.scopeEmpty) {
    // Settle the queued stop job before reading the unit's final state.
    run("systemctl", ["stop", unitName]);
    state = readState();
  }
  if (state.scopeEmpty) {
    removeRuntime();
    run("systemctl", ["reset-failed", unitName]);
  }
  return {
    executionId,
    ok: state.scopeEmpty,
    scopeEmpty: state.scopeEmpty,
    stopped: initial.scopeEmpty === false,
    ...state
  };
}

// A receipt directory is the runner's handoff to the controller and outlives
// its unit until the controller acknowledges it. Starting, the controller names
// every execution it still owns; every other receipt whose unit systemd has
// collected or keeps only as inactive or failed is released in this one call,
// and those failed unit records are reset. A loaded unfinished unit keeps both.
function releaseEndedManagedExecutions(owner = {}, keepExecutionIds = [], {
  listUnits = () => runRootCommandAllowFailure("systemctl", [
    "list-units", "--all", "--plain", "--no-legend", "--full",
    `vibe64-exec-${workspaceFromDaemonUsername(safeUsername(owner.username))}-*.service`
  ]),
  openReceipts = () => openAllExecutionReceipts(owner),
  resetFailed = (unitNames) => runRootCommandAllowFailure("systemctl", ["reset-failed", ...unitNames])
} = {}) {
  if (!Array.isArray(keepExecutionIds) || keepExecutionIds.length > MANAGED_EXECUTION_RELEASE_KEEP_MAX) {
    throw new Error("Vibe64 exec helper requires a bounded list of the executions to keep.");
  }
  const keptUnits = new Set(keepExecutionIds.map((id) => managedExecutionUnitName(managedExecutionId(id), owner)));
  const listed = listUnits();
  if (listed.error || listed.status !== 0) {
    throw new Error("Vibe64 exec helper could not list the workspace's execution units.");
  }
  const unfinished = new Set();
  const failed = [];
  for (const line of String(listed.stdout || "").split(/\r?\n/u)) {
    const [unitName = "", , activeState = ""] = line.trim().split(/\s+/u);
    if (!unitName || keptUnits.has(unitName)) continue;
    if (activeState === "failed") failed.push(unitName);
    else if (activeState !== "inactive") unfinished.add(unitName);
  }
  let released = 0;
  const receipts = openReceipts();
  try {
    for (const name of receipts.entries()) {
      if (!MANAGED_EXECUTION_ID_PATTERN.test(name) || name !== name.toLowerCase()) continue;
      const unitName = managedExecutionUnitName(name, owner);
      if (keptUnits.has(unitName) || unfinished.has(unitName)) continue;
      receipts.remove(name);
      released += 1;
    }
  } finally {
    receipts.close();
  }
  for (let index = 0; index < failed.length; index += 256) resetFailed(failed.slice(index, index + 256));
  return { ok: true, released, reset: failed.length };
}

export {
  managedExecutionOomBoundary,
  managedExecutionState,
  managedExecutionStopTimeoutMs,
  managedExecutionTaskLimitCounters,
  managedExecutionTaskLimitJournal,
  managedRunnerCgroupMeasurements,
  releaseEndedManagedExecutions,
  stopManagedExecution,
  writeManagedExecutionState
};
