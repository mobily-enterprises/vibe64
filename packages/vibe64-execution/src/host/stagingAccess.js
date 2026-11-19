// What lets a project's own AI sessions reach its staging, while the workspace owner allows it: the
// staging account's root-owned SSH key file, in the folder the host's sshd reads staging accounts' keys from,
// and the sudo rule for that account's own service log and restart. Root writes and removes both; the
// account itself can never add a key or a rule. While they exist the account also has a login shell, since
// sshd starts even its forced command through that shell: /bin/sh, which reads no file of the account's own
// before that command (bash, started by sshd, would read the ~/.bashrc the staging app can write). sshd's PAM
// stack may still read an environment file of the account's (Ubuntu's reads ~/.pam_environment), so what a
// login reports about itself stays only what it says; the host's record of each login is logind's.

import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  STAGING_ACCOUNT_SHELL,
  changeLoginShell,
  runRootCommand,
  runRootCommandAllowFailure
} from "./hostAccounts.js";
import { fsyncDirectory } from "./hostFiles.js";
import { helperAccountDatabase, helperStagingKeysRoot, helperSudoersRoot } from "./hostSettings.js";

const STAGING_LOGIN_SHELL = "/bin/sh";
const ROOT_UID = 0;

function stagingKeysPath(username = "", keysRoot = helperStagingKeysRoot()) {
  return path.join(keysRoot, username);
}

// sudo reads no file in an included folder whose name has a dot, and a staging account's name has none.
function stagingSudoersPath(username = "", sudoersRoot = helperSudoersRoot()) {
  return path.join(sudoersRoot, `vibe64-staging-${username}`);
}

// Whether the file is there, which looking finds out without writing anything.
function filePresent(file = "") {
  try {
    lstatSync(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/** Whether root installed the account's staging key: the workspace owner allows its AI sessions in. */
function stagingAccessGranted(username = "", { keysRoot = helperStagingKeysRoot(), rootUid = ROOT_UID } = {}) {
  try {
    const stats = lstatSync(stagingKeysPath(username, keysRoot));
    return stats.isFile() && stats.uid === rootUid && (stats.mode & 0o022) === 0;
  } catch {
    return false;
  }
}

// Root's own folder for the keys: sshd reads a key file only through folders no one else may change.
function ensureStagingKeysRoot(keysRoot = helperStagingKeysRoot(), rootUid = ROOT_UID) {
  mkdirSync(keysRoot, { mode: 0o755, recursive: true });
  const stats = lstatSync(keysRoot);
  if (!stats.isDirectory() || stats.uid !== rootUid || (stats.mode & 0o022) !== 0) {
    throw new Error(`Vibe64 exec helper refused ${keysRoot}: it is not root's own folder.`);
  }
}

// Durable: the new file's data reaches the disk before the rename, and its
// folder after it, so a power cut leaves the old file or the new one.
function replaceRootFile(target = "", content = "", mode = 0o644, check = null) {
  const temporary = `${path.dirname(target)}/.${path.basename(target)}.${process.pid}`;
  const descriptor = openSync(temporary, "wx", mode);
  try {
    try {
      writeFileSync(descriptor, content);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    if (check) check(temporary);
    renameSync(temporary, target);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The write's, check's or rename's own error is the one to report.
    }
    throw error;
  }
  fsyncDirectory(path.dirname(target));
}

// Looks before it removes, so taking back what an account never had writes nothing. On a read-only file system
// unlink fails (EROFS) before it looks the name up, a name that is not there included, so a host whose sudo rule
// folder is read-only, and so holds no rule of the account's, could otherwise take back no access at all. A file
// that is there is removed, or its removal's error reported, read-only file system included.
function removeIfPresent(file = "") {
  if (!filePresent(file)) return false;
  try {
    unlinkSync(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Installs the project's key for its staging account, the sudo rule for its own service and its login shell.
 * The key works only from this host's own loopback, with no forwarding, and names the forced command that starts
 * every login in the staging release (staging-shell), so a host whose sshd has no policy of Vibe64's for staging
 * accounts confines them too; where host setup's policy names the same command, sshd runs the policy's.
 * @param {{ username: string, shell: string }} user the registered staging account
 * @param {string} publicKey one `ssh-ed25519 <key>` line
 * @param {string} helperPath the command that starts this helper (helperCommand), which the sudo rule names
 */
function installStagingAccess(user, publicKey, helperPath, {
  accountDatabase = helperAccountDatabase(),
  keysRoot = helperStagingKeysRoot(),
  prefixParent,
  rootUid = ROOT_UID,
  runRoot = runRootCommand,
  sudoersRoot = helperSudoersRoot()
} = {}) {
  ensureStagingKeysRoot(keysRoot, rootUid);
  replaceRootFile(
    stagingKeysPath(user.username, keysRoot),
    `command="${helperPath} staging-shell",restrict,pty,from="127.0.0.1,::1" ${publicKey} vibe64-staging\n`,
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
 * crontab, its at jobs and lingering. The account's staging service runs outside any login and keeps running.
 * @param {{ username: string, shell?: string } | null} user the staging account, if it still exists
 * @param {string} username
 */
function removeStagingAccess(user, username, {
  accountDatabase = helperAccountDatabase(),
  keysRoot = helperStagingKeysRoot(),
  prefixParent,
  runRoot = runRootCommand,
  runRootAllowFailure = runRootCommandAllowFailure,
  sudoersRoot = helperSudoersRoot()
} = {}) {
  const removedKey = removeIfPresent(stagingKeysPath(username, keysRoot));
  const removedRule = removeIfPresent(stagingSudoersPath(username, sudoersRoot));
  if (!user) return removedKey || removedRule;
  if (user.shell !== STAGING_ACCOUNT_SHELL) {
    changeLoginShell(username, STAGING_ACCOUNT_SHELL, accountDatabase, { prefixParent, run: runRoot });
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
  removeStagingAccess,
  STAGING_LOGIN_SHELL,
  stagingAccessGranted
};
