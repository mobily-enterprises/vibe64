// Save: inspect session work and changes, then checkpoint, prepare, publish,
// reconcile and recover a Save to the canonical branch.
import crypto from "node:crypto";
import { PROJECT_REPOSITORY_MODE_GITHUB } from "@local/vibe64-core/server/projectRepository";
import { createGitTurnCheckpoint, isFallbackGitIdentityEmail, runVibe64Command } from "@local/vibe64-execution/server";
import {
  assertBranch,
  commandProject,
  commitIsAncestor,
  commitTree,
  deleteOperationRef,
  git,
  gitOutput,
  normalizedDerivedArtifactPaths,
  preparedSaveRef,
  regenerateDerivedArtifactTree,
  repositoryContext,
  runSessionWorkOperation,
  savedHistoryRewritten,
  saveError,
  scopedSessionWorkCommand,
  sessionWorkComparison,
  text,
  treeWithDerivedArtifactsFromCommit
} from "./sessionWorkGit.js";
import {
  assertConnectedSubmissionsIntegrated,
  assertConnectedWorkSnapshotsUnchanged,
  connectedWorkSnapshots,
  readCanonical
} from "./sessionWorkAuthority.js";
import {
  inspectSessionChangeDiff,
  inspectSessionChangeDiffDirect,
  inspectSessionChanges,
  inspectSessionChangesDirect,
  inspectSessionWork,
  inspectSessionWorkDirect
} from "./sessionWorkInspection.js";
import {
  createSaveCommit,
  publishSaveCommit,
  reconcileSession,
  refreshVerifiedGithubMirror,
  retryableMirrorMaintenance
} from "./sessionWorkPublication.js";
import { recoverSessionWorkSave } from "./sessionWorkSaveRecovery.js";

async function prepareSessionPullRequestBranch({ project, session, connectedWorkSnapshots: suppliedSnapshots = [],
  commandOptions = {}, runCommand = runVibe64Command }) {
  const context = repositoryContext(session, project);
  const ref = `refs/heads/${context.branch}`;
  const options = { commandOptions, project, connectedWorkSnapshots: connectedWorkSnapshots(suppliedSnapshots) };
  const existing = await gitOutput(runCommand, context, ["ls-remote", "--heads", context.remoteUrl, ref], options);
  if (!existing) {
    await assertConnectedSubmissionsIntegrated(runCommand, context, options);
    await assertConnectedWorkSnapshotsUnchanged(runCommand, options.connectedWorkSnapshots, options);
    // An empty lease creates only an absent ref, including for locally committed baselines.
    await git(runCommand, context, ["push", `--force-with-lease=${ref}:`, context.remoteUrl, `${context.baseCommit}:${ref}`], options);
  }
  await git(runCommand, context, ["remote", "set-url", "origin", context.remoteUrl], options);
}

async function rememberPreparedSaveCommit(runCommand, context, operationId, commit, options = {}) {
  const ref = preparedSaveRef(context, operationId);
  await git(runCommand, context, ["update-ref", ref, commit], options);
  return ref;
}

async function captureSessionWorkSaveCheckpoint(runCommand, context, {
  commandOptions = {},
  operationId,
  project = {}
} = {}) {
  await assertBranch(runCommand, context, { commandOptions, project });
  const checkpoint = await createGitTurnCheckpoint({
    outerTurnId: `save:${operationId}`,
    outcome: "completed",
    project: commandProject(context, project),
    runCommand,
    sessionId: context.sessionId,
    timestamp: new Date().toISOString(),
    worktreePath: context.worktreePath
  });
  const sessionHead = await gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], {
    commandOptions,
    project
  });
  return {
    baseCommit: context.baseCommit,
    branch: context.branch,
    checkpointCommit: checkpoint.commit,
    checkpointTree: checkpoint.tree,
    mode: context.mode,
    operationId,
    sessionHead
  };
}

