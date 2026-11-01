import crypto from "node:crypto";
import { SESSION_SAVE_TASK_ID, SESSION_UPDATE_TASK_ID } from "@local/vibe64-terminals/server/sessionWorkTasks";
import { normalizeText, vibe64Error } from "@local/vibe64-core/server/core";
import { VIBE64_SESSION_STATUS, vibe64AgentRunStateIsActive } from "@local/vibe64-runtime/server/sessionStore";
import {
  SESSION_RENEWAL_STAGE,
  publicSessionRenewalState
} from "./sessionRenewalState.js";

/** @typedef {import("./types.js").WorkspaceSetupRunner} WorkspaceSetupRunner */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */

// The rules every renewal step shares: its errors and identities, the actor it
// runs as, and the eligibility and source checks a renewal repeats.

const SESSION_RENEWAL_SUCCESSOR_SOURCE_INVALID_CODE =
  "vibe64_session_renewal_successor_source_invalid";

const SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE = Object.freeze({
  DISCARD: "discard",
  PROOF_AUTHORIZATION: "proof_authorization",
  PROOF_RELEASE: "proof_release",
  RESOURCE_RELEASE: "resource_release",
  SUCCESSOR_READ: "successor_read",
  TERMINAL_CLOSE: "terminal_close",
  TRANSITION: "transition"
});

const SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASES = new Set(
  Object.values(SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE)
);

const SESSION_RENEWAL_PRE_ACKNOWLEDGEMENT_STAGES = new Set([
  SESSION_RENEWAL_STAGE.OLD_ARCHIVING,
  SESSION_RENEWAL_STAGE.OLD_QUIESCING,
  SESSION_RENEWAL_STAGE.SUCCESSOR_CREATING,
  SESSION_RENEWAL_STAGE.SUCCESSOR_DISCARDING,
  SESSION_RENEWAL_STAGE.SUCCESSOR_ACKNOWLEDGED,
  SESSION_RENEWAL_STAGE.SUCCESSOR_ACTIVATING,
  SESSION_RENEWAL_STAGE.SUCCESSOR_SEEDING,
  SESSION_RENEWAL_STAGE.SUCCESSOR_SETUP
]);

function renewalError(message, code, options = {}) {
  const {
    details = null,
    retryable = false,
    statusCode = 409
  } = options;
  const error = vibe64Error(message, code);
  error.retryable = retryable;
  error.statusCode = statusCode;
  if (details) {
    error.details = details;
  }
  return error;
}

function timestamp() {
  return new Date().toISOString();
}

function actorFromUser(user = null) {
  const source = user && typeof user === "object" && !Array.isArray(user)
    ? user
    : {};
  const name = normalizeText(source.displayName || source.name || source.username) ||
    "Local user";
  const id = normalizeText(source.id || source.userId || source.username) || "local-user";
  return { id, name };
}

