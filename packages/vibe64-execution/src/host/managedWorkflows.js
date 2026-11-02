// The workspace's work slice and its workflow groups: their limits, counters, state and recorded results.

import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  MANAGED_EXECUTION_MEMORY_MAX_BYTES,
  MANAGED_EXECUTION_MEMORY_MIN_BYTES,
  MANAGED_EXECUTION_TASKS_MAX,
  MANAGED_EXECUTION_TASKS_MIN,
  MANAGED_EXECUTION_WORK_MEMORY_MAX_BYTES,
  managedExecutionId,
  managedExecutionInteger,
  managedExecutionSliceName,
  managedExecutionUnitName
} from "./executionIdentity.js";
import {
  DAEMON_USERNAME_PREFIX,
  runRootCommand,
  runRootCommandAllowFailure,
  safeUsername,
  workspaceFromDaemonUsername
} from "./hostAccounts.js";

function configureManagedExecutionWorkSlice(owner = {}, {
  memoryMaxBytes = 0,
  tasksMax = 0
} = {}, {
  read = readFileSync,
  run = runRootCommand,
  runAllowFailure = runRootCommandAllowFailure
} = {}) {
  const sliceName = managedExecutionSliceName(owner);
  // Runtime properties last until reboot, so nearly every execution finds its
  // limits already in force, and the slice's own cgroup proves it with no
  // systemctl call and no rewrite of the slice's drop-ins by systemd.
  if (managedExecutionWorkSliceEnforces(sliceName, { memoryMaxBytes, tasksMax }, read)) {
    return;
  }
  // `systemctl start` on an active slice still waits for any member that is
  // stopping, for up to that member's TimeoutStopSec. Starting only an inactive
  // slice keeps one slow stop from holding every new execution behind it.
  if (runAllowFailure("systemctl", ["is-active", "--quiet", sliceName]).status !== 0) {
    run("systemctl", ["start", sliceName]);
  }
  run("systemctl", [
    "set-property",
    "--runtime",
    sliceName,
    `MemoryMax=${memoryMaxBytes}`,
    `TasksMax=${tasksMax}`,
    "MemoryAccounting=yes",
    "IOAccounting=yes",
    "TasksAccounting=yes"
  ]);
}

// systemd places a slice named a-b-c.slice at a.slice/a-b.slice/a-b-c.slice.
// A work slice's workspace part holds only [a-z0-9-], which systemd keeps as is.
function managedExecutionSliceCgroup(sliceName = "") {
  const parts = String(sliceName).replace(/\.slice$/u, "").split("-");
  return path.join("/sys/fs/cgroup", ...parts.map((_part, index) => `${parts.slice(0, index + 1).join("-")}.slice`));
}

// The slice exists (systemd removes a stopped slice's group), its memory, I/O
// and task controllers are on, pids.max is the task limit and memory.max is the
// memory limit rounded down to a page, as set-property would leave them. Any
// page is at least 4 KiB, so a memory.max under 4 KiB below the limit is that
// rounding. Anything else, or a file that cannot be read, is not proof.
function managedExecutionWorkSliceEnforces(sliceName = "", { memoryMaxBytes = 0, tasksMax = 0 } = {}, read = readFileSync) {
  const group = managedExecutionSliceCgroup(sliceName);
  try {
    const controllers = String(read(path.join(group, "cgroup.controllers"), "utf8")).trim().split(/\s+/u);
    const memoryMax = Number(String(read(path.join(group, "memory.max"), "utf8")).trim());
    const pidsMax = Number(String(read(path.join(group, "pids.max"), "utf8")).trim());
    return ["memory", "io", "pids"].every((controller) => controllers.includes(controller)) &&
      Number.isSafeInteger(memoryMax) && memoryMax <= memoryMaxBytes && memoryMaxBytes - memoryMax < 4096 &&
      pidsMax === tasksMax;
  } catch {
    return false;
  }
}

