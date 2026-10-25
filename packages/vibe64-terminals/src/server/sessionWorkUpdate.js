// Update: check, checkpoint, prepare, regenerate, apply and recover a session
// update from its canonical branch.
import crypto from "node:crypto";
import { PROJECT_REPOSITORY_MODE_LOCAL_SOURCE } from "@local/vibe64-core/server/projectRepository";
import { repositoryUpdateRelationship, repositoryUpdateStrategy } from "@local/vibe64-core/shared";
import {
  createGitTurnCheckpoint,
  runVibe64Command,
  writeGitWorktreeTree
} from "@local/vibe64-execution/server";
import { GIT_HISTORY_RECORD_FORMAT, parseGitHistoryRecords } from "./gitRecords.js";
import {
  assertBranch,
  changedPathsBetween,
  commandProject,
  commitIsAncestor,
  commitTree,
  conflictWorktreeTree,
  countCommitsBetween,
  createVirtualCommit,
  git,
  gitOutput,
  mergeTrees,
  normalizedDerivedArtifactPaths,
  regenerateDerivedArtifactTree,
  rememberCanonicalCommit,
  repositoryContext,
  runSessionWorkOperation,
  SAVE_TIMEOUT_MS,
  savedHistoryRewritten,
  saveError,
  scopedSessionWorkCommand,
  sessionWorkComparison,
  text,
  treeWithDerivedArtifactsFromCommit
} from "./sessionWorkGit.js";
import {
  readCanonical
} from "./sessionWorkAuthority.js";

const INCOMING_VERSION_LIMIT = 5;

async function incomingVersionsBetween(
  runCommand,
  context,
  fromCommit,
  toCommit,
  options = {}
) {
  const result = await git(runCommand, context, [
    "log",
    "--topo-order",
    `--max-count=${INCOMING_VERSION_LIMIT + 1}`,
    "-z",
    `--format=${GIT_HISTORY_RECORD_FORMAT}`,
    `${fromCommit}..${toCommit}`
  ], options);
  const records = parseGitHistoryRecords(String(result.stdout || result.output || ""));
  return {
    incomingVersions: records.slice(0, INCOMING_VERSION_LIMIT),
    incomingVersionsTruncated: records.length > INCOMING_VERSION_LIMIT
  };
}

function normalizedConflictRecovery(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const conflictPaths = Array.isArray(value.conflictPaths)
    ? [...new Set(value.conflictPaths.map(String).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right))
    : [];
  const recovery = {
    baseCommit: text(value.baseCommit),
    canonicalCommit: text(value.canonicalCommit),
    checkpointTree: text(value.checkpointTree),
    conflictPaths,
    conflictTree: text(value.conflictTree),
    reviewId: text(value.reviewId),
    oldHead: text(value.oldHead),
    oldIndexTree: text(value.oldIndexTree)
  };
  return Object.values(recovery).some((entry) => Array.isArray(entry) ? entry.length === 0 : !entry)
    ? null
    : recovery;
}

function conflictMessage(conflictPaths = []) {
  const count = conflictPaths.length;
  const files = conflictPaths.slice(0, 3).join(", ");
  const suffix = count > 3 ? ` and ${count - 3} more` : "";
  return `${count} ${count === 1 ? "file needs" : "files need"} review before this session can update: ${files}${suffix}. Resolve ${count === 1 ? "it" : "them"} manually or with AI, then use Review resolved conflicts to apply Update. Fix it with AI can help with the repair.`;
}

function conflictRecoveryError(recovery) {
  return saveError(
    conflictMessage(recovery.conflictPaths),
    "vibe64_session_update_conflict",
    {
      conflictPaths: recovery.conflictPaths,
      conflictRecovery: recovery
    }
  );
}

async function resolvedConflictTree(runCommand, context, {
  currentRecovery,
  previousRecovery,
  reviewedConflictId,
  project
}) {
  const previous = reviewedConflictId ? normalizedConflictRecovery(previousRecovery) : null;
  if (!previous) {
    throw conflictRecoveryError(currentRecovery);
  }
  const originalConflictPaths = new Set(previous.conflictPaths);
  const stable = [
    "baseCommit",
    "canonicalCommit",
    "oldHead",
    "oldIndexTree"
  ].every((key) => previous[key] === currentRecovery[key]) &&
    currentRecovery.conflictPaths.every((entry) => originalConflictPaths.has(entry));
  if (!stable || reviewedConflictId !== previous.reviewId) {
    throw conflictRecoveryError(currentRecovery);
  }
  return conflictWorktreeTree(runCommand, context, { ...currentRecovery, project });
}

