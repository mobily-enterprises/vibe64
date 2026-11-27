// When the AI takes a temporary chat's message as its turn, before Vibe64 has recorded that turn.
import { logOperationalEvent } from "@local/vibe64-core/server/logging";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./types.js").ConversationTurnPublishers} ConversationTurnPublishers */

/**
 * The AI's operations for one turn start, saying once the AI has taken the message as its turn: listeners hear so at
 * once, not when the send has also recorded it (its receipt, the chat's binding, its transcript, the routed request's
 * delivery), which a slow host takes seconds over. An AI task is working from then.
 * @param {object} operations
 * @param {() => Promise<void>} admitted
 */
function admittingOperations(operations, admitted) {
  return {
    ...operations,
    async startConversationTurn(...args) {
      const started = await operations.startConversationTurn(...args);
      if (started?.ok !== false) await admitted();
      return started;
    }
  };
}

/**
 * Tells `admitted` listeners; a listener's failure never fails a send the AI has already taken.
 * @param {{ conversationTurns: ConversationTurnPublishers, logger: RuntimeLogger }} dependencies
 * @param {string} sessionId
 * @param {{ conversationId: string, messageId: string }} turn
 */
async function announceAdmission({ conversationTurns, logger }, sessionId, { conversationId, messageId }) {
  try {
    await conversationTurns.admitted(sessionId, { conversationId, messageId });
  } catch (error) {
    logOperationalEvent(logger, "warn", {
      component: "vibe64.temporary_conversation",
      event: "vibe64.temporary_conversation.admission_listener_failed",
      sessionId,
      conversationId,
      code: error?.code,
      error: error?.message
    }, "A listener to a temporary chat's admitted turn failed; the turn continues.");
  }
}

export {
  admittingOperations,
  announceAdmission
};