function managedWorkflowIdentity(input = {}, owner = {}) {
  const id = managedExecutionId(input.id);
  for (const key of [input.projectKey, input.sessionKey]) {
    if (typeof key !== "string" || !/^[a-f0-9]{64}$/u.test(key)) {
      throw new Error("Vibe64 exec helper rejected an invalid workflow accounting identity.");
    }
  }
  const username = safeUsername(owner.username);
  if (!username.startsWith(DAEMON_USERNAME_PREFIX)) {
    throw new Error("Managed workflow accounting requires a workspace daemon owner.");
  }
  const workspace = workspaceFromDaemonUsername(username);
  if (!/^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(workspace)) {
    throw new Error("Invalid managed workflow workspace identity.");
  }
  const projectUnit = `vibe64-${workspace}-work-p${input.projectKey}.slice`;
  const sessionUnit = `${projectUnit.slice(0, -6)}-s${input.sessionKey}.slice`;
  return {
    id,
    workspace,
    projectKey: input.projectKey,
    sessionKey: input.sessionKey,
    projectUnit,
    sessionUnit,
    unitName: `${sessionUnit.slice(0, -6)}-w${id.replaceAll("-", "")}.slice`
  };
}

function managedWorkflowResultPath(workflow) {
  // Root-owned receipts keep final counters recoverable if the controller
  // disconnects after group removal. The controller owns durable history.
  return path.join("/run/vibe64-workflows", workflow.workspace, `${workflow.id}.json`);
}

function readManagedWorkflowResult(workflow) {
  try {
    const result = JSON.parse(readFileSync(managedWorkflowResultPath(workflow), "utf8"));
    if (result.schema !== "vibe64.managed-workflow.result.v1" || result.unitName !== workflow.unitName ||
        result.id !== workflow.id) throw new Error("Invalid managed workflow result identity.");
    return result;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function writeManagedWorkflowResult(workflow, result) {
  const resultPath = managedWorkflowResultPath(workflow);
  for (const directory of ["/run/vibe64-workflows", path.dirname(resultPath)]) {
    try { mkdirSync(directory, { mode: 0o700 }); } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o077) !== 0) {
      throw new Error("Unsafe managed workflow result directory.");
    }
  }
  const temporary = `${resultPath}.tmp-${process.pid}`;
  // Opening exclusively before the cleanup block proves we own this temporary
  // file. A pre-existing receipt temporary must never be removed on EEXIST.
  const file = openSync(temporary, "wx", 0o600);
  try {
    try {
      writeFileSync(file, `${JSON.stringify({ ...result, schema: "vibe64.managed-workflow.result.v1" })}\n`);
    } finally {
      closeSync(file);
    }
    renameSync(temporary, resultPath);
  } catch (error) {
    try { unlinkSync(temporary); } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT") throw new AggregateError([error, cleanupError], "Workflow receipt write and cleanup failed.");
    }
    throw error;
  }
}

function managedWorkflowState(workflow) {
  const response = runRootCommandAllowFailure("systemctl", [
    "show", workflow.unitName, "--no-pager",
    "--property=LoadState,ActiveState,ControlGroup,MemoryMax,TasksMax"
  ]);
  const values = Object.fromEntries(String(response.stdout || "").trim().split("\n").map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  const controlGroup = String(values.ControlGroup || "");
  if (controlGroup && (path.posix.basename(controlGroup) !== workflow.unitName ||
      !controlGroup.includes(`/vibe64-${workflow.workspace}-work.slice/`))) {
    throw new Error("Managed workflow group does not belong to its workspace.");
  }
  const live = {
    id: workflow.id,
    unitName: workflow.unitName,
    activeState: values.ActiveState || "unknown",
    controlGroup,
    memoryMaxBytes: knownCounter(values.MemoryMax),
    tasksMax: knownCounter(values.TasksMax),
    ...managedWorkflowCounters(controlGroup ? path.join("/sys/fs/cgroup", controlGroup) : "")
  };
  if (response.status === 0 && values.ActiveState === "inactive" && !controlGroup) {
    live.scopeEmpty = true;
  }
  const recorded = readManagedWorkflowResult(workflow);
  return recorded ? { ...recorded, activeState: live.activeState, controlGroup: live.controlGroup } : live;
}

function knownCounter(value) {
  return typeof value === "string" && /^[0-9]+$/u.test(value.trim()) && Number.isSafeInteger(Number(value))
    ? Number(value) : null;
}

function managedWorkflowCounters(cgroupPath = "") {
  function read(name) {
    if (!cgroupPath) return "";
    try { return readFileSync(path.join(cgroupPath, name), "utf8"); } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENODEV") return "";
      throw error;
    }
  }
  function counters(name) {
    return Object.fromEntries(read(name).trim().split("\n").map((line) => {
      const [key, value] = line.trim().split(/\s+/u);
      return [key, knownCounter(value)];
    }));
  }
  const events = counters("memory.events");
  const memory = counters("memory.stat");
  const group = counters("cgroup.events");
  const pressure = read("memory.pressure");
  return {
    sampledAt: new Date().toISOString(),
    sampledMonotonicMs: Number(process.hrtime.bigint() / 1_000_000n),
    scopeEmpty: group.populated === 0 ? true : group.populated === 1 ? false : null,
    memoryCurrentBytes: knownCounter(read("memory.current")),
    memoryPeakBytes: knownCounter(read("memory.peak")),
    memorySwapCurrentBytes: knownCounter(read("memory.swap.current")),
    memoryAnonBytes: memory.anon ?? null,
    memoryFileBytes: memory.file ?? null,
    memoryKernelBytes: memory.kernel ?? null,
    swapInPages: memory.pswpin ?? null,
    swapOutPages: memory.pswpout ?? null,
    memoryPressureSomeTotalUsec: knownCounter(/^some\s+.*\btotal=([0-9]+)(?:\s|$)/mu.exec(pressure)?.[1]),
    oomCount: events.oom ?? null,
    oomKillCount: events.oom_kill ?? null,
    limitHitCount: events.max ?? null,
    reclaimCount: events.high ?? null,
    tasksCurrent: knownCounter(read("pids.current")),
    peakScope: "workflow-lifetime"
  };
}