async function prepareSessionWorkSaveMessageDirect({
  commandOptions = {},
  connectedWorkSnapshots: suppliedConnectedSnapshots = [],
  derivedArtifactPaths = [],
  limit = 40,
  operationId = crypto.randomUUID(),
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Capturing work for Save",
    operationId
  });
  const checkpoint = await captureSessionWorkSaveCheckpoint(runCommand, context, {
    commandOptions,
    operationId,
    project
  });
  const changes = await inspectSessionChangesDirect({
    commandOptions,
    derivedArtifactPaths,
    includeInitialDiff: false,
    limit,
    project,
    runCommand,
    session,
    worktreeTree: checkpoint.checkpointTree
  });
  if (!changes.totalCount) {
    await assertConnectedSubmissionsIntegrated(runCommand, context, {
      commandOptions, connectedWorkSnapshots: connectedWorkSnapshots(suppliedConnectedSnapshots), project
    });
    throw saveError(
      "This session has no work to save.",
      "vibe64_session_save_no_changes"
    );
  }
  return {
    changes,
    checkpoint
  };
}

async function assertSessionWorkSaveCheckpoint(runCommand, context, checkpoint, {
  commandOptions = {},
  operationId,
  project = {}
} = {}) {
  const checkpointCommit = text(checkpoint?.checkpointCommit);
  const checkpointTree = text(checkpoint?.checkpointTree);
  if (
    !checkpointCommit ||
    !checkpointTree ||
    text(checkpoint?.operationId) !== text(operationId) ||
    text(checkpoint?.baseCommit) !== context.baseCommit ||
    text(checkpoint?.branch) !== context.branch ||
    text(checkpoint?.mode) !== context.mode
  ) {
    throw saveError(
      "Save cannot verify the captured worktree. Capture and name the work again.",
      "vibe64_session_save_checkpoint_invalid"
    );
  }
  const recordedTree = await commitTree(runCommand, context, checkpointCommit, {
    commandOptions,
    project
  });
  if (recordedTree !== checkpointTree) {
    throw saveError(
      "Save cannot verify the captured worktree. Capture and name the work again.",
      "vibe64_session_save_checkpoint_invalid"
    );
  }
  const checkpointSessionHead = text(checkpoint?.sessionHead);
  const currentSessionHead = checkpointSessionHead
    ? await gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], {
        commandOptions,
        project
      })
    : "";
  if (checkpointSessionHead && currentSessionHead !== checkpointSessionHead) {
    throw saveError(
      "The session history changed while Vibe64 was naming this work. Save was not started; try again.",
      "vibe64_session_save_message_stale"
    );
  }
  return checkpoint;
}

async function prepareSessionWorkSave(runCommand, context, {
  checkpoint = {},
  commandOptions = {},
  connectedWorkSnapshots = [],
  derivedArtifactPaths = [],
  message = "",
  operationId,
  project = {},
  refreshDerivedArtifacts = null
} = {}) {
  const checkpointTree = text(checkpoint.checkpointTree);
  const [canonical, sessionHead] = await Promise.all([
    readCanonical(runCommand, context, operationId, { commandOptions, project }),
    gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], {
      commandOptions,
      project
    })
  ]);
  const canonicalCommit = canonical.commit;
  if (await savedHistoryRewritten(runCommand, context, canonicalCommit, sessionHead, { commandOptions, project })) {
    throw saveError(
      "Canonical history no longer descends from this session's saved base.",
      "vibe64_session_save_history_diverged"
    );
  }
  const canonicalInSession = await commitIsAncestor(
    runCommand,
    context,
    canonicalCommit,
    sessionHead,
    { commandOptions, project }
  );
  if (canonicalCommit !== context.baseCommit && !canonicalInSession) {
    throw saveError(
      "The saved branch has changed. Update this session before saving its work.",
      "vibe64_session_save_update_required",
      {
        canonicalCommit,
        reconciledCommit: context.baseCommit,
        updateRequired: true
      }
    );
  }
  const comparison = await sessionWorkComparison(runCommand, context, {
    baseCommit: context.baseCommit,
    canonicalCommit,
    sessionHead,
    worktreeTree: checkpointTree
  }, { commandOptions, project });
  const derivedPathSet = new Set(normalizedDerivedArtifactPaths(derivedArtifactPaths));
  const changedPaths = comparison.changedPaths.filter((filePath) => !derivedPathSet.has(filePath));
  if (!changedPaths.length) {
    await assertConnectedSubmissionsIntegrated(runCommand, context, { commandOptions, connectedWorkSnapshots, project });
    throw saveError(
      "This session has no work to save.",
      "vibe64_session_save_no_changes"
    );
  }
  const sourceTree = await treeWithDerivedArtifactsFromCommit(runCommand, context, {
    commandOptions,
    derivedArtifactPaths,
    project,
    sourceCommit: canonicalCommit,
    tree: checkpointTree
  });
  const mergedTree = await regenerateDerivedArtifactTree(runCommand, context, {
    baseCommit: canonicalCommit,
    commandOptions,
    derivedArtifactPaths,
    project,
    refreshDerivedArtifacts,
    tree: sourceTree
  });
  const saveCommit = await createSaveCommit(runCommand, context, {
    canonicalCommit,
    commandOptions,
    mergedTree,
    message,
    project
  });
  const preparedRef = await rememberPreparedSaveCommit(
    runCommand,
    context,
    operationId,
    saveCommit,
    { commandOptions, project }
  );
  // The commit carries the identity the command env resolved; say so when it
  // was the stand-in, so the person can give Git their own name.
  const authorEmail = await gitOutput(runCommand, context, ["show", "-s", "--format=%ae", saveCommit], {
    commandOptions,
    project
  });
  return {
    canonicalCommit,
    changeBaseCommit: comparison.changeBaseCommit,
    changedPaths,
    contributionAuthority: canonical.contribution,
    mergedTree,
    preparedRef,
    saveCommit,
    standInIdentity: isFallbackGitIdentityEmail(authorEmail)
  };
}

