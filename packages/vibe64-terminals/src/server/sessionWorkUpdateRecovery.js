// Inspects a session update that stopped part way and recovers the session's work from it.

import crypto from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { runVibe64Command, writeGitWorktreeTree } from "@local/vibe64-execution/server";
import {
  commandProject,
  commitIsAncestor,
  git,
  gitOutput,
  isGitObjectId,
  observedCanonicalCommit,
  rememberCanonicalCommit,
  repositoryContext,
  runSessionWorkOperation,
  savedHistoryRewritten,
  saveError,
  scopedSessionWorkCommand
} from "./sessionWorkGit.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { doNothing } from "@local/vibe64-core/shared/doNothing";

async function inspectSessionUpdateFailure({
  commandOptions = {},
  project = {},
  runCommand = runVibe64Command,
  session = {},
  targetCommit = ""
} = {}) {
  return runSessionWorkOperation({
    commandOptions,
    context: repositoryContext(session, project),
    input: { targetCommit },
    label: "Checking a failed session update",
    operation: "update-failure",
    project,
    runCommand
  });
}

async function recoverSessionWorkUpdate({
  beforeSourceChange = doNothing,
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
    operationId: normalizeText(recovery.operationId) || crypto.randomUUID()
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
  if (required.some((key) => !normalizeText(recovery[key]))) {
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
        "vibe64_session_update_recovery_unreproducible"
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

// Git operations that leave a checkout part-way through a change, by the
// marker each keeps in the Git directory only while it is unfinished, as
// `git status` reads them. REBASE_HEAD is not one: Git can leave it behind
// after a rebase completes.
const UNFINISHED_GIT_OPERATIONS = [
  ["merge", "MERGE_HEAD"],
  ["cherry-pick", "CHERRY_PICK_HEAD"],
  ["revert", "REVERT_HEAD"],
  ["rebase", "rebase-merge"],
  ["rebase", "rebase-apply"],
  ["cherry-pick or revert", "sequencer"]
];

/**
 * What the session's checkout says about a failed Update, whoever changed it
 * since (an assistant or a person using Git directly): whether HEAD contains
 * the saved version the Update was trying to reach (`targetCommit`, from its
 * conflict recovery), whether Update still has anything to apply (the check's
 * own rule), and whether a Git operation is unfinished or any file is
 * conflicted. It only reads.
 */
async function inspectSessionUpdateFailureDirect({
  commandOptions = {},
  project = {},
  runCommand = runVibe64Command,
  session = {},
  targetCommit = ""
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Checking a failed session update"
  });
  const options = { commandOptions, project };
  const [sessionHead, canonicalCommit, markerPaths, unmerged] = await Promise.all([
    gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], options),
    observedCanonicalCommit(runCommand, context, options),
    gitOutput(runCommand, context, [
      "rev-parse",
      ...UNFINISHED_GIT_OPERATIONS.flatMap(([, marker]) => ["--git-path", marker])
    ], options),
    gitOutput(runCommand, context, ["ls-files", "--unmerged", "-z"], options)
  ]);
  const target = normalizeText(targetCommit);
  const [canonicalInSession, historyRewritten, targetInHead] = await Promise.all([
    commitIsAncestor(runCommand, context, canonicalCommit, sessionHead, options),
    savedHistoryRewritten(runCommand, context, canonicalCommit, sessionHead, options),
    isGitObjectId(target) ? commitIsAncestor(runCommand, context, target, sessionHead, options) : false
  ]);
  const markers = markerPaths.split("\n");
  // Only a marker proven absent counts as finished; one that cannot be read
  // keeps the failure.
  const present = await Promise.all(UNFINISHED_GIT_OPERATIONS.map((_, index) => (
    !markers[index] || access(path.resolve(context.worktreePath, markers[index])).then(
      () => true,
      (error) => error?.code !== "ENOENT"
    )
  )));
  const unfinished = UNFINISHED_GIT_OPERATIONS.find((_, index) => present[index]);
  return {
    canonicalCommit,
    gitOperation: unfinished?.[0] || "",
    sessionHead,
    targetInHead,
    unmergedPaths: [...new Set(unmerged.split("\0").filter(Boolean)
      .map((entry) => entry.slice(entry.indexOf("\t") + 1)))].sort(),
    updateNeeded: historyRewritten || !canonicalInSession
  };
}

export {
  inspectSessionUpdateFailureDirect,
  inspectSessionUpdateFailure,
  recoverSessionWorkUpdate
};
