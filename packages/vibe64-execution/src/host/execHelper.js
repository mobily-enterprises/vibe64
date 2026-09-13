#!/opt/vibe64/runtime-packs/node26/bin/node
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  chownSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { createConnection } from "node:net";
import process from "node:process";

const INPUT_LIMIT_BYTES = 1024 * 1024;
const STDIN_READ_BUFFER_BYTES = 64 * 1024;
const STDIN_READ_RETRY_DELAY_MS = 10;
const STDIN_READ_TIMEOUT_MS = 15_000;
const EXEC_HELPER_PAYLOAD_SCHEMA = "vibe64.exec-helper.payload";
const EXEC_HELPER_PAYLOAD_SCHEMA_VERSION = 1;
const ALLOWED_OPERATIONS = new Set([
  "account-auth-terminal",
  "account-status",
  "codex-app-server",
  "create-system-user",
  "deployment-service",
  "enable-system-user",
  "github-api-command",
  "github-toolchain",
  "github-workflow-command",
  "health-status",
  "managed-execution",
  "managed-service",
  "opencode-app-server",
  "vibe64-command"
]);
const ALLOWED_COMMANDS = new Set([
  "bash",
  "gh",
  "git"
]);
const SAFE_ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const BLOCKED_ENV_NAMES = new Set([
  "BASH_ENV",
  "ENV",
  "LD_AUDIT",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS"
]);
const DEFAULT_PATH = [
  "/opt/vibe64/runtime-packs/policy-bin",
  "/opt/vibe64/runtime-packs/operator-clis/bin",
  "/opt/vibe64/runtime-packs/node26/bin",
  "/opt/vibe64/runtime-packs/git/bin",
  "/opt/vibe64/runtime-packs/gh/bin",
  "/opt/vibe64/runtime-packs/ripgrep/bin",
  "/opt/vibe64/runtime-packs/bubblewrap/bin",
  "/opt/vibe64/runtime-packs/bun/bin",
  "/opt/vibe64/runtime-packs/php/bin",
  "/opt/vibe64/runtime-packs/composer/bin",
  "/opt/vibe64/runtime-packs/mariadb/bin",
  "/opt/vibe64/runtime-packs/postgresql/bin",
  "/opt/vibe64/runtime-packs/playwright/bin",
  "/opt/vibe64/runtime-packs/guard-bin",
  "/usr/local/sbin",
  "/usr/local/bin",
  "/usr/sbin",
  "/usr/bin",
  "/sbin",
  "/bin"
].join(":");
const MANAGED_USERNAME_PATTERN = /^[a-z][a-z0-9_-]{0,61}[a-z0-9]$/u;
const VIBE64_GROUP = "vibe64";
const DAEMON_USERNAME_PREFIX = "v64d_";
const MANAGED_ROOT = "/var/lib/vibe64";
const RESERVED_HUMAN_USERNAMES = new Set([
  "root"
]);
const MANAGED_EXECUTION_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const MANAGED_EXECUTION_KINDS = new Set([
  "assistant",
  "browser",
  "control",
  "job",
  "preview",
  "service",
  "terminal"
]);
const MANAGED_EXECUTION_MODES = new Set([
  "capture",
  "detached",
  "pty"
]);
const MANAGED_EXECUTION_MEMORY_MIN_BYTES = 64 * 1024 * 1024;
const MANAGED_EXECUTION_MEMORY_MAX_BYTES = 64 * 1024 * 1024 * 1024;
const MANAGED_EXECUTION_WORK_MEMORY_MIN_BYTES = 256 * 1024 * 1024;
const MANAGED_EXECUTION_WORK_MEMORY_MAX_BYTES = 1024 * 1024 * 1024 * 1024;
const MANAGED_EXECUTION_TASKS_MIN = 8;
const MANAGED_EXECUTION_TASKS_MAX = 8192;
const MANAGED_EXECUTION_STOP_TIMEOUT_MS = 15_000;

main().catch((error) => {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exit(2);
});

async function main() {
  if (process.argv[2] === "run-managed") {
    await runManagedExecutionPayload(process.argv[3] || "");
    return;
  }
  if (process.argv[2] !== "execute") {
    throw new Error("Usage: vibe64-exec-helper execute [payload-json-file]");
  }
  const payload = readPayload(process.argv[3] || "");
  assertNormalizedPayload(payload);
  const operation = String(payload.operation || "").trim();
  if (!ALLOWED_OPERATIONS.has(operation)) {
    throw new Error("Vibe64 exec helper rejected an unknown operation.");
  }
  if (operation === "deployment-service") {
    handleDeploymentServiceOperation(payload);
    return;
  }
  if (operation === "managed-service") {
    handleManagedServiceOperation(payload);
    return;
  }
  if (operation === "managed-execution") {
    handleManagedExecutionOperation(payload, process.argv[3] || "");
    return;
  }
  const username = safeUsername(payload.username);
  if (operation === "create-system-user" || operation === "enable-system-user") {
    handleUserManagementOperation(operation, payload, username);
    return;
  }
  assertHumanUsername(username);
  const command = String(payload.command || "").trim();
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error("Vibe64 exec helper rejected an unknown command.");
  }
  const targetUser = resolveOsUser(username);
  assertExpectedId("uid", payload.uid, targetUser.uid);
  assertExpectedId("gid", payload.gid, targetUser.gid);
  const owner = resolveOwnerUser();
  assertEnabledForVibe64(owner, username);
  assertUserInGroup(targetUser.username, VIBE64_GROUP);
  const cwd = resolveAllowedCwd(payload.cwd || "", owner.username, {
    operation,
    targetUser
  });
  const env = helperChildEnv(payload.env || {}, targetUser, owner.username, operation);
  const args = Array.isArray(payload.args) ? payload.args.map((arg) => String(arg)) : [];
  const input = payload.inputBase64
    ? Buffer.from(String(payload.inputBase64), "base64")
    : undefined;

  process.umask(0o007);
  const child = spawnSync("runuser", [
    "-u",
    targetUser.username,
    "--",
    command,
    ...args
  ], {
    cwd,
    env,
    ...(input === undefined
      ? {
          stdio: "inherit"
        }
      : {
          input,
          stdio: ["pipe", "inherit", "inherit"]
        })
  });
  if (child.error) {
    throw child.error;
  }
  process.exit(typeof child.status === "number" ? child.status : 1);
}

