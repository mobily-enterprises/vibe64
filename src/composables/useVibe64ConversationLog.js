import { computed, ref, watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
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
import {
  vibe64RealtimePayloadFromCurrentTab
} from "@/lib/vibe64BrowserTabOrigin.js";

const CONVERSATION_LOG_REALTIME_REASONS = new Set([
  "codex-app-server-agent-result",
  "codex-app-server-agent-result-invalid",
  "codex-app-server-agent-result-missing",
  "codex-app-server-agent-result-provider-failed",
  "codex-app-server-live-progress",
  "codex-app-server-reasoning-summary",
  "codex-app-server-terminal-assistant-message",
  "codex-app-server-terminal-user-message",
  "session-action-run",
  "session-intent-run"
]);
const CONVERSATION_LOG_LIVE_PROGRESS_REASON = "codex-app-server-live-progress";
const CONVERSATION_LOG_LIVE_PROGRESS_CLEAR_REASONS = new Set([
  "codex-app-server-agent-result",
  "codex-app-server-agent-result-invalid",
  "codex-app-server-agent-result-missing",
  "codex-app-server-agent-result-provider-failed",
  "codex-app-server-terminal-assistant-message"
]);
const CONVERSATION_LOG_SELF_ORIGIN_IGNORED_REASONS = new Set([
  "session-action-run",
  "session-intent-run"
]);

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

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function conversationLogRealtimeLiveProgressMessage(payload = {}) {
  if (String(payload?.reason || "").trim() !== CONVERSATION_LOG_LIVE_PROGRESS_REASON) {
    return null;
  }
  const progress = isRecord(payload.codexLiveProgress) ? payload.codexLiveProgress : null;
  const text = String(progress?.text || "").trim();
  if (!progress || !text) {
    return null;
  }
  const id = String(progress.id || "").trim();
  return {
    appearance: "thinking",
    at: String(progress.at || "").trim(),
    id: id || `codex-live-progress-${String(progress.threadId || "")}-${String(progress.turnId || "")}`,
    label: "Codex",
    replace: progress.replace === true,
    text
  };
}

function mergeConversationLogLiveProgressMessages(messages = [], message = null) {
  if (!message) {
    return Array.isArray(messages) ? messages : [];
  }
  return [message];
}

function conversationLogRealtimeClearsLiveProgress(payload = {}) {
  return CONVERSATION_LOG_LIVE_PROGRESS_CLEAR_REASONS.has(String(payload?.reason || "").trim());
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

function conversationLogRealtimePatch(payload = {}) {
  const reason = String(payload?.reason || "").trim();
  const patch = isRecord(payload?.conversationLogPatch) ? payload.conversationLogPatch : null;
  if (reason !== "codex-app-server-reasoning-summary" || patch?.type !== "upsert-turn" || !isRecord(patch.turn)) {
    return null;
  }
  return {
    turn: patch.turn,
    type: "upsert-turn"
  };
}

function applyConversationLogPatch(payload = {}, patch = null) {
  if (patch?.type !== "upsert-turn" || !isRecord(patch.turn)) {
    return null;
  }
  const source = isRecord(payload) ? payload : {};
  const turns = Array.isArray(source.conversationLog) ? source.conversationLog : [];
  const turnId = String(patch.turn.turnId || "").trim();
  if (!turnId) {
    return null;
  }
  const existingIndex = turns.findIndex((turn) => String(turn?.turnId || "").trim() === turnId);
  const nextTurns = existingIndex >= 0
    ? turns.map((turn, index) => index === existingIndex ? patch.turn : turn)
    : [...turns, patch.turn];
  return {
    ...source,
    conversationLog: nextTurns
  };
}

function sessionIsAwaitingCodex(session = {}) {
  const source = session && typeof session === "object" && !Array.isArray(session) ? session : {};
  return String(source.stepMachine?.status || source.presentation?.step?.status || "").trim() === "awaiting_agent_result";
}

function conversationLogRealtimeShouldRefresh({ payload = {} } = {}, sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  const changedSessionId = String(payload.sessionId || payload.entityId || "").trim();
  if (!normalizedSessionId || changedSessionId !== normalizedSessionId) {
    return false;
  }
  const reason = String(payload.reason || "").trim();
  if (
    CONVERSATION_LOG_SELF_ORIGIN_IGNORED_REASONS.has(reason) &&
    vibe64RealtimePayloadFromCurrentTab(payload)
  ) {
    return false;
  }
  return !reason || CONVERSATION_LOG_REALTIME_REASONS.has(reason);
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
  const queryClient = useQueryClient();
  const projectSlug = useVibe64ProjectSlug();
  const currentSession = computed(() => readRefOrGetterValue(session) || null);
  const sessionId = computed(() => String(currentSession.value?.sessionId || "").trim());
  const liveProgressMessages = ref([]);
  const enabled = computed(() => Boolean(
    readRefOrGetterValue(active) !== false &&
    sessionId.value
  ));
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const queryKey = computed(() => [
    ...vibe64ConversationLogQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      sessionId.value,
      projectSlug.value
    )
  ]);
  const resource = useEndpointResource({
    enabled,
    fallbackLoadError: "Conversation history could not be loaded.",
    path: computed(() => sessionId.value
      ? vibe64ConversationLogPath(sessionsApiPath.value, sessionId.value)
      : ""),
    queryKey,
    queryOptions: {
      placeholderData: (previousData) => previousData,
      refetchOnMount: false,
      refetchOnWindowFocus: false
    },
    readMethod: "GET",
    refreshOnPull: true,
    requestRecoveryLabel: "Conversation history",
    realtime: null
  });
  let reloadInFlight = null;
  let reloadQueued = false;
  let recoveredErrorKey = "";

  async function reloadConversationLog() {
    if (reloadInFlight) {
      reloadQueued = true;
      vibe64SessionDebugLog("client.conversationLog.reload.join", {
        sessionId: sessionId.value
      });
      return reloadInFlight;
    }

    vibe64SessionDebugLog("client.conversationLog.reload.start", {
      sessionId: sessionId.value
    });
    reloadInFlight = resource.reload();
    try {
      const result = await reloadInFlight;
      vibe64SessionDebugLog("client.conversationLog.reload.done", {
        sessionId: sessionId.value
      });
      return result;
    } finally {
      reloadInFlight = null;
      if (reloadQueued) {
        reloadQueued = false;
        void reloadConversationLog();
      }
    }
  }

  function applyRealtimeConversationLogPatch(payload = {}) {
    const patch = conversationLogRealtimePatch(payload);
    if (!patch) {
      return false;
    }
    const key = queryKey.value;
    const currentPayload = queryClient.getQueryData(key);
    const nextPayload = applyConversationLogPatch(currentPayload, patch);
    if (!nextPayload) {
      vibe64SessionDebugLog("client.conversationLog.patch.miss", {
        hasCurrentPayload: Boolean(currentPayload),
        patchType: String(patch?.type || ""),
        sessionId: sessionId.value
      });
      return false;
    }
    queryClient.setQueryData(key, nextPayload);
    vibe64SessionDebugLog("client.conversationLog.patch.done", {
      patchType: String(patch.type || ""),
      sessionId: sessionId.value,
      turnId: String(patch.turn?.turnId || "")
    });
    return true;
  }

  function applyRealtimeLiveProgressMessage(payload = {}) {
    const message = conversationLogRealtimeLiveProgressMessage(payload);
    if (!message) {
      return false;
    }
    liveProgressMessages.value = mergeConversationLogLiveProgressMessages(liveProgressMessages.value, message);
    vibe64SessionDebugLog("client.conversationLog.liveProgress", {
      id: message.id,
      sessionId: sessionId.value,
      textLength: message.text.length
    });
    return true;
  }

  const realtime = useRealtimeEvent({
    enabled,
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: (context) => conversationLogRealtimeShouldRefresh(context, sessionId.value),
    onEvent: ({ payload = {} } = {}) => {
      vibe64SessionDebugLog("client.conversationLog.realtime", {
        hasPatch: Boolean(conversationLogRealtimePatch(payload)),
        reason: String(payload.reason || ""),
        sessionId: sessionId.value
      });
      if (applyRealtimeLiveProgressMessage(payload)) {
        return null;
      }
      if (conversationLogRealtimeClearsLiveProgress(payload)) {
        liveProgressMessages.value = [];
      }
      if (applyRealtimeConversationLogPatch(payload)) {
        return null;
      }
      return reloadConversationLog();
    }
  });

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
  watch(sessionId, () => {
    liveProgressMessages.value = [];
  });
  const visible = computed(() => Boolean(
    resource.isLoading.value ||
    resource.loadError.value ||
    turns.value.length ||
    liveProgressMessages.value.length
  ));

  return {
    activityMessages: liveProgressMessages,
    error: resource.loadError,
    loading: resource.isLoading,
    reload: reloadConversationLog,
    realtime,
    turns,
    visible
  };
}

export {
  applyConversationLogPatch,
  conversationLogRealtimePatch,
  conversationLogRealtimeLiveProgressMessage,
  conversationLogRecoveryStateKey,
  conversationLogRealtimeShouldRefresh,
  mergeConversationLogLiveProgressMessages,
  normalizeConversationLog,
  sessionIsAwaitingCodex,
  useVibe64ConversationLog
};
