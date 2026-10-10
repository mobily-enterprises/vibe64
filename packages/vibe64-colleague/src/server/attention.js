import { createHash } from "node:crypto";

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

function conversationObservation({ status = "unknown", runId = "", messages = [], error = "", needsUser = false, replyDuringWork = false }) {
  const replyRoles = replyDuringWork ? ["assistant", "commentary"] : ["assistant"];
  const answer = messages.findLast((message) => replyRoles.includes(message.role) && message.complete !== false && !working.has(message.status));
  const latest = messages.findLast((message) => ["user", ...replyRoles].includes(message.role) && message.complete !== false && !working.has(message.status));
  const answerId = answer ? String(answer.id || answer.messageId || createHash("sha256").update(`${answer.at || ""}:${answer.text || ""}`).digest("hex")) : "";
  const settled = !working.has(status) && status !== "unknown";
  return {
    status, runId, answerId, settled, needsUser, working: working.has(status),
    userMessageIds: messages.filter((message) => message.role === "user").map((message) => String(message.messageId || message.id || "")),
    latestUserMessageId: String(messages.findLast((message) => message.role === "user")?.messageId || messages.findLast((message) => message.role === "user")?.id || ""),
    attention: attention.has(status) || Boolean(error) || needsUser,
    answered: (settled || replyDuringWork) && replyRoles.includes(latest?.role),
    error: String(error).slice(0, 512),
    answer: String(answer?.text || "").slice(0, 4000),
    truncated: String(answer?.text || "").length > 4000
  };
}

function watchUpdate(watch, observation) {
  const previous = watch.cursor;
  const cursor = { status: observation.status, runId: observation.runId,
    // An answer first seen while work is active must remain eligible when it settles.
    answerId: watch.condition === "reply" && !observation.answered ? previous?.answerId || "" : observation.answerId,
    error: observation.error, needsUser: observation.needsUser };
  if (JSON.stringify(previous) === JSON.stringify(cursor)) return { cursor, reason: "" };
  if (observation.attention) return { cursor, reason: "attention" };
  if (watch.condition === "reply" && observation.answered && observation.answerId !== previous?.answerId) return { cursor, reason: "reply" };
  if (watch.condition === "finished" && observation.settled && (previous ? working.has(previous.status) || previous.runId !== observation.runId : observation.answered)) return { cursor, reason: "finished" };
  return { cursor, reason: "" };
}

export { conversationObservation, readWatchedConversation, watchUpdate };
