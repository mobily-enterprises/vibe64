// A project's staging as its own AI sessions reach it over SSH, while the workspace owner allows it:
// - the daemon's `staging-access` operation installs or removes the project's key (stagingAccess.js) and
//   reads what those logins did;
// - `staging-shell` is the forced command of every such login: as the staging account, in its running
//   staging release's folder, with the Env and runtimes that release runs with, never root;
// - `staging-service`, which that login reaches through its own narrow sudo rule, reads its staging
//   service's output and state, restarts it, or enters it, and nothing else;
// - `staging-enter`, which that last one starts, runs as the account where the running service runs.
// The login runs outside the staging service's sandbox, as the person's own login would, so mounts the service
// makes in namespaces of its own (its private /tmp, a FUSE volume) are there only through staging-enter.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  STAGING_ACCOUNT_USERNAME_PATTERN,
  stagingAccountIdentity,
  installedStagingUnits,
  registeredStagingAccount
} from "./stagingAccounts.js";
import { readEnvironmentFile } from "./commandEnvironment.js";
import {
  resolveOsUser,
  resolveOwnerUser,
  runRootCommand,
  runRootCommandAllowFailure,
  safeUsername,
  tryResolveOsUser
} from "./hostAccounts.js";
import { helperCommand, RUNTIME_PACK_ROOT_ENV } from "./hostSettings.js";
import { RUNTIME_PACK_ROOT_UNIT_LINE } from "./systemdUnits.js";
import { installStagingAccess, removeStagingAccess, stagingAccessGranted } from "./stagingAccess.js";
import { stagingJournalWindow, printStagingUnit } from "./serviceOperations.js";

// The one key Vibe64 makes per project: an Ed25519 public key in OpenSSH's one-line form.
const STAGING_PUBLIC_KEY_PATTERN = /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43}$/u;
// What each login reports in the host's journal, as the staging account: what it ran, from which session.
// The login writes it itself, so it is only what the login says; the host's own record of each login is logind's.
const STAGING_LOG_TAG = "vibe64-staging";
// The newest records of each kind activity reads; older ones are said to be left out.
const STAGING_ACTIVITY_MAX_ENTRIES = 500;
// systemd-logind's records of a login session's start and end (systemd's message catalogue ids), which root's
// logind writes however the login ends: logout, a dropped connection or revoke's terminate-user.
const LOGIN_SESSION_EVENTS = Object.freeze({
  "3354939424b4456d9802ca8333ed424a": "closed",
  "8d45620c1a4348dbb17410da57c60c66": "opened"
});
const STAGING_LOGS_DEFAULT_LINES = 200;
const STAGING_SESSION_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const LOGIN_SESSION_ID_PATTERN = /^[A-Za-z0-9]{1,32}$/u;
// The shell of a staging login and of staging-enter: bash reading no profile or rc file, so what runs is the
// release's PATH and Env, never a file the application wrote in its own home.
const STAGING_SHELL = Object.freeze(["/bin/bash", "--noprofile", "--norc"]);
// A start script that runs the command it is given, in the release's own Env, instead of the release's Serve
// command (releases published since staging logins exist).
const START_SCRIPT_RUNS_ARGUMENTS = "[ \"$#\" -eq 0 ] || exec \"$@\"";
const SFTP_SERVERS = Object.freeze(["/usr/lib/openssh/sftp-server", "/usr/libexec/openssh/sftp-server", "/usr/lib/sftp-server"]);
const RUN_STAGING_UNIT_PATTERN = / run-staging-unit "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)"$/u;
const NSENTER = "/usr/bin/nsenter";

function writeJson(value) {
  process.stdout.write(`${JSON.stringify({ ok: true, ...value })}\n`);
}

/**
 * The daemon's `staging-access` operation for one of its workspace's projects: grant installs the project's
 * public key for its staging account, revoke takes it back and ends that account's open logins, and
 * activity reads what those logins recorded.
 */
