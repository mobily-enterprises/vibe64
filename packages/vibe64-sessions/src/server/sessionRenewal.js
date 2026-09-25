import crypto from "node:crypto";
import path from "node:path";
import { ASSISTANT_ROUTING_METADATA, assistantRoutingPreferences } from "@local/vibe64-runtime/shared/assistantRouting";

import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  runVibe64AgentWriteExclusive,
  runVibe64RenewalAgentWriteExclusive
} from "@local/vibe64-runtime/server/agentWriteLock";
import {
  VIBE64_ASSISTANT_SELECTION_METADATA,
  serializeVibe64AssistantSelection
} from "@local/vibe64-runtime/shared";
import {
  VIBE64_SESSION_STATUS,
  vibe64AgentRunStateIsActive
} from "@local/vibe64-runtime/server/sessionStore";
import {
  SESSION_RENEWAL_MAINTENANCE_STEP,
  SESSION_RENEWAL_STAGE,
  SESSION_RENEWAL_STATUS,
  assertSessionRenewalDraftVersion,
  assertSessionRenewalOperation,
  createSessionRenewalDraft,
  createSessionRenewalState,
  mutateSessionRenewalState,
  publicSessionRenewalState,
  readSessionRenewalState,
  renewalHandoverText,
  writeSessionRenewalState
} from "./sessionRenewalState.js";

const SESSION_SAVE_TASK_ID = "save-work";
const SESSION_UPDATE_TASK_ID = "update-session";
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
const SESSION_RENEWAL_SUCCESSOR_SOURCE_INVALID_CODE =
  "vibe64_session_renewal_successor_source_invalid";
const SESSION_RENEWAL_SUCCESSOR_REPLACEMENT_LIMIT_CODE =
  "vibe64_session_renewal_successor_replacement_limit_reached";
const SESSION_RENEWAL_WORKFLOW_LOCK_RETRY_MS = 1_000;
const SESSION_RENEWAL_COMPLETION_RETRY_MAX_MS = 30_000;
const SESSION_RENEWAL_SUCCESSOR_PROCESS_EXIT_PROOF_RELEASE_ARTIFACT =
  "renewal/successor-process-exit-proof-release.json";
const SESSION_RENEWAL_SUCCESSOR_PROCESS_EXIT_PROOF_RELEASE_KIND =
  "vibe64.session_renewal_successor_process_exit_proof_release";
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

