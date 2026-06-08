import { computed, proxyRefs, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { useStoredSelection } from "@/composables/useStoredSelection.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  selectedSessionStorageKey,
  vibe64SessionQueryKey,
  vibe64SessionsQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  CAPABILITIES_ENDPOINT,
  capabilitiesQueryKey
} from "@/lib/studioGateApi.js";
import {
  studioHttpClient
} from "@/lib/studioHttp.js";
import {
  vibe64SessionFacts,
  vibe64SessionLimits,
  buildVibe64TimelineSteps,
  enrichVibe64SessionForDisplay,
  shortVibe64SessionId as shortSessionId,
  visibleVibe64Sessions
} from "@/lib/vibe64SessionPanelModel.js";
import {
  vibe64SessionDisplayTitle,
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel,
  isClosedVibe64Session
} from "@/lib/vibe64SessionViewModel.js";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
} from "@/lib/vibe64SessionDebugLog.js";

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

function sessionIdExistsInList(sessionId = "", nextSessions = []) {
  const normalizedSessionId = String(sessionId || "").trim();
  return Boolean(normalizedSessionId) && nextSessions.some((session) => session.sessionId === normalizedSessionId);
}

function shouldPreserveSelectedSessionDuringRefresh({
  createSessionRunning = false,
  currentSessionId = "",
  nextSessions = [],
  selectedSessionLoading = false,
  sessionListLoading = false
} = {}) {
  const normalizedSessionId = String(currentSessionId || "").trim();
  if (!normalizedSessionId || sessionIdExistsInList(normalizedSessionId, nextSessions)) {
    return false;
  }
  return Boolean(
    sessionListLoading ||
    createSessionRunning ||
    selectedSessionLoading
  );
}

