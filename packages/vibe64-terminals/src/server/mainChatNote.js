// A note from Vibe64 to the main chat's AI after Update or Save changed the session while it may be working. A
// running turn is steered with it; otherwise a note that must reach the AI waits in the session's metadata and
// leads the next message sent to the main chat.
import crypto from "node:crypto";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";

const MAIN_CHAT_NOTE_METADATA_KEY = "main_chat_note";
// Marks the turn of a note steered into the main chat, which the chat shows as Vibe64's.
const MAIN_CHAT_NOTE_TURN_METADATA_KEY = "vibe64Note";

/**
 * The note waiting for the next main-chat message, or "".
 * @param {{ metadata?: Record<string, string> }} session
 */
function pendingMainChatNote(session) {
  return String(session?.metadata?.[MAIN_CHAT_NOTE_METADATA_KEY] || "");
}

/**
 * The message with the waiting note ahead of it. The chat keeps showing what was sent; a slash command is sent
 * unchanged and the note waits for the next message.
 * @param {{ message?: string, displayMessage?: string }} input
 * @param {string} note
 */
function messageWithMainChatNote(input, note) {
  const message = String(input.message || "");
  if (!note || message.startsWith("/")) return null;
  return { ...input, displayMessage: input.displayMessage || message, message: `${note}\n\n${message}` };
}

/**
 * The terminals' `noteMainChat`: it tells the main chat's AI about a change Vibe64 made to the session's files. A
 * running turn is steered with the note; otherwise, when `nextTurn` is set, the note leads the next message sent to
 * the main chat. It never starts a turn, and a failure only logs: the change itself is already done.
 * @param {{ assistantContext: object, logger: object, sendAgentMessage: Function, sessionAgent: object }} dependencies
 */
function createMainChatNote({ assistantContext, logger, sendAgentMessage, sessionAgent }) {
  return async function noteMainChat(sessionId, { message, nextTurn = false }, options = {}) {
    try {
      const context = await assistantContext.assistantSessionOptions(sessionId, options);
      if ((await sessionAgent.sessionState(sessionId, context))?.turn?.active) {
        // Generated work declares Junior, so a turn that ends meanwhile refuses the steer instead of starting one.
        // The chat shows the note as Vibe64's, not as the person's.
        const steered = await sendAgentMessage(sessionId, {
          message,
          messageId: crypto.randomUUID(),
          submissionKind: "steer",
          turnMetadata: { [MAIN_CHAT_NOTE_TURN_METADATA_KEY]: true }
        }, { ...options, purpose: "junior" }).then(
          (result) => (result?.delivered === true ? "delivered" : "uncertain"),
          (error) => (error?.details?.delivery?.status === "not-sent" ? "not-sent" : "uncertain")
        );
        if (steered === "delivered") return { delivered: true };
        // A steer that may have reached the AI is never repeated with the next message.
        if (steered === "uncertain") return { delivered: false, waiting: false };
      }
      if (nextTurn) {
        // A note still waiting from an earlier change stays, with this one after it.
        const { store } = context.runtime;
        const waiting = String(await store.readMetadataValue(sessionId, MAIN_CHAT_NOTE_METADATA_KEY) || "");
        const notes = waiting && waiting !== message ? `${waiting}\n\n${message}` : message;
        await store.writeMetadataValue(sessionId, MAIN_CHAT_NOTE_METADATA_KEY, notes);
      }
      return { delivered: false, waiting: nextTurn };
    } catch (error) {
      logOperationalEvent(logger, "warn", {
        code: error?.code,
        component: "vibe64.agent_message",
        error: error?.message,
        event: "vibe64.agent_message.note_failed",
        sessionId
      }, "The main chat could not be told about a change to the session's files.");
      return { delivered: false, waiting: false };
    }
  };
}

export {
  createMainChatNote,
  MAIN_CHAT_NOTE_METADATA_KEY,
  MAIN_CHAT_NOTE_TURN_METADATA_KEY,
  messageWithMainChatNote,
  pendingMainChatNote
};
