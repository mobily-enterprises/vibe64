// Moving a session's files while its AI may be writing them: the two-tree switch Save and Update use, and how a
// failed Update puts the session back without losing a file written meanwhile.
import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { writeGitWorktreeTree } from "@local/vibe64-execution/server";
import { doNothing } from "@local/vibe64-core/shared/doNothing";
import { parseGitNameStatusZ } from "./gitRecords.js";
import {
  changedPathStatusesBetween,
  commandProject,
  git,
  gitOutput,
  rememberCanonicalCommit,
  saveError
} from "./sessionWorkGit.js";

const WORKTREE_WRITTEN_CODE = "vibe64_session_worktree_written";
const UPDATE_WORKTREE_CHANGED_CODE = "vibe64_session_update_worktree_changed";
const UPDATE_IGNORED_FILE_CODE = "vibe64_session_update_ignored_file";
const UPDATE_HEAD_MOVED_CODE = "vibe64_session_update_head_moved";

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

function fileList(paths) {
  const listed = paths.slice(0, 3).join(", ");
  return paths.length > 3 ? `${listed} and ${paths.length - 3} more` : listed;
}

/** The paths `changes` adds where the session already has a file Git does not track. */
async function untrackedFilesInTheWay(context, changes) {
  const added = [...changes.values()].filter((change) => change.status === "A").map((change) => change.path);
  const found = await Promise.all(added.map(async (entry) => {
    const stats = await lstat(path.join(context.worktreePath, entry)).catch(() => null);
    return stats && !stats.isDirectory() ? entry : "";
  }));
  return found.filter(Boolean);
}

/**
 * Moves the session's files from tree `from` to tree `to` with Git's two-tree switch: only the paths that differ
 * change, and it refuses, changing nothing, rather than overwrite or bring back a file that no longer matches
 * `from`, so a file the session's AI writes or deletes while Save or Update runs is never lost. Git itself takes a
 * missing file for an unchanged one and replaces a file it ignores, so both are checked first. The switch runs on
 * an index of its own: the session's index, which the AI's own git commands use, never holds `from`, and callers
 * set it once HEAD is where it belongs.
 */
