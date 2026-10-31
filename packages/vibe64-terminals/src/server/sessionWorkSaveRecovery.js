// Recovers a session's save that stopped part way, from its recorded checkpoint.

import crypto from "node:crypto";
import { PROJECT_REPOSITORY_MODE_GITHUB } from "@local/vibe64-core/server/projectRepository";
import { runVibe64Command } from "@local/vibe64-execution/server";
import {
  commitTree,
  optionalGitOutput,
  preparedSaveRef,
  repositoryContext,
  saveCheckpointRef,
  saveError,
  scopedSessionWorkCommand,
  text
} from "./sessionWorkGit.js";
import { readCanonical } from "./sessionWorkAuthority.js";
import { reconcileSession, refreshVerifiedGithubMirror } from "./sessionWorkPublication.js";

async function recoverSessionWorkSave({
  commandOptions = {},
  project = {},
  recovery = {},
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const operationId = text(recovery.operationId);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Recovering session save",
    operationId: operationId || crypto.randomUUID()
  });
  const preparedRef = operationId ? preparedSaveRef(context, operationId) : "";
  const recordedProposedCommit = preparedRef
    ? await optionalGitOutput(runCommand, context, ["rev-parse", "--verify", `${preparedRef}^{commit}`], {
        commandOptions,
        project
      })
    : "";
  const proposedCommit = text(recovery.proposedCommit) || recordedProposedCommit;
  if (
    text(recovery.proposedCommit) &&
    recordedProposedCommit &&
    text(recovery.proposedCommit) !== recordedProposedCommit
  ) {
    throw saveError(
      "The interrupted Save has inconsistent prepared-commit evidence.",
      "vibe64_session_save_recovery_evidence_invalid"
    );
  }
  const expectedCanonicalCommit = text(recovery.expectedCanonicalCommit) || (
    proposedCommit
      ? await optionalGitOutput(runCommand, context, ["rev-parse", "--verify", `${proposedCommit}^`], {
          commandOptions,
          project
        })
      : ""
  );
  const recordedCheckpointCommit = operationId
    ? await optionalGitOutput(runCommand, context, [
        "rev-parse",
        "--verify",
        `${saveCheckpointRef(context, operationId)}^{commit}`
      ], { commandOptions, project })
    : "";
  const checkpointCommit = text(recovery.checkpointCommit) || recordedCheckpointCommit;
  const checkpointTree = text(recovery.checkpointTree) || (
    checkpointCommit
      ? await optionalGitOutput(runCommand, context, ["rev-parse", "--verify", `${checkpointCommit}^{tree}`], {
          commandOptions,
          project
        })
      : ""
  );
  if (!operationId || !expectedCanonicalCommit || !proposedCommit || !checkpointCommit || !checkpointTree) {
    throw saveError(
      "The interrupted Save stopped before a commit was durably prepared for pushing. Retry Save.",
      "vibe64_session_save_interrupted_retryable",
      { retryable: true }
    );
  }
  if (await commitTree(runCommand, context, checkpointCommit, { commandOptions, project }) !== checkpointTree) {
    throw saveError(
      "The interrupted Save has inconsistent checkpoint evidence.",
      "vibe64_session_save_recovery_evidence_invalid"
    );
  }
  return runProjectSourceExclusive(async () => {
    let canonical;
    try {
      canonical = await readCanonical(runCommand, context, operationId, { commandOptions, project });
    } catch (error) {
      if (context.mode !== PROJECT_REPOSITORY_MODE_GITHUB) throw error;
      throw saveError(
        `Save publication is still unknown. Restore repository access and inspect work again. ${text(error.message)}`,
        "vibe64_session_save_publication_unknown"
      );
    }
    let authorityCommit = canonical.commit;
    if (authorityCommit === expectedCanonicalCommit && canonical.contribution?.publishedCommit !== proposedCommit) {
      throw saveError(
        "The interrupted Save did not push your changes. Retry Save when ready.",
        "vibe64_session_save_interrupted_retryable",
        { retryable: true }
      );
    }
    if (context.contribution) authorityCommit = canonical.contribution.publishedCommit;
    if (authorityCommit !== proposedCommit) {
      throw saveError(
        "Canonical history advanced while the interrupted Save was being recovered.",
        "vibe64_session_save_authority_advanced",
        { authorityCommit, expectedCanonicalCommit, proposedCommit }
      );
    }
    const cacheMaintenance = await refreshVerifiedGithubMirror(
      runCommand,
      context,
      proposedCommit,
      { commandOptions, project }
    );
    const reconciliation = await reconcileSession(runCommand, context, {
      checkpointCommit,
      checkpointTree,
      commandOptions,
      project,
      saveCommit: proposedCommit,
      sessionHead: text(recovery.sessionHead)
    });
    return {
      ...recovery,
      authorityCommit,
      cacheMaintenance,
      ok: true,
      recovered: true,
      saveCommit: proposedCommit,
      status: reconciliation.status,
      verifiedCommit: proposedCommit,
      ...reconciliation
    };
  }, {
    operation: `recover-save-session:${context.sessionId}`
  });
}

export {
  preparedSaveRef,
  recoverSessionWorkSave
};