async function publishPreparedSessionWorkSave(runCommand, context, {
  commandOptions = {},
  connectedWorkSnapshots = [],
  onPublicationAttempt,
  prepared = {},
  project = {}
} = {}) {
  return publishSaveCommit(
    runCommand,
    context,
    {
      canonicalCommit: text(prepared.canonicalCommit),
      contributionAuthority: prepared.contributionAuthority,
      saveCommit: text(prepared.saveCommit)
    },
    { commandOptions, connectedWorkSnapshots, onPublicationAttempt, project }
  );
}

function completedSessionWorkSave(context, checkpoint, prepared, verifiedCommit, finalized) {
  return {
    baseCommit: context.baseCommit,
    cacheMaintenance: finalized.cacheMaintenance,
    canonicalCommit: prepared.canonicalCommit,
    changeBaseCommit: prepared.changeBaseCommit,
    changedPaths: prepared.changedPaths,
    checkpointCommit: checkpoint.checkpointCommit,
    checkpointTree: checkpoint.checkpointTree,
    mergedTree: prepared.mergedTree,
    mode: context.mode,
    ok: true,
    operationId: checkpoint.operationId,
    preparedRef: prepared.preparedRef,
    saveCommit: prepared.saveCommit,
    sessionHead: checkpoint.sessionHead,
    standInIdentity: prepared.standInIdentity === true,
    status: finalized.status,
    verifiedCommit,
    ...finalized
  };
}

function deferredCacheMaintenance(context, verifiedCommit) {
  if (context.mode !== PROJECT_REPOSITORY_MODE_GITHUB) {
    return {
      attempted: false,
      kind: "none",
      retryable: false,
      status: "not_applicable"
    };
  }
  return {
    attempted: false,
    branch: context.branch,
    kind: "github_mirror",
    retryable: false,
    status: "deferred",
    verifiedCommit
  };
}

function failedCacheMaintenance(context, verifiedCommit, error) {
  return retryableMirrorMaintenance(context, verifiedCommit,
    text(error?.code) || "vibe64_session_save_github_mirror_refresh_failed", "refresh_interrupted", false);
}

async function refreshSessionWorkSaveCacheDirect({
  commandOptions = {},
  operationId = "",
  project = {},
  runCommand = runVibe64Command,
  session = {},
  verifiedCommit = ""
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Maintaining saved repository cache",
    operationId
  });
  return refreshVerifiedGithubMirror(
    runCommand,
    context,
    text(verifiedCommit),
    { commandOptions, project }
  );
}

async function deletePreparedSaveRef(runCommand, context, operationId, options = {}) {
  if (text(operationId)) {
    await deleteOperationRef(
      runCommand,
      context,
      preparedSaveRef(context, operationId),
      options
    );
  }
}

