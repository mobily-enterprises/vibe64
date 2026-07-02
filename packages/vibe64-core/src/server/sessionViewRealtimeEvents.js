const VIBE64_SESSION_VIEW_CHANGED_EVENT = "vibe64.session.view.changed";
const VIBE64_SESSION_VIEW_EVENT_ENTITY = "session_view";
const VIBE64_SESSION_VIEW_EVENT_SOURCE = "vibe64";
const VIBE64_SESSION_VIEW_REALTIME_AUDIENCE = "all_clients";

function normalizeSessionViewValue(value = "") {
  return String(value || "").trim();
}

function plainObject(value = null) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sessionViewStateFromServiceResult(result = {}) {
  const source = plainObject(result) ? result : {};
  const viewState = plainObject(source.viewState) ? source.viewState : null;
  return viewState;
}

function sessionViewRealtimePayload({ result = {} } = {}) {
  const viewState = sessionViewStateFromServiceResult(result);
  if (!viewState) {
    return {};
  }
  const sessionId = normalizeSessionViewValue(viewState.sessionId);
  const projectSlug = normalizeSessionViewValue(viewState.projectSlug);
  const routeFullPath = normalizeSessionViewValue(viewState.routeFullPath);
  const originId = normalizeSessionViewValue(viewState.originId);
  if (!sessionId || !projectSlug || !routeFullPath || !originId) {
    return {};
  }
  return {
    originId,
    projectPane: normalizeSessionViewValue(viewState.projectPane),
    projectSlug,
    routeFullPath,
    sessionId,
    updatedAt: normalizeSessionViewValue(viewState.updatedAt)
  };
}

function sessionViewEntityIdFromServiceEvent({ result = {} } = {}) {
  const payload = sessionViewRealtimePayload({ result });
  return payload.sessionId ? `${payload.sessionId}:view` : null;
}

function vibe64SessionViewChangedServiceEvent() {
  return Object.freeze({
    type: "entity.changed",
    source: VIBE64_SESSION_VIEW_EVENT_SOURCE,
    entity: VIBE64_SESSION_VIEW_EVENT_ENTITY,
    operation: "updated",
    entityId: sessionViewEntityIdFromServiceEvent,
    realtime: Object.freeze({
      audience: VIBE64_SESSION_VIEW_REALTIME_AUDIENCE,
      event: VIBE64_SESSION_VIEW_CHANGED_EVENT,
      payload: sessionViewRealtimePayload
    })
  });
}

export {
  VIBE64_SESSION_VIEW_CHANGED_EVENT,
  sessionViewRealtimePayload,
  vibe64SessionViewChangedServiceEvent
};
