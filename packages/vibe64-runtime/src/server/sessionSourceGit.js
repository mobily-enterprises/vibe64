import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  normalizeText,
  pathExists,
  pathInsideOrEqual,
  vibe64Error
} from "@local/vibe64-core/server/core";
import { runSourceCommand } from "./sourceCommand.js";

const GIT_TIMEOUT_MS = 30_000;
const GIT_REPACK_TIMEOUT_MS = 60_000;
// Last conflict answer per session source, keyed by its index file revision.
const MAX_REMEMBERED_MERGE_STATES = 256;
const mergeStatesByIndex = new Map();

async function runGit(sourceRoot = "", args = [], {
  timeout = GIT_TIMEOUT_MS
} = {}) {
  return runSourceCommand("git", ["-C", sourceRoot, ...args], {
    cwd: sourceRoot,
    gitSafeDirectories: [sourceRoot],
    runtimes: ["git"],
    timeout
  });
}

function resolveGitPath(sourceRoot = "", gitPath = "") {
  const normalizedGitPath = normalizeText(gitPath);
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
  return normalizeText(await readFile(filePath, "utf8")) !== "";
}

async function sessionSourceGitAlternatesPath(sourceRoot = "") {
  const normalizedSourceRoot = normalizeText(sourceRoot) ? path.resolve(sourceRoot) : "";
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
  if (!worktreeResult.ok || normalizeText(worktreeResult.stdout || worktreeResult.output) !== "true") {
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

// Git records unmerged paths only in the index, and every index write replaces
// the file. An unchanged index file therefore has the same conflicts.
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
  const normalizedSourceRoot = normalizeText(sourceRoot) ? path.resolve(sourceRoot) : "";
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

async function ensureSessionSourceGitAlternatesDissociated(sourceRoot = "", {
  runExclusive = null
} = {}) {
  const normalizedSourceRoot = normalizeText(sourceRoot) ? path.resolve(sourceRoot) : "";
  if (!normalizedSourceRoot) {
    throw vibe64Error(
      "Cannot dissociate session source Git alternates without a source root.",
      "vibe64_session_source_root_required"
    );
  }
  const alternatesPath = await sessionSourceGitAlternatesPath(normalizedSourceRoot);
  if (!alternatesPath || !await fileHasContent(alternatesPath)) {
    return {
      alternatesPath,
      ok: true,
      repaired: false,
      sourceRoot: normalizedSourceRoot
    };
  }
  if (!pathInsideOrEqual(normalizedSourceRoot, alternatesPath)) {
    throw vibe64Error(
      `Session source Git alternates file is outside the session source: ${alternatesPath}`,
      "vibe64_session_source_git_alternates_outside_source"
    );
  }
  if (typeof runExclusive === "function") {
    // Reinspect under the caller's source lock before changing Git storage.
    return runExclusive(() => ensureSessionSourceGitAlternatesDissociated(normalizedSourceRoot));
  }
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
  return {
    alternatesPath,
    ok: true,
    repaired: true,
    sourceRoot: normalizedSourceRoot
  };
}

export {
  ensureSessionSourceGitAlternatesDissociated,
  inspectSessionSourceMergeState,
  sessionSourceGitAlternatesPath
};
