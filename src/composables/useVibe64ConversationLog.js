import { connectorDefinitions } from "@jskit-ai/connectors-catalog/shared";
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import {
  useRealtimeEvent,
  useRealtimeSocket
} from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64ConversationLogPath,
  vibe64SessionPath,
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
  normalizeThinkingMessageText,
  mergeConversationStream
} from "@jskit-ai/assistant-core/shared/conversation";
import {
  normalizeVibe64ConversationAttachments
} from "@local/vibe64-runtime/shared";

const CONVERSATION_LOG_REALTIME_REASONS = new Set([
  "assistant-stream",
  "integration-setup-skipped",
  "integration-setup-completed",
  "assistant-response-bundle",
  "codex-app-server-agent-result",
  "codex-app-server-agent-result-invalid",
  "codex-app-server-agent-result-missing",
  "codex-app-server-agent-result-provider-failed",
  "codex-app-server-commentary",
  "codex-app-server-final-assistant-message",
  "codex-app-server-live-progress",
  "codex-app-server-reasoning-summary",
  "codex-app-server-terminal-assistant-message",
  "codex-app-server-terminal-thinking-message",
  "codex-app-server-terminal-user-message",
  "codex-turn-outcome",
  "codex-app-server-message-delivered",
  "opencode-credential-failure",
  "opencode-provider-failure",
  "opencode-server-assistant-message",
  "opencode-server-message-delivered",
  "opencode-server-reasoning",
  "opencode-server-tool",
  "opencode-server-turn-idle",
  "claude-stream-turn-idle",
  "claude-stream-message",
  "claude-stream-message-delivered",
  "session-agent-message-cancelled",
  "session-agent-message-accepted",
  "session-agent-message-delivered",
  "session-agent-message-failed"
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
  const attachments = normalizeVibe64ConversationAttachments(message.attachments);
  return {
    at: String(message.at || "").trim(),
    ...(attachments.length ? { attachments } : {}),
    ...(String(message.messageId || "").trim()
      ? { messageId: String(message.messageId).trim() }
      : {}),
    role,
    text
  };
}

function chronologicalConversationActivity(messages = []) {
  return [...messages].sort((left, right) => (
    String(left?.at || "").localeCompare(String(right?.at || ""))
  ));
}

function normalizeConversationTurn(turn = {}, index = 0) {
  if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
    return null;
  }
  const user = normalizeConversationMessage(turn.user);
  const assistant = normalizeConversationMessage(turn.assistant);
  const normalizedCommentary = Array.isArray(turn.commentary)
    ? turn.commentary.map(normalizeConversationMessage).filter(Boolean)
    : [];
  const system = normalizeConversationMessage(turn.system);
  const normalizedThinking = Array.isArray(turn.thinking)
    ? turn.thinking.map(normalizeConversationMessage).filter(Boolean)
    : [];
  const activityFromMessages = Array.isArray(turn.messages)
    ? turn.messages
      .map(normalizeConversationMessage)
      .filter((message) => ["commentary", "thinking"].includes(message?.role))
    : [];
  const activity = activityFromMessages.length
    ? activityFromMessages
    : chronologicalConversationActivity([...normalizedThinking, ...normalizedCommentary]);
  const commentary = activity.filter((message) => message.role === "commentary");
  const thinking = activity.filter((message) => message.role === "thinking");
  if (!system && !user && !assistant && !activity.length) {
    return null;
  }
  return {
    assistant,
    commentary,
    messages: [system, user, ...activity, assistant].filter(Boolean),
    ...(isRecord(turn.metadata) ? { metadata: turn.metadata } : {}),
    ...(isRecord(turn.integrationSetup) ? { integrationSetup: turn.integrationSetup } : {}),
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
      "assistant-response-bundle",
      "codex-app-server-commentary",
      "codex-app-server-final-assistant-message",
      "codex-app-server-reasoning-summary",
      "codex-app-server-live-progress",
      "codex-app-server-terminal-assistant-message",
      "codex-app-server-terminal-thinking-message",
      "codex-app-server-terminal-user-message",
      "codex-app-server-message-delivered",
      "opencode-credential-failure",
      "opencode-provider-failure",
      "opencode-server-assistant-message",
      "opencode-server-message-delivered",
      "opencode-server-reasoning",
      "opencode-server-tool"
    ].includes(reason) ||
    patch?.type !== "upsert-turn" ||
    !isRecord(patch.turn)
  ) {
    return null;
  }
  const assistant = normalizeConversationMessage(patch.turn.assistant);
  const commentary = Array.isArray(patch.turn.commentary)
    ? patch.turn.commentary.map(normalizeConversationMessage).filter(Boolean)
    : [];
  const thinking = Array.isArray(patch.turn.thinking)
    ? patch.turn.thinking.map(normalizeConversationMessage).filter(Boolean)
    : [];
  if (
    ["codex-app-server-reasoning-summary", "codex-app-server-live-progress"].includes(reason) &&
    (!thinking.length || assistant)
  ) {
    return null;
  }
  if (reason === "codex-app-server-commentary" && (!commentary.length || assistant)) {
    return null;
  }
  if (["assistant-response-bundle", "codex-app-server-final-assistant-message"].includes(reason) && !assistant) {
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
  const nextTurns = (existingIndex >= 0
    ? turns.map((turn, index) => index === existingIndex ? patch.turn : turn)
    : [...turns, patch.turn]
  ).sort((left, right) => String(left?.turnId || "").localeCompare(
    String(right?.turnId || ""),
    undefined,
    {
      numeric: true
    }
  ));
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
  return source.agentSession?.turn?.active === true;
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
  return Boolean(payload.conversationStream) || !reason || CONVERSATION_LOG_REALTIME_REASONS.has(reason);
}

