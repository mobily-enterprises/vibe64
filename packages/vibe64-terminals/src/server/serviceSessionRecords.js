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
 * Whether the session's main-chat AI is at work, as its chat shows: a turn runs, or a working request it has not
 * stopped is being routed or sent, or is a workflow, such as Auto's review, between its turns. A delivery still being
 * checked, a stopped request's helper still being cleaned up, or a plain reply whose turn has ended is not the AI at
 * work.
 * @param {{ agentRuns?: object[], metadata?: Record<string, string> }} session
 */
function sessionAssistantWorking(session = {}) {
  const request = assistantRoutingRequestFromMetadata(session.metadata);
  return sessionHasActiveAgentRun(session) || request?.status === "working" && request.stopped !== true &&
    (Boolean(request.workflow) || ["routing", "pending", "sending"].includes(request.delivery));
}

function sessionRecordId(session) {
  return String(session?.sessionId || "").trim();
}

export {
  sessionAssistantWorking,
  sessionHasActiveAgentRun,
  sessionRecordId
};