function useVibe64SessionData({
  onTitleChange = null
} = {}) {
  const notifyTitleChange = typeof onTitleChange === "function" ? onTitleChange : () => null;
  const projectSlug = useVibe64ProjectSlug();
  const paths = usePaths();
  const sessionSelection = useStoredSelection({
    storageKey: computed(() => selectedSessionStorageKey(projectSlug.value))
  });

  const selectedSessionId = sessionSelection.selectedId;
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const selectedSessionPath = computed(() => {
    const sessionId = String(selectedSessionId.value || "").trim();
    return sessionId ? `${sessionsApiPath.value}/${encodeURIComponent(sessionId)}` : "";
  });
  const selectedSessionQueryKey = computed(() => [
    ...vibe64SessionQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, projectSlug.value),
    String(selectedSessionId.value || "").trim()
  ]);

  const sessionListResource = useEndpointResource({
    client: studioHttpClient,
    fallbackLoadError: "Vibe64 sessions could not be loaded.",
    path: sessionsApiPath,
    queryKey: computed(() => vibe64SessionsQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      projectSlug.value
    )),
    readQuery: {
      limit: 20
    },
    realtime: {
      event: VIBE64_SESSION_CHANGED_EVENT
    },
    queryOptions: {
      refetchOnMount: false,
      refetchOnWindowFocus: false
    },
  });
  const sessionList = proxyRefs({
    items: computed(() => {
      const payload = sessionListResource.data.value || {};
      return Array.isArray(payload.sessions) ? payload.sessions : [];
    }),
    loadError: sessionListResource.loadError,
    isInitialLoading: sessionListResource.isInitialLoading,
    isLoading: sessionListResource.isLoading,
    pages: computed(() => {
      const payload = sessionListResource.data.value;
      return payload && typeof payload === "object" && !Array.isArray(payload) ? [payload] : [];
    }),
    reload: sessionListResource.reload,
    resource: sessionListResource
  });
  const createSessionRunning = ref(false);
  const createSessionMessage = ref("");
  const createSessionMessageType = ref("");
  const createSessionCommand = proxyRefs({
    isRunning: createSessionRunning,
    message: createSessionMessage,
    messageType: createSessionMessageType,
    async run(context = {}) {
      if (createSessionRunning.value) {
        return null;
      }
      createSessionRunning.value = true;
      createSessionMessage.value = "";
      createSessionMessageType.value = "";
      try {
        const workflowDefinition = String(context?.workflowDefinition || "").trim();
        const response = await studioHttpClient.post(
          sessionsApiPath.value,
          workflowDefinition ? { workflowDefinition } : {},
          LOCAL_STUDIO_COMMAND_OPTIONS
        );
        if (response?.sessionId) {
          selectSessionId(response.sessionId);
        }
        await refreshSessionData();
        createSessionMessage.value = "Vibe64 session created.";
        createSessionMessageType.value = "success";
        return response;
      } catch (error) {
        createSessionMessage.value = String(error?.message || error || "Vibe64 session could not be created.");
        createSessionMessageType.value = "error";
        throw error;
      } finally {
        createSessionRunning.value = false;
      }
    }
  });
  const selectedSessionResource = useEndpointResource({
    client: studioHttpClient,
    enabled: computed(() => Boolean(selectedSessionId.value)),
    fallbackLoadError: "Vibe64 session could not be loaded.",
    path: selectedSessionPath,
    queryKey: selectedSessionQueryKey,
    readMethod: "GET",
    queryOptions: {
      refetchOnMount: false,
      refetchOnWindowFocus: false
    },
    refreshOnPull: true,
    realtime: {
      event: VIBE64_SESSION_CHANGED_EVENT,
      matches: ({ payload = {} } = {}) => {
        const changedSessionId = String(payload.sessionId || payload.entityId || "").trim();
        return Boolean(changedSessionId) && changedSessionId === selectedSessionId.value;
      }
    }
  });
  const capabilitiesResource = useEndpointResource({
    client: studioHttpClient,
    fallbackLoadError: "Studio capabilities could not be loaded.",
    path: CAPABILITIES_ENDPOINT,
    queryKey: computed(() => capabilitiesQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, projectSlug.value)),
    queryOptions: {
      refetchOnMount: false,
      refetchOnWindowFocus: false
    },
    readMethod: "GET",
    refreshOnPull: true
  });
  const selectedSessionView = proxyRefs({
    loadError: selectedSessionResource.loadError,
    record: computed(() => selectedSessionResource.data.value || null),
    refresh: selectedSessionResource.reload
  });

  const sessions = computed(() => visibleVibe64Sessions(sessionList.items || []));
  const studioCapabilities = computed(() => {
    const capabilities = capabilitiesResource.data.value?.capabilities;
    return capabilities && typeof capabilities === "object" && !Array.isArray(capabilities)
      ? capabilities
      : {};
  });
  const createSessionCapability = computed(() => {
    const createSession = studioCapabilities.value.createSession;
    return createSession && typeof createSession === "object" && !Array.isArray(createSession)
      ? createSession
      : null;
  });
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
  const selectedSession = computed(() => enrichVibe64SessionForDisplay(selectedRawSession.value));
  const isSelectedSessionClosed = computed(() => isClosedVibe64Session(selectedSession.value || {}));
  const pageLoading = computed(() => Boolean(sessionList.isLoading));
  const limits = computed(() => vibe64SessionLimits({
    payloadLimits: sessionList.pages?.[0]?.limits || {},
    sessions: sessions.value
  }));
  const canCreateSession = computed(() => {
    if (createSessionCapability.value?.enabled === false) {
      return false;
    }
    if (typeof creationOptions.value.canCreate === "boolean") {
      return creationOptions.value.canCreate;
    }
    return limits.value.openSessionCount < limits.value.maxOpenSessions;
  });
  const createSessionTitle = computed(() => {
    if (createSessionCapability.value?.enabled === false && createSessionCapability.value.reason) {
      return String(createSessionCapability.value.reason);
    }
    if (creationOptions.value.disabledReason) {
      return String(creationOptions.value.disabledReason);
    }
    if (limits.value.openSessionCount >= limits.value.maxOpenSessions) {
      return `Studio allows up to ${limits.value.maxOpenSessions} active sessions.`;
    }
    return "Create a new Vibe64 session";
  });
  const selectedSessionTitle = computed(() => {
    return vibe64SessionDisplayTitle(selectedSession.value || {}) ||
      `Session ${shortSessionId(selectedSessionId.value)}`;
  });
  const timelineSteps = computed(() => buildVibe64TimelineSteps(selectedSession.value));
  const sessionFacts = computed(() => vibe64SessionFacts(selectedSession.value || {}));

  function sessionForId(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      return null;
    }
    if (normalizedSessionId === selectedSessionId.value && selectedRawSession.value) {
      return enrichVibe64SessionForDisplay(selectedRawSession.value);
    }
    return enrichVibe64SessionForDisplay(
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
    vibe64SessionDebugLog("client.sessionData.refresh.start", {
      selectedSessionId: String(selectedSessionId.value || "")
    });
    try {
      const result = await Promise.all([
        sessionList.reload(),
        refreshSelectedSession()
      ]);
      vibe64SessionDebugLog("client.sessionData.refresh.done", {
        ...vibe64SessionDebugSummary(selectedSession.value || {}),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        selectedSessionId: String(selectedSessionId.value || ""),
        sessionCount: sessions.value.length
      });
      return result;
    } catch (error) {
      vibe64SessionDebugLog("client.sessionData.refresh.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        selectedSessionId: String(selectedSessionId.value || "")
      });
      throw error;
    }
  }

  function selectSessionId(sessionId = "") {
    vibe64SessionDebugLog("client.sessionData.selectSession", {
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
    vibe64SessionDebugLog("client.sessionData.createSession.start", {
      workflowDefinition: String(workflowDefinition || "")
    });
    try {
      const response = await createSessionCommand.run({
        workflowDefinition
      });
      vibe64SessionDebugLog("client.sessionData.createSession.done", {
        ...vibe64SessionDebugSummary(response || {}),
        code: String(response?.code || response?.errors?.[0]?.code || ""),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        ok: response?.ok !== false,
        workflowDefinition: String(workflowDefinition || "")
      });
      return response;
    } catch (error) {
      vibe64SessionDebugLog("client.sessionData.createSession.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        workflowDefinition: String(workflowDefinition || "")
      });
      throw error;
    }
  }

  const selectionReconciliationState = computed(() => {
    const nextSessions = sessions.value;
    return {
      createSessionRunning: createSessionCommand.isRunning,
      nextSessions,
      selectedSessionId: String(selectedSessionId.value || ""),
      selectedSessionLoading: Boolean(selectedSessionResource.isLoading?.value),
      sessionIds: nextSessions.map((session) => session.sessionId).join("|"),
      sessionListInitialLoading: sessionList.isInitialLoading,
      sessionListLoading: sessionList.isLoading
    };
  });

  watch(selectionReconciliationState, (state) => {
    const nextSessions = state.nextSessions;
    vibe64SessionDebugLog("client.sessionData.sessions.changed", {
      selectedSessionId: String(selectedSessionId.value || ""),
      sessionCount: nextSessions.length
    });
    if (
      state.sessionListInitialLoading ||
      shouldPreserveSelectedSessionDuringRefresh({
        createSessionRunning: state.createSessionRunning,
        currentSessionId: state.selectedSessionId,
        nextSessions,
        selectedSessionLoading: state.selectedSessionLoading,
        sessionListLoading: state.sessionListLoading
      })
    ) {
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
    vibe64SessionDebugLog("client.sessionData.selectedSession.state", {
      ...vibe64SessionDebugSummary(session),
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
    capabilities: capabilitiesResource.data,
    capabilitiesResource,
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
    statusColor: vibe64SessionStatusColor,
    statusLabel: vibe64SessionStatusLabel,
    timelineSteps,
    workflowDefinitions
  };
}

export {
  selectedSessionRecord,
  sessionIdExistsInList,
  shouldPreserveSelectedSessionDuringRefresh,
  useVibe64SessionData
};