function renewalError(message, code, {
  details = null,
  retryable = false,
  statusCode = 409
} = {}) {
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

function successorSessionId(renewalId = "", attempt = 1) {
  const suffix = normalizeText(renewalId)
    .replace(/[^A-Za-z0-9]/gu, "")
    .slice(0, 48);
  const normalizedAttempt = Math.max(1, Number(attempt) || 1);
  return `renewal-${suffix || crypto.randomUUID().replaceAll("-", "")}${
    normalizedAttempt > 1 ? `-${normalizedAttempt}` : ""
  }`;
}

function conversationFingerprint(page = {}) {
  const pagination = page?.pagination && typeof page.pagination === "object"
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

function sourceEnvelopesMatch(left = {}, right = {}) {
  return ["authority", "commit", "ref", "repository"]
    .every((name) => normalizeText(left?.[name]) === normalizeText(right?.[name]));
}

function requireProviderSuccess(result = null, fallbackMessage = "The assistant operation failed.") {
  if (result?.ok !== false) {
    return result || {};
  }
  throw renewalError(
    normalizeText(result.error) || fallbackMessage,
    normalizeText(result.code) || "vibe64_session_renewal_provider_failed",
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

function manualDraftTemplate(terminals, basis = null) {
  if (!basis?.source) {
    return "";
  }
  if (typeof terminals.createSessionRenewalManualHandoverTemplate !== "function") {
    throw new TypeError("Session renewal requires the canonical manual handover template.");
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

function renewalAssistantSelectionMetadata(state = {}) {
  return {
    [ASSISTANT_ROUTING_METADATA]: JSON.stringify(assistantRoutingPreferences(state.successor?.assistantRouting)),
    [VIBE64_ASSISTANT_SELECTION_METADATA]: serializeVibe64AssistantSelection(
      state.successor?.assistantSelection
    )
  };
}

function assertWorkspaceIdle(session = {}, setupRunner = null) {
  if (setupRunner?.isRunning?.(session.sessionId)) {
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

function createSessionRenewalController({
  clearTimeoutFn = clearTimeout,
  prepareArchive = null,
  project,
  publishSessionChanged = async () => null,
  resolveRenewalActor = null,
  resolveSuccessorAssistant = null,
  setTimeoutFn = setTimeout,
  setupRunner,
  terminals,
  workflowLockRetryMs = SESSION_RENEWAL_WORKFLOW_LOCK_RETRY_MS
} = {}) {
  if (!project || !terminals || !setupRunner) {
    throw new TypeError("Session renewal requires project, terminal, and setup services.");
  }
  if (prepareArchive !== null && typeof prepareArchive !== "function") {
    throw new TypeError("Session archive preparation must be a function or null.");
  }
  if (
    resolveSuccessorAssistant !== null &&
    typeof resolveSuccessorAssistant !== "function"
  ) {
    throw new TypeError("Session renewal assistant selection resolver must be a function or null.");
  }
  const activeOperations = new Map();
  const activeMutationEntries = new Set();
  const activeRecoveryScans = new Set();
  const confirmationOperations = new Map();
  const pendingWorkflowLockRetries = new Map();
  let closePromise = null;
  let workflowAdmissionOpen = true;
  const workflowLockRetryDelayMs = Math.max(
    1,
    Number(workflowLockRetryMs) || SESSION_RENEWAL_WORKFLOW_LOCK_RETRY_MS
  );

  async function runtimeForRenewal() {
    return project.createRuntime({
      ...((typeof terminals.createSessionSource === "function")
        ? { createSessionSource: (context) => terminals.createSessionSource(context) }
        : {}),
      inspectSource: false
    });
  }

  async function readInternalSession(runtime, sessionId = "") {
    if (typeof runtime.getSessionForRenewal !== "function") {
      throw new TypeError("Session renewal requires the private renewal session reader.");
    }
    return runtime.getSessionForRenewal(sessionId, { inspectSource: false });
  }

  async function publish(sessionId = "", reason = "session-renewal", originId = "") {
    try {
      const runtime = await runtimeForRenewal();
      await publishSessionChanged(sessionId, {
        operation: "updated",
        originId: normalizeText(originId),
        reason,
        session: await readInternalSession(runtime, sessionId)
      });
    } catch {
      // Durable state and polling remain authoritative when realtime delivery
      // is temporarily unavailable.
    }
  }

  async function freezePredecessorTerminalAdmission(state = {}) {
    if (typeof terminals.freezeSessionTerminalAdmissionForRenewal !== "function") {
      throw new TypeError("Session renewal requires terminal admission freezing.");
    }
    return terminals.freezeSessionTerminalAdmissionForRenewal(state.sessionId, {
      renewalId: state.renewalId
    });
  }

  async function thawPredecessorTerminalAdmission(state = {}) {
    if (typeof terminals.thawSessionTerminalAdmissionForRenewal !== "function") {
      throw new TypeError("Session renewal requires exact terminal admission restoration.");
    }
    return terminals.thawSessionTerminalAdmissionForRenewal(state.sessionId, {
      renewalId: state.renewalId
    });
  }

  async function closePredecessorTerminals(runtime, state, session = null) {
    if (typeof terminals.closeRenewalPredecessorSessionTerminals !== "function") {
      throw new TypeError("Session renewal requires exact predecessor terminal cleanup.");
    }
    const predecessor = session || await readInternalSession(runtime, state.sessionId);
    return terminals.closeRenewalPredecessorSessionTerminals(predecessor, {
      renewalId: state.renewalId,
      runtime
    });
  }

  async function releasePredecessorProcessExitProof(runtime, state, session = null) {
    if (typeof terminals.releaseRenewalPredecessorProcessExitProof !== "function") {
      throw new TypeError("Session renewal requires exact predecessor process-exit proof release.");
    }
    const predecessor = session || await readInternalSession(runtime, state.sessionId);
    return terminals.releaseRenewalPredecessorProcessExitProof(predecessor, {
      renewalId: state.renewalId,
      runtime
    });
  }

  function successorProcessExitProofReleaseAuthorization(state = {}, successor = {}) {
    return {
      authorizedAt: timestamp(),
      kind: SESSION_RENEWAL_SUCCESSOR_PROCESS_EXIT_PROOF_RELEASE_KIND,
      renewalId: normalizeText(state.renewalId),
      runtimeDir: normalizeText(successor.metadata?.agent_transport_runtime_dir),
      schemaVersion: 1,
      sourceSessionId: normalizeText(state.sessionId),
      successorSessionId: normalizeText(successor.sessionId)
    };
  }

  function assertSuccessorProcessExitProofReleaseAuthorization(
    value = {},
    state = {},
    successor = {}
  ) {
    const authorization = value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
    const authorizedAt = normalizeText(authorization.authorizedAt);
    const authorizedAtMs = Date.parse(authorizedAt);
    if (
      normalizeText(authorization.kind) !==
        SESSION_RENEWAL_SUCCESSOR_PROCESS_EXIT_PROOF_RELEASE_KIND ||
      Number(authorization.schemaVersion) !== 1 ||
      normalizeText(authorization.renewalId) !== normalizeText(state.renewalId) ||
      normalizeText(authorization.sourceSessionId) !== normalizeText(state.sessionId) ||
      normalizeText(authorization.successorSessionId) !== normalizeText(successor.sessionId) ||
      normalizeText(authorization.runtimeDir) !==
        normalizeText(successor.metadata?.agent_transport_runtime_dir) ||
      !Number.isFinite(authorizedAtMs) ||
      new Date(authorizedAtMs).toISOString() !== authorizedAt
    ) {
      throw renewalError(
        "The successor process-exit proof release authorization is invalid.",
        "vibe64_session_renewal_process_exit_proof_release_authorization_invalid",
        { retryable: false, statusCode: 500 }
      );
    }
    return authorization;
  }

  async function readSuccessorProcessExitProofReleaseAuthorization(runtime, state, successor) {
    if (typeof runtime.store.readArtifactForRenewal !== "function") {
      throw new TypeError("Session renewal requires private artifact reads.");
    }
    const text = await runtime.store.readArtifactForRenewal(
      successor.sessionId,
      SESSION_RENEWAL_SUCCESSOR_PROCESS_EXIT_PROOF_RELEASE_ARTIFACT
    );
    if (!normalizeText(text)) {
      return null;
    }
    let value = null;
    try {
      value = JSON.parse(text);
    } catch {
      value = null;
    }
    return assertSuccessorProcessExitProofReleaseAuthorization(value, state, successor);
  }

  async function authorizeSuccessorProcessExitProofRelease(runtime, state, successor) {
    if (typeof runtime.store.writeJsonArtifactForRenewal !== "function") {
      throw new TypeError("Session renewal requires atomic private artifact writes.");
    }
    const authorization = successorProcessExitProofReleaseAuthorization(state, successor);
    await runtime.store.writeJsonArtifactForRenewal(
      successor.sessionId,
      SESSION_RENEWAL_SUCCESSOR_PROCESS_EXIT_PROOF_RELEASE_ARTIFACT,
      authorization
    );
    return authorization;
  }

  async function releaseSuccessorProcessExitProof(runtime, state, successor, authorization) {
    if (typeof terminals.releaseRenewalSuccessorProcessExitProof !== "function") {
      throw new TypeError("Session renewal requires exact successor process-exit proof release.");
    }
    return terminals.releaseRenewalSuccessorProcessExitProof(successor, {
      authorization,
      renewalId: state.renewalId,
      runtime
    });
  }

  async function assertPredecessorIdle(runtime, sessionId = "", session = null) {
    const predecessor = session || await runtime.getSession(sessionId, {
      inspectSource: false
    });
    assertWorkspaceIdle(predecessor, setupRunner);
    if (typeof terminals.assertSessionRenewalIdle === "function") {
      await terminals.assertSessionRenewalIdle(sessionId, {
        runtime,
        session: predecessor
      });
    }
    return predecessor;
  }

  async function returnToRenewalReview(runtime, state, basis) {
    const savedDraft = state.approved || state.draft;
    let text = savedDraft.text;
    if (!sourceEnvelopesMatch(basis.source, state.basis?.source)) {
      const sourceSection = /^## Saved source\n([\s\S]*?)(?=^## Touched areas$)/mu;
      const sourceField = /^- (Authority|Repository|Ref|Commit): /u;
      const templateSource = manualDraftTemplate(terminals, basis).match(sourceSection)[1];
      const sourceLines = templateSource.split("\n").filter((line) => sourceField.test(line));
      text = text.replace(sourceSection, (_match, content) => {
        const notes = content.split("\n").filter((line) => !sourceField.test(line));
        return `## Saved source\n${sourceLines.join("\n")}\n${notes.join("\n")}`;
      });
    }
    const draft = createSessionRenewalDraft(text, {
      origin: savedDraft.origin,
      revision: Math.max(savedDraft.revision, state.draft?.revision || 0) + 1
    });
    validateReviewedHandover({ ...state, basis }, draft);
    return mutateSessionRenewalState(runtime, state.sessionId, (latest) => statePatch(latest, {
      approved: null,
      basis,
      confirmedBy: null,
      draft,
      error: {
        code: "vibe64_session_renewal_review_stale",
        message: "This session changed. Your saved handover has been kept with current source details. Review it before continuing; no new AI handover was requested.",
        retryable: true
      },
      stage: SESSION_RENEWAL_STAGE.DRAFT_READY,
      status: SESSION_RENEWAL_STATUS.REVIEW,
      successor: null
    }));
  }

  function validateReviewedHandover(state = {}, draft = {}) {
    if (typeof terminals.validateSessionRenewalHandover !== "function") {
      throw new TypeError("Session renewal requires strict handover validation.");
    }
    if (state.manualRequired) {
      const template = manualDraftTemplate(terminals, state.basis);
      const placeholderLines = template
        .split("\n")
        .filter((line) => (
          line &&
          !line.startsWith("#") &&
          !line.startsWith("- ")
        ));
      const draftLines = new Set(String(draft.text || "").split("\n"));
      const remainingPlaceholders = placeholderLines.filter((line) => draftLines.has(line));
      if (remainingPlaceholders.length > 0) {
        throw renewalError(
          "Complete every handover section before creating the fresh session.",
          "vibe64_session_renewal_manual_handover_incomplete",
          {
            details: { remainingSectionCount: remainingPlaceholders.length },
            retryable: false,
            statusCode: 400
          }
        );
      }
    }
    return terminals.validateSessionRenewalHandover(draft.text, {
      source: state.basis?.source || null
    });
  }

  function assertRenewalAgentWriteAcquired(exclusive = {}) {
    if (exclusive?.acquired) {
      return exclusive.value;
    }
    throw renewalError(
      normalizeText(exclusive?.value?.error) ||
        "Another assistant operation is starting. Try again in a moment.",
      normalizeText(exclusive?.value?.code) || "vibe64_session_renewal_agent_busy",
      { retryable: true }
    );
  }

  async function restorePreAcknowledgementSource(runtime, state, {
    thawAdmission = true
  } = {}) {
    if (!SESSION_RENEWAL_PRE_ACKNOWLEDGEMENT_STAGES.has(state?.stage)) {
      return false;
    }
    const published = await readInternalSession(runtime, state.sessionId).catch(() => null);
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
        await thawPredecessorTerminalAdmission(state);
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
      const successor = await readInternalSession(runtime, successorSessionId)
        .catch((error) => {
          if (error?.code === "vibe64_session_not_found") {
            return null;
          }
          throw error;
        });
      if (successor?.status === VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING) {
        if (typeof runtime.store.rollbackRenewalSuccessorActivation !== "function") {
          throw new TypeError("Session renewal requires reversible successor activation.");
        }
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
      await thawPredecessorTerminalAdmission(state);
    }
    return true;
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
        await cleanupRenewalSuccessor(runtime, restoring);
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

  function clearWorkflowLockRetry(renewalId = "") {
    const key = normalizeText(renewalId);
    const timer = pendingWorkflowLockRetries.get(key);
    if (!timer) {
      return false;
    }
    clearTimeoutFn(timer);
    pendingWorkflowLockRetries.delete(key);
    return true;
  }

  function scheduleWorkflowLockRetry(state = {}, input = {}) {
    const key = normalizeText(state.renewalId);
    if (!key) {
      throw new TypeError("Session renewal workflow lock retry requires a renewal id.");
    }
    if (!workflowAdmissionOpen || !renewalNeedsWorkflow(state)) {
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
      if (!workflowAdmissionOpen) {
        return;
      }
      void runOnce(
        state,
        () => runPersistedRenewalWorkflow(state.sessionId, input)
      ).catch(() => {
        // Durable state remains authoritative. A lock miss schedules the next
        // bounded retry; a real workflow failure is persisted by the runner.
      });
    }, retryDelayMs);
    timer.unref?.();
    pendingWorkflowLockRetries.set(key, timer);
    return true;
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

  async function captureReviewConversation(runtime, sessionId = "") {
    return conversationFingerprint(
      await runtime.readConversationLogPage(sessionId, { limit: 1 })
    );
  }

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
    const predecessor = await readInternalSession(runtime, sourceSessionId);
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
        const prepared = await prepareArchive?.({
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
      archivedPredecessor ||= await readInternalSession(runtime, current.sessionId);
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
      [SESSION_RENEWAL_MAINTENANCE_STEP.ATTACHMENTS_RELEASED, async () => {
        if (typeof terminals.releaseRenewalPredecessorAttachments !== "function") {
          throw new TypeError("Session terminals do not support exact renewal attachment cleanup.");
        }
        return terminals.releaseRenewalPredecessorAttachments(
          await committedPredecessor(),
          {
            renewalId: current.renewalId,
            runtime
          }
        );
      }],
      [SESSION_RENEWAL_MAINTENANCE_STEP.SOURCE_REMOVED, () => (
        runtime.commitRenewalSessionSourceRemoval(current.sessionId, {
          renewalId: current.renewalId
        })
      )],
      [SESSION_RENEWAL_MAINTENANCE_STEP.PREDECESSOR_PROCESS_PROOF_RELEASED, async () => (
        releasePredecessorProcessExitProof(runtime, current, await committedPredecessor())
      )],
      [SESSION_RENEWAL_MAINTENANCE_STEP.ADMISSION_THAWED, () => (
        thawPredecessorTerminalAdmission(current)
      )],
      [SESSION_RENEWAL_MAINTENANCE_STEP.RESOURCES_RELEASED, async () => (
        typeof project.releaseSessionResources === "function"
          ? project.releaseSessionResources({
              session: await committedPredecessor(),
              sessionId: current.sessionId
            })
          : null
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
      await publish(current.sessionId, "session-archived");
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
    const predecessor = await readInternalSession(runtime, state.sessionId);
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
      await publish(commit.successorSessionId, "session-renewal-successor-available", input.originId);
      await publish(commit.successorSessionId, "session-renewal-completed", input.originId);
    }
    return runCompletedRenewalMaintenance(runtime, completed);
  }

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

  function successorDiscardError(message, code, cause, phase) {
    const error = renewalError(message, code, {
      retryable: true,
      statusCode: 500
    });
    error.renewalDiagnostic = {
      causeCode: normalizeText(cause?.code) || "vibe64_session_renewal_unknown_failure",
      phase
    };
    return error;
  }

  async function runSuccessorDiscardPhase(phase, operation) {
    try {
      return await operation();
    } catch (error) {
      throw successorDiscardError(
        "The invalid renewed session could not be discarded safely yet.",
        "vibe64_session_renewal_successor_discard_failed",
        error,
        phase
      );
    }
  }

  async function cleanupRenewalSuccessor(runtime, state) {
    const nextSessionId = normalizeText(state.successor?.sessionId);
    if (!nextSessionId) {
      return false;
    }
    if (typeof terminals.closeRenewalSuccessorSessionTerminals !== "function") {
      throw new TypeError("Session terminals do not support exact renewal successor cleanup.");
    }
    const successor = await runSuccessorDiscardPhase(
      SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE.SUCCESSOR_READ,
      () => readInternalSession(runtime, nextSessionId).catch((error) => {
        if (error?.code === "vibe64_session_not_found") {
          return null;
        }
        throw error;
      })
    );
    if (!successor) {
      return false;
    }
    let releaseAuthorization = await runSuccessorDiscardPhase(
      SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE.PROOF_AUTHORIZATION,
      () => readSuccessorProcessExitProofReleaseAuthorization(
        runtime,
        state,
        successor
      )
    );
    if (!releaseAuthorization) {
      await runSuccessorDiscardPhase(
        SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE.TERMINAL_CLOSE,
        () => terminals.closeRenewalSuccessorSessionTerminals(successor, {
          renewalId: state.renewalId,
          runtime
        })
      );
      if (typeof project.releaseSessionResources === "function") {
        await runSuccessorDiscardPhase(
          SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE.RESOURCE_RELEASE,
          () => project.releaseSessionResources({
            runtime,
            session: successor,
            sessionId: nextSessionId
          })
        );
      }
      releaseAuthorization = await runSuccessorDiscardPhase(
        SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE.PROOF_AUTHORIZATION,
        () => authorizeSuccessorProcessExitProofRelease(
          runtime,
          state,
          successor
        )
      );
    }
    await runSuccessorDiscardPhase(
      SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE.PROOF_RELEASE,
      () => releaseSuccessorProcessExitProof(
        runtime,
        state,
        successor,
        releaseAuthorization
      )
    );
    if (typeof runtime.discardRenewalSession !== "function") {
      throw new TypeError("The session runtime does not support exact renewal successor disposal.");
    }
    await runSuccessorDiscardPhase(
      SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE.DISCARD,
      () => runtime.discardRenewalSession(nextSessionId, {
        renewalId: state.renewalId
      })
    );
    return true;
  }

  async function ensureSuccessorDiscarding(runtime, state, seedError) {
    const expectedRenewalId = normalizeText(state.renewalId);
    const expectedSuccessorId = normalizeText(state.successor?.sessionId);
    const ownsExpectedSuccessor = (current) => (
      normalizeText(current?.renewalId) === expectedRenewalId &&
      normalizeText(current?.successor?.sessionId) === expectedSuccessorId
    );
    try {
      return await mutateSessionRenewalState(runtime, state.sessionId, (current) => {
        if (!ownsExpectedSuccessor(current)) {
          throw renewalError(
            "The invalid renewed session no longer belongs to this renewal.",
            "vibe64_session_renewal_link_mismatch",
            { retryable: true, statusCode: 500 }
          );
        }
        if (
          current.status === SESSION_RENEWAL_STATUS.RUNNING &&
          current.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_DISCARDING
        ) {
          return undefined;
        }
        if (
          current.status !== SESSION_RENEWAL_STATUS.RUNNING ||
          current.stage !== SESSION_RENEWAL_STAGE.SUCCESSOR_SEEDING
        ) {
          throw renewalError(
            "The invalid renewed session is no longer awaiting disposal.",
            "vibe64_session_renewal_state_invalid",
            { retryable: true, statusCode: 500 }
          );
        }
        return statePatch(current, {
          error: {
            code: normalizeText(seedError?.code) || "vibe64_session_renewal_acknowledgement_invalid",
            message: normalizeText(seedError?.message) || "The fresh assistant did not accept the handover.",
            retryable: true
          },
          stage: SESSION_RENEWAL_STAGE.SUCCESSOR_DISCARDING,
          status: SESSION_RENEWAL_STATUS.RUNNING
        });
      });
    } catch (error) {
      const observed = await readSessionRenewalState(runtime, state.sessionId).catch(() => null);
      if (
        ownsExpectedSuccessor(observed) &&
        observed?.status === SESSION_RENEWAL_STATUS.RUNNING &&
        observed?.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_DISCARDING
      ) {
        return observed;
      }
      throw successorDiscardError(
        "The invalid renewed session could not be marked for safe disposal.",
        "vibe64_session_renewal_successor_discard_transition_failed",
        error,
        SESSION_RENEWAL_SUCCESSOR_DISCARD_PHASE.TRANSITION
      );
    }
  }

  function assertSuccessorSource(state, successor = {}) {
    const metadata = successor.metadata || {};
    const expectedCommit = normalizeText(state.basis?.source?.commit).toLowerCase();
    const actualBaseCommit = normalizeText(metadata.base_commit).toLowerCase();
    const actualCanonicalCommit = normalizeText(metadata.canonical_commit).toLowerCase();
    const repository = normalizeText(metadata.source_remote_url);
    const actualSource = {
      authority: normalizeText(metadata.repository_mode),
      commit: actualBaseCommit,
      ref: `refs/heads/${normalizeText(metadata.source_default_branch)}`,
      ...(metadata.repository_mode !== "local_source" && repository ? { repository } : {})
    };
    const commitMismatch = actualBaseCommit !== expectedCommit || actualCanonicalCommit !== expectedCommit;
    if (
      !expectedCommit ||
      commitMismatch ||
      !sourceEnvelopesMatch(actualSource, state.basis?.source)
    ) {
      throw renewalError(
        commitMismatch
          ? "The renewed session was not created from the exact approved source commit."
          : "The renewed session's source authority, repository, or branch does not match the approved handover.",
        SESSION_RENEWAL_SUCCESSOR_SOURCE_INVALID_CODE,
        {
          details: {
            actualCommit: actualBaseCommit,
            expectedCommit,
            phase: "source_envelope"
          },
          retryable: true,
          statusCode: 500
        }
      );
    }
    return successor;
  }

  async function assertSuccessorCanonicalState(runtime, state, {
    phase = "verification"
  } = {}) {
    const successorSessionId = normalizeText(state.successor?.sessionId);
    if (!successorSessionId) {
      throw renewalError(
        "The renewed session has no exact private successor.",
        "vibe64_session_renewal_link_mismatch",
        { statusCode: 500 }
      );
    }
    const successor = assertSuccessorSource(
      state,
      await readInternalSession(runtime, successorSessionId)
    );
    const expectedCommit = normalizeText(state.basis?.source?.commit).toLowerCase();
    const work = await terminals.inspectSessionWork(successorSessionId, {
      runtime,
      session: successor
    });
    const changedPaths = Array.isArray(work?.changedPaths)
      ? work.changedPaths
      : [];
    const actualBaseCommit = normalizeText(work?.baseCommit).toLowerCase();
    const actualCanonicalCommit = normalizeText(work?.canonicalCommit).toLowerCase();
    const actualHead = normalizeText(work?.sessionHead).toLowerCase();
    const expectedWorktreePath = normalizeText(
      successor?.sourcePath || successor?.metadata?.source_path
    );
    const actualWorktreeTopLevel = normalizeText(work?.worktreeTopLevel);
    if (
      !expectedCommit ||
      actualBaseCommit !== expectedCommit ||
      actualCanonicalCommit !== expectedCommit ||
      actualHead !== expectedCommit ||
      work?.dirty === true ||
      work?.unsaved === true ||
      work?.worktreeClean !== true ||
      work?.sessionMatchesCanonical !== true ||
      changedPaths.length > 0 ||
      normalizeText(work?.relationship) !== "current" ||
      !expectedWorktreePath ||
      !actualWorktreeTopLevel ||
      path.resolve(actualWorktreeTopLevel) !== path.resolve(expectedWorktreePath)
    ) {
      throw renewalError(
        "The renewed session changed while its private workspace was being prepared.",
        SESSION_RENEWAL_SUCCESSOR_SOURCE_INVALID_CODE,
        {
          details: {
            actualBaseCommit,
            actualCanonicalCommit,
            actualHead,
            actualWorktreeTopLevel,
            changedPaths,
            expectedCommit,
            expectedWorktreePath,
            phase,
            worktreeClean: work?.worktreeClean === true
          },
          retryable: true,
          statusCode: 500
        }
      );
    }
    return successor;
  }

  async function generateDraft(sessionId = "", input = {}) {
    assertWorkflowAdmissionOpen();
    const runtime = await runtimeForRenewal();
    let state = await readSessionRenewalState(runtime, sessionId);
    assertWorkflowAdmissionOpen();
    if (
      !state ||
      state.status !== SESSION_RENEWAL_STATUS.RUNNING ||
      state.stage !== SESSION_RENEWAL_STAGE.DRAFT_GENERATING
    ) {
      return state;
    }
    let basis = state.basis || null;
    try {
      const session = await runtime.getSession(sessionId, { inspectSource: false });
      const result = requireProviderSuccess(await terminals.generateSessionRenewalHandover(sessionId, {
        operationId: state.generation.operationId,
        source: state.basis?.source || null
      }, {
        beforeStart: async (context = {}) => {
          assertWorkflowAdmissionOpen();
          basis = await inspectSessionRenewalEligibility({
            operationId: operationId(state.renewalId, "eligibility"),
            runtime,
            session: context.session || session,
            setupRunner,
            terminals,
            vibe64User: input.vibe64User
          });
          assertWorkflowAdmissionOpen();
          await mutateSessionRenewalState(runtime, sessionId, (current) => {
            assertSessionRenewalOperation(current, state.operationKey);
            return statePatch(current, { basis });
          });
          assertWorkflowAdmissionOpen();
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
      assertWorkflowAdmissionOpen();
      const handover = normalizeText(result?.handover || result?.output || result?.finalOutput);
      const reviewConversation = await captureReviewConversation(runtime, sessionId);
      assertWorkflowAdmissionOpen();
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
            threadId: normalizeText(result?.threadId),
            turnId: normalizeText(result?.turnId)
          },
          stage: SESSION_RENEWAL_STAGE.DRAFT_READY,
          status: SESSION_RENEWAL_STATUS.REVIEW
        });
      });
    } catch (error) {
      if (!workflowAdmissionOpen) {
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
              code: normalizeText(error?.code) || SESSION_RENEWAL_THREAD_UNREADABLE_CODE,
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
        state = await fail(runtime, sessionId, error);
      }
    }
    if (workflowAdmissionOpen) {
      await publish(sessionId, "session-renewal-draft-updated", input.originId);
    }
    return state;
  }

  async function resumeConfirmedRenewal(sessionId = "", input = {}) {
    assertWorkflowAdmissionOpen();
    const runtime = await runtimeForRenewal();
    const state = await readSessionRenewalState(runtime, sessionId);
    assertWorkflowAdmissionOpen();
    if (!state) {
      return state;
    }
    if (
      state.status === SESSION_RENEWAL_STATUS.COMPLETED &&
      state.commit?.committedAt &&
      state.maintenance?.status !== "completed"
    ) {
      return finalizeCommittedRenewal(runtime, state, input);
    }
    if (state.status !== SESSION_RENEWAL_STATUS.RUNNING) {
      return state;
    }
    try {
      return await advanceConfirmedRenewal(runtime, state, input);
    } catch (caughtError) {
      let error = caughtError;
      if (!workflowAdmissionOpen) {
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
          const failed = await fail(runtime, sessionId, transitionError);
          if (failed?.status === SESSION_RENEWAL_STATUS.RUNNING) {
            return advanceConfirmedRenewal(runtime, failed, input);
          }
          await publish(sessionId, "session-renewal-failed", input.originId);
          return failed;
        }
        return resumeConfirmedRenewal(sessionId, input);
      }
      if (
        current?.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_SEEDING &&
        error?.details?.handoverPromptAccepted === true
      ) {
        try {
          const successor = await readInternalSession(
            runtime,
            current.successor.sessionId
          );
          await terminals.closeRenewalSuccessorSessionTerminals(successor, {
            renewalId: current.renewalId,
            runtime
          });
          await assertSuccessorCanonicalState(runtime, current, {
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
                threadId: normalizeText(error?.details?.threadId),
                turnId: normalizeText(error?.details?.turnId)
              }
            })
          );
          return advanceConfirmedRenewal(runtime, continued, input);
        } catch (continuationError) {
          error = continuationError;
        }
      }
      const failed = await fail(runtime, sessionId, error);
      if (failed?.status === SESSION_RENEWAL_STATUS.RUNNING) {
        return advanceConfirmedRenewal(runtime, failed, input);
      }
      await publish(sessionId, "session-renewal-failed", input.originId);
      return failed;
    }
  }

  async function advanceConfirmedRenewal(runtime, initialState, input = {}) {
    assertWorkflowAdmissionOpen();
    let state = initialState;
    const sessionId = state.sessionId;
    if (state.commit?.committedAt) {
      return finalizeCommittedRenewal(runtime, state, input);
    }
    if (state.stage === SESSION_RENEWAL_STAGE.FAILURE_RESTORING) {
      state = await completeFailureRestoration(runtime, state);
      assertWorkflowAdmissionOpen();
      return state.status === SESSION_RENEWAL_STATUS.RUNNING
        ? advanceConfirmedRenewal(runtime, state, input)
        : state;
    }
    if (state.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_DISCARDING) {
      await cleanupRenewalSuccessor(runtime, state);
      await restorePreAcknowledgementSource(runtime, state);
      assertWorkflowAdmissionOpen();
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
      const sourceStatus = normalizeText(
        await runtime.store.readStatusForRenewal(sessionId)
      );
      if (sourceStatus === VIBE64_SESSION_STATUS.ACTIVE) {
        const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
          assertWorkflowAdmissionOpen();
          const current = await readSessionRenewalState(runtime, sessionId);
          assertWorkflowAdmissionOpen();
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
          const idleSession = await assertPredecessorIdle(runtime, sessionId);
          assertWorkflowAdmissionOpen();
          await freezePredecessorTerminalAdmission(current);
          await closePredecessorTerminals(runtime, current, idleSession);
          assertWorkflowAdmissionOpen();
          const session = await runtime.getSession(sessionId, { inspectSource: false });
          const basis = await inspectSessionRenewalEligibility({
            operationId: operationId(current.renewalId, "resume-quiesce"),
            runtime,
            session,
            setupRunner,
            terminals,
            vibe64User: input.vibe64User
          });
          assertWorkflowAdmissionOpen();
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
        assertWorkflowAdmissionOpen();
        await freezePredecessorTerminalAdmission(state);
        await closePredecessorTerminals(runtime, state);
        await runtime.quiesceSessionForRenewal({
          renewalId: state.renewalId,
          sourceSessionId: sessionId
        });
      }
      assertWorkflowAdmissionOpen();
      state = await mutateSessionRenewalState(runtime, sessionId, (current) => statePatch(current, {
        error: null,
        stage: SESSION_RENEWAL_STAGE.SUCCESSOR_CREATING
      }));
    }
    if (state.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_CREATING) {
      const attempt = Math.max(1, Number(state.successor?.attempt) || 1);
      const nextSessionId = normalizeText(state.successor?.sessionId) ||
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
      if (typeof runtime.createRenewalSession !== "function") {
        throw new TypeError("The session runtime does not support hidden renewal successors.");
      }
      const transitionActor = renewalTransitionActor(state);
      assertWorkflowAdmissionOpen();
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
          vibe64User: input.vibe64User || null
        },
        startedAt: state.createdAt
      });
      assertWorkflowAdmissionOpen();
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
      const successor = await readInternalSession(runtime, state.successor.sessionId);
      if (typeof runtime.store.mutateSessionForRenewal !== "function") {
        throw new TypeError("The session store does not expose the private renewal mutation boundary.");
      }
      const setup = await runtime.store.mutateSessionForRenewal(
        successor.sessionId,
        async () => {
          let currentSetup = successor.workspaceSetup || null;
          if (setupRunner.isRunning(successor.sessionId)) {
            currentSetup = await setupRunner.wait(successor.sessionId);
          } else if (!["succeeded", "unconfigured"].includes(normalizeText(currentSetup?.status))) {
            assertWorkflowAdmissionOpen();
            if (typeof setupRunner.startRenewal !== "function") {
              throw new TypeError("Session renewal requires the private workspace setup boundary.");
            }
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
      assertWorkflowAdmissionOpen();
      if (!["succeeded", "unconfigured"].includes(normalizeText(setup?.status))) {
        throw renewalError(
          normalizeText(setup?.error) || "The renewed session workspace is not ready.",
          "vibe64_session_renewal_successor_setup_failed",
          { retryable: true }
        );
      }
      await assertSuccessorCanonicalState(runtime, state, {
        phase: "workspace_setup"
      });
      assertWorkflowAdmissionOpen();
      state = await mutateSessionRenewalState(runtime, sessionId, (current) => statePatch(current, {
        stage: SESSION_RENEWAL_STAGE.SUCCESSOR_SEEDING,
        successor: {
          ...current.successor,
          setupCompletedAt: timestamp()
        }
      }));
    }
    if (state.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_SEEDING) {
      const successor = await readInternalSession(runtime, state.successor.sessionId);
      assertWorkflowAdmissionOpen();
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
        expectedThreadId: normalizeText(state.successor.threadId),
        forbiddenThreadId: normalizeText(state.basis?.provider?.threadId),
        handover: state.approved.text,
        handoverHash: state.approved.hash,
        operationId: seedOperationId,
        source: state.basis.source
      }, {
        runtime,
        session: successor,
        vibe64User: input.vibe64User
      }), "The fresh assistant thread could not accept the session handover.");
      assertWorkflowAdmissionOpen();
      await assertSuccessorCanonicalState(runtime, state, {
        phase: "acknowledgement"
      });
      assertWorkflowAdmissionOpen();
      const acknowledgement = seeded.acknowledgement || seeded;
      state = await mutateSessionRenewalState(runtime, sessionId, (current) => statePatch(current, {
        stage: SESSION_RENEWAL_STAGE.SUCCESSOR_ACKNOWLEDGED,
        successor: {
          ...current.successor,
          acknowledgedAt: normalizeText(seeded.acknowledgedAt) || timestamp(),
          acknowledgement: {
            handoverHash: normalizeText(acknowledgement?.handoverHash),
            message: normalizeText(acknowledgement?.message),
            sourceCommit: normalizeText(acknowledgement?.sourceCommit)
          },
          threadId: normalizeText(seeded.threadId),
          turnId: normalizeText(seeded.turnId)
        }
      }));
    }
    if (state.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_ACKNOWLEDGED) {
      state = await mutateSessionRenewalState(runtime, sessionId, (current) => statePatch(current, {
        stage: SESSION_RENEWAL_STAGE.OLD_ARCHIVING
      }));
    }
    if (state.stage === SESSION_RENEWAL_STAGE.OLD_ARCHIVING) {
      state = await completeRenewalArchive(runtime, state);
      assertWorkflowAdmissionOpen();
      return finalizeCompletedRenewal(runtime, state, input);
    }
    if (state.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_ACTIVATING) {
      return finalizeCompletedRenewal(runtime, state, input);
    }
    return state;
  }

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
    try {
      if (typeof resolveRenewalActor !== "function") {
        if (!requestActor) {
          return input;
        }
        throw renewalError(
          "The persisted session-renewal actor cannot be restored.",
          "vibe64_session_renewal_actor_resolver_unavailable",
          { retryable: true }
        );
      }
      const resolved = await resolveRenewalActor(
        persistedActor,
        {
          renewalId: state.renewalId,
          sessionId: state.sessionId,
          stage: state.stage
        }
      );
      if (!renewalActorsMatch(resolved, persistedActor)) {
        throw renewalError(
          "The restored session-renewal actor does not match the persisted workflow actor.",
          "vibe64_session_renewal_actor_mismatch",
          { retryable: true, statusCode: 500 }
        );
      }
      return {
        ...input,
        vibe64User: resolved
      };
    } catch (error) {
      if (
        error?.code === "vibe64_session_renewal_actor_resolver_unavailable" &&
        !requestActor
      ) {
        // Standalone Vibe64 runs as the local user and does not need a hosted
        // user-store resolver. Hosted Online always installs one before boot.
        return input;
      }
      throw error;
    }
  }

  async function runPersistedRenewalWorkflow(sessionId = "", input = {}) {
    if (!workflowAdmissionOpen) {
      return null;
    }
    const runtime = await runtimeForRenewal();
    if (typeof runtime?.store?.runSessionRenewalWorkflowExclusive !== "function") {
      throw new TypeError("Session renewal requires the project workflow lock boundary.");
    }
    try {
      const exclusive = await runtime.store.runSessionRenewalWorkflowExclusive(
        sessionId,
        async () => {
        const current = await readSessionRenewalState(runtime, sessionId);
        if (!renewalNeedsWorkflow(current)) {
          return current;
        }
        if (current.stage === SESSION_RENEWAL_STAGE.FAILURE_RESTORING) {
          return resumeConfirmedRenewal(sessionId, input);
        }
        if (current.stage === SESSION_RENEWAL_STAGE.SUCCESSOR_ACTIVATING) {
          // A durable commit marker makes this forward-only. Without it the
          // archive, hidden activation, and selection preparation remain
          // reversible and still require the persisted actor.
          if (!current.commit?.committedAt) {
            const workflowInput = await workflowInputForPersistedActor(current, input);
            return resumeConfirmedRenewal(sessionId, workflowInput);
          }
          return resumeConfirmedRenewal(sessionId, input);
        }
        if (current.status === SESSION_RENEWAL_STATUS.COMPLETED) {
          return resumeConfirmedRenewal(sessionId, input);
        }
        const workflowInput = await workflowInputForPersistedActor(current, input);
        return current.stage === SESSION_RENEWAL_STAGE.DRAFT_GENERATING
          ? generateDraft(sessionId, workflowInput)
          : resumeConfirmedRenewal(sessionId, workflowInput);
        },
        { waitMs: 0 }
      );
      if (exclusive.acquired) {
        if (workflowAdmissionOpen && renewalNeedsWorkflow(exclusive.value)) {
          scheduleWorkflowLockRetry(exclusive.value, input);
        } else {
          clearWorkflowLockRetry(exclusive.value?.renewalId);
        }
        return exclusive.value;
      }
      const observed = await readSessionRenewalState(runtime, sessionId);
      if (workflowAdmissionOpen && renewalNeedsWorkflow(observed)) {
        scheduleWorkflowLockRetry(observed, input);
      } else {
        clearWorkflowLockRetry(observed?.renewalId);
      }
      return observed;
    } catch (error) {
      if (!workflowAdmissionOpen) {
        throw error;
      }
      const failed = await fail(runtime, sessionId, error);
      if (renewalNeedsWorkflow(failed)) {
        scheduleWorkflowLockRetry(failed, input);
        return failed;
      }
      clearWorkflowLockRetry(failed?.renewalId);
      await publish(sessionId, "session-renewal-failed", input.originId);
      return failed;
    }
  }

  async function schedule(state, input = {}) {
    if (!workflowAdmissionOpen || !renewalNeedsWorkflow(state)) {
      clearWorkflowLockRetry(state?.renewalId);
      return;
    }
    void runOnce(
      state,
      () => runPersistedRenewalWorkflow(state.sessionId, input)
    ).catch(() => {
      // The durable state remains authoritative; inspection or startup
      // recovery retries the exact persisted stage.
    });
  }

  async function resumeSessionRenewalsNow(input = {}) {
    if (!workflowAdmissionOpen) {
      return stoppedRecoveryResult();
    }
    const runtime = await runtimeForRenewal();
    if (!workflowAdmissionOpen) {
      return stoppedRecoveryResult();
    }
    if (typeof runtime?.store?.listSessionRenewalStateSessionIds !== "function") {
      throw new TypeError("Session renewal recovery requires the project renewal-state index.");
    }
    const candidateSessionIds = await runtime.store.listSessionRenewalStateSessionIds();
    if (!workflowAdmissionOpen) {
      return stoppedRecoveryResult();
    }
    const reads = await Promise.allSettled(candidateSessionIds.map(async (sessionId) => ({
      sessionId,
      state: await readSessionRenewalState(runtime, sessionId)
    })));
    const states = reads
      .filter((result) => result.status === "fulfilled" && result.value.state)
      .map((result) => result.value.state);
    if (!workflowAdmissionOpen) {
      return stoppedRecoveryResult({
        discoveredSessionIds: states.map((state) => state.sessionId)
      });
    }
    const resumableStates = states.filter(renewalNeedsWorkflow);
    const resumes = await Promise.allSettled(resumableStates.map((state) => runOnce(
      state,
      () => runPersistedRenewalWorkflow(state.sessionId, input)
    )));
    const failures = [
      ...reads.flatMap((result, index) => result.status === "rejected"
        ? [{
            code: normalizeText(result.reason?.code) || "vibe64_session_renewal_state_unreadable",
            error: normalizeText(result.reason?.message) || "Session renewal state is unreadable.",
            sessionId: candidateSessionIds[index]
          }]
        : []),
      ...resumes.flatMap((result, index) => result.status === "rejected"
        ? [{
            code: normalizeText(result.reason?.code) || "vibe64_session_renewal_resume_failed",
            error: normalizeText(result.reason?.message) || "Session renewal could not resume.",
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
    if (!workflowAdmissionOpen) {
      return Promise.resolve(stoppedRecoveryResult());
    }
    const recovery = resumeSessionRenewalsNow(input);
    activeRecoveryScans.add(recovery);
    void recovery.then(
      () => activeRecoveryScans.delete(recovery),
      () => activeRecoveryScans.delete(recovery)
    );
    return recovery;
  }

  async function closeSessionRenewalWork() {
    workflowAdmissionOpen = false;
    for (const timer of pendingWorkflowLockRetries.values()) {
      clearTimeoutFn(timer);
    }
    pendingWorkflowLockRetries.clear();
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

  const controller = {
    async cancelSessionRenewal(sessionId, input = {}) {
      const runtime = await runtimeForRenewal();
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
      clearWorkflowLockRetry(state?.renewalId);
      await publish(sessionId, "session-renewal-cancelled", input.originId);
      return publicRenewalResult(state, {}, input.vibe64User);
    },

    async confirmSessionRenewal(sessionId, input = {}) {
      const runtime = await runtimeForRenewal();
      const observed = await readSessionRenewalState(runtime, sessionId);
      assertSessionRenewalOperation(observed, input.operationKey);
      return runConfirmationOnce(observed.renewalId, input, async () => {
      if (
        observed?.approved &&
        [
          SESSION_RENEWAL_STATUS.COMPLETED,
          SESSION_RENEWAL_STATUS.RUNNING
        ].includes(observed.status)
      ) {
        assertSessionRenewalDraftVersion(observed, input);
        if (observed.status === SESSION_RENEWAL_STATUS.RUNNING) {
          await schedule(observed, input);
        }
        return publicRenewalResult(observed, {}, input.vibe64User);
      }
      const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
        const current = await readSessionRenewalState(runtime, sessionId);
        assertSessionRenewalOperation(current, input.operationKey);
        const draft = assertSessionRenewalDraftVersion(current, input);
        validateReviewedHandover(current, draft);
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
        const idleSession = await assertPredecessorIdle(runtime, sessionId);
        if (typeof resolveSuccessorAssistant !== "function") {
          throw new TypeError(
            "Session renewal requires an assistant selection resolver before confirmation."
          );
        }
        const successorAssistant = await resolveSuccessorAssistant(
          { assistantSelection: input.assistantSelection, workflowEngineId: input.workflowEngineId },
          {
            session: idleSession,
            vibe64User: input.vibe64User || null
          }
        );
        let confirmed = null;
        let durablyQuiesced = false;
        await freezePredecessorTerminalAdmission(current);
        try {
          await closePredecessorTerminals(runtime, current, idleSession);
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
            const review = await returnToRenewalReview(runtime, current, basis);
            await thawPredecessorTerminalAdmission(review);
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
            await thawPredecessorTerminalAdmission(current);
          }
          throw error;
        }
      }, { operation: "confirm-session-renewal" });
      const confirmed = assertRenewalAgentWriteAcquired(exclusive);
      await schedule(confirmed, input);
      await publish(sessionId, "session-renewal-confirmed", input.originId);
      return publicRenewalResult(confirmed, {}, input.vibe64User);
      });
    },

    async inspectSessionRenewal(sessionId, input = {}) {
      const runtime = await runtimeForRenewal();
      const state = await readSessionRenewalState(runtime, sessionId);
      await schedule(state, input);
      return publicRenewalResult(state, {
        available: state?.status !== SESSION_RENEWAL_STATUS.COMPLETED
      }, input.vibe64User);
    },

    async requestSessionRenewalDraft(sessionId, input = {}) {
      const runtime = await runtimeForRenewal();
      if (typeof runtime?.store?.runSessionRenewalStateExclusive !== "function") {
        throw new TypeError("Session renewal state requires the project renewal-state mutation boundary.");
      }
      if (typeof runtime?.store?.mutateSessionForRenewal !== "function") {
        throw new TypeError("Session renewal requires the private session mutation boundary.");
      }
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
      await schedule(state, input);
      await publish(sessionId, "session-renewal-started", input.originId);
      return publicRenewalResult(state, {}, input.vibe64User);
    },

    closeSessionRenewalWork,

    resumeSessionRenewals,

    async retrySessionRenewal(sessionId, input = {}) {
      const runtime = await runtimeForRenewal();
      const observed = await readSessionRenewalState(runtime, sessionId);
      assertSessionRenewalOperation(observed, input.operationKey);
      if ([
        SESSION_RENEWAL_STATUS.COMPLETED,
        SESSION_RENEWAL_STATUS.RUNNING
      ].includes(observed.status)) {
        await schedule(observed, input);
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
          current = await completeFailureRestoration(runtime, current);
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

        await assertPredecessorIdle(runtime, sessionId);
        await freezePredecessorTerminalAdmission(current);
        let durablyQuiesced = false;
        try {
          await restorePreAcknowledgementSource(runtime, current, {
            thawAdmission: false
          });
          const session = await readInternalSession(runtime, sessionId);
          await closePredecessorTerminals(runtime, current, session);
          const basis = await inspectSessionRenewalEligibility({
            operationId: operationId(current.renewalId, "retry"),
            runtime,
            session,
            setupRunner,
            terminals,
            vibe64User: input.vibe64User
          });
          if (!renewalBasisMatches(basis, current.basis)) {
            await cleanupRenewalSuccessor(runtime, current);
            current = await returnToRenewalReview(runtime, current, basis);
            await thawPredecessorTerminalAdmission(current);
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
              await thawPredecessorTerminalAdmission(current);
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
      await schedule(exclusive.value, input);
      return publicRenewalResult(exclusive.value, {}, input.vibe64User);
    },

    async updateSessionRenewalDraft(sessionId, input = {}) {
      const runtime = await runtimeForRenewal();
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
      await publish(sessionId, "session-renewal-draft-updated", input.originId);
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
    controller[methodName] = admitMutation(controller[methodName]);
  }
  return Object.freeze(controller);
}

export {
  actorFromUser,
  conversationFingerprint,
  createSessionRenewalController,
  fingerprintsMatch,
  inspectSessionRenewalEligibility,
  operationId,
  sourceEnvelopesMatch,
  successorSessionId
};
