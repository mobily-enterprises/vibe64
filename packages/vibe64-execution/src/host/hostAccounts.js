// The host's accounts and groups as the helper sees them: validated usernames, the workspace a daemon serves,
// and the root commands that change accounts.

import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { openDirectoryBelow, readOwnedFile } from "./hostFiles.js";

// The daemon's membership records of its users, below its home.
const MEMBERSHIP_DIRECTORY = [".local", "state", "vibe64", "users"];
const MEMBERSHIP_LIMIT_BYTES = 64 * 1024;
const MANAGED_USERNAME_PATTERN = /^[a-z][a-z0-9_-]{0,61}[a-z0-9]$/u;
const VIBE64_GROUP = "vibe64";
const DAEMON_USERNAME_PREFIX = "v64d_";
const MANAGED_ROOT = "/var/lib/vibe64";
const RESERVED_HUMAN_USERNAMES = new Set([
  "root"
]);
const DEFAULT_HOST_SETTINGS_ROOT = "/etc/vibe64";

/**
 * The folder of the host's settings for this helper, which every path the helper keeps there derives from: its
 * settings file (exec-helper.env), its people's sudo commands, the people and applications it registered and the
 * staging keys. It is /etc/vibe64 unless VIBE64_HOST_SETTINGS_ROOT names another, an absolute, normalized path
 * other than /; anything else is refused.
 *
 * An environment variable is safe here because the helper acts as root only through sudo, whose env_reset drops
 * every variable its caller sets, so no caller chooses the folder. A host that keeps the folder elsewhere (one whose
 * /etc cannot be written) makes its sudo target a root-owned launcher, in a folder only root can change, that sets
 * the variable itself. Where the helper runs as an account of its own (a staging login), naming another folder
 * gains it nothing: the helper reads only files root owns there and acts only as that account.
 * @param {Record<string, string | undefined>} [env]
 */
function hostSettingsRoot(env = process.env) {
  const configured = String(env.VIBE64_HOST_SETTINGS_ROOT ?? "");
  if (!configured) return DEFAULT_HOST_SETTINGS_ROOT;
  if (!path.isAbsolute(configured) || path.resolve(configured) !== configured || configured === "/") {
    throw new Error(`Vibe64 exec helper refused its settings folder VIBE64_HOST_SETTINGS_ROOT=${JSON.stringify(configured)}: ` +
      "it is not an absolute, normalized path other than /.");
  }
  return configured;
}

// Read once, as the helper loads.
const HOST_SETTINGS_ROOT = hostSettingsRoot();
const STAGING_ACCOUNT_USERNAME_PREFIX = "v64s_";
// A staging account has no login, except while staging access gives it one (stagingAccess.js).
const STAGING_ACCOUNT_SHELL = "/usr/sbin/nologin";

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
  if (username.startsWith(STAGING_ACCOUNT_USERNAME_PREFIX)) {
    throw new Error("Vibe64 staging accounts are never people.");
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

// useradd, userdel and gpasswd write the account database the host's helper settings name
// (hostSettings.js): the system's own files, or the extra users database, which only they reach.
function accountDatabaseOptions(database = "files") {
  return database === "extrausers" ? ["--extrausers"] : [];
}

// A person made here gets the password given, and a number as the host numbers the helper's new accounts
// (numberOptions, hostSettings.js). A host keeping its accounts in the extra users database signs people in
// without one, so the helper makes no person there.
function createSystemUser(username = "", password = "", database = "files", numberOptions = []) {
  if (database === "extrausers") {
    throw new Error("This host keeps its accounts in the extra users database, where people sign in without a " +
      "password: the helper creates no person with one here.");
  }
  if (tryResolveOsUser(username)) {
    throw new Error(`OS user already exists: ${username}`);
  }
  if (!password || /[\r\n]/u.test(password)) {
    throw new Error("A valid initial password is required to create an OS user.");
  }
  runRootCommand("useradd", [
    ...numberOptions,
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

// usermod has no --extrausers, and its -a -G leaves a group in the extra users database unchanged.
function addUserToGroup(username = "", groupName = "", database = "files") {
  if (database === "extrausers") {
    runRootCommand("gpasswd", ["--extrausers", "-a", username, groupName]);
    return;
  }
  runRootCommand("usermod", [
    "-a",
    "-G",
    groupName,
    username
  ]);
}

// The extra users database's own folder (libnss-extrausers).
const EXTRAUSERS_ROOT = "/var/lib/extrausers";

// usermod changes an account in the extra users database, but opens the system's own account files for writing as
// it does, which fails where those files cannot be written. Given a prefix whose etc folder is that database, it
// touches only the database: a folder root makes for the call in /run, where nobody else may write,
// named for this process (the helper makes no temporary folders), after removing one an earlier run of the same
// number left.
function changeLoginShell(username = "", shell = "", database = "files", {
  prefixParent = "/run",
  run = runRootCommand
} = {}) {
  if (database !== "extrausers") {
    run("usermod", ["--shell", shell, username]);
    return;
  }
  const prefix = path.join(prefixParent, `vibe64-accounts-${process.pid}`);
  rmSync(prefix, { force: true, recursive: true });
  mkdirSync(prefix, { mode: 0o700 });
  try {
    symlinkSync(EXTRAUSERS_ROOT, path.join(prefix, "etc"));
    run("usermod", ["--prefix", prefix, "--shell", shell, username]);
  } finally {
    rmSync(prefix, { force: true, recursive: true });
  }
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
    const directory = openDirectoryBelow(owner.home, MEMBERSHIP_DIRECTORY);
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

export {
  accountDatabaseOptions,
  addUserToGroup,
  STAGING_ACCOUNT_SHELL,
  STAGING_ACCOUNT_USERNAME_PREFIX,
  assertEnabledForVibe64,
  assertExpectedId,
  assertHumanUsername,
  assertUserInGroup,
  changeLoginShell,
  createSystemUser,
  DAEMON_USERNAME_PREFIX,
  ensureGroup,
  HOST_SETTINGS_ROOT,
  hostSettingsRoot,
  MANAGED_ROOT,
  MANAGED_USERNAME_PATTERN,
  MEMBERSHIP_DIRECTORY,
  MEMBERSHIP_LIMIT_BYTES,
  osGroupNames,
  resolveOsUser,
  resolveOwnerUser,
  runRootCommand,
  runRootCommandAllowFailure,
  safeUsername,
  tryResolveOsUser,
  VIBE64_GROUP,
  workspaceFromDaemonUsername,
  workspaceTempRoot
};
