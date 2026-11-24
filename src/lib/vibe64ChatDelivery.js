import { assistantRoutingStatusLabel, assistantRoutingOutcomeNotice } from "@local/vibe64-runtime/shared/assistantRouting";
import { heldMessageWaitingLabel } from "@/lib/vibe64HeldMessage.js";

// What a message the assistant has not taken yet waits for while the assistant works on another turn: guidance on its
// way into that turn, or a new request, which waits for that turn to end (the page holds it while the turn can't take
// steering, and the server while a stopped turn ends or the turn's end is recorded).
const PENDING_STEERING = "Sending to the assistant's current turn";
const PENDING_TURN = "Waiting for the assistant's current turn to end";

function routedChatMessage(request, local = null) {
  if (local?.status === "pending" && local.id === request?.messageId && ["failed", "uncertain"].includes(request?.delivery)) return local;
  if (local?.status === "uncertain" && local.id === request?.messageId && request?.delivery === "failed") return local;
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

/**
 * A chat's turns with its routed request: the request's own message as the server's routing shows it (Pending while
 * it is routed or sent, failed or unconfirmed), and the request's saved outcome. While the assistant works
 * (`working`), the request's message whose prompt the server has sent to that running turn is no longer Pending (its
 * turn has started; an unconfirmed receipt turns it unconfirmed), and a message the assistant has not taken yet
 * says what it waits for (`steering` tells a steer of the running turn by its message id).
 * @param {Array<object>} turns
 * @param {object | null} request the saved routing request
 * @param {boolean} [checking] whether a delivery check is running
 * @param {{ working?: boolean, steering?: (messageId: string) => boolean }} [activity]
 */
function chatTurnsWithRouting(turns, request, checking = false, { working = false, steering = () => false } = {}) {
  const result = withPendingReasons(chatTurnsWithDelivery(turns, request, checking, working), { working, steering });
  const notice = assistantRoutingOutcomeNotice(request);
  if (!notice || result.some(turn => turn.system?.messageId === notice.messageId)) return result;
  // Restored older requests can display their saved explanation without rewriting history.
  return [...result, { turnId: notice.messageId, system: { role: "system", ...notice } }];
}

// A Pending message the assistant has not taken while it works says what it waits for. The server's own reason stays,
// except the held send's "Waiting for the assistant to start", which a running turn makes wrong.
function withPendingReasons(turns, { working, steering }) {
  if (!working) return turns;
  const starting = heldMessageWaitingLabel("assistant");
  return turns.map(turn => turn.optimistic?.status !== "pending" || turn.optimistic.waiting && turn.optimistic.waiting !== starting
    ? turn : { ...turn, optimistic: { ...turn.optimistic, waiting: steering(turn.optimistic.id) ? PENDING_STEERING : PENDING_TURN } });
}

function chatTurnsWithDelivery(turns, request, checking, working = false) {
  if (!request) return turns;
  const matches = (turn) => turn.user?.messageId === request.messageId || turn.optimistic?.id === request.messageId;
  // Saved receipts and successful HTTP admission outrank older routing errors.
  if (turns.some((turn) => matches(turn) && ((!turn.optimistic && turn.user?.receipt !== false) || turn.optimistic?.status === "accepted"))) return turns;
  // A same-ID retry is already pending locally before the server replaces its previous failure.
  if (["failed", "uncertain"].includes(request.delivery) && turns.some(turn => matches(turn) && turn.optimistic?.status === "pending")) return turns;
  let message = routedChatMessage(request);
  // The server sent this message's prompt (its attempt is saved just before) and the assistant's turn is running: the
  // only turn a send can start, as routing refuses one beside a running turn. Its turn has started, so it is shown
  // as delivered; a receipt that never comes makes the request, and the message, unconfirmed.
  if (message?.status === "pending" && working && request.delivery === "sending" &&
      request.attemptedMessageId === request.messageId) {
    message = { ...message, status: "accepted", started: true };
  }
  if (!message) {
    if (request.delivery !== "accepted" && !request.followup) return turns;
    return turns.map((turn) => matches(turn) && turn.optimistic
      ? { ...turn, ...(turn.system?.delivery?.messageId === request.messageId ? { system: undefined } : {}),
        optimistic: { ...turn.optimistic, status: "accepted", error: "" } } : turn);
  }
  const result = turns.some(matches) ? turns : [...turns, {
    turnId: `routing:${message.id}`,
    user: { role: "user", text: message.text, messageId: message.id, attachments: request.input.displayAttachments || [] },
    messages: []
  }];
  return result.map((turn) => {
    if (!matches(turn) || turn.optimistic?.status === "uncertain" && message.status === "failed") return turn;
    const { waiting: _waiting, ...optimistic } = turn.optimistic || {};
    // A started turn shows the assistant working, not the routing line's "awaiting receipt".
    if (message.started) return { ...turn, optimistic: { ...optimistic, id: message.id, status: "accepted", error: "" }, system: undefined };
    return {
      ...turn,
      optimistic: { ...turn.optimistic, id: message.id, status: message.status, error: message.error },
      system: {
        role: "system", text: assistantRoutingStatusLabel(request),
        ...(message.status === "uncertain" ? { delivery: { messageId: message.id, error: message.error, checking } } : {})
      }
    };
  });
}

// Cancel asks the server through the chat's delivery, so a message shown only
// from its saved route joins the delivery first and shows the same Cancelling…
// and Cancel again states as any other until the server agrees.
function trackRoutedMessage(delivery, message, turns = []) {
  if (!delivery || !message || delivery.find(message.id)) return;
  delivery.restoreUncertain({ messageId: message.id, text: message.text,
    attachments: message.payload?.displayAttachments || [], error: message.error }, turns);
}

// A Cancel in progress, or one the server could not confirm (shown with Cancel
// again), owns its message: only Stop returns an unsent message to the draft.
function cancelOwnsMessage(message) {
  return Boolean(message?.cancelling || message?.cancelError);
}

export { cancelOwnsMessage, chatTurnsWithRouting, routedChatMessage, trackRoutedMessage };
