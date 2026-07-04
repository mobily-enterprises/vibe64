import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  normalizeText,
  pathExists,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  normalizeDisposablePath,
  relativePathIsDisposable
} from "@local/vibe64-adapters/server/disposablePaths";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const SNAPSHOT_TIMEOUT_MS = 60_000;
const COMMAND_BUFFER_BYTES = 50 * 1024 * 1024;
const RECOVERY_ARTIFACT_ROOT = "recovery";
const RECOVERY_BRANCH_BUNDLE_ARTIFACT = `${RECOVERY_ARTIFACT_ROOT}/branch.bundle`;
const RECOVERY_PATCH_ARTIFACT = `${RECOVERY_ARTIFACT_ROOT}/worktree.patch`;
const RECOVERY_UNTRACKED_ARTIFACT = `${RECOVERY_ARTIFACT_ROOT}/untracked-files.tar.gz`;
const RECOVERY_UNTRACKED_LIST_ARTIFACT = `${RECOVERY_ARTIFACT_ROOT}/untracked-files.list`;

function commandOutput(error = {}) {
  return normalizeText(`${error.stdout || ""}\n${error.stderr || ""}`) ||
    normalizeText(error.message);
}

async function runCommand(command, args = [], {
  cwd = "",
  maxBuffer = COMMAND_BUFFER_BYTES,
  timeout = GIT_TIMEOUT_MS
} = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      maxBuffer,
      timeout
    });
    return {
      ok: true,
      output: normalizeText(`${result.stdout || ""}\n${result.stderr || ""}`),
      stdout: String(result.stdout || ""),
      stderr: String(result.stderr || "")
    };
  } catch (error) {
    return {
      ok: false,
      output: commandOutput(error),
      stdout: String(error.stdout || ""),
      stderr: String(error.stderr || "")
    };
  }
}

async function runGit(cwd, args = [], options = {}) {
  return runCommand("git", args, {
    cwd,
    ...options
  });
}

function metadataValue(session = {}, name = "") {
  return normalizeText(session.metadata?.[name]);
}

function recoverySessionName(session = {}) {
  return normalizeText(session.sessionName) ||
    metadataValue(session, "source_recovery_session_name") ||
    metadataValue(session, "issue_word") ||
    metadataValue(session, "work_word") ||
    normalizeText(session.sessionId);
}

function recoveryWorktreePath(session = {}) {
  return metadataValue(session, "source_recovery_source_path") ||
    sessionSourcePath(session);
}

async function adapterDisposableWorktreePaths(adapter, context = {}) {
  const adapterValue = typeof adapter?.worktreeArchiveExclusions === "function"
    ? await adapter.worktreeArchiveExclusions(context)
    : adapter?.worktreeArchiveExclusions;
  return (Array.isArray(adapterValue) ? adapterValue : [])
    .map(normalizeDisposablePath)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function parseNullSeparatedPaths(value = "") {
  return String(value || "")
    .split("\0")
    .map(normalizeDisposablePath)
    .filter(Boolean);
}

function gitExcludePathspecs(disposablePaths = []) {
  return disposablePaths
    .map(normalizeDisposablePath)
    .filter(Boolean)
    .map((entry) => `:(exclude)${entry}`);
}

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

async function isExactGitWorktree(worktreePath = "") {
  if (!await pathExists(worktreePath)) {
    return false;
  }
  const result = await runGit(worktreePath, ["rev-parse", "--show-toplevel"], {
    timeout: 15_000
  });
  return result.ok && sameResolvedPath(normalizeText(result.stdout || result.output), worktreePath);
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
    recursive: true
  });
  return {
    ok: true,
    removed: true
  };
}

