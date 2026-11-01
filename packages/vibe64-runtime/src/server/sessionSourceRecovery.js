import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { pathExists, vibe64Error } from "@local/vibe64-core/server/core";
import { checkpointRefRoot } from "@local/vibe64-execution/server";

import {
  inspectWorktreeDirty,
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
  runCommand,
  runGit,
  SNAPSHOT_TIMEOUT_MS,
  writeMetadataValues
} from "./sessionWorktreeGit.js";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("./types.js").Vibe64SessionStore} Vibe64SessionStore */

/**
 * Recovery of a session's source before it is archived: its uncommitted work,
 * branch and checkpoints as bundles and artifacts, and the details saved for
 * restoring them.
 * @param {object} request
 * @param {string} [request.artifactsRoot]
 * @param {object} [request.session]
 * @param {Vibe64SessionStore} request.store
 * @param {string} [request.worktreePath]
 */
async function writeDirtyRecoveryArtifacts({
  artifactsRoot = "",
  session = {},
  store,
  worktreePath = ""
} = {}) {
  const dirty = await inspectWorktreeDirty(worktreePath);
  if (!dirty) {
    return {
      dirty: false,
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
  const patchArtifact = toText(patchText)
    ? RECOVERY_PATCH_ARTIFACT
    : "";
  if (patchArtifact) {
    await store.writeArtifact(session.sessionId, patchArtifact, patchText);
  }

  const untrackedResult = await runGit(worktreePath, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z"
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
  if (untrackedPaths.length < 1) {
    return {
      dirty: true,
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
  await writeFile(listPath, `${untrackedPaths.join("\0")}\0`, "utf8");
  const tarResult = await runCommand("tar", [
    "--null",
    "-czf",
    tarPath,
    "-T",
    listPath
  ], {
    allowedRoots: [artifactsRoot],
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
    patchArtifact,
    untrackedArtifact: RECOVERY_UNTRACKED_ARTIFACT,
    untrackedCount: untrackedPaths.length
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
      const commitsAhead = Number(toText(aheadResult.stdout || aheadResult.output));
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

async function writeCheckpointRecoveryBundle({
  artifactsRoot = "",
  session = {},
  worktreePath = ""
} = {}) {
  if (metadataValue(session, "source_kind") !== "session_clone") {
    return metadataValue(session, "source_recovery_checkpoint_bundle_artifact");
  }
  const refRoot = checkpointRefRoot(session.sessionId);
  const refsResult = await runGit(worktreePath, [
    "for-each-ref",
    "--format=%(objectname) %(refname)",
    `${refRoot}/`
  ], {
    timeout: 15_000
  });
  if (!refsResult.ok) {
    throw vibe64Error(
      `Cannot inspect session checkpoints before archive: ${refsResult.output}`,
      "vibe64_worktree_archive_checkpoint_refs_failed"
    );
  }
  const refs = String(refsResult.stdout || "")
    .split("\n")
    .map((line) => toText(line))
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(" ");
      return {
        commit: separator > 0 ? toText(line.slice(0, separator)) : "",
        ref: separator > 0 ? toText(line.slice(separator + 1)) : ""
      };
    });
  if (refs.length < 1) {
    return "";
  }
  if (refs.some(({ commit, ref }) => !commit || !ref.startsWith(`${refRoot}/`))) {
    throw vibe64Error(
      "Session checkpoint refs are not valid durable Git refs.",
      "vibe64_worktree_archive_checkpoint_refs_invalid"
    );
  }

  const recoveryRoot = path.join(artifactsRoot, RECOVERY_ARTIFACT_ROOT);
  const bundlePath = path.join(artifactsRoot, RECOVERY_CHECKPOINT_BUNDLE_ARTIFACT);
  await mkdir(recoveryRoot, {
    recursive: true
  });
  const bundleResult = await runGit(worktreePath, [
    "bundle",
    "create",
    bundlePath,
    ...refs.map(({ ref }) => ref)
  ], {
    allowedRoots: [artifactsRoot],
    timeout: SNAPSHOT_TIMEOUT_MS
  });
  if (!bundleResult.ok) {
    throw vibe64Error(
      `Cannot snapshot session checkpoints before archive: ${bundleResult.output}`,
      "vibe64_worktree_archive_checkpoint_bundle_failed"
    );
  }
  const verifyResult = await runGit(worktreePath, [
    "bundle",
    "verify",
    bundlePath
  ], {
    allowedRoots: [artifactsRoot],
    timeout: SNAPSHOT_TIMEOUT_MS
  });
  if (!verifyResult.ok) {
    throw vibe64Error(
      `Session checkpoint bundle could not be validated: ${verifyResult.output}`,
      "vibe64_worktree_archive_checkpoint_bundle_invalid"
    );
  }

  const verificationRoot = await mkdtemp(path.join(recoveryRoot, ".checkpoint-restore-"));
  try {
    const initResult = await runGit(worktreePath, ["init", "--bare", verificationRoot], {
      allowedRoots: [artifactsRoot],
      timeout: 15_000
    });
    if (!initResult.ok) {
      throw vibe64Error(
        `Cannot initialize checkpoint restore verification: ${initResult.output}`,
        "vibe64_worktree_archive_checkpoint_restore_init_failed"
      );
    }
    const fetchResult = await runGit(worktreePath, [
      "--git-dir",
      verificationRoot,
      "fetch",
      bundlePath,
      ...refs.map(({ ref }) => `${ref}:${ref}`)
    ], {
      allowedRoots: [artifactsRoot],
      timeout: SNAPSHOT_TIMEOUT_MS
    });
    if (!fetchResult.ok) {
      throw vibe64Error(
        `Session checkpoint bundle could not be restored: ${fetchResult.output}`,
        "vibe64_worktree_archive_checkpoint_restore_failed"
      );
    }
    const restored = await runGit(worktreePath, [
      "--git-dir",
      verificationRoot,
      "for-each-ref",
      "--format=%(objectname) %(refname)",
      `${refRoot}/`
    ], {
      allowedRoots: [artifactsRoot],
      timeout: 15_000
    });
    if (!restored.ok) {
      throw vibe64Error(
        `Session checkpoint restore verification could not run: ${restored.output}`,
        "vibe64_worktree_archive_checkpoint_restore_verify_failed"
      );
    }
    const restoredRefs = restored.stdout.split("\n").map(toText).filter(Boolean).sort();
    const expectedRefs = refs.map(({ commit, ref }) => `${commit} ${ref}`).sort();
    if (restoredRefs.join("\n") !== expectedRefs.join("\n")) {
      throw vibe64Error(
        "Session checkpoint bundle did not restore the exact checkpoint refs.",
        "vibe64_worktree_archive_checkpoint_restore_mismatch"
      );
    }
  } finally {
    await rm(verificationRoot, {
      force: true,
      recursive: true
    });
  }
  return RECOVERY_CHECKPOINT_BUNDLE_ARTIFACT;
}

function recoveryDetailsFromSession(session = {}) {
  return {
    branch: metadataValue(session, "source_recovery_branch"),
    branchBundleArtifact: metadataValue(session, "source_recovery_bundle_artifact"),
    checkpointBundleArtifact: metadataValue(session, "source_recovery_checkpoint_bundle_artifact"),
    dirty: metadataValue(session, "source_recovery_dirty") === "yes",
    head: metadataValue(session, "source_recovery_head"),
    patchArtifact: metadataValue(session, "source_recovery_patch_artifact"),
    recoverySaved: metadataValue(session, "source_recovery_saved") === "yes",
    recoverySourcePath: metadataValue(session, "source_recovery_source_path"),
    untrackedArtifact: metadataValue(session, "source_recovery_untracked_artifact"),
    untrackedCount: Number(metadataValue(session, "source_recovery_untracked_count") || 0)
  };
}

async function saveSessionSourceRecovery({
  session = {},
  store,
  worktreeIsGitWorktree = false,
  worktreePath = ""
} = {}) {
  const branch = worktreeIsGitWorktree
    ? await readWorktreeGitFact(worktreePath, ["branch", "--show-current"], metadataValue(session, "branch"))
    : metadataValue(session, "branch") || metadataValue(session, "source_recovery_branch");
  const head = worktreeIsGitWorktree
    ? await readWorktreeGitFact(worktreePath, ["rev-parse", "--verify", "HEAD"], metadataValue(session, "source_recovery_head"))
    : metadataValue(session, "source_recovery_head");
  const remoteUrl = worktreeIsGitWorktree
    ? await readWorktreeGitFact(worktreePath, ["remote", "get-url", "origin"], metadataValue(session, "source_remote_url"))
    : metadataValue(session, "source_recovery_remote_url") || metadataValue(session, "source_remote_url");
  const dirtyArtifacts = worktreeIsGitWorktree
    ? await writeDirtyRecoveryArtifacts({
      artifactsRoot: session.artifactsRoot,
      session,
      store,
      worktreePath
    })
    : {
        dirty: false,
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
  const checkpointBundleArtifact = worktreeIsGitWorktree
    ? await writeCheckpointRecoveryBundle({
      artifactsRoot: session.artifactsRoot,
      session,
      worktreePath
    })
    : metadataValue(session, "source_recovery_checkpoint_bundle_artifact");
  const archivedAt = new Date().toISOString();
  const details = {
    branch,
    branchBundleArtifact,
    checkpointBundleArtifact,
    dirty: dirtyArtifacts.dirty,
    head,
    patchArtifact: dirtyArtifacts.patchArtifact,
    recoverySaved: true,
    recoverySourcePath: worktreePath,
    untrackedArtifact: dirtyArtifacts.untrackedArtifact,
    untrackedCount: dirtyArtifacts.untrackedCount || 0
  };
  await writeMetadataValues(store, session.sessionId, {
    source_recovery_base_branch: metadataValue(session, "base_branch"),
    source_recovery_base_commit: metadataValue(session, "base_commit"),
    source_recovery_branch: details.branch,
    source_recovery_bundle_artifact: details.branchBundleArtifact,
    source_recovery_checkpoint_bundle_artifact: details.checkpointBundleArtifact,
    source_recovery_default_branch: metadataValue(session, "source_default_branch") || metadataValue(session, "base_branch"),
    source_recovery_dirty: details.dirty ? "yes" : "no",
    source_recovery_head: details.head,
    source_recovery_kind: metadataValue(session, "source_kind") || metadataValue(session, "source_recovery_kind"),
    source_recovery_patch_artifact: details.patchArtifact,
    source_recovery_remote_url: remoteUrl,
    source_recovery_session_name: recoverySessionName(session),
    source_recovery_saved: "yes",
    source_recovery_saved_at: archivedAt,
    source_recovery_untracked_artifact: details.untrackedArtifact,
    source_recovery_untracked_count: String(details.untrackedCount),
    source_recovery_source_path: worktreePath
  });
  return details;
}

async function validateRecoveryBundle({
  artifact = "",
  expectedArtifact = "",
  session = {},
  worktreePath = ""
} = {}) {
  if (!artifact) {
    return;
  }
  if (artifact !== expectedArtifact) {
    throw vibe64Error(
      `Renewal recovery references an unexpected artifact: ${artifact}`,
      "vibe64_session_renewal_recovery_invalid"
    );
  }
  const artifactPath = path.join(session.artifactsRoot, artifact);
  if (!await pathExists(artifactPath)) {
    throw vibe64Error(
      `Renewal recovery artifact is missing: ${artifact}`,
      "vibe64_session_renewal_recovery_invalid"
    );
  }
  const verification = await runGit(worktreePath, ["bundle", "verify", artifactPath], {
    allowedRoots: [session.artifactsRoot],
    timeout: SNAPSHOT_TIMEOUT_MS
  });
  if (!verification.ok) {
    throw vibe64Error(
      `Renewal recovery artifact is invalid: ${artifact}: ${verification.output}`,
      "vibe64_session_renewal_recovery_invalid"
    );
  }
}

export {
  recoveryDetailsFromSession,
  saveSessionSourceRecovery,
  validateRecoveryBundle,
  writeBranchRecoveryBundle,
  writeCheckpointRecoveryBundle,
  writeDirtyRecoveryArtifacts
};
