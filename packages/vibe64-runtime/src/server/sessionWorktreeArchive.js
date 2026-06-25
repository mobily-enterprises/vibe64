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
  sessionWorktreePath
} from "@local/vibe64-core/server/sessionWorktreePath";

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
    metadataValue(session, "worktree_recovery_session_name") ||
    metadataValue(session, "issue_word") ||
    metadataValue(session, "work_word") ||
    normalizeText(session.sessionId);
}

function recoveryWorktreePath(session = {}) {
  return metadataValue(session, "worktree_recovery_worktree_path") ||
    metadataValue(session, "worktree_path") ||
    sessionWorktreePath(session);
}

function normalizeDisposablePath(value = "") {
  return normalizeText(value).replaceAll("\\", "/").replace(/^\/+/u, "").replace(/\/+$/u, "");
}

function wildcardPatternMatches(pattern = "", value = "") {
  if (!pattern.includes("*")) {
    return false;
  }
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "u").test(value);
}

function relativePathIsDisposable(relativePath = "", disposablePaths = []) {
  const normalizedPath = normalizeDisposablePath(relativePath);
  if (!normalizedPath) {
    return true;
  }
  const segments = normalizedPath.split("/");
  return disposablePaths.some((entry) => {
    const pattern = normalizeDisposablePath(entry);
    if (!pattern) {
      return false;
    }
    if (wildcardPatternMatches(pattern, normalizedPath)) {
      return true;
    }
    if (!pattern.includes("/") && segments.some((segment) => {
      return segment === pattern || wildcardPatternMatches(pattern, segment);
    })) {
      return true;
    }
    return normalizedPath === pattern || normalizedPath.startsWith(`${pattern}/`);
  });
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

async function removeLocalBranchIfNotCurrent(worktreePath = "", branchName = "") {
  const normalizedBranchName = normalizeText(branchName);
  if (!normalizedBranchName) {
    return;
  }
  const currentBranch = await readWorktreeGitFact(worktreePath, ["branch", "--show-current"]);
  if (normalizedBranchName === currentBranch) {
    return;
  }
  const branchExists = await runGit(worktreePath, ["show-ref", "--verify", "--quiet", `refs/heads/${normalizedBranchName}`], {
    timeout: 15_000
  });
  if (!branchExists.ok) {
    return;
  }
  const deleteResult = await runGit(worktreePath, ["branch", "-D", normalizedBranchName], {
    timeout: 15_000
  });
  if (!deleteResult.ok) {
    throw vibe64Error(
      `Recovered session clone, but could not remove local base branch ${normalizedBranchName}: ${deleteResult.output}`,
      "vibe64_worktree_recovery_local_base_branch_delete_failed"
    );
  }
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

async function gitWorktreeIsRegistered({
  targetRoot = "",
  worktreePath = ""
} = {}) {
  const result = await runGit(targetRoot, ["worktree", "list", "--porcelain"], {
    timeout: 15_000
  });
  if (!result.ok) {
    return false;
  }
  return String(result.stdout || result.output || "")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => normalizeText(line.slice("worktree ".length)))
    .some((registeredPath) => sameResolvedPath(registeredPath, worktreePath));
}

function sessionOwnsWorktreePath(session = {}, worktreePath = "") {
  return sameResolvedPath(sessionWorktreePath(session), worktreePath);
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
  if (metadataValue(session, "worktree_kind") !== "session_clone") {
    return metadataValue(session, "worktree_recovery_bundle_artifact");
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

async function removeGitWorktree({
  session = {},
  targetRoot = "",
  worktreePath = ""
} = {}) {
  if (!await pathExists(worktreePath)) {
    return {
      ok: true,
      removed: false
    };
  }
  if (!await isExactGitWorktree(worktreePath)) {
    throw vibe64Error(
      `Cannot remove session worktree because the path is not the Git worktree root: ${worktreePath}`,
      "vibe64_worktree_remove_not_git_root"
    );
  }
  const removeResult = await runGit(targetRoot, ["worktree", "remove", "--force", "--force", worktreePath], {
    timeout: SNAPSHOT_TIMEOUT_MS
  });
  if (!removeResult.ok) {
    await runGit(targetRoot, ["worktree", "prune"], {
      timeout: 15_000
    });
    if (!await pathExists(worktreePath)) {
      return {
        ok: true,
        removed: true
      };
    }
    if (!await isExactGitWorktree(worktreePath) && sessionOwnsWorktreePath(session, worktreePath)) {
      const removal = await removeSessionOwnedWorktreeDirectory({
        session,
        worktreePath
      });
      return {
        ...removal,
        recoveredFromPartialGitRemove: true
      };
    }
    throw vibe64Error(
      `Cannot remove session worktree: ${removeResult.output}`,
      "vibe64_worktree_remove_failed"
    );
  }
  await runGit(targetRoot, ["worktree", "prune"], {
    timeout: 15_000
  });
  return {
    ok: true,
    removed: true
  };
}

async function archiveSessionWorktree({
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
  const worktreeIsRegistered = worktreeIsGitWorktree
    ? await gitWorktreeIsRegistered({
        targetRoot,
        worktreePath
      })
    : false;
  const recoveryKind = metadataValue(session, "worktree_kind") || "linked_worktree";
  const sessionName = recoverySessionName(session);
  const branch = worktreeIsGitWorktree
    ? await readWorktreeGitFact(worktreePath, ["branch", "--show-current"], metadataValue(session, "branch"))
    : metadataValue(session, "branch") || metadataValue(session, "worktree_recovery_branch");
  const head = worktreeIsGitWorktree
    ? await readWorktreeGitFact(worktreePath, ["rev-parse", "--verify", "HEAD"], metadataValue(session, "worktree_recovery_head"))
    : metadataValue(session, "worktree_recovery_head");
  const remoteUrl = worktreeIsGitWorktree
    ? await readWorktreeGitFact(worktreePath, ["remote", "get-url", "origin"], metadataValue(session, "worktree_remote_url"))
    : metadataValue(session, "worktree_recovery_remote_url") || metadataValue(session, "worktree_remote_url");
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
      patchArtifact: metadataValue(session, "worktree_recovery_patch_artifact"),
      untrackedArtifact: metadataValue(session, "worktree_recovery_untracked_artifact"),
      untrackedCount: Number(metadataValue(session, "worktree_recovery_untracked_count") || 0)
    };
  const branchBundleArtifact = worktreeIsGitWorktree
    ? await writeBranchRecoveryBundle({
      artifactsRoot: session.artifactsRoot,
      session,
      worktreePath
    })
    : metadataValue(session, "worktree_recovery_bundle_artifact");
  const archivedAt = new Date().toISOString();
  await writeMetadataValues(store, sessionId, {
    worktree_recovery_base_branch: metadataValue(session, "base_branch"),
    worktree_recovery_base_commit: metadataValue(session, "base_commit"),
    worktree_recovery_branch: branch,
    worktree_recovery_bundle_artifact: branchBundleArtifact,
    worktree_recovery_cache_path: metadataValue(session, "worktree_cache_path"),
    worktree_recovery_default_branch: metadataValue(session, "worktree_default_branch") || metadataValue(session, "base_branch"),
    worktree_recovery_dirty: dirtyArtifacts.dirty ? "yes" : "no",
    worktree_recovery_excluded_untracked_count: String(dirtyArtifacts.excludedUntrackedCount || 0),
    worktree_recovery_head: head,
    worktree_recovery_kind: recoveryKind,
    worktree_recovery_patch_artifact: dirtyArtifacts.patchArtifact,
    worktree_recovery_remote_url: remoteUrl,
    worktree_recovery_session_name: sessionName,
    worktree_recovery_saved: "yes",
    worktree_recovery_saved_at: archivedAt,
    worktree_recovery_untracked_artifact: dirtyArtifacts.untrackedArtifact,
    worktree_recovery_untracked_count: String(dirtyArtifacts.untrackedCount || 0),
    worktree_recovery_worktree_path: worktreePath
  });

  const removal = worktreeIsGitWorktree && worktreeIsRegistered
    ? await removeGitWorktree({
        session,
        targetRoot,
        worktreePath
      })
    : await removeSessionOwnedWorktreeDirectory({
        session,
        worktreePath
      });
  await writeMetadataValues(store, sessionId, {
    worktree_removed: "yes",
    worktree_removed_at: new Date().toISOString(),
    worktree_removed_reason: reason
  });
  return {
    ...removal,
    dirty: dirtyArtifacts.dirty,
    recoverable: worktreeIsGitWorktree && Boolean(branch || head),
    worktreePath
  };
}

async function ensureRecoveryBranch({
  branch = "",
  head = "",
  remote = "origin",
  targetRoot = ""
} = {}) {
  if (!branch) {
    if (head) {
      return head;
    }
    throw vibe64Error("Cannot recover session worktree without a branch or commit.", "vibe64_worktree_recovery_missing_ref");
  }
  const localBranchResult = await runGit(targetRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
  if (localBranchResult.ok) {
    return branch;
  }

  if (remote) {
    await runGit(targetRoot, ["fetch", remote, `refs/heads/${branch}:refs/heads/${branch}`], {
      timeout: SNAPSHOT_TIMEOUT_MS
    });
    const fetchedBranchResult = await runGit(targetRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
    if (fetchedBranchResult.ok) {
      return branch;
    }
  }

  if (head) {
    const commitResult = await runGit(targetRoot, ["cat-file", "-e", `${head}^{commit}`]);
    if (commitResult.ok) {
      const createBranchResult = await runGit(targetRoot, ["branch", branch, head]);
      if (!createBranchResult.ok) {
        throw vibe64Error(
          `Cannot recreate session branch ${branch}: ${createBranchResult.output}`,
          "vibe64_worktree_recovery_branch_failed"
        );
      }
      return branch;
    }
  }

  throw vibe64Error(
    `Cannot recover session branch ${branch}. Fetch the branch or restore commit ${head || "(unknown)"} first.`,
    "vibe64_worktree_recovery_ref_missing"
  );
}

async function applyRecoveryArtifacts({
  session = {},
  worktreePath = ""
} = {}) {
  const patchArtifact = metadataValue(session, "worktree_recovery_patch_artifact");
  if (patchArtifact) {
    const patchPath = path.join(session.artifactsRoot, patchArtifact);
    if (await pathExists(patchPath)) {
      const patchResult = await runGit(worktreePath, ["apply", "--whitespace=nowarn", patchPath], {
        timeout: SNAPSHOT_TIMEOUT_MS
      });
      if (!patchResult.ok) {
        throw vibe64Error(
          `Recovered worktree, but could not apply the saved dirty patch: ${patchResult.output}`,
          "vibe64_worktree_recovery_patch_apply_failed"
        );
      }
    }
  }

  const untrackedArtifact = metadataValue(session, "worktree_recovery_untracked_artifact");
  if (untrackedArtifact) {
    const untrackedPath = path.join(session.artifactsRoot, untrackedArtifact);
    if (await pathExists(untrackedPath)) {
      const tarResult = await runCommand("tar", [
        "-xzf",
        untrackedPath,
        "-C",
        worktreePath
      ], {
        timeout: SNAPSHOT_TIMEOUT_MS
      });
      if (!tarResult.ok) {
        throw vibe64Error(
          `Recovered worktree, but could not restore saved untracked files: ${tarResult.output}`,
          "vibe64_worktree_recovery_untracked_apply_failed"
        );
      }
    }
  }
}

async function recoverSessionClone({
  branch = "",
  head = "",
  session = {},
  targetRoot = "",
  worktreePath = ""
} = {}) {
  const remoteUrl = metadataValue(session, "worktree_recovery_remote_url") ||
    metadataValue(session, "worktree_remote_url");
  const cachePath = metadataValue(session, "worktree_recovery_cache_path") ||
    metadataValue(session, "worktree_cache_path");
  const cloneBranch = metadataValue(session, "worktree_recovery_default_branch") ||
    metadataValue(session, "worktree_default_branch") ||
    metadataValue(session, "worktree_recovery_base_branch") ||
    metadataValue(session, "base_branch");
  const branchName = branch || `vibe64/${normalizeText(session.sessionId) || "recovered"}`;
  const cloneSource = remoteUrl || targetRoot;
  const parentPath = path.dirname(worktreePath);
  await mkdir(parentPath, {
    recursive: true
  });
  const cloneBaseArgs = cloneBranch ? ["--single-branch", "--branch", cloneBranch] : [];
  const cloneArgs = remoteUrl && cachePath
    ? ["clone", "--reference-if-able", cachePath, ...cloneBaseArgs, cloneSource, worktreePath]
    : ["clone", ...cloneBaseArgs, cloneSource, worktreePath];
  const cloneResult = await runGit(parentPath, cloneArgs, {
    timeout: SNAPSHOT_TIMEOUT_MS
  });
  if (!cloneResult.ok) {
    throw vibe64Error(
      `Cannot recover session clone: ${cloneResult.output}`,
      "vibe64_worktree_recovery_clone_failed"
    );
  }
  const clonedDefaultBranch = await readWorktreeGitFact(worktreePath, ["branch", "--show-current"]);

  const bundleArtifact = metadataValue(session, "worktree_recovery_bundle_artifact");
  const bundlePath = bundleArtifact ? path.join(session.artifactsRoot, bundleArtifact) : "";
  if (bundlePath && await pathExists(bundlePath)) {
    const fetchBundleResult = await runGit(worktreePath, ["fetch", bundlePath, `+HEAD:refs/heads/${branchName}`], {
      timeout: SNAPSHOT_TIMEOUT_MS
    });
    if (!fetchBundleResult.ok) {
      throw vibe64Error(
        `Recovered session clone, but could not restore saved branch commits: ${fetchBundleResult.output}`,
        "vibe64_worktree_recovery_bundle_fetch_failed"
      );
    }
    const checkoutBundleResult = await runGit(worktreePath, ["checkout", branchName], {
      timeout: 15_000
    });
    if (!checkoutBundleResult.ok) {
      throw vibe64Error(
        `Recovered session clone, but could not check out saved branch ${branchName}: ${checkoutBundleResult.output}`,
        "vibe64_worktree_recovery_checkout_failed"
      );
    }
    await removeLocalBranchIfNotCurrent(worktreePath, clonedDefaultBranch);
    return;
  }

  if (branchName && remoteUrl) {
    await runGit(worktreePath, ["fetch", "origin", `refs/heads/${branchName}:refs/remotes/origin/${branchName}`], {
      timeout: SNAPSHOT_TIMEOUT_MS
    });
    const remoteBranchResult = await runGit(worktreePath, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branchName}`], {
      timeout: 15_000
    });
    if (remoteBranchResult.ok) {
      const checkoutResult = await runGit(worktreePath, ["checkout", "-B", branchName, `origin/${branchName}`], {
        timeout: 15_000
      });
      if (!checkoutResult.ok) {
        throw vibe64Error(
          `Recovered session clone, but could not check out ${branchName}: ${checkoutResult.output}`,
          "vibe64_worktree_recovery_checkout_failed"
        );
      }
      await removeLocalBranchIfNotCurrent(worktreePath, clonedDefaultBranch);
      return;
    }
  }

  const checkoutRef = head ||
    metadataValue(session, "worktree_recovery_base_commit") ||
    (metadataValue(session, "worktree_recovery_default_branch")
      ? `origin/${metadataValue(session, "worktree_recovery_default_branch")}`
      : "HEAD");
  const checkoutResult = await runGit(worktreePath, ["checkout", "-B", branchName, checkoutRef], {
    timeout: 15_000
  });
  if (!checkoutResult.ok) {
    throw vibe64Error(
      `Recovered session clone, but could not check out ${checkoutRef}: ${checkoutResult.output}`,
      "vibe64_worktree_recovery_checkout_failed"
    );
  }
  await removeLocalBranchIfNotCurrent(worktreePath, clonedDefaultBranch);
}

async function recoverSessionWorktree({
  session = {},
  store
} = {}) {
  const sessionId = normalizeText(session.sessionId);
  const targetRoot = normalizeText(session.targetRoot);
  const worktreePath = recoveryWorktreePath(session);
  if (!worktreePath) {
    throw vibe64Error("This session does not have a recoverable worktree path.", "vibe64_worktree_recovery_path_missing");
  }
  if (await pathExists(worktreePath)) {
    const insideWorktree = await runGit(worktreePath, ["rev-parse", "--is-inside-work-tree"], {
      timeout: 15_000
    });
    if (!insideWorktree.ok) {
      throw vibe64Error(
        `Cannot recover session worktree because the target path already exists and is not a Git worktree: ${worktreePath}`,
        "vibe64_worktree_recovery_path_exists"
      );
    }
    await writeMetadataValues(store, sessionId, {
      worktree_path: worktreePath,
      worktree_removed: "no",
      worktree_restored_at: new Date().toISOString()
    });
    return {
      ok: true,
      recovered: false,
      worktreePath
    };
  }
  await mkdir(path.dirname(worktreePath), {
    recursive: true
  });
  const branch = metadataValue(session, "worktree_recovery_branch") || metadataValue(session, "branch");
  const head = metadataValue(session, "worktree_recovery_head");
  const recoveryKind = metadataValue(session, "worktree_recovery_kind") || metadataValue(session, "worktree_kind");
  if (recoveryKind === "session_clone" || metadataValue(session, "worktree_recovery_remote_url")) {
    await recoverSessionClone({
      branch,
      head,
      session,
      targetRoot,
      worktreePath
    });
    await applyRecoveryArtifacts({
      session,
      worktreePath
    });
    await writeMetadataValues(store, sessionId, {
      worktree_path: worktreePath,
      worktree_removed: "no",
      worktree_restored_at: new Date().toISOString()
    });
    return {
      ok: true,
      recovered: true,
      worktreePath
    };
  }
  const checkoutRef = await ensureRecoveryBranch({
    branch,
    head,
    remote: metadataValue(session, "branch_push_remote") || "origin",
    targetRoot
  });
  const addResult = await runGit(targetRoot, ["worktree", "add", worktreePath, checkoutRef], {
    timeout: SNAPSHOT_TIMEOUT_MS
  });
  if (!addResult.ok) {
    throw vibe64Error(
      `Cannot recover session worktree: ${addResult.output}`,
      "vibe64_worktree_recovery_add_failed"
    );
  }
  await applyRecoveryArtifacts({
    session,
    worktreePath
  });
  await writeMetadataValues(store, sessionId, {
    worktree_path: worktreePath,
    worktree_removed: "no",
    worktree_restored_at: new Date().toISOString()
  });
  return {
    ok: true,
    recovered: true,
    worktreePath
  };
}

export {
  archiveSessionWorktree,
  recoverSessionWorktree,
  relativePathIsDisposable
};
