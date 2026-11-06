// Update: check, checkpoint, prepare, regenerate and apply a session update from its canonical branch. Inspecting
// and recovering a failed update are in sessionWorkUpdateRecovery.js.
import crypto from "node:crypto";
import { PROJECT_REPOSITORY_MODE_LOCAL_SOURCE } from "@local/vibe64-core/server/projectRepository";
import { repositoryUpdateRelationship, repositoryUpdateStrategy } from "@local/vibe64-core/shared";
import {
  createGitTurnCheckpoint,
  executionCleanupRequired,
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
  treeWithDerivedArtifactsFromCommit
} from "./sessionWorkGit.js";
import {
  readAuthorityBranchHeads,
  readCanonical
} from "./sessionWorkAuthority.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { doNothing } from "@local/vibe64-core/shared/doNothing";

const INCOMING_VERSION_LIMIT = 5;
const UPDATE_CANCELLED_CODE = "vibe64_session_update_cancelled";

/**
 * Cancel stops Update until it starts changing the session's files: what ran before only read the
 * session and wrote Git objects, so a cancelled Update leaves the session as it was.
 * @param {AbortSignal | null} signal
 */
function throwIfUpdateCancelled(signal) {
  if (signal?.aborted) throw saveError("Update was cancelled before it changed this session.", UPDATE_CANCELLED_CODE);
}

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
    baseCommit: normalizeText(value.baseCommit),
    canonicalCommit: normalizeText(value.canonicalCommit),
    checkpointTree: normalizeText(value.checkpointTree),
    conflictPaths,
    conflictTree: normalizeText(value.conflictTree),
    reviewId: normalizeText(value.reviewId),
    oldHead: normalizeText(value.oldHead),
    oldIndexTree: normalizeText(value.oldIndexTree)
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
    baseCommit: context.baseCommit,
    canonicalCommit,
    sessionHead,
    worktreeTree,
    changedPaths: (await changedPathsBetween(
      runCommand,
      context,
      context.baseCommit,
      worktreeTree,
      { commandOptions, project }
    )).slice(0, 100)
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

// A head read that hangs fails well within the probe's 30 s cadence, so the
// probe reports it and retries inside the product's 60 s limit.
const AUTHORITY_HEAD_READ_TIMEOUT_MS = 20_000;

/**
 * The update probe's read, with one head read per authority repository
 * however many sessions share it, made as the first of those sessions whose
 * recorded Git actor can read it: an in-process ls-refs request to GitHub, or
 * `git ls-remote` for a managed or local authority. Each session gets its
 * canonical branch `head`, or `{ code, error }`. A session absent from
 * the result was not read: its authority has no recorded Git actor yet (a
 * person's first check of the session records one).
 */
async function readSessionAuthorityHeads({
  executionFor,
  project = {},
  sessions = []
} = {}) {
  const results = new Map();
  const authorities = new Map();
  for (const session of sessions) {
    let context;
    try {
      context = repositoryContext(session, project);
    } catch (error) {
      results.set(normalizeText(session.sessionId), { code: normalizeText(error?.code), error: normalizeText(error?.message) });
      continue;
    }
    const members = authorities.get(context.remoteUrl) || [];
    members.push({ context, session });
    authorities.set(context.remoteUrl, members);
  }
  for (const members of authorities.values()) {
    let execution = null;
    let executor = null;
    let refusal = null;
    for (const member of members) {
      const candidate = await executionFor(member.session);
      if (candidate?.ok !== false) {
        execution = candidate;
        executor = member;
        break;
      }
      if (candidate.code !== "vibe64_session_git_command_actor_missing") refusal ||= candidate;
    }
    let failure = refusal && { code: normalizeText(refusal.code), error: normalizeText(refusal.error) };
    if (execution) {
      try {
        const heads = await readAuthorityBranchHeads(
          scopedSessionWorkCommand(execution.runCommand, executor.context, project, {
            label: "Checking repository for updates"
          }),
          executor.context,
          members.map(({ context }) => context.branch),
          { commandOptions: { ...execution.commandOptions, timeout: AUTHORITY_HEAD_READ_TIMEOUT_MS }, project },
          execution.readRemoteHeads
        );
        for (const { context } of members) {
          const head = heads.get(context.branch);
          results.set(context.sessionId, head ? { head } : {
            code: "vibe64_session_update_branch_missing",
            error: `The ${context.branch} branch is no longer in the project's repository.`
          });
        }
        continue;
      } catch (error) {
        failure = {
          code: normalizeText(error?.code) || "vibe64_session_update_check_failed",
          error: normalizeText(error?.message) || "The project's repository could not be checked for updates."
        };
      }
    }
    if (failure) for (const { context } of members) results.set(context.sessionId, failure);
  }
  return results;
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
  commandOptions = {},
  operationId,
  project = {},
  runCommand = runVibe64Command,
  session = {}
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
  checkpoint = {},
  commandOptions = {},
  conflictRecovery = null,
  derivedArtifactPaths = [],
  historyReview = null,
  operationId,
  project = {},
  reviewedConflictId = "",
  runCommand = runVibe64Command,
  session = {}
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
      throw saveError(
        "The saved project history no longer descends from this session's starting version.",
        "vibe64_session_update_history_diverged"
      );
    }
    const expected = { baseCommit: context.baseCommit, canonicalCommit, sessionHead: oldHead, worktreeTree: checkpointTree };
    const reviewedRepair = reviewedConflictId && conflictRecovery?.reviewId === reviewedConflictId &&
      conflictRecovery.baseCommit === context.baseCommit && conflictRecovery.canonicalCommit === canonicalCommit &&
      conflictRecovery.oldHead === oldHead && conflictRecovery.oldIndexTree === oldIndexTree;
    if (!reviewedRepair && (!historyReview || Object.entries(expected).some(([key, value]) => historyReview[key] !== value))) {
      throw saveError(
        "The project history was rewritten. Open Repository, check for updates, then review and reconcile this session.",
        "vibe64_session_history_review_required"
      );
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
  commandOptions = {},
  derivedArtifactPaths = [],
  prepared = {},
  project = {},
  refreshDerivedArtifacts,
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const mergedTree = await regenerateDerivedArtifactTree(runCommand, context, {
    baseCommit: prepared.canonicalCommit,
    commandOptions,
    derivedArtifactPaths,
    project,
    refreshDerivedArtifacts,
    tree: prepared.mergedSourceTree
  });
  const mergedCommit = mergedTree === prepared.canonicalTree
    ? prepared.canonicalCommit
    : await createVirtualCommit(runCommand, context, {
      baseCommit: prepared.canonicalCommit,
      commandOptions,
      message: "Vibe64 session update result",
      project,
      tree: mergedTree
    });
  return { ...prepared, mergedCommit, mergedTree };
}

