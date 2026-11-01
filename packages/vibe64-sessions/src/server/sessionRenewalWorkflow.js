import crypto from "node:crypto";
import { ASSISTANT_ROUTING_METADATA, assistantRoutingPreferences } from "@local/vibe64-runtime/shared/assistantRouting";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { VIBE64_ASSISTANT_SELECTION_METADATA, serializeVibe64AssistantSelection } from "@local/vibe64-runtime/shared";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import {
  SESSION_RENEWAL_STAGE,
  SESSION_RENEWAL_STATUS,
  assertSessionRenewalOperation,
  createSessionRenewalDraft,
  mutateSessionRenewalState,
  readSessionRenewalState,
  renewalHandoverText
} from "./sessionRenewalState.js";
import {
  assertRenewalAgentWriteAcquired,
  conversationFingerprint,
  inspectSessionRenewalEligibility,
  manualDraftTemplate,
  operationId,
  renewalBasisMatches,
  renewalError,
  renewalFailure,
  renewalTransitionActor,
  statePatch,
  timestamp
} from "./sessionRenewalRules.js";
import { assertSuccessorSource, ensureSuccessorDiscarding } from "./sessionRenewalSuccessor.js";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("./types.js").RenewalAdmission} RenewalAdmission */
/** @typedef {ReturnType<typeof import("./sessionRenewalCompletion.js").createRenewalCompletion>} RenewalCompletion */
/** @typedef {import("./types.js").RenewalPredecessorSession} RenewalPredecessorSession */
/** @typedef {import("./types.js").RenewalSessionAccess} RenewalSessionAccess */
/** @typedef {import("./types.js").RenewalRestoration} RenewalRestoration */
/** @typedef {import("./types.js").WorkspaceSetupRunner} WorkspaceSetupRunner */
/** @typedef {import("./types.js").RenewalSuccessorSession} RenewalSuccessorSession */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */

const SESSION_RENEWAL_THREAD_UNREADABLE_CODE =
  "vibe64_session_renewal_thread_unreadable";

const SESSION_RENEWAL_MANUAL_DRAFT_CODES = new Set([
  "vibe64_assistant_owner_required",
  "vibe64_assistant_connection_unavailable",
  SESSION_RENEWAL_THREAD_UNREADABLE_CODE,
  "vibe64_codex_app_server_start_failed",
  "vibe64_opencode_start_failed",
  "vibe64_opencode_start_timeout",
  "vibe64_session_renewal_handover_invalid",
  "vibe64_session_renewal_handover_source_mismatch",
  "vibe64_session_renewal_provider_failed",
  "vibe64_session_renewal_turn_failed",
  "vibe64_session_renewal_turn_identity_missing",
  "vibe64_session_renewal_turn_unreadable"
]);

const SESSION_RENEWAL_DISCARD_SUCCESSOR_CODES = new Set([
  "vibe64_session_renewal_fresh_thread_required",
  "vibe64_session_renewal_handover_invalid"
]);

const SESSION_RENEWAL_SUCCESSOR_REPLACEMENT_LIMIT_CODE =
  "vibe64_session_renewal_successor_replacement_limit_reached";

function successorSessionId(renewalId = "", attempt = 1) {
  const suffix = toText(renewalId)
    .replace(/[^A-Za-z0-9]/gu, "")
    .slice(0, 48);
  const normalizedAttempt = Math.max(1, Number(attempt) || 1);
  return `renewal-${suffix || crypto.randomUUID().replaceAll("-", "")}${
    normalizedAttempt > 1 ? `-${normalizedAttempt}` : ""
  }`;
}

function requireProviderSuccess(result = null, fallbackMessage = "The assistant operation failed.") {
  if (result?.ok !== false) {
    return result || {};
  }
  throw renewalError(
    toText(result.error) || fallbackMessage,
    toText(result.code) || "vibe64_session_renewal_provider_failed",
    {
      details: result.details || null,
      retryable: result.retryable !== false,
      statusCode: Number(result.statusCode) || 409
    }
  );
}