function handleStagingAccessOperation(payload = {}) {
  const owner = resolveOwnerUser();
  const action = String(payload.action || "").trim();
  const identity = stagingAccountIdentity(owner, payload.project);
  if (action === "grant") {
    const publicKey = String(payload.publicKey || "").trim();
    if (!STAGING_PUBLIC_KEY_PATTERN.test(publicKey)) {
      throw new Error("Vibe64 exec helper accepts one ssh-ed25519 public key for staging access.");
    }
    installStagingAccess(registeredStagingAccount(owner, identity.username), publicKey, helperCommand());
    writeJson({ account: identity.username });
    return;
  }
  if (action === "revoke") {
    writeJson({ account: identity.username, revoked: removeStagingAccess(tryResolveOsUser(identity.username), identity.username) });
    return;
  }
  if (action === "activity") {
    writeJson({ account: identity.username, ...stagingActivity(tryResolveOsUser(identity.username)) });
    return;
  }
  throw new Error("Vibe64 exec helper rejected an unknown staging access action.");
}

// The newest journal entries that match, oldest first, as journald stamped them, and whether older ones are left out.
function journalWindow(matches = [], runRootAllowFailure = runRootCommandAllowFailure) {
  const result = runRootAllowFailure("journalctl", [
    "--no-pager",
    "--output=json",
    `--lines=${STAGING_ACTIVITY_MAX_ENTRIES + 1}`,
    ...matches
  ]);
  const lines = String(result.stdout || "").split("\n").filter(Boolean);
  const entries = lines.slice(-STAGING_ACTIVITY_MAX_ENTRIES).flatMap((line) => {
    try {
      const entry = JSON.parse(line);
      const at = Number(entry.__REALTIME_TIMESTAMP) / 1000;
      return Number.isFinite(at) ? [{ at: new Date(at).toISOString(), entry }] : [];
    } catch {
      return [];
    }
  });
  return { entries, olderOmitted: lines.length > STAGING_ACTIVITY_MAX_ENTRIES };
}

/**
 * The account's staging logins, oldest first: the host's own record of each login's start and end (`source:
 * "host"`, root's logind, which the account cannot write) and what each login reported itself (`source: "login"`,
 * the lines its forced command logged as the account under Vibe64's tag: its command and session). Each kind keeps
 * its newest entries, so a login that reports a lot cannot push the host's record out.
 * @param {{ uid: number, username: string } | null} user
 */
function stagingActivity(user, { runRootAllowFailure = runRootCommandAllowFailure } = {}) {
  if (!user) return { entries: [], olderOmitted: { host: false, login: false } };
  const host = journalWindow(["_UID=0", "_SYSTEMD_UNIT=systemd-logind.service", `USER_ID=${user.username}`], runRootAllowFailure);
  const reported = journalWindow([`SYSLOG_IDENTIFIER=${STAGING_LOG_TAG}`, `_UID=${user.uid}`], runRootAllowFailure);
  const entries = [
    ...host.entries.flatMap(({ at, entry }) => {
      const event = LOGIN_SESSION_EVENTS[entry.MESSAGE_ID];
      return event && typeof entry.SESSION_ID === "string" ? [{ at, event, login: entry.SESSION_ID, source: "host" }] : [];
    }),
    ...reported.entries.flatMap(({ at, entry }) => (typeof entry.MESSAGE === "string"
      ? [{ at, message: entry.MESSAGE, source: "login" }]
      : []))
  ].sort((left, right) => left.at.localeCompare(right.at));
  return { entries, olderOmitted: { host: host.olderOmitted, login: reported.olderOmitted } };
}

// A value as the staging unit writes it, its backslash escapes undone.
function unitText(value = "") {
  return value.replace(/\\(.)/gu, "$1");
}

function unitValue(lines = [], prefix = "") {
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  return line ? unitText(line.slice(prefix.length)) : "";
}

/**
 * The staging unit root installed for the account: the running one, or the last of its own when none runs. It
 * names the release's folder, its Env file and start script, and the PATH and runtime pack folder its service starts
 * with.
 * @param {string} username
 */
