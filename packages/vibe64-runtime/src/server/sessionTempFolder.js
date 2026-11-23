import { lstat, mkdir, rm } from "node:fs/promises";

import { vibe64Error } from "@local/vibe64-core/server/core";
import { sessionTempPath } from "@local/vibe64-core/server/sessionSourcePath";

// A session's own temporary folder, `tmp` beside its source and connected
// copies. Its AI's commands get it as TMPDIR, so their throwaway files and
// repositories stay in the session, apart from every other session's. It is
// made in the session's folder like the source beside it: on a host shared by
// several Unix identities that folder is setgid with the inherited default
// group ACL, so the new folder takes the `vibe64` group, setgid and ACL as it is
// made, and the managed writers' umask 0007 leaves it 2770. Nothing repairs it
// afterwards. Archive and renewal remove it with the session's folder.

/**
 * Makes the session's temporary folder when it is missing and answers its path,
 * or "" when the session's folder is gone. A link or a file in its place is refused.
 * @param {string} sourcePath the session's managed source
 */
async function prepareSessionTempFolder(sourcePath = "") {
  const tempPath = sessionTempPath(sourcePath);
  if (!tempPath) return "";
  try {
    await mkdir(tempPath, { mode: 0o770 });
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    if (error?.code !== "EEXIST") throw error;
  }
  const entry = await lstat(tempPath);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw vibe64Error(
      `The session's temporary folder ${tempPath} is not a folder. Remove what is there; Vibe64 makes the folder again.`,
      "vibe64_session_temp_folder_invalid"
    );
  }
  return tempPath;
}

/**
 * Removes the session's temporary folder and everything in it (a link in its
 * place is removed, never followed).
 * @param {string} sourcePath the session's managed source
 */
async function removeSessionTempFolder(sourcePath = "") {
  const tempPath = sessionTempPath(sourcePath);
  if (!tempPath) return false;
  await rm(tempPath, { force: true, maxRetries: 20, recursive: true, retryDelay: 100 });
  return true;
}

export {
  prepareSessionTempFolder,
  removeSessionTempFolder
};