function managedWorkflowOperation(payload, owner) {
  const workflow = managedWorkflowIdentity(payload.workflow, owner);
  const action = String(payload.action || "");
  if (action === "workflow-inspect") return { ok: true, ...managedWorkflowState(workflow) };
  if (action === "workflow-grow" || action === "workflow-limits") return managedWorkflowMemoryOperation(payload, workflow, owner);
  if (action === "workflow-forget") {
    const recorded = managedWorkflowState(workflow);
    if (recorded.scopeEmpty !== true || recorded.activeState !== "inactive") {
      throw new Error("Only a completed workflow receipt can be acknowledged.");
    }
    try { unlinkSync(managedWorkflowResultPath(workflow)); } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return { ok: true, id: workflow.id };
  }
  if (action === "workflow-create") {
    const memoryMaxBytes = managedExecutionInteger(payload.memoryMaxBytes,
      MANAGED_EXECUTION_MEMORY_MIN_BYTES, MANAGED_EXECUTION_WORK_MEMORY_MAX_BYTES, "workflow memory limit");
    const tasksMax = managedExecutionInteger(payload.tasksMax,
      MANAGED_EXECUTION_TASKS_MIN, MANAGED_EXECUTION_TASKS_MAX, "workflow task limit");
    const workMaximum = knownCounter(runRootCommand("systemctl", [
      "show", managedExecutionSliceName(owner), "--property=MemoryMax", "--value"
    ]));
    if (workMaximum === null || memoryMaxBytes > workMaximum) {
      throw new Error("Vibe64 exec helper rejected a workflow above its proven work-slice memory limit.");
    }
    const previous = managedWorkflowState(workflow);
    if (previous.finishedAt) throw new Error("A completed workflow identity cannot be reused.");
    if (previous.activeState === "active") {
      if (previous.memoryMaxBytes !== memoryMaxBytes || previous.tasksMax !== tasksMax) {
        throw new Error("An active workflow cannot be reconfigured by retrying creation.");
      }
      return { ok: true, ...previous };
    }
    // Ancestor limits already belong to host policy. Creation never changes
    // another workflow, the shared work slice or the host's control reserve.
    runRootCommand("busctl", [
      "--system", "call", "org.freedesktop.systemd1", "/org/freedesktop/systemd1",
      "org.freedesktop.systemd1.Manager", "StartTransientUnit", "ssa(sv)a(sa(sv))",
      workflow.unitName, "fail", "5",
      "MemoryMax", "t", String(memoryMaxBytes), "TasksMax", "t", String(tasksMax),
      "MemoryAccounting", "b", "true",
      "IOAccounting", "b", "true", "TasksAccounting", "b", "true", "0"
    ]);
    runRootCommand("systemctl", ["start", workflow.unitName]);
    const state = managedWorkflowState(workflow);
    if (state.memoryMaxBytes !== memoryMaxBytes || state.tasksMax !== tasksMax || state.scopeEmpty !== true) {
      throw new Error("Managed workflow creation could not prove its limits and empty accounting group.");
    }
    return { ok: true, ...state };
  }
  if (action === "workflow-finish") {
    const state = managedWorkflowState(workflow);
    if (!state.finishedAt) {
      if (state.scopeEmpty !== true) {
        return { ok: false, code: "workflow_not_empty", ...state };
      }
      writeManagedWorkflowResult(workflow, { ...state, finishedAt: new Date().toISOString() });
    }
    // Both first completion and a lost-acknowledgement retry must prove removal.
    // A prior stop may have failed after the final receipt was saved.
    const stop = runRootCommandAllowFailure("systemctl", ["stop", workflow.unitName]);
    const stopped = managedWorkflowState(workflow);
    // An empty transient unit may already have been collected by systemd.
    // A stop-command error alone is neither proof of failure nor completion.
    if (stopped.activeState !== "inactive" || stopped.controlGroup || stopped.scopeEmpty !== true) {
      throw new Error(String(stop.stderr || "Managed workflow group did not stop.").trim());
    }
    return { ok: true, ...stopped };
  }
  throw new Error("Vibe64 exec helper rejected an unknown workflow action.");
}

