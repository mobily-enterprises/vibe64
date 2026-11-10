import { rename, rm } from "node:fs/promises";
import path from "node:path";

import { pathExists, vibe64Error } from "@local/vibe64-core/server/core";
import { sessionConnectedCopies } from "@local/vibe64-core/server/projectRepository";
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
  removeEmptySessionSourceFolder,
  removeSessionOwnedWorktreeDirectory,
  renewalSourceDeletionPath,
  renewalSourceStagePath,
  sameResolvedPath,
  sessionOwnsWorktreePath,
  writeMetadataValues
} from "./sessionWorktreeGit.js";
import {
  recoveryDetailsFromSession,
  saveConnectedCopiesRecovery,
  saveSessionSourceRecovery,
  validateRecoveryBundle
} from "./sessionSourceRecovery.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("./types.js").Vibe64SessionStore} Vibe64SessionStore */

/**
 * The folder of a session's connected copies, beside its source.
 * @param {string} sourcePath
 */
function connectedCopiesRoot(sourcePath = "") {
  return sourcePath ? path.join(path.dirname(path.resolve(sourcePath)), "connected") : "";
}

/**
 * Where renewal stages the connected copies with the source, until the successor exists.
 * @param {object} session
 * @param {string} renewalId
 */
function connectedCopiesStagePath(session, renewalId) {
  return `${connectedCopiesRoot(sessionSourcePath(session))}.renewal-${assertSessionRenewalId(renewalId)}`;
}

/**
 * Renewal needs every connected copy saved, like the source: the successor copies them again from
 * their mains. Their checkpoints are kept as recovery evidence first.
 * @param {{ session: object, store: Vibe64SessionStore }} request
 */
async function prepareRenewalConnectedCopies({ session, store }) {
  for (const copy of sessionConnectedCopies(session)) {
    if (await pathExists(copy.path) && await inspectWorktreeDirty(copy.path)) {
      throw vibe64Error(
        `Renewal requires a clean, saved session source. Connected repository ${copy.name} has unsaved work.`,
        "vibe64_session_renewal_source_dirty"
      );
    }
  }
  await saveConnectedCopiesRecovery({ session, store });
}

/**
 * Moves the connected copies folder, when it exists, from one place to another that must not exist.
 */
async function moveConnectedCopies(from, to) {
  if (!from || !await pathExists(from)) return false;
  if (await pathExists(to)) {
    throw vibe64Error(
      `Connected repositories exist in both active and staged locations: ${to}`,
      "vibe64_session_renewal_connected_stage_conflict"
    );
  }
  await rename(from, to);
  return true;
}

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
      "vibe64_session_renewal_recovery_evidence_incomplete"
    );
  }
  const head = await readWorktreeGitFact(worktreePath, ["rev-parse", "--verify", "HEAD"]);
  if (!details.head || head !== details.head) {
    throw vibe64Error(
      "The renewal recovery commit does not match the staged worktree.",
      "vibe64_session_renewal_recovery_commit_mismatch"
    );
  }
  const branch = await readWorktreeGitFact(worktreePath, ["branch", "--show-current"]);
  if (details.branch && branch !== details.branch) {
    throw vibe64Error(
      "The renewal recovery branch does not match the staged worktree.",
      "vibe64_session_renewal_recovery_branch_mismatch"
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
      "vibe64_session_renewal_source_stage_conflict",
      { params: { sessionId: toText(session.sessionId) } }
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
    throw new Error(`Renewal requires the exact session-owned Git worktree: ${sourcePath}`);
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
  await prepareRenewalConnectedCopies({ session, store });
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
      "vibe64_session_renewal_source_changed_during_evidence"
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
      "vibe64_session_renewal_source_stage_conflict",
      { params: { sessionId: toText(session.sessionId) } }
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
    throw new Error(`Renewal requires the exact session-owned Git worktree: ${currentPath}`);
  }
  if (await inspectWorktreeDirty(currentPath)) {
    throw vibe64Error(
      "Renewal requires the exact clean source used for its recovery proof.",
      "vibe64_session_renewal_source_proof_dirty"
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
        "vibe64_session_renewal_source_changed_before_stage"
      );
    }
    await rename(sourcePath, stagePath);
  }
  await moveConnectedCopies(connectedCopiesRoot(sourcePath), connectedCopiesStagePath(session, renewalId));
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
      "vibe64_session_renewal_source_stage_conflict",
      { params: { sessionId: toText(session.sessionId) } }
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
    throw new Error(`Renewal source stage is no longer the exact clean session Git worktree: ${currentPath}`);
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
  await moveConnectedCopies(connectedCopiesStagePath(session, renewalId), connectedCopiesRoot(sourcePath));
  if (!await isExactGitWorktree(sourcePath)) {
    throw new Error(`Restored renewal source is not the exact session Git worktree: ${sourcePath}`);
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
      "vibe64_session_renewal_source_archive_unpublished",
      { params: { sessionId: toText(session.sessionId) } }
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
      "vibe64_session_renewal_source_deletion_conflict",
      { params: { sessionId: toText(session.sessionId) } }
    );
  }
  if (stageExists) {
    if (!await isExactGitWorktree(stagePath) || await inspectWorktreeDirty(stagePath)) {
      throw new Error(`Refusing to remove an invalid renewal source stage: ${stagePath}`);
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
  // The copies' recovery evidence is in the published archive; the successor copies them again.
  await rm(connectedCopiesStagePath(session, renewalId), {
    force: true,
    maxRetries: 20,
    recursive: true,
    retryDelay: 100
  });
  await removeEmptySessionSourceFolder(sourcePath);
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
  const connected = await saveConnectedCopiesRecovery({ session, store });

  const removal = await removeSessionOwnedWorktreeDirectory({
    session,
    worktreePath
  });
  if (sessionOwnsWorktreePath(session, worktreePath)) {
    await rm(connectedCopiesRoot(worktreePath), {
      force: true,
      maxRetries: 20,
      recursive: true,
      retryDelay: 100
    });
    await removeEmptySessionSourceFolder(worktreePath);
  }
  await writeMetadataValues(store, sessionId, {
    source_removed: "yes",
    source_removed_at: new Date().toISOString(),
    source_removed_reason: reason
  });
  return {
    ...removal,
    dirty: recovery.dirty || Object.values(connected).some(copy => copy.dirty),
    worktreePath
  };
}

export {
  archiveSessionSource,
  commitRenewalSessionSourceStage,
  prepareRenewalSessionSource,
  restoreRenewalSessionSourceStage,
  stagePreparedRenewalSessionSource
};
