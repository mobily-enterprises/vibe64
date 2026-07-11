import {
  VIBE64_AGENT_RUN_STATE
} from "@local/vibe64-runtime/server";
import {
  normalizeText
} from "@local/vibe64-core/server/core";

const COMPOSER_MESSAGE_AGENT_RUN_ID = "composer_messages";
const COMPOSER_MESSAGE_STATES = Object.freeze({
  ACCEPTED: "accepted",
  CANCELLED: "cancelled",
  DELIVERED: "delivered",
  FAILED: "failed"
});
const COMPOSER_MESSAGE_SETTLEMENTS = Object.freeze({
  DEFERRED: "deferred",
  DELIVERED: "delivered",
  FAILED: "failed"
});
const COMPOSER_MESSAGE_EVENT_KINDS = Object.freeze({
  ACCEPTED: "composer-message-accepted",
  CANCELLED: "composer-message-cancelled",
  DEFERRED: "composer-message-deferred",
  DELIVERED: "composer-message-delivered",
  FAILED: "composer-message-failed",
  RETRIED: "composer-message-retried"
});

function composerMessageRun(source = {}) {
  if (normalizeText(source?.id) === COMPOSER_MESSAGE_AGENT_RUN_ID) {
    return source;
  }
  return (Array.isArray(source?.agentRuns) ? source.agentRuns : [])
    .find((run) => normalizeText(run?.id) === COMPOSER_MESSAGE_AGENT_RUN_ID) || null;
}

function composerMessageVibe64User(source = null) {
  const username = normalizeText(
    source?.username ||
    source?.osUsername ||
    source?.name
  );
  if (!username) {
    return null;
  }
  const githubLogin = normalizeText(source?.github?.login);
  return {
    ...(githubLogin
      ? {
          github: {
            avatarUrl: normalizeText(source.github.avatarUrl),
            connectedAt: normalizeText(source.github.connectedAt),
            id: Number.isSafeInteger(Number(source.github.id)) ? Number(source.github.id) : 0,
            login: githubLogin
          }
        }
      : {}),
    username
  };
}