function runningStagingUnit(username, {
  isActive = (name) => spawnSync("systemctl", ["is-active", "--quiet", name]).status === 0,
  units = () => installedStagingUnits()
} = {}) {
  const own = units().filter(({ lines }) => lines.includes(`User=${username}`));
  const unit = own.find(({ name }) => isActive(name)) || own.at(-1);
  if (!unit) return null;
  const started = RUN_STAGING_UNIT_PATTERN.exec(unit.lines.find((line) => line.startsWith("ExecStart=")) || "");
  if (!started) {
    throw new Error(`Staging unit ${unit.name} does not start a Vibe64 staging service.`);
  }
  return {
    environmentFile: unitText(started[1]),
    name: unit.name,
    path: unitValue(unit.lines, "Environment=PATH="),
    runtimePackRoot: unitValue(unit.lines, RUNTIME_PACK_ROOT_UNIT_LINE),
    startScript: unitText(started[2]),
    workingDirectory: unitValue(unit.lines, "WorkingDirectory=")
  };
}

// The runtime pack folder the unit names beside its PATH, by which that PATH's tool wrappers find their packs, so a login
// and staging-enter run npm and the rest as the service does; none when the unit names none.
function unitRuntimePackEnvironment(unit = {}) {
  return unit.runtimePackRoot ? { [RUNTIME_PACK_ROOT_ENV]: unit.runtimePackRoot } : {};
}

// staging-enter, staging-logs, staging-restart and staging-status, as functions bash imports.
function stagingShellFunctions(helperPath = "") {
  return Object.fromEntries(["enter", "logs", "restart", "status"].map((action) => [
    `BASH_FUNC_staging-${action}%%`,
    `() {  sudo -n ${helperPath} staging-service ${action} "$@"\n}`
  ]));
}

/**
 * What a staging login runs: bash, which is interactive on a terminal and otherwise runs the script it is given
 * on its input, an SFTP server for scp and sftp, or the command the client gave (rsync's and ssh's) through bash.
 * sshd starts this forced command through the account's login shell, /bin/sh, which reads no file of the
 * account's, and ~/.ssh/rc is off; bash here reads no profile or rc file either, and gets no BASH_ENV or ENV
 * (runStagingShell), so the release's PATH stays and no shell file the application wrote in its own home
 * runs. sshd's PAM stack may still set the login's environment from a file of the account's (such as Ubuntu's
 * ~/.pam_environment, which could name LD_PRELOAD), which is why the login's report is only what it says.
 * @param {string} original SSH_ORIGINAL_COMMAND
 */
function stagingShellCommand(original = "", sftpServer = SFTP_SERVERS.find((candidate) => existsSync(candidate))) {
  if (!original) return { argv: [...STAGING_SHELL], sftp: false };
  // sshd names the sftp subsystem as its configured command, "internal-sftp " for scp and sftp.
  const program = original.trim().split(/\s+/u)[0];
  if (program === "internal-sftp" || SFTP_SERVERS.includes(program)) {
    if (!sftpServer) throw new Error("This host has no SFTP server for scp and sftp.");
    return { argv: [sftpServer], sftp: true };
  }
  return { argv: [...STAGING_SHELL, "-c", original], sftp: false };
}

// A release published since staging logins exist: its start script runs the command it is given in the
// release's Env, with its runtimes and Serve defaults, instead of Serve.
function startScriptRunsArguments(startScript = "") {
  return readFileSync(startScript, "utf8").split("\n").includes(START_SCRIPT_RUNS_ARGUMENTS);
}

function recordStagingLogin(event = {}) {
  spawnSync("logger", ["--tag", STAGING_LOG_TAG, "--", JSON.stringify(event)], { stdio: "ignore" });
}

/**
 * What a staging login's command runs with: the login's own environment, without a file a shell would read before the
 * command (which only that environment could name), then the PATH and runtime pack folder the service starts with, as
 * its unit names them, the release's Env file, the staging-* functions and the unit's name.
 * @param {{ environmentFile: string, name: string, path: string, runtimePackRoot?: string }} unit
 * @param {{ env?: Record<string, string>, helperPath?: string, readEnvironment?: (file: string) => Record<string, string> }} options
 */
function stagingLoginEnvironment(unit, { env = process.env, helperPath = "", readEnvironment = readEnvironmentFile } = {}) {
  const inherited = { ...env };
  delete inherited.BASH_ENV;
  delete inherited.ENV;
  return {
    ...inherited,
    PATH: unit.path || env.PATH || "",
    ...unitRuntimePackEnvironment(unit),
    ...readEnvironment(unit.environmentFile),
    ...stagingShellFunctions(helperPath),
    VIBE64_STAGING_UNIT: unit.name
  };
}

