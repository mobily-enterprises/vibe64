import { vibe64AgentRunStateIsActive } from "@local/vibe64-runtime/server/sessionStore";

function recordValue(value = null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function agentRunIsActive(run = {}) {
  // Codex acknowledges Resume before its scheduler starts the next turn.
  if (run?.providerGoalStatus === "active" && run.providerGoalThreadId &&
      run.providerGoalThreadId === run.providerThreadId) {
    return true;
  }
  if (run?.active === true) {
    return true;
  }
  try {
    return vibe64AgentRunStateIsActive(run?.state);
  } catch {
    return false;
  }
}

function sessionHasActiveAgentRun(session = {}) {
  return (Array.isArray(session?.agentRuns) ? session.agentRuns : []).some(agentRunIsActive);
}

function sessionRecordId(session = {}) {
  return String(session?.sessionId || session?.id || "").trim();
}

export {
  recordValue,
  sessionHasActiveAgentRun,
  sessionRecordId
};
