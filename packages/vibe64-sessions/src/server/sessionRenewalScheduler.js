import {
  SESSION_RENEWAL_STAGE,
  SESSION_RENEWAL_STATUS,
  readSessionRenewalState
} from "./sessionRenewalState.js";
import { actorFromUser, renewalActorsMatch, renewalTransitionActor } from "./sessionRenewalRules.js";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("./types.js").RenewalAdmission} RenewalAdmission */
/** @typedef {import("./types.js").RenewalSessionAccess} RenewalSessionAccess */
/** @typedef {import("./types.js").RenewalRestoration} RenewalRestoration */
/** @typedef {import("./types.js").RenewalActorRestoration} RenewalActorRestoration */
/** @typedef {ReturnType<typeof import("./sessionRenewalWorkflow.js").createRenewalWorkflow>} RenewalWorkflow */

const SESSION_RENEWAL_WORKFLOW_LOCK_RETRY_MS = 1_000;

const SESSION_RENEWAL_COMPLETION_RETRY_MAX_MS = 30_000;

function renewalNeedsWorkflow(state) {
  return state?.status === SESSION_RENEWAL_STATUS.RUNNING || (
    state?.status === SESSION_RENEWAL_STATUS.COMPLETED &&
    Boolean(state.commit?.committedAt) &&
    state.maintenance?.status !== "completed"
  );
}

function stoppedRecoveryResult({ discoveredSessionIds = [] } = {}) {
  return {
    discoveredSessionIds,
    failures: [],
    resumedSessionIds: []
  };
}

/**
 * When a renewal's workflow runs: after each operation, again after a lock
 * miss or failure with bounded backoff, and on startup recovery, as the actor
 * the renewal persisted.
 * @param {object} dependencies
 * @param {RenewalAdmission} dependencies.admission
 * @param {typeof clearTimeout} dependencies.clearTimeoutFn
 * @param {RenewalSessionAccess} dependencies.renewalAccess
 * @param {RenewalRestoration} dependencies.restoration
 * @param {RenewalActorRestoration} dependencies.restoreRenewalActor
 * @param {typeof setTimeout} dependencies.setTimeoutFn
 * @param {RenewalWorkflow} dependencies.workflow
 * @param {number} dependencies.workflowLockRetryMs
 */
