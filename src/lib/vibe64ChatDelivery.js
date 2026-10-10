import { assistantRoutingStatusLabel, assistantRoutingOutcomeNotice } from "@local/vibe64-runtime/shared/assistantRouting";

function routedChatMessage(request, local = null) {
  if (!request || !request.input || request.stopped || request.followup || !["routing", "sending", "uncertain", "failed"].includes(request.delivery)) return null;
  return {
    ...local,
    id: request.messageId,
    text: request.input.displayMessage || request.input.message,
    payload: local?.payload || request.input,
    status: ["failed", "uncertain"].includes(request.delivery) ? request.delivery : "pending",
    error: request.error || ""
  };
}

function chatTurnsWithRouting(turns, request, checking = false) {
  const result = chatTurnsWithDelivery(turns, request, checking);
  const notice = assistantRoutingOutcomeNotice(request);
  if (!notice || result.some(turn => turn.system?.messageId === notice.messageId)) return result;
  // Restored older requests can display their saved explanation without rewriting history.
  return [...result, { turnId: notice.messageId, system: { role: "system", ...notice } }];
}

function chatTurnsWithDelivery(turns, request, checking) {
  if (!request) return turns;
  const matches = (turn) => turn.user?.messageId === request.messageId || turn.optimistic?.id === request.messageId;
  // Saved receipts and successful HTTP admission outrank older routing errors.
  if (turns.some((turn) => matches(turn) && ((!turn.optimistic && turn.user?.receipt !== false) || turn.optimistic?.status === "accepted"))) return turns;
  const message = routedChatMessage(request);
  if (!message) {
    if (request.delivery !== "accepted" && !request.followup) return turns;
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