function composerMessageRequests(source = {}) {
  const run = composerMessageRun(source);
  const requests = new Map();
  for (const event of Array.isArray(run?.events) ? run.events : []) {
    const kind = normalizeText(event?.kind);
    const messageId = normalizeText(event?.request?.messageId || event?.messageId);
    if (!messageId) {
      continue;
    }
    if (kind === COMPOSER_MESSAGE_EVENT_KINDS.ACCEPTED && !requests.has(messageId)) {
      const request = event.request && typeof event.request === "object" && !Array.isArray(event.request)
        ? event.request
        : {};
      requests.set(messageId, {
        afterSubmissionId: normalizeText(request.afterSubmissionId),
        agentSettings: request.agentSettings && typeof request.agentSettings === "object" && !Array.isArray(request.agentSettings)
          ? request.agentSettings
          : {},
        attempts: 0,
        cancelledAt: "",
        displayFields: request.displayFields && typeof request.displayFields === "object" && !Array.isArray(request.displayFields)
          ? request.displayFields
          : {},
        error: "",
        fields: request.fields && typeof request.fields === "object" && !Array.isArray(request.fields)
          ? request.fields
          : {},
        lastAttemptAt: "",
        message: normalizeText(request.message || request.text),
        messageId,
        operationOutcome: "",
        originId: normalizeText(request.originId),
        retriedAt: "",
        retryable: null,
        state: COMPOSER_MESSAGE_STATES.ACCEPTED,
        submittedAt: normalizeText(event.at || request.submittedAt),
        threadId: "",
        turnId: "",
        vibe64User: composerMessageVibe64User(request.vibe64User)
      });
      continue;
    }
    const current = requests.get(messageId);
    if (!current) {
      continue;
    }
    if (
      kind === COMPOSER_MESSAGE_EVENT_KINDS.RETRIED &&
      current.state === COMPOSER_MESSAGE_STATES.FAILED
    ) {
      const retryRequest = event.request && typeof event.request === "object" && !Array.isArray(event.request)
        ? event.request
        : {};
      requests.set(messageId, {
        ...current,
        agentSettings: retryRequest.agentSettings && typeof retryRequest.agentSettings === "object" && !Array.isArray(retryRequest.agentSettings)
          ? retryRequest.agentSettings
          : current.agentSettings,
        attempts: 0,
        error: "",
        lastAttemptAt: "",
        operationOutcome: "",
        originId: normalizeText(retryRequest.originId) || current.originId,
        retriedAt: normalizeText(event.at),
        retryable: null,
        state: COMPOSER_MESSAGE_STATES.ACCEPTED,
        submittedAt: normalizeText(event.at) || current.submittedAt,
        vibe64User: composerMessageVibe64User(retryRequest.vibe64User) || current.vibe64User
      });
    } else if (
      kind === COMPOSER_MESSAGE_EVENT_KINDS.DEFERRED &&
      current.state === COMPOSER_MESSAGE_STATES.ACCEPTED
    ) {
      requests.set(messageId, {
        ...current,
        attempts: current.attempts + 1,
        error: normalizeText(event.error) || "Message delivery is waiting to retry.",
        lastAttemptAt: normalizeText(event.at),
        operationOutcome: normalizeText(event.operationOutcome),
        retryable: true,
        threadId: normalizeText(event.threadId) || current.threadId,
        turnId: normalizeText(event.turnId) || current.turnId
      });
    } else if (
      kind === COMPOSER_MESSAGE_EVENT_KINDS.DELIVERED &&
      current.state === COMPOSER_MESSAGE_STATES.ACCEPTED
    ) {
      requests.set(messageId, {
        ...current,
        attempts: current.attempts + 1,
        error: "",
        lastAttemptAt: normalizeText(event.at),
        operationOutcome: normalizeText(event.operationOutcome),
        retryable: false,
        state: COMPOSER_MESSAGE_STATES.DELIVERED,
        threadId: normalizeText(event.threadId) || current.threadId,
        turnId: normalizeText(event.turnId) || current.turnId
      });
    } else if (
      kind === COMPOSER_MESSAGE_EVENT_KINDS.FAILED &&
      current.state === COMPOSER_MESSAGE_STATES.ACCEPTED
    ) {
      requests.set(messageId, {
        ...current,
        attempts: current.attempts + 1,
        error: normalizeText(event.error) || "Message delivery failed.",
        lastAttemptAt: normalizeText(event.at),
        operationOutcome: normalizeText(event.operationOutcome),
        retryable: false,
        state: COMPOSER_MESSAGE_STATES.FAILED,
        threadId: normalizeText(event.threadId) || current.threadId,
        turnId: normalizeText(event.turnId) || current.turnId
      });
    } else if (
      kind === COMPOSER_MESSAGE_EVENT_KINDS.CANCELLED &&
      current.state === COMPOSER_MESSAGE_STATES.FAILED
    ) {
      requests.set(messageId, {
        ...current,
        cancelledAt: normalizeText(event.at),
        error: "",
        operationOutcome: "cancelled_by_user",
        retryable: false,
        state: COMPOSER_MESSAGE_STATES.CANCELLED
      });
    }
  }
  return [...requests.values()];
}

function pendingComposerMessages(source = {}) {
  return composerMessageRequests(source)
    .filter((request) => request.state === COMPOSER_MESSAGE_STATES.ACCEPTED);
}

