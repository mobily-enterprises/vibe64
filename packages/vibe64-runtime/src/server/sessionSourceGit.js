import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import { pathExists, pathInsideOrEqual, vibe64Error } from "@local/vibe64-core/server/core";
import { runSourceCommand } from "./sourceCommand.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

const GIT_TIMEOUT_MS = 30_000;
const GIT_REPACK_TIMEOUT_MS = 60_000;
// Last conflict answer per session source, keyed by its index file revision.
const MAX_REMEMBERED_MERGE_STATES = 256;
const mergeStatesByIndex = new Map();

async function runGit(sourceRoot = "", args = [], options = {}) {
  const {
    timeout = GIT_TIMEOUT_MS
  } = options;
  return runSourceCommand("git", ["-C", sourceRoot, ...args], {
    cwd: sourceRoot,
    gitSafeDirectories: [sourceRoot],
    runtimes: ["git"],
    timeout
  });
}

function resolveGitPath(sourceRoot = "", gitPath = "") {
  const normalizedGitPath = toText(gitPath);
  if (!normalizedGitPath) {
    return "";
  }
  return path.isAbsolute(normalizedGitPath)
    ? normalizedGitPath
    : path.resolve(sourceRoot, normalizedGitPath);
}

async function fileHasContent(filePath = "") {
  if (!filePath || !await pathExists(filePath)) {
    return false;
  }
  return toText(await readFile(filePath, "utf8")) !== "";
}

async function sessionSourceGitAlternatesPath(sourceRoot = "") {
  const normalizedSourceRoot = toText(sourceRoot) ? path.resolve(sourceRoot) : "";
  if (!normalizedSourceRoot) {
    throw vibe64Error(
      "Cannot inspect session source Git alternates without a source root.",
      "vibe64_session_source_root_required"
    );
  }
  const worktreeResult = await runGit(normalizedSourceRoot, [
    "rev-parse",
    "--is-inside-work-tree"
  ]);
  if (!worktreeResult.ok || toText(worktreeResult.stdout || worktreeResult.output) !== "true") {
    return "";
  }
  const gitPathResult = await runGit(normalizedSourceRoot, [
    "rev-parse",
    "--git-path",
    "objects/info/alternates"
  ]);
  if (!gitPathResult.ok) {
    throw vibe64Error(
      `Cannot resolve session source Git alternates path: ${gitPathResult.output}`,
      "vibe64_session_source_git_alternates_path_failed"
    );
  }
  return resolveGitPath(normalizedSourceRoot, gitPathResult.stdout || gitPathResult.output);
}

/**
 * Git records unmerged paths only in the index, and every index write replaces
 * the file. An unchanged index file therefore has the same conflicts.
 */
async function indexRevision(sourceRoot = "") {
  const entry = await stat(path.join(sourceRoot, ".git", "index"), { bigint: true }).catch(() => null);
  return entry?.isFile() ? `${entry.dev}:${entry.ino}:${entry.size}:${entry.mtimeNs}:${entry.ctimeNs}` : "";
}

function rememberMergeState(sourceRoot, revision, merge) {
  mergeStatesByIndex.delete(sourceRoot);
  mergeStatesByIndex.set(sourceRoot, { merge, revision });
  if (mergeStatesByIndex.size > MAX_REMEMBERED_MERGE_STATES) {
    mergeStatesByIndex.delete(mergeStatesByIndex.keys().next().value);
  }
}

