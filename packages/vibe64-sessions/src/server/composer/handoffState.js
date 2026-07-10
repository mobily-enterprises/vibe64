import {
  VIBE64_AGENT_RUN_STATE
} from "@local/vibe64-runtime/server";
import {
  normalizeText
} from "@local/vibe64-core/server/core";

const COMPOSER_HANDOFF_AGENT_RUN_ID = "composer_handoff";
const COMPOSER_HANDOFF_SCHEMA_VERSION = 1;
const COMPOSER_HANDOFF_STATES = Object.freeze({
  ACCEPTED: "accepted",
  ACTIVE: "active",
  CONNECTING: "connecting",
  DELIVERED: "delivered",
  FAILED: "failed"
});
const COMPOSER_HANDOFF_PENDING_STATES = new Set([
  COMPOSER_HANDOFF_STATES.ACCEPTED,
  COMPOSER_HANDOFF_STATES.CONNECTING,
  COMPOSER_HANDOFF_STATES.DELIVERED
]);
const COMPOSER_CONTROL_KINDS = Object.freeze({
  INTERRUPT: "interrupt",
  STEER: "steer"
});
const COMPOSER_CONTROL_EVENT_KINDS = Object.freeze({
  ACCEPTED: "composer-control-accepted",
  DELIVERED: "composer-control-delivered",
  FAILED: "composer-control-failed"
});
const COMPOSER_HANDOFF_TRANSITIONS = Object.freeze({
  [COMPOSER_HANDOFF_STATES.ACCEPTED]: new Set([
    COMPOSER_HANDOFF_STATES.CONNECTING,
    COMPOSER_HANDOFF_STATES.DELIVERED,
    COMPOSER_HANDOFF_STATES.FAILED
  ]),
  [COMPOSER_HANDOFF_STATES.CONNECTING]: new Set([
    COMPOSER_HANDOFF_STATES.DELIVERED,
    COMPOSER_HANDOFF_STATES.FAILED
  ]),
  [COMPOSER_HANDOFF_STATES.DELIVERED]: new Set([
    COMPOSER_HANDOFF_STATES.ACTIVE,
    COMPOSER_HANDOFF_STATES.FAILED
  ]),
  [COMPOSER_HANDOFF_STATES.ACTIVE]: new Set(),
  [COMPOSER_HANDOFF_STATES.FAILED]: new Set()
});

function normalizeState(value = "") {
  const state = normalizeText(value);
  return Object.values(COMPOSER_HANDOFF_STATES).includes(state) ? state : "";
}

function composerHandoffId(handoff = {}) {
  return normalizeText(handoff?.handoffId);
}

function composerHandoffRun(session = {}) {
  return (Array.isArray(session?.agentRuns) ? session.agentRuns : [])
    .find((run) => normalizeText(run?.id) === COMPOSER_HANDOFF_AGENT_RUN_ID) || null;
}

function normalizeComposerControlKind(value = "") {
  const kind = normalizeText(value);
  return Object.values(COMPOSER_CONTROL_KINDS).includes(kind) ? kind : "";
}

function composerControlRequests(source = {}) {
  const run = normalizeText(source?.id) === COMPOSER_HANDOFF_AGENT_RUN_ID
    ? source
    : composerHandoffRun(source);
  const requests = new Map();
  for (const event of Array.isArray(run?.events) ? run.events : []) {
    const kind = normalizeText(event?.kind);
    const controlRequestId = normalizeText(
      event?.request?.controlRequestId || event?.controlRequestId
    );
    if (!controlRequestId) {
      continue;
    }
    if (kind === COMPOSER_CONTROL_EVENT_KINDS.ACCEPTED && !requests.has(controlRequestId)) {
      const request = event.request && typeof event.request === "object" && !Array.isArray(event.request)
        ? event.request
        : {};
      requests.set(controlRequestId, {
        afterSubmissionId: normalizeText(request.afterSubmissionId),
        controlRequestId,
        displayFields: request.displayFields && typeof request.displayFields === "object" && !Array.isArray(request.displayFields)
          ? request.displayFields
          : {},
        error: "",
        fields: request.fields && typeof request.fields === "object" && !Array.isArray(request.fields)
          ? request.fields
          : {},
        kind: normalizeComposerControlKind(request.kind),
        message: normalizeText(request.message || request.text),
        originId: normalizeText(request.originId),
        reason: normalizeText(request.reason),
        state: "accepted",
        submittedAt: normalizeText(event.at || request.submittedAt)
      });
      continue;
    }
    const current = requests.get(controlRequestId);
    if (!current) {
      continue;
    }
    if (kind === COMPOSER_CONTROL_EVENT_KINDS.DELIVERED) {
      requests.set(controlRequestId, {
        ...current,
        state: "delivered"
      });
    } else if (kind === COMPOSER_CONTROL_EVENT_KINDS.FAILED) {
      requests.set(controlRequestId, {
        ...current,
        error: normalizeText(event.error) || "Assistant control delivery failed.",
        state: "failed"
      });
    }
  }
  return [...requests.values()];
}

