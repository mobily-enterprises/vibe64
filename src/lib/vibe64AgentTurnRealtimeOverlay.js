function plainObjectValue(value = null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function sessionChangedReason(payload = {}) {
  return String(payload?.reason || "").trim();
}

function sessionRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function agentTurnRealtimeOverlayFromPayload(payload = {}, selectedSessionId = "") {
  const changedSessionId = String(payload?.sessionId || payload?.entityId || "").trim();
  if (!changedSessionId || changedSessionId !== String(selectedSessionId || "").trim()) {
    return null;
  }
  const agentSession = plainObjectValue(payload.agentSession);
  const turn = plainObjectValue(agentSession.turn);
  const run = plainObjectValue(payload.agentRun);
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

function agentTurnIdentity(agentSession = {}) {
  const source = plainObjectValue(agentSession);
  return {
    threadId: String(plainObjectValue(source.thread).id || "").trim(),
    turnId: String(plainObjectValue(source.turn).id || "").trim()
  };
}

function agentTurnOverlayMatchesSession(session = {}, overlay = {}) {
  const overlayIdentity = agentTurnIdentity(overlay.agentSession);
  if (!overlayIdentity.threadId && !overlayIdentity.turnId) {
    return true;
  }
  const sessionIdentity = agentTurnIdentity(session.agentSession);
  if (
    overlayIdentity.threadId &&
    sessionIdentity.threadId &&
    overlayIdentity.threadId !== sessionIdentity.threadId
  ) {
    return false;
  }
  if (
    overlayIdentity.turnId &&
    sessionIdentity.turnId &&
    overlayIdentity.turnId !== sessionIdentity.turnId
  ) {
    return false;
  }
  return true;
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
  if (
    !session ||
    !overlay ||
    session?.ok === false ||
    session.sessionId !== overlay.sessionId ||
    (currentRevision !== null && overlay.revision <= currentRevision) ||
    !agentTurnOverlayMatchesSession(session, overlay)
  ) {
    return session;
  }
  const overlayAgentSession = plainObjectValue(overlay.agentSession);
  return {
    ...session,
    agentRuns: mergeAgentRunOverlay(session.agentRuns, plainObjectValue(overlay.agentRun)),
    agentSession: {
      ...plainObjectValue(session.agentSession),
      ...overlayAgentSession,
      thread: {
        ...plainObjectValue(session.agentSession?.thread),
        ...plainObjectValue(overlayAgentSession.thread)
      },
      turn: {
        ...plainObjectValue(session.agentSession?.turn),
        ...plainObjectValue(overlayAgentSession.turn),
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