function handleManagedExecutionOperation(payload = {}, requestPayloadPath = "") {
  const owner = resolveOwnerUser();
  consumeManagedExecutionRequestPayload(requestPayloadPath, owner);
  ensureGroup(VIBE64_GROUP);
  const action = String(payload.action || "").trim();
  const executionId = managedExecutionId(payload.executionId);
  const unitName = managedExecutionUnitName(executionId, owner);
  if (action === "inspect") {
    writeManagedExecutionState(unitName, executionId, owner);
    return;
  }
  if (action === "stop") {
    stopManagedExecution(unitName, executionId, owner);
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
    lifecycle
  );
  const targetUser = managedExecutionTargetUser(payload, owner);
  const commandOperation = String(payload.commandOperation || "").trim();
  const cwd = resolveAllowedCwd(payload.cwd || "", owner.username, {
    operation: commandOperation,
    targetUser
  });
  const command = String(payload.command || "").trim();
  if (!command || /[\r\n]/u.test(command)) {
    throw new Error("Vibe64 exec helper rejected an invalid managed execution command.");
  }
  if (targetUser.username !== owner.username && !ALLOWED_COMMANDS.has(path.basename(command))) {
    throw new Error("Vibe64 exec helper rejected an unsupported real-user managed command.");
  }
  const args = Array.isArray(payload.args) ? payload.args.map((arg) => String(arg)) : [];
  const env = helperChildEnv(payload.env || {}, targetUser, owner.username, commandOperation);
  let releaseEnvironmentFile = "";
  if (payload.releaseEnvironmentFile) {
    if (mode !== "capture" || targetUser.username !== owner.username) {
      throw new Error("Release environment requires finite owner execution.");
    }
    releaseEnvironmentFile = assertSafeDeploymentServicePath(payload.releaseEnvironmentFile, owner, "environmentFile");
    const file = lstatSync(releaseEnvironmentFile);
    const workspaceRoot = path.join(path.dirname(path.dirname(releaseEnvironmentFile)), "workspace");
    if (path.basename(releaseEnvironmentFile) !== "environment" ||
        path.basename(path.dirname(releaseEnvironmentFile)) !== "service" ||
        !file.isFile() || file.uid !== owner.uid || (file.mode & 0o077) !== 0 ||
        realpathSync(releaseEnvironmentFile) !== releaseEnvironmentFile ||
        realpathSync(cwd) !== cwd ||
        (cwd !== workspaceRoot && relativePathParts(workspaceRoot, cwd).length === 0)) {
      throw new Error("Release environment must belong to the selected private release.");
    }
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
  configureManagedExecutionWorkSlice(owner, {
    memoryMaxBytes: workMemoryMaxBytes,
    tasksMax: workTasksMax
  });
  ensureManagedExecutionRuntimeParents(owner);
  const executionRoot = managedExecutionRuntimeRoot(owner, executionId);
  const runnerPayloadPath = path.join(executionRoot, "command.json");
  mkdirSync(executionRoot, {
    mode: 0o700,
    recursive: true
  });
  chownSync(executionRoot, targetUser.uid, targetUser.gid);
  writeFileSync(runnerPayloadPath, `${JSON.stringify({
    args,
    command,
    controllerLeaseName,
    cwd,
    env,
    inputBase64: String(payload.inputBase64 || ""),
    inputPresent: payload.inputPresent === true,
    ...(releaseEnvironmentFile ? { releaseEnvironment: true } : {}),
    executionId,
    schema: "vibe64.managed-execution.command",
    schemaVersion: 1
  })}\n`, {
    flag: "wx",
    mode: 0o600
  });
  chmodSync(runnerPayloadPath, 0o600);
  chownSync(runnerPayloadPath, targetUser.uid, targetUser.gid);

  const helperPath = path.resolve(process.argv[1]);
  const systemdArgs = [
    "--quiet",
    `--unit=${unitName}`,
    "--service-type=exec",
    `--slice=${managedExecutionSliceName(owner)}`,
    `--property=Description=Vibe64 ${kind} execution`,
    `--property=User=${targetUser.username}`,
    `--property=Group=${VIBE64_GROUP}`,
    "--property=SupplementaryGroups=nix-users",
    "--property=UMask=0007",
    `--property=WorkingDirectory=${cwd}`,
    ...(releaseEnvironmentFile ? [`--property=EnvironmentFile=${releaseEnvironmentFile}`] : []),
    "--property=KillMode=control-group",
    "--property=ExitType=cgroup",
    "--property=OOMPolicy=stop",
    "--property=MemoryAccounting=yes",
    "--property=CPUAccounting=yes",
    "--property=IOAccounting=yes",
    "--property=TasksAccounting=yes",
    `--property=MemoryMax=${memoryMaxBytes}`,
    `--property=TasksMax=${tasksMax}`,
    "--property=TimeoutStopSec=10s",
    ...(mode === "capture" ? ["--wait", "--pipe"] : []),
    ...(mode === "pty" ? ["--wait", "--pty"] : []),
    helperPath,
    "run-managed",
    runnerPayloadPath
  ];
  const started = spawnSync("systemd-run", systemdArgs, {
    stdio: "inherit"
  });
  if (mode !== "detached" || started.error || started.status !== 0) {
    rmSync(executionRoot, {
      force: true,
      recursive: true
    });
  }
  if (started.error) {
    throw started.error;
  }
  process.exit(typeof started.status === "number" ? started.status : 1);
}

function consumeManagedExecutionRequestPayload(payloadPath = "", owner = {}) {
  const normalized = String(payloadPath || "").trim();
  if (!normalized) {
    return;
  }
  const resolved = path.resolve(normalized);
  const allowedRoot = path.join(workspaceTempRoot(owner.username), "managed-execution-payloads");
  if (relativePathParts(allowedRoot, resolved).length !== 1) {
    throw new Error("Vibe64 exec helper rejected an unsafe managed execution payload path.");
  }
  unlinkSync(resolved);
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
  process.umask(0o007);
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
  try {
    child = spawn(command, Array.isArray(payload.args) ? payload.args.map(String) : [], {
      cwd: String(payload.cwd || "/"),
      detached: Boolean(controllerLease),
      env: payload.releaseEnvironment === true
        ? helperChildEnv({ ...process.env, ...payload.env },
          { username: payload.env.USER, home: payload.env.HOME }, payload.env.USER)
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
      child.once("error", reject);
      child.once("close", (status, signal) => resolve({ signal, status }));
    });
    const status = typeof outcome.status === "number" ? outcome.status : 1;
    writeManagedExecutionResult(path.dirname(resolved), {
      ...managedRunnerCgroupMeasurements(),
      executionId: managedExecutionId(payload.executionId),
      execMainCode: outcome.signal ? "killed" : "exited",
      execMainStatus: outcome.signal || String(status),
      result: outcome.signal ? "signal" : status === 0 ? "success" : "exit-code",
      signal: String(outcome.signal || "")
    });
    process.exitCode = status;
  } finally {
    if (terminationTimer !== null) {
      clearTimeout(terminationTimer);
    }
    controllerLease?.off("close", stopForControllerLoss);
    controllerLease?.destroy();
  }
}

function managedExecutionControllerLeaseName(value = "", lifecycle = "") {
  const leaseName = String(value || "");
  if (lifecycle !== "service") {
    if (leaseName) {
      throw new Error("Vibe64 exec helper rejected a controller lease on a finite execution.");
    }
    return "";
  }
  if (!/^\0vibe64-resource-controller-[a-z][a-z0-9-]{0,62}$/u.test(leaseName)) {
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
    timeout.unref?.();
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
  timer.unref?.();
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

function configureManagedExecutionWorkSlice(owner = {}, {
  memoryMaxBytes = 0,
  tasksMax = 0
} = {}) {
  const sliceName = managedExecutionSliceName(owner);
  runRootCommand("systemctl", ["start", sliceName]);
  runRootCommand("systemctl", [
    "set-property",
    "--runtime",
    sliceName,
    `MemoryMax=${memoryMaxBytes}`,
    `TasksMax=${tasksMax}`,
    "MemoryAccounting=yes",
    "CPUAccounting=yes",
    "IOAccounting=yes",
    "TasksAccounting=yes"
  ]);
}

function managedExecutionTargetUser(payload = {}, owner = {}) {
  const username = safeUsername(payload.username || owner.username);
  const targetUser = resolveOsUser(username);
  assertExpectedId("uid", payload.uid, targetUser.uid);
  assertExpectedId("gid", payload.gid, targetUser.gid);
  if (targetUser.username !== owner.username) {
    assertHumanUsername(targetUser.username);
    assertEnabledForVibe64(owner, targetUser.username);
  }
  assertUserInGroup(targetUser.username, VIBE64_GROUP);
  return targetUser;
}

function managedExecutionId(value = "") {
  const executionId = String(value || "").trim();
  if (!MANAGED_EXECUTION_ID_PATTERN.test(executionId)) {
    throw new Error("Vibe64 exec helper rejected an invalid managed execution id.");
  }
  return executionId.toLowerCase();
}

function managedExecutionKind(value = "") {
  const kind = String(value || "").trim();
  if (!MANAGED_EXECUTION_KINDS.has(kind)) {
    throw new Error("Vibe64 exec helper rejected an unknown managed execution kind.");
  }
  return kind;
}

function managedExecutionMode(value = "") {
  const mode = String(value || "").trim();
  if (!MANAGED_EXECUTION_MODES.has(mode)) {
    throw new Error("Vibe64 exec helper rejected an unknown managed execution mode.");
  }
  return mode;
}

function managedExecutionInteger(value, minimum, maximum, label = "value") {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Vibe64 exec helper rejected an invalid managed execution ${label}.`);
  }
  return parsed;
}

function managedExecutionUnitName(executionId = "", owner = {}) {
  const workspace = workspaceFromDaemonUsername(safeUsername(owner.username));
  return `vibe64-exec-${workspace}-${managedExecutionId(executionId).replaceAll("-", "")}.service`;
}

function managedExecutionSliceName(owner = {}) {
  const workspace = workspaceFromDaemonUsername(safeUsername(owner.username));
  return `vibe64-${workspace}-work.slice`;
}

function managedExecutionRuntimeRoot(owner = {}, executionId = "") {
  return path.join(
    managedExecutionRuntimeBase(owner),
    "executions",
    managedExecutionId(executionId)
  );
}

function managedExecutionRuntimeBase(owner = {}) {
  const workspace = workspaceFromDaemonUsername(safeUsername(owner.username));
  return `/run/vibe64-${workspace}`;
}

function ensureManagedExecutionRuntimeParents(owner = {}) {
  const runtimeBase = managedExecutionRuntimeBase(owner);
  runRootCommand("install", [
    "-d",
    "-o",
    safeUsername(owner.username),
    "-g",
    VIBE64_GROUP,
    "-m",
    "2750",
    runtimeBase,
    path.join(runtimeBase, "executions")
  ]);
}

function managedExecutionResultPath(owner = {}, executionId = "") {
  return path.join(managedExecutionRuntimeRoot(owner, executionId), "result.json");
}

function readManagedExecutionResult(owner = {}, executionId = "") {
  const resultPath = managedExecutionResultPath(owner, executionId);
  try {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    return result?.schema === "vibe64.managed-execution.result" &&
      result.schemaVersion === 1 &&
      result.executionId === managedExecutionId(executionId)
      ? result
      : {};
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) {
      return {};
    }
    throw error;
  }
}

function writeManagedExecutionResult(executionRoot = "", result = {}) {
  const resultPath = path.join(executionRoot, "result.json");
  const temporaryPath = `${resultPath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, `${JSON.stringify({
    ...result,
    schema: "vibe64.managed-execution.result",
    schemaVersion: 1
  })}\n`, {
    flag: "wx",
    mode: 0o600
  });
  renameSync(temporaryPath, resultPath);
}

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
    cpuUsageNSec: String(Number(cpu.usage_usec || 0) * 1000),
    ioReadBytes: String(io.readBytes),
    ioWriteBytes: String(io.writeBytes),
    memoryCurrent: cgroupSingleValue(path.join(cgroupPath, "memory.current")),
    memoryPeak: cgroupSingleValue(path.join(cgroupPath, "memory.peak")),
    memorySwapCurrent: cgroupSingleValue(path.join(cgroupPath, "memory.swap.current")),
    oomKillCount: String(Number(memoryEvents.oom_kill || 0)),
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

function managedExecutionState(unitName = "", executionId = "", owner = {}) {
  const stateResult = runRootCommandAllowFailure("systemctl", [
    "show",
    unitName,
    "--no-pager",
    "--property=LoadState,ActiveState,SubState,Result,ExecMainCode,ExecMainStatus,MainPID,ControlGroup,MemoryCurrent,MemoryPeak,MemorySwapCurrent,TasksCurrent,TasksMax,CPUUsageNSec,IOReadBytes,IOWriteBytes"
  ]);
  const values = {};
  for (const line of String(stateResult.stdout || "").split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    if (separator > 0) {
      values[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  const controlGroup = String(values.ControlGroup || "").trim();
  const cgroupPath = controlGroup
    ? path.join("/sys/fs/cgroup", controlGroup.replace(/^\/+/, ""))
    : "";
  let scopeEmpty = true;
  if (cgroupPath && existsSync(cgroupPath)) {
    try {
      scopeEmpty = String(readFileSync(path.join(cgroupPath, "cgroup.procs"), "utf8") || "").trim() === "";
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
  const recorded = executionId ? readManagedExecutionResult(owner, executionId) : {};
  return {
    activeState: String(values.ActiveState || (recorded.executionId ? "inactive" : "unknown")),
    controlGroup,
    cpuUsageNSec: maximumCounter(values.CPUUsageNSec, recorded.cpuUsageNSec),
    execMainCode: String(values.ExecMainCode || recorded.execMainCode || ""),
    execMainStatus: String(values.ExecMainStatus || recorded.execMainStatus || ""),
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
    result: String(values.Result || recorded.result || ""),
    signal: String(recorded.signal || ""),
    scopeEmpty,
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
  process.stdout.write(`${JSON.stringify({
    executionId,
    ok: true,
    ...managedExecutionState(unitName, executionId, owner)
  })}\n`);
}

function stopManagedExecution(unitName = "", executionId = "", owner = {}) {
  const initial = managedExecutionState(unitName, executionId, owner);
  if (!initial.scopeEmpty) {
    runRootCommandAllowFailure("systemctl", [
      "kill",
      "--kill-who=all",
      "--signal=SIGTERM",
      unitName
    ]);
    runRootCommandAllowFailure("systemctl", ["stop", unitName]);
  }
  const deadline = Date.now() + MANAGED_EXECUTION_STOP_TIMEOUT_MS;
  let state = managedExecutionState(unitName, executionId, owner);
  const waitSignal = new Int32Array(new SharedArrayBuffer(4));
  while (!state.scopeEmpty && Date.now() < deadline) {
    Atomics.wait(waitSignal, 0, 0, 25);
    state = managedExecutionState(unitName, executionId, owner);
  }
  if (!state.scopeEmpty) {
    runRootCommandAllowFailure("systemctl", [
      "kill",
      "--kill-who=all",
      "--signal=SIGKILL",
      unitName
    ]);
    runRootCommandAllowFailure("systemctl", ["stop", unitName]);
    state = managedExecutionState(unitName, executionId, owner);
  }
  if (state.scopeEmpty) {
    rmSync(managedExecutionRuntimeRoot(owner, executionId), {
      force: true,
      recursive: true
    });
    runRootCommandAllowFailure("systemctl", ["reset-failed", unitName]);
  }
  process.stdout.write(`${JSON.stringify({
    executionId,
    ok: state.scopeEmpty,
    scopeEmpty: state.scopeEmpty,
    stopped: initial.scopeEmpty === false,
    ...state
  })}\n`);
  if (!state.scopeEmpty) {
    process.exit(1);
  }
}

function assertNormalizedPayload(payload = {}) {
  if (
    payload?.schema !== EXEC_HELPER_PAYLOAD_SCHEMA ||
    payload?.schemaVersion !== EXEC_HELPER_PAYLOAD_SCHEMA_VERSION
  ) {
    throw new Error("Vibe64 exec helper rejected a non-normalized execution payload.");
  }
}

function handleUserManagementOperation(operation = "", payload = {}, username = "") {
  assertHumanUsername(username);
  resolveOwnerUser();
  ensureGroup(VIBE64_GROUP);
  if (operation === "create-system-user") {
    createSystemUser(username, String(payload.password || ""));
  } else {
    resolveOsUser(username);
  }
  addUserToGroup(username, VIBE64_GROUP);
}

function handleDeploymentServiceOperation(payload = {}) {
  const owner = resolveOwnerUser();
  ensureGroup(VIBE64_GROUP);
  const action = String(payload.action || "").trim();
  const unitName = assertValidDeploymentUnitName(payload.unitName);
  if (action === "inspect") {
    inspectDeploymentServiceUnit(unitName);
    return;
  }
  if (action === "remove") {
    removeDeploymentServiceUnit(unitName);
    return;
  }
  if (action !== "install-start") {
    throw new Error("Vibe64 exec helper rejected an unknown deployment service action.");
  }
  const workingDirectory = assertSafeDeploymentServicePath(payload.workingDirectory, owner, "workingDirectory");
  const environmentFile = assertSafeDeploymentServicePath(payload.environmentFile, owner, "environmentFile");
  const startScript = assertSafeDeploymentServicePath(payload.startScript, owner, "startScript");
  const requiredUnits = [...new Set((Array.isArray(payload.requiredUnits) ? payload.requiredUnits : [])
    .map((requiredUnit) => assertValidManagedServiceUnitName(requiredUnit, owner)))];
  const unitPath = systemdUnitPath(unitName);
  const unit = deploymentServiceUnit({
    environmentFile,
    owner,
    requiredUnits,
    startScript,
    unitName,
    workingDirectory
  });
  installSystemdUnit({
    activation: "restart",
    unit,
    unitName,
    unitPath
  });
}

function inspectDeploymentServiceUnit(unitName = "") {
  assertValidDeploymentUnitName(unitName);
  const state = runRootCommand("systemctl", [
    "show",
    unitName,
    "--no-pager",
    "--property=ActiveState,SubState,Result,ExecMainCode,ExecMainStatus,NRestarts"
  ]);
  const journalResult = runRootCommandAllowFailure("journalctl", [
    "--unit",
    unitName,
    "--no-pager",
    "--output=cat",
    "--lines=80"
  ]);
  const journal = String(journalResult.stdout || journalResult.stderr || "").trim();
  process.stdout.write([
    "Service state:",
    state,
    ...(journal ? ["", "Recent service output:", journal] : [])
  ].join("\n") + "\n");
}

function handleManagedServiceOperation(payload = {}) {
  const owner = resolveOwnerUser();
  ensureGroup(VIBE64_GROUP);
  const action = String(payload.action || "").trim();
  const unitName = assertValidManagedServiceUnitName(payload.unitName, owner);
  if (action !== "install-start") {
    throw new Error("Vibe64 exec helper rejected an unknown managed service action.");
  }
  const workingDirectory = assertSafeManagedServicePath(payload.workingDirectory, owner, "workingDirectory");
  const startScript = assertSafeManagedServicePath(payload.startScript, owner, "startScript");
  const processModel = assertValidManagedServiceProcessModel(payload.processModel);
  const pidFile = processModel === "forking"
    ? resolveAllowedManagedServicePath(payload.pidFile, owner)
    : "";
  const unitPath = managedSystemdUnitPath(unitName, owner);
  const unit = managedServiceUnit({
    owner,
    pidFile,
    processModel,
    startScript,
    unitName,
    workingDirectory
  });
  ensureManagedServiceProcessOwnership({
    owner,
    pidFile,
    unitName
  });
  installSystemdUnit({
    activation: "start",
    unit,
    unitName,
    unitPath
  });
}

function ensureManagedServiceProcessOwnership({
  owner = {},
  pidFile = "",
  unitName = ""
} = {}) {
  if (!pidFile || !existsSync(pidFile)) {
    return;
  }
  const pidText = String(readFileSync(pidFile, "utf8") || "").trim();
  if (!/^[1-9][0-9]*$/u.test(pidText)) {
    throw new Error("Vibe64 managed service PID file is invalid.");
  }
  const pid = Number(pidText);
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    throw new Error("Vibe64 managed service PID is invalid.");
  }
  if (!processIsRunning(pid)) {
    removeManagedServicePidFile(pidFile, pidText);
    return;
  }
  const processUid = processRealUid(pid);
  if (processUid === null) {
    removeManagedServicePidFile(pidFile, pidText);
    return;
  }
  if (processUid !== owner.uid) {
    throw new Error("Vibe64 managed service PID belongs to another OS user.");
  }
  if (processBelongsToSystemdUnit(pid, unitName)) {
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error?.code === "ESRCH") {
      removeManagedServicePidFile(pidFile, pidText);
      return;
    }
    throw error;
  }
  const deadline = Date.now() + 30_000;
  const waitSignal = new Int32Array(new SharedArrayBuffer(4));
  while (processIsRunning(pid) && Date.now() < deadline) {
    Atomics.wait(waitSignal, 0, 0, 100);
  }
  if (processIsRunning(pid)) {
    throw new Error("Vibe64 managed service process did not stop cleanly during ownership transfer.");
  }
  removeManagedServicePidFile(pidFile, pidText);
}

function removeManagedServicePidFile(pidFile = "", expectedPid = "") {
  if (existsSync(pidFile) && String(readFileSync(pidFile, "utf8") || "").trim() === expectedPid) {
    unlinkSync(pidFile);
  }
}

function processIsRunning(pid = 0) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

function processRealUid(pid = 0) {
  let status = "";
  try {
    status = readFileSync(`/proc/${pid}/status`, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const match = String(status || "").match(/^Uid:\s+([0-9]+)/mu);
  const uid = Number(match?.[1]);
  if (!Number.isSafeInteger(uid)) {
    throw new Error("Vibe64 managed service process UID is unavailable.");
  }
  return uid;
}

function processBelongsToSystemdUnit(pid = 0, unitName = "") {
  const suffix = `/${unitName}`;
  let cgroup = "";
  try {
    cgroup = readFileSync(`/proc/${pid}/cgroup`, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
  return String(cgroup || "")
    .split("\n")
    .some((line) => line.trim().endsWith(suffix));
}

function installSystemdUnit({
  activation = "start",
  unit = "",
  unitName = "",
  unitPath = ""
} = {}) {
  if (activation !== "start" && activation !== "restart") {
    throw new Error("Vibe64 exec helper rejected an unsupported systemd activation.");
  }
  const temporaryUnitPath = `${unitPath}.tmp-${process.pid}`;
  writeFileSync(temporaryUnitPath, unit, {
    mode: 0o644
  });
  try {
    runRootCommand("mv", [
      temporaryUnitPath,
      unitPath
    ]);
  } catch (error) {
    try {
      unlinkSync(temporaryUnitPath);
    } catch {
      // Ignore cleanup failure after the real install error.
    }
    throw error;
  }
  runRootCommand("systemctl", [
    "daemon-reload"
  ]);
  runRootCommand("systemctl", [
    "enable",
    unitName
  ]);
  runRootCommandAllowFailure("systemctl", [
    "reset-failed",
    unitName
  ]);
  try {
    runRootCommand("systemctl", [
      activation,
      unitName
    ]);
  } catch (error) {
    runRootCommandAllowFailure("systemctl", [
      "stop",
      unitName
    ]);
    throw error;
  }
}

function removeDeploymentServiceUnit(unitName = "") {
  assertValidDeploymentUnitName(unitName);
  runRootCommandAllowFailure("systemctl", [
    "stop",
    unitName
  ]);
  runRootCommandAllowFailure("systemctl", [
    "disable",
    unitName
  ]);
  runRootCommandAllowFailure("systemctl", [
    "reset-failed",
    unitName
  ]);
  try {
    unlinkSync(systemdUnitPath(unitName));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  runRootCommand("systemctl", [
    "daemon-reload"
  ]);
}

function readPayload(payloadPath = "") {
  const input = payloadPath
    ? readFileSync(path.resolve(payloadPath), "utf8")
    : readStdin();
  if (Buffer.byteLength(input, "utf8") > INPUT_LIMIT_BYTES) {
    throw new Error("Vibe64 exec helper payload is too large.");
  }
  const payload = JSON.parse(input);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Vibe64 exec helper payload must be a JSON object.");
  }
  return payload;
}

function readStdin() {
  const chunks = [];
  const buffer = Buffer.allocUnsafe(STDIN_READ_BUFFER_BYTES);
  const retrySignal = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + STDIN_READ_TIMEOUT_MS;
  let totalBytes = 0;

  while (true) {
    try {
      const bytesRead = readSync(0, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }
      totalBytes += bytesRead;
      if (totalBytes > INPUT_LIMIT_BYTES) {
        throw new Error("Vibe64 exec helper payload is too large.");
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    } catch (error) {
      if (error?.code === "EINTR") {
        continue;
      }
      if (
        (error?.code === "EAGAIN" || error?.code === "EWOULDBLOCK") &&
        Date.now() < deadline
      ) {
        Atomics.wait(retrySignal, 0, 0, STDIN_READ_RETRY_DELAY_MS);
        continue;
      }
      if (error?.code === "EAGAIN" || error?.code === "EWOULDBLOCK") {
        throw new Error("Vibe64 exec helper timed out waiting for its payload.");
      }
      throw error;
    }
  }

  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

function safeUsername(value = "") {
  const username = String(value || "").trim();
  if (!username || /[/:\\\r\n]/u.test(username)) {
    throw new Error("Vibe64 exec helper rejected an unsafe username.");
  }
  return username;
}

function assertManagedUsername(username = "") {
  if (!MANAGED_USERNAME_PATTERN.test(username)) {
    throw new Error("Vibe64 exec helper rejected an unsupported username.");
  }
}

function assertHumanUsername(username = "") {
  assertManagedUsername(username);
  if (username.startsWith(DAEMON_USERNAME_PREFIX)) {
    throw new Error("Vibe64 daemon Unix accounts cannot be managed as app users.");
  }
  if (RESERVED_HUMAN_USERNAMES.has(username)) {
    throw new Error("Privileged Unix accounts cannot be managed as Vibe64 app users.");
  }
}

function resolveOsUser(username = "") {
  const result = spawnSync("getent", ["passwd", username], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`OS user was not found: ${username}`);
  }
  const line = String(result.stdout || "").split(/\r?\n/u)[0];
  const parts = line.split(":");
  if (parts.length < 7 || parts[0] !== username) {
    throw new Error(`OS user was not found: ${username}`);
  }
  const uid = Number(parts[2]);
  const gid = Number(parts[3]);
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid)) {
    throw new Error(`OS user has invalid uid/gid: ${username}`);
  }
  return {
    gid,
    home: parts[5],
    uid,
    username
  };
}

function resolveOwnerUser() {
  const sudoUser = safeUsername(process.env.SUDO_USER || "");
  return resolveOsUser(sudoUser);
}

function assertUserInGroup(username = "", groupName = "") {
  const result = spawnSync("id", ["-nG", username], {
    encoding: "utf8"
  });
  const groups = String(result.stdout || "").trim().split(/\s+/u);
  if (result.status !== 0 || !groups.includes(groupName)) {
    throw new Error(`OS user is not enabled for the shared Vibe64 group: ${username}`);
  }
}

function tryResolveOsUser(username = "") {
  try {
    return resolveOsUser(username);
  } catch {
    return null;
  }
}

function ensureGroup(groupName = "") {
  const result = spawnSync("getent", ["group", groupName], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`Required OS group was not found: ${groupName}`);
  }
}

function createSystemUser(username = "", password = "") {
  if (tryResolveOsUser(username)) {
    throw new Error(`OS user already exists: ${username}`);
  }
  if (!password || /[\r\n]/u.test(password)) {
    throw new Error("A valid initial password is required to create an OS user.");
  }
  runRootCommand("useradd", [
    "--create-home",
    "--user-group",
    "--shell",
    "/bin/bash",
    username
  ]);
  const passwordResult = spawnSync("chpasswd", {
    encoding: "utf8",
    input: `${username}:${password}\n`
  });
  if (passwordResult.status !== 0) {
    throw new Error(String(passwordResult.stderr || passwordResult.stdout || "Could not set OS user password.").trim());
  }
}

function addUserToGroup(username = "", groupName = "") {
  runRootCommand("usermod", [
    "-a",
    "-G",
    groupName,
    username
  ]);
}

function runRootCommand(command = "", args = []) {
  const result = spawnSync(command, args, {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `${command} failed.`).trim());
  }
  return String(result.stdout || "").trim();
}

function runRootCommandAllowFailure(command = "", args = []) {
  return spawnSync(command, args, {
    encoding: "utf8"
  });
}

function assertSafeDeploymentServicePath(candidatePath = "", owner = {}, label = "path") {
  const resolved = resolveAllowedDeploymentServicePath(candidatePath, owner);
  if (!existsSync(resolved)) {
    throw new Error(`Vibe64 deployment service ${label} does not exist.`);
  }
  return resolved;
}

function assertSafeManagedServicePath(candidatePath = "", owner = {}, label = "path") {
  const resolved = resolveAllowedManagedServicePath(candidatePath, owner);
  if (!existsSync(resolved)) {
    throw new Error(`Vibe64 managed service ${label} does not exist.`);
  }
  return resolved;
}

function managedServiceRoot(owner = {}) {
  const username = safeUsername(owner.username);
  const workspace = workspaceFromDaemonUsername(username);
  if (!workspace) {
    throw new Error("Vibe64 exec helper could not resolve the managed service workspace.");
  }
  return path.join("/var/lib/vibe64", workspace, "services");
}

function resolveAllowedManagedServicePath(candidatePath = "", owner = {}) {
  const normalized = String(candidatePath || "").trim();
  if (!normalized) {
    throw new Error("Vibe64 exec helper rejected an empty managed service path.");
  }
  const resolved = path.resolve(normalized);
  if (relativePathParts(managedServiceRoot(owner), resolved).length > 0) {
    return resolved;
  }
  throw new Error("Vibe64 exec helper rejected a managed service path outside the workspace service root.");
}

function resolveAllowedDeploymentServicePath(candidatePath = "", owner = {}) {
  const normalized = String(candidatePath || "").trim();
  if (!normalized) {
    throw new Error("Vibe64 exec helper rejected an empty deployment service path.");
  }
  const resolved = path.resolve(normalized);
  const releaseStateRoot = path.join(String(owner.home || "").trim(), ".local", "state", "vibe64", "projects");
  if (pathIsDeploymentReleasePath(releaseStateRoot, resolved)) {
    return resolved;
  }
  throw new Error("Vibe64 exec helper rejected a deployment service path outside managed roots.");
}

function pathIsDeploymentReleasePath(releaseStateRoot = "", candidatePath = "") {
  const parts = relativePathParts(releaseStateRoot, candidatePath);
  return parts.length >= 5 &&
    parts[1] === "deployments" &&
    parts[2] === "releases" &&
    (parts[4] === "artifact" || parts[4] === "service");
}

function relativePathParts(parentPath = "", childPath = "") {
  const parent = String(parentPath || "").trim();
  const child = String(childPath || "").trim();
  if (!parent || !child) {
    return [];
  }
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return [];
  }
  return relative.split(path.sep).filter(Boolean);
}

function assertValidDeploymentUnitName(unitName = "") {
  const normalized = String(unitName || "").trim();
  if (
    !normalized.startsWith("vibe64-release-") ||
    !normalized.endsWith(".service") ||
    !/^[A-Za-z0-9_.@:-]+$/u.test(normalized) ||
    normalized.includes("/") ||
    normalized.includes("..")
  ) {
    throw new Error("Vibe64 exec helper rejected an unsafe deployment service unit name.");
  }
  return normalized;
}

function assertValidManagedServiceUnitName(unitName = "", owner = {}) {
  const normalized = String(unitName || "").trim();
  const workspace = path.basename(path.dirname(managedServiceRoot(owner)));
  if (
    !normalized.startsWith(`vibe64-managed-${workspace}-`) ||
    !normalized.endsWith(".service") ||
    !/^[A-Za-z0-9_.@:-]+$/u.test(normalized) ||
    normalized.includes("/") ||
    normalized.includes("..")
  ) {
    throw new Error("Vibe64 exec helper rejected an unsafe managed service unit name.");
  }
  return normalized;
}

function assertValidManagedServiceProcessModel(value = "") {
  const processModel = String(value || "").trim();
  if (processModel !== "forking" && processModel !== "simple") {
    throw new Error("Vibe64 exec helper rejected an unsupported managed service process model.");
  }
  return processModel;
}

function systemdUnitPath(unitName = "") {
  return path.join("/etc/systemd/system", assertValidDeploymentUnitName(unitName));
}

function managedSystemdUnitPath(unitName = "", owner = {}) {
  return path.join("/etc/systemd/system", assertValidManagedServiceUnitName(unitName, owner));
}

function serviceAccountUnitLines(owner = {}) {
  return [
    `User=${systemdUnitSafeValue(owner.username)}`,
    `Group=${VIBE64_GROUP}`,
    "SupplementaryGroups=nix-users",
    "UMask=0007"
  ];
}

function serviceResourceUnitLines(owner = {}) {
  const workspace = workspaceFromDaemonUsername(safeUsername(owner.username));
  return [
    `Slice=vibe64-${workspace}-work.slice`,
    "MemoryAccounting=yes",
    "CPUAccounting=yes",
    "IOAccounting=yes",
    "TasksAccounting=yes",
    "KillMode=control-group",
    "OOMPolicy=stop"
  ];
}

function deploymentServiceUnit({
  environmentFile = "",
  owner = {},
  requiredUnits = [],
  startScript = "",
  unitName = "",
  workingDirectory = ""
} = {}) {
  const dependencies = Array.isArray(requiredUnits) ? requiredUnits : [];
  return [
    "[Unit]",
    `Description=Vibe64 release service ${unitName}`,
    `After=${["network-online.target", ...dependencies].join(" ")}`,
    "Wants=network-online.target",
    ...(dependencies.length > 0 ? [`Requires=${dependencies.join(" ")}`] : []),
    "StartLimitIntervalSec=60",
    "StartLimitBurst=5",
    "",
    "[Service]",
    "Type=simple",
    ...serviceAccountUnitLines(owner),
    ...serviceResourceUnitLines(owner),
    `WorkingDirectory=${systemdUnitSafeValue(workingDirectory)}`,
    `EnvironmentFile=${systemdUnitSafeValue(environmentFile)}`,
    `Environment=PATH=${systemdUnitSafeValue(DEFAULT_PATH)}`,
    `Environment=TMPDIR=${systemdUnitSafeValue(workspaceTempRoot(owner.username))}`,
    `ExecStart=${systemdUnitSafeValue(startScript)}`,
    "Restart=always",
    "RestartSec=3",
    "KillSignal=SIGTERM",
    "TimeoutStopSec=30",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    ""
  ].join("\n");
}

function managedServiceUnit({
  owner = {},
  pidFile = "",
  processModel = "simple",
  startScript = "",
  unitName = "",
  workingDirectory = ""
} = {}) {
  const normalizedProcessModel = assertValidManagedServiceProcessModel(processModel);
  return [
    "[Unit]",
    `Description=Vibe64 managed service ${unitName}`,
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    `Type=${normalizedProcessModel}`,
    ...serviceAccountUnitLines(owner),
    ...serviceResourceUnitLines(owner),
    `WorkingDirectory=${systemdUnitSafeValue(workingDirectory)}`,
    `Environment=PATH=${systemdUnitSafeValue(DEFAULT_PATH)}`,
    `Environment=TMPDIR=${systemdUnitSafeValue(workspaceTempRoot(owner.username))}`,
    `ExecStart=${systemdUnitSafeValue(startScript)}`,
    ...(normalizedProcessModel === "forking" ? [`PIDFile=${systemdUnitSafeValue(pidFile)}`] : []),
    "Restart=on-failure",
    "RestartSec=3",
    "TimeoutStartSec=90",
    "TimeoutStopSec=30",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    ""
  ].join("\n");
}

function systemdUnitSafeValue(value = "") {
  const text = String(value || "").trim();
  if (!text || /[\r\n]/u.test(text)) {
    throw new Error("Vibe64 exec helper rejected an unsafe systemd value.");
  }
  return text.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function assertExpectedId(name = "uid", expected = null, actual = null) {
  const normalizedExpected = Number(expected);
  if (Number.isSafeInteger(normalizedExpected) && normalizedExpected !== actual) {
    throw new Error(`Vibe64 exec helper ${name} mismatch.`);
  }
}

function assertEnabledForVibe64(owner = {}, username = "") {
  const membershipPath = path.join(owner.home, ".local", "state", "vibe64", "users", `${username}.json`);
  const membership = JSON.parse(readFileSync(membershipPath, "utf8"));
  if (membership?.username !== username || membership?.status !== "active") {
    throw new Error("OS user is not enabled for Vibe64.");
  }
}

function resolveAllowedCwd(cwd = "", ownerUsername = "", {
  operation = "",
  targetUser = {}
} = {}) {
  if (operation === "health-status") {
    return workspaceTempRoot(ownerUsername);
  }
  const normalized = String(cwd || "").trim();
  if (!normalized) {
    return "/";
  }
  if (
    operation === "account-auth-terminal" ||
    operation === "account-status" ||
    operation === "github-api-command"
  ) {
    return resolveAllowedUserHomePath(normalized, targetUser);
  }
  if (
    operation === "vibe64-command" &&
    targetUser.username === ownerUsername
  ) {
    const resolved = path.resolve(normalized);
    const ownerProjectStateRoot = path.join(
      targetUser.home,
      ".local",
      "state",
      "vibe64",
      "projects"
    );
    if (
      resolved === ownerProjectStateRoot ||
      resolved.startsWith(`${ownerProjectStateRoot}${path.sep}`)
    ) {
      return resolved;
    }
  }
  if (operation === "codex-app-server" || operation === "opencode-app-server") {
    const resolved = path.resolve(normalized);
    const targetUid = Number(targetUser.uid);
    const runtimeBases = [managedExecutionRuntimeBase({ username: ownerUsername })];
    if (Number.isSafeInteger(targetUid) && targetUid >= 0) {
      runtimeBases.push(path.join("/run/user", String(targetUid)));
    }
    for (const runtimeBase of runtimeBases) {
      const runtimeRoot = path.join(runtimeBase, "vibe64", "agent-providers");
      const parts = relativePathParts(runtimeRoot, resolved);
      const providerRoot = parts[0];
      const allowedProviderRoot = operation === "opencode-app-server"
        ? providerRoot === "opencode"
        : providerRoot === "codex-app-server" ||
          /^codex-app-server-[a-f0-9]{12}$/u.test(providerRoot);
      const exactCodexRoot = operation === "codex-app-server" && parts.length === 1;
      const exactProviderWorkspace = parts.length === 2 && parts[1] === "workspace";
      if (allowedProviderRoot && (exactCodexRoot || exactProviderWorkspace)) {
        return resolved;
      }
    }
  }
  return resolveAllowedProjectPath(normalized, ownerUsername);
}

function resolveAllowedProjectPath(candidatePath = "", ownerUsername = "") {
  const normalized = String(candidatePath || "").trim();
  if (!normalized) {
    throw new Error("Vibe64 exec helper rejected an empty managed project path.");
  }
  const resolved = path.resolve(normalized);
  const allowedProjectsRoot = path.join("/var/lib/vibe64", workspaceFromDaemonUsername(ownerUsername), "projects");
  if (resolved.startsWith(`${allowedProjectsRoot}${path.sep}`)) {
    return resolved;
  }
  throw new Error("Vibe64 exec helper rejected a command path outside the owner project root.");
}

function resolveAllowedUserHomePath(candidatePath = "", targetUser = {}) {
  const normalized = String(candidatePath || "").trim();
  const home = String(targetUser.home || "").trim();
  if (!normalized || !home) {
    throw new Error("Vibe64 exec helper rejected an empty user command path.");
  }
  const resolved = path.resolve(normalized);
  const allowedHome = path.resolve(home);
  if (resolved === allowedHome || resolved.startsWith(`${allowedHome}${path.sep}`)) {
    return resolved;
  }
  throw new Error("Vibe64 exec helper rejected a command path outside the target user home.");
}

function workspaceFromDaemonUsername(username = "") {
  return username.startsWith(DAEMON_USERNAME_PREFIX)
    ? username.slice(DAEMON_USERNAME_PREFIX.length)
    : username;
}

function workspaceTempRoot(ownerUsername = "") {
  return path.join(
    MANAGED_ROOT,
    workspaceFromDaemonUsername(safeUsername(ownerUsername)),
    "tmp"
  );
}

function helperChildEnv(input = {}, targetUser = {}, ownerUsername = "", operation = "") {
  const env = {
    PATH: DEFAULT_PATH,
    TERM: process.env.TERM || "xterm-256color"
  };
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_ENV_NAME_PATTERN.test(key) || BLOCKED_ENV_NAMES.has(key) || key.startsWith("LD_") || key.startsWith("DYLD_")) {
      continue;
    }
    env[key] = String(value);
  }
  if (operation === "opencode-app-server") {
    const providerRoot = path.join(
      managedExecutionRuntimeBase({ username: ownerUsername }),
      "vibe64",
      "agent-providers",
      "opencode"
    );
    for (const name of [
      "HOME",
      "XDG_CACHE_HOME",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_STATE_HOME"
    ]) {
      const requested = String(input[name] || "").trim();
      if (!path.isAbsolute(requested) || relativePathParts(providerRoot, requested).length === 0) {
        throw new Error(`Vibe64 exec helper rejected OpenCode ${name} outside its provider runtime.`);
      }
      env[name] = path.resolve(requested);
    }
  } else {
    env.HOME = targetUser.home;
    env.XDG_CACHE_HOME = path.join(targetUser.home, ".cache");
    env.XDG_CONFIG_HOME = path.join(targetUser.home, ".config");
    env.XDG_DATA_HOME = path.join(targetUser.home, ".local", "share");
  }
  env.LOGNAME = targetUser.username;
  env.USER = targetUser.username;
  env.TMPDIR = workspaceTempRoot(ownerUsername);
  return env;
}
