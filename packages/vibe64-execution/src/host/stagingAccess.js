// What lets a project's own AI sessions reach its staging, while the workspace owner allows it: the
// application account's root-owned SSH key file, which host setup's SSH policy names for application accounts
// alone, and the sudo rule for that account's own service log and restart. Root writes and removes both; the
// account itself can never add a key or a rule. While they exist the account also has a login shell, since
// sshd starts even its forced command through that shell: /bin/sh, which reads no file of the account's own
// before that command (bash, started by sshd, would read the ~/.bashrc the application can write). sshd's PAM
// stack may still read an environment file of the account's (Ubuntu's reads ~/.pam_environment), so what a
// login reports about itself stays only what it says; the host's record of each login is logind's.

import { lstatSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  APPLICATION_SHELL,
  changeLoginShell,
  HOST_SETTINGS_ROOT,
  runRootCommand,
  runRootCommandAllowFailure
} from "./hostAccounts.js";
import { helperAccountDatabase } from "./hostSettings.js";

const STAGING_KEYS_ROOT = path.join(HOST_SETTINGS_ROOT, "staging-ssh");
const STAGING_SUDOERS_ROOT = "/etc/sudoers.d";
const STAGING_LOGIN_SHELL = "/bin/sh";
const ROOT_UID = 0;
// Where root kept an account's key and sudo rule before production access was renamed staging access. Neither
// sshd's policy nor sudo's rule for this helper names them any more, so an account that still has one is neither
// granted nor revoked: the helper refuses it until root removes them.
const PRE_RENAME_KEYS_ROOT = path.join(HOST_SETTINGS_ROOT, "production-ssh");
const PRE_RENAME_SUDOERS_PREFIX = "vibe64-production-";

function stagingKeysPath(username = "", keysRoot = STAGING_KEYS_ROOT) {
  return path.join(keysRoot, username);
}

// sudo reads no file in sudoers.d whose name has a dot, and an application's name has none.
function stagingSudoersPath(username = "", sudoersRoot = STAGING_SUDOERS_ROOT) {
  return path.join(sudoersRoot, `vibe64-staging-${username}`);
}

/**
 * The account's key and sudo rule files under their names from before the rename to staging access, where root
 * has not removed them.
 * @param {string} username
 */
function preRenameStagingFiles(username = "", {
  preRenameKeysRoot = PRE_RENAME_KEYS_ROOT,
  sudoersRoot = STAGING_SUDOERS_ROOT
} = {}) {
  return [
    path.join(preRenameKeysRoot, username),
    path.join(sudoersRoot, `${PRE_RENAME_SUDOERS_PREFIX}${username}`)
  ].filter((file) => {
    try {
      lstatSync(file);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  });
}

/** Why the account's staging access cannot change while files from before the rename remain, or "". */
function preRenameStagingProblem(username = "", options = {}) {
  const files = preRenameStagingFiles(username, options);
  return files.length > 0
    ? `${username} still has ${files.join(" and ")} from before production access was renamed staging access. ` +
      "Root removes them, takes staging access back (staging-access revoke) and grants it again where the " +
      "workspace owner allows it."
    : "";
}

function assertNoPreRenameStagingFiles(username = "", options = {}) {
  const problem = preRenameStagingProblem(username, options);
  if (problem) throw new Error(`Vibe64 exec helper refused to change staging access: ${problem}`);
}

/** Whether root installed the account's staging key: the workspace owner allows its AI sessions in. */
function stagingAccessGranted(username = "", { keysRoot = STAGING_KEYS_ROOT, rootUid = ROOT_UID } = {}) {
  try {
    const stats = lstatSync(stagingKeysPath(username, keysRoot));
    return stats.isFile() && stats.uid === rootUid && (stats.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

// Root's own folder for the keys: sshd reads a key file only through folders no one else may change.
function ensureStagingKeysRoot(keysRoot = STAGING_KEYS_ROOT, rootUid = ROOT_UID) {
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
function installStagingAccess(user, publicKey, helperPath, {
  accountDatabase = helperAccountDatabase(),
  keysRoot = STAGING_KEYS_ROOT,
  prefixParent,
  preRenameKeysRoot = PRE_RENAME_KEYS_ROOT,
  rootUid = ROOT_UID,
  runRoot = runRootCommand,
  sudoersRoot = STAGING_SUDOERS_ROOT
} = {}) {
  assertNoPreRenameStagingFiles(user.username, { preRenameKeysRoot, sudoersRoot });
  ensureStagingKeysRoot(keysRoot, rootUid);
  replaceRootFile(
    stagingKeysPath(user.username, keysRoot),
    `from="127.0.0.1,::1",restrict,pty ${publicKey} vibe64-staging\n`,
    0o644
  );
  replaceRootFile(
    stagingSudoersPath(user.username, sudoersRoot),
    `${user.username} ALL=(root) NOPASSWD: ${helperPath} staging-service *\n`,
    0o440,
    (candidate) => runRoot("visudo", ["-cqf", candidate])
  );
  if (user.shell !== STAGING_LOGIN_SHELL) {
    changeLoginShell(user.username, STAGING_LOGIN_SHELL, accountDatabase, { prefixParent, run: runRoot });
  }
}

// The account's own at jobs, from root's list of every user's: the job number first, the user last.
function removeAtJobs(username = "", runRootAllowFailure = runRootCommandAllowFailure) {
  const listed = runRootAllowFailure("atq", []);
  if (listed.status !== 0) return;
  const jobs = String(listed.stdout || "").split("\n").map((line) => line.trim().split(/\s+/u))
    .filter((fields) => fields.length > 1 && fields.at(-1) === username)
    .map(([job]) => job);
  if (jobs.length > 0) runRootAllowFailure("atrm", jobs);
}

/**
 * Takes the account's staging access back: its key, its sudo rule and its login shell, then ends the
 * logins still open and removes what a login could leave to run later, outside any login: the account's
 * crontab, its at jobs and lingering. The account's release service runs outside any login and keeps running.
 * @param {{ username: string, shell?: string } | null} user the application account, if it still exists
 * @param {string} username
 */
function removeStagingAccess(user, username, {
  accountDatabase = helperAccountDatabase(),
  keysRoot = STAGING_KEYS_ROOT,
  prefixParent,
  preRenameKeysRoot = PRE_RENAME_KEYS_ROOT,
  runRoot = runRootCommand,
  runRootAllowFailure = runRootCommandAllowFailure,
  sudoersRoot = STAGING_SUDOERS_ROOT
} = {}) {
  assertNoPreRenameStagingFiles(username, { preRenameKeysRoot, sudoersRoot });
  const removedKey = removeIfPresent(stagingKeysPath(username, keysRoot));
  const removedRule = removeIfPresent(stagingSudoersPath(username, sudoersRoot));
  if (!user) return removedKey || removedRule;
  if (user.shell !== APPLICATION_SHELL) {
    changeLoginShell(username, APPLICATION_SHELL, accountDatabase, { prefixParent, run: runRoot });
  }
  // Each of these reports a failure when there is nothing to end or remove.
  runRootAllowFailure("loginctl", ["disable-linger", username]);
  runRootAllowFailure("loginctl", ["terminate-user", username]);
  runRootAllowFailure("crontab", ["-u", username, "-r"]);
  removeAtJobs(username, runRootAllowFailure);
  return removedKey || removedRule;
}

export {
  installStagingAccess,
  preRenameStagingProblem,
  removeStagingAccess,
  STAGING_LOGIN_SHELL,
  stagingAccessGranted
};