function pendingComposerControls(source = {}, afterSubmissionId = "") {
  const normalizedAfterSubmissionId = normalizeText(afterSubmissionId);
  return composerControlRequests(source).filter((request) => (
    request.state === "accepted" &&
    (!normalizedAfterSubmissionId || request.afterSubmissionId === normalizedAfterSubmissionId)
  ));
}

async function acceptComposerControl(runtime, sessionId = "", input = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const request = {
    afterSubmissionId: normalizeText(input?.afterSubmissionId),
    controlRequestId: normalizeText(input?.controlRequestId),
    displayFields: input?.displayFields && typeof input.displayFields === "object" && !Array.isArray(input.displayFields)
      ? input.displayFields
      : {},
    fields: input?.fields && typeof input.fields === "object" && !Array.isArray(input.fields)
      ? input.fields
      : {},
    kind: normalizeComposerControlKind(input?.kind),
    message: normalizeText(input?.message || input?.text),
    originId: normalizeText(input?.originId),
    reason: normalizeText(input?.reason),
    submittedAt: new Date().toISOString()
  };
  if (
    !normalizedSessionId ||
    !request.afterSubmissionId ||
    !request.controlRequestId ||
    !request.kind ||
    (request.kind === COMPOSER_CONTROL_KINDS.STEER && !request.message) ||
    typeof runtime?.getSession !== "function" ||
    typeof runtime?.store?.writeAgentRunEvent !== "function"
  ) {
    throw new TypeError("Queued assistant controls require a session, handoff submission, control request, valid kind, and runtime store.");
  }
  const session = await runtime.getSession(normalizedSessionId);
  const run = composerHandoffRun(session) || {};
  const existing = composerControlRequests(run)
    .find((candidate) => candidate.controlRequestId === request.controlRequestId);
  if (existing) {
    return existing;
  }
  const persistedRun = await runtime.store.writeAgentRunEvent(
    normalizedSessionId,
    COMPOSER_HANDOFF_AGENT_RUN_ID,
    {
      event: {
        kind: COMPOSER_CONTROL_EVENT_KINDS.ACCEPTED,
        request,
        state: normalizeText(run.state) || VIBE64_AGENT_RUN_STATE.STARTING,
      },
      patch: {
        state: normalizeText(run.state) || VIBE64_AGENT_RUN_STATE.STARTING,
        updatedAt: request.submittedAt
      }
    }
  );
  return composerControlRequests(persistedRun)
    .find((candidate) => candidate.controlRequestId === request.controlRequestId);
}

async function settleComposerControl(runtime, sessionId = "", controlRequestId = "", {
  error = "",
  state = "delivered"
} = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const normalizedControlRequestId = normalizeText(controlRequestId);
  const eventKind = state === "failed"
    ? COMPOSER_CONTROL_EVENT_KINDS.FAILED
    : COMPOSER_CONTROL_EVENT_KINDS.DELIVERED;
  if (
    !normalizedSessionId ||
    !normalizedControlRequestId ||
    typeof runtime?.getSession !== "function" ||
    typeof runtime?.store?.writeAgentRunEvent !== "function"
  ) {
    throw new TypeError("Assistant control settlement requires a session, control request, and runtime store.");
  }
  const session = await runtime.getSession(normalizedSessionId);
  const run = composerHandoffRun(session) || {};
  const current = composerControlRequests(run)
    .find((candidate) => candidate.controlRequestId === normalizedControlRequestId);
  if (!current || current.state !== "accepted") {
    return current || null;
  }
  const persistedRun = await runtime.store.writeAgentRunEvent(
    normalizedSessionId,
    COMPOSER_HANDOFF_AGENT_RUN_ID,
    {
      event: {
        controlRequestId: normalizedControlRequestId,
        error: normalizeText(error),
        kind: eventKind,
        state: normalizeText(run.state) || VIBE64_AGENT_RUN_STATE.STARTING
      },
      patch: {
        state: normalizeText(run.state) || VIBE64_AGENT_RUN_STATE.STARTING,
        updatedAt: new Date().toISOString()
      }
    }
  );
  return composerControlRequests(persistedRun)
    .find((candidate) => candidate.controlRequestId === normalizedControlRequestId);
}

