import { currentProjectRequestContext } from "./projectRequestContext.js";

const VIBE64_OUTPUTS_CLIENT_REFRESH_PAYLOAD = Object.freeze({
  clientRefresh: Object.freeze({ includeOutputs: true })
});

const VIBE64_SESSION_CHANGED_EVENT = "vibe64.session.changed";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedClientRefresh(value = {}) {
  const source = record(value);
  return {
    ...(source.includeOutputs === true ? { includeOutputs: true } : {}),
    ...(source.includeList === true ? { includeList: true } : {})
  };
}

function sessionRealtimePayload(sessionId, { session: sessionValue, originId, reason, payload }) {
  const source = record(sessionValue);
  const nestedSession = record(source.session);
  const session = Object.keys(nestedSession).length > 0 ? nestedSession : source;
  const id = String(source.sessionId || source.id || nestedSession.sessionId || nestedSession.id || "").trim()
    || sessionId;
  const origin = String(source.originId || record(source.input).originId || "").trim()
    || String(originId || "").trim();
  const revision = Number(session.revision);
  const status = String(session.status || "").trim();
  const sessionRefresh = normalizedClientRefresh(source.clientRefresh);
  const additionalPayload = record(payload);
  const additionalRefresh = normalizedClientRefresh(additionalPayload.clientRefresh);
  const {
    clientRefresh: _clientRefresh,
    learningAttemptId: _learningAttemptId,
    ...additionalFields
  } = additionalPayload;
  void _clientRefresh;
  void _learningAttemptId;
  const context = currentProjectRequestContext();
  const learningAttemptId = String(context?.learningScope?.attemptId ||
    (!context?.slug && session.purpose === "learning" ? session.learning?.attemptId : "") || "").trim();
  const clientRefresh = {
    ...sessionRefresh,
    ...additionalRefresh
  };
  return {
    sessionId: id,
    ...(Number.isSafeInteger(revision) && revision >= 0 ? { revision } : {}),
    ...(status ? { status } : {}),
    ...additionalFields,
    projectSlug: learningAttemptId ? "" : String(context?.slug || session.projectSlug || additionalFields.projectSlug || "").trim(),
    ...(learningAttemptId ? { learningAttemptId } : {}),
    ...(Object.keys(clientRefresh).length > 0 ? { clientRefresh } : {}),
    ...(origin ? { originId: origin } : {}),
    ...(reason ? { reason } : {})
  };
}

function createSessionChangedPublisher(events) {
  if (!events || typeof events.publish !== "function") {
    throw new TypeError("createSessionChangedPublisher requires runtime.events.");
  }
  return async function publishSessionChanged(sessionIdValue = "", {
    operation = "updated",
    originId: eventOriginId = "",
    payload = null,
    reason = "",
    session = null
  } = {}) {
    const id = String(sessionIdValue || "").trim();
    if (!id) {
      return null;
    }
    return events.publish(Object.freeze({
      type: "entity.changed",
      source: "vibe64",
      entity: "session",
      operation: String(operation || "updated").trim() || "updated",
      entityId: id,
      scope: Object.freeze({
        kind: "global",
        id: null
      }),
      occurredAt: new Date().toISOString(),
      realtime: Object.freeze({
        audience: "all_clients",
        event: VIBE64_SESSION_CHANGED_EVENT,
        payload: Object.freeze(sessionRealtimePayload(id, {
          session,
          originId: eventOriginId,
          reason,
          payload
        }))
      })
    }));
  };
}

export {
  VIBE64_SESSION_CHANGED_EVENT,
  createSessionChangedPublisher,
  VIBE64_OUTPUTS_CLIENT_REFRESH_PAYLOAD
};
