// Deployment and managed services: installing, inspecting, stopping and removing their units, their processes
// without a unit, and a release service's start.

import {
  closeSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  applicationReleaseServiceFiles,
  applicationSandboxAllowances,
  assertApplicationAreaNosuid,
  assertReleaseServiceClaim,
  registeredApplicationUser
} from "./applicationAccounts.js";
import { helperCommandPath, readEnvironmentFile } from "./commandEnvironment.js";
import {
  ensureGroup,
  MANAGED_ROOT,
  resolveOwnerUser,
  runRootCommand,
  runRootCommandAllowFailure,
  safeUsername,
  VIBE64_GROUP,
  workspaceFromDaemonUsername
} from "./hostAccounts.js";
import {
  canonicalPath,
  openDirectoryBelow,
  openedPath,
  openRootOwnedDirectory,
  readOwnedFile,
  relativePathParts
} from "./hostFiles.js";
import { helperSystemdUnitRoot, SYSTEMD_UNIT_ROOT } from "./hostSettings.js";
import {
  assertSafeManagedServicePath,
  assertValidDeploymentUnitName,
  assertValidManagedServiceProcessModel,
  assertValidManagedServiceUnitName,
  deploymentServiceUnit,
  managedServiceUnit,
  managedSystemdUnitPath,
  releaseServicePort,
  resolveAllowedManagedServicePath,
  systemdUnitPath
} from "./systemdUnits.js";

const PID_FILE_LIMIT_BYTES = 64;

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
  const sandboxAllowances = applicationSandboxAllowances(payload.sandboxAllowances);
  const requiredUnits = [...new Set((Array.isArray(payload.requiredUnits) ? payload.requiredUnits : [])
    .map((requiredUnit) => assertValidManagedServiceUnitName(requiredUnit, owner)))];
  const loopbackPort = releaseServicePort(payload.loopbackPort);
  const unitRoot = helperSystemdUnitRoot();
  assertReleaseServiceClaim({ loopbackPort, owner, unitName, unitRoot, user });
  const unitPath = systemdUnitPath(unitName, owner, unitRoot);
  const unit = deploymentServiceUnit({
    ...service,
    helperPath: path.resolve(process.argv[1]),
    loopbackPort,
    owner,
    requiredUnits,
    sandboxAllowances,
    servicePath: helperCommandPath(),
    unitName,
    user
  });
  installSystemdUnit({
    activation: "restart",
    unit,
    unitName,
    unitPath,
    unitRoot
  });
}

// How much of a release service's output a read takes: 80 lines unless the reader names how many (at most
// 5000), optionally from a time in a form journalctl's --since takes ("2026-11-11 08:00:00", "1 hour ago",
// "today").
const DEPLOYMENT_JOURNAL_DEFAULT_LINES = 80;
const DEPLOYMENT_JOURNAL_MAX_LINES = 5000;
const DEPLOYMENT_JOURNAL_SINCE_PATTERN = /^[0-9A-Za-z][0-9A-Za-z :.+-]{0,63}$/u;

function deploymentServiceJournalWindow({ lines = DEPLOYMENT_JOURNAL_DEFAULT_LINES, since = "" } = {}) {
  if (!Number.isSafeInteger(lines) || lines < 1 || lines > DEPLOYMENT_JOURNAL_MAX_LINES) {
    throw new Error(`Vibe64 exec helper reads 1 to ${DEPLOYMENT_JOURNAL_MAX_LINES} lines of a service's output.`);
  }
  if (since && !DEPLOYMENT_JOURNAL_SINCE_PATTERN.test(since)) {
    throw new Error("Vibe64 exec helper rejected a service output start time.");
  }
  return { lines, since };
}

function inspectDeploymentServiceUnit(unitName = "", owner = {}) {
  assertValidDeploymentUnitName(unitName, owner);
  printDeploymentServiceUnit(unitName);
}

