import { createHash } from "node:crypto";

const working = new Set(["starting", "inProgress", "routing", "sending", "review_pending", "review_sending", "reviewing", "planning_pending", "planning_sending", "planning"]);
const attention = new Set(["failed", "interrupted", "cancelled", "closing", "archived", "uncertain", "review_uncertain", "planning_uncertain"]);

// These reads use ordinary actions and their current actor/project authority.
// Provider records, credentials and session metadata never enter the observation.
async function readWatchedConversation(actions, watch, context) {
  const execute = async (actionId, input) => {
    const result = await actions.execute({ actionId, input, context: { ...context, projectSlug: watch.projectSlug } });
    if (result?.ok === false || result?.readError) throw Object.assign(new Error(result.error || "The conversation could not be observed."), { statusCode: result.statusCode });
    return result;
  };
  let status, runId, messages, error, needsUser = false;
  if (watch.conversationId) {
    const result = await execute("vibe64.terminals.temporary-conversation.read", { sessionId: watch.sessionId, conversationId: watch.conversationId, messageLimit: 12 });
    status = result.status || "unknown";
    runId = result.runId || "";
    error = result.error || "";
    messages = result.messages || [];
    try { needsUser = JSON.parse(result.routingMetadata?.assistant_routing_request || "null")?.reviewStatus === "skipped_question"; } catch { /* No trustworthy routing phase. */ }
  } else {
    const session = await execute("vibe64.sessions.inspect", { sessionId: watch.sessionId });
    const turn = session.agentSession?.turn;
    let route;
    try { route = JSON.parse(session.metadata?.assistant_routing_request || "null"); } catch { /* No trustworthy routing phase. */ }
    status = session.status === "archived" ? "archived"
      : route && (working.has(route.status) || attention.has(route.status)) ? route.status
        : turn?.active ? "inProgress" : turn?.state || "unknown";
    runId = turn?.id || "";
    error = session.agentSession?.error || turn?.error || route?.error || "";
    needsUser = route?.reviewStatus === "skipped_question";
    const log = await execute("vibe64.sessions.conversation-log.read", { sessionId: watch.sessionId, limit: "3" });
    messages = (log.conversationLog || []).flatMap((item) => item.messages || []);
  }
  const answer = messages.findLast((message) => message.role === "assistant" && message.complete !== false && !working.has(message.status));
  const latest = messages.findLast((message) => ["user", "assistant"].includes(message.role) && message.complete !== false && !working.has(message.status));
  const answerId = answer ? String(answer.id || answer.messageId || createHash("sha256").update(`${answer.at || ""}:${answer.text || ""}`).digest("hex")) : "";
  const settled = !working.has(status) && status !== "unknown";
  return {
    status, runId, answerId, settled, needsUser, working: working.has(status),
    userMessageIds: messages.filter((message) => message.role === "user").map((message) => String(message.messageId || message.id || "")),
    latestUserMessageId: String(messages.findLast((message) => message.role === "user")?.messageId || messages.findLast((message) => message.role === "user")?.id || ""),
    attention: attention.has(status) || Boolean(error) || needsUser,
    answered: settled && latest?.role === "assistant",
    error: String(error).slice(0, 512),
    answer: String(answer?.text || "").slice(0, 4000),
    truncated: String(answer?.text || "").length > 4000
  };
}

function watchUpdate(watch, observation) {
  const previous = watch.cursor;
  const cursor = { status: observation.status, runId: observation.runId, answerId: observation.answerId,
    error: observation.error, needsUser: observation.needsUser };
  if (JSON.stringify(previous) === JSON.stringify(cursor)) return { cursor, reason: "" };
  if (observation.attention) return { cursor, reason: "attention" };
  if (watch.condition === "reply" && observation.answered && observation.answerId !== previous?.answerId) return { cursor, reason: "reply" };
  if (watch.condition === "finished" && observation.settled && (previous ? working.has(previous.status) || previous.runId !== observation.runId : observation.answered)) return { cursor, reason: "finished" };
  return { cursor, reason: "" };
}

export { readWatchedConversation, watchUpdate };