/**
 * sshd's forced command for a staging account's staging login, run as that account: it starts what the
 * client asked for in the staging release's folder with that release's Env (its database connection included),
 * runtimes and PATH, plus staging-logs, staging-status, staging-restart and staging-enter, and
 * reports the login's command, session and end; logind records the login itself.
 */
function runStagingShell({ env = process.env, helperPath = helperCommand() } = {}) {
  const username = os.userInfo().username;
  if (!STAGING_ACCOUNT_USERNAME_PATTERN.test(username)) {
    throw new Error("Only a staging account's staging login starts here.");
  }
  const unit = runningStagingUnit(username);
  if (!unit) {
    process.stderr.write("This project has no release installed on this host, so there is no staging to enter. Publish it first.\n");
    process.exit(1);
  }
  const original = String(env.SSH_ORIGINAL_COMMAND || "");
  const session = String(env.VIBE64_AGENT_ENV_COMMAND_SESSION_ID || "");
  const loginSession = String(env.XDG_SESSION_ID || "");
  const login = {
    login: LOGIN_SESSION_ID_PATTERN.test(loginSession) ? loginSession : "",
    release: path.basename(path.dirname(unit.environmentFile)),
    session: STAGING_SESSION_PATTERN.test(session) ? session : ""
  };
  const command = stagingShellCommand(original);
  recordStagingLogin({ ...login, command: original.slice(0, 2000), event: "start" });
  // A release published before its start script ran other commands gets its Env file and the service's PATH,
  // without what its start script adds (its runtimes and Serve defaults such as NODE_ENV).
  const [file, ...args] = !command.sftp && startScriptRunsArguments(unit.startScript)
    ? [unit.startScript, ...command.argv]
    : command.argv;
  const started = Date.now();
  // Like a shell waiting for its foreground job: an interrupt from the terminal is for the command, and this
  // process stays to record how the login ended.
  for (const signal of ["SIGINT", "SIGQUIT"]) process.on(signal, () => {});
  const child = spawnSync(file, args, {
    cwd: unit.workingDirectory,
    env: stagingLoginEnvironment(unit, { env, helperPath }),
    stdio: "inherit"
  });
  const exitCode = typeof child.status === "number" ? child.status : 1;
  recordStagingLogin({ ...login, durationMs: Date.now() - started, event: "end", exitCode });
  process.exit(exitCode);
}

function stagingServiceUsage() {
  return new Error([
    "Usage, inside a staging login:",
    "  staging-logs [--lines <n>] [--since <time>]   the running staging service's newest output (200 lines)",
    "  staging-status                                its state and newest output",
    "  staging-restart                               restart it, then show its state",
    "  staging-enter [command...]                    run the command, or a shell, where the running service",
    "                                                runs: the files it sees, its own mounts included"
  ].join("\n"));
}

function stagingLogWindow(args = []) {
  const given = {};
  for (let index = 0; index < args.length; index += 1) {
    const [name, inline] = args[index].includes("=")
      ? [args[index].slice(0, args[index].indexOf("=")), args[index].slice(args[index].indexOf("=") + 1)]
      : [args[index], undefined];
    if (!["--lines", "--since"].includes(name) || name in given) throw stagingServiceUsage();
    const value = inline ?? args[index + 1];
    if (value === undefined) throw stagingServiceUsage();
    if (inline === undefined) index += 1;
    given[name] = value;
  }
  if (given["--lines"] !== undefined && !/^\d{1,4}$/u.test(given["--lines"])) throw stagingServiceUsage();
  return stagingJournalWindow({
    lines: given["--lines"] === undefined ? STAGING_LOGS_DEFAULT_LINES : Number(given["--lines"]),
    since: given["--since"] || ""
  });
}

/**
 * `staging-service`, which only a staging account with staging access may run, through sudo: the
 * output, state or restart of its own running staging service, found as root installed it, or a command where
 * that service runs.
 * @param {string[]} args
 */