async function writeDirtyRecoveryArtifacts({
  artifactsRoot = "",
  disposablePaths = [],
  session = {},
  store,
  worktreePath = ""
} = {}) {
  const pathspecExcludes = gitExcludePathspecs(disposablePaths);
  const statusResult = await runGit(worktreePath, [
    "status",
    "--porcelain=v1",
    "--untracked-files=normal",
    ...(pathspecExcludes.length ? ["--", ".", ...pathspecExcludes] : [])
  ], {
    timeout: 15_000
  });
  if (!statusResult.ok) {
    throw vibe64Error(
      `Cannot inspect session worktree before archive: ${statusResult.output}`,
      "vibe64_worktree_archive_status_failed"
    );
  }
  const dirty = Boolean(normalizeText(statusResult.stdout));
  if (!dirty) {
    return {
      dirty: false,
      excludedUntrackedCount: 0,
      patchArtifact: "",
      untrackedArtifact: "",
      untrackedCount: 0
    };
  }

  const recoveryRoot = path.join(artifactsRoot, RECOVERY_ARTIFACT_ROOT);
  await mkdir(recoveryRoot, {
    recursive: true
  });

  const patchResult = await runGit(worktreePath, ["diff", "--binary", "HEAD"], {
    timeout: SNAPSHOT_TIMEOUT_MS
  });
  if (!patchResult.ok) {
    throw vibe64Error(
      `Cannot snapshot session worktree diff before archive: ${patchResult.output}`,
      "vibe64_worktree_archive_patch_failed"
    );
  }
  const patchText = String(patchResult.stdout || "");
  const patchArtifact = normalizeText(patchText)
    ? RECOVERY_PATCH_ARTIFACT
    : "";
  if (patchArtifact) {
    await store.writeArtifact(session.sessionId, patchArtifact, patchText);
  }

  const untrackedResult = await runGit(worktreePath, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
    ...(pathspecExcludes.length ? ["--", ".", ...pathspecExcludes] : [])
  ], {
    timeout: 15_000
  });
  if (!untrackedResult.ok) {
    throw vibe64Error(
      `Cannot snapshot untracked session files before archive: ${untrackedResult.output}`,
      "vibe64_worktree_archive_untracked_failed"
    );
  }
  const untrackedPaths = parseNullSeparatedPaths(untrackedResult.stdout);
  const retainedUntrackedPaths = untrackedPaths.filter((relativePath) => {
    return !relativePathIsDisposable(relativePath, disposablePaths);
  });
  const excludedUntrackedCount = untrackedPaths.length - retainedUntrackedPaths.length;
  if (retainedUntrackedPaths.length < 1) {
    return {
      dirty: true,
      excludedUntrackedCount,
      patchArtifact,
      untrackedArtifact: "",
      untrackedCount: 0
    };
  }

  const listPath = path.join(artifactsRoot, RECOVERY_UNTRACKED_LIST_ARTIFACT);
  const tarPath = path.join(artifactsRoot, RECOVERY_UNTRACKED_ARTIFACT);
  await mkdir(path.dirname(listPath), {
    recursive: true
  });
  await writeFile(listPath, `${retainedUntrackedPaths.join("\0")}\0`, "utf8");
  const tarResult = await runCommand("tar", [
    "--null",
    "-czf",
    tarPath,
    "-T",
    listPath
  ], {
    cwd: worktreePath,
    timeout: SNAPSHOT_TIMEOUT_MS
  });
  await rm(listPath, {
    force: true
  });
  if (!tarResult.ok) {
    throw vibe64Error(
      `Cannot snapshot untracked session files before archive: ${tarResult.output}`,
      "vibe64_worktree_archive_untracked_tar_failed"
    );
  }

  return {
    dirty: true,
    excludedUntrackedCount,
    patchArtifact,
    untrackedArtifact: RECOVERY_UNTRACKED_ARTIFACT,
    untrackedCount: retainedUntrackedPaths.length
  };
}

async function writeBranchRecoveryBundle({
  artifactsRoot = "",
  session = {},
  worktreePath = ""
} = {}) {
  if (metadataValue(session, "source_kind") !== "session_clone") {
    return metadataValue(session, "source_recovery_bundle_artifact");
  }
  const headResult = await runGit(worktreePath, ["rev-parse", "--verify", "HEAD"], {
    timeout: 15_000
  });
  if (!headResult.ok) {
    return "";
  }
  const baseCommit = metadataValue(session, "base_commit");
  let bundleRef = "HEAD";
  if (baseCommit) {
    const aheadResult = await runGit(worktreePath, ["rev-list", "--count", `${baseCommit}..HEAD`], {
      timeout: 15_000
    });
    if (aheadResult.ok) {
      const commitsAhead = Number(normalizeText(aheadResult.stdout || aheadResult.output));
      if (commitsAhead < 1) {
        return "";
      }
      bundleRef = `${baseCommit}..HEAD`;
    }
  }

  const bundlePath = path.join(artifactsRoot, RECOVERY_BRANCH_BUNDLE_ARTIFACT);
  await mkdir(path.dirname(bundlePath), {
    recursive: true
  });
  const bundleResult = await runGit(worktreePath, ["bundle", "create", bundlePath, bundleRef], {
    timeout: SNAPSHOT_TIMEOUT_MS
  });
  if (!bundleResult.ok) {
    throw vibe64Error(
      `Cannot snapshot session branch commits before archive: ${bundleResult.output}`,
      "vibe64_worktree_archive_bundle_failed"
    );
  }
  return RECOVERY_BRANCH_BUNDLE_ARTIFACT;
}

