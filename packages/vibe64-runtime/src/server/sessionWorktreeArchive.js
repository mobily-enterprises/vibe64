import { rename, rm } from "node:fs/promises";
import path from "node:path";

import { pathExists, vibe64Error } from "@local/vibe64-core/server/core";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";

import { assertRenewalId as assertSessionRenewalId } from "./sessionRenewalIds.js";
import {
  inspectWorktreeDirty,
  isExactGitWorktree,
  metadataValue,
  readWorktreeGitFact,
  RECOVERY_BRANCH_BUNDLE_ARTIFACT,
  RECOVERY_CHECKPOINT_BUNDLE_ARTIFACT,
  recoveryWorktreePath,
  removeSessionOwnedWorktreeDirectory,
  renewalSourceDeletionPath,
  renewalSourceStagePath,
  sameResolvedPath,
  sessionOwnsWorktreePath,
  writeMetadataValues
} from "./sessionWorktreeGit.js";
import {
  recoveryDetailsFromSession,
  saveSessionSourceRecovery,
  validateRecoveryBundle
} from "./sessionSourceRecovery.js";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("./types.js").Vibe64SessionStore} Vibe64SessionStore */

async function validateCleanRenewalRecovery({
  details = {},
  session = {},
  sourcePath = "",
  worktreePath = ""
} = {}) {
  if (
    details.recoverySaved !== true ||
    !sameResolvedPath(details.recoverySourcePath, sourcePath) ||
    details.dirty === true ||
    details.patchArtifact ||
    details.untrackedArtifact ||
    Number(details.untrackedCount || 0) !== 0
  ) {
    throw vibe64Error(
      "A renewal source stage requires complete clean-worktree recovery evidence.",
      "vibe64_session_renewal_recovery_invalid"
    );
  }
  const head = await readWorktreeGitFact(worktreePath, ["rev-parse", "--verify", "HEAD"]);
  if (!details.head || head !== details.head) {
    throw vibe64Error(
      "The renewal recovery commit does not match the staged worktree.",
      "vibe64_session_renewal_recovery_invalid"
    );
  }
  const branch = await readWorktreeGitFact(worktreePath, ["branch", "--show-current"]);
  if (details.branch && branch !== details.branch) {
    throw vibe64Error(
      "The renewal recovery branch does not match the staged worktree.",
      "vibe64_session_renewal_recovery_invalid"
    );
  }
  await validateRecoveryBundle({
    artifact: details.branchBundleArtifact,
    expectedArtifact: RECOVERY_BRANCH_BUNDLE_ARTIFACT,
    session,
    worktreePath
  });
  await validateRecoveryBundle({
    artifact: details.checkpointBundleArtifact,
    expectedArtifact: RECOVERY_CHECKPOINT_BUNDLE_ARTIFACT,
    session,
    worktreePath
  });
}