function composerMessageBatch(requests = []) {
  const pending = (Array.isArray(requests) ? requests : [])
    .filter((request) => request?.state === COMPOSER_MESSAGE_STATES.ACCEPTED && normalizeText(request.message));
  const first = pending[0];
  if (!first) {
    return null;
  }
  const ownerUsername = normalizeText(first.vibe64User?.username);
  const messages = [];
  for (const request of pending) {
    if (normalizeText(request.vibe64User?.username) !== ownerUsername) {
      break;
    }
    messages.push(request);
  }
  const message = messages.map((request) => normalizeText(request.message)).join("\n\n");
  const displayMessage = messages.map((request) => normalizeText(
    request.displayFields?.conversationRequest ||
    request.displayFields?.message ||
    request.message
  )).join("\n\n");
  return {
    ...first,
    displayFields: {
      ...first.displayFields,
      conversationRequest: displayMessage
    },
    fields: {
      ...first.fields,
      conversationRequest: message
    },
    message,
    messageIds: messages.map((request) => request.messageId),
    messages
  };
}

async function writeComposerMessageEvent(runtime, sessionId = "", event = {}) {
  return runtime.store.writeAgentRunEvent(
    sessionId,
    COMPOSER_MESSAGE_AGENT_RUN_ID,
    {
      event: {
        ...event,
        state: VIBE64_AGENT_RUN_STATE.COMPLETED
      },
      patch: {
        state: VIBE64_AGENT_RUN_STATE.COMPLETED,
        updatedAt: normalizeText(event.at) || new Date().toISOString()
      }
    }
  );
}

async function acceptComposerMessage(runtime, sessionId = "", input = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const request = {
    afterSubmissionId: normalizeText(input?.afterSubmissionId),
    agentSettings: input?.agentSettings && typeof input.agentSettings === "object" && !Array.isArray(input.agentSettings)
      ? input.agentSettings
      : {},
    displayFields: input?.displayFields && typeof input.displayFields === "object" && !Array.isArray(input.displayFields)
      ? input.displayFields
      : {},
    fields: input?.fields && typeof input.fields === "object" && !Array.isArray(input.fields)
      ? input.fields
      : {},
    message: normalizeText(input?.message || input?.text),
    messageId: normalizeText(input?.messageId || input?.composerSubmissionId),
    originId: normalizeText(input?.originId),
    submittedAt: new Date().toISOString(),
    vibe64User: composerMessageVibe64User(input?.vibe64User)
  };
  if (
    !normalizedSessionId ||
    !request.messageId ||
    !request.message ||
    typeof runtime?.getSession !== "function" ||
    typeof runtime?.store?.writeAgentRunEvent !== "function"
  ) {
    throw new TypeError("Composer messages require a session, message id, message text, and runtime store.");
  }
  const session = await runtime.getSession(normalizedSessionId);
  const existing = composerMessageRequests(session)
    .find((candidate) => candidate.messageId === request.messageId);
  if (existing) {
    if (existing.state !== COMPOSER_MESSAGE_STATES.FAILED) {
      return existing;
    }
    const run = await writeComposerMessageEvent(runtime, normalizedSessionId, {
      at: new Date().toISOString(),
      kind: COMPOSER_MESSAGE_EVENT_KINDS.RETRIED,
      messageId: request.messageId,
      request: {
        agentSettings: request.agentSettings,
        originId: request.originId,
        vibe64User: request.vibe64User
      }
    });
    return composerMessageRequests(run)
      .find((candidate) => candidate.messageId === request.messageId);
  }
  const run = await writeComposerMessageEvent(runtime, normalizedSessionId, {
    at: request.submittedAt,
    kind: COMPOSER_MESSAGE_EVENT_KINDS.ACCEPTED,
    request
  });
  return composerMessageRequests(run)
    .find((candidate) => candidate.messageId === request.messageId);
}

