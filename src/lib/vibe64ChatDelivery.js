import { assistantRoutingStatusLabel } from "@local/vibe64-runtime/shared/assistantRouting";

function routedChatMessage(request, local = null) {
  if (!request || !["routing", "sending", "uncertain", "failed"].includes(request.status)) return null;
  return {
    ...local,
    id: request.messageId,
    text: request.input.displayMessage || request.input.message,
    payload: local?.payload || request.input,
    status: ["failed", "uncertain"].includes(request.status) ? request.status : "pending",
    error: request.error || ""
  };
}

function chatTurnsWithRouting(turns, request, checking = false) {
  if (!request) return turns;
  const matches = (turn) => turn.user?.messageId === request.messageId || turn.optimistic?.id === request.messageId;
  // Saved receipts and successful HTTP admission outrank older routing errors.
  if (turns.some((turn) => matches(turn) && (!turn.optimistic || turn.optimistic.status === "accepted"))) return turns;
  const message = routedChatMessage(request);
  if (!message) {
    if (!["sent", "done", "review_pending", "review_sending", "review_uncertain", "reviewing",
      "planning_pending", "planning_sending", "planning_uncertain", "planning",
      "implementation_pending", "implementation_sending", "implementation_uncertain"].includes(request.status)) return turns;
    return turns.map((turn) => matches(turn) && turn.optimistic
      ? { ...turn, optimistic: { ...turn.optimistic, status: "accepted", error: "" } } : turn);
  }
  const result = turns.some(matches) ? turns : [...turns, {
    turnId: `routing:${message.id}`,
    user: { role: "user", text: message.text, messageId: message.id, attachments: request.input.displayAttachments || [] },
    messages: []
  }];
  return result.map((turn) => !matches(turn) ? turn : {
    ...turn,
    optimistic: { ...turn.optimistic, id: message.id, status: message.status, error: message.error },
    system: {
      role: "system", text: assistantRoutingStatusLabel(request),
      ...(message.status === "uncertain" ? { delivery: { messageId: message.id, error: message.error, checking } } : {})
    }
  });
}

export { chatTurnsWithRouting, routedChatMessage };
