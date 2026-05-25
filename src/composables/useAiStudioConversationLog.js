import { computed } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  AI_STUDIO_SESSION_CHANGED_EVENT,
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  aiStudioConversationLogPath,
  aiStudioConversationLogQueryKey
} from "@/lib/aiStudioSessionRequestConfig.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function normalizeConversationMessage(message = {}) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  const role = String(message.role || "").trim();
  const text = String(message.text || "").trim();
  if (!role || !text) {
    return null;
  }
  return {
    at: String(message.at || "").trim(),
    role,
    text
  };
}

function normalizeConversationTurn(turn = {}, index = 0) {
  if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
    return null;
  }
  const user = normalizeConversationMessage(turn.user);
  const assistant = normalizeConversationMessage(turn.assistant);
  if (!user && !assistant) {
    return null;
  }
  return {
    assistant,
    messages: [user, assistant].filter(Boolean),
    turnId: String(turn.turnId || index + 1).trim(),
    user
  };
}

function normalizeConversationLog(payload = {}) {
  const turns = Array.isArray(payload?.conversationLog) ? payload.conversationLog : [];
  return turns
    .map((turn, index) => normalizeConversationTurn(turn, index))
    .filter(Boolean);
}

function useAiStudioConversationLog({
  active = true,
  session
} = {}) {
  const paths = usePaths();
  const currentSession = computed(() => readRefOrGetterValue(session) || null);
  const sessionId = computed(() => String(currentSession.value?.sessionId || "").trim());
  const enabled = computed(() => Boolean(
    readRefOrGetterValue(active) !== false &&
    sessionId.value
  ));
  const sessionsApiPath = computed(() => paths.api(AI_STUDIO_SESSIONS_API_SUFFIX, {
    surface: AI_STUDIO_SURFACE_ID
  }));
  const resource = useEndpointResource({
    enabled,
    fallbackLoadError: "Conversation history could not be loaded.",
    path: computed(() => sessionId.value
      ? aiStudioConversationLogPath(sessionsApiPath.value, sessionId.value)
      : ""),
    queryKey: computed(() => [
      ...aiStudioConversationLogQueryKey(
        AI_STUDIO_SURFACE_ID,
        ROUTE_VISIBILITY_PUBLIC,
        sessionId.value
      ),
      String(currentSession.value?.revision || ""),
      String(currentSession.value?.stepRevision || "")
    ]),
    readMethod: "GET",
    refreshOnPull: true,
    realtime: {
      event: AI_STUDIO_SESSION_CHANGED_EVENT,
      matches: ({ payload = {} } = {}) => {
        const changedSessionId = String(payload.sessionId || payload.entityId || "").trim();
        return Boolean(changedSessionId) && changedSessionId === sessionId.value;
      }
    }
  });
  const turns = computed(() => normalizeConversationLog(resource.data.value || {}));
  const visible = computed(() => Boolean(
    resource.isLoading.value ||
    resource.loadError.value ||
    turns.value.length
  ));

  return {
    error: resource.loadError,
    loading: resource.isLoading,
    reload: resource.reload,
    turns,
    visible
  };
}

export {
  normalizeConversationLog,
  useAiStudioConversationLog
};