async function cancelComposerMessage(runtime, sessionId = "", messageId = "", input = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const normalizedMessageId = normalizeText(messageId);
  if (
    !normalizedSessionId ||
    !normalizedMessageId ||
    typeof runtime?.getSession !== "function" ||
    typeof runtime?.store?.writeAgentRunEvent !== "function"
  ) {
    throw new TypeError("Composer message cancellation requires a session, message id, and runtime store.");
  }
  const session = await runtime.getSession(normalizedSessionId);
  const current = composerMessageRequests(session)
    .find((candidate) => candidate.messageId === normalizedMessageId);
  if (!current || current.state !== COMPOSER_MESSAGE_STATES.FAILED) {
    return current || null;
  }
  const run = await writeComposerMessageEvent(runtime, normalizedSessionId, {
    at: new Date().toISOString(),
    kind: COMPOSER_MESSAGE_EVENT_KINDS.CANCELLED,
    messageId: normalizedMessageId,
    originId: normalizeText(input?.originId),
    vibe64User: composerMessageVibe64User(input?.vibe64User)
  });
  return composerMessageRequests(run)
    .find((candidate) => candidate.messageId === normalizedMessageId);
}

async function settleComposerMessage(runtime, sessionId = "", messageId = "", {
  error = "",
  operationOutcome = "",
  outcome = COMPOSER_MESSAGE_SETTLEMENTS.DELIVERED,
  threadId = "",
  turnId = ""
} = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const normalizedMessageId = normalizeText(messageId);
  const eventKind = {
    [COMPOSER_MESSAGE_SETTLEMENTS.DEFERRED]: COMPOSER_MESSAGE_EVENT_KINDS.DEFERRED,
    [COMPOSER_MESSAGE_SETTLEMENTS.DELIVERED]: COMPOSER_MESSAGE_EVENT_KINDS.DELIVERED,
    [COMPOSER_MESSAGE_SETTLEMENTS.FAILED]: COMPOSER_MESSAGE_EVENT_KINDS.FAILED
  }[normalizeText(outcome)];
  if (!eventKind) {
    throw new TypeError("Composer message settlement requires a valid outcome.");
  }
  if (
    !normalizedSessionId ||
    !normalizedMessageId ||
    typeof runtime?.getSession !== "function" ||
    typeof runtime?.store?.writeAgentRunEvent !== "function"
  ) {
    throw new TypeError("Composer message settlement requires a session, message id, and runtime store.");
  }
  const session = await runtime.getSession(normalizedSessionId);
  const current = composerMessageRequests(session)
    .find((candidate) => candidate.messageId === normalizedMessageId);
  if (!current || current.state !== COMPOSER_MESSAGE_STATES.ACCEPTED) {
    return current || null;
  }
  const run = await writeComposerMessageEvent(runtime, normalizedSessionId, {
    at: new Date().toISOString(),
    error: normalizeText(error),
    kind: eventKind,
    messageId: normalizedMessageId,
    operationOutcome: normalizeText(operationOutcome),
    retryable: outcome === COMPOSER_MESSAGE_SETTLEMENTS.DEFERRED,
    threadId: normalizeText(threadId),
    turnId: normalizeText(turnId)
  });
  return composerMessageRequests(run)
    .find((candidate) => candidate.messageId === normalizedMessageId);
}

function publicComposerMessages(source = {}) {
  return composerMessageRequests(source).map((message) => ({
    afterSubmissionId: message.afterSubmissionId,
    attempts: message.attempts,
    ...(message.cancelledAt ? { cancelledAt: message.cancelledAt } : {}),
    displayMessage: normalizeText(
      message.displayFields?.conversationRequest ||
      message.displayFields?.message ||
      message.message
    ),
    error: message.error,
    id: message.messageId,
    lastAttemptAt: message.lastAttemptAt,
    message: message.message,
    operationOutcome: message.operationOutcome,
    retriedAt: message.retriedAt,
    retryable: message.retryable,
    state: message.state,
    submittedAt: message.submittedAt,
    threadId: message.threadId,
    turnId: message.turnId
  }));
}

export {
  COMPOSER_MESSAGE_AGENT_RUN_ID,
  COMPOSER_MESSAGE_SETTLEMENTS,
  COMPOSER_MESSAGE_STATES,
  acceptComposerMessage,
  cancelComposerMessage,
  composerMessageBatch,
  composerMessageRequests,
  pendingComposerMessages,
  publicComposerMessages,
  settleComposerMessage
};
