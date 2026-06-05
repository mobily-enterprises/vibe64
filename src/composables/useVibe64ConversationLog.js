import { computed } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  useVibe64WorkspaceSlug
} from "@/composables/useVibe64WorkspaceScope.js";
import {
  studioHttpClient
} from "@/lib/studioHttp.js";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64ConversationLogPath,
  vibe64ConversationLogQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
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
  const system = normalizeConversationMessage(turn.system);
  if (!system && !user && !assistant) {
    return null;
  }
  return {
    assistant,
    messages: [system, user, assistant].filter(Boolean),
    ...(system ? { system } : {}),
    turnId: String(turn.turnId || index + 1).trim(),
    user
  };
}

function normalizeConversationLog(payload = {}, options = {}) {
  const turns = Array.isArray(payload?.conversationLog) ? payload.conversationLog : [];
  const normalizedTurns = turns
    .map((turn, index) => normalizeConversationTurn(turn, index))
    .filter(Boolean);
  const pendingTurnIndex = options.pending === true ? normalizedTurns.length - 1 : -1;
  return normalizedTurns.map((turn, index) => {
    if (index === pendingTurnIndex && turn.user && !turn.assistant) {
      return {
        ...turn,
        pending: true
      };
    }
    return turn;
  });
}

function sessionIsAwaitingCodex(session = {}) {
  const source = session && typeof session === "object" && !Array.isArray(session) ? session : {};
  return String(source.stepMachine?.status || source.presentation?.step?.status || "").trim() === "awaiting_agent_result";
}

function useVibe64ConversationLog({
  active = true,
  session
} = {}) {
  const paths = usePaths();
  const workspaceSlug = useVibe64WorkspaceSlug();
  const currentSession = computed(() => readRefOrGetterValue(session) || null);
  const sessionId = computed(() => String(currentSession.value?.sessionId || "").trim());
  const enabled = computed(() => Boolean(
    readRefOrGetterValue(active) !== false &&
    sessionId.value
  ));
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const resource = useEndpointResource({
    client: studioHttpClient,
    enabled,
    fallbackLoadError: "Conversation history could not be loaded.",
    path: computed(() => sessionId.value
      ? vibe64ConversationLogPath(sessionsApiPath.value, sessionId.value)
      : ""),
    queryKey: computed(() => [
      ...vibe64ConversationLogQueryKey(
        VIBE64_SURFACE_ID,
        ROUTE_VISIBILITY_PUBLIC,
        sessionId.value,
        workspaceSlug.value
      ),
      String(currentSession.value?.revision || ""),
      String(currentSession.value?.stepRevision || "")
    ]),
    queryOptions: {
      refetchOnMount: false,
      refetchOnWindowFocus: false
    },
    readMethod: "GET",
    refreshOnPull: true,
    realtime: {
      event: VIBE64_SESSION_CHANGED_EVENT,
      matches: ({ payload = {} } = {}) => {
        const changedSessionId = String(payload.sessionId || payload.entityId || "").trim();
        return Boolean(changedSessionId) && changedSessionId === sessionId.value;
      }
    }
  });
  const turns = computed(() => normalizeConversationLog(resource.data.value || {}, {
    pending: sessionIsAwaitingCodex(currentSession.value)
  }));
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
  sessionIsAwaitingCodex,
  useVibe64ConversationLog
};
