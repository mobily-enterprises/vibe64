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
  scopedSessionWorkCommand
} from "./sessionWorkGit.js";
import { readCanonical } from "./sessionWorkAuthority.js";
import { reconcileSession, refreshVerifiedGithubMirror } from "./sessionWorkPublication.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

async function recoverSessionWorkSave({
  commandOptions = {},
  project = {},
  recovery = {},
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const operationId = normalizeText(recovery.operationId);
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
  const proposedCommit = normalizeText(recovery.proposedCommit) || recordedProposedCommit;
  if (
    normalizeText(recovery.proposedCommit) &&
    recordedProposedCommit &&
    normalizeText(recovery.proposedCommit) !== recordedProposedCommit
  ) {
    throw saveError(
      "The interrupted Save has inconsistent prepared-commit evidence.",
      "vibe64_session_save_recovery_evidence_invalid"
    );
  }
  const expectedCanonicalCommit = normalizeText(recovery.expectedCanonicalCommit) || (
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
  const checkpointCommit = normalizeText(recovery.checkpointCommit) || recordedCheckpointCommit;
  const checkpointTree = normalizeText(recovery.checkpointTree) || (
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
      { retryable: true },
      { messageCode: "vibe64_session_save_interrupted_before_prepare" }
    );
  }
  if (await commitTree(runCommand, context, checkpointCommit, { commandOptions, project }) !== checkpointTree) {
    throw saveError(
      "The interrupted Save has inconsistent checkpoint evidence.",
      "vibe64_session_save_recovery_checkpoint_invalid"
    );
  }
  return runProjectSourceExclusive(async () => {
    let canonical;
    try {
      canonical = await readCanonical(runCommand, context, operationId, { commandOptions, project });
    } catch (error) {
      if (context.mode !== PROJECT_REPOSITORY_MODE_GITHUB) throw error;
      throw saveError(
        `Save publication is still unknown. Restore repository access and inspect work again. ${normalizeText(error.message)}`,
        "vibe64_session_save_publication_unknown",
        {},
        { messageCode: "vibe64_session_save_publication_still_unknown", messageParams: { reason: normalizeText(error.message) } }
      );
    }
    const authorityCommit = canonical.commit;
    if (authorityCommit === expectedCanonicalCommit) {
      throw saveError(
        "The interrupted Save did not push your changes. Retry Save when ready.",
        "vibe64_session_save_interrupted_retryable",
        { retryable: true },
        { messageCode: "vibe64_session_save_interrupted_unpushed" }
      );
    }
    if (authorityCommit !== proposedCommit) {
      throw saveError(
        "Canonical history advanced while the interrupted Save was being recovered.",
        "vibe64_session_save_recovery_history_advanced",
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
      sessionHead: normalizeText(recovery.sessionHead)
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
  recoverSessionWorkSave
};
