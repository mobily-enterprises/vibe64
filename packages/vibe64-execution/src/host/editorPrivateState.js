// The workspace daemon's private state: a folder below its state root (~/.local/state/vibe64, as studioRoots names
// it), outside every project namespace, which the editor's own service alone reads (Production's Env and the key that
// seals it). Every execution and managed service the helper starts for the daemon or a person has it hidden
// (systemd's InaccessiblePaths=), so a session command, an agent or a Preview reading it is refused by the filesystem
// even as the daemon's own user. The leading "-" lets a unit start on a host whose editor has not made it yet; the
// editor makes it when it starts, before it starts any execution.

import path from "node:path";

const EDITOR_PRIVATE_STATE_FOLDER = "editor-private";
const DAEMON_STATE_PARTS = Object.freeze([".local", "state", "vibe64"]);

/**
 * The daemon's private state folder, below its home.
 * @param {{ home?: string }} owner the workspace daemon's account
 */
function editorPrivateStateRoot(owner = {}) {
  const home = String(owner.home || "");
  if (!path.isAbsolute(home) || /[\r\n\s"\\]/u.test(home)) {
    throw new Error("Vibe64 exec helper needs the workspace daemon's home to hide its private state.");
  }
  return path.join(home, ...DAEMON_STATE_PARTS, EDITOR_PRIVATE_STATE_FOLDER);
}

/**
 * The unit line that hides the daemon's private state from what the unit runs.
 * @param {{ home?: string }} owner the workspace daemon's account
 */
function editorPrivateStateLine(owner = {}) {
  return `InaccessiblePaths=-${editorPrivateStateRoot(owner)}`;
}

export { EDITOR_PRIVATE_STATE_FOLDER, editorPrivateStateLine, editorPrivateStateRoot };
