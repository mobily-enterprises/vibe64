// Managed executions: starting one as a transient systemd unit, and the runner that runs its command inside
// that unit.

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { createConnection } from "node:net";
import { constants as osConstants } from "node:os";
import process from "node:process";

import { applicationReleaseEnvironmentFile, resolveApplicationCwd } from "./applicationAccounts.js";
import {
  ALLOWED_COMMANDS,
  helperChildEnv,
  managedExecutionRuntimeBase,
  readEnvironmentFile,
  resolveAllowedCwd,
  usageRecordingNodeOptions
} from "./commandEnvironment.js";
import {
  MANAGED_EXECUTION_MEMORY_MAX_BYTES,
  MANAGED_EXECUTION_MEMORY_MIN_BYTES,
  MANAGED_EXECUTION_TASKS_MAX,
  MANAGED_EXECUTION_TASKS_MIN,
  MANAGED_EXECUTION_WORK_MEMORY_MAX_BYTES,
  MANAGED_EXECUTION_WORK_MEMORY_MIN_BYTES,
  managedExecutionId,
  managedExecutionInteger,
  managedExecutionKind,
  managedExecutionMode,
  managedExecutionSliceName,
  managedExecutionTargetUser,
  managedExecutionUnitName
} from "./executionIdentity.js";
import {
  openApplicationExecutionReceipts,
  openWorkspaceExecutionReceipts,
  writeManagedExecutionResult
} from "./executionReceipts.js";
import {
  managedExecutionStopTimeoutMs,
  managedRunnerCgroupMeasurements,
  releaseEndedManagedExecutions,
  stopManagedExecution,
  writeManagedExecutionState
} from "./executionState.js";
import { ensureGroup, resolveOwnerUser, VIBE64_GROUP } from "./hostAccounts.js";
import {
  configureManagedExecutionWorkSlice,
  managedWorkflowIdentity,
  managedWorkflowOperation,
  managedWorkflowState
} from "./managedWorkflows.js";
import { accountUnitLines } from "./systemdUnits.js";

const CONTROLLER_LEASE_NAME = "resource-controller.sock";