function conversationLogRecoveryStateKey(session = {}) {
  const source = session && typeof session === "object" && !Array.isArray(session) ? session : {};
  return [
    source.sessionId,
    source.status,
    source.revision,
    source.updatedAt,
    source.agentSession?.turn?.active ? "active" : "idle",
    source.agentSession?.turn?.id
  ].map((value) => String(value || "").trim()).join("|");
}

function conversationLogCompletedTurnKey(session = {}) {
  const source = isRecord(session) ? session : {};
  const turn = isRecord(source.agentSession?.turn) ? source.agentSession.turn : {};
  const sessionId = String(source.sessionId || "").trim();
  const turnId = String(turn.id || "").trim();
  const revision = Number(source.revision);
  if (
    !sessionId ||
    !turnId ||
    turn.active !== false ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  ) {
    return "";
  }
  return `${sessionId}|${revision}|${turnId}`;
}

function useVibe64ConversationLog({
  active = true,
  session
} = {}) {
  const paths = usePaths();
  const httpClient = getHttpWebClient();
  const queryClient = useQueryClient();
  const projectSlug = useVibe64ProjectSlug();
  const currentSession = computed(() => readRefOrGetterValue(session) || null);
  const sessionId = computed(() => String(currentSession.value?.sessionId || "").trim());
  const olderPages = ref([]);
  const loadingMore = ref(false);
  const loadMoreError = ref("");
  const integrationActionPending = shallowRef(null);
  const integrationActionError = ref(null);
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
  let realtimeCompletionKey = "";
  const conversationStream = shallowRef(null);

  function receiveConversationStream(snapshot) {
    if (snapshot && (!conversationStream.value || snapshot.revision >= conversationStream.value.revision)) {
      conversationStream.value = snapshot;
    }
  }
  watch(() => resource.data.value, (data) => receiveConversationStream(data?.conversationStream), { immediate: true });

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

  const realtimeSocket = useRealtimeSocket({ required: false });
  const reconcileConversationAfterRealtimeConnect = () => {
    if (enabled.value) {
      conversationStream.value = null;
      void reloadConversationLog().catch(() => {
        // The resource retains the failed reconciliation for the mounted session UI.
      });
    }
  };
  realtimeSocket.on("connect", reconcileConversationAfterRealtimeConnect);
  onScopeDispose(() => {
    realtimeSocket.off("connect", reconcileConversationAfterRealtimeConnect);
  });

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
      receiveConversationStream(payload.conversationStream);
      realtimeCompletionKey = conversationLogCompletedTurnKey(payload) || realtimeCompletionKey;
      vibe64SessionDebugLog("client.conversationLog.realtime", {
        hasPatch: Boolean(conversationLogRealtimePatch(payload)),
        reason: String(payload.reason || ""),
        sessionId: sessionId.value
      });
      if (applyRealtimeConversationLogPatch(payload)) {
        return null;
      }
      if (payload.reason === "assistant-stream") return null;
      return reloadConversationLog();
    }
  });

  const recoveryStateKey = computed(() => conversationLogRecoveryStateKey(currentSession.value));
  const completedTurnKey = computed(() => conversationLogCompletedTurnKey(currentSession.value));
  watch(completedTurnKey, (key) => {
    if (!enabled.value || !key) {
      return;
    }
    if (key === realtimeCompletionKey) {
      realtimeCompletionKey = "";
      return;
    }
    vibe64SessionDebugLog("client.conversationLog.completion.reconcile", {
      completedTurnKey: key,
      sessionId: sessionId.value
    });
    void reloadConversationLog().catch(() => {
      // The ordinary resource error recovery below retries against later
      // canonical session revisions without discarding the mounted history.
    });
  }, {
    flush: "post"
  });
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
  const turns = computed(() => {
    const savedTurns = normalizeConversationLog(mergeConversationLogPages(loadedPages.value), {
      pending: sessionIsAwaitingCodex(currentSession.value)
    });
    return mergeConversationStream(savedTurns, conversationStream.value);
  });
  const visible = computed(() => Boolean(
    resource.isLoading.value ||
    resource.loadError.value ||
    turns.value.length
  ));

  async function loadMoreConversationLog({ complete } = {}) {
    const finish = (result) => {
      if (typeof complete === "function") {
        complete(result);
      }
    };
    const beforeTurnId = normalizeConversationLogPagination(oldestLoadedPage.value?.pagination).oldestTurnId ||
      String(turns.value[0]?.turnId || "").trim();
    if (!enabled.value || !conversationLogPath.value || !hasMoreBefore.value || loadingMore.value || !beforeTurnId) {
      finish({ changed: false, loaded: false });
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
          beforeTurnId,
          limit: CONVERSATION_LOG_PAGE_LIMIT
        })
      });
      const previousOldestTurnId = String(turns.value[0]?.turnId || "").trim();
      olderPages.value = [
        normalizeConversationLogPage(page),
        ...olderPages.value
      ];
      const nextOldestTurnId = String(turns.value[0]?.turnId || "").trim();
      const changed = Boolean(
        nextOldestTurnId &&
        nextOldestTurnId !== previousOldestTurnId
      );
      vibe64SessionDebugLog("client.conversationLog.loadMore.done", {
        beforeTurnId,
        sessionId: sessionId.value,
        turnCount: Array.isArray(page?.conversationLog) ? page.conversationLog.length : 0
      });
      finish({ changed, loaded: true });
      return true;
    } catch (error) {
      loadMoreError.value = String(error?.message || error || "Older conversation history could not be loaded.");
      vibe64SessionDebugLog("client.conversationLog.loadMore.error", {
        beforeTurnId,
        error: vibe64SessionDebugError(error),
        sessionId: sessionId.value
      });
      finish({ changed: false, loaded: false });
      return false;
    } finally {
      loadingMore.value = false;
    }
  }

  const integrationConnections = shallowRef({});

  function connectIntegrationRequest(request = {}) {
    return runIntegrationRequestAction(request, "connect");
  }

  function checkIntegrationRequest(request = {}) {
    return runIntegrationRequestAction(request, "status");
  }

  function cancelIntegrationRequest(request = {}) {
    return runIntegrationRequestAction(request, "cancel");
  }

  function skipIntegrationRequest(request = {}) {
    return runIntegrationRequestAction(request, "skip");
  }

  function resumeIntegrationRequest(request = {}) {
    return runIntegrationRequestAction(request, "resume");
  }

  async function runIntegrationRequestAction(request, action) {
    const turn = turns.value.find((entry) => entry.turnId === request.turnId);
    if (!enabled.value || request.sessionId !== sessionId.value || integrationActionPending.value ||
        turn?.integrationSetup?.outcome !== (action === "resume" ? "completed" : "pending") ||
        turn.integrationSetup.requestId !== request.requestId) return false;
    const selection = { sessionId: sessionId.value, turnId: request.turnId, requestId: request.requestId };
    integrationActionPending.value = selection;
    integrationActionError.value = null;
    try {
      if (["connect", "cancel", "status"].includes(action)) {
        const path = vibe64SessionPath(sessionsApiPath.value, selection.sessionId, "/integrations");
        const config = await httpClient.request(path);
        if (integrationActionPending.value !== selection || sessionId.value !== selection.sessionId) return false;
        const integrationId = turn.integrationSetup.integrationId;
        const integration = config?.configuration?.integrations?.[integrationId];
        if (!integration) throw new Error("Choose Configure to set up this integration first.");
        if (connectorDefinitions.some((provider) => provider.id === integration.provider && (provider.configurationOnly || provider.configurationOnlyForSettings?.(integration?.settings || {})))) {
          integrationConnections.value = { ...integrationConnections.value,
            [selection.requestId]: { status: "configuration-only" } };
          return true;
        }
        if (integration.accountMode === "per-user") throw new Error("Each app user connects their account inside the application. Choose Configure for setup instructions.");
        const endpoint = `${path}/${encodeURIComponent(integrationId)}/setup`;
        const previous = integrationConnections.value[selection.requestId];
        if (action === "cancel" && !previous?.attemptId) return false;
        let connection = await httpClient.request(endpoint, { method: "POST", body: {
          operation: action,
          ...(action === "cancel" ? { attemptId: previous.attemptId } : {
            setupRequest: { turnId: selection.turnId, requestId: selection.requestId, configurationHash: config.baseHash }
          })
        } });
        if (integrationActionPending.value !== selection || sessionId.value !== selection.sessionId) return false;
        if (action === "cancel") {
          connection = await httpClient.request(endpoint, { method: "POST", body: { operation: "status" } });
          if (integrationActionPending.value !== selection || sessionId.value !== selection.sessionId) return false;
        }
        integrationConnections.value = { ...integrationConnections.value, [selection.requestId]: connection };
        if (connection.integrationSetup?.outcome === "completed" && connection.integrationSetup.continuation?.status !== "accepted") {
          const resumed = await httpClient.request(vibe64SessionPath(sessionsApiPath.value, selection.sessionId, "/integration-setup/resume"), {
            method: "POST", body: { turnId: selection.turnId, requestId: selection.requestId }
          });
          if (resumed?.ok !== true) throw new Error(resumed?.error || "Assistant continuation is not yet confirmed.");
        }
        if (integrationActionPending.value === selection && sessionId.value === selection.sessionId) await reloadConversationLog();
        return true;
      }
      const result = await httpClient.request(vibe64SessionPath(sessionsApiPath.value, selection.sessionId, `/integration-setup/${action}`), {
        method: "POST", body: { turnId: selection.turnId, requestId: selection.requestId }
      });
      if (result?.ok !== true) throw new Error(result?.error || "Could not update integration setup.");
      if (integrationActionPending.value === selection && sessionId.value === selection.sessionId) {
        await reloadConversationLog();
      }
      return true;
    } catch (error) {
      if (sessionId.value === selection.sessionId && integrationActionPending.value === selection) {
        integrationActionError.value = { turnId: selection.turnId, message: String(error?.message || "Could not update integration setup.") };
        if (action === "resume" || action === "connect" || action === "status") await reloadConversationLog();
      }
      return false;
    } finally {
      if (sessionId.value === selection.sessionId && integrationActionPending.value === selection) {
        integrationActionPending.value = null;
      }
    }
  }

  onScopeDispose(() => {
    integrationActionPending.value = null;
  });

  watch([sessionId, projectSlug], () => {
    conversationStream.value = null;
    integrationActionPending.value = null;
    integrationActionError.value = null;
    integrationConnections.value = {};
    olderPages.value = [];
    loadMoreError.value = "";
  });

  return {
    integrationConnections,
    connectIntegrationRequest,
    checkIntegrationRequest,
    cancelIntegrationRequest,
    integrationActionPending,
    integrationActionError,
    skipIntegrationRequest,
    resumeIntegrationRequest,
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
  conversationLogCompletedTurnKey,
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
