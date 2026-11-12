// The workspace setup state written to a session: each update stamped with
// the time it is written, unchanged inspections left as they are, and failures
// recorded with their label, diagnostic and transcript.

import { sanitizeOperationText } from "@local/vibe64-core/server/logging";
import {
  workspaceSetupState,
  writeWorkspaceSetupState
} from "@local/vibe64-runtime/server/workspaceSetupState";

import {
  appendWorkspaceSetupTranscript,
  safeSetupLabel,
  stepStatus
} from "./workspaceSetupRules.js";

/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} sessionId
 * @param {object} value
 * @param {boolean} [renewal]
 */
async function persist(runtime, sessionId, value, renewal = false) {
  return writeWorkspaceSetupState(runtime.store, sessionId, {
    ...value,
    updatedAt: new Date().toISOString()
  }, {
    renewal
  });
}

async function persistInspectedState(runtime, sessionId, previous, value, renewal = false) {
  const next = workspaceSetupState({
    transcript: previous.transcript,
    ...value
  });
  const unchanged = [
    "currentLabel",
    "diagnostic",
    "recipeHash",
    "status",
    "transcript"
  ].every((name) => previous[name] === next[name]);
  return unchanged && previous.status !== "running"
    ? previous
    : persist(runtime, sessionId, next, renewal);
}

/**
 * A run that did not prepare the workspace. `stepOutcome` is how its last step ended in the output:
 * Failed, or Cancelled for a run Cancel stopped. `preparedSteps` are the step records still true.
 */
async function failed(runtime, sessionId, options = {}) {
  const {
    currentLabel = "",
    diagnostic = "Workspace preparation failed.",
    preparedSteps = [],
    recipeHash = "",
    redactionSecrets = [],
    resourceAdmissionId = "",
    renewal = false,
    runtimes = [],
    startedAt = "",
    stepOutcome = "Failed",
    transcript = ""
  } = options;
  const safeLabel = safeSetupLabel(currentLabel, redactionSecrets);
  const safeDiagnostic = sanitizeOperationText(diagnostic, redactionSecrets);
  return persist(runtime, sessionId, {
    currentLabel: safeLabel,
    diagnostic: safeDiagnostic,
    finishedAt: new Date().toISOString(),
    preparedSteps,
    recipeHash,
    resourceAdmissionId,
    runtimes,
    startedAt,
    status: "failed",
    transcript: appendWorkspaceSetupTranscript(
      sanitizeOperationText(transcript, redactionSecrets),
      stepStatus(safeLabel, stepOutcome, redactionSecrets)
    )
  }, renewal);
}

export {
  failed,
  persist,
  persistInspectedState
};