function handleManagedExecutionOperation(payload = {}) {
  const owner = resolveOwnerUser();
  const groupId = ensureGroup(VIBE64_GROUP);
  const action = String(payload.action || "").trim();
  if (action.startsWith("workflow-")) {
    const result = managedWorkflowOperation(payload, owner);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.ok !== true) process.exitCode = 1;
    return;
  }
  if (action === "release-ended") {
    process.stdout.write(`${JSON.stringify(releaseEndedManagedExecutions(owner, payload.keepExecutionIds))}\n`);
    return;
  }
  const executionId = managedExecutionId(payload.executionId);
  const unitName = managedExecutionUnitName(executionId, owner);
  if (action === "inspect") {
    writeManagedExecutionState(unitName, executionId, owner);
    return;
  }
  if (action === "stop") {
    const result = stopManagedExecution(unitName, executionId, owner, {
      termTimeoutMs: managedExecutionStopTimeoutMs(payload.termTimeoutMs)
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.scopeEmpty) {
      process.exit(1);
    }
    return;
  }
  if (action !== "start") {
    throw new Error("Vibe64 exec helper rejected an unknown managed execution action.");
  }

  const mode = managedExecutionMode(payload.mode);
  const kind = managedExecutionKind(payload.kind);
  const lifecycle = String(payload.lifecycle || "").trim();
  const expectedLifecycle = mode === "capture"
    ? "finite"
    : mode === "pty"
      ? "interactive"
      : "service";
  if (lifecycle !== expectedLifecycle) {
    throw new Error("Vibe64 exec helper rejected a managed execution lifecycle mismatch.");
  }
  const controllerLeaseName = managedExecutionControllerLeaseName(
    payload.controllerLeaseName,
    lifecycle,
    owner
  );
  const targetUser = managedExecutionTargetUser(payload, owner);
  // A published application's commands (its build, release file work and
  // production database work) are finite and stay inside its own area.
  const application = targetUser.application || null;
  if (application && mode !== "capture") {
    throw new Error("An application account runs only finite commands.");
  }
  const commandOperation = String(payload.commandOperation || "").trim();
  const cwd = application
    ? resolveApplicationCwd(payload.cwd || "", application)
    : resolveAllowedCwd(payload.cwd || "", owner.username, {
      operation: commandOperation,
      targetUser
    });
  const command = String(payload.command || "").trim();
  if (!command || /[\r\n]/u.test(command)) {
    throw new Error("Vibe64 exec helper rejected an invalid managed execution command.");
  }
  if (!application && targetUser.username !== owner.username && !ALLOWED_COMMANDS.has(path.basename(command))) {
    throw new Error("Vibe64 exec helper rejected an unsupported real-user managed command.");
  }
  const args = Array.isArray(payload.args) ? payload.args.map((arg) => String(arg)) : [];
  const env = helperChildEnv(payload.env || {}, targetUser, owner.username, commandOperation);
  if (payload.usageRecordingPreload) {
    if (application) {
      throw new Error("An application account does not run the usage recorder.");
    }
    env.NODE_OPTIONS = usageRecordingNodeOptions(payload.usageRecordingPreload);
  }
  let releaseEnvironmentFile = "";
  if (payload.releaseEnvironmentFile) {
    if (!application) {
      throw new Error("Release environment requires an application's own execution.");
    }
    releaseEnvironmentFile = applicationReleaseEnvironmentFile(payload.releaseEnvironmentFile, application, {
      cwd,
      daemonUid: owner.uid,
      gid: targetUser.gid
    });
  }
  const memoryMaxBytes = managedExecutionInteger(
    payload.memoryMaxBytes,
    MANAGED_EXECUTION_MEMORY_MIN_BYTES,
    MANAGED_EXECUTION_MEMORY_MAX_BYTES,
    "memory limit"
  );
  const tasksMax = managedExecutionInteger(
    payload.tasksMax,
    MANAGED_EXECUTION_TASKS_MIN,
    MANAGED_EXECUTION_TASKS_MAX,
    "task limit"
  );
  const workMemoryMaxBytes = managedExecutionInteger(
    payload.workMemoryMaxBytes,
    MANAGED_EXECUTION_WORK_MEMORY_MIN_BYTES,
    MANAGED_EXECUTION_WORK_MEMORY_MAX_BYTES,
    "work-slice memory limit"
  );
  const workTasksMax = managedExecutionInteger(
    payload.workTasksMax,
    MANAGED_EXECUTION_TASKS_MIN,
    MANAGED_EXECUTION_TASKS_MAX,
    "work-slice task limit"
  );
  if (memoryMaxBytes > workMemoryMaxBytes || tasksMax > workTasksMax) {
    throw new Error("Vibe64 exec helper rejected an execution limit above its work-slice limit.");
  }
  let executionSlice = managedExecutionSliceName(owner);
  if (payload.workflow) {
    const workflow = managedWorkflowIdentity(payload.workflow, owner);
    const state = managedWorkflowState(workflow);
    if (state.activeState !== "active" || !state.controlGroup || state.finishedAt) {
      throw new Error("Vibe64 exec helper rejected an execution without its active workflow group.");
    }
    if (memoryMaxBytes > state.memoryMaxBytes || tasksMax > state.tasksMax) {
      throw new Error("Vibe64 exec helper rejected an execution limit above its workflow limit.");
    }
    executionSlice = workflow.unitName;
  } else {
    configureManagedExecutionWorkSlice(owner, {
      memoryMaxBytes: workMemoryMaxBytes,
      tasksMax: workTasksMax
    });
  }
  const receipts = application
    ? openApplicationExecutionReceipts(owner, { create: true })
    : openWorkspaceExecutionReceipts(owner, { create: true, gid: groupId });
  const receiptRoot = receipts.create(executionId, targetUser, {
    ...(application ? { application: true } : {}),
    args,
    command,
    controllerLeaseName,
    cwd,
    env,
    inputBase64: String(payload.inputBase64 || ""),
    inputPresent: payload.inputPresent === true,
    ...(releaseEnvironmentFile ? { releaseEnvironmentFile } : {}),
    executionId
  }, { privateDirectory: mode === "detached" });
  // The runner reads its command as the target user, with no privilege to lend.
  const runnerPayloadPath = path.join(receiptRoot, "command.json");

  const helperPath = path.resolve(process.argv[1]);
  const systemdArgs = [
    "--quiet",
    `--unit=${unitName}`,
    "--service-type=exec",
    `--slice=${executionSlice}`,
    `--property=Description=Vibe64 ${kind} execution`,
    ...accountUnitLines(targetUser, { receiptRoot }).map((line) => `--property=${line}`),
    `--property=WorkingDirectory=${cwd}`,
    "--property=KillMode=control-group",
    "--property=ExitType=cgroup",
    "--property=OOMPolicy=stop",
    "--property=MemoryAccounting=yes",
    "--property=IOAccounting=yes",
    "--property=TasksAccounting=yes",
    `--property=MemoryMax=${memoryMaxBytes}`,
    `--property=TasksMax=${tasksMax}`,
    "--property=TimeoutStopSec=10s",
    // Finite captures are frequent and their output returns to the caller, so
    // systemd keeps only their notices, warnings and errors (failures) in the
    // journal, not routine Starting/Started/Deactivated lines.
    ...(mode === "capture" ? ["--property=LogLevelMax=notice", "--wait", "--pipe"] : []),
    ...(mode === "pty" ? ["--wait", "--pty"] : []),
    // A person's execution can never gain privileges above that person. The
    // runner starts under setpriv, as runUserCommand's commands do, because a
    // unit's NoNewPrivileges= can be switched off by a systemd drop-in (Incus
    // containers ship one). setpriv execs the runner, which stays the MainPID.
    ...(targetUser.username !== owner.username ? ["/usr/bin/setpriv", "--no-new-privs", "--"] : []),
    helperPath,
    "run-managed",
    runnerPayloadPath
  ];
  const started = spawnSync("systemd-run", systemdArgs, {
    stdio: "inherit"
  });
  if (mode !== "detached" || started.error || started.status !== 0) {
    receipts.remove(executionId);
  }
  receipts.close();
  if (started.error) {
    throw started.error;
  }
  process.exit(typeof started.status === "number" ? started.status : 1);
}