// Called once the caller has durably recorded a completed or recovered Save.
// Its prepared ref is then no longer recovery evidence. Left behind, it would
// pin its commit and make a later absent contribution branch look like a lost
// publication.
async function retireSessionWorkSave({
  commandOptions = {},
  operationId = "",
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Retiring a recorded Save",
    operationId: text(operationId) || crypto.randomUUID()
  });
  await deletePreparedSaveRef(runCommand, context, operationId, { commandOptions, project });
}

async function saveSessionWorkDirect({
  checkpoint: suppliedCheckpoint = null,
  commandOptions = {},
  connectedWorkSnapshots: suppliedConnectedSnapshots = [],
  deferCacheMaintenance = false,
  derivedArtifactPaths = [],
  message = "",
  operationId = crypto.randomUUID(),
  project = {},
  refreshDerivedArtifacts = null,
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  onProgress = async () => null,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const snapshots = connectedWorkSnapshots(suppliedConnectedSnapshots);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Saving session work",
    operationId
  });
  await onProgress({
    kind: "lock",
    message: "Waiting for exclusive repository access.",
    stage: "repository-lock"
  });
  return runProjectSourceExclusive(async () => {
    await onProgress({
      baseCommit: context.baseCommit,
      branch: context.branch,
      kind: "checkpoint",
      message: "Capturing the complete session worktree.",
      mode: context.mode,
      operationId,
      stage: "checkpointing"
    });
    let checkpoint;
    if (suppliedCheckpoint) {
      await assertBranch(runCommand, context, { commandOptions, project });
      checkpoint = await assertSessionWorkSaveCheckpoint(runCommand, context, suppliedCheckpoint, {
        commandOptions,
        operationId,
        project
      });
    } else {
      checkpoint = await captureSessionWorkSaveCheckpoint(runCommand, context, {
        commandOptions,
        operationId,
        project
      });
    }
    await onProgress({
      checkpointCommit: checkpoint.checkpointCommit,
      checkpointTree: checkpoint.checkpointTree,
      kind: "checkpoint",
      message: "Session checkpoint captured.",
      stage: "checkpointed"
    });
    await onProgress({ kind: "canonical", message: "Reading the current canonical branch.", stage: "canonical-reading" });
    const prepared = await prepareSessionWorkSave(runCommand, context, {
      checkpoint,
      commandOptions,
      connectedWorkSnapshots: snapshots,
      derivedArtifactPaths,
      message,
      operationId,
      project,
      refreshDerivedArtifacts
    });
    let publicationAttempted = false;
    let verifiedCommit;
    try {
      await onProgress({
        expectedCanonicalCommit: prepared.canonicalCommit,
        kind: "canonical",
        message: "Canonical branch read.",
        stage: "canonical-read"
      });
      await onProgress({
        expectedCanonicalCommit: prepared.canonicalCommit,
        kind: "publish",
        mergedTree: prepared.mergedTree,
        message: "Save commit prepared.",
        proposedCommit: prepared.saveCommit,
        stage: "prepared"
      });
      await onProgress({ kind: "publish", message: "Pushing the Save commit.", stage: "publishing" });
      verifiedCommit = await publishPreparedSessionWorkSave(runCommand, context, {
        commandOptions,
        connectedWorkSnapshots: snapshots,
        onPublicationAttempt() { publicationAttempted = true; },
        prepared,
        project
      });
    } catch (error) {
      if (!publicationAttempted) {
        // No publication command ran. Retire only this prepared proposal;
        // leaving it behind would make a first contribution's absent ref look
        // like a lost publication forever. The source checkpoint remains.
        await git(runCommand, context, ["update-ref", "-d", prepared.preparedRef, prepared.saveCommit], {
          commandOptions, project
        });
      }
      throw error;
    }
    await onProgress({
      kind: "publish",
      message: "Canonical Save commit verified.",
      stage: "published",
      verifiedCommit
    });
    await onProgress({ kind: "reconcile", message: "Reconciling the session onto the saved commit.", stage: "reconciling" });
    const reconciliation = await reconcileSession(runCommand, context, {
      checkpointCommit: checkpoint.checkpointCommit,
      checkpointTree: checkpoint.checkpointTree,
      commandOptions,
      project,
      saveCommit: prepared.saveCommit,
      sessionHead: checkpoint.sessionHead
    });
    const cacheMaintenance = deferCacheMaintenance
      ? deferredCacheMaintenance(context, verifiedCommit)
      : await refreshSessionWorkSaveCacheDirect({
          commandOptions,
          operationId,
          project,
          runCommand,
          session,
          verifiedCommit
        });
    if (cacheMaintenance.retryable === true) {
      await onProgress({
        cacheMaintenance,
        kind: "cache-warning",
        message: cacheMaintenance.message,
        stage: "cache-maintenance-warning"
      });
    }
    // A deferred Save is finished by its caller: the prepared ref stays as
    // recovery evidence until the caller has recorded this result, and then
    // retireSessionWorkSave removes it.
    if (!deferCacheMaintenance) {
      await deletePreparedSaveRef(runCommand, context, operationId, {
        commandOptions,
        project
      });
    }
    return completedSessionWorkSave(
      context,
      checkpoint,
      prepared,
      verifiedCommit,
      { cacheMaintenance, ...reconciliation }
    );
  }, {
    operation: `save-session:${context.sessionId}`
  });
}

