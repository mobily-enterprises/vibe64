import { currentProjectRequestContext } from "./projectRequestContext.js";

const VIBE64_OUTPUTS_CLIENT_REFRESH_PAYLOAD = Object.freeze({
  clientRefresh: Object.freeze({ includeOutputs: true })
});

const VIBE64_SESSION_CHANGED_EVENT = "vibe64.session.changed";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// clientRefresh names the client reads a session change invalidates: the
// session's detail, its list entry, its AI access and its outputs. A change
// invalidates detail, list and access unless it says otherwise (clients treat
// a missing flag as true); outputs are refreshed only on request. Streaming and
// turn-activity changes carry their own presentation in the payload, so their
// reasons narrow the reads here; an emitter's explicit flags take precedence.
const CLIENT_REFRESH_READS = Object.freeze(["includeAccess", "includeDetail", "includeList", "includeOutputs"]);
const PRESENTATION_ONLY = Object.freeze({ includeAccess: false, includeDetail: false, includeList: false });
const ACCESS_ONLY = Object.freeze({ includeDetail: false, includeList: false });
const NOT_LIST = Object.freeze({ includeList: false });
const NOT_ACCESS = Object.freeze({ includeAccess: false });
const CLIENT_REFRESH_BY_REASON = new Map([
  ...[
    "assistant-stream",
    "assistant-response-bundle",
    "codex-app-server-commentary",
    "codex-app-server-live-progress",
    "codex-app-server-message-delivered",
    "codex-app-server-ready",
    "codex-app-server-reasoning-summary",
    "codex-app-server-running",
    "codex-app-server-terminal-assistant-message",
    "codex-app-server-terminal-user-message",
    "codex-app-server-turn-claimed",
    "codex-app-server-turn-finalizing",
    "codex-app-server-turn-state",
    "opencode-server-assistant-message",
    "opencode-server-message-delivered",
    "opencode-server-progress",
    "opencode-server-reasoning",
    "output-target-closed",
    "output-target-ready",
    "output-target-started",
    "output-target-stopped"
  ].map((reason) => [reason, PRESENTATION_ONLY]),
  ...[
    "codex-app-server-turn-active",
    "codex-app-server-turn-idle",
    "opencode-server-turn-active",
    "opencode-server-turn-idle"
  ].map((reason) => [reason, ACCESS_ONLY]),
  ...["agent-terminal-closed", "codex-app-server-blocked", "codex-app-server-failed"]
    .map((reason) => [reason, NOT_LIST]),
  ...[
    "claude-stream-message",
    "claude-stream-message-delivered",
    "opencode-credential-failure",
    "opencode-provider-failure"
  ].map((reason) => [reason, NOT_ACCESS])
]);

function normalizedClientRefresh(value = {}) {
  const source = record(value);
  return Object.fromEntries(CLIENT_REFRESH_READS
    .filter((read) => typeof source[read] === "boolean")
    .map((read) => [read, source[read]]));
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
    ...additionalFields
  } = additionalPayload;
  void _clientRefresh;
  const context = currentProjectRequestContext();
  const clientRefresh = {
    ...CLIENT_REFRESH_BY_REASON.get(String(reason || "").trim()),
    ...sessionRefresh,
    ...additionalRefresh
  };
  return {
    sessionId: id,
    ...(Number.isSafeInteger(revision) && revision >= 0 ? { revision } : {}),
    ...(status ? { status } : {}),
    ...additionalFields,
    projectSlug: String(context?.slug || session.projectSlug || additionalFields.projectSlug || "").trim(),
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