async function checkSessionUpdatesDirect({
  commandOptions = {},
  operationId = crypto.randomUUID(),
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Checking repository for updates",
    operationId
  });
  await assertBranch(runCommand, context, { commandOptions, project });
  const canonical = await readCanonical(runCommand, context, operationId, { commandOptions, project });
  const canonicalCommit = canonical.commit;
  const [sessionHead, worktreeTree] = await Promise.all([
    gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], {
      commandOptions,
      project
    }),
    writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    })
  ]);
  const historyRewritten = await savedHistoryRewritten(runCommand, context, canonicalCommit, sessionHead, {
    commandOptions,
    project
  });
  if (historyRewritten && context.mode !== PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    throw saveError(
      "The saved project history no longer descends from this session's starting version.",
      "vibe64_session_update_history_diverged"
    );
  }
  const historyReview = historyRewritten ? {
    baseCommit: context.baseCommit, canonicalCommit, sessionHead, worktreeTree,
    changedPaths: (await changedPathsBetween(runCommand, context, context.baseCommit, worktreeTree,
      { commandOptions, project })).slice(0, 100)
  } : null;
  const [ahead, behind, canonicalInSession, canonicalTree] = await Promise.all([
    countCommitsBetween(runCommand, context, canonicalCommit, sessionHead, {
      commandOptions,
      project
    }),
    countCommitsBetween(runCommand, context, sessionHead, canonicalCommit, {
      commandOptions,
      project
    }),
    commitIsAncestor(runCommand, context, canonicalCommit, sessionHead, {
      commandOptions,
      project
    }),
    commitTree(runCommand, context, canonicalCommit, { commandOptions, project })
  ]);
  const relationship = repositoryUpdateRelationship(ahead, behind);
  const incoming = behind > 0
    ? await incomingVersionsBetween(runCommand, context, sessionHead, canonicalCommit, {
        commandOptions,
        project
      })
    : { incomingVersions: [], incomingVersionsTruncated: false };
  return {
    ahead,
    baseCommit: context.baseCommit,
    behind,
    canonicalCommit,
    canonicalSource: {
      authority: context.mode,
      commit: canonicalCommit,
      ref: `refs/heads/${canonical.canonicalBranch || context.branch}`,
      ...(context.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
        ? {}
        : { repository: context.remoteUrl })
    },
    ...incoming,
    ok: true,
    operationId,
    reconciled: !historyRewritten && canonicalInSession,
    ...(historyReview ? { historyReview } : {}),
    repositoryMode: context.mode,
    relationship,
    sessionCurrent: canonicalInSession,
    sessionHead,
    sessionMatchesCanonical: worktreeTree === canonicalTree,
    updateAvailable: historyRewritten || !canonicalInSession,
    updateStrategy: repositoryUpdateStrategy(relationship)
  };
}

async function checkSessionUpdates({
  commandOptions = {},
  operationId = crypto.randomUUID(),
  project = {},
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  return runProjectSourceExclusive(() => runSessionWorkOperation({
    commandOptions,
    context,
    label: "Checking repository for updates",
    operation: "check-updates",
    operationId,
    project,
    runCommand
  }), {
    operation: `check-session-updates:${context.sessionId}`
  });
}

async function applySessionUpdate(runCommand, context, {
  canonicalCommit,
  checkpointCommit,
  checkpointTree,
  commandOptions,
  mergedCommit,
  mergedTree,
  oldHead,
  oldIndexTree,
  project
}) {
  const currentTree = await writeGitWorktreeTree({
    baseCommit: "HEAD",
    project: commandProject(context, project),
    runCommand,
    worktreePath: context.worktreePath
  });
  if (currentTree !== checkpointTree) {
    throw saveError(
      "This session changed while its update was being prepared. Retry when the assistant is idle.",
      "vibe64_session_update_worktree_changed"
    );
  }
  try {
    await git(runCommand, context, ["read-tree", "--reset", "-u", mergedCommit], {
      commandOptions,
      project
    });
    await git(runCommand, context, ["update-ref", "HEAD", canonicalCommit, oldHead], {
      commandOptions,
      project
    });
    await git(runCommand, context, ["read-tree", canonicalCommit], {
      commandOptions,
      project
    });
    const updatedTree = await writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    });
    if (updatedTree !== mergedTree) {
      throw saveError(
        "The updated session did not match the prepared merged work.",
        "vibe64_session_update_verification_failed"
      );
    }
    await rememberCanonicalCommit(runCommand, context, canonicalCommit, {
      commandOptions,
      project
    });
    return { currentTree: updatedTree, reconciled: true, status: "updated" };
  } catch (error) {
    const currentHead = await gitOutput(runCommand, context, ["rev-parse", "HEAD"], {
      commandOptions,
      project
    }).catch(() => "");
    await git(runCommand, context, ["read-tree", "--reset", "-u", checkpointCommit], {
      commandOptions,
      project,
      required: false
    });
    if (currentHead && currentHead !== oldHead) {
      await git(runCommand, context, ["update-ref", "HEAD", oldHead, currentHead], {
        commandOptions,
        project,
        required: false
      });
    }
    await git(runCommand, context, ["read-tree", oldIndexTree], {
      commandOptions,
      project,
      required: false
    });
    throw error;
  }
}

