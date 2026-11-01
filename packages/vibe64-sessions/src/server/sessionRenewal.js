import { normalizeText } from "@local/vibe64-core/server/core";
import { runVibe64AgentWriteExclusive, runVibe64RenewalAgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import {
  SESSION_RENEWAL_STAGE,
  SESSION_RENEWAL_STATUS,
  assertSessionRenewalDraftVersion,
  assertSessionRenewalOperation,
  createSessionRenewalDraft,
  createSessionRenewalState,
  mutateSessionRenewalState,
  readSessionRenewalState,
  renewalHandoverText,
  writeSessionRenewalState
} from "./sessionRenewalState.js";
import {
  SESSION_RENEWAL_PRE_ACKNOWLEDGEMENT_STAGES,
  actorFromUser,
  assertRenewalAgentWriteAcquired,
  inspectSessionRenewalEligibility,
  operationId,
  publicRenewalResult,
  renewalBasisMatches,
  renewalError,
  statePatch,
  timestamp
} from "./sessionRenewalRules.js";
import { createRenewalSessionAccess } from "./sessionRenewalAccess.js";
import { createRenewalAdmission } from "./sessionRenewalAdmission.js";
import { createRenewalCompletion } from "./sessionRenewalCompletion.js";
import { createRenewalPredecessorSession } from "./sessionRenewalPredecessor.js";
import { createRenewalRestoration } from "./sessionRenewalRestoration.js";
import { SESSION_RENEWAL_WORKFLOW_LOCK_RETRY_MS, createRenewalScheduler } from "./sessionRenewalScheduler.js";
import { createRenewalSuccessorSession } from "./sessionRenewalSuccessor.js";
import { createRenewalWorkflow } from "./sessionRenewalWorkflow.js";

/** @typedef {import("./types.js").WorkspaceSetupRunner} WorkspaceSetupRunner */
/** @typedef {import("./types.js").SessionArchive} SessionArchive */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").SessionArchivePrepareArchive} SessionArchivePrepareArchive */
/** @typedef {import("./types.js").RenewalActorRestoration} RenewalActorRestoration */

/**
 * @param {object} dependencies
 * @param {typeof clearTimeout} [dependencies.clearTimeoutFn]
 * @param {SessionArchivePrepareArchive} dependencies.prepareArchive
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {RenewalActorRestoration} dependencies.restoreRenewalActor
 * @param {(input: object, options: object) => Promise<object>} dependencies.resolveSuccessorAssistant
 * @param {typeof setTimeout} [dependencies.setTimeoutFn]
 * @param {WorkspaceSetupRunner} dependencies.setupRunner
 * @param {TerminalsService} dependencies.terminals
 * @param {number} [dependencies.workflowLockRetryMs]
 */
function createSessionRenewalController({
  clearTimeoutFn = clearTimeout,
  prepareArchive,
  project,
  publishSessionChanged,
  resolveSuccessorAssistant,
  restoreRenewalActor,
  setTimeoutFn = setTimeout,
  setupRunner,
  terminals,
  workflowLockRetryMs = SESSION_RENEWAL_WORKFLOW_LOCK_RETRY_MS
}) {
  const renewalAccess = createRenewalSessionAccess({
    project,
    publishSessionChanged,
    terminals
  });
  const predecessorSession = createRenewalPredecessorSession({
    renewalAccess,
    setupRunner,
    terminals
  });
  const successorSession = createRenewalSuccessorSession({
    project,
    renewalAccess,
    terminals
  });
  const restoration = createRenewalRestoration({
    predecessorSession,
    renewalAccess,
    successorSession
  });
  const completion = createRenewalCompletion({
    predecessorSession,
    prepareArchive,
    project,
    renewalAccess,
    terminals
  });
  const admission = createRenewalAdmission();
  const workflow = createRenewalWorkflow({
    admission,
    completion,
    predecessorSession,
    renewalAccess,
    restoration,
    setupRunner,
    successorSession,
    terminals
  });
  const scheduler = createRenewalScheduler({
    admission,
    clearTimeoutFn,
    renewalAccess,
    restoration,
    restoreRenewalActor,
    setTimeoutFn,
    workflow,
    workflowLockRetryMs
  });

  const controller = {
    async cancelSessionRenewal(sessionId, input) {
      const runtime = await renewalAccess.runtimeForRenewal();
      const state = await mutateSessionRenewalState(runtime, sessionId, (current) => {
        assertSessionRenewalOperation(current, input.operationKey);
        if (current.status === SESSION_RENEWAL_STATUS.CANCELLED) {
          return undefined;
        }
        assertSessionRenewalDraftVersion(current, input);
        if (current.status !== SESSION_RENEWAL_STATUS.REVIEW) {
          throw renewalError(
            "Only a handover awaiting review can be cancelled.",
            "vibe64_session_renewal_cancel_not_available"
          );
        }
        return statePatch(current, {
          error: null,
          stage: SESSION_RENEWAL_STAGE.CANCELLED,
          status: SESSION_RENEWAL_STATUS.CANCELLED
        });
      });
      scheduler.clearWorkflowLockRetry(state?.renewalId);
      await renewalAccess.publish(sessionId, "session-renewal-cancelled", input.originId);
      return publicRenewalResult(state, {}, input.vibe64User);
    },

    async confirmSessionRenewal(sessionId, input) {
      const runtime = await renewalAccess.runtimeForRenewal();
      const observed = await readSessionRenewalState(runtime, sessionId);
      assertSessionRenewalOperation(observed, input.operationKey);
      return admission.runConfirmationOnce(observed.renewalId, input, async () => {
      if (
        observed?.approved &&
        [
          SESSION_RENEWAL_STATUS.COMPLETED,
          SESSION_RENEWAL_STATUS.RUNNING
        ].includes(observed.status)
      ) {
        assertSessionRenewalDraftVersion(observed, input);
        if (observed.status === SESSION_RENEWAL_STATUS.RUNNING) {
          await scheduler.schedule(observed, input);
        }
        return publicRenewalResult(observed, {}, input.vibe64User);
      }
      const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
        const current = await readSessionRenewalState(runtime, sessionId);
        assertSessionRenewalOperation(current, input.operationKey);
        const draft = assertSessionRenewalDraftVersion(current, input);
        predecessorSession.validateReviewedHandover(current, draft);
        if (
          current.approved &&
          [
            SESSION_RENEWAL_STATUS.COMPLETED,
            SESSION_RENEWAL_STATUS.RUNNING
          ].includes(current.status)
        ) {
          return current;
        }
        if (current.status !== SESSION_RENEWAL_STATUS.REVIEW) {
          throw renewalError(
            "This handover is not awaiting confirmation.",
            "vibe64_session_renewal_confirm_not_available"
          );
        }
        const idleSession = await predecessorSession.assertPredecessorIdle(runtime, sessionId);
        const successorAssistant = await resolveSuccessorAssistant(
          { assistantSelection: input.assistantSelection },
          {
            session: idleSession,
            vibe64User: input.vibe64User || null
          }
        );
        let confirmed = null;
        let durablyQuiesced = false;
        await predecessorSession.freezePredecessorTerminalAdmission(current);
        try {
          await predecessorSession.closePredecessorTerminals(runtime, current, idleSession);
          const session = await runtime.getSession(sessionId, { inspectSource: false });
          const basis = await inspectSessionRenewalEligibility({
            operationId: operationId(current.renewalId, "confirm"),
            runtime,
            session,
            setupRunner,
            terminals,
            vibe64User: input.vibe64User
          });
          if (!renewalBasisMatches(basis, current.basis)) {
            const review = await predecessorSession.returnToRenewalReview(runtime, current, basis);
            await predecessorSession.thawPredecessorTerminalAdmission(review);
            return review;
          }
          confirmed = await mutateSessionRenewalState(runtime, sessionId, (latest) => {
            assertSessionRenewalOperation(latest, input.operationKey);
            assertSessionRenewalDraftVersion(latest, input);
            if (
              latest.status !== SESSION_RENEWAL_STATUS.REVIEW ||
              latest.stage !== SESSION_RENEWAL_STAGE.DRAFT_READY
            ) {
              throw renewalError(
                "This handover is no longer awaiting confirmation.",
                "vibe64_session_renewal_confirm_not_available"
              );
            }
            return statePatch(latest, {
              approved: createSessionRenewalDraft(draft.text, {
                at: timestamp(),
                origin: draft.origin,
                revision: draft.revision
              }),
              confirmedBy: actorFromUser(input.vibe64User),
              continuedBy: actorFromUser(input.vibe64User),
              error: null,
              stage: SESSION_RENEWAL_STAGE.OLD_QUIESCING,
              status: SESSION_RENEWAL_STATUS.RUNNING,
              successor: {
                ...successorAssistant,
                attempt: 1,
                replacementCeiling: 2
              }
            });
          });
          await runtime.quiesceSessionForRenewal({
            renewalId: confirmed.renewalId,
            sourceSessionId: sessionId
          });
          durablyQuiesced = true;
          return confirmed;
        } catch (error) {
          if (!durablyQuiesced) {
            const sourceStatus = normalizeText(
              await runtime.store.readStatusForRenewal(sessionId)
            );
            if (sourceStatus === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED) {
              await runtime.quiesceSessionForRenewal({
                renewalId: current.renewalId,
                sourceSessionId: sessionId
              });
              await runtime.restoreSessionAfterRenewalCancellation({
                renewalId: current.renewalId,
                sourceSessionId: sessionId
              });
            }
            if (confirmed) {
              await mutateSessionRenewalState(runtime, sessionId, (latest) => (
                latest.status === SESSION_RENEWAL_STATUS.RUNNING &&
                latest.stage === SESSION_RENEWAL_STAGE.OLD_QUIESCING
                  ? statePatch(latest, {
                      approved: null,
                      confirmedBy: null,
                      continuedBy: null,
                      error: null,
                      stage: SESSION_RENEWAL_STAGE.DRAFT_READY,
                      status: SESSION_RENEWAL_STATUS.REVIEW
                    })
                  : undefined
              ));
            }
            await predecessorSession.thawPredecessorTerminalAdmission(current);
          }
          throw error;
        }
      }, { operation: "confirm-session-renewal" });
      const confirmed = assertRenewalAgentWriteAcquired(exclusive);
      await scheduler.schedule(confirmed, input);
      await renewalAccess.publish(sessionId, "session-renewal-confirmed", input.originId);
      return publicRenewalResult(confirmed, {}, input.vibe64User);
      });
    },

    async inspectSessionRenewal(sessionId, input) {
      const runtime = await renewalAccess.runtimeForRenewal();
      const state = await readSessionRenewalState(runtime, sessionId);
      await scheduler.schedule(state, input);
      return publicRenewalResult(state, {
        available: state?.status !== SESSION_RENEWAL_STATUS.COMPLETED
      }, input.vibe64User);
    },

    async requestSessionRenewalDraft(sessionId, input) {
      const runtime = await renewalAccess.runtimeForRenewal();
      const state = await runtime.store.runSessionRenewalStateExclusive(sessionId, async () => {
        const current = await readSessionRenewalState(runtime, sessionId);
        if (current) {
          if (
            current.status === SESSION_RENEWAL_STATUS.CANCELLED &&
            current.operationKey !== input.operationKey
          ) {
            // A new operation key deliberately starts a fresh renewal after a
            // prior review was cancelled.
          } else {
            assertSessionRenewalOperation(current, input.operationKey);
            return current;
          }
        }
        let created = null;
        await runtime.store.mutateSessionForRenewal(sessionId, async () => {
          const source = await runtime.getSessionForRenewal(sessionId, {
            inspectSource: false
          });
          if (
            source?.archived === true ||
            normalizeText(source?.sessionId) !== normalizeText(sessionId) ||
            normalizeText(source?.status) !== VIBE64_SESSION_STATUS.ACTIVE
          ) {
            throw renewalError(
              "Only an active session can be renewed.",
              "vibe64_session_renewal_source_not_active"
            );
          }
          const initial = createSessionRenewalState({
            actor: actorFromUser(input.vibe64User),
            operationKey: input.operationKey,
            sessionId
          });
          created = await writeSessionRenewalState(runtime, sessionId, {
            ...initial,
            generation: {
              attempt: 1,
              operationId: operationId(initial.renewalId, "draft-1")
            }
          });
        });
        return created;
      });
      await scheduler.schedule(state, input);
      await renewalAccess.publish(sessionId, "session-renewal-started", input.originId);
      return publicRenewalResult(state, {}, input.vibe64User);
    },

    closeSessionRenewalWork: scheduler.closeSessionRenewalWork,

    resumeSessionRenewals: scheduler.resumeSessionRenewals,

    async retrySessionRenewal(sessionId, input) {
      const runtime = await renewalAccess.runtimeForRenewal();
      const observed = await readSessionRenewalState(runtime, sessionId);
      assertSessionRenewalOperation(observed, input.operationKey);
      if ([
        SESSION_RENEWAL_STATUS.COMPLETED,
        SESSION_RENEWAL_STATUS.RUNNING
      ].includes(observed.status)) {
        await scheduler.schedule(observed, input);
        return publicRenewalResult(observed, {}, input.vibe64User);
      }
      const exclusive = await runVibe64RenewalAgentWriteExclusive(runtime, sessionId, async () => {
        let current = await readSessionRenewalState(runtime, sessionId);
        assertSessionRenewalOperation(current, input.operationKey);
        if ([
          SESSION_RENEWAL_STATUS.COMPLETED,
          SESSION_RENEWAL_STATUS.RUNNING
        ].includes(current.status)) {
          return current;
        }
        if (current.status !== SESSION_RENEWAL_STATUS.FAILED) {
          throw renewalError(
            "This session renewal is not waiting to be retried.",
            "vibe64_session_renewal_retry_not_available"
          );
        }
        if (current.stage === SESSION_RENEWAL_STAGE.FAILURE_RESTORING) {
          current = await mutateSessionRenewalState(runtime, sessionId, (latest) => statePatch(latest, {
            ...(input.vibe64User
              ? { continuedBy: actorFromUser(input.vibe64User) }
              : {}),
            error: null,
            status: SESSION_RENEWAL_STATUS.RUNNING
          }));
          current = await restoration.completeFailureRestoration(runtime, current);
          if (
            current.status === SESSION_RENEWAL_STATUS.RUNNING ||
            current.stage === SESSION_RENEWAL_STAGE.FAILURE_RESTORING
          ) {
            return current;
          }
        }
        if (current.stage === SESSION_RENEWAL_STAGE.DRAFT_GENERATING) {
          const attempt = Math.max(1, Number(current.generation?.attempt) || 1) + 1;
          return mutateSessionRenewalState(runtime, sessionId, (latest) => statePatch(latest, {
            ...(input.vibe64User
              ? { continuedBy: actorFromUser(input.vibe64User) }
              : {}),
            error: null,
            generation: {
              attempt,
              operationId: operationId(latest.renewalId, `draft-${attempt}`)
            },
            status: SESSION_RENEWAL_STATUS.RUNNING
          }));
        }
        if (!SESSION_RENEWAL_PRE_ACKNOWLEDGEMENT_STAGES.has(current.stage)) {
          const sourceStatus = await runtime.store.readStatusForRenewal(sessionId);
          if (sourceStatus !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED) {
            throw renewalError(
              "The acknowledged predecessor no longer owns its renewal transition.",
              "vibe64_session_renewal_link_mismatch",
              { retryable: true, statusCode: 500 }
            );
          }
          return mutateSessionRenewalState(runtime, sessionId, (latest) => statePatch(latest, {
            ...(input.vibe64User
              ? { continuedBy: actorFromUser(input.vibe64User) }
              : {}),
            error: null,
            status: SESSION_RENEWAL_STATUS.RUNNING
          }));
        }

        await predecessorSession.assertPredecessorIdle(runtime, sessionId);
        await predecessorSession.freezePredecessorTerminalAdmission(current);
        let durablyQuiesced = false;
        try {
          await restoration.restorePreAcknowledgementSource(runtime, current, {
            thawAdmission: false
          });
          const session = await renewalAccess.readInternalSession(runtime, sessionId);
          await predecessorSession.closePredecessorTerminals(runtime, current, session);
          const basis = await inspectSessionRenewalEligibility({
            operationId: operationId(current.renewalId, "retry"),
            runtime,
            session,
            setupRunner,
            terminals,
            vibe64User: input.vibe64User
          });
          if (!renewalBasisMatches(basis, current.basis)) {
            await successorSession.cleanupRenewalSuccessor(runtime, current);
            current = await predecessorSession.returnToRenewalReview(runtime, current, basis);
            await predecessorSession.thawPredecessorTerminalAdmission(current);
            return current;
          }
          const retryingDiscardedSuccessor = (
            current.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_DISCARDING
          );
          const retryingDiscardTransition = (
            current.error?.code ===
              "vibe64_session_renewal_successor_discard_transition_failed"
          );
          const retryAttempt = Math.max(1, Number(current.successor?.attempt) || 1);
          current = await mutateSessionRenewalState(runtime, sessionId, (latest) => statePatch(latest, {
            ...(input.vibe64User
              ? { continuedBy: actorFromUser(input.vibe64User) }
              : {}),
            error: null,
            stage: current.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_ACTIVATING
              ? SESSION_RENEWAL_STAGE.OLD_ARCHIVING
              : current.stage,
            ...(retryingDiscardedSuccessor || retryingDiscardTransition
              ? {
                  successor: {
                    ...latest.successor,
                    replacementCeiling: retryAttempt + (
                      retryingDiscardedSuccessor ? 2 : 1
                    )
                  }
                }
              : {}),
            status: SESSION_RENEWAL_STATUS.RUNNING
          }));
          await runtime.quiesceSessionForRenewal({
            renewalId: current.renewalId,
            sourceSessionId: sessionId
          });
          durablyQuiesced = true;
          return current;
        } catch (error) {
          if (!durablyQuiesced) {
            const sourceStatus = normalizeText(
              await runtime.store.readStatusForRenewal(sessionId)
            );
            if (sourceStatus === VIBE64_SESSION_STATUS.ACTIVE) {
              await predecessorSession.thawPredecessorTerminalAdmission(current);
            }
          }
          throw error;
        }
      }, { operation: "retry-session-renewal" });
      if (!exclusive.acquired) {
        throw renewalError(
          normalizeText(exclusive.value?.error) || "Another assistant operation is starting. Try again in a moment.",
          normalizeText(exclusive.value?.code) || "vibe64_session_renewal_agent_busy",
          { retryable: true }
        );
      }
      await scheduler.schedule(exclusive.value, input);
      return publicRenewalResult(exclusive.value, {}, input.vibe64User);
    },

    async updateSessionRenewalDraft(sessionId, input) {
      const runtime = await renewalAccess.runtimeForRenewal();
      const state = await mutateSessionRenewalState(runtime, sessionId, (current) => {
        assertSessionRenewalOperation(current, input.operationKey);
        const requestedDraft = renewalHandoverText(input.draft);
        if (
          current.status === SESSION_RENEWAL_STATUS.REVIEW &&
          current.draft?.text === requestedDraft
        ) {
          return undefined;
        }
        const draft = assertSessionRenewalDraftVersion(current, input);
        if (current.status !== SESSION_RENEWAL_STATUS.REVIEW) {
          throw renewalError(
            "This handover is not editable now.",
            "vibe64_session_renewal_edit_not_available"
          );
        }
        return statePatch(current, {
          draft: createSessionRenewalDraft(requestedDraft, {
            origin: "edited",
            revision: draft.revision + 1
          }),
          error: null
        });
      });
      await renewalAccess.publish(sessionId, "session-renewal-draft-updated", input.originId);
      return publicRenewalResult(state, {}, input.vibe64User);
    }
  };
  for (const methodName of [
    "cancelSessionRenewal",
    "confirmSessionRenewal",
    "requestSessionRenewalDraft",
    "retrySessionRenewal",
    "updateSessionRenewalDraft"
  ]) {
    controller[methodName] = admission.admitMutation(controller[methodName]);
  }
  return Object.freeze(controller);
}

export { createSessionRenewalController };
