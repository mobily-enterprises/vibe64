// What lets a project's own AI sessions reach its production, while the workspace owner allows it: the
// application account's root-owned SSH key file, which host setup's SSH policy names for application accounts
// alone, and the sudo rule for that account's own service log and restart. Root writes and removes both; the
// account itself can never add a key or a rule. While they exist the account also has a login shell, since
// sshd starts even its forced command through that shell.

import { lstatSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { HOST_SETTINGS_ROOT, runRootCommand, runRootCommandAllowFailure } from "./hostAccounts.js";

const PRODUCTION_KEYS_ROOT = path.join(HOST_SETTINGS_ROOT, "production-ssh");
const PRODUCTION_SUDOERS_ROOT = "/etc/sudoers.d";
const PRODUCTION_LOGIN_SHELL = "/bin/bash";
const APPLICATION_NO_LOGIN_SHELL = "/usr/sbin/nologin";
const ROOT_UID = 0;

function productionKeysPath(username = "", keysRoot = PRODUCTION_KEYS_ROOT) {
  return path.join(keysRoot, username);
}

// sudo reads no file in sudoers.d whose name has a dot, and an application's name has none.
function productionSudoersPath(username = "", sudoersRoot = PRODUCTION_SUDOERS_ROOT) {
  return path.join(sudoersRoot, `vibe64-production-${username}`);
}

/** Whether root installed the account's production key: the workspace owner allows its AI sessions in. */
function productionAccessGranted(username = "", { keysRoot = PRODUCTION_KEYS_ROOT, rootUid = ROOT_UID } = {}) {
  try {
    const stats = lstatSync(productionKeysPath(username, keysRoot));
    return stats.isFile() && stats.uid === rootUid && (stats.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

// Root's own folder for the keys: sshd reads a key file only through folders no one else may change.
function ensureProductionKeysRoot(keysRoot = PRODUCTION_KEYS_ROOT, rootUid = ROOT_UID) {
  mkdirSync(keysRoot, { mode: 0o755, recursive: true });
  const stats = lstatSync(keysRoot);
  if (!stats.isDirectory() || stats.uid !== rootUid || (stats.mode & 0o022) !== 0) {
    throw new Error(`Vibe64 exec helper refused ${keysRoot}: it is not root's own folder.`);
  }
}

function replaceRootFile(target = "", content = "", mode = 0o644, check = null) {
  const temporary = `${path.dirname(target)}/.${path.basename(target)}.${process.pid}`;
  writeFileSync(temporary, content, { flag: "wx", mode });
  try {
    if (check) check(temporary);
    renameSync(temporary, target);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The rename's or check's own error is the one to report.
    }
    throw error;
  }
}

function removeIfPresent(file = "") {
  try {
    unlinkSync(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Installs the project's key for its application account, the sudo rule for its own service and its login shell.
 * The key works only from this host's own loopback, with no forwarding; sshd's policy for application accounts
 * adds the forced command that starts every login in the live release.
 * @param {{ username: string, shell: string }} user the registered application account
 * @param {string} publicKey one `ssh-ed25519 <key>` line
 * @param {string} helperPath this helper, which the sudo rule names
 */
function installProductionAccess(user, publicKey, helperPath, {
  keysRoot = PRODUCTION_KEYS_ROOT,
  rootUid = ROOT_UID,
  runRoot = runRootCommand,
  sudoersRoot = PRODUCTION_SUDOERS_ROOT
} = {}) {
  ensureProductionKeysRoot(keysRoot, rootUid);
  replaceRootFile(
    productionKeysPath(user.username, keysRoot),
    `from="127.0.0.1,::1",restrict,pty ${publicKey} vibe64-production\n`,
    0o644
  );
  replaceRootFile(
    productionSudoersPath(user.username, sudoersRoot),
    `${user.username} ALL=(root) NOPASSWD: ${helperPath} production-service *\n`,
    0o440,
    (candidate) => runRoot("visudo", ["-cqf", candidate])
  );
  if (user.shell !== PRODUCTION_LOGIN_SHELL) runRoot("usermod", ["--shell", PRODUCTION_LOGIN_SHELL, user.username]);
}

/**
 * Takes the account's production access back: its key, its sudo rule and its login shell, then ends the
 * logins still open. The account's release service runs outside any login and keeps running.
 * @param {{ username: string, shell?: string } | null} user the application account, if it still exists
 * @param {string} username
 */
function removeProductionAccess(user, username, {
  keysRoot = PRODUCTION_KEYS_ROOT,
  runRoot = runRootCommand,
  runRootAllowFailure = runRootCommandAllowFailure,
  sudoersRoot = PRODUCTION_SUDOERS_ROOT
} = {}) {
  const removedKey = removeIfPresent(productionKeysPath(username, keysRoot));
  const removedRule = removeIfPresent(productionSudoersPath(username, sudoersRoot));
  if (user && user.shell === PRODUCTION_LOGIN_SHELL) {
    runRoot("usermod", ["--shell", APPLICATION_NO_LOGIN_SHELL, username]);
  }
  // A user without a login has nothing to end, which loginctl reports as a failure.
  if (user) runRootAllowFailure("loginctl", ["terminate-user", username]);
  return removedKey || removedRule;
}

export {
  APPLICATION_NO_LOGIN_SHELL,
  installProductionAccess,
  PRODUCTION_KEYS_ROOT,
  PRODUCTION_LOGIN_SHELL,
  productionAccessGranted,
  productionKeysPath,
  productionSudoersPath,
  removeProductionAccess
};
