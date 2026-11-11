// The host's accounts and groups as the helper sees them: validated usernames, the workspace a daemon serves,
// and the root commands that change accounts.

import { spawnSync } from "node:child_process";
import { closeSync } from "node:fs";
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
const HOST_SETTINGS_ROOT = "/etc/vibe64";
const APPLICATION_USERNAME_PREFIX = "v64a_";
// An application account has no login, except while production access gives it one (productionAccess.js).
const APPLICATION_SHELL = "/usr/sbin/nologin";

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
  addUserToGroup,
  APPLICATION_SHELL,
  APPLICATION_USERNAME_PREFIX,
  assertEnabledForVibe64,
  assertExpectedId,
  assertHumanUsername,
  assertUserInGroup,
  createSystemUser,
  DAEMON_USERNAME_PREFIX,
  ensureGroup,
  HOST_SETTINGS_ROOT,
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
