#!/opt/vibe64/runtime-packs/node22/bin/node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const INPUT_LIMIT_BYTES = 1024 * 1024;
const EXEC_HELPER_PAYLOAD_SCHEMA = "vibe64.exec-helper.payload";
const EXEC_HELPER_PAYLOAD_SCHEMA_VERSION = 1;
const ALLOWED_OPERATIONS = new Set([
  "account-auth-terminal",
  "account-status",
  "create-system-user",
  "deployment-service",
  "enable-system-user",
  "github-api-command",
  "github-toolchain",
  "github-workflow-command",
  "managed-service",
  "repair-managed-project-permissions",
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
  "/opt/vibe64/runtime-packs/node22/bin",
  "/opt/vibe64/runtime-packs/node20/bin",
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

main().catch((error) => {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exit(2);
});

async function main() {
  if (process.argv[2] !== "execute") {
    throw new Error("Usage: vibe64-exec-helper execute [payload-json-file]");
  }
  const payload = readPayload(process.argv[3] || "");
  assertNormalizedPayload(payload);
  const operation = String(payload.operation || "").trim();
  if (!ALLOWED_OPERATIONS.has(operation)) {
    throw new Error("Vibe64 exec helper rejected an unknown operation.");
  }
  if (operation === "repair-managed-project-permissions") {
    handleManagedProjectPermissionRepair(payload);
    return;
  }
  if (operation === "deployment-service") {
    handleDeploymentServiceOperation(payload);
    return;
  }
  if (operation === "managed-service") {
    handleManagedServiceOperation(payload);
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
  const cwd = resolveAllowedCwd(payload.cwd || "", owner.username, {
    operation,
    targetUser
  });
  const env = helperChildEnv(payload.env || {}, targetUser, owner.username);
  const args = Array.isArray(payload.args) ? payload.args.map((arg) => String(arg)) : [];
  const input = payload.inputBase64
    ? Buffer.from(String(payload.inputBase64), "base64")
    : undefined;

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

function handleManagedProjectPermissionRepair(payload = {}) {
  const owner = resolveOwnerUser();
  ensureGroup(VIBE64_GROUP);
  const sourcePath = resolveAllowedProjectPath(payload.path || "", owner.username);
  if (!existsSync(sourcePath)) {
    return;
  }
  runRootCommand("chgrp", [
    "-hR",
    VIBE64_GROUP,
    sourcePath
  ]);
  runRootCommand("find", [
    sourcePath,
    "-type",
    "d",
    "-exec",
    "chmod",
    "g+rwx,g+s",
    "{}",
    "+"
  ]);
  runRootCommand("find", [
    sourcePath,
    "-type",
    "f",
    "-exec",
    "chmod",
    "g+rwX",
    "{}",
    "+"
  ]);
}

function handleDeploymentServiceOperation(payload = {}) {
  const owner = resolveOwnerUser();
  ensureGroup(VIBE64_GROUP);
  const action = String(payload.action || "").trim();
  const unitName = assertValidDeploymentUnitName(payload.unitName);
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
  return readFileSync(0, "utf8");
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
}

function runRootCommandAllowFailure(command = "", args = []) {
  spawnSync(command, args, {
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
    "",
    "[Service]",
    "Type=simple",
    `User=${systemdUnitSafeValue(owner.username)}`,
    `Group=${systemdUnitSafeValue(owner.username)}`,
    "SupplementaryGroups=vibe64 nix-users",
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
    `User=${systemdUnitSafeValue(owner.username)}`,
    `Group=${systemdUnitSafeValue(owner.username)}`,
    "SupplementaryGroups=vibe64 nix-users",
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

function helperChildEnv(input = {}, targetUser = {}, ownerUsername = "") {
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
  env.HOME = targetUser.home;
  env.LOGNAME = targetUser.username;
  env.USER = targetUser.username;
  env.XDG_CACHE_HOME = path.join(targetUser.home, ".cache");
  env.XDG_CONFIG_HOME = path.join(targetUser.home, ".config");
  env.XDG_DATA_HOME = path.join(targetUser.home, ".local", "share");
  env.TMPDIR = workspaceTempRoot(ownerUsername);
  return env;
}
