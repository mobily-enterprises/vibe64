import { computed, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
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
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";

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
  const thinking = Array.isArray(turn.thinking)
    ? turn.thinking.map(normalizeConversationMessage).filter(Boolean)
    : [];
  if (!system && !user && !assistant && !thinking.length) {
    return null;
  }
  return {
    assistant,
    messages: [system, user, ...thinking, assistant].filter(Boolean),
    ...(system ? { system } : {}),
    thinking,
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

function conversationLogRealtimeShouldRefresh({ payload = {} } = {}, sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  const changedSessionId = String(payload.sessionId || payload.entityId || "").trim();
  return Boolean(normalizedSessionId && changedSessionId === normalizedSessionId);
}

function conversationLogRecoveryStateKey(session = {}) {
  const source = session && typeof session === "object" && !Array.isArray(session) ? session : {};
  return [
    source.sessionId,
    source.status,
    source.currentStep,
    source.nextStepId,
    source.stepStatus,
    source.stepMachine?.status,
    source.stepMachine?.nextStepId,
    source.presentation?.step?.status,
    source.presentation?.step?.nextStepId,
    source.presentation?.auto?.nextOperation?.id,
    source.presentation?.auto?.nextOperation?.actionId
  ].map((value) => String(value || "").trim()).join("|");
}

function useVibe64ConversationLog({
  active = true,
  session
} = {}) {
  const paths = usePaths();
  const projectSlug = useVibe64ProjectSlug();
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
        projectSlug.value
      )
    ]),
    queryOptions: {
      placeholderData: (previousData) => previousData,
      refetchOnMount: false,
      refetchOnWindowFocus: false
    },
    readMethod: "GET",
    refreshOnPull: true,
    requestRecoveryLabel: "Conversation history",
    realtime: {
      event: VIBE64_SESSION_CHANGED_EVENT,
      matches: (context) => conversationLogRealtimeShouldRefresh(context, sessionId.value)
    }
  });
  let reloadInFlight = null;
  let reloadQueued = false;
  let recoveredErrorKey = "";

  async function reloadConversationLog() {
    if (reloadInFlight) {
      reloadQueued = true;
      return reloadInFlight;
    }

    reloadInFlight = resource.reload();
    try {
      return await reloadInFlight;
    } finally {
      reloadInFlight = null;
      if (reloadQueued) {
        reloadQueued = false;
        void reloadConversationLog();
      }
    }
  }

  const recoveryStateKey = computed(() => conversationLogRecoveryStateKey(currentSession.value));
  const recoveryErrorKey = computed(() => [
    enabled.value ? "enabled" : "disabled",
    sessionId.value,
    recoveryStateKey.value,
    resource.loadError.value
  ].join("|"));
  watch(recoveryErrorKey, () => {
    const loadError = String(resource.loadError.value || "").trim();
    if (!enabled.value || !loadError) {
      recoveredErrorKey = "";
      return;
    }

    const key = recoveryErrorKey.value;
    if (recoveredErrorKey === key) {
      return;
    }
    recoveredErrorKey = key;
    vibe64SessionDebugLog("client.conversationLog.recover.start", {
      error: loadError,
      recoveryStateKey: recoveryStateKey.value,
      sessionId: sessionId.value
    });
    void reloadConversationLog()
      .then(() => {
        vibe64SessionDebugLog("client.conversationLog.recover.done", {
          recoveryStateKey: recoveryStateKey.value,
          sessionId: sessionId.value
        });
      })
      .catch((error) => {
        vibe64SessionDebugLog("client.conversationLog.recover.error", {
          error: vibe64SessionDebugError(error),
          recoveryStateKey: recoveryStateKey.value,
          sessionId: sessionId.value
        });
      });
  }, {
    flush: "post"
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
    reload: reloadConversationLog,
    turns,
    visible
  };
}

export {
  conversationLogRecoveryStateKey,
  conversationLogRealtimeShouldRefresh,
  normalizeConversationLog,
  sessionIsAwaitingCodex,
  useVibe64ConversationLog
};
