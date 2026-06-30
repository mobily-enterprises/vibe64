import { computed, ref, watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { getUsersWebHttpClient } from "@jskit-ai/users-web/client/lib/httpClient";
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
  normalizeThinkingMessageText
} from "@/lib/vibe64ConversationThinkingText.js";

const CONVERSATION_LOG_REALTIME_REASONS = new Set([
  "codex-app-server-agent-result",
  "codex-app-server-agent-result-invalid",
  "codex-app-server-agent-result-missing",
  "codex-app-server-agent-result-provider-failed",
  "codex-app-server-final-assistant-message",
  "codex-app-server-live-progress",
  "codex-app-server-reasoning-summary",
  "codex-app-server-terminal-assistant-message",
  "codex-app-server-terminal-thinking-message",
  "codex-app-server-terminal-user-message",
  "codex-app-server-turn-steered",
  "session-action-run",
  "session-intent-run",
  "session-rewound"
]);
const CONVERSATION_LOG_PAGE_LIMIT = 20;

function normalizeConversationMessage(message = {}) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  const role = String(message.role || "").trim();
  const text = role === "thinking"
    ? normalizeThinkingMessageText(message.text)
    : String(message.text || "").trim();
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

function normalizeConversationLogPagination(pagination = {}) {
  const source = isRecord(pagination) ? pagination : {};
  return {
    beforeTurnId: String(source.beforeTurnId || "").trim(),
    count: Number.isFinite(Number(source.count)) ? Number(source.count) : 0,
    hasMoreBefore: source.hasMoreBefore === true,
    limit: Number.isFinite(Number(source.limit)) ? Number(source.limit) : 0,
    newestTurnId: String(source.newestTurnId || "").trim(),
    nextBeforeTurnId: String(source.nextBeforeTurnId || "").trim(),
    oldestTurnId: String(source.oldestTurnId || "").trim(),
    totalTurnCount: Number.isFinite(Number(source.totalTurnCount)) ? Number(source.totalTurnCount) : 0
  };
}

function normalizeConversationLogPage(payload = {}) {
  const source = isRecord(payload) ? payload : {};
  const conversationLog = Array.isArray(source.conversationLog) ? source.conversationLog : [];
  const pagination = normalizeConversationLogPagination(source.pagination);
  return {
    ...source,
    conversationLog,
    pagination: {
      ...pagination,
      count: pagination.count || conversationLog.length,
      newestTurnId: pagination.newestTurnId || String(conversationLog.at(-1)?.turnId || "").trim(),
      oldestTurnId: pagination.oldestTurnId || String(conversationLog[0]?.turnId || "").trim()
    }
  };
}

function mergeConversationLogPages(pages = []) {
  const orderedTurns = [];
  const indexes = new Map();
  for (const page of Array.isArray(pages) ? pages : []) {
    const normalized = normalizeConversationLogPage(page);
    for (const turn of normalized.conversationLog) {
      const turnId = String(turn?.turnId || "").trim();
      if (!turnId) {
        orderedTurns.push(turn);
        continue;
      }
      if (indexes.has(turnId)) {
        orderedTurns[indexes.get(turnId)] = turn;
        continue;
      }
      indexes.set(turnId, orderedTurns.length);
      orderedTurns.push(turn);
    }
  }
  return {
    conversationLog: orderedTurns
  };
}

function conversationLogReadQuery({
  beforeTurnId = "",
  limit = CONVERSATION_LOG_PAGE_LIMIT
} = {}) {
  return {
    ...(beforeTurnId ? { beforeTurnId } : {}),
    limit: String(limit)
  };
}

function conversationLogRealtimePatch(payload = {}) {
  const reason = String(payload?.reason || "").trim();
  const patch = isRecord(payload?.conversationLogPatch) ? payload.conversationLogPatch : null;
  if (
    ![
      "codex-app-server-final-assistant-message",
      "codex-app-server-reasoning-summary",
      "codex-app-server-live-progress",
      "codex-app-server-terminal-assistant-message",
      "codex-app-server-terminal-thinking-message",
      "codex-app-server-terminal-user-message",
      "codex-app-server-turn-steered"
    ].includes(reason) ||
    patch?.type !== "upsert-turn" ||
    !isRecord(patch.turn)
  ) {
    return null;
  }
  const assistant = normalizeConversationMessage(patch.turn.assistant);
  const thinking = Array.isArray(patch.turn.thinking)
    ? patch.turn.thinking.map(normalizeConversationMessage).filter(Boolean)
    : [];
  if (
    ["codex-app-server-reasoning-summary", "codex-app-server-live-progress"].includes(reason) &&
    (!thinking.length || assistant)
  ) {
    return null;
  }
  if (reason === "codex-app-server-final-assistant-message" && !assistant) {
    return null;
  }
  return {
    turn: patch.turn,
    type: "upsert-turn"
  };
}

