// A project's production as its own AI sessions reach it over SSH, while the workspace owner allows it:
// - the daemon's `production-access` operation installs or removes the project's key (productionAccess.js) and
//   reads what those logins did;
// - `production-shell` is the forced command of every such login: as the application account, in its live
//   release's folder, with the Env and runtimes that release runs with, never root;
// - `production-service`, which that login reaches through its own narrow sudo rule, reads its live release
//   service's output and state, or restarts it, and nothing else.
// The login runs outside the release service's sandbox, as the person's own login would, so mounts the service
// makes in namespaces of its own are not there.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { applicationIdentity, installedReleaseUnits, registeredApplicationUser } from "./applicationAccounts.js";
import { readEnvironmentFile } from "./commandEnvironment.js";
import {
  APPLICATION_USERNAME_PREFIX,
  resolveOsUser,
  resolveOwnerUser,
  runRootCommand,
  runRootCommandAllowFailure,
  safeUsername,
  tryResolveOsUser
} from "./hostAccounts.js";
import { installProductionAccess, PRODUCTION_LOGIN_SHELL, productionAccessGranted, removeProductionAccess } from "./productionAccess.js";
import { deploymentServiceJournalWindow, printDeploymentServiceUnit } from "./serviceOperations.js";

const APPLICATION_USERNAME_PATTERN = new RegExp(`^${APPLICATION_USERNAME_PREFIX}[a-f0-9]{12}$`, "u");
// The one key Vibe64 makes per project: an Ed25519 public key in OpenSSH's one-line form.
const PRODUCTION_PUBLIC_KEY_PATTERN = /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43}$/u;
// What each login records in the host's journal, as the application account: what it ran, from which session.
const PRODUCTION_LOG_TAG = "vibe64-production";
const PRODUCTION_ACTIVITY_MAX_ENTRIES = 500;
const PRODUCTION_LOGS_DEFAULT_LINES = 200;
const PRODUCTION_SESSION_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
// A start script that runs the command it is given, in the release's own Env, instead of the release's Serve
// command (releases published since production logins exist).
const START_SCRIPT_RUNS_ARGUMENTS = "[ \"$#\" -eq 0 ] || exec \"$@\"";
const SFTP_SERVERS = Object.freeze(["/usr/lib/openssh/sftp-server", "/usr/libexec/openssh/sftp-server", "/usr/lib/sftp-server"]);
const RUN_RELEASE_SERVICE_PATTERN = / run-release-service "((?:[^"\\]|\\.)*)" "((?:[^"\\]|\\.)*)"$/u;

function writeJson(value) {
  process.stdout.write(`${JSON.stringify({ ok: true, ...value })}\n`);
}

/**
 * The daemon's `production-access` operation for one of its workspace's projects: grant installs the project's
 * public key for its application account, revoke takes it back and ends that account's open logins, and
 * activity reads what those logins recorded.
 */
function handleProductionAccessOperation(payload = {}) {
  const owner = resolveOwnerUser();
  const action = String(payload.action || "").trim();
  const identity = applicationIdentity(owner, payload.project);
  if (action === "grant") {
    const publicKey = String(payload.publicKey || "").trim();
    if (!PRODUCTION_PUBLIC_KEY_PATTERN.test(publicKey)) {
      throw new Error("Vibe64 exec helper accepts one ssh-ed25519 public key for production access.");
    }
    installProductionAccess(registeredApplicationUser(owner, identity.username), publicKey, path.resolve(process.argv[1]));
    writeJson({ account: identity.username });
    return;
  }
  if (action === "revoke") {
    writeJson({ account: identity.username, revoked: removeProductionAccess(tryResolveOsUser(identity.username), identity.username) });
    return;
  }
  if (action === "activity") {
    writeJson({ account: identity.username, entries: productionActivity(tryResolveOsUser(identity.username)) });
    return;
  }
  throw new Error("Vibe64 exec helper rejected an unknown production access action.");
}

// The newest login records of the account, oldest first, as journald stamped them: only lines the account itself
// logged under Vibe64's tag, which its forced command writes at each login's start and end.
function productionActivity(user, { runRootAllowFailure = runRootCommandAllowFailure } = {}) {
  if (!user) return [];
  const result = runRootAllowFailure("journalctl", [
    "--no-pager",
    "--output=json",
    `--lines=${PRODUCTION_ACTIVITY_MAX_ENTRIES}`,
    `SYSLOG_IDENTIFIER=${PRODUCTION_LOG_TAG}`,
    `_UID=${user.uid}`
  ]);
  return String(result.stdout || "").split("\n").flatMap((line) => {
    try {
      const entry = JSON.parse(line);
      const at = Number(entry.__REALTIME_TIMESTAMP) / 1000;
      return typeof entry.MESSAGE === "string" && Number.isFinite(at)
        ? [{ at: new Date(at).toISOString(), message: entry.MESSAGE }]
        : [];
    } catch {
      return [];
    }
  });
}

function unitValue(lines = [], prefix = "") {
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  return line ? line.slice(prefix.length).replace(/\\(.)/gu, "$1") : "";
}

/**
 * The release unit root installed for the account: the running one, or the last of its own when none runs. It
 * names the release's folder, its Env file and start script, and the PATH its service starts with.
 * @param {string} username
 */
function liveReleaseUnit(username, {
  isActive = (name) => spawnSync("systemctl", ["is-active", "--quiet", name]).status === 0,
  units = () => installedReleaseUnits()
} = {}) {
  const own = units().filter(({ lines }) => lines.includes(`User=${username}`));
  const unit = own.find(({ name }) => isActive(name)) || own.at(-1);
  if (!unit) return null;
  const started = RUN_RELEASE_SERVICE_PATTERN.exec(unit.lines.find((line) => line.startsWith("ExecStart=")) || "");
  if (!started) {
    throw new Error(`Release unit ${unit.name} does not start a Vibe64 release service.`);
  }
  return {
    environmentFile: started[1].replace(/\\(.)/gu, "$1"),
    name: unit.name,
    path: unitValue(unit.lines, "Environment=PATH="),
    startScript: started[2].replace(/\\(.)/gu, "$1"),
    workingDirectory: unitValue(unit.lines, "WorkingDirectory=")
  };
}

function productionShellFunctions(helperPath = "") {
  const helper = `sudo -n ${helperPath} production-service`;
  return {
    "BASH_FUNC_production-logs%%": `() {  ${helper} logs "$@"\n}`,
    "BASH_FUNC_production-restart%%": `() {  ${helper} restart "$@"\n}`,
    "BASH_FUNC_production-status%%": `() {  ${helper} status "$@"\n}`
  };
}

/**
 * What a production login runs: the account's shell, which is interactive on a terminal and otherwise runs the
 * script it is given on its input, an SFTP server for scp and sftp, or the command the client gave (rsync's and
 * ssh's) through that shell. It reads no profile or rc file, so the release's PATH stays and nothing the
 * application wrote in its own home runs in the login.
 * @param {string} original SSH_ORIGINAL_COMMAND
 */
function productionShellCommand(original = "", sftpServer = SFTP_SERVERS.find((candidate) => existsSync(candidate))) {
  if (!original) return { argv: [PRODUCTION_LOGIN_SHELL, "--norc"], sftp: false };
  if (original === "internal-sftp" || SFTP_SERVERS.includes(original.split(" ")[0])) {
    if (!sftpServer) throw new Error("This host has no SFTP server for scp and sftp.");
    return { argv: [sftpServer], sftp: true };
  }
  return { argv: [PRODUCTION_LOGIN_SHELL, "-c", original], sftp: false };
}

function recordProductionLogin(event = {}) {
  spawnSync("logger", ["--tag", PRODUCTION_LOG_TAG, "--", JSON.stringify(event)], { stdio: "ignore" });
}

/**
 * sshd's forced command for an application account's production login, run as that account: it starts what the
 * client asked for in the live release's folder with that release's Env (its database connection included),
 * runtimes and PATH, plus production-logs, production-status and production-restart, and records the login's
 * start and end.
 */
function runProductionShell({ env = process.env, helperPath = path.resolve(process.argv[1]) } = {}) {
  const username = os.userInfo().username;
  if (!APPLICATION_USERNAME_PATTERN.test(username)) {
    throw new Error("Only an application account's production login starts here.");
  }
  const unit = liveReleaseUnit(username);
  if (!unit) {
    process.stderr.write("This project has no release installed on this host, so there is no production to enter. Publish it first.\n");
    process.exit(1);
  }
  const original = String(env.SSH_ORIGINAL_COMMAND || "");
  const session = String(env.VIBE64_AGENT_ENV_COMMAND_SESSION_ID || "");
  const login = {
    release: path.basename(path.dirname(unit.environmentFile)),
    session: PRODUCTION_SESSION_PATTERN.test(session) ? session : ""
  };
  const command = productionShellCommand(original);
  recordProductionLogin({ ...login, command: original.slice(0, 2000), event: "start" });
  const runsArguments = readFileSync(unit.startScript, "utf8").split("\n").includes(START_SCRIPT_RUNS_ARGUMENTS);
  // A release published before its start script ran other commands gets its Env file and the service's PATH,
  // without what its start script adds (its runtimes and Serve defaults such as NODE_ENV).
  const [file, ...args] = runsArguments && !command.sftp ? [unit.startScript, ...command.argv] : command.argv;
  const started = Date.now();
  // Like a shell waiting for its foreground job: an interrupt from the terminal is for the command, and this
  // process stays to record how the login ended.
  for (const signal of ["SIGINT", "SIGQUIT"]) process.on(signal, () => {});
  const child = spawnSync(file, args, {
    cwd: unit.workingDirectory,
    env: {
      ...env,
      PATH: unit.path || env.PATH || "",
      ...readEnvironmentFile(unit.environmentFile),
      ...productionShellFunctions(helperPath),
      VIBE64_RELEASE_UNIT: unit.name
    },
    stdio: "inherit"
  });
  const exitCode = typeof child.status === "number" ? child.status : 1;
  recordProductionLogin({ ...login, durationMs: Date.now() - started, event: "end", exitCode });
  process.exit(exitCode);
}

function productionServiceUsage() {
  return new Error([
    "Usage, inside a production login:",
    "  production-logs [--lines <n>] [--since <time>]   the live release service's newest output (200 lines)",
    "  production-status                                its state and newest output",
    "  production-restart                               restart it, then show its state"
  ].join("\n"));
}

function productionLogWindow(args = []) {
  const given = {};
  for (let index = 0; index < args.length; index += 1) {
    const [name, inline] = args[index].includes("=")
      ? [args[index].slice(0, args[index].indexOf("=")), args[index].slice(args[index].indexOf("=") + 1)]
      : [args[index], undefined];
    if (!["--lines", "--since"].includes(name) || name in given) throw productionServiceUsage();
    const value = inline ?? args[index + 1];
    if (value === undefined) throw productionServiceUsage();
    if (inline === undefined) index += 1;
    given[name] = value;
  }
  if (given["--lines"] !== undefined && !/^\d{1,4}$/u.test(given["--lines"])) throw productionServiceUsage();
  return deploymentServiceJournalWindow({
    lines: given["--lines"] === undefined ? PRODUCTION_LOGS_DEFAULT_LINES : Number(given["--lines"]),
    since: given["--since"] || ""
  });
}

/**
 * `production-service`, which only an application account with production access may run, through sudo: the
 * output, state or restart of its own live release service, found as root installed it.
 * @param {string[]} args
 */
function runProductionService(args = [], { env = process.env } = {}) {
  const caller = safeUsername(env.SUDO_USER || "");
  if (!APPLICATION_USERNAME_PATTERN.test(caller) || String(resolveOsUser(caller).uid) !== String(env.SUDO_UID || "")) {
    throw new Error("Only an application account's production login may use production-service.");
  }
  if (!productionAccessGranted(caller)) {
    throw new Error("AI sessions may not use this production now: the workspace owner has turned that off.");
  }
  const unit = liveReleaseUnit(caller);
  if (!unit) throw new Error("This project has no release installed on this host.");
  const [action = "", ...rest] = args;
  if (action === "logs") {
    printDeploymentServiceUnit(unit.name, { ...productionLogWindow(rest), timestamps: true });
    return;
  }
  if (rest.length > 0 || !["restart", "status"].includes(action)) throw productionServiceUsage();
  if (action === "restart") runRootCommand("systemctl", ["restart", unit.name]);
  printDeploymentServiceUnit(unit.name, { lines: 20, timestamps: true });
}

export {
  handleProductionAccessOperation,
  liveReleaseUnit,
  productionActivity,
  productionLogWindow,
  productionShellCommand,
  productionShellFunctions,
  runProductionService,
  runProductionShell,
  START_SCRIPT_RUNS_ARGUMENTS
};