function runStagingService(args = [], { env = process.env } = {}) {
  const caller = safeUsername(env.SUDO_USER || "");
  if (!STAGING_ACCOUNT_USERNAME_PATTERN.test(caller) || String(resolveOsUser(caller).uid) !== String(env.SUDO_UID || "")) {
    throw new Error("Only a staging account's staging login may use staging-service.");
  }
  if (!stagingAccessGranted(caller)) {
    throw new Error("AI sessions may not use this staging now: the workspace owner has turned that off.");
  }
  const unit = runningStagingUnit(caller);
  if (!unit) throw new Error("This project has no release installed on this host.");
  const [action = "", ...rest] = args;
  if (action === "enter") {
    enterStagingService(unit, resolveOsUser(caller), rest[0] === "--" ? rest.slice(1) : rest, { env });
    return;
  }
  if (action === "logs") {
    printStagingUnit(unit.name, { ...stagingLogWindow(rest), timestamps: true });
    return;
  }
  if (rest.length > 0 || !["restart", "status"].includes(action)) throw stagingServiceUsage();
  if (action === "restart") runRootCommand("systemctl", ["restart", unit.name]);
  printStagingUnit(unit.name, { lines: 20, timestamps: true });
}

/**
 * How root starts `staging-enter`: nsenter enters the mount namespace of the running service's main process
 * and becomes the staging account (its own group only, no supplementary ones) before anything there runs,
 * since that namespace may be one the application made itself; there the helper's `staging-enter` checks it
 * is the namespace root found for the service and starts the command with the release's files. A main process in
 * a user namespace of the application's own is joined there too, as the ids the account has in it.
 * @param {object} options
 * @param {string} options.mountNamespace the main process's mount namespace, as /proc names it (`mnt:[...]`)
 * @param {{ uid: number, gid: number } | null} [options.userNamespace] the account's ids in that user namespace
 */
function stagingEnterCommand({
  command = [], env = {}, helperPath = "", mountNamespace = "", pid = 0, unit = {}, user = {}, userNamespace = null
} = {}) {
  const ids = userNamespace || user;
  return {
    args: [NSENTER, `--target=${pid}`, "--mount", ...(userNamespace ? ["--user"] : []), `--setgid=${ids.gid}`,
      `--setuid=${ids.uid}`, "--", helperPath, "staging-enter", mountNamespace, unit.environmentFile,
      unit.startScript, unit.workingDirectory, ...command],
    env: {
      HOME: user.home,
      LANG: env.LANG || "C.UTF-8",
      LOGNAME: user.username,
      PATH: unit.path || env.PATH || "",
      ...unitRuntimePackEnvironment(unit),
      SHELL: STAGING_SHELL[0],
      TERM: env.TERM || "dumb",
      USER: user.username,
      VIBE64_STAGING_UNIT: unit.name
    },
    file: NSENTER
  };
}

function idInsideNamespace(map = "", id = -1) {
  for (const line of String(map).split("\n")) {
    const [inside, outside, count] = line.trim().split(/\s+/u).map(Number);
    if (id >= outside && id < outside + count) return inside + id - outside;
  }
  return null;
}

/**
 * The account's ids in the user namespace of the service's main process, when the application made one of its
 * own (to mount a FUSE volume, which with allow_other admits only that namespace's processes), or null when it
 * runs in the host's.
 * @param {number} pid
 * @param {{ uid: number, gid: number }} user
 */
function serviceUserNamespace(pid, user, {
  link = (file) => readlinkSync(file),
  read = (file) => readFileSync(file, "utf8")
} = {}) {
  if (link(`/proc/${pid}/ns/user`) === link("/proc/self/ns/user")) return null;
  const ids = { gid: idInsideNamespace(read(`/proc/${pid}/gid_map`), user.gid), uid: idInsideNamespace(read(`/proc/${pid}/uid_map`), user.uid) };
  if (ids.uid === null || ids.gid === null) {
    throw new Error("The running staging service runs in a user namespace of its own that does not include its account, " +
      "so staging-enter cannot join it.");
  }
  return ids;
}

