// Inspects a session update that stopped part way and recovers the session's work from it.

import crypto from "node:crypto";
import { runVibe64Command, writeGitWorktreeTree } from "@local/vibe64-execution/server";
import {
  commandProject,
  git,
  gitOutput,
  rememberCanonicalCommit,
  repositoryContext,
  runSessionWorkOperation,
  saveError,
  scopedSessionWorkCommand
} from "./sessionWorkGit.js";
import { trimmedText } from "./trimmedText.js";

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
    operationId: trimmedText(recovery.operationId) || crypto.randomUUID()
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
  if (required.some((key) => !trimmedText(recovery[key]))) {
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
  inspectSessionUpdateFailure,
  recoverSessionWorkUpdate
};
