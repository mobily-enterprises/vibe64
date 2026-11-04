import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";

function sessionChangedReason(payload) {
  return String(payload.reason || "").trim();
}

function sessionRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

// A realtime payload is server data and may be null.
function agentTurnRealtimeOverlayFromPayload(input, selectedSessionId = "") {
  const payload = normalizeObject(input);
  const changedSessionId = String(payload.sessionId || payload.entityId || "").trim();
  if (!changedSessionId || changedSessionId !== String(selectedSessionId || "").trim()) {
    return null;
  }
  const agentSession = normalizeObject(payload.agentSession);
  const turn = normalizeObject(agentSession.turn);
  const run = normalizeObject(payload.agentRun);
  const revision = sessionRevision(payload.revision);
  if (revision === null || (!Object.keys(turn).length && !Object.keys(run).length)) {
    return null;
  }
  const active = turn.active === true || run.active === true;
  return {
    active,
    agentRun: {
      ...run,
      active
    },
    agentSession: {
      ...agentSession,
      turn: {
        ...turn,
        active
      }
    },
    reason: sessionChangedReason(payload),
    revision,
    sessionId: changedSessionId
  };
}

function latestAgentTurnRealtimeOverlay(current = null, candidate = null) {
  if (!candidate) {
    return current;
  }
  if (!current || candidate.revision > current.revision) {
    return candidate;
  }
  return current;
}

function mergeAgentRunOverlay(agentRuns = [], overlayRun = {}) {
  const runs = Array.isArray(agentRuns) ? agentRuns : [];
  const runId = String(overlayRun.id || "").trim();
  if (!runId) {
    return runs;
  }
  const nextRun = {
    ...overlayRun,
    id: runId
  };
  const index = runs.findIndex((run) => String(run?.id || "").trim() === runId);
  if (index < 0) {
    return [...runs, nextRun];
  }
  return runs.map((run, runIndex) => (
    runIndex === index
      ? {
          ...run,
          ...nextRun
        }
      : run
  ));
}

function sessionWithAgentTurnRealtimeOverlay(session = null, overlay = null) {
  const currentRevision = sessionRevision(session?.revision);
  // Goal continuations and context replacement legitimately change provider
  // identities. The fixed Vibe64 session ID scopes the event, and its monotonic
  // revision orders it; comparing a newer turn to an older snapshot would
  // permanently reject the successor's eventual completion.
  if (
    !session ||
    !overlay ||
    session?.ok === false ||
    session.sessionId !== overlay.sessionId ||
    (currentRevision !== null && overlay.revision <= currentRevision)
  ) {
    return session;
  }
  const overlayAgentSession = normalizeObject(overlay.agentSession);
  return {
    ...session,
    agentRuns: mergeAgentRunOverlay(session.agentRuns, normalizeObject(overlay.agentRun)),
    agentSession: {
      ...normalizeObject(session.agentSession),
      ...overlayAgentSession,
      thread: {
        ...normalizeObject(session.agentSession?.thread),
        ...normalizeObject(overlayAgentSession.thread)
      },
      turn: {
        ...normalizeObject(session.agentSession?.turn),
        ...normalizeObject(overlayAgentSession.turn),
        active: overlay.active === true
      }
    },
    revision: overlay.revision
  };
}

export {
  agentTurnRealtimeOverlayFromPayload,
  latestAgentTurnRealtimeOverlay,
  sessionWithAgentTurnRealtimeOverlay
};