function composerHandoffSnapshot(source = {}) {
  const run = normalizeText(source?.id) === COMPOSER_HANDOFF_AGENT_RUN_ID
    ? source
    : composerHandoffRun(source);
  const id = normalizeText(run?.handoffId);
  const state = normalizeState(run?.handoffState);
  if (!run || !id || !state) {
    return null;
  }
  const connectionReused = typeof run.connectionReused === "boolean"
    ? run.connectionReused
    : null;
  return {
    acceptedAt: normalizeText(run.handoffAcceptedAt),
    activeAt: normalizeText(run.handoffActiveAt),
    canonical: true,
    connectingAt: normalizeText(run.handoffConnectingAt),
    connectionReused,
    deliveredAt: normalizeText(run.handoffDeliveredAt),
    error: normalizeText(run.error),
    failedAt: normalizeText(run.handoffFailedAt),
    id,
    pending: COMPOSER_HANDOFF_PENDING_STATES.has(state),
    providerId: normalizeText(run.provider),
    schemaVersion: COMPOSER_HANDOFF_SCHEMA_VERSION,
    state,
    submissionId: normalizeText(run.clientSubmissionId),
    threadId: normalizeText(run.providerThreadId),
    transportId: normalizeText(run.providerInterface),
    turnId: normalizeText(run.providerTurnId),
    updatedAt: normalizeText(run.updatedAt)
  };
}

function composerHandoffActionResult(session = {}, handoffId = "") {
  const normalizedHandoffId = normalizeText(handoffId) || composerHandoffSnapshot(session)?.id || "";
  if (!normalizedHandoffId) {
    return null;
  }
  const results = [
    ...(session?.actionResult ? [session.actionResult] : []),
    ...(Array.isArray(session?.actionResults) ? session.actionResults : [])
  ];
  return results.find((result) => (
    composerHandoffId(result?.agentPromptHandoff) === normalizedHandoffId
  )) || null;
}

function composerPromptHandoffForState(session = {}, handoffId = "") {
  const result = composerHandoffActionResult(session, handoffId);
  const handoff = result?.agentPromptHandoff;
  return handoff && typeof handoff === "object" && !Array.isArray(handoff)
    ? handoff
    : null;
}

function composerHandoffTransitionAllowed(previousState = "", nextState = "", {
  newHandoff = false
} = {}) {
  const normalizedPrevious = normalizeState(previousState);
  const normalizedNext = normalizeState(nextState);
  if (!normalizedNext) {
    return false;
  }
  if (!normalizedPrevious) {
    return normalizedNext === COMPOSER_HANDOFF_STATES.ACCEPTED;
  }
  if (newHandoff) {
    return normalizedNext === COMPOSER_HANDOFF_STATES.ACCEPTED &&
      !COMPOSER_HANDOFF_PENDING_STATES.has(normalizedPrevious);
  }
  if (normalizedPrevious === normalizedNext) {
    return true;
  }
  return COMPOSER_HANDOFF_TRANSITIONS[normalizedPrevious]?.has(normalizedNext) === true;
}

function invalidTransitionError(previousState = "", nextState = "") {
  const error = new Error(
    `Invalid composer handoff transition: ${normalizeText(previousState) || "none"} -> ${normalizeText(nextState) || "none"}.`
  );
  error.code = "vibe64_composer_handoff_transition_invalid";
  return error;
}

function genericAgentRunStateForHandoff(state = "") {
  if (state === COMPOSER_HANDOFF_STATES.ACTIVE) {
    return VIBE64_AGENT_RUN_STATE.COMPLETED;
  }
  if (state === COMPOSER_HANDOFF_STATES.FAILED) {
    return VIBE64_AGENT_RUN_STATE.FAILED;
  }
  return VIBE64_AGENT_RUN_STATE.STARTING;
}

