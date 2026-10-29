import { currentProjectRequestContext } from "./projectRequestContext.js";

const VIBE64_OUTPUTS_CLIENT_REFRESH_PAYLOAD = Object.freeze({
  clientRefresh: Object.freeze({ includeOutputs: true })
});

// A session change reaches the browser pages that show it: its full payload
// goes to the pages viewing the session, and a small summary to the pages that
// have its project open (session lists, repository status, notices). A page
// joins those rooms by watching the project or one of its sessions
// (vibe64-sessions' projectWatch.js), so nothing reaches a page that shows
// neither.
const VIBE64_SESSION_CHANGED_EVENT = "vibe64.session.changed";
const VIBE64_SESSION_SUMMARY_CHANGED_EVENT = "vibe64.session.summary.changed";

function vibe64ProjectSessionsRoom(projectSlug) {
  return `vibe64:project:${projectSlug}:sessions`;
}

function vibe64SessionViewersRoom(projectSlug, sessionId) {
  return `vibe64:project:${projectSlug}:session:${sessionId}`;
}

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
// Live presentation of a session's work: streamed text, progress and output
// targets. They invalidate no client read.
const PRESENTATION_REASONS = Object.freeze([
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
]);
// Streamed work, including each completed Claude message (which refreshes its
// viewers' detail), changes no session list: only the session's viewers
// receive it, and project pages get no summary of it.
const VIEWER_ONLY_REASONS = new Set([
  ...PRESENTATION_REASONS,
  "claude-stream-message",
  "claude-stream-message-delivered"
]);
const CLIENT_REFRESH_BY_REASON = new Map([
  ...PRESENTATION_REASONS.map((reason) => [reason, PRESENTATION_ONLY]),
  ["session-repository-check-failed", PRESENTATION_ONLY],
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
  // A conversation's live text and transcript reach its viewers through their
  // conversation subscription, never through the session change.
  const {
    clientRefresh: _clientRefresh,
    conversationLogPatch: _conversationLogPatch,
    conversationStream: _conversationStream,
    ...additionalFields
  } = additionalPayload;
  void _clientRefresh;
  void _conversationLogPatch;
  void _conversationStream;
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

// What a project page needs about a change in one of its sessions: the
// session's identity and state, the reads it invalidates, whether its agent
// turn runs, and the small notices project pages show. Nothing a session's
// viewers render, such as streamed text or turn details, is summarized.
const SUMMARY_NOTICE_FIELDS = Object.freeze([
  "approvalId",
  "approvalSender",
  "canonicalCommit",
  "repositoryUpdateCheck",
  "repositoryUpdateCheckError"
]);

function sessionSummaryPayload(full) {
  const turn = record(record(full.agentSession).turn);
  const run = record(full.agentRun);
  return {
    sessionId: full.sessionId,
    ...Object.fromEntries(["revision", "status", ...SUMMARY_NOTICE_FIELDS, "projectSlug", "clientRefresh", "originId", "reason"]
      .filter((field) => full[field] !== undefined)
      .map((field) => [field, full[field]])),
    ...(Object.keys(turn).length > 0 ? { agentSession: { turn: { active: turn.active === true } } } : {}),
    ...(Object.keys(run).length > 0 ? { agentRun: { active: run.active === true } } : {})
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
    // A streamed delta carries only the conversation's live text, which its
    // subscribers receive natively: no page or listener reads it as a change.
    if (!id || String(reason || "").trim() === "assistant-stream") {
      return null;
    }
    const fullPayload = Object.freeze(sessionRealtimePayload(id, {
      session,
      originId: eventOriginId,
      reason,
      payload
    }));
    const projectSlug = fullPayload.projectSlug;
    const change = {
      source: "vibe64",
      entity: "session",
      operation: String(operation || "updated").trim() || "updated",
      entityId: id,
      scope: Object.freeze({
        kind: "global",
        id: null
      }),
      occurredAt: new Date().toISOString()
    };
    // A change outside any project has no page to reach.
    const published = await events.publish(Object.freeze({
      ...change,
      type: "entity.changed",
      realtime: Object.freeze({
        audience: projectSlug ? { room: vibe64SessionViewersRoom(projectSlug, fullPayload.sessionId) } : "none",
        event: VIBE64_SESSION_CHANGED_EVENT,
        payload: fullPayload
      })
    }));
    if (projectSlug && !VIEWER_ONLY_REASONS.has(String(reason || "").trim())) {
      // The summary is a second delivery of the same change, not a domain
      // change of its own: listeners of session changes match "entity.changed".
      await events.publish(Object.freeze({
        ...change,
        type: "entity.summary",
        realtime: Object.freeze({
          audience: { room: vibe64ProjectSessionsRoom(projectSlug) },
          event: VIBE64_SESSION_SUMMARY_CHANGED_EVENT,
          payload: Object.freeze(sessionSummaryPayload(fullPayload))
        })
      }));
    }
    return published;
  };
}

export {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SESSION_SUMMARY_CHANGED_EVENT,
  createSessionChangedPublisher,
  vibe64ProjectSessionsRoom,
  vibe64SessionViewersRoom,
  VIBE64_OUTPUTS_CLIENT_REFRESH_PAYLOAD
};