async function prepareRenewalSessionSource({
  renewalId = "",
  session = {},
  store
} = {}) {
  const sourcePath = sessionSourcePath(session);
  const stagePath = renewalSourceStagePath(session, renewalId);
  const [sourceExists, stageExists] = await Promise.all([
    pathExists(sourcePath),
    pathExists(stagePath)
  ]);
  if (sourceExists && stageExists) {
    throw vibe64Error(
      `Renewal source exists in both active and staged locations: ${toText(session.sessionId)}`,
      "vibe64_session_renewal_source_stage_conflict"
    );
  }
  if (!sourceExists) {
    throw vibe64Error(
      stageExists
        ? `Renewal source was staged before its durable commit: ${toText(session.sessionId)}`
        : `Renewal source is missing from its active location: ${toText(session.sessionId)}`,
      stageExists
        ? "vibe64_session_renewal_source_prematurely_staged"
        : "vibe64_session_renewal_source_missing"
    );
  }
  if (!sessionOwnsWorktreePath(session, sourcePath) || !await isExactGitWorktree(sourcePath)) {
    throw vibe64Error(
      `Renewal requires the exact session-owned Git worktree: ${sourcePath}`,
      "vibe64_session_renewal_source_invalid"
    );
  }
  if (await inspectWorktreeDirty(sourcePath)) {
    throw vibe64Error(
      "Renewal requires a clean, saved session source.",
      "vibe64_session_renewal_source_dirty"
    );
  }
  const existingDetails = recoveryDetailsFromSession(session);
  const [currentHead, currentBranch] = await Promise.all([
    readWorktreeGitFact(sourcePath, ["rev-parse", "--verify", "HEAD"]),
    readWorktreeGitFact(sourcePath, ["branch", "--show-current"])
  ]);
  if (
    existingDetails.recoverySaved === true &&
    sameResolvedPath(existingDetails.recoverySourcePath, sourcePath) &&
    existingDetails.head === currentHead &&
    (!existingDetails.branch || existingDetails.branch === currentBranch)
  ) {
    await validateCleanRenewalRecovery({
      details: existingDetails,
      session,
      sourcePath,
      worktreePath: sourcePath
    });
    return {
      changed: false,
      prepared: true,
      renewalId: assertSessionRenewalId(renewalId),
      sessionId: toText(session.sessionId),
      sourcePath,
      stagePath,
      staged: false
    };
  }
  await Promise.all([
    RECOVERY_BRANCH_BUNDLE_ARTIFACT,
    RECOVERY_CHECKPOINT_BUNDLE_ARTIFACT
  ].map((relativePath) => rm(path.join(session.artifactsRoot, relativePath), {
    force: true
  })));
  const details = await saveSessionSourceRecovery({
    session,
    store,
    worktreeIsGitWorktree: true,
    worktreePath: sourcePath
  });
  await validateCleanRenewalRecovery({
    details,
    session,
    sourcePath,
    worktreePath: sourcePath
  });
  if (await inspectWorktreeDirty(sourcePath)) {
    throw vibe64Error(
      "Renewal source changed while its recovery evidence was being prepared.",
      "vibe64_session_renewal_source_dirty"
    );
  }
  return {
    changed: true,
    prepared: true,
    renewalId: assertSessionRenewalId(renewalId),
    sessionId: toText(session.sessionId),
    sourcePath,
    stagePath,
    staged: false
  };
}

async function stagePreparedRenewalSessionSource({
  renewalId = "",
  session = {}
} = {}) {
  const sourcePath = sessionSourcePath(session);
  const stagePath = renewalSourceStagePath(session, renewalId);
  const [sourceExists, stageExists] = await Promise.all([
    pathExists(sourcePath),
    pathExists(stagePath)
  ]);
  if (sourceExists && stageExists) {
    throw vibe64Error(
      `Renewal source exists in both active and staged locations: ${toText(session.sessionId)}`,
      "vibe64_session_renewal_source_stage_conflict"
    );
  }
  if (!sourceExists && !stageExists) {
    throw vibe64Error(
      `Renewal source is missing from both active and staged locations: ${toText(session.sessionId)}`,
      "vibe64_session_renewal_source_missing"
    );
  }
  const currentPath = sourceExists ? sourcePath : stagePath;
  if (!sessionOwnsWorktreePath(session, sourcePath) || !await isExactGitWorktree(currentPath)) {
    throw vibe64Error(
      `Renewal requires the exact session-owned Git worktree: ${currentPath}`,
      "vibe64_session_renewal_source_invalid"
    );
  }
  if (await inspectWorktreeDirty(currentPath)) {
    throw vibe64Error(
      "Renewal requires the exact clean source used for its recovery proof.",
      "vibe64_session_renewal_source_dirty"
    );
  }
  await validateCleanRenewalRecovery({
    details: recoveryDetailsFromSession(session),
    session,
    sourcePath,
    worktreePath: currentPath
  });
  if (sourceExists) {
    if (await inspectWorktreeDirty(sourcePath)) {
      throw vibe64Error(
        "Renewal source changed before its committed stage transition.",
        "vibe64_session_renewal_source_dirty"
      );
    }
    await rename(sourcePath, stagePath);
  }
  return {
    changed: sourceExists,
    renewalId: assertSessionRenewalId(renewalId),
    sessionId: toText(session.sessionId),
    sourcePath,
    stagePath,
    staged: true
  };
}