function manualDraftForGenerationError(error = null) {
  const rawOutput = error?.details?.rawOutput;
  if (rawOutput === undefined || rawOutput === null) {
    return "";
  }
  try {
    return renewalHandoverText(String(rawOutput));
  } catch {
    return "";
  }
}

function renewalAssistantSelectionMetadata(state = {}) {
  return {
    [ASSISTANT_ROUTING_METADATA]: JSON.stringify(assistantRoutingPreferences(state.successor?.assistantRouting)),
    [VIBE64_ASSISTANT_SELECTION_METADATA]: serializeVibe64AssistantSelection(
      state.successor?.assistantSelection
    )
  };
}

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} [sessionId]
 */
async function captureReviewConversation(runtime, sessionId = "") {
  return conversationFingerprint(
    await runtime.readConversationLogPage(sessionId, { limit: 1 })
  );
}

/**
 * A renewal's persisted workflow: the handover draft from the old assistant,
 * then, once confirmed, each stage up to the committed successor.
 * @param {object} dependencies
 * @param {RenewalAdmission} dependencies.admission
 * @param {RenewalCompletion} dependencies.completion
 * @param {RenewalPredecessorSession} dependencies.predecessorSession
 * @param {RenewalSessionAccess} dependencies.renewalAccess
 * @param {RenewalRestoration} dependencies.restoration
 * @param {WorkspaceSetupRunner} dependencies.setupRunner
 * @param {RenewalSuccessorSession} dependencies.successorSession
 * @param {TerminalsService} dependencies.terminals
 */