async function captureSessionWorkUpdateCheckpointDirect({
  commandOptions = {}, operationId, project = {}, runCommand = runVibe64Command, session = {}
} = {}) {
  const context = repositoryContext(session, project);
  await assertBranch(runCommand, context, { commandOptions, project });
  const checkpoint = await createGitTurnCheckpoint({
    outerTurnId: `update:${operationId}`,
    outcome: "completed",
    project: commandProject(context, project),
    runCommand,
    sessionId: context.sessionId,
    timestamp: new Date().toISOString(),
    worktreePath: context.worktreePath
  });
  const [oldHead, oldIndexTree] = await Promise.all([
    gitOutput(runCommand, context, ["rev-parse", "HEAD"], { commandOptions, project }),
    gitOutput(runCommand, context, ["write-tree"], { commandOptions, project })
  ]);
  return { checkpointCommit: checkpoint.commit, checkpointTree: checkpoint.tree, oldHead, oldIndexTree };
}

async function prepareSessionWorkUpdateDirect({
  checkpoint = {}, commandOptions = {}, conflictRecovery = null, derivedArtifactPaths = [],
  historyReview = null, operationId, project = {}, reviewedConflictId = "",
  runCommand = runVibe64Command, session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const { checkpointCommit, checkpointTree, oldHead, oldIndexTree } = checkpoint;
  const { commit: canonicalCommit } = await readCanonical(runCommand, context, operationId, { commandOptions, project });
  const historyRewritten = await savedHistoryRewritten(runCommand, context, canonicalCommit, oldHead, {
    commandOptions,
    project
  });
  if (historyRewritten || historyReview) {
    if (context.mode !== PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
      throw saveError("The saved project history no longer descends from this session's starting version.",
        "vibe64_session_update_history_diverged");
    }
    const expected = { baseCommit: context.baseCommit, canonicalCommit, sessionHead: oldHead, worktreeTree: checkpointTree };
    const reviewedRepair = reviewedConflictId && conflictRecovery?.reviewId === reviewedConflictId &&
      conflictRecovery.baseCommit === context.baseCommit && conflictRecovery.canonicalCommit === canonicalCommit &&
      conflictRecovery.oldHead === oldHead && conflictRecovery.oldIndexTree === oldIndexTree;
    if (!reviewedRepair && (!historyReview || Object.entries(expected).some(([key, value]) => historyReview[key] !== value))) {
      throw saveError("The project history was rewritten. Open Repository, check for updates, then review and reconcile this session.",
        "vibe64_session_history_review_required");
    }
  }
  const comparison = await sessionWorkComparison(runCommand, context, {
    baseCommit: context.baseCommit,
    canonicalCommit,
    sessionHead: oldHead,
    worktreeTree: checkpointTree,
    reconcileHistory: historyRewritten
  }, { commandOptions, project });
  const derivedPathSet = new Set(normalizedDerivedArtifactPaths(derivedArtifactPaths));
  const authoredChangedPaths = comparison.changedPaths
    .filter((filePath) => !derivedPathSet.has(filePath));
  const canonicalInSession = await commitIsAncestor(
    runCommand,
    context,
    canonicalCommit,
    oldHead,
    { commandOptions, project }
  );
  if (canonicalInSession && !historyRewritten) {
    return {
      baseCommit: context.baseCommit,
      canonicalCommit,
      canonicalTree: comparison.canonicalTree,
      changeBaseCommit: comparison.changeBaseCommit,
      checkpointCommit,
      checkpointTree,
      currentTree: checkpointTree,
      ok: true,
      operationId,
      mode: context.mode,
      reconciled: true,
      repositoryMode: context.mode,
      sessionCurrent: canonicalInSession,
      sessionMatchesCanonical: comparison.sessionMatchesCanonical,
      status: "already_current"
    };
  }

  let mergedSourceTree = comparison.canonicalTree;
  if (authoredChangedPaths.length) {
    const checkpointTreeForMerge = await treeWithDerivedArtifactsFromCommit(runCommand, context, {
      commandOptions,
      derivedArtifactPaths,
      project,
      sourceCommit: canonicalCommit,
      tree: checkpointTree
    });
    const mergeResult = await mergeTrees(runCommand, context, {
      baseCommit: comparison.changeBaseCommit,
      explicitBase: historyRewritten,
      canonicalCommit,
      checkpointTree: checkpointTreeForMerge,
      commandOptions,
      project
    });
    const currentRecovery = mergeResult.conflictPaths.length > 0
      ? {
          baseCommit: comparison.changeBaseCommit,
          canonicalCommit,
          checkpointTree,
          conflictPaths: mergeResult.conflictPaths,
          conflictTree: mergeResult.conflictTree,
          oldHead,
          oldIndexTree,
          reviewId: crypto.randomUUID()
        }
      : null;
    mergedSourceTree = currentRecovery
      ? await resolvedConflictTree(runCommand, context, {
          currentRecovery,
          previousRecovery: conflictRecovery,
          reviewedConflictId,
          project
        })
      : mergeResult.mergedTree;
  }
  return {
    ...checkpoint,
    baseCommit: context.baseCommit,
    canonicalCommit,
    canonicalTree: comparison.canonicalTree,
    changeBaseCommit: comparison.changeBaseCommit,
    mergedSourceTree,
    mode: context.mode,
    operationId,
    repositoryMode: context.mode,
    sessionCurrent: true,
    ...(!authoredChangedPaths.length ? { sessionMatchesCanonical: true } : {}),
    status: "prepared"
  };
}

async function regenerateSessionWorkUpdateDirect({
  commandOptions = {}, derivedArtifactPaths = [], prepared = {}, project = {},
  refreshDerivedArtifacts = null, runCommand = runVibe64Command, session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const mergedTree = await regenerateDerivedArtifactTree(runCommand, context, {
    baseCommit: prepared.canonicalCommit,
    commandOptions, derivedArtifactPaths, project, refreshDerivedArtifacts,
    tree: prepared.mergedSourceTree
  });
  const mergedCommit = mergedTree === prepared.canonicalTree
    ? prepared.canonicalCommit
    : await createVirtualCommit(runCommand, context, {
        baseCommit: prepared.canonicalCommit, commandOptions,
        message: "Vibe64 session update result", project, tree: mergedTree
      });
  return { ...prepared, mergedCommit, mergedTree };
}

async function applySessionWorkUpdateDirect({
  commandOptions = {}, prepared = {}, project = {}, runCommand = runVibe64Command, session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const reconciliation = await applySessionUpdate(runCommand, context, {
    ...prepared, commandOptions, project
  });
  return { ...prepared, ok: true, ...reconciliation };
}

async function runSessionUpdateStages({
  beforeSourceChange = async () => {}, derivedArtifactPaths = [], onProgress = async () => null,
  operationId = crypto.randomUUID(), project = {}, runProjectSourceExclusive = async (operation) => operation(),
  session = {}, ...input
}, runStage) {
  const context = repositoryContext(session, project);
  const stage = (operation, values = {}) => runStage(operation, {
    ...input, derivedArtifactPaths, operationId, project, session, ...values
  });
  await onProgress({ kind: "lock", message: "Waiting for exclusive repository access.", stage: "repository-lock" });
  return runProjectSourceExclusive(async () => {
    await onProgress({ kind: "checkpoint", message: "Capturing this session's complete worktree.", stage: "checkpointing" });
    const checkpoint = await stage("update-checkpoint");
    await onProgress({ ...checkpoint, kind: "checkpoint", message: "Session checkpoint captured.", stage: "checkpointed" });
    await onProgress({ kind: "update", message: "Fetching the latest saved version and merging session changes.", stage: "merging" });
    let prepared = await stage("update-prepare", { checkpoint });
    if (prepared.status === "already_current") return prepared;
    await onProgress({ kind: "update", message: derivedArtifactPaths.length
      ? "Regenerating project diagrams from the merged source."
      : "Preparing the merged session worktree.", stage: "regenerating" });
    prepared = await stage("update-derived", { prepared });
    await onProgress({ ...prepared, kind: "update", message: "A conflict-free session update is ready.", stage: "prepared" });
    await onProgress({ kind: "update", message: "Applying and verifying the session update.", stage: "mutating" });
    await beforeSourceChange();
    return stage("update-apply", { prepared });
  }, { operation: `update-session:${context.sessionId}` });
}

const UPDATE_STAGE_IMPLEMENTATIONS = {
  "update-checkpoint": captureSessionWorkUpdateCheckpointDirect,
  "update-prepare": prepareSessionWorkUpdateDirect,
  "update-derived": regenerateSessionWorkUpdateDirect,
  "update-apply": applySessionWorkUpdateDirect
};

async function updateSessionWorkDirect(input = {}) {
  return runSessionUpdateStages(input, (operation, values) => UPDATE_STAGE_IMPLEMENTATIONS[operation](values));
}

async function updateSessionWork(input = {}) {
  const { commandOptions = {}, runCommand = runVibe64Command, ...options } = input;
  return runSessionUpdateStages(options, (operation, values) => {
    const { project, session, operationId, ...stageInput } = values;
    return runSessionWorkOperation({
      commandOptions,
      context: repositoryContext(session, project),
      input: stageInput,
      label: "Updating session from repository",
      operation,
      operationId,
      project,
      runCommand,
      timeout: operation === "update-derived" ? 10 * 60_000 : SAVE_TIMEOUT_MS
    });
  });
}

async function recoverSessionWorkUpdate({
  beforeSourceChange = async () => {},
  commandOptions = {},
  project = {},
  recovery = {},
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Recovering session update",
    operationId: text(recovery.operationId) || crypto.randomUUID()
  });
  const required = [
    "canonicalCommit",
    "checkpointCommit",
    "checkpointTree",
    "mergedCommit",
    "mergedTree",
    "oldHead",
    "oldIndexTree"
  ];
  if (required.some((key) => !text(recovery[key]))) {
    throw saveError(
      "The interrupted session update stopped before mutation and can be retried.",
      "vibe64_session_update_interrupted_retryable",
      { retryable: true }
    );
  }
  return runProjectSourceExclusive(async () => {
    const head = await gitOutput(runCommand, context, ["rev-parse", "HEAD"], {
      commandOptions,
      project
    });
    const tree = await writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    });
    const headIsOld = head === recovery.oldHead;
    const headIsCanonical = head === recovery.canonicalCommit;
    const treeIsCheckpoint = tree === recovery.checkpointTree;
    const treeIsMerged = tree === recovery.mergedTree;
    if ((!headIsOld && !headIsCanonical) || (!treeIsCheckpoint && !treeIsMerged)) {
      throw saveError(
        "The interrupted session update cannot be recovered automatically because the worktree changed.",
        "vibe64_session_update_recovery_changed"
      );
    }
    await beforeSourceChange();
    if (treeIsCheckpoint) {
      await git(runCommand, context, ["read-tree", "--reset", "-u", recovery.mergedCommit], {
        commandOptions,
        project
      });
    }
    if (headIsOld) {
      await git(runCommand, context, [
        "update-ref",
        "HEAD",
        recovery.canonicalCommit,
        recovery.oldHead
      ], {
        commandOptions,
        project
      });
    }
    await git(runCommand, context, ["read-tree", recovery.canonicalCommit], {
      commandOptions,
      project
    });
    const recoveredTree = await writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    });
    if (recoveredTree !== recovery.mergedTree) {
      throw saveError(
        "The interrupted session update could not reproduce its prepared worktree.",
        "vibe64_session_update_verification_failed"
      );
    }
    await rememberCanonicalCommit(runCommand, context, recovery.canonicalCommit, {
      commandOptions,
      project
    });
    return {
      ...recovery,
      currentTree: recoveredTree,
      ok: true,
      reconciled: true,
      recovered: true,
      status: "updated"
    };
  }, {
    operation: `recover-update-session:${context.sessionId}`
  });
}

export {
  applySessionWorkUpdateDirect,
  captureSessionWorkUpdateCheckpointDirect,
  checkSessionUpdates,
  checkSessionUpdatesDirect,
  prepareSessionWorkUpdateDirect,
  recoverSessionWorkUpdate,
  regenerateSessionWorkUpdateDirect,
  updateSessionWork,
  updateSessionWorkDirect
};
