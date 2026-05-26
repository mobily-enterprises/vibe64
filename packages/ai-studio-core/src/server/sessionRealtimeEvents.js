const AI_STUDIO_SESSION_CHANGED_EVENT = "ai-studio.session.changed";
const AI_STUDIO_SESSION_EVENT_ENTITY = "session";
const AI_STUDIO_SESSION_EVENT_SOURCE = "ai-studio";
const AI_STUDIO_SESSION_REALTIME_AUDIENCE = "all_clients";

function normalizeSessionId(value = "") {
  return String(value || "").trim();
}

function sessionIdFromResult(result = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {};
  return normalizeSessionId(
    source.sessionId ||
    source.session?.sessionId ||
    source.session?.id ||
    ""
  );
}

function safeSessionNumber(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function sessionStatePayload(source = {}) {
  const session = source?.session && typeof source.session === "object" && !Array.isArray(source.session)
    ? source.session
    : source;
  if (!session || typeof session !== "object" || Array.isArray(session)) {
    return {};
  }
  const revision = safeSessionNumber(session.revision);
  const stepRevision = safeSessionNumber(session.stepRevision);
  const currentStep = normalizeSessionId(session.currentStep);
  const stepStatus = normalizeSessionId(session.stepMachine?.status);
  return {
    ...(revision === null ? {} : { revision }),
    ...(stepRevision === null ? {} : { stepRevision }),
    ...(currentStep ? { currentStep } : {}),
    ...(stepStatus ? { stepStatus } : {})
  };
}

function sessionIdFromServiceEvent({ result = {}, args = [] } = {}) {
  return sessionIdFromResult(result) || normalizeSessionId(args?.[0]);
}

function aiStudioSessionRealtimePayload({ result = {}, args = [] } = {}) {
  const sessionId = sessionIdFromResult(result) || normalizeSessionId(args?.[0]);
  return sessionId
    ? {
        sessionId,
        ...sessionStatePayload(result)
      }
    : {};
}

function aiStudioSessionChangedServiceEvent({
  operation = "updated"
} = {}) {
  return Object.freeze({
    type: "entity.changed",
    source: AI_STUDIO_SESSION_EVENT_SOURCE,
    entity: AI_STUDIO_SESSION_EVENT_ENTITY,
    operation,
    entityId: sessionIdFromServiceEvent,
    realtime: Object.freeze({
      event: AI_STUDIO_SESSION_CHANGED_EVENT,
      audience: AI_STUDIO_SESSION_REALTIME_AUDIENCE,
      payload: aiStudioSessionRealtimePayload
    })
  });
}

function createAiStudioSessionChangedPublisher({
  domainEvents = null,
  methodName = "",
  serviceToken = ""
} = {}) {
  const normalizedServiceToken = normalizeSessionId(serviceToken);
  const normalizedMethodName = normalizeSessionId(methodName);
  if (!domainEvents || typeof domainEvents.publish !== "function" || !normalizedServiceToken || !normalizedMethodName) {
    return async function publishNoop() {
      return null;
    };
  }

  return async function publishAiStudioSessionChanged(sessionId = "", {
    operation = "updated",
    reason = "",
    session = null
  } = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return null;
    }
    const realtimePayload = {
      ...aiStudioSessionRealtimePayload({
        args: [normalizedSessionId],
        result: session || {
          sessionId: normalizedSessionId
        }
      }),
      ...(reason ? { reason } : {})
    };

    return domainEvents.publish({
      source: AI_STUDIO_SESSION_EVENT_SOURCE,
      entity: AI_STUDIO_SESSION_EVENT_ENTITY,
      operation: normalizeSessionId(operation) || "updated",
      entityId: normalizedSessionId,
      scope: {
        kind: "global",
        id: null
      },
      occurredAt: new Date().toISOString(),
      meta: {
        service: {
          token: normalizedServiceToken,
          method: normalizedMethodName
        },
        realtime: {
          event: AI_STUDIO_SESSION_CHANGED_EVENT,
          payload: realtimePayload
        }
      }
    });
  };
}

export {
  AI_STUDIO_SESSION_CHANGED_EVENT,
  aiStudioSessionChangedServiceEvent,
  createAiStudioSessionChangedPublisher
};