async function applySessionWorkUpdateDirect({
  commandOptions = {},
  prepared = {},
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const reconciliation = await applySessionUpdate(runCommand, context, {
    ...prepared,
    commandOptions,
    project
  });
  return { ...prepared, ok: true, ...reconciliation };
}

/**
 * Update's stages under the project's source lock. `signal` (an AI task's Cancel) stops a reading
 * stage's processes and every later stage; the apply stage, which changes the session's files,
 * always runs to its own end, rolling back what it could not finish.
 */
async function runSessionUpdateStages({
  beforeSourceChange = doNothing,
  derivedArtifactPaths = [],
  onProgress = doNothing,
  operationId = crypto.randomUUID(),
  project = {},
  runProjectSourceExclusive = async (operation) => operation(),
  session = {},
  signal = null,
  ...input
}, runStage) {
  const context = repositoryContext(session, project);
  const run = (operation, values = {}, stageSignal = null) => runStage(operation, {
    ...input,
    derivedArtifactPaths,
    operationId,
    project,
    session,
    signal: stageSignal,
    ...values
  });
  const stage = async (operation, values = {}) => {
    throwIfUpdateCancelled(signal);
    try {
      return await run(operation, values, signal);
    } catch (error) {
      // A stage whose processes could not be stopped keeps that failure: it names what is still running.
      if (signal?.aborted && !executionCleanupRequired(error)) throwIfUpdateCancelled(signal);
      throw error;
    }
  };
  await onProgress({ kind: "lock", message: "Waiting for exclusive repository access.", stage: "repository-lock" });
  return runProjectSourceExclusive(async () => {
    await onProgress({ kind: "checkpoint", message: "Capturing this session's complete worktree.", stage: "checkpointing" });
    const checkpoint = await stage("update-checkpoint");
    await onProgress({ ...checkpoint, kind: "checkpoint", message: "Session checkpoint captured.", stage: "checkpointed" });
    await onProgress({ kind: "update", message: "Fetching the latest saved version and merging session changes.", stage: "merging" });
    let prepared = await stage("update-prepare", { checkpoint });
    if (prepared.status === "already_current") return prepared;
    await onProgress({
      kind: "update",
      message: derivedArtifactPaths.length
        ? "Regenerating project diagrams from the merged source."
        : "Preparing the merged session worktree.",
      stage: "regenerating"
    });
    prepared = await stage("update-derived", { prepared });
    await onProgress({ ...prepared, kind: "update", message: "A conflict-free session update is ready.", stage: "prepared" });
    throwIfUpdateCancelled(signal);
    await onProgress({ kind: "update", message: "Applying and verifying the session update.", stage: "mutating" });
    await beforeSourceChange();
    return run("update-apply", { prepared });
  }, { operation: `update-session:${context.sessionId}` });
}

async function updateSessionWork(input = {}) {
  const { commandOptions = {}, runCommand = runVibe64Command, ...options } = input;
  return runSessionUpdateStages(options, (operation, values) => {
    const { project, session, operationId, signal, ...stageInput } = values;
    return runSessionWorkOperation({
      commandOptions: signal ? { ...commandOptions, signal } : commandOptions,
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

export {
  applySessionWorkUpdateDirect,
  captureSessionWorkUpdateCheckpointDirect,
  checkSessionUpdates,
  checkSessionUpdatesDirect,
  prepareSessionWorkUpdateDirect,
  readSessionAuthorityHeads,
  regenerateSessionWorkUpdateDirect,
  throwIfUpdateCancelled,
  updateSessionWork
};
