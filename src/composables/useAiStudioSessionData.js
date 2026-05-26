import { computed, proxyRefs, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { useList } from "@jskit-ai/users-web/client/composables/useList";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { useStoredSelection } from "@/composables/useStoredSelection.js";
import {
  AI_STUDIO_SESSION_CHANGED_EVENT,
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  SELECTED_SESSION_STORAGE_KEY,
  aiStudioSessionQueryKey,
  aiStudioSessionsQueryKey
} from "@/lib/aiStudioSessionRequestConfig.js";
import {
  aiStudioSessionFacts,
  aiStudioSessionLimits,
  buildAiStudioTimelineSteps,
  enrichAiStudioSessionForDisplay,
  shortAiStudioSessionId as shortSessionId,
  visibleAiStudioSessions
} from "@/lib/aiStudioSessionPanelModel.js";
import {
  aiStudioSessionDisplayTitle,
  aiStudioSessionStatusColor,
  aiStudioSessionStatusLabel,
  isClosedAiStudioSession
} from "@/lib/aiStudioSessionViewModel.js";
import {
  aiStudioSessionDebugDurationMs,
  aiStudioSessionDebugError,
  aiStudioSessionDebugLog,
  aiStudioSessionDebugSummary
} from "@/lib/aiStudioSessionDebugLog.js";

function selectedSessionOperationSummary(session = {}) {
  const operation = session?.presentation?.auto?.nextOperation;
  const source = operation && typeof operation === "object" && !Array.isArray(operation)
    ? operation
    : {};
  return {
    operationActionId: String(source.actionId || ""),
    operationExecutable: source.executable === true,
    operationId: String(source.id || ""),
    operationIntentId: String(source.intentId || ""),
    operationKind: String(source.kind || ""),
    operationRoute: String(source.route || "")
  };
}

function selectedSessionRecord(detailSession = null, listSession = null, selectedSessionId = "") {
  const normalizedSessionId = String(selectedSessionId || "").trim();
  if (
    normalizedSessionId &&
    detailSession?.sessionId === normalizedSessionId &&
    detailSession?.ok !== false
  ) {
    return detailSession;
  }
  return listSession;
}

function useAiStudioSessionData({
  onTitleChange = null
} = {}) {
  const notifyTitleChange = typeof onTitleChange === "function" ? onTitleChange : () => null;
  const paths = usePaths();
  const sessionSelection = useStoredSelection({
    storageKey: SELECTED_SESSION_STORAGE_KEY
  });

  const selectedSessionId = sessionSelection.selectedId;
  const sessionsApiPath = computed(() => paths.api(AI_STUDIO_SESSIONS_API_SUFFIX, {
    surface: AI_STUDIO_SURFACE_ID
  }));
  const selectedSessionPath = computed(() => {
    const sessionId = String(selectedSessionId.value || "").trim();
    return sessionId ? `${sessionsApiPath.value}/${encodeURIComponent(sessionId)}` : "";
  });
  const selectedSessionQueryKey = computed(() => [
    ...aiStudioSessionQueryKey(AI_STUDIO_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC),
    String(selectedSessionId.value || "").trim()
  ]);

  const sessionList = useList({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    fallbackLoadError: "AI Studio sessions could not be loaded.",
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.sessions.list",
    queryKeyFactory: aiStudioSessionsQueryKey,
    realtime: {
      event: AI_STUDIO_SESSION_CHANGED_EVENT
    },
    selectItems: (payload) => Array.isArray(payload?.sessions) ? payload.sessions : [],
    surfaceId: AI_STUDIO_SURFACE_ID
  });

  const createSessionCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildRawPayload: (_model, { context }) => {
      const workflowDefinition = String(context?.workflowDefinition || "").trim();
      return workflowDefinition ? { workflowDefinition } : {};
    },
    buildCommandOptions: () => ({
      options: LOCAL_STUDIO_COMMAND_OPTIONS
    }),
    fallbackRunError: "AI Studio session could not be created.",
    messages: {
      error: "AI Studio session could not be created.",
      success: "AI Studio session created."
    },
    onRunSuccess: async (response) => {
      if (response?.sessionId) {
        selectSessionId(response.sessionId);
      }
      await refreshSessionData();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.sessions.create",
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "POST"
  });
  const selectedSessionResource = useEndpointResource({
    enabled: computed(() => Boolean(selectedSessionId.value)),
    fallbackLoadError: "AI Studio session could not be loaded.",
    path: selectedSessionPath,
    queryKey: selectedSessionQueryKey,
    readMethod: "GET",
    refreshOnPull: true,
    realtime: {
      event: AI_STUDIO_SESSION_CHANGED_EVENT,
      matches: ({ payload = {} } = {}) => {
        const changedSessionId = String(payload.sessionId || payload.entityId || "").trim();
        return Boolean(changedSessionId) && changedSessionId === selectedSessionId.value;
      }
    }
  });
  const selectedSessionView = proxyRefs({
    loadError: selectedSessionResource.loadError,
    record: computed(() => selectedSessionResource.data.value || null),
    refresh: selectedSessionResource.reload
  });

  const sessions = computed(() => visibleAiStudioSessions(sessionList.items || []));
  const creationOptions = computed(() => sessionList.pages?.[0]?.creation || {});
  const workflowDefinitions = computed(() => {
    const definitions = creationOptions.value.workflowDefinitions;
    return Array.isArray(definitions) ? definitions : [];
  });
  const createSessionMode = computed(() => {
    return creationOptions.value.mode === "select" && workflowDefinitions.value.length > 0
      ? "select"
      : "direct";
  });
  const selectedListSession = computed(() => {
    return sessions.value.find((session) => session.sessionId === selectedSessionId.value) || null;
  });
  const selectedRawSession = computed(() => {
    return selectedSessionRecord(
      selectedSessionView.record,
      selectedListSession.value,
      selectedSessionId.value
    );
  });
  const selectedSession = computed(() => enrichAiStudioSessionForDisplay(selectedRawSession.value));
  const isSelectedSessionClosed = computed(() => isClosedAiStudioSession(selectedSession.value || {}));
  const pageLoading = computed(() => Boolean(sessionList.isLoading));
  const limits = computed(() => aiStudioSessionLimits({
    payloadLimits: sessionList.pages?.[0]?.limits || {},
    sessions: sessions.value
  }));
  const canCreateSession = computed(() => {
    if (typeof creationOptions.value.canCreate === "boolean") {
      return creationOptions.value.canCreate;
    }
    return limits.value.openSessionCount < limits.value.maxOpenSessions;
  });
  const createSessionTitle = computed(() => {
    if (creationOptions.value.disabledReason) {
      return String(creationOptions.value.disabledReason);
    }
    if (limits.value.openSessionCount >= limits.value.maxOpenSessions) {
      return `Studio allows up to ${limits.value.maxOpenSessions} active sessions.`;
    }
    return "Create a new AI Studio session";
  });
  const selectedSessionTitle = computed(() => {
    return aiStudioSessionDisplayTitle(selectedSession.value || {}) ||
      `Session ${shortSessionId(selectedSessionId.value)}`;
  });
  const timelineSteps = computed(() => buildAiStudioTimelineSteps(selectedSession.value));
  const sessionFacts = computed(() => aiStudioSessionFacts(selectedSession.value || {}));

  function sessionForId(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      return null;
    }
    if (normalizedSessionId === selectedSessionId.value && selectedRawSession.value) {
      return enrichAiStudioSessionForDisplay(selectedRawSession.value);
    }
    return enrichAiStudioSessionForDisplay(
      sessions.value.find((session) => session.sessionId === normalizedSessionId) || null
    );
  }

  async function refreshSelectedSession() {
    if (!selectedSessionId.value) {
      return null;
    }
    return selectedSessionView.refresh();
  }

  async function refreshSessionData() {
    const startedAtMs = Date.now();
    aiStudioSessionDebugLog("client.sessionData.refresh.start", {
      selectedSessionId: String(selectedSessionId.value || "")
    });
    try {
      const result = await Promise.all([
        sessionList.reload(),
        refreshSelectedSession()
      ]);
      aiStudioSessionDebugLog("client.sessionData.refresh.done", {
        ...aiStudioSessionDebugSummary(selectedSession.value || {}),
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
        selectedSessionId: String(selectedSessionId.value || ""),
        sessionCount: sessions.value.length
      });
      return result;
    } catch (error) {
      aiStudioSessionDebugLog("client.sessionData.refresh.error", {
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
        error: aiStudioSessionDebugError(error),
        selectedSessionId: String(selectedSessionId.value || "")
      });
      throw error;
    }
  }

  function selectSessionId(sessionId = "") {
    aiStudioSessionDebugLog("client.sessionData.selectSession", {
      fromSessionId: String(selectedSessionId.value || ""),
      toSessionId: String(sessionId || "")
    });
    sessionSelection.select(sessionId);
  }

  function clearSelectedSession() {
    sessionSelection.clear();
  }

  async function createSession(workflowDefinition = "") {
    const startedAtMs = Date.now();
    aiStudioSessionDebugLog("client.sessionData.createSession.start", {
      workflowDefinition: String(workflowDefinition || "")
    });
    try {
      const response = await createSessionCommand.run({
        workflowDefinition
      });
      aiStudioSessionDebugLog("client.sessionData.createSession.done", {
        ...aiStudioSessionDebugSummary(response || {}),
        code: String(response?.code || response?.errors?.[0]?.code || ""),
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
        ok: response?.ok !== false,
        workflowDefinition: String(workflowDefinition || "")
      });
      return response;
    } catch (error) {
      aiStudioSessionDebugLog("client.sessionData.createSession.error", {
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
        error: aiStudioSessionDebugError(error),
        workflowDefinition: String(workflowDefinition || "")
      });
      throw error;
    }
  }

  function sessionIdExistsInList(sessionId = "", nextSessions = []) {
    const normalizedSessionId = String(sessionId || "").trim();
    return Boolean(normalizedSessionId) && nextSessions.some((session) => session.sessionId === normalizedSessionId);
  }

  function shouldPreserveSelectedSessionDuringRefresh(nextSessions = []) {
    const currentSessionId = String(selectedSessionId.value || "").trim();
    if (!currentSessionId || sessionIdExistsInList(currentSessionId, nextSessions)) {
      return false;
    }
    return Boolean(
      sessionList.isLoading ||
      createSessionCommand.isRunning ||
      selectedSessionResource.isLoading?.value
    );
  }

  watch(sessions, (nextSessions) => {
    aiStudioSessionDebugLog("client.sessionData.sessions.changed", {
      selectedSessionId: String(selectedSessionId.value || ""),
      sessionCount: nextSessions.length
    });
    if (sessionList.isInitialLoading || shouldPreserveSelectedSessionDuringRefresh(nextSessions)) {
      return;
    }
    sessionSelection.selectAvailableId(nextSessions, {
      fallbackId: nextSessions.at(-1)?.sessionId || "",
      getId: (session) => session.sessionId
    });
  }, {
    immediate: true
  });

  watch(() => {
    const session = selectedSession.value || {};
    return [
      session.sessionId || "",
      session.currentStep || "",
      session.stepMachine?.status || "",
      session.next?.stepId || "",
      session.next?.enabled === true ? "next-enabled" : "next-disabled",
      session.presentation?.auto?.nextOperation?.id || "",
      session.presentation?.auto?.nextOperation?.executable === true ? "op-executable" : "op-idle"
    ].join("|");
  }, () => {
    const session = selectedSession.value || {};
    if (!session.sessionId) {
      return;
    }
    aiStudioSessionDebugLog("client.sessionData.selectedSession.state", {
      ...aiStudioSessionDebugSummary(session),
      ...selectedSessionOperationSummary(session)
    });
  }, {
    flush: "post",
    immediate: true
  });

  watch(selectedSessionTitle, (title) => {
    notifyTitleChange(title || "");
  }, {
    immediate: true
  });

  return {
    canCreateSession,
    clearSelectedSession,
    createSession,
    createSessionCommand,
    createSessionMode,
    createSessionTitle,
    isSelectedSessionClosed,
    pageLoading,
    refreshSessionData,
    selectSessionId,
    selectedSession,
    selectedSessionId,
    selectedSessionView,
    selectedSessionTitle,
    sessionForId,
    sessionFacts,
    sessionList,
    sessions,
    sessionsApiPath,
    shortSessionId,
    statusColor: aiStudioSessionStatusColor,
    statusLabel: aiStudioSessionStatusLabel,
    timelineSteps,
    workflowDefinitions
  };
}

export {
  selectedSessionRecord,
  useAiStudioSessionData
};
