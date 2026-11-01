import { normalizeText } from "@local/vibe64-core/server/core";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import {
  SESSION_RENEWAL_STAGE,
  SESSION_RENEWAL_STATUS,
  mutateSessionRenewalState
} from "./sessionRenewalState.js";
import {
  SESSION_RENEWAL_PRE_ACKNOWLEDGEMENT_STAGES,
  SESSION_RENEWAL_SUCCESSOR_SOURCE_INVALID_CODE,
  renewalError,
  renewalFailure,
  statePatch,
  timestamp
} from "./sessionRenewalRules.js";

/** @typedef {import("./types.js").RenewalPredecessorSession} RenewalPredecessorSession */
/** @typedef {import("./types.js").RenewalSessionAccess} RenewalSessionAccess */
/** @typedef {import("./types.js").RenewalSuccessorSession} RenewalSuccessorSession */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */

/**
 * A failed renewal: its recorded failure, and the predecessor made writable
 * again while the renewal has not been acknowledged.
 * @param {object} dependencies
 * @param {RenewalPredecessorSession} dependencies.predecessorSession
 * @param {RenewalSessionAccess} dependencies.renewalAccess
 * @param {RenewalSuccessorSession} dependencies.successorSession
 */
function createRenewalRestoration({
  predecessorSession,
  renewalAccess,
  successorSession
}) {
  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {object} state
   * @param {object} [options]
   * @param {boolean} [options.thawAdmission]
   */
  async function restorePreAcknowledgementSource(runtime, state, {
    thawAdmission = true
  } = {}) {
    if (!SESSION_RENEWAL_PRE_ACKNOWLEDGEMENT_STAGES.has(state?.stage)) {
      return false;
    }
    const published = await renewalAccess.readInternalSession(runtime, state.sessionId).catch(() => null);
    if (published?.archived === true) {
      throw renewalError(
        "A predecessor archive exists before the renewal commit marker.",
        "vibe64_session_renewal_state_invalid",
        { retryable: false, statusCode: 500 }
      );
    }
    let sourceStatus = normalizeText(
      await runtime.store.readStatusForRenewal(state.sessionId)
    );
    if (sourceStatus === VIBE64_SESSION_STATUS.ACTIVE) {
      if (thawAdmission) {
        await predecessorSession.thawPredecessorTerminalAdmission(state);
      }
      return false;
    }
    if ([
      SESSION_RENEWAL_STAGE.OLD_ARCHIVING,
      SESSION_RENEWAL_STAGE.SUCCESSOR_ACTIVATING
    ].includes(state.stage)) {
      const successorSessionId = normalizeText(state.successor?.sessionId);
      if (!successorSessionId) {
        throw renewalError(
          "The predecessor archive transition has no exact successor.",
          "vibe64_session_renewal_link_mismatch",
          { retryable: true, statusCode: 500 }
        );
      }
      const transition = {
        renewalId: state.renewalId,
        sourceSessionId: state.sessionId,
        successorSessionId
      };
      const successor = await renewalAccess.readInternalSession(runtime, successorSessionId)
        .catch((error) => {
          if (error?.code === "vibe64_session_not_found") {
            return null;
          }
          throw error;
        });
      if (successor?.status === VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING) {
        await runtime.store.rollbackRenewalSuccessorActivation(transition);
      }
      await runtime.store.restoreRenewalClosingSession(transition);
      sourceStatus = normalizeText(
        await runtime.store.readStatusForRenewal(state.sessionId)
      );
      if (
        sourceStatus === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED &&
        normalizeText(published?.metadata?.source_recovery_saved) === "yes"
      ) {
        await runtime.restoreSessionSourceAfterRenewalFailure(state.sessionId, {
          renewalId: state.renewalId
        });
      }
    }
    if (sourceStatus !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED) {
      throw renewalError(
        "The predecessor session no longer owns this renewal transition.",
        "vibe64_session_renewal_link_mismatch",
        { retryable: true, statusCode: 500 }
      );
    }
    // Quiescence deliberately writes the blocking status first. If the process
    // stopped before its exact provenance landed, replaying this transition
    // completes that reachable barrier (or rejects foreign ownership) before
    // restoration makes the predecessor writable again.
    await runtime.quiesceSessionForRenewal({
      renewalId: state.renewalId,
      sourceSessionId: state.sessionId
    });
    await runtime.restoreSessionAfterRenewalCancellation({
      renewalId: state.renewalId,
      sourceSessionId: state.sessionId
    });
    if (thawAdmission) {
      await predecessorSession.thawPredecessorTerminalAdmission(state);
    }
    return true;
  }

  async function completeFailureRestoration(runtime, state) {
    if (state?.stage !== SESSION_RENEWAL_STAGE.FAILURE_RESTORING) {
      return state;
    }
    const failedStage = normalizeText(state.failure?.stage);
    const failedError = state.failure?.error;
    if (
      !SESSION_RENEWAL_PRE_ACKNOWLEDGEMENT_STAGES.has(failedStage) ||
      !failedError
    ) {
      throw renewalError(
        "Session renewal failure restoration has invalid durable ownership.",
        "vibe64_session_renewal_state_invalid",
        { retryable: true, statusCode: 500 }
      );
    }
    const restoring = {
      ...state,
      stage: failedStage
    };
    const successorSourceInvalid = normalizeText(failedError.code) ===
      SESSION_RENEWAL_SUCCESSOR_SOURCE_INVALID_CODE;
    let cleanupError = null;
    if (successorSourceInvalid) {
      try {
        await successorSession.cleanupRenewalSuccessor(runtime, restoring);
      } catch (error) {
        cleanupError = error;
      }
    }
    let restoreError = null;
    try {
      await restorePreAcknowledgementSource(runtime, restoring);
    } catch (error) {
      restoreError = error;
    }
    if (cleanupError || restoreError) {
      return mutateSessionRenewalState(runtime, state.sessionId, (current) => statePatch(current, {
        error: {
          code: restoreError
            ? "vibe64_session_renewal_restore_failed"
            : "vibe64_session_renewal_successor_discard_failed",
          message: restoreError
            ? "Session renewal failed and the predecessor could not be made writable again safely."
            : "The predecessor is writable again, but the invalid renewed session still needs exact cleanup.",
          retryable: true,
          details: {
            cleanupError: normalizeText(cleanupError?.message),
            renewalError: normalizeText(failedError?.message),
            restoreError: normalizeText(restoreError?.message)
          }
        },
        status: SESSION_RENEWAL_STATUS.FAILED
      }));
    }
    return mutateSessionRenewalState(runtime, state.sessionId, (current) => statePatch(current, {
      error: failedError,
      failure: null,
      predecessorArchivedAt: undefined,
      stage: successorSourceInvalid
        ? SESSION_RENEWAL_STAGE.SUCCESSOR_CREATING
        : failedStage,
      status: SESSION_RENEWAL_STATUS.FAILED,
      ...(successorSourceInvalid
        ? {
            successor: {
              assistantSelection: current.successor?.assistantSelection,
              assistantRouting: current.successor?.assistantRouting,
              attempt: Math.max(1, Number(current.successor?.attempt) || 1) + 1,
              replacementCeiling: Math.max(
                2,
                Number(current.successor?.replacementCeiling) || 2
              )
            }
          }
        : {})
    }));
  }

  async function fail(runtime, sessionId, error) {
    const failureError = renewalFailure(error);
    const failed = await mutateSessionRenewalState(runtime, sessionId, (current) => {
      if (!current || [
        SESSION_RENEWAL_STATUS.CANCELLED,
        SESSION_RENEWAL_STATUS.COMPLETED
      ].includes(current.status)) {
        return undefined;
      }
      if (current.stage === SESSION_RENEWAL_STAGE.FAILURE_RESTORING) {
        return statePatch(current, {
          error: failureError,
          status: SESSION_RENEWAL_STATUS.FAILED
        });
      }
      if (
        current.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_ACTIVATING &&
        current.commit?.committedAt
      ) {
        const completionRetryAttempt = Math.max(
          0,
          Number(current.completionRetry?.attempt) || 0
        ) + 1;
        return statePatch(current, {
          completionRetry: {
            attempt: completionRetryAttempt,
            lastFailedAt: timestamp()
          },
          error: failureError,
          status: SESSION_RENEWAL_STATUS.RUNNING
        });
      }
      if (SESSION_RENEWAL_PRE_ACKNOWLEDGEMENT_STAGES.has(current.stage)) {
        return statePatch(current, {
          error: failureError,
          failure: {
            error: failureError,
            stage: current.stage
          },
          stage: SESSION_RENEWAL_STAGE.FAILURE_RESTORING,
          status: SESSION_RENEWAL_STATUS.RUNNING
        });
      }
      return statePatch(current, {
        error: failureError,
        status: SESSION_RENEWAL_STATUS.FAILED
      });
    });
    if (!failed || [
      SESSION_RENEWAL_STATUS.CANCELLED,
      SESSION_RENEWAL_STATUS.COMPLETED
    ].includes(failed.status)) {
      return failed;
    }
    return failed.stage === SESSION_RENEWAL_STAGE.FAILURE_RESTORING &&
      failed.status === SESSION_RENEWAL_STATUS.RUNNING
      ? completeFailureRestoration(runtime, failed)
      : failed;
  }

  return Object.freeze({
    restorePreAcknowledgementSource,
    completeFailureRestoration,
    fail
  });
}

export { createRenewalRestoration };