async function prepareSessionWorkSaveMessage({
  commandOptions = {},
  connectedWorkSnapshots: suppliedConnectedSnapshots = [],
  derivedArtifactPaths = [],
  limit = 40,
  operationId = crypto.randomUUID(),
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  return runSessionWorkOperation({
    commandOptions,
    context,
    input: { connectedWorkSnapshots: connectedWorkSnapshots(suppliedConnectedSnapshots), derivedArtifactPaths, limit },
    label: "Capturing work for Save",
    operation: "save-message",
    operationId,
    project,
    runCommand
  });
}

async function saveSessionWork({
  checkpoint = {},
  commandOptions = {},
  derivedArtifactPaths = [],
  message = "",
  onCacheMaintenance = async () => null,
  operationId = crypto.randomUUID(),
  project = {},
  readConnectedWorkSnapshots = async () => [],
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  onProgress = async () => null,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const saved = await runProjectSourceExclusive(async () => {
    await onProgress({
      checkpointCommit: text(checkpoint.checkpointCommit),
      checkpointTree: text(checkpoint.checkpointTree),
      kind: "publish",
      message: "Sending your changes.",
      operationId,
      sessionHead: text(checkpoint.sessionHead),
      stage: "publishing"
    });
    const snapshots = connectedWorkSnapshots(await readConnectedWorkSnapshots());
    return runSessionWorkOperation({
      additionalAllowedRoots: snapshots.map(snapshot => snapshot.worktreePath),
      commandOptions,
      context,
      input: {
        checkpoint,
        connectedWorkSnapshots: snapshots,
        derivedArtifactPaths,
        message
      },
      label: "Saving session work",
      operation: "save",
      operationId,
      project,
      runCommand
    });
  }, {
    operation: `save-session:${context.sessionId}`
  });
  if (context.mode === PROJECT_REPOSITORY_MODE_GITHUB) {
    queueMicrotask(() => {
      void runSessionWorkOperation({
        commandOptions,
        context,
        input: {
          operationId,
          verifiedCommit: saved.verifiedCommit
        },
        label: "Maintaining saved repository cache",
        operation: "save-maintenance",
        operationId,
        project,
        runCommand
      }).then(onCacheMaintenance).catch((error) => (
        onCacheMaintenance(failedCacheMaintenance(context, saved.verifiedCommit, error))
      )).catch(() => {});
    });
  }
  return saved;
}

export {
  inspectSessionChangeDiff,
  inspectSessionChangeDiffDirect,
  inspectSessionChanges,
  inspectSessionChangesDirect,
  inspectSessionWork,
  inspectSessionWorkDirect,
  prepareSessionPullRequestBranch,
  prepareSessionWorkSaveMessage,
  prepareSessionWorkSaveMessageDirect,
  recoverSessionWorkSave,
  refreshSessionWorkSaveCacheDirect,
  retireSessionWorkSave,
  saveSessionWork,
  saveSessionWorkDirect
};
