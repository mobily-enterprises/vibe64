import { createHash } from "node:crypto";

const working = new Set(["starting", "inProgress", "working", "preparing"]);
const attention = new Set(["failed", "interrupted", "cancelled", "closing", "archived", "uncertain", "waiting"]);

function conversationObservation({ status = "unknown", runId = "", messages = [], error = "", needsUser = false,
  replyDuringWork = false, revision = "", details = null }) {
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
    truncated: String(answer?.text || "").length > 4000,
    ...(revision !== "" ? { revision: String(revision) } : {}),
    ...(details ? { details: structuredClone(details) } : {})
  };
}

function watchUpdate(watch, observation) {
  const previous = watch.cursor;
  const cursor = { status: observation.status, runId: observation.runId,
    // An answer first seen while work is active must remain eligible when it settles.
    answerId: watch.condition === "reply" && !observation.answered ? previous?.answerId || "" : observation.answerId,
    error: observation.error, needsUser: observation.needsUser,
    ...(observation.revision !== undefined ? { revision: observation.revision } : {}) };
  if (JSON.stringify(previous) === JSON.stringify(cursor)) return { cursor, reason: "" };
  if (observation.attention) return { cursor, reason: "attention" };
  if (watch.condition === "reply" && observation.answered && observation.answerId !== previous?.answerId) return { cursor, reason: "reply" };
  if (watch.condition === "finished" && observation.settled && (previous ? working.has(previous.status) || previous.runId !== observation.runId : observation.answered)) return { cursor, reason: "finished" };
  return { cursor, reason: "" };
}

export { conversationObservation, watchUpdate };