async function restoreRenewalSessionSourceStage({
  renewalId = "",
  session = {}
} = {}) {
  const sourcePath = sessionSourcePath(session);
  const stagePath = renewalSourceStagePath(session, renewalId);
  const [sourceExists, stageExists] = await Promise.all([
    pathExists(sourcePath),
    pathExists(stagePath)
  ]);
  if (sourceExists && stageExists) {
    throw vibe64Error(
      `Renewal source exists in both active and staged locations: ${toText(session.sessionId)}`,
      "vibe64_session_renewal_source_stage_conflict"
    );
  }
  if (!sourceExists && !stageExists) {
    throw vibe64Error(
      `Renewal source is missing from both active and staged locations: ${toText(session.sessionId)}`,
      "vibe64_session_renewal_source_missing"
    );
  }
  const currentPath = stageExists ? stagePath : sourcePath;
  if (!await isExactGitWorktree(currentPath) || await inspectWorktreeDirty(currentPath)) {
    throw vibe64Error(
      `Renewal source stage is no longer the exact clean session Git worktree: ${currentPath}`,
      "vibe64_session_renewal_source_invalid"
    );
  }
  await validateCleanRenewalRecovery({
    details: recoveryDetailsFromSession(session),
    session,
    sourcePath,
    worktreePath: currentPath
  });
  if (stageExists) {
    await rename(stagePath, sourcePath);
  }
  if (!await isExactGitWorktree(sourcePath)) {
    throw vibe64Error(
      `Restored renewal source is not the exact session Git worktree: ${sourcePath}`,
      "vibe64_session_renewal_source_invalid"
    );
  }
  return {
    changed: stageExists,
    renewalId: assertSessionRenewalId(renewalId),
    restored: true,
    sessionId: toText(session.sessionId),
    sourcePath,
    stagePath
  };
}

async function commitRenewalSessionSourceStage({
  renewalId = "",
  session = {}
} = {}) {
  if (
    session.archived !== true ||
    toText(session.archiveStatus || session.status) !== "archived" ||
    !toText(session.archivePath) ||
    !toText(session.artifactsRoot)
  ) {
    throw vibe64Error(
      `Renewal source removal requires the published predecessor archive: ${toText(session.sessionId)}`,
      "vibe64_session_renewal_source_commit_status_invalid"
    );
  }
  const sourcePath = sessionSourcePath(session);
  const stagePath = renewalSourceStagePath(session, renewalId);
  const deletionPath = renewalSourceDeletionPath(session, renewalId);
  if (await pathExists(sourcePath)) {
    throw vibe64Error(
      `Refusing to remove a renewal stage while the active source still exists: ${sourcePath}`,
      "vibe64_session_renewal_source_not_staged"
    );
  }
  const [stageExists, deletionExists] = await Promise.all([
    pathExists(stagePath),
    pathExists(deletionPath)
  ]);
  if (stageExists && deletionExists) {
    throw vibe64Error(
      `Renewal source exists in both staged and deleting locations: ${toText(session.sessionId)}`,
      "vibe64_session_renewal_source_stage_conflict"
    );
  }
  if (stageExists) {
    if (!await isExactGitWorktree(stagePath) || await inspectWorktreeDirty(stagePath)) {
      throw vibe64Error(
        `Refusing to remove an invalid renewal source stage: ${stagePath}`,
        "vibe64_session_renewal_source_invalid"
      );
    }
    await validateCleanRenewalRecovery({
      details: recoveryDetailsFromSession(session),
      session,
      sourcePath,
      worktreePath: stagePath
    });
    await rename(stagePath, deletionPath);
  }
  if (stageExists || deletionExists) {
    await rm(deletionPath, {
      force: true,
      maxRetries: 20,
      recursive: true,
      retryDelay: 100
    });
  }
  return {
    changed: stageExists || deletionExists,
    deletionPath,
    removed: true,
    renewalId: assertSessionRenewalId(renewalId),
    sessionId: toText(session.sessionId),
    sourcePath,
    stagePath
  };
}

async function archiveSessionSource({
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
  const sessionId = toText(session.sessionId);
  const recovery = await saveSessionSourceRecovery({
    session,
    store,
    worktreeIsGitWorktree,
    worktreePath
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
    dirty: recovery.dirty,
    worktreePath
  };
}

export {
  archiveSessionSource,
  commitRenewalSessionSourceStage,
  prepareRenewalSessionSource,
  renewalSourceStagePath,
  restoreRenewalSessionSourceStage,
  stagePreparedRenewalSessionSource
};
