// Moving a session's files while its AI may be writing them: the two-tree switch Save and Update use, and how a
// failed Update puts the session back without losing a file written meanwhile.
import { writeGitWorktreeTree } from "@local/vibe64-execution/server";
import { doNothing } from "@local/vibe64-core/shared/doNothing";
import {
  changedPathStatusesBetween,
  changedPathsBetween,
  commandProject,
  git,
  gitOutput,
  rememberCanonicalCommit,
  saveError
} from "./sessionWorkGit.js";

/**
 * The session's files as a tree: every file, or `paths` alone on top of `baseCommit`.
 * @param {Function} runCommand
 * @param {object} context
 * @param {object} project
 * @param {{ baseCommit?: string, paths?: string[] }} [selection]
 */
function sessionWorktreeTree(runCommand, context, project, { baseCommit = "HEAD", paths = [] } = {}) {
  return writeGitWorktreeTree({
    baseCommit,
    paths,
    project: commandProject(context, project),
    runCommand,
    worktreePath: context.worktreePath
  });
}

/**
 * Moves the session's files from tree `from` to tree `to` with Git's two-tree switch: only the paths that differ
 * change, and Git refuses, changing nothing, rather than overwrite a file that no longer matches `from`. So a file
 * the session's AI writes while Save or Update runs is never overwritten. The index ends at `to`, or at `from` when
 * Git refused.
 */
async function switchSessionWorktree(runCommand, context, from, to, options = {}) {
  await git(runCommand, context, ["read-tree", from], options);
  // A freshly read index has no file stats, which the switch would take for edits.
  await git(runCommand, context, ["update-index", "-q", "--refresh"], { ...options, required: false });
  await git(runCommand, context, ["read-tree", "-m", "-u", from, to], options);
}

const UPDATE_WORKTREE_CHANGED_CODE = "vibe64_session_update_worktree_changed";

function updateWorktreeChangedError(paths = [], { undone = true } = {}) {
  const files = paths.slice(0, 3).join(", ");
  const suffix = paths.length > 3 ? ` and ${paths.length - 3} more` : "";
  return saveError(
    undone
      ? `A file changed while Update ran (${files}${suffix}), so Update stopped and put this session back as it was, keeping every change. Nothing was lost. Try Update again.`
      : `Files kept changing while Update ran (${files}${suffix}), so this session stays updated and keeps every file as last written. Nothing was lost. Check those files before saving.`,
    UPDATE_WORKTREE_CHANGED_CODE,
    { changedPaths: paths }
  );
}

/**
 * Puts the session back on `oldHead` after a failed apply, keeping every file written since its checkpoint: the
 * paths Update switched return to the checkpoint unless someone wrote them after Update did. Returns the paths
 * Update changes that were written while it ran, and whether the session is back. It stays updated only when files
 * kept changing through every attempt to switch it back; HEAD then stays on the saved version it shows.
 */
async function undoSessionUpdate(runCommand, context, {
  canonicalCommit,
  checkpointCommit,
  checkpointTree,
  mergedTree,
  oldHead,
  oldIndexTree,
  options,
  project,
  switched,
  updatedPathStatuses
}) {
  const optional = { ...options, required: false };
  let written = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentTree = await sessionWorktreeTree(runCommand, context, project);
    if (!switched) {
      written = (await changedPathsBetween(runCommand, context, checkpointTree, currentTree, options))
        .filter((entry) => updatedPathStatuses.has(entry));
      break;
    }
    const edits = await changedPathStatusesBetween(runCommand, context, mergedTree, currentTree, options);
    written = [...edits.keys()].filter((entry) => updatedPathStatuses.has(entry));
    // A file Update added and someone then deleted is absent from both the checkpoint and the session.
    const keptPaths = [...edits.keys()]
      .filter((entry) => !(edits.get(entry).status === "D" && updatedPathStatuses.get(entry).status === "A"));
    // With no paths, a worktree tree would take every file as it is now, so nothing written means the checkpoint.
    const restoredTree = keptPaths.length
      ? await sessionWorktreeTree(runCommand, context, project, { baseCommit: checkpointCommit, paths: keptPaths })
      : checkpointTree;
    try {
      await switchSessionWorktree(runCommand, context, currentTree, restoredTree, options);
      switched = false;
      break;
    } catch {
      // Someone wrote a file between reading the session and switching it back: read it again.
    }
  }
  const head = await gitOutput(runCommand, context, ["rev-parse", "HEAD"], options).catch(() => "");
  if (switched && head === canonicalCommit) {
    await rememberCanonicalCommit(runCommand, context, canonicalCommit, options).catch(doNothing);
  }
  if (!switched && head === canonicalCommit) {
    await git(runCommand, context, ["update-ref", "HEAD", oldHead, canonicalCommit], optional);
  }
  const restoredHead = !switched && head === canonicalCommit ? oldHead : head;
  await git(runCommand, context, ["read-tree", restoredHead === oldHead ? oldIndexTree : "HEAD"], optional);
  return { undone: !switched, written };
}

export {
  sessionWorktreeTree,
  switchSessionWorktree,
  undoSessionUpdate,
  UPDATE_WORKTREE_CHANGED_CODE,
  updateWorktreeChangedError
};
