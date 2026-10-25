import { connectorDefinitions } from "@jskit-ai/connectors-catalog/shared";
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64SessionPath,
  vibe64SessionEventMatchesScope
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  normalizeConversationTurn as normalizeSharedConversationTurn
} from "@jskit-ai/assistant-core/shared/conversation";
import {
  normalizeVibe64ConversationAttachments
} from "@local/vibe64-runtime/shared";

const CONVERSATION_LOG_REALTIME_REASONS = new Set([
  "project-message-changed",
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

function sessionAgentTurnActive(session = {}) {
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

// Main chat's product view over its supplied JSKIT conversation binding: the
// binding owns reads, live output and recovery; this adds Vibe64's pending
// turn, integration actions and completion reconciliation.
function useVibe64ConversationLog({
  active = true,
  projectSlug: projectSlugInput,
  sessionsApiPath: sessionsApiPathInput,
  session,
  conversation
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
  const turns = computed(() => conversationTurnsWithPending(conversation.turns.value, sessionAgentTurnActive(currentSession.value)));
  const integrationActions = useConversationIntegrationActions({ turns, enabled, sessionId, projectSlug,
    sessionsApiPath, reloadConversationLog: conversation.reload, httpClient });
  // Product completion remains an independent reconciliation signal when a
  // native notification is missed. The supplied binding still owns the read.
  let realtimeCompletionKey = "";
  const realtime = useRealtimeEvent({ enabled, event: VIBE64_SESSION_CHANGED_EVENT,
    matches: context => (["session-assistant-selection-updated", "integration-setup-skipped", "integration-setup-completed"]
      .includes(context?.payload?.reason) || conversationLogCompletedTurnKey(context?.payload)) &&
      conversationLogRealtimeShouldRefresh(context, sessionId.value) &&
      vibe64SessionEventMatchesScope(context?.payload, { projectSlug: projectSlug.value }),
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

export {
  conversationLogCompletedTurnKey,
  conversationLogRealtimeShouldRefresh,
  normalizeConversationLog,
  sessionAgentTurnActive,
  useVibe64ConversationLog
};