function createRenewalWorkflow({
  admission,
  completion,
  predecessorSession,
  renewalAccess,
  restoration,
  setupRunner,
  successorSession,
  terminals
}) {
  async function generateDraft(sessionId = "", input = {}) {
    admission.assertWorkflowAdmissionOpen();
    const runtime = await renewalAccess.runtimeForRenewal();
    let state = await readSessionRenewalState(runtime, sessionId);
    admission.assertWorkflowAdmissionOpen();
    if (
      !state ||
      state.status !== SESSION_RENEWAL_STATUS.RUNNING ||
      state.stage !== SESSION_RENEWAL_STAGE.DRAFT_GENERATING
    ) {
      return state;
    }
    let basis = state.basis || null;
    try {
      const session = await runtime.getSessionWithoutSource(sessionId);
      const result = requireProviderSuccess(await terminals.generateSessionRenewalHandover(sessionId, {
        operationId: state.generation.operationId,
        source: state.basis?.source || null
      }, {
        beforeStart: async (context = {}) => {
          admission.assertWorkflowAdmissionOpen();
          basis = await inspectSessionRenewalEligibility({
            operationId: operationId(state.renewalId, "eligibility"),
            runtime,
            session: context.session || session,
            setupRunner,
            terminals,
            vibe64User: input.vibe64User
          });
          admission.assertWorkflowAdmissionOpen();
          await mutateSessionRenewalState(runtime, sessionId, (current) => {
            assertSessionRenewalOperation(current, state.operationKey);
            return statePatch(current, { basis });
          });
          admission.assertWorkflowAdmissionOpen();
          return {
            input: {
              expectedThreadId: basis.provider.threadId,
              source: basis.source
            },
            ok: true
          };
        },
        runtime,
        session,
        vibe64User: input.vibe64User
      }), "The old assistant could not prepare a session handover.");
      admission.assertWorkflowAdmissionOpen();
      const handover = toText(result?.handover || result?.output || result?.finalOutput);
      const reviewConversation = await captureReviewConversation(runtime, sessionId);
      admission.assertWorkflowAdmissionOpen();
      state = await mutateSessionRenewalState(runtime, sessionId, (current) => {
        assertSessionRenewalOperation(current, state.operationKey);
        if (current.status === SESSION_RENEWAL_STATUS.CANCELLED) {
          return undefined;
        }
        return statePatch(current, {
          basis: {
            ...basis,
            conversation: reviewConversation
          },
          draft: createSessionRenewalDraft(handover, {
            origin: "generated",
            revision: 1
          }),
          error: null,
          generation: {
            ...current.generation,
            threadId: toText(result?.threadId),
            turnId: toText(result?.turnId)
          },
          stage: SESSION_RENEWAL_STAGE.DRAFT_READY,
          status: SESSION_RENEWAL_STATUS.REVIEW
        });
      });
    } catch (error) {
      if (!admission.isOpen()) {
        throw error;
      }
      if (SESSION_RENEWAL_MANUAL_DRAFT_CODES.has(error?.code)) {
        const reviewConversation = await captureReviewConversation(runtime, sessionId);
        const recoveredDraft = manualDraftForGenerationError(error);
        const manualDraft = recoveredDraft ||
          manualDraftTemplate(terminals, basis || state.basis);
        const manualDraftRecord = createSessionRenewalDraft(manualDraft, {
          origin: "manual",
          revision: 1
        });
        state = await mutateSessionRenewalState(runtime, sessionId, (current) => {
          if (!current || current.status === SESSION_RENEWAL_STATUS.CANCELLED) {
            return undefined;
          }
          return statePatch(current, {
            basis: {
              ...(basis || current.basis || {}),
              conversation: reviewConversation
            },
            draft: manualDraftRecord,
            error: {
              code: toText(error?.code) || SESSION_RENEWAL_THREAD_UNREADABLE_CODE,
              message: recoveredDraft
                ? "The generated handover needs correction. Review and edit it before continuing."
                : "The old assistant could not provide a usable handover. Complete the editable handover template, then review it before continuing.",
              retryable: false
            },
            manualRequired: true,
            manualTemplateHash: manualDraftRecord.hash,
            stage: SESSION_RENEWAL_STAGE.DRAFT_READY,
            status: SESSION_RENEWAL_STATUS.REVIEW
          });
        });
      } else {
        state = await restoration.fail(runtime, sessionId, error);
      }
    }
    if (admission.isOpen()) {
      await renewalAccess.publish(sessionId, "session-renewal-draft-updated", input.originId);
    }
    return state;
  }

  async function resumeConfirmedRenewal(sessionId = "", input = {}) {
    admission.assertWorkflowAdmissionOpen();
    const runtime = await renewalAccess.runtimeForRenewal();
    const state = await readSessionRenewalState(runtime, sessionId);
    admission.assertWorkflowAdmissionOpen();
    if (!state) {
      return state;
    }
    if (
      state.status === SESSION_RENEWAL_STATUS.COMPLETED &&
      state.commit?.committedAt &&
      state.maintenance?.status !== "completed"
    ) {
      return completion.finalizeCommittedRenewal(runtime, state, input);
    }
    if (state.status !== SESSION_RENEWAL_STATUS.RUNNING) {
      return state;
    }
    try {
      return await advanceConfirmedRenewal(runtime, state, input);
    } catch (caughtError) {
      let error = caughtError;
      if (!admission.isOpen()) {
        throw error;
      }
      const current = await readSessionRenewalState(runtime, sessionId);
      if (
        current?.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_SEEDING &&
        SESSION_RENEWAL_DISCARD_SUCCESSOR_CODES.has(error?.code)
      ) {
        try {
          await ensureSuccessorDiscarding(runtime, current, error);
        } catch (transitionError) {
          const failed = await restoration.fail(runtime, sessionId, transitionError);
          if (failed?.status === SESSION_RENEWAL_STATUS.RUNNING) {
            return advanceConfirmedRenewal(runtime, failed, input);
          }
          await renewalAccess.publish(sessionId, "session-renewal-failed", input.originId);
          return failed;
        }
        return resumeConfirmedRenewal(sessionId, input);
      }
      if (
        current?.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_SEEDING &&
        error?.details?.handoverPromptAccepted === true
      ) {
        try {
          const successor = await renewalAccess.readInternalSession(
            runtime,
            current.successor.sessionId
          );
          await terminals.closeRenewalSuccessorSessionTerminals(successor, {
            renewalId: current.renewalId,
            runtime
          });
          await successorSession.assertSuccessorCanonicalState(runtime, current, {
            phase: "handover_delivery"
          });
          const continued = await mutateSessionRenewalState(
            runtime,
            sessionId,
            (latest) => statePatch(latest, {
              error: null,
              stage: SESSION_RENEWAL_STAGE.OLD_ARCHIVING,
              successor: {
                ...latest.successor,
                handoverDeliveredAt: timestamp(),
                handoverError: renewalFailure(error),
                threadId: toText(error?.details?.threadId),
                turnId: toText(error?.details?.turnId)
              }
            })
          );
          return advanceConfirmedRenewal(runtime, continued, input);
        } catch (continuationError) {
          error = continuationError;
        }
      }
      const failed = await restoration.fail(runtime, sessionId, error);
      if (failed?.status === SESSION_RENEWAL_STATUS.RUNNING) {
        return advanceConfirmedRenewal(runtime, failed, input);
      }
      await renewalAccess.publish(sessionId, "session-renewal-failed", input.originId);
      return failed;
    }
  }

  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {object} initialState
   * @param {object} [input]
   */
  async function advanceConfirmedRenewal(runtime, initialState, input = {}) {
    admission.assertWorkflowAdmissionOpen();
    let state = initialState;
    const sessionId = state.sessionId;
    if (state.commit?.committedAt) {
      return completion.finalizeCommittedRenewal(runtime, state, input);
    }
    if (state.stage === SESSION_RENEWAL_STAGE.FAILURE_RESTORING) {
      state = await restoration.completeFailureRestoration(runtime, state);
      admission.assertWorkflowAdmissionOpen();
      return state.status === SESSION_RENEWAL_STATUS.RUNNING
        ? advanceConfirmedRenewal(runtime, state, input)
        : state;
    }
    if (state.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_DISCARDING) {
      await successorSession.cleanupRenewalSuccessor(runtime, state);
      await restoration.restorePreAcknowledgementSource(runtime, state);
      admission.assertWorkflowAdmissionOpen();
      const discardedAttempt = Math.max(1, Number(state.successor?.attempt) || 1);
      const replacementCeiling = Number(state.successor?.replacementCeiling);
      if (
        !Number.isSafeInteger(replacementCeiling) ||
        replacementCeiling < discardedAttempt
      ) {
        throw renewalError(
          "The renewed-session replacement allowance is invalid.",
          "vibe64_session_renewal_state_invalid",
          { retryable: true, statusCode: 500 }
        );
      }
      if (discardedAttempt >= replacementCeiling) {
        throw renewalError(
          "The replacement assistant could not accept the handover. Retry when you are ready to create another replacement.",
          SESSION_RENEWAL_SUCCESSOR_REPLACEMENT_LIMIT_CODE,
          { retryable: true }
        );
      }
      const attempt = discardedAttempt + 1;
      state = await mutateSessionRenewalState(runtime, sessionId, (current) => statePatch(current, {
        error: null,
        stage: SESSION_RENEWAL_STAGE.OLD_QUIESCING,
        status: SESSION_RENEWAL_STATUS.RUNNING,
        successor: {
          assistantSelection: current.successor?.assistantSelection,
          assistantRouting: current.successor?.assistantRouting,
          attempt,
          replacementCeiling
        }
      }));
      return advanceConfirmedRenewal(runtime, state, input);
    }
    if (state.stage === SESSION_RENEWAL_STAGE.OLD_QUIESCING) {
      const sourceStatus = toText(
        await runtime.store.readStatusForRenewal(sessionId)
      );
      if (sourceStatus === VIBE64_SESSION_STATUS.ACTIVE) {
        const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
          admission.assertWorkflowAdmissionOpen();
          const current = await readSessionRenewalState(runtime, sessionId);
          admission.assertWorkflowAdmissionOpen();
          if (
            current?.renewalId !== state.renewalId ||
            current.status !== SESSION_RENEWAL_STATUS.RUNNING ||
            current.stage !== SESSION_RENEWAL_STAGE.OLD_QUIESCING
          ) {
            throw renewalError(
              "The predecessor no longer owns this renewal transition.",
              "vibe64_session_renewal_link_mismatch",
              { retryable: true, statusCode: 500 }
            );
          }
          const idleSession = await predecessorSession.assertPredecessorIdle(runtime, sessionId);
          admission.assertWorkflowAdmissionOpen();
          await predecessorSession.freezePredecessorTerminalAdmission(current);
          await predecessorSession.closePredecessorTerminals(runtime, current, idleSession);
          admission.assertWorkflowAdmissionOpen();
          const session = await runtime.getSessionWithoutSource(sessionId);
          const basis = await inspectSessionRenewalEligibility({
            operationId: operationId(current.renewalId, "resume-quiesce"),
            runtime,
            session,
            setupRunner,
            terminals,
            vibe64User: input.vibe64User
          });
          admission.assertWorkflowAdmissionOpen();
          if (!renewalBasisMatches(basis, current.basis)) {
            throw renewalError(
              "This session changed before renewal could freeze it. Retry to prepare and review a fresh handover.",
              "vibe64_session_renewal_review_stale"
            );
          }
          await runtime.quiesceSessionForRenewal({
            renewalId: current.renewalId,
            sourceSessionId: sessionId
          });
        }, { operation: "quiesce-renewal-source" });
        assertRenewalAgentWriteAcquired(exclusive);
      } else {
        admission.assertWorkflowAdmissionOpen();
        await predecessorSession.freezePredecessorTerminalAdmission(state);
        await predecessorSession.closePredecessorTerminals(runtime, state);
        await runtime.quiesceSessionForRenewal({
          renewalId: state.renewalId,
          sourceSessionId: sessionId
        });
      }
      admission.assertWorkflowAdmissionOpen();
      state = await mutateSessionRenewalState(runtime, sessionId, (current) => statePatch(current, {
        error: null,
        stage: SESSION_RENEWAL_STAGE.SUCCESSOR_CREATING
      }));
    }
    if (state.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_CREATING) {
      const attempt = Math.max(1, Number(state.successor?.attempt) || 1);
      const nextSessionId = toText(state.successor?.sessionId) ||
        successorSessionId(state.renewalId, attempt);
      if (!state.successor?.sessionId) {
        state = await mutateSessionRenewalState(runtime, sessionId, (current) => statePatch(current, {
          successor: {
            ...(current.successor || {}),
            attempt,
            sessionId: nextSessionId
          }
        }));
      }
      const transitionActor = renewalTransitionActor(state);
      admission.assertWorkflowAdmissionOpen();
      const successor = await runtime.createRenewalSession({
        actorDisplayName: transitionActor.name,
        actorId: transitionActor.id,
        confirmedAt: state.approved.updatedAt,
        metadata: renewalAssistantSelectionMetadata(state),
        renewalId: state.renewalId,
        renewedFrom: sessionId,
        sessionId: nextSessionId,
        sourceContext: {
          expectedCommit: state.basis.source.commit,
          expectedSourceRef: state.basis.source.ref,
          vibe64User: input.vibe64User || null
        },
        startedAt: state.createdAt
      });
      admission.assertWorkflowAdmissionOpen();
      assertSuccessorSource(state, successor);
      state = await mutateSessionRenewalState(runtime, sessionId, (current) => statePatch(current, {
        stage: SESSION_RENEWAL_STAGE.SUCCESSOR_SETUP,
        successor: {
          ...(current.successor || {}),
          createdAt: current.successor?.createdAt || timestamp(),
          sessionId: nextSessionId
        }
      }));
    }
    if (state.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_SETUP) {
      const successor = await renewalAccess.readInternalSession(runtime, state.successor.sessionId);
      const setup = await runtime.store.mutateSessionForRenewal(
        successor.sessionId,
        async () => {
          let currentSetup = successor.workspaceSetup || null;
          if (setupRunner.isRunning(successor.sessionId)) {
            currentSetup = await setupRunner.wait(successor.sessionId);
          } else if (!["succeeded", "unconfigured"].includes(toText(currentSetup?.status))) {
            admission.assertWorkflowAdmissionOpen();
            const started = await setupRunner.startRenewal({
              retry: true,
              runtime,
              session: successor
            });
            currentSetup = started?.completion
              ? await started.completion
              : started?.state || currentSetup;
          }
          return currentSetup;
        }
      );
      admission.assertWorkflowAdmissionOpen();
      if (!["succeeded", "unconfigured"].includes(toText(setup?.status))) {
        throw renewalError(
          toText(setup?.error) || "The renewed session workspace is not ready.",
          "vibe64_session_renewal_successor_setup_failed",
          { retryable: true }
        );
      }
      await successorSession.assertSuccessorCanonicalState(runtime, state, {
        phase: "workspace_setup"
      });
      admission.assertWorkflowAdmissionOpen();
      state = await mutateSessionRenewalState(runtime, sessionId, (current) => statePatch(current, {
        stage: SESSION_RENEWAL_STAGE.SUCCESSOR_SEEDING,
        successor: {
          ...current.successor,
          setupCompletedAt: timestamp()
        }
      }));
    }
    if (state.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_SEEDING) {
      const successor = await renewalAccess.readInternalSession(runtime, state.successor.sessionId);
      admission.assertWorkflowAdmissionOpen();
      const seedOperationId = state.successor.seedOperationId || operationId(
        state.renewalId,
        `seed-${Math.max(1, Number(state.successor.attempt) || 1)}`
      );
      if (!state.successor.seedOperationId) {
        state = await mutateSessionRenewalState(runtime, sessionId, (current) => statePatch(current, {
          successor: {
            ...current.successor,
            seedOperationId
          }
        }));
      }
      const seeded = requireProviderSuccess(await terminals.seedSessionRenewalHandover(successor.sessionId, {
        expectedThreadId: toText(state.successor.threadId),
        forbiddenThreadId: toText(state.basis?.provider?.threadId),
        handover: state.approved.text,
        handoverHash: state.approved.hash,
        operationId: seedOperationId,
        source: state.basis.source
      }, {
        runtime,
        session: successor,
        vibe64User: input.vibe64User
      }), "The fresh assistant thread could not accept the session handover.");
      admission.assertWorkflowAdmissionOpen();
      await successorSession.assertSuccessorCanonicalState(runtime, state, {
        phase: "acknowledgement"
      });
      admission.assertWorkflowAdmissionOpen();
      const { acknowledgement } = seeded;
      state = await mutateSessionRenewalState(runtime, sessionId, (current) => statePatch(current, {
        stage: SESSION_RENEWAL_STAGE.SUCCESSOR_ACKNOWLEDGED,
        successor: {
          ...current.successor,
          acknowledgedAt: toText(seeded.acknowledgedAt) || timestamp(),
          acknowledgement: {
            handoverHash: toText(acknowledgement.handoverHash),
            message: toText(acknowledgement.message),
            sourceCommit: toText(acknowledgement.sourceCommit)
          },
          threadId: toText(seeded.threadId),
          turnId: toText(seeded.turnId)
        }
      }));
    }
    if (state.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_ACKNOWLEDGED) {
      state = await mutateSessionRenewalState(runtime, sessionId, (current) => statePatch(current, {
        stage: SESSION_RENEWAL_STAGE.OLD_ARCHIVING
      }));
    }
    if (state.stage === SESSION_RENEWAL_STAGE.OLD_ARCHIVING) {
      state = await completion.completeRenewalArchive(runtime, state);
      admission.assertWorkflowAdmissionOpen();
      return completion.finalizeCompletedRenewal(runtime, state, input);
    }
    if (state.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_ACTIVATING) {
      return completion.finalizeCompletedRenewal(runtime, state, input);
    }
    return state;
  }

  return Object.freeze({ generateDraft, resumeConfirmedRenewal });
}

export { createRenewalWorkflow };
