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
  vibe64ConversationLogQueryKey,
  vibe64SessionEventMatchesScope
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";
import {
  normalizeConversationMessage as normalizeSharedConversationMessage,
  normalizeConversationTurn as normalizeSharedConversationTurn,
  applyConversationLogPatch as applySharedConversationLogPatch,
  mergeConversationStream,
  CONVERSATION_LOG_PAGE_LIMIT,
  normalizeConversationLogPagination,
  normalizeConversationLogPage,
  mergeConversationLogPages,
  conversationLogReadQuery
} from "@jskit-ai/assistant-core/shared/conversation";
import {
  normalizeVibe64ConversationAttachments
} from "@local/vibe64-runtime/shared";

const CONVERSATION_LOG_REALTIME_REASONS = new Set([
  "conversation-rewound",
  "session-assistant-selection-updated",
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

function normalizeConversationMessage(message = {}) {
  return normalizeSharedConversationMessage(message, { normalizeAttachments: normalizeVibe64ConversationAttachments });
}

function normalizeConversationTurn(turn = {}, index = 0) {
  const normalized = normalizeSharedConversationTurn(turn, index, { normalizeAttachments: normalizeVibe64ConversationAttachments });
  return normalized && {
    ...normalized,
    ...(isRecord(turn.integrationSetup) ? { integrationSetup: turn.integrationSetup } : {})
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
  return conversationTurnsWithPending(normalizedTurns, options.pending);
}

function conversationTurnsWithPending(turns, pending) {
  const pendingTurnIndex = pending === true ? turns.length - 1 : -1;
  return turns.map((turn, index) => {
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
  return applySharedConversationLogPatch(payload, patch, {
    ...options, normalizeAttachments: normalizeVibe64ConversationAttachments
  });
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

function useConversationIntegrationActions({ turns, enabled, sessionId, projectSlug, sessionsApiPath, reloadConversationLog, httpClient }) {
  const integrationActionPending = shallowRef(null);
  const integrationActionError = ref(null);
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
    integrationActionPending.value = null;
    integrationActionError.value = null;
    integrationConnections.value = {};
  });

  return { integrationConnections, connectIntegrationRequest, checkIntegrationRequest, cancelIntegrationRequest,
    integrationActionPending, integrationActionError, skipIntegrationRequest, resumeIntegrationRequest };
}

function useVibe64ConversationLog({
  active = true,
  projectSlug: projectSlugInput,
  sessionsApiPath: sessionsApiPathInput,
  learningAttemptId,
  session,
  conversation = null
} = {}) {
  const paths = usePaths();
  const httpClient = getHttpWebClient();
  const projectSlug = projectSlugInput === undefined ? useVibe64ProjectSlug()
    : computed(() => readRefOrGetterValue(projectSlugInput));
  const currentSession = computed(() => readRefOrGetterValue(session) || null);
  const sessionId = computed(() => String(currentSession.value?.sessionId || "").trim());
  const enabled = computed(() => Boolean(
    readRefOrGetterValue(active) !== false &&
    sessionId.value
  ));
  const sessionsApiPath = computed(() => readRefOrGetterValue(sessionsApiPathInput) || paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  if (conversation) {
    const turns = computed(() => conversationTurnsWithPending(conversation.turns.value, sessionIsAwaitingCodex(currentSession.value)));
    const integrationActions = useConversationIntegrationActions({ turns, enabled, sessionId, projectSlug,
      sessionsApiPath, reloadConversationLog: conversation.reload, httpClient });
    // Product completion remains an independent reconciliation signal when a
    // native notification is missed. The supplied binding still owns the read.
    let realtimeCompletionKey = "";
    const realtime = useRealtimeEvent({ enabled, event: VIBE64_SESSION_CHANGED_EVENT,
      matches: context => (["session-assistant-selection-updated", "integration-setup-skipped", "integration-setup-completed"]
        .includes(context?.payload?.reason) || conversationLogCompletedTurnKey(context?.payload)) &&
        conversationLogRealtimeShouldRefresh(context, sessionId.value) &&
        vibe64SessionEventMatchesScope(context?.payload, { projectSlug: projectSlug.value, learningAttemptId }),
      onEvent: ({ payload = {} } = {}) => {
        realtimeCompletionKey = conversationLogCompletedTurnKey(payload) || realtimeCompletionKey;
        return payload.reason === "session-assistant-selection-updated"
          ? conversation.reload({ resubscribe: true }) : conversation.reload();
      } });
    watch(() => conversationLogCompletedTurnKey(currentSession.value), key => {
      if (!enabled.value || !key) return;
      if (key === realtimeCompletionKey) {
        realtimeCompletionKey = "";
        return;
      }
      void conversation.reload()?.catch(() => {
        // The supplied binding retains the error and its ordinary recovery.
      });
    }, { flush: "post" });
    return { ...integrationActions, turns, error: conversation.error,
      errorReloadable: computed(() => conversation.accessDenied?.value === false),
      hasMoreBefore: conversation.hasMoreBefore,
      loadMore: conversation.loadMore, loadMoreError: conversation.loadMoreError, loading: conversation.loading,
      initializing: computed(() => !conversation.snapshot.value && conversation.loading.value),
      loadingMore: conversation.loadingMore, reload: conversation.reload, realtime,
      visible: computed(() => Boolean(conversation.loading.value || conversation.error.value || turns.value.length)) };
  }
  // Archived sessions still use their original read-only history resource.
  const queryClient = useQueryClient();
  const olderPages = ref([]);
  const loadingMore = ref(false);
  const loadMoreError = ref("");
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
  const pendingReads = new Set();
  const resource = useEndpointResource({
    enabled,
    fallbackLoadError: "Conversation history could not be loaded.",
    path: conversationLogPath,
    queryKey,
    queryOptions: {
      async queryFn({ signal }) {
        const read = {
          sessionId: sessionId.value,
          projectSlug: projectSlug.value,
          patches: []
        };
        pendingReads.add(read);
        try {
          let payload = await httpClient.request(conversationLogPath.value, {
            method: "GET",
            query: conversationLogReadQuery(),
            signal
          });
          // The request may have captured history before a live delivery. Apply
          // only updates received during this read before it replaces the cache.
          for (const patch of read.patches) {
            payload = applyConversationLogPatch(payload, patch, { limit: CONVERSATION_LOG_PAGE_LIMIT });
          }
          return payload;
        } finally {
          pendingReads.delete(read);
        }
      },
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
    for (const read of pendingReads) {
      if (read.sessionId === sessionId.value && read.projectSlug === projectSlug.value) {
        read.patches.push(patch);
      }
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

  const integrationActions = useConversationIntegrationActions({ turns, enabled, sessionId, projectSlug,
    sessionsApiPath, reloadConversationLog, httpClient });
  watch([sessionId, projectSlug], () => {
    conversationStream.value = null;
    olderPages.value = [];
    loadMoreError.value = "";
  });

  return {
    ...integrationActions,
    error: resource.loadError,
    hasMoreBefore,
    loadMore: loadMoreConversationLog,
    loadMoreError,
    loading: resource.isLoading,
    initializing: resource.isInitialLoading,
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