function transitionTimestamps(previous = {}, state = "", at = "") {
  if (state === COMPOSER_HANDOFF_STATES.ACCEPTED) {
    return {
      handoffAcceptedAt: at,
      handoffActiveAt: "",
      handoffConnectingAt: "",
      handoffDeliveredAt: "",
      handoffFailedAt: ""
    };
  }
  const fieldByState = {
    [COMPOSER_HANDOFF_STATES.ACTIVE]: "handoffActiveAt",
    [COMPOSER_HANDOFF_STATES.CONNECTING]: "handoffConnectingAt",
    [COMPOSER_HANDOFF_STATES.DELIVERED]: "handoffDeliveredAt",
    [COMPOSER_HANDOFF_STATES.FAILED]: "handoffFailedAt"
  };
  const field = fieldByState[state];
  return field && !normalizeText(previous[field])
    ? { [field]: at }
    : {};
}

async function transitionComposerHandoff(runtime, sessionId = "", {
  agentSettings = null,
  connectionReused = null,
  error = "",
  handoff = null,
  handoffId = "",
  providerId = "",
  state = "",
  stepId = "",
  stepStatus = "",
  submissionId = "",
  threadId = "",
  transportId = "",
  turnId = ""
} = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const normalizedState = normalizeState(state);
  if (!normalizedSessionId || !normalizedState || typeof runtime?.store?.writeAgentRunEvent !== "function") {
    throw new TypeError("Composer handoff transitions require a session runtime, session id, and valid state.");
  }
  const currentSession = typeof runtime?.getSession === "function"
    ? await runtime.getSession(normalizedSessionId)
    : {};
  const previousRun = composerHandoffRun(currentSession) || {};
  const previous = composerHandoffSnapshot(previousRun);
  const normalizedHandoffId = normalizeText(handoffId) || composerHandoffId(handoff) || previous?.id || "";
  if (!normalizedHandoffId) {
    throw new TypeError("Composer handoff transitions require a handoff id.");
  }
  const newHandoff = Boolean(previous?.id && previous.id !== normalizedHandoffId);
  if (!composerHandoffTransitionAllowed(previous?.state, normalizedState, {
    newHandoff
  })) {
    throw invalidTransitionError(previous?.state, normalizedState);
  }
  if (previous?.id === normalizedHandoffId && previous.state === normalizedState) {
    return previous;
  }

  const updatedAt = new Date().toISOString();
  const accepted = normalizedState === COMPOSER_HANDOFF_STATES.ACCEPTED;
  const normalizedError = normalizeText(error);
  const patch = {
    ...(accepted ? {
      clientSubmissionId: normalizeText(submissionId),
      connectionReused: null,
      error: "",
      providerThreadId: normalizeText(threadId),
      providerTurnId: ""
    } : {}),
    ...(agentSettings && typeof agentSettings === "object" && !Array.isArray(agentSettings)
      ? { agentSettings }
      : {}),
    ...(typeof connectionReused === "boolean" ? { connectionReused } : {}),
    ...(normalizedError || normalizedState === COMPOSER_HANDOFF_STATES.FAILED
      ? { error: normalizedError || "Assistant prompt delivery failed." }
      : {}),
    ...transitionTimestamps(previousRun, normalizedState, updatedAt),
    handoffId: normalizedHandoffId,
    handoffState: normalizedState,
    provider: normalizeText(providerId) || previous?.providerId || "",
    providerInterface: normalizeText(transportId) || previous?.transportId || "",
    providerStatus: `handoff_${normalizedState}`,
    ...(normalizeText(threadId) ? { providerThreadId: normalizeText(threadId) } : {}),
    ...(normalizeText(turnId) ? { providerTurnId: normalizeText(turnId) } : {}),
    schemaVersion: COMPOSER_HANDOFF_SCHEMA_VERSION,
    state: genericAgentRunStateForHandoff(normalizedState),
    stepId: normalizeText(stepId || currentSession.currentStep),
    stepStatus: normalizeText(stepStatus || currentSession.stepMachine?.status),
    updatedAt
  };
  const run = await runtime.store.writeAgentRunEvent(normalizedSessionId, COMPOSER_HANDOFF_AGENT_RUN_ID, {
    event: {
      kind: `composer-handoff-${normalizedState}`,
      message: patch.error || "",
      state: patch.state
    },
    patch
  });
  return composerHandoffSnapshot(run);
}

export {
  COMPOSER_CONTROL_KINDS,
  COMPOSER_HANDOFF_AGENT_RUN_ID,
  COMPOSER_HANDOFF_STATES,
  acceptComposerControl,
  composerControlRequests,
  composerHandoffId,
  composerHandoffRun,
  composerHandoffSnapshot,
  composerPromptHandoffForState,
  pendingComposerControls,
  settleComposerControl,
  transitionComposerHandoff
};
