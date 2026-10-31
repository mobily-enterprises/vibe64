import { normalizeText } from "@local/vibe64-core/server/core";
import { renewalError } from "./sessionRenewalRules.js";

/**
 * The renewal work this process admits: one run per renewal and per
 * confirmation, the mutations and recovery scans in flight, and closing, which
 * admits nothing new and waits for what is running.
 */
function createRenewalAdmission() {
  const activeOperations = new Map();
  const activeMutationEntries = new Set();
  const activeRecoveryScans = new Set();
  const confirmationOperations = new Map();
  let closePromise = null;
  let workflowAdmissionOpen = true;

  function isOpen() {
    return workflowAdmissionOpen;
  }

  function runOnce(state = {}, operation) {
    const key = normalizeText(state.renewalId);
    if (!key) {
      throw new TypeError("Session renewal workflow scheduling requires a renewal id.");
    }
    if (!workflowAdmissionOpen) {
      return Promise.resolve(state);
    }
    const current = activeOperations.get(key);
    if (current) {
      return current;
    }
    const running = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (activeOperations.get(key) === running) {
          activeOperations.delete(key);
        }
      });
    activeOperations.set(key, running);
    return running;
  }

  async function runConfirmationOnce(renewalId = "", input = {}, operation) {
    assertWorkflowAdmissionOpen();
    const key = [
      normalizeText(renewalId),
      normalizeText(input.operationKey),
      normalizeText(input.expectedHash),
      Number(input.expectedRevision)
    ].join(":");
    const current = confirmationOperations.get(key);
    if (current) {
      return current;
    }
    const confirming = Promise.resolve().then(operation);
    confirmationOperations.set(key, confirming);
    try {
      return await confirming;
    } finally {
      if (confirmationOperations.get(key) === confirming) {
        confirmationOperations.delete(key);
      }
    }
  }

  function assertWorkflowAdmissionOpen() {
    if (workflowAdmissionOpen) {
      return;
    }
    throw renewalError(
      "Session renewal work is stopping with the server.",
      "vibe64_session_renewal_closing",
      { retryable: true, statusCode: 503 }
    );
  }

  function admitMutation(operation) {
    return (...args) => {
      assertWorkflowAdmissionOpen();
      const running = Promise.resolve().then(() => operation(...args));
      activeMutationEntries.add(running);
      void running.then(
        () => activeMutationEntries.delete(running),
        () => activeMutationEntries.delete(running)
      );
      return running;
    };
  }

  function trackRecovery(recovery) {
    activeRecoveryScans.add(recovery);
    void recovery.then(
      () => activeRecoveryScans.delete(recovery),
      () => activeRecoveryScans.delete(recovery)
    );
    return recovery;
  }

  function stop() {
    workflowAdmissionOpen = false;
  }

  function drain() {
    if (!closePromise) {
      closePromise = (async () => {
        while (
          activeMutationEntries.size > 0 ||
          activeRecoveryScans.size > 0 ||
          activeOperations.size > 0 ||
          confirmationOperations.size > 0
        ) {
          await Promise.allSettled(new Set([
            ...activeMutationEntries,
            ...activeRecoveryScans,
            ...activeOperations.values(),
            ...confirmationOperations.values()
          ]));
        }
      })();
    }
    return closePromise;
  }

  return Object.freeze({ admitMutation, assertWorkflowAdmissionOpen, drain, isOpen, runConfirmationOnce, runOnce, stop, trackRecovery });
}

export { createRenewalAdmission };