function applyConversationLogPatch(payload = {}, patch = null, options = {}) {
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
  const limit = Number.parseInt(String(options.limit || ""), 10);
  const limitedTurns = Number.isFinite(limit) && limit > 0
    ? nextTurns.slice(-limit)
    : nextTurns;
  const wasTrimmed = limitedTurns.length < nextTurns.length;
  const pagination = normalizeConversationLogPagination(source.pagination);
  const hasMoreBefore = pagination.hasMoreBefore || wasTrimmed;
  const oldestTurnId = String(limitedTurns[0]?.turnId || "").trim();
  return {
    ...source,
    conversationLog: limitedTurns,
    pagination: {
      ...pagination,
      count: limitedTurns.length,
      hasMoreBefore,
      newestTurnId: String(limitedTurns.at(-1)?.turnId || "").trim(),
      nextBeforeTurnId: hasMoreBefore ? oldestTurnId : "",
      oldestTurnId
    }
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
  // Action and intent events can persist user, system, or audit turns on the
  // server. Even the originating tab must refetch the durable log; optimistic
  // self-echo suppression belongs outside the canonical conversation query.
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
  const httpClient = getUsersWebHttpClient();
  const queryClient = useQueryClient();
  const projectSlug = useVibe64ProjectSlug();
  const currentSession = computed(() => readRefOrGetterValue(session) || null);
  const sessionId = computed(() => String(currentSession.value?.sessionId || "").trim());
  const olderPages = ref([]);
  const loadingMore = ref(false);
  const loadMoreError = ref("");
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
  const conversationLogPath = computed(() => sessionId.value
    ? vibe64ConversationLogPath(sessionsApiPath.value, sessionId.value)
    : "");
  const resource = useEndpointResource({
    enabled,
    fallbackLoadError: "Conversation history could not be loaded.",
    path: conversationLogPath,
    queryKey,
    queryOptions: {
      placeholderData: (previousData) => previousData,
      refetchOnMount: false,
      refetchOnWindowFocus: false
    },
    readMethod: "GET",
    readQuery: computed(() => conversationLogReadQuery()),
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

    olderPages.value = [];
    loadMoreError.value = "";
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
    const nextPayload = applyConversationLogPatch(currentPayload, patch, {
      limit: CONVERSATION_LOG_PAGE_LIMIT
    });
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
      if (applyRealtimeConversationLogPatch(payload)) {
        return null;
      }
      if (String(payload.reason || "").trim() === "session-rewound") {
        olderPages.value = [];
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

  const latestPage = computed(() => normalizeConversationLogPage(resource.data.value || {}));
  const loadedPages = computed(() => [
    ...olderPages.value,
    latestPage.value
  ]);
  const oldestLoadedPage = computed(() => olderPages.value[0] || latestPage.value);
  const hasMoreBefore = computed(() => Boolean(
    normalizeConversationLogPagination(oldestLoadedPage.value?.pagination).hasMoreBefore
  ));
  const turns = computed(() => normalizeConversationLog(mergeConversationLogPages(loadedPages.value), {
    pending: sessionIsAwaitingCodex(currentSession.value)
  }));
  const visible = computed(() => Boolean(
    resource.isLoading.value ||
    resource.loadError.value ||
    turns.value.length
  ));

  async function loadMoreConversationLog() {
    const beforeTurnId = normalizeConversationLogPagination(oldestLoadedPage.value?.pagination).oldestTurnId ||
      String(turns.value[0]?.turnId || "").trim();
    if (!enabled.value || !conversationLogPath.value || !hasMoreBefore.value || loadingMore.value || !beforeTurnId) {
      return false;
    }
    loadingMore.value = true;
    loadMoreError.value = "";
    vibe64SessionDebugLog("client.conversationLog.loadMore.start", {
      beforeTurnId,
      sessionId: sessionId.value
    });
    try {
      const page = await httpClient.request(conversationLogPath.value, {
        method: "GET",
        query: conversationLogReadQuery({
          beforeTurnId
        })
      });
      olderPages.value = [
        normalizeConversationLogPage(page),
        ...olderPages.value
      ];
      vibe64SessionDebugLog("client.conversationLog.loadMore.done", {
        beforeTurnId,
        sessionId: sessionId.value,
        turnCount: Array.isArray(page?.conversationLog) ? page.conversationLog.length : 0
      });
      return true;
    } catch (error) {
      loadMoreError.value = String(error?.message || error || "Older conversation history could not be loaded.");
      vibe64SessionDebugLog("client.conversationLog.loadMore.error", {
        beforeTurnId,
        error: vibe64SessionDebugError(error),
        sessionId: sessionId.value
      });
      return false;
    } finally {
      loadingMore.value = false;
    }
  }

  watch(sessionId, () => {
    olderPages.value = [];
    loadMoreError.value = "";
  });

  return {
    error: resource.loadError,
    hasMoreBefore,
    loadMore: loadMoreConversationLog,
    loadMoreError,
    loading: resource.isLoading,
    loadingMore,
    reload: reloadConversationLog,
    realtime,
    turns,
    visible
  };
}

export {
  applyConversationLogPatch,
  conversationLogRealtimePatch,
  conversationLogRecoveryStateKey,
  conversationLogRealtimeShouldRefresh,
  conversationLogReadQuery,
  mergeConversationLogPages,
  normalizeConversationLog,
  normalizeConversationLogPage,
  normalizeConversationLogPagination,
  sessionIsAwaitingCodex,
  useVibe64ConversationLog
};
