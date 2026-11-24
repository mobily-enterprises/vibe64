import { lstat, mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { vibe64Error } from "@local/vibe64-core/server/core";
import { sessionTempPath, sessionTempRoot } from "@local/vibe64-core/server/sessionSourcePath";

// A session's own temporary folder, `v64s-<key>` in the editor's own temporary
// folder (sessionTempPath). Its AI's commands get it as TMPDIR, so their
// throwaway files and repositories stay apart from every other session's, and
// its short path leaves room for the Unix sockets tests and tools make below it.
// On a managed host the editor's TMPDIR is the workspace's temporary folder:
// setgid and group `vibe64` (2770), so the new folder takes that group and
// setgid as it is made, and the managed writers' umask 0007 leaves it 2770.
// Nothing repairs it afterwards. Archive and renewal remove it with the
// session's folder.

// A Unix socket's path holds 107 bytes on Linux and 103 on macOS and the BSDs
// (sun_path, with its NUL).
const UNIX_SOCKET_PATH_MAX = process.platform === "linux" ? 107 : 103;
// What a command makes below its TMPDIR for a socket: a folder mkdtemp names
// (13 characters, as mb-net-XXXXXX) and a 20-character socket in it.
const SESSION_TEMP_SOCKET_ROOM = "/mb-net-XXXXXX".length + "/".length + 20;

/**
 * Refuses a temporary folder too long for the sockets made below it, naming
 * the fix; it is never shortened silently.
 * @param {string} tempPath
 */
function assertSessionTempFolderFits(tempPath) {
  const length = Buffer.byteLength(tempPath);
  const max = UNIX_SOCKET_PATH_MAX - SESSION_TEMP_SOCKET_ROOM;
  if (length <= max) return;
  const root = path.dirname(tempPath);
  throw vibe64Error(
    `This session's temporary folder ${tempPath} is ${length} bytes, too long for a Unix socket below it: one that a ` +
      `command makes there, in a folder mkdtemp names, passes the ${UNIX_SOCKET_PATH_MAX} bytes a socket's path holds. ` +
      `Start Vibe64 with a TMPDIR of at most ${max - (length - Buffer.byteLength(root))} bytes (it is ${root}), such as /tmp, then retry.`,
    "vibe64_session_temp_folder_too_long"
  );
}

/**
 * Refuses, when the AI starts, a TMPDIR whose sessions' temporary folders
 * would be too long for a socket (assertSessionTempFolderFits).
 */
function assertSessionTempRootFits() {
  assertSessionTempFolderFits(sessionTempPath(path.join(sessionTempRoot(), "session", "source")));
}

/** The process's own uid, which a session's temporary folder must have. */
function processUid() {
  // readable-check: allow method-probe - platform object: process.getuid() exists only on POSIX
  return typeof process.getuid === "function" ? process.getuid() : null;
}

/**
 * Makes the session's temporary folder when it is missing and answers its path,
 * or "" when the session's folder is gone. A link, a file, a folder of another
 * account or one others may enter in its place is refused.
 * @param {string} sourcePath the session's managed source
 */
async function prepareSessionTempFolder(sourcePath = "") {
  const tempPath = sessionTempPath(sourcePath);
  if (!tempPath) return "";
  const sessionFolder = await lstat(path.dirname(path.resolve(sourcePath))).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!sessionFolder?.isDirectory()) return "";
  assertSessionTempFolderFits(tempPath);
  try {
    await mkdir(tempPath, { mode: 0o770 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const entry = await lstat(tempPath);
  const uid = processUid();
  if (entry.isSymbolicLink() || !entry.isDirectory() || (uid !== null && entry.uid !== uid) || (entry.mode & 0o007) !== 0) {
    throw vibe64Error(
      `The session's temporary folder ${tempPath} is not a folder of this account's that only it and its group may enter. ` +
        "Remove what is there; Vibe64 makes the folder again.",
      "vibe64_session_temp_folder_invalid"
    );
  }
  return tempPath;
}

/**
 * Removes the session's temporary folder and everything in it (a link in its
 * place is removed, never followed). Anything another account put in its place
 * is left alone.
 * @param {string} sourcePath the session's managed source
 */
async function removeSessionTempFolder(sourcePath = "") {
  const tempPath = sessionTempPath(sourcePath);
  if (!tempPath) return false;
  const entry = await lstat(tempPath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  const uid = processUid();
  if (!entry || (uid !== null && entry.uid !== uid)) return false;
  await rm(tempPath, { force: true, maxRetries: 20, recursive: true, retryDelay: 100 });
  return true;
}

export {
  assertSessionTempFolderFits,
  assertSessionTempRootFits,
  prepareSessionTempFolder,
  removeSessionTempFolder
};
