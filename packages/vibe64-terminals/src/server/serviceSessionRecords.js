import { vibe64AgentRunStateIsActive } from "@local/vibe64-runtime/server/sessionStore";
import { vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import {
  assistantRoutingRequestFromMetadata,
  assistantRoutingRequestIsUnresolved
} from "@local/vibe64-runtime/shared/assistantRouting";

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
 * Whether the session's main-chat AI is at work: a turn runs, a routed request is not yet resolved, or a workflow,
 * such as Auto's review, is between its turns. What must wait for the AI to finish waits for this.
 * @param {{ agentRuns?: object[], metadata?: Record<string, string> }} session
 */
function sessionAssistantWorking(session = {}) {
  const request = assistantRoutingRequestFromMetadata(session.metadata);
  return sessionHasActiveAgentRun(session) ||
    assistantRoutingRequestIsUnresolved(request, vibe64AssistantSelectionFromMetadata(session.metadata, { required: false })) ||
    request?.status === "working" && Boolean(request.workflow);
}

function sessionRecordId(session) {
  return String(session?.sessionId || "").trim();
}

export {
  sessionAssistantWorking,
  sessionHasActiveAgentRun,
  sessionRecordId
};