async function runManagedExecutionPayload(payloadPath = "") {
  const resolved = path.resolve(String(payloadPath || ""));
  const input = readFileSync(resolved, "utf8");
  unlinkSync(resolved);
  const payload = JSON.parse(input);
  if (
    payload?.schema !== "vibe64.managed-execution.command" ||
    payload?.schemaVersion !== 1
  ) {
    throw new Error("Vibe64 managed execution runner rejected an invalid payload.");
  }
  const command = String(payload.command || "").trim();
  if (!command || /[\r\n]/u.test(command)) {
    throw new Error("Vibe64 managed execution runner rejected an invalid command.");
  }
  const controllerLeaseName = managedExecutionControllerLeaseName(
    payload.controllerLeaseName,
    payload.controllerLeaseName ? "service" : ""
  );
  const controllerLease = controllerLeaseName
    ? await connectManagedExecutionController(controllerLeaseName)
    : null;
  // As its unit's UMask= says: an application's files are its own alone.
  process.umask(payload.application === true ? 0o077 : 0o007);
  let child = null;
  let terminationTimer = null;
  let controllerLeaseClosed = false;
  const stopForControllerLoss = () => {
    controllerLeaseClosed = true;
    if (child && terminationTimer === null) {
      terminationTimer = terminateManagedExecutionChild(child);
    }
  };
  controllerLease?.once("close", stopForControllerLoss);
  const startedAt = new Date().toISOString();
  let childSignal = "";
  try {
    child = spawn(command, Array.isArray(payload.args) ? payload.args.map(String) : [], {
      cwd: String(payload.cwd || "/"),
      detached: Boolean(controllerLease),
      // The runner, as the execution's own user, loads the release environment.
      env: payload.releaseEnvironmentFile
        ? helperChildEnv({ ...process.env, ...readEnvironmentFile(payload.releaseEnvironmentFile), ...payload.env },
          { application: payload.application === true, home: payload.env.HOME, username: payload.env.USER }, payload.env.USER)
        : payload.env && typeof payload.env === "object" && !Array.isArray(payload.env) ? payload.env : {},
      stdio: payload.inputPresent === true
        ? ["pipe", "inherit", "inherit"]
        : "inherit"
    });
    if (payload.inputPresent === true) {
      child.stdin.end(Buffer.from(String(payload.inputBase64 || ""), "base64"));
    }
    if (controllerLeaseClosed) {
      terminationTimer = terminateManagedExecutionChild(child);
    }
    const outcome = await new Promise((resolve, reject) => {
      let exitObservedAt = "";
      child.once("exit", () => { exitObservedAt = new Date().toISOString(); });
      child.once("error", reject);
      // A command can exit without reading its input; writing it then fails with
      // EPIPE and the command's own status is the result. Any other write failure
      // fails the run, as a spawn failure does.
      child.stdin?.on("error", (error) => {
        if (error.code !== "EPIPE") reject(error);
      });
      child.once("close", (status, signal) => resolve({ signal, status, exitObservedAt }));
    });
    const status = typeof outcome.status === "number" ? outcome.status : 1;
    writeManagedExecutionResult(path.dirname(resolved), {
      ...managedRunnerCgroupMeasurements(),
      // The runner stopped this child because the controller that admitted it
      // went away; the runner's own exit status then says nothing about the child.
      ...(controllerLeaseClosed ? { controllerLeaseClosed: true } : {}),
      executionId: managedExecutionId(payload.executionId),
      startedAt,
      exitObservedAt: outcome.exitObservedAt,
      execMainCode: outcome.signal ? "killed" : "exited",
      execMainStatus: outcome.signal || String(status),
      result: outcome.signal ? "signal" : status === 0 ? "success" : "exit-code",
      signal: String(outcome.signal || "")
    });
    childSignal = outcome.signal || "";
    // A finite or interactive run, and a signal this process ignores such as
    // SIGPIPE, exit as 128 + the signal's number.
    process.exitCode = childSignal ? 128 + (osConstants.signals[childSignal] || 0) : status;
  } finally {
    if (terminationTimer !== null) {
      clearTimeout(terminationTimer);
    }
    controllerLease?.off("close", stopForControllerLoss);
    controllerLease?.destroy();
  }
  // Only a service (the one lifecycle with a controller lease) ends the way its
  // child ended, so systemd judges the unit as it would the child: an ordinary
  // SIGTERM stop is clean, a SIGKILL is a failure. `systemd-run --wait` reports
  // a clean signal stop as exit 0, so a finite or interactive command killed by
  // SIGTERM keeps its failure status instead.
  if (childSignal && controllerLease) {
    process.kill(process.pid, childSignal);
  }
}