async function switchSessionWorktree(runCommand, context, from, to, options = {}) {
  const changes = await changedPathStatusesBetween(runCommand, context, from, to, options);
  // Beside the turn checkpoints' temporary trees, whose sweep also removes an index a crash leaves behind.
  const checkpoints = path.join(await gitOutput(runCommand, context, ["rev-parse", "--absolute-git-dir"], options), "vibe64-checkpoints");
  await mkdir(checkpoints, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(checkpoints, ".tree-switch-"));
  const indexOptions = {
    ...options,
    additionalAllowedRoots: [temporaryRoot],
    env: { GIT_INDEX_FILE: path.join(temporaryRoot, "index") }
  };
  try {
    await git(runCommand, context, ["read-tree", from], indexOptions);
    // A freshly read index has no file stats, which the switch would take for edits.
    await git(runCommand, context, ["update-index", "-q", "--refresh"], indexOptions);
    const diffFiles = await git(runCommand, context, ["diff-files", "--name-status", "-z"], indexOptions);
    const onDisk = parseGitNameStatusZ(diffFiles.stdout || diffFiles.output);
    const written = [...onDisk.values()]
      .filter((entry) => changes.has(entry.path) && !(entry.status === "D" && changes.get(entry.path).status === "D"))
      .map((entry) => entry.path);
    const inTheWay = await untrackedFilesInTheWay(context, changes);
    const checked = inTheWay.length
      ? await git(runCommand, context, ["check-ignore", "--no-index", "--stdin", "-z"], {
        ...options,
        input: `${inTheWay.join("\0")}\0`,
        required: false
      })
      : null;
    const ignored = String(checked?.stdout || checked?.output || "").split("\0").filter(Boolean);
    if (ignored.length) {
      throw saveError(
        `Update would replace ${fileList(ignored)}, which Git ignores in this session, so it stopped and changed nothing. Move or rename ${ignored.length === 1 ? "that file" : "those files"}, then try Update again.`,
        UPDATE_IGNORED_FILE_CODE,
        { ignoredPaths: ignored }
      );
    }
    written.push(...inTheWay);
    if (written.length) {
      throw saveError(`Files changed while the session was being switched (${fileList(written)}).`, WORKTREE_WRITTEN_CODE, {
        changedPaths: written
      });
    }
    await git(runCommand, context, ["read-tree", "-m", "-u", from, to], indexOptions);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

/**
 * Moves the session's files from tree `from` onto commit `to`, keeping as it is now every file written since
 * `from`: only the paths that differ between them, and that nobody wrote since, change. A file written between
 * reading the session and switching it makes the switch refuse, so it reads the session again, three times at
 * most. Returns the paths that differ between `from` and `to`, those written since `from`, and whether it moved.
 */
async function switchSessionKeepingWrites(runCommand, context, project, { from, options, to }) {
  const changes = await changedPathStatusesBetween(runCommand, context, from, to, options);
  let writes = new Map();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentTree = await sessionWorktreeTree(runCommand, context, project);
    writes = await changedPathStatusesBetween(runCommand, context, from, currentTree, options);
    if ([...changes.keys()].every((entry) => writes.has(entry))) return { changes, moved: true, writes };
    // A file `to` lacks that someone deleted is in neither, so there is nothing of it to keep.
    const kept = [...writes.values()]
      .filter((write) => !(write.status === "D" && changes.get(write.path)?.status === "D"))
      .map((write) => write.path);
    try {
      // With no paths, a worktree tree would take every file as it is now, so nothing written means `to` itself.
      const target = kept.length
        ? await sessionWorktreeTree(runCommand, context, project, { baseCommit: to, paths: kept })
        : to;
      await switchSessionWorktree(runCommand, context, currentTree, target, options);
      return { changes, moved: true, writes };
    } catch {
      // Someone wrote a file between reading the session and switching it, or while its kept files were read: read
      // it again.
    }
  }
  return { changes, moved: false, writes };
}

function updateWorktreeChangedError(paths = [], { undone = true } = {}) {
  const files = paths.length ? ` (${fileList(paths)})` : "";
  return saveError(
    undone
      ? `A file changed while Update ran${files}, so Update stopped and put this session back as it was, keeping every change. Nothing was lost. Try Update again.`
      : `Files kept changing while Update ran${files}, so this session stays updated and keeps every file as last written. Nothing was lost. Check those files before saving.`,
    UPDATE_WORKTREE_CHANGED_CODE,
    { changedPaths: paths, undone }
  );
}

function updateHeadMovedError() {
  return saveError(
    "A Git commit was made in this session while Update ran, so Update stopped and left every file as it is, some perhaps already updated. Nothing was lost. Try Update again.",
    UPDATE_HEAD_MOVED_CODE
  );
}

/**
 * Puts the session back on `oldHead` after a failed apply, keeping every file written since its checkpoint: the
 * paths Update switched return to the checkpoint unless someone wrote them after Update did. Returns the paths
 * Update changes that were written while it ran, and whether the session is back. It stays updated only when files
 * kept changing through every attempt to switch it back, and HEAD then moves to the saved version it shows. A
 * commit made in the session meanwhile leaves every file as it is, with `headMoved`.
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
  const readHead = () => gitOutput(runCommand, context, ["rev-parse", "HEAD"], options).catch(() => "");
  const headMoved = async () => {
    await git(runCommand, context, ["read-tree", "HEAD"], { ...options, required: false });
    return { headMoved: true, undone: false, written: [] };
  };
  const head = await readHead();
  if (head !== oldHead && head !== canonicalCommit) return headMoved();
  let written;
  if (switched) {
    const back = await switchSessionKeepingWrites(runCommand, context, project, {
      from: mergedTree,
      options,
      to: checkpointCommit
    });
    switched = !back.moved;
    written = [...back.writes.keys()].filter((entry) => back.changes.has(entry));
  } else {
    const currentTree = await sessionWorktreeTree(runCommand, context, project);
    written = [...(await changedPathStatusesBetween(runCommand, context, checkpointTree, currentTree, options)).keys()]
      .filter((entry) => updatedPathStatuses.has(entry));
  }
  // HEAD follows the files: the version they are back on, or the saved version they still show.
  const [wanted, other] = switched ? [canonicalCommit, oldHead] : [oldHead, canonicalCommit];
  if (head === other) {
    await git(runCommand, context, ["update-ref", "HEAD", wanted, other], { ...options, required: false });
  }
  if (await readHead() !== wanted) return headMoved();
  if (switched) await rememberCanonicalCommit(runCommand, context, canonicalCommit, options).catch(doNothing);
  // The session's index follows HEAD: Update set it to the saved version only once HEAD had moved there.
  if (switched || head === canonicalCommit) {
    await git(runCommand, context, ["read-tree", switched ? canonicalCommit : oldIndexTree], { ...options, required: false });
  }
  return { undone: !switched, written };
}

export {
  sessionWorktreeTree,
  switchSessionKeepingWrites,
  switchSessionWorktree,
  undoSessionUpdate,
  UPDATE_HEAD_MOVED_CODE,
  UPDATE_IGNORED_FILE_CODE,
  UPDATE_WORKTREE_CHANGED_CODE,
  updateHeadMovedError,
  updateWorktreeChangedError,
  WORKTREE_WRITTEN_CODE
};