function operationId(renewalId = "", kind = "operation") {
  const digest = crypto.createHash("sha256")
    .update(`${normalizeText(renewalId)}\0${normalizeText(kind)}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return `renewal:${kind}:${digest}`;
}

function conversationFingerprint(page = {}) {
  const pagination = page.pagination && typeof page.pagination === "object"
    ? page.pagination
    : {};
  return {
    newestTurnId: normalizeText(pagination.newestTurnId),
    totalTurnCount: Number.isSafeInteger(Number(pagination.totalTurnCount))
      ? Number(pagination.totalTurnCount)
      : 0
  };
}

function fingerprintsMatch(left = {}, right = {}) {
  return normalizeText(left.newestTurnId) === normalizeText(right.newestTurnId) &&
    Number(left.totalTurnCount || 0) === Number(right.totalTurnCount || 0);
}

function sourceEnvelopesMatch(left, right) {
  return ["authority", "commit", "ref", "repository"]
    .every((name) => normalizeText(left?.[name]) === normalizeText(right?.[name]));
}

/**
 * @param {TerminalsService} terminals
 * @param {object | null} [basis]
 */
function manualDraftTemplate(terminals, basis = null) {
  if (!basis?.source) {
    return "";
  }
  return terminals.createSessionRenewalManualHandoverTemplate({
    source: basis.source
  });
}

function sessionHasActiveAgentRun(session = {}) {
  return (Array.isArray(session.agentRuns) ? session.agentRuns : [])
    .some((run) => vibe64AgentRunStateIsActive(run?.state) || (
      run?.providerGoalStatus === "active" && run.providerGoalThreadId &&
      run.providerGoalThreadId === run.providerThreadId
    ));
}

/**
 * @param {object} session
 * @param {WorkspaceSetupRunner} setupRunner
 */
function assertWorkspaceIdle(session, setupRunner) {
  if (setupRunner.isRunning(session.sessionId)) {
    throw renewalError(
      "Wait for workspace preparation to finish before renewing this session.",
      "vibe64_session_renewal_setup_running",
      { retryable: true }
    );
  }
  if (normalizeText(session.workspaceSetup?.status) === "running") {
    throw renewalError(
      "Wait for workspace preparation to finish before renewing this session.",
      "vibe64_session_renewal_setup_running",
      { retryable: true }
    );
  }
  if (sessionHasActiveAgentRun(session)) {
    throw renewalError(
      "Wait for the assistant turn to finish before renewing this session.",
      "vibe64_session_renewal_agent_active",
      { retryable: true }
    );
  }
}

/**
 * @param {Vibe64SessionRuntime} runtime
 * @param {string} [sessionId]
 */
async function assertNoRepositoryOperation(runtime, sessionId = "") {
  const [save, update] = await Promise.all([
    runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID),
    runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID)
  ]);
  if (save?.status === "running" || update?.status === "running") {
    throw renewalError(
      "Wait for Save or Update to finish before renewing this session.",
      "vibe64_session_renewal_repository_operation_running",
      { retryable: true }
    );
  }
}

function assertCanonicalClean(check = {}, work = {}) {
  const canonicalCommit = normalizeText(check.canonicalCommit || work.canonicalCommit).toLowerCase();
  const sessionHead = normalizeText(work.sessionHead).toLowerCase();
  const changedPaths = Array.isArray(work.changedPaths) ? work.changedPaths : [];
  const current = check.sessionCurrent === true || (
    normalizeText(check.relationship) === "current" && check.updateAvailable !== true
  );
  if (
    !canonicalCommit ||
    !sessionHead ||
    canonicalCommit !== sessionHead ||
    normalizeText(work.canonicalCommit).toLowerCase() !== canonicalCommit ||
    work.dirty === true ||
    work.unsaved === true ||
    work.sessionMatchesCanonical !== true ||
    changedPaths.length > 0 ||
    !current
  ) {
    throw renewalError(
      "Save this session and bring it fully up to date before renewing it.",
      "vibe64_session_renewal_source_not_ready",
      {
        retryable: true,
        details: {
          canonicalCommit,
          changedPaths,
          relationship: normalizeText(check.relationship || work.relationship),
          sessionHead
        }
      }
    );
  }
  return canonicalCommit;
}

async function inspectSessionRenewalEligibility({
  operationId: repositoryOperationId = crypto.randomUUID(),
  runtime,
  session,
  setupRunner,
  terminals,
  vibe64User = null
} = {}) {
  if (!session || normalizeText(session.status) !== VIBE64_SESSION_STATUS.ACTIVE) {
    throw renewalError(
      "Only an active session can be renewed.",
      "vibe64_session_renewal_source_not_active"
    );
  }
  if (session.pinnedSessionId === session.sessionId) {
    throw renewalError("Unpin this session before renewing it.", "vibe64_session_pinned");
  }
  assertWorkspaceIdle(session, setupRunner);
  await assertNoRepositoryOperation(runtime, session.sessionId);
  const check = await terminals.checkSessionUpdates(session.sessionId, {
    force: true,
    operationId: repositoryOperationId,
    runtime,
    session,
    vibe64User
  });
  const refreshedSession = await runtime.getSession(session.sessionId, {
    inspectSource: false
  });
  const work = await terminals.inspectSessionWork(session.sessionId, {
    runtime,
    session: refreshedSession
  });
  const canonicalCommit = assertCanonicalClean(check, work);
  const source = check.canonicalSource;
  if (
    !source?.authority ||
    !source.ref ||
    (source.authority !== "local_source" && !source.repository) ||
    source.commit !== canonicalCommit
  ) {
    throw renewalError(
      "The project's canonical source authority could not be verified.",
      "vibe64_session_renewal_source_invalid"
    );
  }
  const conversation = conversationFingerprint(
    await runtime.readConversationLogPage(session.sessionId, { limit: 1 })
  );
  return {
    canonicalCommit,
    conversation,
    provider: {
      threadId: normalizeText(refreshedSession.metadata?.agent_identity_conversation_id)
    },
    source,
    verifiedAt: timestamp()
  };
}

function statePatch(state = {}, patch = {}) {
  return {
    ...state,
    ...patch,
    updatedAt: timestamp()
  };
}

function renewalBasisMatches(left = {}, right = {}) {
  return normalizeText(left.canonicalCommit).toLowerCase() ===
      normalizeText(right.canonicalCommit).toLowerCase() &&
    sourceEnvelopesMatch(left.source, right.source) &&
    fingerprintsMatch(left.conversation, right.conversation);
}

function renewalTransitionActor(state = {}) {
  return actorFromUser(state.continuedBy || state.confirmedBy || state.actor);
}

function renewalActorsMatch(left = {}, right = {}) {
  const leftActor = actorFromUser(left);
  const rightActor = actorFromUser(right);
  return leftActor.id && rightActor.id
    ? leftActor.id === rightActor.id
    : leftActor.name === rightActor.name;
}

function renewalViewerScope(vibe64User = null) {
  const actor = actorFromUser(vibe64User);
  return `viewer-v1-${crypto.createHash("sha256")
    .update(actor.id, "utf8")
    .digest("hex")
    .slice(0, 32)}`;
}

function publicRenewalResult(state = null, extra = {}, vibe64User = null) {
  return {
    ...extra,
    ok: true,
    renewal: publicSessionRenewalState(state),
    viewerScope: renewalViewerScope(vibe64User)
  };
}

function assertRenewalAgentWriteAcquired(exclusive = {}) {
  if (exclusive.acquired) {
    return exclusive.value;
  }
  throw renewalError(
    normalizeText(exclusive.value?.error) ||
      "Another assistant operation is starting. Try again in a moment.",
    normalizeText(exclusive.value?.code) || "vibe64_session_renewal_agent_busy",
    { retryable: true }
  );
}

function renewalFailure(error) {
  const failure = {
    code: normalizeText(error?.code) || "vibe64_session_renewal_failed",
    message: normalizeText(error?.message) || "Session renewal needs attention.",
    retryable: error?.retryable !== false
  };
  const diagnostic = error?.renewalDiagnostic;
  const phase = normalizeText(diagnostic?.phase);
  if (SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASES.has(phase)) {
    failure.details = {
      causeCode: normalizeText(diagnostic?.causeCode) || "vibe64_session_renewal_unknown_failure",
      phase
    };
  }
  return failure;
}

export {
  SESSION_RENEWAL_PRE_ACKNOWLEDGEMENT_STAGES,
  SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE,
  SESSION_RENEWAL_SUCCESSOR_SOURCE_INVALID_CODE,
  actorFromUser,
  assertRenewalAgentWriteAcquired,
  assertWorkspaceIdle,
  conversationFingerprint,
  inspectSessionRenewalEligibility,
  manualDraftTemplate,
  operationId,
  publicRenewalResult,
  renewalActorsMatch,
  renewalBasisMatches,
  renewalError,
  renewalFailure,
  renewalTransitionActor,
  sessionHasActiveAgentRun,
  sourceEnvelopesMatch,
  statePatch,
  timestamp
};
