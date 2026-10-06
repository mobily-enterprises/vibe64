import { vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import {
  currentActorUser
} from "@local/vibe64-execution/server";

function cleanText(value = "") {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

async function conversationActorMetadata({
  actorUser = currentActorUser,
  personalProfileStore = null,
  vibe64User = null
} = {}) {
  const authenticated = vibe64User && typeof vibe64User === "object" && !Array.isArray(vibe64User)
    ? vibe64User
    : null;
  const localProfile = !authenticated && typeof personalProfileStore?.read === "function"
    ? await personalProfileStore.read()
    : {};
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

function conversationReviewActorMetadata(turnMetadata) {
  return turnMetadata?.assistantRouting?.resolvedMode === "review" ? { actorId: "app", actorDisplayName: "Automatic review" } : {};
}

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

export { conversationActorMetadata, conversationReviewActorMetadata, codexDeliveredConversationMetadata, codexTerminalConversationMetadata };