function createRenewalScheduler({
  admission,
  clearTimeoutFn,
  renewalAccess,
  restoration,
  restoreRenewalActor,
  setTimeoutFn,
  workflow,
  workflowLockRetryMs
}) {
  const pendingWorkflowLockRetries = new Map();
  const workflowLockRetryDelayMs = Math.max(
    1,
    Number(workflowLockRetryMs) || SESSION_RENEWAL_WORKFLOW_LOCK_RETRY_MS
  );

  function clearWorkflowLockRetry(renewalId = "") {
    const key = toText(renewalId);
    const timer = pendingWorkflowLockRetries.get(key);
    if (!timer) {
      return false;
    }
    clearTimeoutFn(timer);
    pendingWorkflowLockRetries.delete(key);
    return true;
  }

  function scheduleWorkflowLockRetry(state = {}, input = {}) {
    const key = toText(state.renewalId);
    if (!key) {
      throw new TypeError("Session renewal workflow lock retry requires a renewal id.");
    }
    if (!admission.isOpen() || !renewalNeedsWorkflow(state)) {
      clearWorkflowLockRetry(key);
      return false;
    }
    if (pendingWorkflowLockRetries.has(key)) {
      return false;
    }
    const completionRetryAttempt = state.status === SESSION_RENEWAL_STATUS.COMPLETED
      ? Math.max(0, Number(state.maintenance?.attempt) || 0)
      : state.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_ACTIVATING
        ? Math.max(0, Number(state.completionRetry?.attempt) || 0)
        : 0;
    const retryDelayMs = completionRetryAttempt > 0
      ? Math.min(
          workflowLockRetryDelayMs * (2 ** Math.min(completionRetryAttempt - 1, 10)),
          SESSION_RENEWAL_COMPLETION_RETRY_MAX_MS
        )
      : workflowLockRetryDelayMs;
    const timer = setTimeoutFn(() => {
      if (pendingWorkflowLockRetries.get(key) !== timer) {
        return;
      }
      pendingWorkflowLockRetries.delete(key);
      if (!admission.isOpen()) {
        return;
      }
      void admission.runOnce(
        state,
        () => runPersistedRenewalWorkflow(state.sessionId, input)
      ).catch(() => {
        // Durable state remains authoritative. A lock miss schedules the next
        // bounded retry; a real workflow failure is persisted by the runner.
      });
    }, retryDelayMs);
    // readable-check: allow optional-call - platform object: an injected timer need not be a Node timer
    timer.unref?.();
    pendingWorkflowLockRetries.set(key, timer);
    return true;
  }

  async function workflowInputForPersistedActor(state, input = {}) {
    const persistedActor = renewalTransitionActor(state);
    const requestActor = input.vibe64User
      ? actorFromUser(input.vibe64User)
      : null;
    if (requestActor && renewalActorsMatch(requestActor, persistedActor)) {
      return {
        ...input,
        vibe64User: input.vibe64User
      };
    }
    return restoreRenewalActor(state, input, { persistedActor, requestActor });
  }

  async function runPersistedRenewalWorkflow(sessionId = "", input = {}) {
    if (!admission.isOpen()) {
      return null;
    }
    const runtime = await renewalAccess.runtimeForRenewal();
    try {
      const exclusive = await runtime.store.runSessionRenewalWorkflowExclusive(
        sessionId,
        async () => {
        const current = await readSessionRenewalState(runtime, sessionId);
        if (!renewalNeedsWorkflow(current)) {
          return current;
        }
        if (current.stage === SESSION_RENEWAL_STAGE.FAILURE_RESTORING) {
          return workflow.resumeConfirmedRenewal(sessionId, input);
        }
        if (current.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_ACTIVATING) {
          // A durable commit marker makes this forward-only. Without it the
          // archive, hidden activation, and selection preparation remain
          // reversible and still require the persisted actor.
          if (!current.commit?.committedAt) {
            const workflowInput = await workflowInputForPersistedActor(current, input);
            return workflow.resumeConfirmedRenewal(sessionId, workflowInput);
          }
          return workflow.resumeConfirmedRenewal(sessionId, input);
        }
        if (current.status === SESSION_RENEWAL_STATUS.COMPLETED) {
          return workflow.resumeConfirmedRenewal(sessionId, input);
        }
        const workflowInput = await workflowInputForPersistedActor(current, input);
        return current.stage === SESSION_RENEWAL_STAGE.DRAFT_GENERATING
          ? workflow.generateDraft(sessionId, workflowInput)
          : workflow.resumeConfirmedRenewal(sessionId, workflowInput);
        },
        { waitMs: 0 }
      );
      if (exclusive.acquired) {
        if (admission.isOpen() && renewalNeedsWorkflow(exclusive.value)) {
          scheduleWorkflowLockRetry(exclusive.value, input);
        } else {
          clearWorkflowLockRetry(exclusive.value?.renewalId);
        }
        return exclusive.value;
      }
      const observed = await readSessionRenewalState(runtime, sessionId);
      if (admission.isOpen() && renewalNeedsWorkflow(observed)) {
        scheduleWorkflowLockRetry(observed, input);
      } else {
        clearWorkflowLockRetry(observed?.renewalId);
      }
      return observed;
    } catch (error) {
      if (!admission.isOpen()) {
        throw error;
      }
      const failed = await restoration.fail(runtime, sessionId, error);
      if (renewalNeedsWorkflow(failed)) {
        scheduleWorkflowLockRetry(failed, input);
        return failed;
      }
      clearWorkflowLockRetry(failed?.renewalId);
      await renewalAccess.publish(sessionId, "session-renewal-failed", input.originId);
      return failed;
    }
  }

  async function schedule(state, input = {}) {
    if (!admission.isOpen() || !renewalNeedsWorkflow(state)) {
      clearWorkflowLockRetry(state?.renewalId);
      return;
    }
    void admission.runOnce(
      state,
      () => runPersistedRenewalWorkflow(state.sessionId, input)
    ).catch(() => {
      // The durable state remains authoritative; inspection or startup
      // recovery retries the exact persisted stage.
    });
  }

  async function resumeSessionRenewalsNow(input = {}) {
    if (!admission.isOpen()) {
      return stoppedRecoveryResult();
    }
    const runtime = await renewalAccess.runtimeForRenewal();
    if (!admission.isOpen()) {
      return stoppedRecoveryResult();
    }
    const candidateSessionIds = await runtime.store.listSessionRenewalStateSessionIds();
    if (!admission.isOpen()) {
      return stoppedRecoveryResult();
    }
    const reads = await Promise.allSettled(candidateSessionIds.map(async (sessionId) => ({
      sessionId,
      state: await readSessionRenewalState(runtime, sessionId)
    })));
    const states = reads
      .filter((result) => result.status === "fulfilled" && result.value.state)
      .map((result) => result.value.state);
    if (!admission.isOpen()) {
      return stoppedRecoveryResult({
        discoveredSessionIds: states.map((state) => state.sessionId)
      });
    }
    const resumableStates = states.filter(renewalNeedsWorkflow);
    const resumes = await Promise.allSettled(resumableStates.map((state) => admission.runOnce(
      state,
      () => runPersistedRenewalWorkflow(state.sessionId, input)
    )));
    const failures = [
      ...reads.flatMap((result, index) => result.status === "rejected"
        ? [{
            code: toText(result.reason?.code) || "vibe64_session_renewal_state_unreadable",
            error: toText(result.reason?.message) || "Session renewal state is unreadable.",
            sessionId: candidateSessionIds[index]
          }]
        : []),
      ...resumes.flatMap((result, index) => result.status === "rejected"
        ? [{
            code: toText(result.reason?.code) || "vibe64_session_renewal_resume_failed",
            error: toText(result.reason?.message) || "Session renewal could not resume.",
            sessionId: resumableStates[index].sessionId
          }]
        : [])
    ];
    return {
      discoveredSessionIds: states.map((state) => state.sessionId),
      failures,
      resumedSessionIds: resumableStates.map((state) => state.sessionId)
    };
  }

  function resumeSessionRenewals(input = {}) {
    if (!admission.isOpen()) {
      return Promise.resolve(stoppedRecoveryResult());
    }
    return admission.trackRecovery(resumeSessionRenewalsNow(input));
  }

  async function closeSessionRenewalWork() {
    admission.stop();
    for (const timer of pendingWorkflowLockRetries.values()) {
      clearTimeoutFn(timer);
    }
    pendingWorkflowLockRetries.clear();
    return admission.drain();
  }

  return Object.freeze({
    clearWorkflowLockRetry,
    closeSessionRenewalWork,
    resumeSessionRenewals,
    schedule
  });
}

export { SESSION_RENEWAL_WORKFLOW_LOCK_RETRY_MS, createRenewalScheduler };