// A managed service's controller lease is the socket its controller listens
// on in the daemon's own runtime directory, where only the daemon adds
// entries and no application can reach; an abstract socket name would be any
// local account's to take first. Started for `owner`, it is exactly that
// daemon's; the runner, given it by root, checks only its shape.
function managedExecutionControllerLeaseName(value = "", lifecycle = "", owner = null) {
  const leaseName = String(value || "");
  if (lifecycle !== "service") {
    if (leaseName) {
      throw new Error("Vibe64 exec helper rejected a controller lease on a finite execution.");
    }
    return "";
  }
  const valid = owner
    ? leaseName === path.join(managedExecutionRuntimeBase(owner), CONTROLLER_LEASE_NAME)
    : path.isAbsolute(leaseName) && path.resolve(leaseName) === leaseName && path.basename(leaseName) === CONTROLLER_LEASE_NAME;
  if (!valid) {
    throw new Error("Vibe64 exec helper rejected an invalid managed service controller lease.");
  }
  return leaseName;
}

function connectManagedExecutionController(leaseName = "") {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: leaseName });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Vibe64 managed service could not attach to its controller lease."));
    }, 3000);
    timeout.unref();
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.removeListener("error", onError);
      socket.on("error", () => socket.destroy());
      resolve(socket);
    });
    socket.once("error", onError);

    function onError(error) {
      clearTimeout(timeout);
      socket.destroy();
      reject(new Error(`Vibe64 managed service controller lease is unavailable: ${error?.code || error}`));
    }
  });
}

function terminateManagedExecutionChild(child = null) {
  signalManagedExecutionChild(child, "SIGTERM");
  const timer = setTimeout(() => signalManagedExecutionChild(child, "SIGKILL"), 5000);
  timer.unref();
  return timer;
}

function signalManagedExecutionChild(child = null, signal = "SIGTERM") {
  const pid = Number(child?.pid);
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code === "ESRCH") {
      return;
    }
    try {
      child.kill(signal);
    } catch (fallbackError) {
      if (fallbackError?.code !== "ESRCH") {
        process.stderr.write("Vibe64 managed service process tree could not be stopped.\n");
      }
    }
  }
}

export {
  handleManagedExecutionOperation,
  managedExecutionControllerLeaseName,
  runManagedExecutionPayload
};