// A release unit's state, then its newest output, for a unit its caller has checked is the caller's to read.
function printDeploymentServiceUnit(unitName = "", {
  lines = DEPLOYMENT_JOURNAL_DEFAULT_LINES,
  since = "",
  timestamps = false
} = {}) {
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
    timestamps ? "--output=short-iso" : "--output=cat",
    `--lines=${lines}`,
    ...(since ? [`--since=${since}`] : [])
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
  const unitRoot = helperSystemdUnitRoot();
  const unitPath = managedSystemdUnitPath(unitName, owner, unitRoot);
  const unit = managedServiceUnit({
    owner,
    pidFile,
    processModel,
    servicePath: helperCommandPath(),
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
    unitPath,
    unitRoot
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

// A unit goes to the helper's unit folder (hostSettings.js). systemd reads its own folder itself; a unit in any
// other folder it knows only through a link in its runtime folder, made with the unit's boot target
// (`enable --runtime`) or without (`link --runtime`), which lasts until the host restarts (relinkSystemdUnits).
function installSystemdUnit({
  activation = "start",
  enable = true,
  rootUid = 0,
  run = runRootCommand,
  runAllowFailure = runRootCommandAllowFailure,
  unit = "",
  unitName = "",
  unitPath = "",
  unitRoot = helperSystemdUnitRoot()
} = {}) {
  if (activation !== "start" && activation !== "restart") {
    throw new Error("Vibe64 exec helper rejected an unsupported systemd activation.");
  }
  const linked = unitRoot !== SYSTEMD_UNIT_ROOT;
  if (linked) closeSync(openUnitRoot(unitRoot, rootUid));
  const temporaryUnitPath = `${unitPath}.tmp-${process.pid}`;
  writeFileSync(temporaryUnitPath, unit, {
    mode: 0o644
  });
  try {
    run("mv", [
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
  if (linked) {
    run("systemctl", [
      enable ? "enable" : "link",
      "--runtime",
      unitPath
    ]);
  }
  run("systemctl", [
    "daemon-reload"
  ]);
  if (enable && !linked) {
    run("systemctl", [
      "enable",
      unitName
    ]);
  }
  runAllowFailure("systemctl", [
    "reset-failed",
    unitName
  ]);
  try {
    run("systemctl", [
      activation,
      unitName
    ]);
  } catch (error) {
    runAllowFailure("systemctl", [
      "stop",
      unitName
    ]);
    throw error;
  }
}

// A unit folder other than systemd's own must be root's alone: systemd runs what a unit there says as root.
function openUnitRoot(unitRoot = "", rootUid = 0) {
  try {
    return openRootOwnedDirectory(unitRoot, rootUid);
  } catch (error) {
    throw new Error(`Vibe64 exec helper refused unit folder ${unitRoot}: it is not a folder only root can change` +
      `${error.code ? ` (${error.code})` : ""}.`);
  }
}

function removeDeploymentServiceUnit(unitName = "", owner = {}, unitRoot = helperSystemdUnitRoot()) {
  assertValidDeploymentUnitName(unitName, owner);
  runRootCommandAllowFailure("systemctl", [
    "stop",
    unitName
  ]);
  // A unit outside systemd's own folder loses its runtime link with its boot target.
  runRootCommandAllowFailure("systemctl", [
    "disable",
    ...(unitRoot === SYSTEMD_UNIT_ROOT ? [] : ["--runtime"]),
    unitName
  ]);
  runRootCommandAllowFailure("systemctl", [
    "reset-failed",
    unitName
  ]);
  try {
    unlinkSync(systemdUnitPath(unitName, owner, unitRoot));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  runRootCommand("systemctl", [
    "daemon-reload"
  ]);
}

// systemd's runtime folder starts empty at every boot, so a host whose units live in another folder runs the
// root-only `vibe64-exec-helper relink-units` before its services start. Each release and managed service unit
// root wrote there is linked again as it was installed: a release unit with its boot target, and started, as a
// boot starts one from systemd's own folder; a managed one without, for the release unit that Requires= it to
// start. Other files stay as they are. A unit root did not write, or one others may change, stays unlinked and
// is reported once every other unit is linked and started.
function relinkSystemdUnits({
  rootUid = 0,
  runAllowFailure = runRootCommandAllowFailure,
  unitRoot = helperSystemdUnitRoot()
} = {}) {
  if (unitRoot === SYSTEMD_UNIT_ROOT) return;
  const problems = [];
  const systemctl = (args, name) => {
    const result = runAllowFailure("systemctl", args);
    if (result.status === 0) return true;
    problems.push(`${name}: ${String(result.stderr || result.stdout || `systemctl ${args[0]} failed.`).trim()}`);
    return false;
  };
  const releaseUnits = [];
  const directory = openUnitRoot(unitRoot, rootUid);
  try {
    for (const name of readdirSync(openedPath(directory)).sort()) {
      const kind = /^vibe64-(release|managed)-[A-Za-z0-9_.@:-]+\.service$/u.exec(name)?.[1];
      if (!kind) continue;
      try {
        readOwnedFile(directory, name, { maxBytes: 64 * 1024, othersMayWrite: false, uid: rootUid });
      } catch (error) {
        problems.push(`${name}: not a unit file root wrote (${error.code || error.message})`);
        continue;
      }
      const release = kind === "release";
      if (systemctl([release ? "enable" : "link", "--runtime", path.join(unitRoot, name)], name) && release) {
        releaseUnits.push(name);
      }
    }
  } finally {
    closeSync(directory);
  }
  systemctl(["daemon-reload"], "daemon-reload");
  for (const name of releaseUnits) systemctl(["start", "--no-block", name], name);
  if (problems.length > 0) {
    throw new Error(`Vibe64 exec helper could not relink every unit in ${unitRoot}:\n${problems.join("\n")}`);
  }
}

// A release service loads its environment as its own user at every start, so
// neither root nor systemd on root's behalf reads a file whose path that user
// controls. The start script then replaces this process, so nothing else stays
// running. Like every application's code it runs only while its area, where it
// works, is mounted nosuid: at every start, boot included, whatever systemd
// started first.
function runReleaseService(environmentFile = "", startScript = "") {
  if (process.argv.length !== 5 || !path.isAbsolute(environmentFile) || !path.isAbsolute(startScript)) {
    throw new Error("Usage: vibe64-exec-helper run-release-service <environment-file> <start-script>");
  }
  assertApplicationAreaNosuid(process.cwd());
  process.execve(startScript, [startScript], { ...process.env, ...readEnvironmentFile(environmentFile) });
}

export {
  deploymentServiceJournalWindow,
  ensureManagedServiceProcessOwnership,
  handleDeploymentServiceOperation,
  handleManagedServiceOperation,
  installSystemdUnit,
  printDeploymentServiceUnit,
  relinkSystemdUnits,
  runReleaseService,
  stopManagedServiceUnit
};
