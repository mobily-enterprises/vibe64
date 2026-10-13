import { conversationObservation, watchUpdate } from "@local/vibe64-core/server/watch-observations";

const working = new Set(["starting", "inProgress", "working", "preparing"]);
const attention = new Set(["failed", "interrupted", "cancelled", "closing", "archived", "uncertain", "waiting"]);

// These reads use ordinary actions and their current actor/project authority.
// Provider records, credentials and session metadata never enter the observation.
async function readWatchedConversation(actions, watch, context) {
  const execute = async (actionId, input) => {
    const result = await actions.execute({ actionId, input, context: { ...context, projectSlug: watch.projectSlug } });
    if (result?.ok === false || result?.readError) throw Object.assign(new Error(result.error || "The conversation could not be observed."), { statusCode: result.statusCode });
    return result;
  };
  let status, runId, messages, error, route;
  if (watch.conversationId) {
    const result = await execute("vibe64.terminals.temporary-conversation.read", { sessionId: watch.sessionId, conversationId: watch.conversationId, messageLimit: 12 });
    status = result.status || "unknown";
    runId = result.runId || "";
    error = result.error || "";
    messages = result.messages || [];
    try {
      route = JSON.parse(result.routingMetadata?.assistant_routing_request || "null");
    } catch { /* No trustworthy routing phase. */ }
  } else {
    const session = await execute("vibe64.sessions.inspect", { sessionId: watch.sessionId });
    const turn = session.agentSession?.turn;
    try { route = JSON.parse(session.metadata?.assistant_routing_request || "null"); } catch { /* No trustworthy routing phase. */ }
    status = session.status === "archived" ? "archived"
      : route && (working.has(route.status) || attention.has(route.status)) ? route.status
        : turn?.active ? "inProgress" : turn?.state || "unknown";
    runId = turn?.id || "";
    error = session.agentSession?.error || turn?.error || route?.error || "";
    const log = await execute("vibe64.sessions.conversation-log.read", { sessionId: watch.sessionId, limit: "3" });
    messages = (log.conversationLog || []).flatMap((item) => item.messages || []);
  }
  const needsUser = route?.status === "waiting";
  return conversationObservation({ status, runId, messages, error, needsUser,
    replyDuringWork: watch.condition === "reply" && !watch.assignmentId });
}

export { conversationObservation, readWatchedConversation, watchUpdate };
