import { vibe64AgentRunStateIsActive } from "@local/vibe64-runtime/server/sessionStore";
import { assistantRoutingRequestFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";

function agentRunIsActive(run = {}) {
  // Codex acknowledges Resume before its scheduler starts the next turn.
  if (run.providerGoalStatus === "active" && run.providerGoalThreadId &&
      run.providerGoalThreadId === run.providerThreadId) {
    return true;
  }
  if (run.active === true) {
    return true;
  }
  try {
    return vibe64AgentRunStateIsActive(run.state);
  } catch {
    return false;
  }
}

function sessionHasActiveAgentRun(session = {}) {
  return (Array.isArray(session.agentRuns) ? session.agentRuns : []).some(agentRunIsActive);
}

/**
 * Whether the session's main-chat AI is at work, as its chat shows: a turn runs, or a request it has not stopped is
 * still working, being routed or sent, or between the turns of a workflow such as Auto's review. A delivery still
 * being checked, or a stopped request's helper still being cleaned up, is not the AI at work.
 * @param {{ agentRuns?: object[], metadata?: Record<string, string> }} session
 */
function sessionAssistantWorking(session = {}) {
  const request = assistantRoutingRequestFromMetadata(session.metadata);
  return sessionHasActiveAgentRun(session) || request?.status === "working" && request.stopped !== true;
}

function sessionRecordId(session) {
  return String(session?.sessionId || "").trim();
}

export {
  sessionAssistantWorking,
  sessionHasActiveAgentRun,
  sessionRecordId
};