function managedWorkflowMemoryLimits(unitName, controlGroup, pageSizeBytes, requestedMaximum) {
  const values = Object.fromEntries(runRootCommand("systemctl", [
    "show", unitName, "--no-pager", "--property=ActiveState,ControlGroup,MemoryMax"
  ]).split("\n").map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
  if (values.ActiveState !== "active" || values.ControlGroup !== controlGroup) {
    throw new Error("Memory growth requires the same active, owned accounting group.");
  }
  const kernelMaximum = knownCounter(readFileSync(path.join("/sys/fs/cgroup", controlGroup, "memory.max"), "utf8"));
  const configuredMaximum = knownCounter(values.MemoryMax);
  if (configuredMaximum === null || kernelMaximum !== Math.floor(configuredMaximum / pageSizeBytes) * pageSizeBytes) {
    throw new Error("The effective memory limit could not be verified.");
  }
  const high = readFileSync(path.join("/sys/fs/cgroup", controlGroup, "memory.high"), "utf8").trim();
  if (high !== "max" && (knownCounter(high) === null || requestedMaximum > Number(high))) {
    throw Object.assign(new Error("Memory growth is blocked by the target's memory.high limit."), {
      limitingGroup: { controlGroup, limit: "memory.high", maximumBytes: knownCounter(high), requestedBytes: requestedMaximum ?? null }
    });
  }
  return { unitName, controlGroup, memoryMaxBytes: configuredMaximum, effectiveMemoryMaxBytes: kernelMaximum,
    memoryHighBytes: high === "max" ? null : knownCounter(high) };
}

function managedWorkflowAncestorLimits(controlGroup, memoryMaxBytes) {
  const ancestors = [];
  for (let group = path.posix.dirname(controlGroup); group !== "/"; group = path.posix.dirname(group)) {
    const limits = { controlGroup: group };
    for (const [file, key] of [["memory.max", "memoryMaxBytes"], ["memory.high", "memoryHighBytes"]]) {
      const value = readFileSync(path.join("/sys/fs/cgroup", group, file), "utf8").trim();
      const maximum = value === "max" ? null : knownCounter(value);
      if (value !== "max" && (maximum === null || memoryMaxBytes > maximum)) {
        throw Object.assign(new Error(`Memory growth is blocked by an ancestor ${file} limit.`), {
          limitingGroup: { controlGroup: group, limit: file, maximumBytes: maximum, requestedBytes: memoryMaxBytes }
        });
      }
      limits[key] = maximum;
    }
    ancestors.push(limits);
  }
  return ancestors;
}

function managedWorkflowMemoryOperation(payload, workflow, owner) {
  const readOnly = payload.action === "workflow-limits";
  let attempted = false;
  let before = [];
  let after = [];
  let targets = [];
  let ancestors = [];
  let pageSizeBytes = null;
  try {
    const state = managedWorkflowState(workflow);
    if (state.activeState !== "active" || !state.controlGroup || state.finishedAt) {
      throw new Error("Memory growth requires an active workflow.");
    }
    const memoryMaxBytes = managedExecutionInteger(payload.memoryMaxBytes,
      MANAGED_EXECUTION_MEMORY_MIN_BYTES, MANAGED_EXECUTION_WORK_MEMORY_MAX_BYTES, "workflow memory limit");
    if (!Array.isArray(payload.executions) || payload.executions.length > 128) {
      throw new Error("Memory growth requires a bounded list of owned executions.");
    }
    pageSizeBytes = knownCounter(runRootCommand("getconf", ["PAGESIZE"]));
    if (!pageSizeBytes || pageSizeBytes > MANAGED_EXECUTION_MEMORY_MIN_BYTES) {
      throw new Error("The kernel memory limit granularity is unavailable.");
    }
    // Kernel limits are whole pages. Round down here so applying a byte budget
    // never grants more memory than the provider has reserved.
    targets = [{ unitName: workflow.unitName, controlGroup: state.controlGroup,
      memoryMaxBytes: Math.floor(memoryMaxBytes / pageSizeBytes) * pageSizeBytes,
      expectedMemoryMaxBytes: payload.expectedMemoryMaxBytes }];
    for (const execution of payload.executions) {
      const unitName = managedExecutionUnitName(execution?.id, owner);
      if (targets.some((target) => target.unitName === unitName)) throw new Error("Duplicate memory growth execution.");
      const maximum = managedExecutionInteger(execution.memoryMaxBytes,
        MANAGED_EXECUTION_MEMORY_MIN_BYTES, MANAGED_EXECUTION_MEMORY_MAX_BYTES, "execution memory limit");
      if (maximum > memoryMaxBytes) throw new Error("Execution memory growth exceeds its workflow allowance.");
      targets.push({ unitName, controlGroup: `${state.controlGroup}/${unitName}`,
        memoryMaxBytes: Math.floor(maximum / pageSizeBytes) * pageSizeBytes,
        expectedMemoryMaxBytes: execution.expectedMemoryMaxBytes });
    }
    // Validate every target and ancestor before the first write. Unit names
    // come only from owner-scoped identities; caller paths never select a unit.
    before = targets.map((target) => managedWorkflowMemoryLimits(target.unitName, target.controlGroup, pageSizeBytes,
      readOnly ? undefined : target.memoryMaxBytes));
    if (readOnly) return { ok: true, id: workflow.id, pageSizeBytes, before, after: before,
      ancestors: managedWorkflowAncestorLimits(state.controlGroup) };
    for (const [index, target] of targets.entries()) {
      if (target.expectedMemoryMaxBytes !== before[index].memoryMaxBytes ||
          target.memoryMaxBytes < before[index].effectiveMemoryMaxBytes) {
        throw new Error("Memory growth cannot lower a live limit or apply to stale limits.");
      }
    }
    ancestors = managedWorkflowAncestorLimits(state.controlGroup, targets[0].memoryMaxBytes);
    for (const [index, target] of targets.entries()) {
      if (before[index].memoryMaxBytes === target.memoryMaxBytes) continue;
      attempted = true;
      // Parent first, then explicitly requested children. Never shrink to roll
      // back a partial change: the provider retains its enlarged reservation.
      runRootCommand("systemctl", ["set-property", "--runtime", target.unitName, `MemoryMax=${target.memoryMaxBytes}`]);
    }
    after = targets.map((target) => managedWorkflowMemoryLimits(target.unitName, target.controlGroup, pageSizeBytes, target.memoryMaxBytes));
    ancestors = managedWorkflowAncestorLimits(state.controlGroup, targets[0].memoryMaxBytes);
    if (!after.every((limit, index) => limit.memoryMaxBytes === targets[index].memoryMaxBytes)) {
      throw new Error("Memory growth readback did not match the requested limits.");
    }
    return { ok: true, id: workflow.id, changeState: attempted ? "applied" : "unchanged", pageSizeBytes, before, after, ancestors };
  } catch (error) {
    let changeState = "unchanged";
    if (attempted) {
      // A failed command can have applied its change. Only a complete readback
      // equal to the original limits proves capacity may be released.
      after = targets.map((target) => {
        try { return managedWorkflowMemoryLimits(target.unitName, target.controlGroup, pageSizeBytes); } catch { return null; }
      });
      changeState = after.some((limit) => limit === null) ? "unknown"
        : after.every((limit, index) => limit.memoryMaxBytes === before[index].memoryMaxBytes) ? "unchanged" : "partial";
    }
    return { ok: false, id: workflow.id, code: "workflow_memory_growth_failed", changeState,
      error: String(error?.message || error), limitingGroup: error?.limitingGroup ?? null,
      pageSizeBytes, before, after, ancestors };
  }
}

export {
  configureManagedExecutionWorkSlice,
  knownCounter,
  managedExecutionSliceCgroup,
  managedWorkflowCounters,
  managedWorkflowIdentity,
  managedWorkflowOperation,
  managedWorkflowState
};