// A process's cgroup, as cgroup v2 names it, or "" when it is gone.
function processCgroup(pid, read) {
  try {
    const line = read(`/proc/${pid}/cgroup`).split("\n").find((candidate) => candidate.startsWith("0::"));
    return line ? line.slice(3) : "";
  } catch {
    return "";
  }
}

/**
 * Root enters the account's running staging service: its main process, which must still be in the service's own
 * cgroup when root reads its namespaces and after, since a main process that ended leaves its number to any
 * process the host starts next.
 */
function enterStagingService(unit = {}, user = {}, command = [], {
  env = process.env,
  execve = (file, args, environment) => process.execve(file, args, environment),
  link = (file) => readlinkSync(file),
  read = (file) => readFileSync(file, "utf8"),
  runRoot = runRootCommand
} = {}) {
  const shown = Object.fromEntries(runRoot("systemctl", ["show", unit.name, "--property=MainPID", "--property=ControlGroup"])
    .split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
  const pid = Number(shown.MainPID);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`The running staging service ${unit.name} is not running, so there is nothing to enter. ` +
      "staging-status shows why; staging-restart starts it again.");
  }
  const inService = () => {
    const cgroup = processCgroup(pid, read);
    return Boolean(shown.ControlGroup) && (cgroup === shown.ControlGroup || cgroup.startsWith(`${shown.ControlGroup}/`));
  };
  const changed = new Error(`The running staging service ${unit.name} changed while staging-enter started; try again.`);
  if (!inService()) throw changed;
  const mountNamespace = link(`/proc/${pid}/ns/mnt`);
  const userNamespace = serviceUserNamespace(pid, user, { link, read });
  if (!inService()) throw changed;
  const entered = stagingEnterCommand({ command, env, helperPath: helperCommand(), mountNamespace, pid,
    unit, user, userNamespace });
  execve(entered.file, entered.args, entered.env);
}

/**
 * What `staging-enter` runs, as the login would: the command, or the account's shell, through the release's
 * start script when it runs the command it is given, otherwise directly with the Env file alone.
 * @param {string[]} command
 * @param {string} startScript the start script, or "" for a release whose start script runs only Serve
 */
function stagingEnterArgv(command = [], startScript = "") {
  const argv = command.length > 0 ? command : [...STAGING_SHELL];
  if (startScript) return [startScript, ...argv];
  return command.length > 0 ? [...STAGING_SHELL, "-c", "exec \"$@\"", "staging-enter", ...command] : argv;
}

/**
 * `staging-enter`'s second half, which root starts as the staging account inside its running staging
 * service's mount namespace: the command in the release's folder with the release's Env, which the account
 * itself reads there, once it is in the namespace root found for that service.
 * @param {string[]} args the service's mount namespace, the release's Env file, start script and folder, then the
 *   command
 */
function runStagingEnter([mountNamespace = "", environmentFile = "", startScript = "", workingDirectory = "", ...command] = [], {
  env = process.env,
  link = (file) => readlinkSync(file)
} = {}) {
  // Root starts it already as the account; inside the application's own user namespace that may be uid 0 there.
  if (!/^mnt:\[\d+\]$/u.test(mountNamespace) || ![environmentFile, startScript, workingDirectory].every((value) => path.isAbsolute(value))) {
    throw new Error("Only staging-enter, in a staging account's staging login, starts here.");
  }
  // nsenter reached the main process by its number, which another process may have taken meanwhile.
  if (link("/proc/self/ns/mnt") !== mountNamespace) {
    throw new Error("staging-enter did not reach the running staging service: its main process changed meanwhile. Try again.");
  }
  process.chdir(workingDirectory);
  const [file, ...args] = stagingEnterArgv(command, startScriptRunsArguments(startScript) ? startScript : "");
  process.execve(file, [file, ...args], { ...env, ...readEnvironmentFile(environmentFile) });
}

export {
  enterStagingService,
  handleStagingAccessOperation,
  runningStagingUnit,
  runStagingEnter,
  runStagingService,
  runStagingShell,
  serviceUserNamespace,
  stagingActivity,
  stagingEnterArgv,
  stagingEnterCommand,
  stagingLoginEnvironment,
  stagingLogWindow,
  stagingShellCommand,
  stagingShellFunctions,
  START_SCRIPT_RUNS_ARGUMENTS
};
