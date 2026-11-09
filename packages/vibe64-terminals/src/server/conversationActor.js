import { vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import {
  currentActorUser
} from "@local/vibe64-execution/server";
import { MAIN_CHAT_NOTE_TURN_METADATA_KEY } from "./mainChatNote.js";

/** @typedef {import("@local/vibe64-runtime/server/types").Vibe64SessionStore} Vibe64SessionStore */

function cleanText(value = "") {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

// Without a standalone profile the actor has no preferred name of their own.
const NO_PERSONAL_PROFILE = Object.freeze({
  async read() {
    return {};
  }
});

async function conversationActorMetadata({
  actorUser = currentActorUser,
  personalProfileStore = NO_PERSONAL_PROFILE,
  vibe64User = null
} = {}) {
  const authenticated = vibe64User && typeof vibe64User === "object" && !Array.isArray(vibe64User)
    ? vibe64User
    : null;
  const localProfile = authenticated ? {} : await personalProfileStore.read();
  const source = authenticated || actorUser();
  const preferredName = cleanText(
    authenticated ? source.preferredName : localProfile.preferredName
  );
  return {
    actorDisplayName: preferredName || cleanText(
      source.displayName || source.name || source.username || source.email
    ),
    actorId: cleanText(source.username || source.id || source.email)
  };
}

/** An automatic review's message, or a note Vibe64 steered into the turn, is the app's, not the person's. */
function conversationReviewActorMetadata(turnMetadata) {
  if (turnMetadata?.[MAIN_CHAT_NOTE_TURN_METADATA_KEY] === true) return { actorId: "app", actorDisplayName: "Vibe64" };
  return turnMetadata?.assistantRouting?.resolvedMode === "review" ? { actorId: "app", actorDisplayName: "Automatic review" } : {};
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 * @param {object} turnMetadata
 */
async function codexDeliveredConversationMetadata(store, sessionId, turnMetadata) {
  return {
    ...turnMetadata,
    ...conversationReviewActorMetadata(turnMetadata),
    engineId: "codex",
    assistantSelection: vibe64AssistantSelectionFromMetadata({
      assistant_selection: await store.readMetadataValue(sessionId, "assistant_selection")
    }, { required: false })
  };
}

/**
 * @param {Vibe64SessionStore} store
 * @param {string} sessionId
 */
async function codexTerminalConversationMetadata(store, sessionId) {
  const turns = await store.readConversationLog(sessionId);
  const previousMetadata = turns.findLast((turn) => (
    turn?.user && turn?.metadata
  ))?.metadata || null;
  return {
    actorDisplayName: previousMetadata?.actorDisplayName,
    actorId: previousMetadata?.actorId,
    engineId: "codex",
    assistantSelection: vibe64AssistantSelectionFromMetadata({
      assistant_selection: await store.readMetadataValue(sessionId, "assistant_selection")
    }, { required: false })
  };
}

export {
  conversationActorMetadata,
  conversationReviewActorMetadata,
  codexDeliveredConversationMetadata,
  codexTerminalConversationMetadata
};