async function inspectSessionSourceMergeState(sourceRoot = "") {
  const normalizedSourceRoot = toText(sourceRoot) ? path.resolve(sourceRoot) : "";
  if (!normalizedSourceRoot) {
    return {
      conflictedFiles: [],
      hasConflicts: false
    };
  }
  if (!await pathExists(path.join(normalizedSourceRoot, ".git"))) {
    return {
      conflictedFiles: [],
      hasConflicts: false
    };
  }
  // Read before git runs, so an index written meanwhile is inspected again.
  const revision = await indexRevision(normalizedSourceRoot);
  const remembered = revision ? mergeStatesByIndex.get(normalizedSourceRoot) : null;
  if (remembered?.revision === revision) {
    return {
      conflictedFiles: [...remembered.merge.conflictedFiles],
      hasConflicts: remembered.merge.hasConflicts
    };
  }
  const conflictsResult = await runGit(normalizedSourceRoot, [
    "diff",
    "--name-only",
    "--diff-filter=U",
    "-z"
  ]);
  if (!conflictsResult.ok) {
    throw vibe64Error(
      `Cannot inspect session source conflicts: ${conflictsResult.output}`,
      "vibe64_session_source_conflict_inspection_failed"
    );
  }
  const conflictedFiles = String(conflictsResult.stdout || "").split("\0").filter(Boolean);
  const merge = {
    conflictedFiles,
    hasConflicts: conflictedFiles.length > 0
  };
  if (revision) rememberMergeState(normalizedSourceRoot, revision, { ...merge, conflictedFiles: [...conflictedFiles] });
  return merge;
}

/**
 * Where the session source's Git alternates file is, and whether it borrows objects; a borrowing file must lie
 * inside the source.
 * @param {string} sourceRoot a resolved session source root
 */
async function inspectSessionSourceAlternates(sourceRoot) {
  const alternatesPath = await sessionSourceGitAlternatesPath(sourceRoot);
  const borrowing = Boolean(alternatesPath) && await fileHasContent(alternatesPath);
  if (borrowing && !pathInsideOrEqual(sourceRoot, alternatesPath)) {
    throw vibe64Error(
      `Session source Git alternates file is outside the session source: ${alternatesPath}`,
      "vibe64_session_source_git_alternates_outside_source"
    );
  }
  return { alternatesPath, borrowing };
}

/**
 * Makes a session source's Git storage self-contained: when it borrows objects through Git alternates, it
 * repacks every object locally and removes the alternates file. The repair runs under the caller's source lock,
 * where the source is inspected again before Git storage changes.
 * @param {string} sourceRoot
 * @param {object} options
 * @param {<T>(operation: () => Promise<T>) => Promise<T>} options.runExclusive runs the repair under the session's source lock
 */
async function ensureSessionSourceGitAlternatesDissociated(sourceRoot, { runExclusive }) {
  const normalizedSourceRoot = toText(sourceRoot) ? path.resolve(sourceRoot) : "";
  if (!normalizedSourceRoot) {
    throw vibe64Error(
      "Cannot dissociate session source Git alternates without a source root.",
      "vibe64_session_source_dissociate_root_required"
    );
  }
  const inspected = await inspectSessionSourceAlternates(normalizedSourceRoot);
  if (!inspected.borrowing) {
    return {
      alternatesPath: inspected.alternatesPath,
      ok: true,
      repaired: false,
      sourceRoot: normalizedSourceRoot
    };
  }
  return runExclusive(async () => {
    const { alternatesPath, borrowing } = await inspectSessionSourceAlternates(normalizedSourceRoot);
    if (borrowing) {
      const repackResult = await runGit(normalizedSourceRoot, [
        "repack",
        "-a",
        "-d"
      ], {
        timeout: GIT_REPACK_TIMEOUT_MS
      });
      if (!repackResult.ok) {
        throw vibe64Error(
          `Cannot dissociate session source from Git alternates: ${repackResult.output}`,
          "vibe64_session_source_git_alternates_dissociate_failed"
        );
      }
      await rm(alternatesPath, {
        force: true
      });
    }
    return {
      alternatesPath,
      ok: true,
      repaired: borrowing,
      sourceRoot: normalizedSourceRoot
    };
  });
}

export {
  ensureSessionSourceGitAlternatesDissociated,
  inspectSessionSourceMergeState
};