async function archiveSessionSource({
  adapter = null,
  reason = "archive",
  session = {},
  store
} = {}) {
  const worktreePath = recoveryWorktreePath(session);
  if (!worktreePath) {
    return {
      ok: true,
      removed: false,
      recoverable: false,
      reason: "worktree_missing"
    };
  }

  const recoveryKind = metadataValue(session, "source_kind") ||
    metadataValue(session, "source_recovery_kind");
  if (recoveryKind !== "session_clone") {
    return {
      ok: true,
      removed: false,
      recoverable: false,
      reason: "not_session_clone"
    };
  }
  const worktreeExists = await pathExists(worktreePath);
  const worktreeIsGitWorktree = worktreeExists
    ? await isExactGitWorktree(worktreePath)
    : false;
  if (worktreeExists && !worktreeIsGitWorktree && !sessionOwnsWorktreePath(session, worktreePath)) {
    throw vibe64Error(
      `Cannot archive session worktree because the path exists but is not the session-owned Git worktree: ${worktreePath}`,
      "vibe64_worktree_archive_path_not_session_owned"
    );
  }
  const targetRoot = normalizeText(session.targetRoot);
  const sessionId = normalizeText(session.sessionId);
  const sessionName = recoverySessionName(session);
  const branch = worktreeIsGitWorktree
    ? await readWorktreeGitFact(worktreePath, ["branch", "--show-current"], metadataValue(session, "branch"))
    : metadataValue(session, "branch") || metadataValue(session, "source_recovery_branch");
  const head = worktreeIsGitWorktree
    ? await readWorktreeGitFact(worktreePath, ["rev-parse", "--verify", "HEAD"], metadataValue(session, "source_recovery_head"))
    : metadataValue(session, "source_recovery_head");
  const remoteUrl = worktreeIsGitWorktree
    ? await readWorktreeGitFact(worktreePath, ["remote", "get-url", "origin"], metadataValue(session, "source_remote_url"))
    : metadataValue(session, "source_recovery_remote_url") || metadataValue(session, "source_remote_url");
  const disposablePaths = await adapterDisposableWorktreePaths(adapter, {
    reason,
    session,
    targetRoot,
    worktreePath
  });
  const dirtyArtifacts = worktreeIsGitWorktree
    ? await writeDirtyRecoveryArtifacts({
      artifactsRoot: session.artifactsRoot,
      disposablePaths,
      session,
      store,
      worktreePath
    })
    : {
      dirty: false,
      excludedUntrackedCount: 0,
      patchArtifact: metadataValue(session, "source_recovery_patch_artifact"),
      untrackedArtifact: metadataValue(session, "source_recovery_untracked_artifact"),
      untrackedCount: Number(metadataValue(session, "source_recovery_untracked_count") || 0)
    };
  const branchBundleArtifact = worktreeIsGitWorktree
    ? await writeBranchRecoveryBundle({
      artifactsRoot: session.artifactsRoot,
      session,
      worktreePath
    })
    : metadataValue(session, "source_recovery_bundle_artifact");
  const archivedAt = new Date().toISOString();
  await writeMetadataValues(store, sessionId, {
    source_recovery_base_branch: metadataValue(session, "base_branch"),
    source_recovery_base_commit: metadataValue(session, "base_commit"),
    source_recovery_branch: branch,
    source_recovery_bundle_artifact: branchBundleArtifact,
    source_recovery_cache_path: metadataValue(session, "source_cache_path"),
    source_recovery_default_branch: metadataValue(session, "source_default_branch") || metadataValue(session, "base_branch"),
    source_recovery_dirty: dirtyArtifacts.dirty ? "yes" : "no",
    source_recovery_excluded_untracked_count: String(dirtyArtifacts.excludedUntrackedCount || 0),
    source_recovery_head: head,
    source_recovery_kind: recoveryKind,
    source_recovery_patch_artifact: dirtyArtifacts.patchArtifact,
    source_recovery_remote_url: remoteUrl,
    source_recovery_session_name: sessionName,
    source_recovery_saved: "yes",
    source_recovery_saved_at: archivedAt,
    source_recovery_untracked_artifact: dirtyArtifacts.untrackedArtifact,
    source_recovery_untracked_count: String(dirtyArtifacts.untrackedCount || 0),
    source_recovery_source_path: worktreePath
  });

  const removal = await removeSessionOwnedWorktreeDirectory({
    session,
    worktreePath
  });
  await writeMetadataValues(store, sessionId, {
    source_removed: "yes",
    source_removed_at: new Date().toISOString(),
    source_removed_reason: reason
  });
  return {
    ...removal,
    dirty: dirtyArtifacts.dirty,
    worktreePath
  };
}

export {
  archiveSessionSource,
  relativePathIsDisposable
};
