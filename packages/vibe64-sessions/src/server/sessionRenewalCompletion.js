import { normalizeText } from "@local/vibe64-core/server/core";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import {
  SESSION_RENEWAL_MAINTENANCE_STEP,
  SESSION_RENEWAL_STAGE,
  SESSION_RENEWAL_STATUS,
  mutateSessionRenewalState
} from "./sessionRenewalState.js";
import { renewalError, renewalFailure, renewalTransitionActor, statePatch, timestamp } from "./sessionRenewalRules.js";

/** @typedef {import("./types.js").SessionArchive} SessionArchive */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").RenewalPredecessorSession} RenewalPredecessorSession */
/** @typedef {import("./types.js").RenewalSessionAccess} RenewalSessionAccess */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */
/** @typedef {import("./types.js").SessionArchivePrepareArchive} SessionArchivePrepareArchive */

function pendingRenewalMaintenance(at = timestamp()) {
  return {
    attempt: 0,
    error: null,
    status: "pending",
    steps: Object.fromEntries(
      Object.values(SESSION_RENEWAL_MAINTENANCE_STEP)
        .map((name) => [name, false])
    ),
    updatedAt: at
  };
}

async function updateRenewalMaintenance(runtime, state, operation) {
  return mutateSessionRenewalState(runtime, state.sessionId, (current) => statePatch(current, {
    maintenance: operation(current.maintenance)
  }));
}

/**
 * The end of a renewal: the predecessor archived, the successor activated and
 * committed, then the committed renewal's maintenance.
 * @param {object} dependencies
 * @param {RenewalPredecessorSession} dependencies.predecessorSession
 * @param {SessionArchivePrepareArchive} dependencies.prepareArchive
 * @param {ProjectService} dependencies.project
 * @param {RenewalSessionAccess} dependencies.renewalAccess
 * @param {TerminalsService} dependencies.terminals
 */
