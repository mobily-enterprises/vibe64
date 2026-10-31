import { rm } from "node:fs/promises";
import path from "node:path";

import { normalizeText, pathExists, vibe64Error } from "@local/vibe64-core/server/core";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { runVibe64Command, writeGitWorktreeTree } from "@local/vibe64-execution/server";

import { assertRenewalId as assertSessionRenewalId } from "./sessionRenewalIds.js";
import { runSourceCommand } from "./sourceCommand.js";

// Git and file facts about a session's worktree: commands with their limits,
// recovery artifact names, renewal stage paths, dirtiness and owned removal.
const GIT_TIMEOUT_MS = 30_000;
const SNAPSHOT_TIMEOUT_MS = 60_000;
const COMMAND_BUFFER_BYTES = 50 * 1024 * 1024;
const RECOVERY_ARTIFACT_ROOT = "recovery";
const RECOVERY_BRANCH_BUNDLE_ARTIFACT = `${RECOVERY_ARTIFACT_ROOT}/branch.bundle`;
const RECOVERY_CHECKPOINT_BUNDLE_ARTIFACT = `${RECOVERY_ARTIFACT_ROOT}/checkpoints.bundle`;
const RECOVERY_PATCH_ARTIFACT = `${RECOVERY_ARTIFACT_ROOT}/worktree.patch`;
const RECOVERY_UNTRACKED_ARTIFACT = `${RECOVERY_ARTIFACT_ROOT}/untracked-files.tar.gz`;
const RECOVERY_UNTRACKED_LIST_ARTIFACT = `${RECOVERY_ARTIFACT_ROOT}/untracked-files.list`;

async function runCommand(command, args = [], {
  allowedRoots = [],
  cwd = "",
  maxBuffer = COMMAND_BUFFER_BYTES,
  runtimes = [],
  timeout = GIT_TIMEOUT_MS
} = {}) {
  return runSourceCommand(command, args, {
    allowedRoots,
    cwd,
    gitSafeDirectories: command === "git" ? [cwd] : [],
    maxBuffer,
    runtimes,
    timeout
  });
}

async function runGit(cwd, args = [], options = {}) {
  return runCommand("git", args, {
    cwd,
    runtimes: ["git"],
    ...options
  });
}

function metadataValue(session = {}, name = "") {
  return normalizeText(session.metadata?.[name]);
}

function recoverySessionName(session = {}) {
  return normalizeText(session.sessionName) ||
    metadataValue(session, "source_recovery_session_name") ||
    normalizeText(session.sessionId);
}

function recoveryWorktreePath(session = {}) {
  return metadataValue(session, "source_recovery_source_path") ||
    sessionSourcePath(session);
}

function parseNullSeparatedPaths(value = "") {
  return String(value || "")
    .split("\0")
    .map((entry) => normalizeText(entry).replaceAll("\\", "/").replace(/^\.\//u, ""))
    .filter(Boolean);
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 * @param {object} [values]
 */
async function writeMetadataValues(store, sessionId, values = {}) {
  for (const [name, value] of Object.entries(values)) {
    await store.writeMetadataValue(sessionId, name, value);
  }
}

async function readWorktreeGitFact(worktreePath, args = [], fallback = "") {
  const result = await runGit(worktreePath, args, {
    timeout: 15_000
  });
  return result.ok ? normalizeText(result.stdout || result.output) : fallback;
}

function sameResolvedPath(left = "", right = "") {
  return Boolean(left && right) && path.resolve(left) === path.resolve(right);
}

function renewalSourceStagePath(session = {}, renewalId = "") {
  const worktreePath = sessionSourcePath(session);
  if (!worktreePath) {
    throw vibe64Error(
      `Session ${normalizeText(session.sessionId) || "(unknown)"} has no managed source to stage for renewal.`,
      "vibe64_session_source_required"
    );
  }
  return `${path.resolve(worktreePath)}.renewal-${assertSessionRenewalId(renewalId)}`;
}

function renewalSourceDeletionPath(session = {}, renewalId = "") {
  return `${renewalSourceStagePath(session, renewalId)}.deleting`;
}

async function isExactGitWorktree(worktreePath = "") {
  if (!await pathExists(worktreePath)) {
    return false;
  }
  const result = await runGit(worktreePath, ["rev-parse", "--show-toplevel"], {
    timeout: 15_000
  });
  return result.ok && sameResolvedPath(normalizeText(result.stdout || result.output), worktreePath);
}

async function inspectWorktreeDirty(worktreePath = "") {
  let worktreeTree = "";
  try {
    worktreeTree = await writeGitWorktreeTree({
      baseCommit: "HEAD",
      runCommand: runVibe64Command,
      worktreePath
    });
  } catch (error) {
    throw vibe64Error(
      `Cannot inspect session worktree before archive: ${normalizeText(error?.message)}`,
      "vibe64_worktree_archive_status_failed"
    );
  }
  const [statusResult, headTreeResult] = await Promise.all([
    runGit(worktreePath, [
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
      "--ignore-submodules=none"
    ], {
      timeout: 15_000
    }),
    runGit(worktreePath, ["rev-parse", "--verify", "HEAD^{tree}"], {
      timeout: 15_000
    })
  ]);
  if (!statusResult.ok || !headTreeResult.ok) {
    throw vibe64Error(
      `Cannot inspect session worktree before archive: ${
        statusResult.ok ? headTreeResult.output : statusResult.output
      }`,
      "vibe64_worktree_archive_status_failed"
    );
  }
  return Boolean(normalizeText(statusResult.stdout)) ||
    normalizeText(worktreeTree) !== normalizeText(headTreeResult.stdout);
}

function sessionOwnsWorktreePath(session = {}, worktreePath = "") {
  return sameResolvedPath(sessionSourcePath(session), worktreePath);
}

async function removeSessionOwnedWorktreeDirectory({
  session = {},
  worktreePath = ""
} = {}) {
  if (!await pathExists(worktreePath)) {
    return {
      ok: true,
      removed: false
    };
  }
  if (!sessionOwnsWorktreePath(session, worktreePath)) {
    throw vibe64Error(
      `Refusing to remove non-worktree path outside the session-owned worktree location: ${worktreePath}`,
      "vibe64_worktree_remove_path_not_session_owned"
    );
  }
  await rm(worktreePath, {
    force: true,
    maxRetries: 20,
    recursive: true,
    retryDelay: 100
  });
  return {
    ok: true,
    removed: true
  };
}

export {
  COMMAND_BUFFER_BYTES,
  GIT_TIMEOUT_MS,
  inspectWorktreeDirty,
  isExactGitWorktree,
  metadataValue,
  parseNullSeparatedPaths,
  readWorktreeGitFact,
  RECOVERY_ARTIFACT_ROOT,
  RECOVERY_BRANCH_BUNDLE_ARTIFACT,
  RECOVERY_CHECKPOINT_BUNDLE_ARTIFACT,
  RECOVERY_PATCH_ARTIFACT,
  RECOVERY_UNTRACKED_ARTIFACT,
  RECOVERY_UNTRACKED_LIST_ARTIFACT,
  recoverySessionName,
  recoveryWorktreePath,
  removeSessionOwnedWorktreeDirectory,
  renewalSourceDeletionPath,
  renewalSourceStagePath,
  runCommand,
  runGit,
  sameResolvedPath,
  sessionOwnsWorktreePath,
  SNAPSHOT_TIMEOUT_MS,
  writeMetadataValues
};
