const VIBE64_SESSION_CHANGED_EVENT = "vibe64.session.changed";
const VIBE64_SESSION_EVENT_ENTITY = "session";
const VIBE64_SESSION_EVENT_SOURCE = "vibe64";
const VIBE64_SESSION_REALTIME_AUDIENCE = "all_clients";

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

function clientRefreshPayload(source = {}) {
  const clientRefresh = source?.clientRefresh;
  if (!plainObject(clientRefresh) || clientRefresh.includeList !== true) {
    return {};
  }
  return {
    clientRefresh: {
      includeList: true
    }
  };
}

function sessionIdFromServiceEvent({ result = {}, args = [] } = {}) {
  return sessionIdFromResult(result) || normalizeSessionId(args?.[0]);
}

function originIdFromValue(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  return normalizeSessionId(value.originId || value.input?.originId || "");
}

function originIdFromServiceEvent({ result = {}, args = [] } = {}) {
  const resultOriginId = originIdFromValue(result);
  if (resultOriginId) {
    return resultOriginId;
  }
  for (const arg of Array.isArray(args) ? args : []) {
    const argOriginId = originIdFromValue(arg);
    if (argOriginId) {
      return argOriginId;
    }
  }
  return "";
}

function plainObject(value = null) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sessionComposerMenuPayload(source = {}) {
  const session = plainObject(source?.session)
    ? source.session
    : source;
  const menu = session?.presentation?.composerMenu;
  if (!plainObject(menu)) {
    return {};
  }
  const signature = normalizeSessionId(menu.signature);
  if (!signature) {
    return {};
  }
  const itemCount = safeSessionNumber(menu.itemCount);
  return {
    composerMenu: {
      signature,
      ...(itemCount === null ? {} : { itemCount })
    }
  };
}

function vibe64SessionRealtimePayload({ result = {}, args = [] } = {}) {
  const sessionId = sessionIdFromResult(result) || normalizeSessionId(args?.[0]);
  const originId = originIdFromServiceEvent({
    args,
    result
  });
  return sessionId
    ? {
        sessionId,
        ...sessionStatePayload(result),
        ...sessionComposerMenuPayload(result),
        ...clientRefreshPayload(result),
        ...(originId ? { originId } : {})
      }
    : {};
}

function vibe64SessionChangedServiceEvent({
  operation = "updated",
  reason = ""
} = {}) {
  const normalizedReason = normalizeSessionId(reason);
  return Object.freeze({
    type: "entity.changed",
    source: VIBE64_SESSION_EVENT_SOURCE,
    entity: VIBE64_SESSION_EVENT_ENTITY,
    operation,
    entityId: sessionIdFromServiceEvent,
    realtime: Object.freeze({
      event: VIBE64_SESSION_CHANGED_EVENT,
      audience: VIBE64_SESSION_REALTIME_AUDIENCE,
      payload: (context = {}) => {
        const payload = vibe64SessionRealtimePayload(context);
        return normalizedReason
          ? {
              ...payload,
              reason: normalizedReason
            }
          : payload;
      }
    })
  });
}

function createVibe64SessionChangedPublisher({
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

  return async function publishVibe64SessionChanged(sessionId = "", {
    operation = "updated",
    originId = "",
    payload = null,
    reason = "",
    session = null
  } = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return null;
    }
    const realtimePayload = {
      ...vibe64SessionRealtimePayload({
        args: [normalizedSessionId],
        result: session || {
          sessionId: normalizedSessionId
        }
      }),
      ...(plainObject(payload) ? payload : {}),
      ...(originId ? { originId: normalizeSessionId(originId) } : {}),
      ...(reason ? { reason } : {})
    };

    return domainEvents.publish({
      source: VIBE64_SESSION_EVENT_SOURCE,
      entity: VIBE64_SESSION_EVENT_ENTITY,
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
          event: VIBE64_SESSION_CHANGED_EVENT,
          payload: realtimePayload
        }
      }
    });
  };
}

export {
  VIBE64_SESSION_CHANGED_EVENT,
  vibe64SessionChangedServiceEvent,
  createVibe64SessionChangedPublisher
};
