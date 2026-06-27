function plainObjectValue(value = null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function sessionChangedReason(payload = {}) {
  return String(payload?.reason || "").trim();
}

function codexTurnRealtimeOverlayFromPayload(payload = {}, selectedSessionId = "") {
  const changedSessionId = String(payload?.sessionId || payload?.entityId || "").trim();
  if (!changedSessionId || changedSessionId !== String(selectedSessionId || "").trim()) {
    return null;
  }
  const turn = plainObjectValue(payload.codexAgentTurn);
  const run = plainObjectValue(payload.codexAgentRun);
  const hasTurnState = Object.keys(turn).length > 0 ||
    Object.keys(run).length > 0 ||
    typeof payload.codexAgentTurnActive === "boolean";
  if (!hasTurnState) {
    return null;
  }
  const active = payload.codexAgentTurnActive === true ||
    turn.active === true ||
    run.active === true;
  return {
    active,
    codexAgentRun: {
      ...run,
      active
    },
    codexAgentTurn: {
      ...turn,
      active
    },
    reason: sessionChangedReason(payload),
    sessionId: changedSessionId
  };
}

function codexTurnIdentity(value = {}) {
  const source = plainObjectValue(value);
  return {
    threadId: String(source.threadId || source.providerThreadId || "").trim(),
    turnId: String(source.turnId || source.providerTurnId || "").trim()
  };
}

function codexTurnOverlayMatchesSession(session = {}, overlay = {}) {
  const overlayIdentity = codexTurnIdentity(overlay.codexAgentTurn || overlay.codexAgentRun);
  if (!overlayIdentity.threadId && !overlayIdentity.turnId) {
    return true;
  }
  const sessionIdentity = codexTurnIdentity(session.codexAgentTurn);
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

function mergeCodexAgentRunOverlay(agentRuns = [], overlayRun = {}) {
  const runs = Array.isArray(agentRuns) ? agentRuns : [];
  const runId = String(overlayRun.id || overlayRun.runId || "codex_app_server").trim();
  const nextRun = {
    id: runId,
    ...overlayRun
  };
  const index = runs.findIndex((run) => String(run?.id || "").trim() === runId);
  if (index < 0) {
    return Object.keys(overlayRun).length > 0 ? [...runs, nextRun] : runs;
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

function sessionWithCodexTurnRealtimeOverlay(session = null, overlay = null) {
  if (
    !session ||
    !overlay ||
    session?.ok === false ||
    session.sessionId !== overlay.sessionId ||
    !codexTurnOverlayMatchesSession(session, overlay)
  ) {
    return session;
  }
  const overlayTurn = plainObjectValue(overlay.codexAgentTurn);
  const overlayRun = plainObjectValue(overlay.codexAgentRun);
  return {
    ...session,
    agentRuns: mergeCodexAgentRunOverlay(session.agentRuns, overlayRun),
    codexAgentTurn: {
      ...plainObjectValue(session.codexAgentTurn),
      ...overlayTurn,
      active: overlay.active === true
    },
    codexAgentTurnActive: overlay.active === true
  };
}

export {
  codexTurnRealtimeOverlayFromPayload,
  sessionWithCodexTurnRealtimeOverlay
};