function createRenewalCompletion({
  predecessorSession,
  prepareArchive,
  project,
  renewalAccess,
  terminals
}) {
  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {object} state
   */
  async function completeRenewalArchive(runtime, state) {
    const sourceSessionId = state.sessionId;
    const successorSessionId = state.successor.sessionId;
    const transitionActor = renewalTransitionActor(state);
    const transition = {
      acknowledgedAt: state.successor.acknowledgedAt,
      actorDisplayName: transitionActor.name,
      actorId: transitionActor.id,
      handoverDeliveredAt: state.successor.handoverDeliveredAt,
      renewalId: state.renewalId,
      sourceSessionId,
      successorSessionId
    };
    const predecessor = await renewalAccess.readInternalSession(runtime, sourceSessionId);
    if (predecessor.archived === true) {
      throw renewalError(
        "A predecessor archive exists before the renewal commit marker.",
        "vibe64_session_renewal_state_invalid",
        { retryable: false, statusCode: 500 }
      );
    }
    let sourceStatus = normalizeText(
      await runtime.store.readStatusForRenewal(sourceSessionId)
    );
    try {
      if (sourceStatus === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED) {
        const prepared = await prepareArchive({
          phase: predecessor.metadata?.source_recovery_saved === "yes" ? "source" : "stopping",
          renewal: true,
          runtime,
          session: predecessor
        });
        if (prepared?.ok === false) {
          throw renewalError(
            prepared.error || "Session archive preparation failed.",
            prepared.code || "vibe64_session_archive_preparation_failed",
            { retryable: true }
          );
        }
        await runtime.prepareSessionSourceForRenewal(sourceSessionId, {
          renewalId: state.renewalId
        });
        await runtime.store.transitionRenewalSuccessor(transition);
      }
      const preparedArchive = await runtime.store.prepareRenewalSessionArchive(transition);
      const preparedMetadata = preparedArchive?.index?.metadata;
      if (
        normalizeText(preparedMetadata?.renewal_id) !== state.renewalId ||
        normalizeText(preparedMetadata?.renewed_to) !== successorSessionId
      ) {
        throw renewalError(
          "The private predecessor archive does not prove the exact renewal link.",
          "vibe64_session_renewal_archive_invalid",
          { statusCode: 500 }
        );
      }
      return mutateSessionRenewalState(runtime, sourceSessionId, (current) => statePatch(current, {
        error: null,
        stage: SESSION_RENEWAL_STAGE.SUCCESSOR_ACTIVATING,
        status: SESSION_RENEWAL_STATUS.RUNNING
      }));
    } catch (error) {
      let rollbackError = null;
      try {
        await runtime.store.restoreRenewalClosingSession(transition);
        await mutateSessionRenewalState(runtime, sourceSessionId, (currentState) => statePatch(currentState, {
          stage: SESSION_RENEWAL_STAGE.OLD_ARCHIVING,
          status: SESSION_RENEWAL_STATUS.RUNNING
        }));
      } catch (rollbackFailure) {
        rollbackError = rollbackFailure;
      }
      if (rollbackError) {
        throw renewalError(
          "Session renewal archive failed and its rollback also needs attention.",
          "vibe64_session_renewal_archive_rollback_failed",
          {
            details: {
              archiveError: normalizeText(error?.message),
              rollbackError: normalizeText(rollbackError?.message)
            },
            retryable: true,
            statusCode: 500
          }
        );
      }
      throw error;
    }
  }

  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {object} state
   */
  async function runCompletedRenewalMaintenance(runtime, state) {
    if (!state.commit?.committedAt || state.status !== SESSION_RENEWAL_STATUS.COMPLETED) {
      return state;
    }
    if (state.maintenance?.status === "completed") {
      return state;
    }
    let current = await updateRenewalMaintenance(runtime, state, (maintenance) => ({
      ...maintenance,
      attempt: Math.max(0, Number(maintenance?.attempt) || 0) + 1,
      error: null,
      status: "pending",
      updatedAt: timestamp()
    }));
    const successorSessionId = current.commit.successorSessionId;
    let archivedPredecessor = null;
    const committedPredecessor = async () => {
      archivedPredecessor ||= await renewalAccess.readInternalSession(runtime, current.sessionId);
      if (archivedPredecessor.archived !== true) {
        throw renewalError(
          "The committed predecessor archive is not readable.",
          "vibe64_session_renewal_archive_required",
          { retryable: true, statusCode: 500 }
        );
      }
      return archivedPredecessor;
    };
    const maintenanceSteps = [
      [SESSION_RENEWAL_MAINTENANCE_STEP.ARCHIVE_FINALIZED, () => (
        runtime.store.finalizeRenewalArchiveCommit({
          renewalId: current.renewalId,
          sourceSessionId: current.sessionId,
          successorSessionId
        })
      )],
      [SESSION_RENEWAL_MAINTENANCE_STEP.ATTACHMENTS_RELEASED, async () => (
        terminals.releaseRenewalPredecessorAttachments(
          await committedPredecessor(),
          {
            renewalId: current.renewalId,
            runtime
          }
        )
      )],
      [SESSION_RENEWAL_MAINTENANCE_STEP.SOURCE_REMOVED, () => (
        runtime.commitRenewalSessionSourceRemoval(current.sessionId, {
          renewalId: current.renewalId
        })
      )],
      [SESSION_RENEWAL_MAINTENANCE_STEP.PREDECESSOR_PROCESS_PROOF_RELEASED, async () => (
        predecessorSession.releasePredecessorProcessExitProof(runtime, current, await committedPredecessor())
      )],
      [SESSION_RENEWAL_MAINTENANCE_STEP.ADMISSION_THAWED, () => (
        predecessorSession.thawPredecessorTerminalAdmission(current)
      )],
      [SESSION_RENEWAL_MAINTENANCE_STEP.RESOURCES_RELEASED, async () => (
        project.releaseSessionResources({
          session: await committedPredecessor(),
          sessionId: current.sessionId
        })
      )],
      [SESSION_RENEWAL_MAINTENANCE_STEP.SUCCESSOR_FINALIZED, () => (
        runtime.store.writeMetadataValueForRenewal(
          successorSessionId,
          "renewal_finalized_at",
          current.commit.committedAt
        )
      )]
    ];
    try {
      for (const [name, operation] of maintenanceSteps) {
        if (current.maintenance.steps[name]) {
          continue;
        }
        await operation();
        current = await updateRenewalMaintenance(runtime, current, (maintenance) => ({
          ...maintenance,
          error: null,
          status: "pending",
          steps: {
            ...maintenance.steps,
            [name]: true
          },
          updatedAt: timestamp()
        }));
      }
      const completed = await updateRenewalMaintenance(runtime, current, (maintenance) => ({
        ...maintenance,
        error: null,
        status: "completed",
        updatedAt: timestamp()
      }));
      await renewalAccess.publish(current.sessionId, "session-archived");
      return completed;
    } catch (error) {
      return updateRenewalMaintenance(runtime, current, (maintenance) => ({
        ...maintenance,
        error: renewalFailure(error),
        status: "failed",
        updatedAt: timestamp()
      }));
    }
  }

  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {object} state
   * @param {object} [input]
   */
  async function finalizeCommittedRenewal(runtime, state, input = {}) {
    const commit = state.commit;
    if (!commit?.committedAt) {
      throw renewalError(
        "Session renewal has no durable commit marker.",
        "vibe64_session_renewal_state_invalid",
        { retryable: true, statusCode: 500 }
      );
    }
    if (
      state.status === SESSION_RENEWAL_STATUS.COMPLETED &&
      state.stage === SESSION_RENEWAL_STAGE.COMPLETED
    ) {
      return runCompletedRenewalMaintenance(runtime, state);
    }
    const predecessor = await renewalAccess.readInternalSession(runtime, state.sessionId);
    if (predecessor.status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED) {
      await runtime.stagePreparedSessionSourceForRenewal(state.sessionId, {
        renewalId: state.renewalId
      });
    }
    const publishedArchive = await runtime.store.commitRenewalArchive({
      renewalId: state.renewalId,
      sourceSessionId: state.sessionId,
      successorSessionId: commit.successorSessionId
    });
    const predecessorArchivedAt = normalizeText(
      publishedArchive?.index?.metadata?.renewal_archived_at ||
      publishedArchive?.archivedAt
    );
    if (!predecessorArchivedAt) {
      throw renewalError(
        "The committed predecessor archive has no publication timestamp.",
        "vibe64_session_renewal_archive_invalid",
        { retryable: true, statusCode: 500 }
      );
    }
    await runtime.store.commitRenewalSuccessor({
      committedAt: commit.committedAt,
      renewalId: state.renewalId,
      sourceSessionId: state.sessionId,
      successorSessionId: commit.successorSessionId
    });
    await runtime.store.commitRenewalCurrentSession({
      renewalId: state.renewalId,
      sourceSessionId: state.sessionId,
      successorSessionId: commit.successorSessionId
    });
    const wasCompleted = state.status === SESSION_RENEWAL_STATUS.COMPLETED;
    const completed = wasCompleted
      ? state
      : await mutateSessionRenewalState(runtime, state.sessionId, (current) => statePatch(current, {
          completedAt: current.completedAt || commit.committedAt,
          completionRetry: null,
          error: null,
          predecessorArchivedAt: current.predecessorArchivedAt || predecessorArchivedAt,
          stage: SESSION_RENEWAL_STAGE.COMPLETED,
          status: SESSION_RENEWAL_STATUS.COMPLETED,
          successor: {
            ...current.successor,
            availableAt: current.successor?.availableAt || commit.committedAt
          }
        }));
    if (!wasCompleted) {
      await renewalAccess.publish(commit.successorSessionId, "session-renewal-successor-available", input.originId);
      await renewalAccess.publish(commit.successorSessionId, "session-renewal-completed", input.originId);
    }
    return runCompletedRenewalMaintenance(runtime, completed);
  }

  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {object} state
   * @param {object} [input]
   */
  async function finalizeCompletedRenewal(runtime, state, input = {}) {
    if (state.commit?.committedAt) {
      return finalizeCommittedRenewal(runtime, state, input);
    }
    const activating = state.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_ACTIVATING
      ? state
      : await completeRenewalArchive(runtime, state);
    const successorSessionId = normalizeText(activating.successor?.sessionId);
    if (!successorSessionId) {
      throw renewalError(
        "Completed session renewal has no successor.",
        "vibe64_session_renewal_link_mismatch",
        { statusCode: 500 }
      );
    }
    await runtime.activateRenewalSession({
      renewalId: activating.renewalId,
      sourceSessionId: activating.sessionId,
      successorSessionId
    });
    const selection = await runtime.finalizeRenewalCurrentSession({
      renewalId: activating.renewalId,
      sourceSessionId: activating.sessionId,
      successorSessionId
    });
    const committedAt = timestamp();
    const committed = await mutateSessionRenewalState(
      runtime,
      activating.sessionId,
      (current) => statePatch(current, {
        commit: {
          committedAt,
          selectedBeforeArchive: normalizeText(selection.selectedBeforeArchive) || "none",
          sourceSessionId: current.sessionId,
          successorSessionId,
          successorWillBeSelected: selection.successorWillBeSelected === true
        },
        completionRetry: null,
        error: null,
        maintenance: pendingRenewalMaintenance(committedAt)
      })
    );
    return finalizeCommittedRenewal(runtime, committed, input);
  }

  return Object.freeze({
    completeRenewalArchive,
    finalizeCommittedRenewal,
    finalizeCompletedRenewal
  });
}

export { createRenewalCompletion };
