#!/opt/vibe64/runtime-packs/node26/bin/node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fchmodSync,
  fchownSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { createConnection } from "node:net";
import { constants as osConstants } from "node:os";
import process from "node:process";

const INPUT_LIMIT_BYTES = 1024 * 1024;
const DIRECTORY_NO_FOLLOW = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW;
const NEW_FILE_NO_FOLLOW = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW;
// Never through a link, and never waiting on a FIFO.
const FILE_NO_FOLLOW = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;
const MANAGED_EXECUTION_REQUEST_PAYLOAD_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u;
const MANAGED_EXECUTION_RESULT_LIMIT_BYTES = 64 * 1024;
const MEMBERSHIP_LIMIT_BYTES = 64 * 1024;
const PID_FILE_LIMIT_BYTES = 64;
const STDIN_READ_BUFFER_BYTES = 64 * 1024;
const STDIN_READ_RETRY_DELAY_MS = 10;
const STDIN_READ_TIMEOUT_MS = 15_000;
const EXEC_HELPER_PAYLOAD_SCHEMA = "vibe64.exec-helper.payload";
const EXEC_HELPER_PAYLOAD_SCHEMA_VERSION = 1;
const ALLOWED_OPERATIONS = new Set([
  "account-auth-terminal",
  "application-account",
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
  "vibe64-command",
  "workspace-cache-command"
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
  "GCONV_PATH",
  "GETCONF_DIR",
  "GLIBC_TUNABLES",
  "HOSTALIASES",
  "LOCALDOMAIN",
  "LD_AUDIT",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "LOCPATH",
  "MALLOC_TRACE",
  "NIS_PATH",
  "NLSPATH",
  "NODE_OPTIONS",
  "RESOLV_HOST_CONF",
  "RES_OPTIONS",
  "TZDIR"
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
  "/opt/vibe64/runtime-packs/awsebcli/bin",
  "/opt/vibe64/runtime-packs/cpp/bin",
  "/opt/vibe64/runtime-packs/python/bin",
  "/opt/vibe64/runtime-packs/ruby/bin",
  "/opt/vibe64/runtime-packs/go/bin",
  "/opt/vibe64/runtime-packs/java/bin",
  "/opt/vibe64/runtime-packs/kotlin/bin",
  "/opt/vibe64/runtime-packs/csharp/bin",
  "/opt/vibe64/runtime-packs/rust/bin",
  "/opt/vibe64/runtime-packs/mariadb/bin",
  "/opt/vibe64/runtime-packs/postgresql/bin",
  "/opt/vibe64/runtime-packs/sqlite/bin",
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
const HOST_SETTINGS_ROOT = "/etc/vibe64";
const PERSON_REGISTRY_ROOT = path.join(HOST_SETTINGS_ROOT, "people");
const PERSON_REGISTRATION_SCHEMA = "vibe64.person-registration";
const PERSON_REGISTRATION_LIMIT_BYTES = 4096;
const PERSON_REFUSED_EXIT_CODE = 3;
// The host's own narrow sudo commands for its people, one per line exactly as
// `sudo -l` prints them, in a file only root can change.
const PERSON_SUDO_COMMANDS_FILE = "/etc/vibe64/person-sudo-commands";
// Members of these groups administer the host or can become root without sudo:
// through the group's own files or devices (disk, kmem, root, shadow, staff's
// /usr/local), a container or VM daemon (docker, incus, libvirt, lxd), or the
// administrators' logs (adm).
const ADMINISTRATOR_GROUPS = new Set([
  "adm",
  "admin",
  "disk",
  "docker",
  "incus",
  "incus-admin",
  "kmem",
  "libvirt",
  "lxd",
  "root",
  "shadow",
  "staff",
  "sudo",
  "wheel"
]);
const APPLICATION_USERNAME_PREFIX = "v64a_";
const APPLICATION_USERNAME_PATTERN = new RegExp(`^${APPLICATION_USERNAME_PREFIX}[a-f0-9]{12}$`, "u");
const APPLICATION_REGISTRY_ROOT = path.join(HOST_SETTINGS_ROOT, "applications");
const APPLICATION_REGISTRATION_SCHEMA = "vibe64.application-account";
const APPLICATION_AREA_ROOT = "/var/lib/vibe64-apps";
const SYSTEMD_UNIT_ROOT = "/etc/systemd/system";
const CONTROLLER_LEASE_NAME = "resource-controller.sock";
const APPLICATION_RECEIPTS_ROOT = "/run/vibe64-applications";
const APPLICATION_SHELL = "/usr/sbin/nologin";
const APPLICATION_PROJECT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/u;
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
const MANAGED_EXECUTION_MEMORY_MAX_BYTES = 1024 * 1024 * 1024 * 1024;
const MANAGED_EXECUTION_WORK_MEMORY_MIN_BYTES = 256 * 1024 * 1024;
const MANAGED_EXECUTION_WORK_MEMORY_MAX_BYTES = 1024 * 1024 * 1024 * 1024;
const MANAGED_EXECUTION_TASKS_MIN = 8;
const MANAGED_EXECUTION_TASKS_MAX = 8192;
const MANAGED_EXECUTION_STOP_TIMEOUT_MS = 15_000;
const MANAGED_EXECUTION_RELEASE_KEEP_MAX = 4096;

async function main() {
  if (process.argv[2] === "run-managed") {
    await runManagedExecutionPayload(process.argv[3] || "");
    return;
  }
  if (process.argv[2] === "run-release-service") {
    runReleaseService(process.argv[3] || "", process.argv[4] || "");
    return;
  }
  // Root-only: the daemon's sudo rule names only
  // `execute`, so it can never register a person itself.
  if (process.argv[2] === "upgrade-person-registry") {
    if (process.argv.length !== 4) {
      throw new Error("Usage: vibe64-exec-helper upgrade-person-registry <workspace>");
    }
    upgradePersonRegistry(process.argv[3]);
    return;
  }
  if (process.argv[2] === "register-person") {
    if (process.argv.length !== 5) {
      throw new Error("Usage: vibe64-exec-helper register-person <workspace> <username>");
    }
    registerPerson(process.argv[3], process.argv[4]);
    return;
  }
  // Exits 0 for an account Vibe64 may act as, and 3 with the reason for one it
  // never may, so host setup can hand an owner's administration to another
  // account first and SSH access can refuse an administrator.
  if (process.argv[2] === "check-person") {
    if (process.argv.length !== 4) {
      throw new Error("Usage: vibe64-exec-helper check-person <username>");
    }
    assertHumanUsername(process.argv[3]);
    assertPersonAccount(resolveOsUser(process.argv[3]), hostPersonFacts(process.argv[3]));
    return;
  }
  if (process.argv[2] !== "execute" || process.argv.length > 4) {
    throw new Error("Usage: vibe64-exec-helper execute [payload-json-file]");
  }
  const payloadPath = process.argv[3] || "";
  const payload = payloadPath
    ? consumeManagedExecutionRequestPayload(payloadPath, resolveOwnerUser())
    : readPayload();
  assertNormalizedPayload(payload);
  const operation = String(payload.operation || "").trim();
  if (!ALLOWED_OPERATIONS.has(operation)) {
    throw new Error("Vibe64 exec helper rejected an unknown operation.");
  }
  if (payloadPath && operation !== "managed-execution") {
    throw new Error("Vibe64 exec helper accepts a payload file only for a managed execution.");
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
    handleManagedExecutionOperation(payload);
    return;
  }
  if (operation === "application-account") {
    handleApplicationAccountOperation(payload);
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
  assertActablePerson(owner, targetUser);
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
  const child = runUserCommand(targetUser, command, args, {
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

function runUserCommand(targetUser, command, args, options) {
  // The caller's command PATH must only take effect after runuser drops root.
  // No new privileges: sudo, su and other setuid programs cannot raise the
  // person's command back above that person.
  return spawnSync("/usr/bin/setpriv", [
    "--no-new-privs", "--", "/usr/sbin/runuser",
    "-u", targetUser.username, "--", "/usr/bin/env", "--",
    `PATH=${options.env.PATH}`, command, ...args
  ], {
    ...options,
    env: { ...options.env, PATH: DEFAULT_PATH }
  });
}

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
  receipts.create(executionId, targetUser, {
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
  const receiptRoot = application
    ? path.join(applicationExecutionReceiptsRoot(owner), managedExecutionId(executionId))
    : managedExecutionRuntimeRoot(owner, executionId);
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

// A caller whose terminal holds the helper's standard input passes that
// execution's payload as a file in its workspace's payload directory instead.
// That directory sits in the workspace's shared temporary directory, which
// other users can rearrange, so root opens it without following links, reads
// only the daemon's own regular file there and removes it through the same
// open directory.
function consumeManagedExecutionRequestPayload(payloadPath = "", owner = {}, { managedRoot = MANAGED_ROOT } = {}) {
  const workspaceRoot = path.join(managedRoot, workspaceFromDaemonUsername(safeUsername(owner.username)));
  const parts = ["tmp", "managed-execution-payloads"];
  const name = path.basename(String(payloadPath));
  if (payloadPath !== path.join(workspaceRoot, ...parts, name) || !MANAGED_EXECUTION_REQUEST_PAYLOAD_NAME_PATTERN.test(name)) {
    throw new Error("Vibe64 exec helper rejected an unsafe managed execution payload path.");
  }
  const directory = openDirectoryBelow(workspaceRoot, parts);
  try {
    if (fstatSync(directory).uid !== owner.uid) {
      throw new Error("Vibe64 exec helper refused a managed execution payload directory owned by another user.");
    }
    const input = readOwnedFile(directory, name, { maxBytes: INPUT_LIMIT_BYTES, uid: owner.uid });
    unlinkSync(openedPath(directory, name));
    return parsePayload(input);
  } finally {
    closeSync(directory);
  }
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

function managedExecutionTargetUser(payload = {}, owner = {}, {
  assertInGroup = assertUserInGroup,
  resolveUser = resolveOsUser
} = {}) {
  if (payload.applicationAccount === true) {
    const application = registeredApplicationUser(owner, payload.username);
    assertExpectedId("uid", payload.uid, application.uid);
    assertExpectedId("gid", payload.gid, application.gid);
    return application;
  }
  const username = safeUsername(payload.username || owner.username);
  // The daemon was resolved by this process moments ago; most executions run as it.
  const targetUser = username === owner.username ? owner : resolveUser(username);
  assertExpectedId("uid", payload.uid, targetUser.uid);
  assertExpectedId("gid", payload.gid, targetUser.gid);
  if (targetUser.username !== owner.username) {
    assertActablePerson(owner, targetUser);
  } else {
    assertInGroup(targetUser.username, VIBE64_GROUP);
  }
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

// A person's or the daemon's execution runs as a member of the shared group;
// an application's only as itself, inside its sandbox, where its area and its
// receipt are all it may write.
function accountUnitLines(targetUser = {}, { receiptRoot = "" } = {}) {
  if (!targetUser.application) {
    return [
      `User=${targetUser.username}`,
      `Group=${VIBE64_GROUP}`,
      "SupplementaryGroups=nix-users",
      "UMask=0007"
    ];
  }
  return [
    `User=${targetUser.username}`,
    `Group=${targetUser.username}`,
    "UMask=0077",
    ...applicationSandboxLines(targetUser.application, [receiptRoot])
  ];
}

function applicationExecutionReceiptsRoot(owner = {}) {
  return path.join(APPLICATION_RECEIPTS_ROOT, workspaceFromDaemonUsername(safeUsername(owner.username)));
}

// A workspace's application executions keep their receipts in root's own
// runtime directory, which their accounts only traverse: they are in no group
// that reaches the daemon's runtime directory. Only root writes in /run, so
// root makes that directory itself, with no process.
function openApplicationExecutionReceipts(owner = {}, { create = false } = {}) {
  if (create) {
    try { mkdirSync(APPLICATION_RECEIPTS_ROOT); } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    chmodSync(APPLICATION_RECEIPTS_ROOT, 0o711);
  }
  return openManagedExecutionReceipts(applicationExecutionReceiptsRoot(owner), { create, mode: 0o711 });
}

// Every receipt of a workspace: its daemon's and people's, and its applications'.
function openAllExecutionReceipts(owner = {}) {
  const workspace = openWorkspaceExecutionReceipts(owner);
  let applications;
  try {
    applications = openApplicationExecutionReceipts(owner);
  } catch (error) {
    workspace.close();
    throw error;
  }
  const both = [workspace, applications];
  return {
    close: () => both.forEach((receipts) => receipts.close()),
    entries: () => both.flatMap((receipts) => receipts.entries()),
    remove: (executionId) => both.forEach((receipts) => receipts.remove(executionId)),
    result: (executionId) => both.map((receipts) => receipts.result(executionId)).find((result) => result.executionId) || {}
  };
}

// The workspace's execution receipts in its daemon's runtime directory. Only
// creating one makes the directories, with the shared group's id its caller
// read; stopping and releasing find none there when there is none.
function openWorkspaceExecutionReceipts(owner = {}, { create = false, gid = null } = {}) {
  const runtimeBase = managedExecutionRuntimeBase(owner);
  if (create) {
    ensureWorkspaceRuntimeBase(runtimeBase, { gid, uid: owner.uid });
  }
  return openManagedExecutionReceipts(path.join(runtimeBase, "executions"), {
    create,
    gid: create ? gid : 0,
    legacyUid: owner.uid,
    uid: 0
  });
}

// The daemon's runtime directory sits in root's own /run, so its path is never
// a link the daemon planted; root still opens it without following one. Root
// makes it, or keeps it, the daemon's with the shared group and mode 2750, as
// `install -d` did, with no process.
function ensureWorkspaceRuntimeBase(runtimeBase = "", { gid = null, uid = null } = {}) {
  if (!Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0) {
    throw new Error("Vibe64 exec helper needs the daemon's uid and the shared group's gid.");
  }
  try { mkdirSync(runtimeBase, { mode: 0o750 }); } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const descriptor = openSync(runtimeBase, DIRECTORY_NO_FOLLOW);
  try {
    const stats = fstatSync(descriptor);
    if (stats.uid !== uid || stats.gid !== gid) fchownSync(descriptor, uid, gid);
    if ((stats.mode & 0o7777) !== 0o2750) fchmodSync(descriptor, 0o2750);
  } finally {
    closeSync(descriptor);
  }
}

const NO_EXECUTION_RECEIPTS = Object.freeze({
  close() {},
  create() { throw new Error("Vibe64 exec helper has no execution receipt directory."); },
  entries: () => [],
  remove() {},
  result: () => ({})
});
// What its target user can leave in a receipt instead of the runner's result.
const UNREADABLE_RESULT_CODES = new Set(["ENOENT", "ELOOP", "ENOTDIR", "ENXIO", "EVIBE64UNSAFEFILE"]);

// Root keeps a workspace's execution receipts in a directory of its own
// (uid:gid, mode 0750: the target users of its executions only traverse it), so
// only root adds, renames or removes receipts there. That directory sits in the
// daemon's runtime directory, which the daemon can rearrange, so root opens it
// without following a link and from then on works only through the open
// directory: replacing its path afterwards changes nothing root does. A receipt
// is created only where nothing exists yet, and every write and ownership change
// goes through a descriptor root opened itself, never through a link. Older
// helpers left this directory to the daemon (legacyUid); creating a receipt
// takes it back.
function openManagedExecutionReceipts(directory = "", {
  create = false,
  gid = 0,
  legacyUid = 0,
  mode = 0o750,
  uid = 0
} = {}) {
  if (create) {
    try { mkdirSync(directory, { mode }); } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  let descriptor;
  try {
    descriptor = openSync(directory, DIRECTORY_NO_FOLLOW);
  } catch (error) {
    if (!create && error?.code === "ENOENT") return NO_EXECUTION_RECEIPTS;
    throw error;
  }
  try {
    const owned = fstatSync(descriptor).uid;
    if (owned !== uid && owned !== legacyUid) {
      throw new Error("Vibe64 exec helper refused an execution receipt directory owned by another user.");
    }
    if (create) {
      fchownSync(descriptor, uid, gid);
      fchmodSync(descriptor, mode);
    }
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
  return {
    close: () => closeSync(descriptor),
    entries: () => readdirSync(openedPath(descriptor)),
    // Node 26's rmSync (the C++ runtime's std::filesystem::remove_all) walks
    // the receipt with openat and unlinkat relative to directories it opened
    // with O_NOFOLLOW, so a link its target user swaps in meanwhile is removed,
    // never followed.
    remove: (executionId) => rmSync(openedPath(descriptor, managedExecutionId(executionId)), { force: true, recursive: true }),
    // The runner's result, from a receipt its target user owns: only that
    // user's regular file there, never through a link, and none otherwise.
    result(executionId = "") {
      const id = managedExecutionId(executionId);
      let receipt = -1;
      try {
        receipt = openSync(openedPath(descriptor, id), DIRECTORY_NO_FOLLOW);
        const result = JSON.parse(readOwnedFile(receipt, "result.json", {
          maxBytes: MANAGED_EXECUTION_RESULT_LIMIT_BYTES,
          uid: fstatSync(receipt).uid
        }));
        return result?.schema === "vibe64.managed-execution.result" && result.schemaVersion === 1 &&
          result.executionId === id ? result : {};
      } catch (error) {
        if (error instanceof SyntaxError || UNREADABLE_RESULT_CODES.has(error?.code)) return {};
        throw error;
      } finally {
        if (receipt >= 0) closeSync(receipt);
      }
    },
    // The receipt and the runner's command in it, handed to the target user.
    // A service (privateDirectory) also gets a private directory in its receipt,
    // named to it as VIBE64_EXECUTION_PRIVATE_DIR: whatever removes the receipt
    // (Stop, release-ended, a failed start) removes the state it keeps there,
    // without knowing what that state is.
    create(executionId = "", targetUser = {}, runnerCommand = {}, { privateDirectory = false } = {}) {
      const receiptPath = openedPath(descriptor, managedExecutionId(executionId));
      mkdirSync(receiptPath, { mode: 0o700 });
      const receipt = openSync(receiptPath, DIRECTORY_NO_FOLLOW);
      try {
        const env = { ...runnerCommand.env };
        if (privateDirectory) {
          mkdirSync(openedPath(receipt, "private"), { mode: 0o700 });
          const directoryDescriptor = openSync(openedPath(receipt, "private"), DIRECTORY_NO_FOLLOW);
          try {
            fchownSync(directoryDescriptor, targetUser.uid, targetUser.gid);
          } finally {
            closeSync(directoryDescriptor);
          }
          env.VIBE64_EXECUTION_PRIVATE_DIR = path.join(directory, managedExecutionId(executionId), "private");
        }
        const command = openSync(openedPath(receipt, "command.json"), NEW_FILE_NO_FOLLOW, 0o600);
        try {
          writeFileSync(command, `${JSON.stringify({
            ...runnerCommand,
            env,
            schema: "vibe64.managed-execution.command",
            schemaVersion: 1
          })}\n`);
          fchmodSync(command, 0o600);
          fchownSync(command, targetUser.uid, targetUser.gid);
        } finally {
          closeSync(command);
        }
        fchownSync(receipt, targetUser.uid, targetUser.gid);
      } finally {
        closeSync(receipt);
      }
    }
  };
}

function readManagedExecutionResult(owner = {}, executionId = "") {
  const receipts = openAllExecutionReceipts(owner);
  try {
    return receipts.result(executionId);
  } finally {
    receipts.close();
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

function assertNormalizedPayload(payload = {}) {
  if (
    payload?.schema !== EXEC_HELPER_PAYLOAD_SCHEMA ||
    payload?.schemaVersion !== EXEC_HELPER_PAYLOAD_SCHEMA_VERSION
  ) {
    throw new Error("Vibe64 exec helper rejected a non-normalized execution payload.");
  }
}

// The daemon may create a new person, whom the helper then registers, or
// re-enable a person root already registered. It can never make an existing
// account a person merely by naming it.
function handleUserManagementOperation(operation = "", payload = {}, username = "") {
  assertHumanUsername(username);
  const workspace = personWorkspace(resolveOwnerUser());
  ensureGroup(VIBE64_GROUP);
  if (operation === "create-system-user") {
    createSystemUser(username, String(payload.password || ""));
    registerPerson(workspace, username);
    return;
  }
  enablePerson(workspace, username);
}

function enablePerson(workspace = "", username = "", {
  addToGroup = (name) => addUserToGroup(name, VIBE64_GROUP),
  resolveUser = resolveOsUser,
  ...options
} = {}) {
  assertRegisteredPerson(workspace, resolveUser(username), options);
  addToGroup(username);
}

// The people of a workspace are the accounts root registered for it, one file
// each below a root-owned directory its daemon cannot write. Root-side host
// setup and this helper's own account creation register them; the daemon's
// own state only says which of them it currently enables.
function personWorkspace(owner = {}) {
  const username = String(owner.username || "");
  if (!username.startsWith(DAEMON_USERNAME_PREFIX)) {
    throw new Error("Only a workspace daemon acts as its people.");
  }
  return personWorkspaceName(username.slice(DAEMON_USERNAME_PREFIX.length));
}

function personWorkspaceName(workspace = "") {
  if (!/^[a-z][a-z0-9]{0,62}$/u.test(String(workspace))) {
    throw new Error("Vibe64 exec helper rejected an invalid workspace name.");
  }
  return workspace;
}

function assertRootOwnedDirectory(descriptor, registryUid) {
  const stats = fstatSync(descriptor);
  if (!stats.isDirectory() || stats.uid !== registryUid || (stats.mode & 0o022) !== 0) {
    throw new Error("A Vibe64 registry is not a directory only root can change.");
  }
}

// Opens one workspace's directory of a registry (its people or its
// applications), never through a link, and only when it and the registry root
// are root's own and writable by no one else.
function openRegistry(workspace = "", {
  create = false,
  registryRoot = "",
  registryUid = 0
} = {}) {
  if (create) {
    mkdirSync(registryRoot, { mode: 0o755, recursive: true });
  }
  let descriptor = openSync(registryRoot, DIRECTORY_NO_FOLLOW);
  try {
    assertRootOwnedDirectory(descriptor, registryUid);
    const name = directoryEntryName(workspace);
    if (create) {
      try {
        mkdirSync(openedPath(descriptor, name), { mode: 0o755 });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    const next = openSync(openedPath(descriptor, name), DIRECTORY_NO_FOLLOW);
    closeSync(descriptor);
    descriptor = next;
    assertRootOwnedDirectory(descriptor, registryUid);
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

// A registration that cannot be read as root's own private regular file is no
// registration.
function readPersonRegistration(workspace = "", username = "", options = {}) {
  const registryUid = options.registryUid ?? 0;
  let directory;
  try {
    directory = openRegistry(workspace, { registryRoot: PERSON_REGISTRY_ROOT, ...options });
  } catch {
    return null;
  }
  try {
    const record = JSON.parse(readOwnedFile(directory, `${username}.json`, {
      maxBytes: PERSON_REGISTRATION_LIMIT_BYTES,
      othersMayWrite: false,
      uid: registryUid
    }));
    return record?.schema === PERSON_REGISTRATION_SCHEMA && record.schemaVersion === 1 &&
      record.username === username && Number.isSafeInteger(record.uid)
      ? { uid: record.uid, username }
      : null;
  } catch {
    return null;
  } finally {
    closeSync(directory);
  }
}

function writePersonRegistrationEntry(directory, user = {}) {
  const name = `${directoryEntryName(user.username)}.json`;
  const temporary = `.${name}.${process.pid}.tmp`;
  const descriptor = openSync(openedPath(directory, temporary), NEW_FILE_NO_FOLLOW, 0o644);
  try {
    fchmodSync(descriptor, 0o644);
    writeFileSync(descriptor, `${JSON.stringify({
      schema: PERSON_REGISTRATION_SCHEMA,
      schemaVersion: 1,
      uid: user.uid,
      username: user.username
    })}\n`);
  } finally {
    closeSync(descriptor);
  }
  renameSync(openedPath(directory, temporary), openedPath(directory, name));
}

function personRefusal(message = "") {
  return Object.assign(new Error(message), { exitCode: PERSON_REFUSED_EXIT_CODE });
}

// The login range, not system accounts: login.defs' UID_MIN..UID_MAX.
function loginUidRange(loginDefs = "") {
  const value = (name, fallback) => {
    const match = new RegExp(`^[\\t ]*${name}[\\t ]+(\\d+)[\\t ]*$`, "mu").exec(String(loginDefs));
    return match ? Number(match[1]) : fallback;
  };
  return { max: value("UID_MAX", 60000), min: value("UID_MIN", 1000) };
}

// Why the helper must never act as this account, or "" for a person's
// ordinary login. Acting as an administrator would hand the daemon that power
// whatever confines the command itself: the account's own files (its SSH keys,
// shell start-up files and user services) run with all of its rights at its
// next sign-in. sudo's own answer covers every rule source it reads; groups
// cover the administrators sudo knows nothing about.
function personAccountProblem(user = {}, {
  groups = [],
  loginUids = loginUidRange(),
  sudoCommands = [],
  sudoListing = ""
} = {}) {
  const { uid, username } = user;
  if (!Number.isSafeInteger(uid) || uid < loginUids.min || uid > loginUids.max) {
    return `${username} is a system account (uid ${uid}), not a person's login.`;
  }
  const group = groups.find((name) => ADMINISTRATOR_GROUPS.has(name));
  if (group) {
    return `${username} is in the administrators' group ${group}.`;
  }
  return sudoRulesProblem(username, sudoListing, sudoCommands);
}

// No sudo rules, or only rules running exactly the host's declared commands
// as root without a password. Anything else, or an answer sudo never gives,
// is administration.
function sudoRulesProblem(username = "", sudoListing = "", sudoCommands = []) {
  if (sudoListing.includes(`User ${username} is not allowed to run sudo on `)) {
    return "";
  }
  const lines = sudoListing.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`User ${username} may run the following commands on `));
  const rules = start < 0 ? [] : lines.slice(start + 1).filter((line) => line.trim());
  const allowed = new Set(sudoCommands);
  const narrow = rules.length > 0 && rules.every((line) => {
    const match = /^ {4}\(root\) NOPASSWD: (.+)$/u.exec(line);
    return Boolean(match) && match[1].split(", ").every((command) => allowed.has(command));
  });
  return narrow ? "" : `${username} has sudo rules.`;
}

// A missing list allows no sudo rule at all.
function personSudoCommands(file = PERSON_SUDO_COMMANDS_FILE, ownerUid = 0) {
  let directory;
  try {
    directory = openSync(path.dirname(file), DIRECTORY_NO_FOLLOW);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  try {
    const stats = fstatSync(directory);
    if (stats.uid !== ownerUid || (stats.mode & 0o022) !== 0) {
      throw new Error("The Vibe64 person sudo commands are not in a directory only root can change.");
    }
    return readOwnedFile(directory, path.basename(file), { maxBytes: 4096, othersMayWrite: false, uid: ownerUid })
      .split("\n").map((line) => line.trim()).filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  } finally {
    closeSync(directory);
  }
}

function hostPersonFacts(username = "") {
  let loginDefs = "";
  try {
    loginDefs = readFileSync("/etc/login.defs", "utf8");
  } catch {
    // Without login.defs, useradd's own defaults apply.
  }
  // Without a terminal sudo wraps its listing at 80 columns; this width keeps
  // each rule on one line for the exact comparison.
  const sudo = spawnSync("/usr/bin/sudo", ["-n", "-l", "-U", username], {
    encoding: "utf8",
    env: { COLUMNS: "100000", LANG: "C", LC_ALL: "C", PATH: "/usr/sbin:/usr/bin:/sbin:/bin" }
  });
  return {
    groups: osGroupNames(username),
    loginUids: loginUidRange(loginDefs),
    sudoCommands: personSudoCommands(),
    sudoListing: sudo.error ? "" : String(sudo.stdout || "")
  };
}

function assertPersonAccount(user = {}, facts = {}) {
  const problem = personAccountProblem(user, facts);
  if (problem) {
    throw personRefusal(`Vibe64 never runs commands as an administrator or system account: ${problem}`);
  }
}

function assertRegisteredPerson(workspace = "", targetUser = {}, {
  facts = hostPersonFacts,
  ...registry
} = {}) {
  assertHumanUsername(targetUser.username);
  const registration = readPersonRegistration(workspace, targetUser.username, registry);
  if (registration?.uid !== targetUser.uid) {
    throw personRefusal(`OS user ${targetUser.username} is not registered as a Vibe64 person of workspace ${workspace}. ` +
      `A server administrator registers an existing account with: sudo ${path.resolve(process.argv[1])} ` +
      `register-person ${workspace} ${targetUser.username}`);
  }
  const hostFacts = facts(targetUser.username);
  assertPersonAccount(targetUser, hostFacts);
  return hostFacts;
}

// Every command the helper runs as a person passes this: a person root
// registered for the daemon's workspace, still without administrator power,
// in the shared group, and enabled in the daemon's own state.
function assertActablePerson(owner = {}, targetUser = {}, options = {}) {
  const facts = assertRegisteredPerson(personWorkspace(owner), targetUser, options);
  if (!facts.groups.includes(VIBE64_GROUP)) {
    throw new Error(`OS user is not enabled for the shared Vibe64 group: ${targetUser.username}`);
  }
  assertEnabledForVibe64(owner, targetUser.username);
}

// Root-side registration of one existing account. Refuses system and
// administrator accounts; the person also joins the shared group.
function registerPerson(workspace = "", username = "", {
  addToGroup = (name) => addUserToGroup(name, VIBE64_GROUP),
  facts = hostPersonFacts,
  resolveUser = resolveOsUser,
  ...registry
} = {}) {
  personWorkspaceName(workspace);
  assertHumanUsername(username);
  resolveUser(`${DAEMON_USERNAME_PREFIX}${workspace}`);
  const user = resolveUser(username);
  assertPersonAccount(user, facts(username));
  const directory = openRegistry(workspace, { registryRoot: PERSON_REGISTRY_ROOT, ...registry, create: true });
  try {
    writePersonRegistrationEntry(directory, user);
  } finally {
    closeSync(directory);
  }
  addToGroup(username);
  return user;
}

// One-time registration of the people a workspace had before root kept its
// registry: each membership in the daemon's state whose account is already in
// the shared group, except system and administrator accounts, which it reports.
// A workspace that has a registry keeps it unchanged. The registry appears
// whole, so an interrupted run imports nothing and the next run starts again.
function upgradePersonRegistry(workspace = "", {
  facts = hostPersonFacts,
  registryRoot = PERSON_REGISTRY_ROOT,
  registryUid = 0,
  report = (line) => process.stdout.write(`${line}\n`),
  resolveUser = resolveOsUser
} = {}) {
  personWorkspaceName(workspace);
  const daemon = resolveUser(`${DAEMON_USERNAME_PREFIX}${workspace}`);
  mkdirSync(registryRoot, { mode: 0o755, recursive: true });
  const root = openSync(registryRoot, DIRECTORY_NO_FOLLOW);
  try {
    assertRootOwnedDirectory(root, registryUid);
    try {
      closeSync(openRegistry(workspace, { registryRoot, registryUid }));
      return { imported: [], refused: [] };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const staging = `.${workspace}.upgrading`;
    rmSync(openedPath(root, staging), { force: true, recursive: true });
    mkdirSync(openedPath(root, staging), { mode: 0o755 });
    const directory = openSync(openedPath(root, staging), DIRECTORY_NO_FOLLOW);
    const imported = [];
    const refused = [];
    try {
      assertRootOwnedDirectory(directory, registryUid);
      for (const username of daemonMembershipUsernames(daemon)) {
        let user;
        try {
          assertHumanUsername(username);
          user = resolveUser(username);
        } catch {
          continue;
        }
        const userFacts = facts(username);
        if (!userFacts.groups.includes(VIBE64_GROUP)) continue;
        const problem = personAccountProblem(user, userFacts);
        if (problem) {
          refused.push(username);
          report(`[vibe64-exec-helper] Not registering ${username} as a Vibe64 person of ${workspace}: ${problem}`);
          continue;
        }
        writePersonRegistrationEntry(directory, user);
        imported.push(username);
        report(`[vibe64-exec-helper] Registered ${username} as a Vibe64 person of ${workspace}.`);
      }
    } finally {
      closeSync(directory);
    }
    renameSync(openedPath(root, staging), openedPath(root, workspace));
    return { imported, refused };
  } finally {
    closeSync(root);
  }
}

// The usernames of the daemon's membership records, read as root only as the
// daemon's own regular files below its state, never through a link.
function daemonMembershipUsernames(daemon = {}) {
  let directory;
  try {
    directory = openDirectoryBelow(daemon.home, [".local", "state", "vibe64", "users"]);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  try {
    const usernames = [];
    for (const entry of readdirSync(openedPath(directory)).sort()) {
      const username = entry.endsWith(".json") ? entry.slice(0, -".json".length) : "";
      if (!MANAGED_USERNAME_PATTERN.test(username)) continue;
      try {
        const record = JSON.parse(readOwnedFile(directory, entry, { maxBytes: MEMBERSHIP_LIMIT_BYTES, uid: daemon.uid }));
        if (record?.username === username) usernames.push(username);
      } catch {
        // An unreadable or foreign record names no one.
      }
    }
    return usernames;
  } finally {
    closeSync(directory);
  }
}

// Each published project runs as its own application account: a system
// account with only its own group, no login and no Vibe64 group. Root
// registers it for the daemon's workspace like the workspace's people, in a
// registry of its own, so an operation as a person never acts as an
// application nor the reverse. The helper derives the account and its area
// from the calling daemon's workspace and the project; the daemon names only
// the project.
function handleApplicationAccountOperation(payload = {}) {
  const owner = resolveOwnerUser();
  const action = String(payload.action || "").trim();
  if (action !== "ensure" && action !== "retire") {
    throw new Error("Vibe64 exec helper rejected an unknown application account action.");
  }
  const result = action === "ensure"
    ? { account: ensureApplicationAccount(owner, payload.project) }
    : retireApplicationAccount(owner, payload.project);
  process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
}

function applicationWorkspace(owner = {}) {
  const daemon = String(owner.username || "");
  if (!daemon.startsWith(DAEMON_USERNAME_PREFIX)) {
    throw new Error("Only a workspace daemon has application accounts.");
  }
  return personWorkspaceName(daemon.slice(DAEMON_USERNAME_PREFIX.length));
}

// The area below `areaRoot`: root's directories down to the project's, the
// daemon's handover directory its application's group may read, the
// application's own directory with its home, and its production databases.
function applicationIdentity(owner = {}, project = "", { areaRoot = APPLICATION_AREA_ROOT } = {}) {
  const workspace = applicationWorkspace(owner);
  const name = String(project || "");
  if (!APPLICATION_PROJECT_PATTERN.test(name)) {
    throw new Error("Vibe64 exec helper rejected an invalid project name.");
  }
  const projectRoot = path.join(areaRoot, workspace, name);
  return {
    appRoot: path.join(projectRoot, "app"),
    areaRoot,
    databaseRoot: path.join(projectRoot, "database"),
    handoverRoot: path.join(projectRoot, "handover"),
    home: path.join(projectRoot, "app", "home"),
    project: name,
    projectRoot,
    username: `${APPLICATION_USERNAME_PREFIX}${createHash("sha256").update(`${workspace}\0${name}`).digest("hex").slice(0, 12)}`,
    workspace
  };
}

function hostApplicationFacts(username = "") {
  let loginDefs = "";
  try {
    loginDefs = readFileSync("/etc/login.defs", "utf8");
  } catch {
    // Without login.defs, useradd's own defaults apply.
  }
  const group = spawnSync("getent", ["group", username], { encoding: "utf8" });
  let groups = [];
  try {
    groups = osGroupNames(username);
  } catch {
    // An account whose groups cannot be read is no application account.
  }
  return {
    groupGid: group.status === 0 ? Number(String(group.stdout).split(":")[2]) : -1,
    groups,
    loginUids: loginUidRange(loginDefs)
  };
}

// Why this account is not the application account the helper makes, or "".
function applicationAccountProblem(user = {}, identity = {}, facts = {}) {
  if (user.username !== identity.username || !Number.isSafeInteger(user.uid) || user.uid <= 0 ||
      user.uid >= facts.loginUids.min) {
    return `${user.username} is not a system account.`;
  }
  if (user.home !== identity.home || user.shell !== APPLICATION_SHELL) {
    return `${user.username} does not have its application's home and no login.`;
  }
  if (facts.groupGid !== user.gid || facts.groups.length !== 1 || facts.groups[0] !== user.username) {
    return `${user.username} is in a group other than its own.`;
  }
  return "";
}

function readApplicationRegistration(workspace = "", username = "", {
  registryRoot = APPLICATION_REGISTRY_ROOT,
  registryUid = 0
} = {}) {
  // Only an application's name is ever an application's registration.
  if (!APPLICATION_USERNAME_PATTERN.test(String(username))) return null;
  let directory;
  try {
    directory = openRegistry(workspace, { registryRoot, registryUid });
  } catch {
    return null;
  }
  try {
    const record = JSON.parse(readOwnedFile(directory, `${directoryEntryName(username)}.json`, {
      maxBytes: PERSON_REGISTRATION_LIMIT_BYTES,
      othersMayWrite: false,
      uid: registryUid
    }));
    return record?.schema === APPLICATION_REGISTRATION_SCHEMA && record.schemaVersion === 1 &&
      record.username === username && Number.isSafeInteger(record.uid) && Number.isSafeInteger(record.gid) &&
      APPLICATION_PROJECT_PATTERN.test(String(record.project))
      ? { gid: record.gid, project: record.project, uid: record.uid, username }
      : null;
  } catch {
    return null;
  } finally {
    closeSync(directory);
  }
}

function writeApplicationRegistration(identity = {}, user = {}, { registryRoot = APPLICATION_REGISTRY_ROOT, registryUid = 0 } = {}) {
  const directory = openRegistry(identity.workspace, { create: true, registryRoot, registryUid });
  const name = `${identity.username}.json`;
  const temporary = `.${name}.${process.pid}.tmp`;
  try {
    const descriptor = openSync(openedPath(directory, temporary), NEW_FILE_NO_FOLLOW, 0o644);
    try {
      fchmodSync(descriptor, 0o644);
      writeFileSync(descriptor, `${JSON.stringify({
        gid: user.gid,
        project: identity.project,
        schema: APPLICATION_REGISTRATION_SCHEMA,
        schemaVersion: 1,
        uid: user.uid,
        username: identity.username
      })}\n`);
    } finally {
      closeSync(descriptor);
    }
    renameSync(openedPath(directory, temporary), openedPath(directory, name));
  } finally {
    closeSync(directory);
  }
}

// One directory of the area, made by root through a directory it holds open
// and handed to its owner. One that already exists must still have that owner
// and group, and when root's, be writable by no one else; nothing is repaired.
function openAreaDirectory(parent, name = "", { gid, mode, uid }, { verify = true } = {}) {
  const entry = openedPath(parent, directoryEntryName(name));
  let created = true;
  try {
    mkdirSync(entry, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    created = false;
  }
  if (!created && !verify) return { created, descriptor: -1 };
  const descriptor = openSync(entry, DIRECTORY_NO_FOLLOW);
  try {
    if (created) {
      fchownSync(descriptor, uid, gid);
      fchmodSync(descriptor, mode);
    } else if (verify) {
      const stats = fstatSync(descriptor);
      if (stats.uid !== uid || stats.gid !== gid || (mode === 0o711 && (stats.mode & 0o022) !== 0)) {
        throw new Error(`The application area's ${name} directory is not the one the helper made.`);
      }
    }
    return { created, descriptor };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function openApplicationProjectRoot(identity = {}, { areaGid = 0, areaUid = 0, create = true } = {}) {
  let descriptor = openSync(path.dirname(identity.areaRoot), fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  try {
    for (const name of [path.basename(identity.areaRoot), identity.workspace, identity.project]) {
      let next;
      if (create) {
        next = openAreaDirectory(descriptor, name, { gid: areaGid, mode: 0o711, uid: areaUid }).descriptor;
      } else {
        next = openSync(openedPath(descriptor, directoryEntryName(name)), DIRECTORY_NO_FOLLOW);
        assertRootOwnedDirectory(next, areaUid);
      }
      closeSync(descriptor);
      descriptor = next;
    }
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function ensureApplicationArea(identity = {}, owner = {}, user = {}, {
  areaGid = 0,
  areaUid = 0,
  grantDaemonSearch = (descriptor) => runRootCommand("setfacl", ["-m", `u:${safeUsername(owner.username)}:x`,
    `/proc/${process.pid}/fd/${descriptor}`])
} = {}) {
  const project = openApplicationProjectRoot(identity, { areaGid, areaUid });
  const opened = [project];
  try {
    const application = { gid: user.gid, mode: 0o700, uid: user.uid };
    opened.push(openAreaDirectory(project, "handover", { gid: user.gid, mode: 0o2750, uid: owner.uid }).descriptor);
    const app = openAreaDirectory(project, "app", application).descriptor;
    opened.push(app);
    // The application's own home may be anything it made of it.
    opened.push(openAreaDirectory(app, "home", application, { verify: false }).descriptor);
    const database = openAreaDirectory(project, "database", application);
    opened.push(database.descriptor);
    // The daemon may look up a database there by name, never list or read it.
    if (database.created) grantDaemonSearch(database.descriptor);
  } finally {
    for (const descriptor of opened) if (descriptor >= 0) closeSync(descriptor);
  }
}

function ensureApplicationAccount(owner = {}, project = "", {
  areaRoot = APPLICATION_AREA_ROOT,
  createUser = (identity) => runRootCommand("useradd", ["--system", "--user-group", "--no-create-home",
    "--home-dir", identity.home, "--shell", APPLICATION_SHELL, identity.username]),
  facts = hostApplicationFacts,
  resolveUser = tryResolveOsUser,
  ...options
} = {}) {
  const identity = applicationIdentity(owner, project, { areaRoot });
  const registration = readApplicationRegistration(identity.workspace, identity.username, options);
  let user = resolveUser(identity.username);
  if (registration) {
    if (!user || user.uid !== registration.uid || user.gid !== registration.gid || registration.project !== identity.project) {
      throw new Error(`The registered application account ${identity.username} is not the account on this host.`);
    }
  } else if (!user) {
    createUser(identity);
    user = resolveUser(identity.username);
  }
  // An account left unregistered by an interrupted ensure is adopted only when
  // it is exactly the one the helper makes.
  const problem = user ? applicationAccountProblem(user, identity, facts(identity.username)) : "it was not created.";
  if (problem) {
    throw new Error(`Vibe64 exec helper refused application account ${identity.username}: ${problem}`);
  }
  if (!registration) writeApplicationRegistration(identity, user, options);
  ensureApplicationArea(identity, owner, user, options);
  return {
    appRoot: identity.appRoot,
    databaseRoot: identity.databaseRoot,
    handoverRoot: identity.handoverRoot,
    home: identity.home,
    username: identity.username
  };
}

// A retired project's application keeps nothing but its production databases,
// which outlive the project like its other production databases. Without any,
// its account, registration and area go too. Nothing of it may still run.
function retireApplicationAccount(owner = {}, project = "", {
  areaRoot = APPLICATION_AREA_ROOT,
  areaUid = 0,
  deleteUser = (username) => runRootCommand("userdel", [username]),
  facts = hostApplicationFacts,
  registryRoot = APPLICATION_REGISTRY_ROOT,
  registryUid = 0,
  resolveUser = tryResolveOsUser,
  running = (uid) => spawnSync("pgrep", ["-U", String(uid)]).status !== 1
} = {}) {
  const identity = applicationIdentity(owner, project, { areaRoot });
  const registry = { registryRoot, registryUid };
  const registration = readApplicationRegistration(identity.workspace, identity.username, registry);
  const user = resolveUser(identity.username);
  if (user) {
    const problem = registration && registration.uid !== user.uid
      ? "it is not the registered account."
      : applicationAccountProblem(user, identity, facts(identity.username));
    if (problem) {
      throw new Error(`Vibe64 exec helper refused to retire application account ${identity.username}: ${problem}`);
    }
    if (running(user.uid)) {
      throw new Error("The application still runs. Stop its release service before retiring it.");
    }
  }
  let projectRoot = -1;
  try {
    projectRoot = openApplicationProjectRoot(identity, { areaUid, create: false });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let databaseKept = false;
  if (projectRoot >= 0) {
    try {
      try {
        databaseKept = readdirSync(openedPath(projectRoot, "database")).length > 0;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (databaseKept) {
        for (const name of ["handover", "app"]) {
          rmSync(openedPath(projectRoot, name), { force: true, recursive: true });
        }
      }
    } finally {
      closeSync(projectRoot);
    }
  }
  if (databaseKept) {
    return { databaseKept, retired: true };
  }
  if (projectRoot >= 0) {
    const workspaceRoot = openSync(path.join(areaRoot, identity.workspace), DIRECTORY_NO_FOLLOW);
    try {
      assertRootOwnedDirectory(workspaceRoot, areaUid);
      rmSync(openedPath(workspaceRoot, identity.project), { force: true, recursive: true });
    } finally {
      closeSync(workspaceRoot);
    }
  }
  // Unregistered first: an account an interrupted retire leaves behind is one
  // the next ensure adopts or the next retire removes.
  if (registration) {
    const directory = openRegistry(identity.workspace, registry);
    try {
      unlinkSync(openedPath(directory, `${identity.username}.json`));
    } finally {
      closeSync(directory);
    }
  }
  if (user) deleteUser(identity.username);
  return { databaseKept, retired: Boolean(user || registration || projectRoot >= 0) };
}

// The application account an execution or release service runs as: one root
// registered for the calling daemon's workspace, still exactly the account the
// helper made. Never a person, nor another workspace's application.
function registeredApplicationUser(owner = {}, username = "", {
  areaRoot = APPLICATION_AREA_ROOT,
  facts = hostApplicationFacts,
  resolveUser = resolveOsUser,
  ...registry
} = {}) {
  const name = safeUsername(username);
  const registration = readApplicationRegistration(applicationWorkspace(owner), name, registry);
  if (!registration) {
    throw new Error(`${name} is not an application account of this workspace.`);
  }
  const identity = applicationIdentity(owner, registration.project, { areaRoot });
  const user = resolveUser(name);
  const problem = identity.username !== name || registration.uid !== user.uid || registration.gid !== user.gid
    ? "it is not the registered account."
    : applicationAccountProblem(user, identity, facts(name));
  if (problem) {
    throw new Error(`Vibe64 exec helper refused application account ${name}: ${problem}`);
  }
  return { ...user, application: identity };
}

// An application's command starts in its own area, by default its home. A
// link it planted there is resolved, never trusted.
function resolveApplicationCwd(cwd = "", identity = {}) {
  const resolved = canonicalPath(String(cwd || "").trim() || identity.home);
  for (const root of [identity.appRoot, identity.databaseRoot]) {
    const allowed = canonicalPath(root);
    if (resolved === allowed || relativePathParts(allowed, resolved).length > 0) return resolved;
  }
  throw new Error("Vibe64 exec helper rejected an application command path outside its area.");
}

// An application's release environment is the daemon's file in that release's
// handover directory, readable by the application's group alone, and the
// command runs in that release's build or workspace. Root never reads it.
function applicationReleaseEnvironmentFile(candidate = "", identity = {}, { cwd = "", daemonUid = -1, gid = -1 } = {}) {
  const file = String(candidate || "");
  const [releaseId = "", name = "", ...rest] = relativePathParts(identity.handoverRoot, file);
  const stats = lstatSync(file);
  const releaseRoots = [
    path.join(identity.appRoot, "sources", releaseId),
    path.join(identity.appRoot, "releases", releaseId, "workspace")
  ];
  if (!releaseId || name !== "environment" || rest.length > 0 || canonicalPath(file) !== file || !stats.isFile() ||
      stats.uid !== daemonUid || stats.gid !== gid || (stats.mode & 0o027) !== 0 ||
      !releaseRoots.some((root) => cwd === root || relativePathParts(root, cwd).length > 0)) {
    throw new Error("Release environment must belong to the application's selected release.");
  }
  return file;
}

// A release service's files: its workspace in the application's area, or the
// folder inside it its release names (its Workdir), and the daemon's
// environment file and start script for that same release in its handover
// directory, which the application's group may read but not change. The
// folder is reached through real directories, never a link the application
// planted in its own area.
function applicationReleaseServiceFiles(payload = {}, identity = {}, { daemonUid = -1, gid = -1 } = {}) {
  const workingDirectory = String(payload.workingDirectory || "");
  const environmentFile = applicationReleaseEnvironmentFile(payload.environmentFile, identity,
    { cwd: workingDirectory, daemonUid, gid });
  const releaseId = path.basename(path.dirname(environmentFile));
  const workspace = path.join(identity.appRoot, "releases", releaseId, "workspace");
  const inside = relativePathParts(workspace, workingDirectory);
  const startScript = String(payload.startScript || "");
  const stats = lstatSync(startScript);
  if (path.resolve(workingDirectory) !== workingDirectory || (workingDirectory !== workspace && inside.length === 0) ||
      startScript !== path.join(path.dirname(environmentFile), "start.sh") || !stats.isFile() ||
      stats.uid !== daemonUid || stats.gid !== gid || (stats.mode & 0o022) !== 0 || (stats.mode & 0o010) === 0) {
    throw new Error("A release service must run its own release's workspace and start script.");
  }
  try {
    closeSync(openDirectoryBelow(identity.appRoot, ["releases", releaseId, "workspace", ...inside]));
  } catch (error) {
    throw new Error(`A release service's working directory must be a real folder of its release's workspace: ${error.code || error.message}`);
  }
  return { environmentFile, startScript, workingDirectory };
}

// A release unit `user` may install: one named for its application's project
// in the daemon's workspace that is new or already its own, on a port no other
// release service unit claims. Root wrote every unit file it reads here.
function assertReleaseServiceClaim({ loopbackPort = 0, owner = {}, unitName = "", unitRoot = SYSTEMD_UNIT_ROOT, unitUid = 0, user = {} } = {}) {
  const workspace = workspaceFromDaemonUsername(safeUsername(owner.username));
  const project = String(user.application?.project || "").replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (!project || !new RegExp(`^vibe64-release-${workspace}-${project}-[a-f0-9]{12}\\.service$`, "u").test(unitName)) {
    throw new Error(`Release service ${unitName} is not named for application ${user.username}'s project.`);
  }
  const directory = openSync(unitRoot, DIRECTORY_NO_FOLLOW);
  try {
    for (const name of readdirSync(openedPath(directory))) {
      if (!name.startsWith("vibe64-release-") || !name.endsWith(".service")) continue;
      const unit = readOwnedFile(directory, name, { maxBytes: 64 * 1024, othersMayWrite: false, uid: unitUid });
      if (name === unitName) {
        if (!unit.split("\n").includes(`User=${user.username}`)) {
          throw new Error(`Release service ${unitName} belongs to another account.`);
        }
      } else if (unit.split("\n").includes(`SocketBindAllow=tcp:${loopbackPort}`)) {
        throw new Error(`Port ${loopbackPort} belongs to another release service.`);
      }
    }
  } finally {
    closeSync(directory);
  }
}

function releaseServicePort(value) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Vibe64 exec helper rejected a release service port.");
  }
  return port;
}

// What an application's commands and release service run inside: its own area
// is all they may write, they never gain privileges, and they see no other
// user's processes, homes or temporary files, nor the kernel's settings.
function applicationSandboxLines(identity = {}, writablePaths = []) {
  return [
    "NoNewPrivileges=yes",
    "PrivateTmp=yes",
    "ProtectSystem=strict",
    `ReadWritePaths=${[identity.appRoot, identity.databaseRoot, ...writablePaths.filter(Boolean)]
      .map(systemdUnitSafeValue).join(" ")}`,
    "ProtectHome=yes",
    "ProtectProc=invisible",
    "ProtectKernelTunables=yes",
    "ProtectKernelModules=yes",
    "ProtectKernelLogs=yes",
    "ProtectControlGroups=yes",
    "RestrictSUIDSGID=yes",
    "RestrictNamespaces=yes",
    "LockPersonality=yes",
    "CapabilityBoundingSet=",
    // The host's own settings, people and applications are no business of a
    // project's code, though some of those files are readable by every account.
    `InaccessiblePaths=${HOST_SETTINGS_ROOT}`
  ];
}

function handleDeploymentServiceOperation(payload = {}) {
  const owner = resolveOwnerUser();
  ensureGroup(VIBE64_GROUP);
  const action = String(payload.action || "").trim();
  const unitName = assertValidDeploymentUnitName(payload.unitName, owner);
  if (action === "inspect") {
    inspectDeploymentServiceUnit(unitName, owner);
    return;
  }
  if (action === "remove") {
    removeDeploymentServiceUnit(unitName, owner);
    return;
  }
  if (action !== "install-start") {
    throw new Error("Vibe64 exec helper rejected an unknown deployment service action.");
  }
  // A release service runs as its project's own application account.
  const user = registeredApplicationUser(owner, payload.applicationAccount);
  const service = applicationReleaseServiceFiles(payload, user.application, { daemonUid: owner.uid, gid: user.gid });
  const requiredUnits = [...new Set((Array.isArray(payload.requiredUnits) ? payload.requiredUnits : [])
    .map((requiredUnit) => assertValidManagedServiceUnitName(requiredUnit, owner)))];
  const loopbackPort = releaseServicePort(payload.loopbackPort);
  assertReleaseServiceClaim({ loopbackPort, owner, unitName, user });
  const unitPath = systemdUnitPath(unitName, owner);
  const unit = deploymentServiceUnit({
    ...service,
    helperPath: path.resolve(process.argv[1]),
    loopbackPort,
    owner,
    requiredUnits,
    unitName,
    user
  });
  installSystemdUnit({
    activation: "restart",
    unit,
    unitName,
    unitPath
  });
}

function inspectDeploymentServiceUnit(unitName = "", owner = {}) {
  assertValidDeploymentUnitName(unitName, owner);
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
  if (action === "stop") {
    process.stdout.write(`${JSON.stringify(stopManagedServiceUnit(unitName))}\n`);
    return;
  }
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
  // Started on demand only: a release service that Requires= it starts it at
  // boot, and every other use starts it through this action again.
  installSystemdUnit({
    activation: "start",
    enable: false,
    unit,
    unitName,
    unitPath
  });
}

// Its owner found the service unused. Data stays in place, and install-start
// starts it again. A running or starting unit that Requires= it (a release
// service) keeps it: systemd would stop that unit with it. A state that
// cannot be read counts as running.
function stopManagedServiceUnit(unitName = "", {
  query = runRootCommandAllowFailure
} = {}) {
  const state = (unit) => String(query("systemctl", ["is-active", unit]).stdout || "").trim();
  const stopped = (value) => value === "inactive" || value === "failed";
  const requiredBy = String(query("systemctl", ["show", unitName, "--property=RequiredBy", "--value"]).stdout || "")
    .split(/\s+/u).filter(Boolean).filter((dependent) => !stopped(state(dependent)));
  if (requiredBy.length > 0) {
    return { ok: true, requiredBy, state: "required" };
  }
  const active = !stopped(state(unitName));
  if (active) {
    runSystemctl(query, ["stop", unitName]);
  }
  // Units enabled by earlier releases lose their boot target here.
  if (String(query("systemctl", ["is-enabled", unitName]).stdout || "").trim() === "enabled") {
    runSystemctl(query, ["disable", unitName]);
  }
  return { ok: true, requiredBy: [], state: active ? "stopped" : "inactive" };
}

function runSystemctl(query, args = []) {
  const result = query("systemctl", args);
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `systemctl ${args[0]} failed.`).trim());
  }
}

function ensureManagedServiceProcessOwnership({
  owner = {},
  pidFile = "",
  unitName = "",
  workspaceRoot = path.join(MANAGED_ROOT, workspaceFromDaemonUsername(safeUsername(owner.username)))
} = {}) {
  const pidFiles = pidFile ? openManagedServicePidFile(pidFile, owner, workspaceRoot) : null;
  if (!pidFiles) {
    return;
  }
  try {
    stopUnitlessManagedServiceProcess(pidFiles, owner, unitName);
  } finally {
    pidFiles.close();
  }
}

function stopUnitlessManagedServiceProcess(pidFiles, owner = {}, unitName = "") {
  const pidText = pidFiles.read();
  if (pidText === null) {
    return;
  }
  if (!/^[1-9][0-9]*$/u.test(pidText)) {
    throw new Error("Vibe64 managed service PID file is invalid.");
  }
  const pid = Number(pidText);
  if (!Number.isSafeInteger(pid) || pid <= 1) {
    throw new Error("Vibe64 managed service PID is invalid.");
  }
  if (!processIsRunning(pid)) {
    pidFiles.remove(pidText);
    return;
  }
  const processUid = processRealUid(pid);
  if (processUid === null) {
    pidFiles.remove(pidText);
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
      pidFiles.remove(pidText);
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
  pidFiles.remove(pidText);
}

// A forking service's PID file sits in the daemon's service directory, which
// the daemon can rearrange after the file's path was checked. Root opens that
// directory without following links, from the workspace directory down, and
// reads and removes the daemon's PID file only there. A directory that does
// not exist yet holds no PID file.
function openManagedServicePidFile(pidFile = "", owner = {}, workspaceRoot = "") {
  const parts = relativePathParts(canonicalPath(workspaceRoot), path.dirname(pidFile));
  if (parts.length === 0) {
    throw new Error("Vibe64 exec helper rejected a managed service PID file outside its workspace.");
  }
  let directory;
  try {
    directory = openDirectoryBelow(workspaceRoot, parts);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const name = path.basename(pidFile);
  const read = () => {
    try {
      return readOwnedFile(directory, name, { maxBytes: PID_FILE_LIMIT_BYTES, uid: owner.uid }).trim();
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  };
  return {
    close: () => closeSync(directory),
    read,
    // Only while it still names the process that was found stopped.
    remove(expectedPid = "") {
      if (read() === expectedPid) unlinkSync(openedPath(directory, name));
    }
  };
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
  enable = true,
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
  if (enable) {
    runRootCommand("systemctl", [
      "enable",
      unitName
    ]);
  }
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

function removeDeploymentServiceUnit(unitName = "", owner = {}) {
  assertValidDeploymentUnitName(unitName, owner);
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
    unlinkSync(systemdUnitPath(unitName, owner));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  runRootCommand("systemctl", [
    "daemon-reload"
  ]);
}

// A release service loads its environment as its own user at every start, so
// neither root nor systemd on root's behalf reads a file whose path that user
// controls. The start script then replaces this process, so nothing else stays
// running.
function runReleaseService(environmentFile = "", startScript = "") {
  if (process.argv.length !== 5 || !path.isAbsolute(environmentFile) || !path.isAbsolute(startScript)) {
    throw new Error("Usage: vibe64-exec-helper run-release-service <environment-file> <start-script>");
  }
  process.execve(startScript, [startScript], { ...process.env, ...readEnvironmentFile(environmentFile) });
}

function readEnvironmentFile(file = "") {
  return parseEnvironmentFile(readFileSync(file, "utf8"));
}

// Release environment files keep systemd's EnvironmentFile= syntax: comment
// lines, NAME=value with surrounding blanks trimmed, single quotes taken
// literally, double quotes in which a backslash escapes only " \ ` $ and a line
// end, and outside quotes a backslash escaping the next character. Quoted and
// unquoted parts join, and an assignment whose name is not a valid environment
// name is skipped.
function parseEnvironmentFile(text = "") {
  const environment = {};
  const blank = (character) => " \t\n\r".includes(character);
  const lineEnd = (character) => character === "\n" || character === "\r";
  let state = "pre-key";
  let key = "";
  let value = "";
  let valueEnd = 0;
  const keep = (characters) => {
    value += characters;
    valueEnd = value.length;
  };
  const assign = () => {
    const name = key.trim();
    if (SAFE_ENV_NAME_PATTERN.test(name)) environment[name] = value.slice(0, valueEnd);
    key = "";
    value = "";
    valueEnd = 0;
    state = "pre-key";
  };
  for (const character of String(text)) {
    if (state === "pre-key") {
      if (character === "#" || character === ";") state = "comment";
      else if (!blank(character)) {
        key = character;
        state = "key";
      }
    } else if (state === "key") {
      if (lineEnd(character)) {
        key = "";
        state = "pre-key";
      } else if (character === "=") state = "pre-value";
      else key += character;
    } else if (state === "pre-value" || state === "value") {
      if (lineEnd(character)) assign();
      else if (character === "\\") state = "value-escape";
      else if (state === "pre-value" && character === "'") state = "single";
      else if (state === "pre-value" && character === "\"") state = "double";
      else if (!blank(character)) {
        keep(character);
        state = "value";
      } else if (state === "value") value += character;
    } else if (state === "value-escape") {
      if (!lineEnd(character)) keep(character);
      state = "value";
    } else if (state === "single") {
      if (character === "'") state = "pre-value";
      else keep(character);
    } else if (state === "double") {
      if (character === "\"") state = "pre-value";
      else if (character === "\\") state = "double-escape";
      else keep(character);
    } else if (state === "double-escape") {
      if ("\"\\`$".includes(character)) keep(character);
      else if (!lineEnd(character)) keep(`\\${character}`);
      state = "double";
    } else if (state === "comment") {
      if (character === "\\") state = "comment-escape";
      else if (lineEnd(character)) state = "pre-key";
    } else {
      state = "comment";
    }
  }
  if (state !== "pre-key" && state !== "key" && state !== "comment" && state !== "comment-escape") assign();
  return environment;
}

function readPayload() {
  return parsePayload(readStdin());
}

// A payload that is not JSON is never repeated back.
function parsePayload(input = "") {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    throw new Error("Vibe64 exec helper payload is not valid JSON.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Vibe64 exec helper payload must be a JSON object.");
  }
  return payload;
}

// A path through a directory root already holds open: whatever later replaces
// that directory's path, the name is looked up in the directory root opened.
function openedPath(directory, name = "") {
  return path.join(`/proc/self/fd/${directory}`, name);
}

function directoryEntryName(name = "") {
  const entry = String(name);
  if (!entry || entry === "." || entry === ".." || /[/\0]/u.test(entry)) {
    throw new Error("Vibe64 exec helper rejected an unsafe file name.");
  }
  return entry;
}

// Opens `directory`, whose path only root can rearrange, and then each of
// `parts` below it without following a link. The directory returned is the one
// reached through real directories, whatever replaces their paths afterwards.
function openDirectoryBelow(directory = "", parts = []) {
  let descriptor = openSync(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  try {
    for (const part of parts) {
      const next = openSync(openedPath(descriptor, directoryEntryName(part)), DIRECTORY_NO_FOLLOW);
      closeSync(descriptor);
      descriptor = next;
    }
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
  return descriptor;
}

// Reads one regular file of `uid` from a directory root holds open: never
// through a link, never waiting on a FIFO, never more than maxBytes, and never
// repeating what it read in an error.
function readOwnedFile(directory, name = "", { maxBytes = 0, othersMayWrite = true, uid = -1 } = {}) {
  const descriptor = openSync(openedPath(directory, directoryEntryName(name)), FILE_NO_FOLLOW);
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.uid !== uid || (!othersMayWrite && (stats.mode & 0o022) !== 0)) {
      throw Object.assign(new Error("Vibe64 exec helper refused a file that is not its owner's regular file."), {
        code: "EVIBE64UNSAFEFILE"
      });
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > maxBytes) {
      throw Object.assign(new Error("Vibe64 exec helper refused a file that is too large."), { code: "EVIBE64UNSAFEFILE" });
    }
    return buffer.toString("utf8", 0, length);
  } finally {
    closeSync(descriptor);
  }
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
  // Every person path starts here, before the helper makes, registers or acts
  // as an account, so a published project's account is never made a person.
  if (username.startsWith(APPLICATION_USERNAME_PREFIX)) {
    throw new Error("Vibe64 application accounts are never people.");
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
    shell: parts[6],
    uid,
    username
  };
}

function resolveOwnerUser() {
  const sudoUser = safeUsername(process.env.SUDO_USER || "");
  return resolveOsUser(sudoUser);
}

function osGroupNames(username = "") {
  const result = spawnSync("id", ["-nG", username], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`Could not read the groups of OS user ${username}.`);
  }
  return String(result.stdout || "").trim().split(/\s+/u);
}

function assertUserInGroup(username = "", groupName = "") {
  let groups = [];
  try {
    groups = osGroupNames(username);
  } catch {
    // An account whose groups cannot be read is in none.
  }
  if (!groups.includes(groupName)) {
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
  const gid = Number(String(result.stdout || "").split(":")[2]);
  if (result.status !== 0 || !Number.isSafeInteger(gid)) {
    throw new Error(`Required OS group was not found: ${groupName}`);
  }
  return gid;
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
  const resolved = canonicalPath(normalized, { allowMissingLeaf: true });
  if (relativePathParts(canonicalPath(managedServiceRoot(owner)), resolved).length > 0) {
    return resolved;
  }
  throw new Error("Vibe64 exec helper rejected a managed service path outside the workspace service root.");
}

function relativePathParts(parentPath = "", childPath = "") {
  const parent = String(parentPath || "").trim();
  const child = String(childPath || "").trim();
  if (!parent || !child) {
    return [];
  }
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return [];
  }
  return relative.split(path.sep).filter(Boolean);
}

function canonicalPath(candidatePath, { allowMissingLeaf = false } = {}) {
  const resolved = path.resolve(candidatePath);
  if (allowMissingLeaf) {
    try {
      lstatSync(resolved);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return path.join(realpathSync(path.dirname(resolved)), path.basename(resolved));
    }
  }
  return realpathSync(resolved);
}

// A release service unit of the calling daemon's own workspace; no daemon
// installs, stops, removes or reads another workspace's.
function assertValidDeploymentUnitName(unitName = "", owner = {}) {
  const normalized = String(unitName || "").trim();
  const workspace = workspaceFromDaemonUsername(safeUsername(owner.username));
  if (
    !owner.username?.startsWith(DAEMON_USERNAME_PREFIX) ||
    !normalized.startsWith(`vibe64-release-${workspace}-`) ||
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

function systemdUnitPath(unitName = "", owner = {}) {
  return path.join(SYSTEMD_UNIT_ROOT, assertValidDeploymentUnitName(unitName, owner));
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
    "IOAccounting=yes",
    "TasksAccounting=yes",
    "KillMode=control-group",
    "OOMPolicy=stop"
  ];
}

function deploymentServiceUnit({
  environmentFile = "",
  helperPath = "",
  loopbackPort = 0,
  owner = {},
  requiredUnits = [],
  startScript = "",
  unitName = "",
  user = {},
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
    ...accountUnitLines(user),
    ...serviceResourceUnitLines(owner),
    // It may listen on its own loopback port and nowhere else, so it can never
    // take over another service's port while that service is down.
    `SocketBindAllow=tcp:${releaseServicePort(loopbackPort)}`,
    "SocketBindDeny=any",
    `WorkingDirectory=${systemdUnitSafeValue(workingDirectory)}`,
    `Environment=PATH=${systemdUnitSafeValue(DEFAULT_PATH)}`,
    "Environment=TMPDIR=/tmp",
    // The service's own user loads its environment at every start; see
    // runReleaseService. setpriv holds even where a drop-in switches the
    // unit's NoNewPrivileges= off.
    `ExecStart=/usr/bin/setpriv --no-new-privs -- ${systemdUnitSafeValue(helperPath)} run-release-service "${systemdUnitSafeValue(environmentFile)}" "${systemdUnitSafeValue(startScript)}"`,
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
  if (!Number.isSafeInteger(expected) || expected < 0 || expected !== actual) {
    throw new Error(`Vibe64 exec helper ${name} mismatch.`);
  }
}

// The daemon keeps each user's Vibe64 membership in its own state directory,
// so root reads it only as the daemon's regular file there, reached without
// following a link. A membership it cannot read that way is no membership.
function assertEnabledForVibe64(owner = {}, username = "") {
  let membership = null;
  try {
    const directory = openDirectoryBelow(owner.home, [".local", "state", "vibe64", "users"]);
    try {
      membership = JSON.parse(readOwnedFile(directory, `${username}.json`, { maxBytes: MEMBERSHIP_LIMIT_BYTES, uid: owner.uid }));
    } finally {
      closeSync(directory);
    }
  } catch {
    membership = null;
  }
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
  if (operation === "workspace-cache-command") {
    const root = path.join(targetUser.home, ".local/state/vibe64/cache-maintenance");
    const resolved = canonicalPath(cwd);
    const parts = relativePathParts(root, resolved);
    if (targetUser.username !== ownerUsername || canonicalPath(root) !== root || resolved !== cwd ||
        parts.length !== 1 || !/^[a-z][a-z0-9-]*-[A-Za-z0-9]{6}$/u.test(parts[0])) {
      throw new Error("Cache maintenance requires an owned workspace scratch directory.");
    }
    return resolved;
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
    const resolved = canonicalPath(normalized);
    const ownerProjectStateRoot = path.join(
      targetUser.home,
      ".local",
      "state",
      "vibe64",
      "projects"
    );
    if (existsSync(ownerProjectStateRoot)) {
      const stateRoot = canonicalPath(ownerProjectStateRoot);
      if (resolved === stateRoot || resolved.startsWith(`${stateRoot}${path.sep}`)) {
        return resolved;
      }
    }
    const ownerColleagueRoot = path.join(targetUser.home, ".local", "state", "vibe64", "colleague");
    if (existsSync(ownerColleagueRoot)) {
      const parts = relativePathParts(canonicalPath(ownerColleagueRoot), resolved);
      const scope = parts.at(-1) || "";
      const learnThread = parts.length === 4 && parts[1] === "learn" &&
        /^(lobby|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u.test(parts[2]);
      // Develop: <learner>/<scope>. Learn threads keep their runtime beside
      // their file: <learner>/learn/<attemptId|lobby>/<scope>.
      if ((parts.length === 2 || learnThread) && /^[A-Za-z0-9_-]+$/u.test(parts[0]) && /^colleague_[a-f0-9]{32}$/u.test(scope)) {
        return resolved;
      }
    }
    // Official Learning catalogue/topic sources are fetched into one exact
    // private scratch directory beside the training namespace, then verified.
    const ownerTrainingSourcesRoot = path.join(targetUser.home, ".local", "state", "vibe64", "training-sources");
    if (existsSync(ownerTrainingSourcesRoot)) {
      const parts = relativePathParts(canonicalPath(ownerTrainingSourcesRoot), resolved);
      if (parts.length === 1 && /^(catalogue|topic)-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(parts[0])) {
        return resolved;
      }
    }
  }
  if (operation === "codex-app-server" || operation === "opencode-app-server") {
    const resolved = canonicalPath(normalized);
    const targetUid = Number(targetUser.uid);
    const runtimeBases = [managedExecutionRuntimeBase({ username: ownerUsername })];
    if (Number.isSafeInteger(targetUid) && targetUid >= 0) {
      runtimeBases.push(path.join("/run/user", String(targetUid)));
    }
    for (const runtimeBase of runtimeBases) {
      const runtimeRootPath = path.join(runtimeBase, "vibe64", "agent-providers");
      if (!existsSync(runtimeRootPath)) continue;
      const runtimeRoot = canonicalPath(runtimeRootPath);
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
  const resolved = canonicalPath(normalized);
  const allowedProjectsRoot = canonicalPath(path.join("/var/lib/vibe64", workspaceFromDaemonUsername(ownerUsername), "projects"));
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
  const resolved = canonicalPath(normalized);
  const allowedHome = canonicalPath(home);
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
  // An application has its own private temporary directory, and no access to
  // the workspace's.
  env.TMPDIR = targetUser.application ? "/tmp" : workspaceTempRoot(ownerUsername);
  return env;
}

export { APPLICATION_USERNAME_PREFIX, DAEMON_USERNAME_PREFIX, HOST_SETTINGS_ROOT, accountUnitLines, applicationIdentity, applicationReleaseEnvironmentFile,
  assertReleaseServiceClaim, assertValidDeploymentUnitName,
  applicationReleaseServiceFiles, applicationSandboxLines, ensureApplicationAccount, readApplicationRegistration,
  registeredApplicationUser,
  resolveApplicationCwd, retireApplicationAccount,
  assertActablePerson, assertEnabledForVibe64, configureManagedExecutionWorkSlice, consumeManagedExecutionRequestPayload,
  ensureWorkspaceRuntimeBase, managedExecutionControllerLeaseName, managedExecutionRuntimeBase,
  enablePerson, loginUidRange, personAccountProblem, personSudoCommands, readPersonRegistration, registerPerson, upgradePersonRegistry, deploymentServiceUnit, ensureManagedServiceProcessOwnership,
  parseEnvironmentFile,
  managedWorkflowCounters, openManagedExecutionReceipts, managedWorkflowIdentity, managedExecutionOomBoundary,
  managedExecutionSliceCgroup, managedExecutionTargetUser,
  managedExecutionState, managedExecutionStopTimeoutMs, managedExecutionTaskLimitCounters, managedExecutionTaskLimitJournal,
  releaseEndedManagedExecutions, stopManagedExecution, stopManagedServiceUnit,
  assertExpectedId, canonicalPath, helperChildEnv, resolveAllowedCwd,
  resolveAllowedUserHomePath, runUserCommand };

// Last, so that every constant above exists before main() runs.
if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exit(error?.exitCode === PERSON_REFUSED_EXIT_CODE ? PERSON_REFUSED_EXIT_CODE : 2);
  });
}
