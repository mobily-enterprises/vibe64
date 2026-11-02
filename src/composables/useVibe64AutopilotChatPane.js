import { computed, ref } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { chatTurnsWithRouting } from "@/lib/vibe64ChatDelivery.js";

const EMPTY_CONVERSATION_WELCOME = "Hi! 👋 I’m excited to build something with you. Tell me what you have in mind—even a half-formed idea is perfect. We’ll shape it together.";
const EXISTING_PROJECT_CONVERSATION_WELCOME = "Hi! 👋 This is an existing project. Tell me what you’d like to change, check, or improve, and we’ll work through it together.";
const RENEWED_SESSION_CONVERSATION_WELCOME = "Hi! 👋 I’ve received the handover from the previous session and I’m ready to continue. Tell me what you’d like to do next.";

function emptyConversationWelcomeText({
  existingProject = false,
  preferredName = "",
  renewedSession = false
} = {}) {
  const message = renewedSession
      ? RENEWED_SESSION_CONVERSATION_WELCOME
      : existingProject
        ? EXISTING_PROJECT_CONVERSATION_WELCOME
        : EMPTY_CONVERSATION_WELCOME;
  const name = normalizeText(preferredName);
  return name ? message.replace("Hi!", `Hi ${name}!`) : message;
}

/**
 * The Main chat transcript pane: its turns with any routed request, the
 * welcome shown in an empty conversation, and reloading or paging history.
 */
function useVibe64AutopilotChatPane(props, {
  composerSending,
  messageDelivery,
  preferredName,
  routingRequest,
  sessionId,
  workspaceSetupStatus
}) {
  const chatTurns = computed(() => {
    // Hydrate history before appending a restored unsent request to its tail.
    if (!messageDelivery.value || props.conversationLog?.initializing) return [];
    return chatTurnsWithRouting(
      messageDelivery.value.turns(Array.isArray(props.conversationLog?.turns) ? props.conversationLog.turns : []),
      routingRequest.value,
      composerSending.value
    );
  });
  const emptyConversationWelcome = computed(() => (
    sessionId.value &&
    !props.conversationLog?.loading &&
    !props.conversationLog?.error &&
    !chatTurns.value.length
      ? emptyConversationWelcomeText({
          existingProject: workspaceSetupStatus.value !== "unconfigured",
          preferredName: preferredName.value,
          renewedSession: Boolean(normalizeText(
            props.session?.metadata?.renewed_from
          ))
        })
      : ""
  ));
  const conversationLogVisible = computed(() => Boolean(props.active));
  const conversationScrollKey = computed(() => sessionId.value);
  const chatReloading = ref(false);
  const chatReloadAvailable = computed(() => Boolean(
    props.active && props.session && (
      typeof props.refreshSessionData === "function" ||
      typeof props.conversationLog?.reload === "function"
    )
  ));

  async function reloadChatPane() {
    if (!chatReloadAvailable.value || chatReloading.value) {
      return false;
    }
    chatReloading.value = true;
    try {
      await Promise.allSettled([
        props.refreshSessionData?.(),
        props.conversationLog?.reload?.()
      ]);
      return true;
    } finally {
      chatReloading.value = false;
    }
  }

  async function loadMoreChatTurns(request = {}) {
    return typeof props.conversationLog?.loadMore === "function"
      ? props.conversationLog.loadMore(request)
      : false;
  }

  return {
    chatReloading,
    chatTurns,
    conversationLogVisible,
    conversationScrollKey,
    emptyConversationWelcome,
    loadMoreChatTurns,
    reloadChatPane
  };
}

export {
  emptyConversationWelcomeText,
  useVibe64AutopilotChatPane
};
