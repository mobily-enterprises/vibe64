import { computed, proxyRefs, reactive, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { useStoredSelection } from "@/composables/useStoredSelection.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  selectedSessionStorageKey,
  vibe64SessionQueryKey,
  vibe64SessionsQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  CAPABILITIES_ENDPOINT,
  VIBE64_CONNECTIONS_CHANGED_EVENT,
  VIBE64_PROJECT_CHANGED_EVENT,
  capabilitiesQueryKey
} from "@/lib/studioGateApi.js";
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
import {
  vibe64RealtimeOriginPayload
} from "@/lib/vibe64BrowserTabOrigin.js";

const SESSION_LIST_IGNORED_REALTIME_REASONS = new Set([
  "codex-app-server-ready",
  "codex-app-server-agent-result",
  "codex-app-server-agent-result-invalid",
  "codex-app-server-agent-result-missing",
  "codex-app-server-agent-result-provider-failed",
  "codex-app-server-blocked",
  "codex-app-server-failed",
  "codex-app-server-prompt-injected",
  "codex-app-server-reasoning-summary",
  "codex-app-server-running",
  "codex-app-server-terminal-assistant-message",
  "codex-app-server-terminal-user-message",
  "codex-app-server-turn-claimed",
  "codex-app-server-turn-finalizing",
  "codex-app-server-turn-state",
  "codex-prompt-injected",
  "codex-context-replaced",
  "codex-terminal-started",
  "codex-terminal-closed",
  "command-terminal-started",
  "command-terminal-closed",
  "session-action-run",
  "session-advanced",
  "session-agent-control-returned",
  "session-intent-run",
  "session-rewound",
  "session-step-recovered",
  "session-worktree-recovered",
  "launch-target-started",
  "launch-target-ready",
  "launch-target-closed",
  "launch-target-stopped",
  "shell-terminal-closed"
]);
const SELECTED_SESSION_IGNORED_REALTIME_REASONS = new Set([
  "codex-app-server-prompt-injected",
  "codex-app-server-ready",
  "codex-app-server-reasoning-summary",
  "codex-app-server-running",
  "codex-app-server-terminal-assistant-message",
  "codex-app-server-terminal-user-message",
  "codex-context-replaced",
  "codex-prompt-injected",
  "launch-target-started",
  "launch-target-ready",
  "launch-target-closed",
  "launch-target-stopped"
]);

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

function sessionRevisionNumber(session = null) {
  const revision = Number(session?.revision);
  return Number.isFinite(revision) ? revision : null;
}

function sessionRecordHasRuntimeProjection(session = null) {
  return Boolean(
    session?.presentation &&
    typeof session.presentation === "object" &&
    !Array.isArray(session.presentation)
  );
}

function sessionRecordHasComposerMenuProjection(session = null) {
  return Array.isArray(session?.presentation?.composerMenu?.items);
}

function sessionPromptWaitingForAgent(session = null) {
  const prompt = session?.presentation?.prompt;
  return Boolean(
    prompt &&
    typeof prompt === "object" &&
    !Array.isArray(prompt) &&
    (
      prompt.state === "waiting_for_agent" ||
      prompt.status === "waiting_for_agent"
    )
  );
}

function sessionRecordHasActiveCodexWork(session = null) {
  return Boolean(
    session?.codexAgentTurnActive ||
    session?.codexAgentTurn?.active ||
    sessionPromptWaitingForAgent(session) ||
    String(session?.stepMachine?.status || "") === "awaiting_agent_result" ||
    String(session?.presentation?.step?.status || "") === "awaiting_agent_result"
  );
}

function sessionRecordMatchesId(session = null, sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  return Boolean(
    normalizedSessionId &&
    session?.sessionId === normalizedSessionId &&
    session?.ok !== false
  );
}

function rememberSessionDetailRecord(detailRecordsById = {}, session = null) {
  if (
    !session?.sessionId ||
    session?.ok === false ||
    !sessionRecordHasRuntimeProjection(session)
  ) {
    return false;
  }
  detailRecordsById[session.sessionId] = session;
  return true;
}

function sessionDetailRecordForId(
  detailRecordsById = {},
  sessionId = "",
  liveDetailSession = null
) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!normalizedSessionId) {
    return null;
  }
  if (sessionRecordMatchesId(liveDetailSession, normalizedSessionId)) {
    return liveDetailSession;
  }
  const cachedSession = detailRecordsById?.[normalizedSessionId] || null;
  return sessionRecordMatchesId(cachedSession, normalizedSessionId) ? cachedSession : null;
}

function selectedSessionRecord(detailSession = null, listSession = null, selectedSessionId = "") {
  const normalizedSessionId = String(selectedSessionId || "").trim();
  const listSessionMatches = Boolean(
    normalizedSessionId &&
    listSession?.sessionId === normalizedSessionId &&
    listSession?.ok !== false
  );
  if (
    normalizedSessionId &&
    detailSession?.sessionId === normalizedSessionId &&
    detailSession?.ok !== false
  ) {
    const detailRevision = sessionRevisionNumber(detailSession);
    const listRevision = sessionRevisionNumber(listSession);
    if (listSessionMatches && listRevision !== null && detailRevision !== null && listRevision > detailRevision) {
      if (
        sessionRecordHasRuntimeProjection(detailSession) &&
        !sessionRecordHasRuntimeProjection(listSession)
      ) {
        return detailSession;
      }
      if (
        sessionRecordHasComposerMenuProjection(detailSession) &&
        !sessionRecordHasComposerMenuProjection(listSession)
      ) {
        return detailSession;
      }
      if (
        sessionRecordHasActiveCodexWork(detailSession) &&
        !sessionRecordHasRuntimeProjection(listSession)
      ) {
        return detailSession;
      }
      return listSession;
    }
    return detailSession;
  }
  return listSession;
}

function selectedSessionDetailRefreshReason(detailSession = null, listSession = null, selectedSessionId = "") {
  const normalizedSessionId = String(selectedSessionId || "").trim();
  if (
    !sessionRecordMatchesId(detailSession, normalizedSessionId) ||
    !sessionRecordMatchesId(listSession, normalizedSessionId)
  ) {
    return "";
  }
  if (
    sessionRecordHasRuntimeProjection(detailSession) &&
    !sessionRecordHasComposerMenuProjection(detailSession)
  ) {
    return "detail_missing_composer_menu";
  }
  const detailRevision = sessionRevisionNumber(detailSession);
  const listRevision = sessionRevisionNumber(listSession);
  if (
    listRevision !== null &&
    detailRevision !== null &&
    listRevision > detailRevision &&
    sessionRecordHasRuntimeProjection(detailSession) &&
    !sessionRecordHasRuntimeProjection(listSession)
  ) {
    return "newer_summary_without_runtime_projection";
  }
  return "";
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

function sessionChangedReason(payload = {}) {
  return String(payload?.reason || "").trim();
}

function sessionListRefreshRequested(payload = {}) {
  return payload?.clientRefresh?.includeList === true;
}

function sessionListRealtimeShouldRefresh({ payload = {} } = {}) {
  if (sessionListRefreshRequested(payload)) {
    return true;
  }
  const reason = sessionChangedReason(payload);
  return !reason || !SESSION_LIST_IGNORED_REALTIME_REASONS.has(reason);
}

function selectedSessionRealtimeShouldRefresh({ payload = {} } = {}, selectedSessionId = "") {
  const changedSessionId = String(payload.sessionId || payload.entityId || "").trim();
  if (!changedSessionId || changedSessionId !== String(selectedSessionId || "").trim()) {
    return false;
  }
  const reason = sessionChangedReason(payload);
  return !reason || !SELECTED_SESSION_IGNORED_REALTIME_REASONS.has(reason);
}

function refetchEndpointResource(resource) {
  if (typeof resource?.query?.refetch === "function") {
    return resource.query.refetch({
      cancelRefetch: false
    });
  }
  return resource?.reload?.();
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
  const capabilitiesApiPath = computed(() => CAPABILITIES_ENDPOINT);
  const selectedSessionPath = computed(() => {
    const sessionId = String(selectedSessionId.value || "").trim();
    return sessionId ? `${sessionsApiPath.value}/${encodeURIComponent(sessionId)}` : "";
  });
  const selectedSessionQueryKey = computed(() => [
    ...vibe64SessionQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, projectSlug.value),
    String(selectedSessionId.value || "").trim()
  ]);

  const sessionListResource = useEndpointResource({
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
    queryOptions: {
      refetchOnMount: false,
      refetchOnWindowFocus: false
    },
    requestRecoveryLabel: "Vibe64 sessions",
    realtime: {
      event: VIBE64_SESSION_CHANGED_EVENT,
      matches: sessionListRealtimeShouldRefresh
    }
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
  const createSessionCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildRawPayload: (_model, { context }) => {
      const workflowDefinition = String(context?.workflowDefinition || "").trim();
      return vibe64RealtimeOriginPayload(workflowDefinition ? { workflowDefinition } : {});
    },
    fallbackRunError: "Vibe64 session could not be created.",
    messages: {
      error: "Vibe64 session could not be created.",
      success: "Vibe64 session created."
    },
    onRunSuccess: async (response) => {
      if (response?.sessionId) {
        selectSessionId(response.sessionId);
      }
      await refreshSessionData({
        includeList: true,
        reason: "create-session"
      });
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.create",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
  const selectedSessionResource = useEndpointResource({
    enabled: computed(() => Boolean(selectedSessionId.value)),
    fallbackLoadError: "Vibe64 session could not be loaded.",
    path: selectedSessionPath,
    queryKey: selectedSessionQueryKey,
    readMethod: "GET",
    queryOptions: {
      refetchOnMount: false,
      refetchOnWindowFocus: false
    },
    requestRecoveryLabel: "Vibe64 session",
    realtime: {
      event: VIBE64_SESSION_CHANGED_EVENT,
      matches: ({ payload = {} } = {}) => {
        return selectedSessionRealtimeShouldRefresh({
          payload
        }, selectedSessionId.value);
      }
    },
    refreshOnPull: true
  });
  const capabilitiesResource = useEndpointResource({
    fallbackLoadError: "Studio capabilities could not be loaded.",
    path: capabilitiesApiPath,
    queryKey: computed(() => capabilitiesQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, projectSlug.value)),
    queryOptions: {
      refetchOnMount: false,
      refetchOnWindowFocus: false
    },
    readMethod: "GET",
    requestRecoveryLabel: "Studio capabilities",
    realtime: {
      events: [
        VIBE64_CONNECTIONS_CHANGED_EVENT,
        VIBE64_PROJECT_CHANGED_EVENT
      ]
    },
    refreshOnPull: true
  });
  const selectedSessionView = proxyRefs({
    loadError: selectedSessionResource.loadError,
    record: computed(() => selectedSessionResource.data.value || null),
    refresh: selectedSessionResource.reload
  });
  const sessionDetailRecordsById = reactive({});

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
  const selectedDetailSession = computed(() => sessionDetailRecordForId(
    sessionDetailRecordsById,
    selectedSessionId.value,
    selectedSessionView.record
  ));
  const selectedRawSession = computed(() => {
    return selectedSessionRecord(
      selectedDetailSession.value,
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
  const capabilitiesDebugState = computed(() => {
    const payload = capabilitiesResource.data.value || {};
    const connections = payload.connections && typeof payload.connections === "object" && !Array.isArray(payload.connections)
      ? payload.connections
      : {};
    const aiConnection = connections.ai && typeof connections.ai === "object" && !Array.isArray(connections.ai)
      ? connections.ai
      : {};
    const githubConnection = connections.github && typeof connections.github === "object" && !Array.isArray(connections.github)
      ? connections.github
      : {};
    return {
      aiReady: aiConnection.ready === true,
      canCreateSession: canCreateSession.value,
      capabilitiesLoaded: Boolean(payload.capabilities),
      createSessionCapabilityEnabled: createSessionCapability.value?.enabled === true,
      createSessionCapabilityReason: String(createSessionCapability.value?.reason || ""),
      createSessionMode: createSessionMode.value,
      createSessionTitle: createSessionTitle.value,
      creationCanCreate: typeof creationOptions.value.canCreate === "boolean" ? creationOptions.value.canCreate : null,
      creationDisabledReason: String(creationOptions.value.disabledReason || ""),
      githubReady: githubConnection.ready === true,
      isFetching: Boolean(capabilitiesResource.isFetching.value),
      isLoading: Boolean(capabilitiesResource.isLoading.value),
      loadError: String(capabilitiesResource.loadError.value || ""),
      maxOpenSessions: limits.value.maxOpenSessions,
      openSessionCount: limits.value.openSessionCount,
      projectSlug: String(projectSlug.value || ""),
      selectedProviderId: String(aiConnection.selectedProviderId || "")
    };
  });
  const selectedSessionTitle = computed(() => {
    return vibe64SessionDisplayTitle(selectedSession.value || {}) ||
      `Session ${shortSessionId(selectedSessionId.value)}`;
  });
  const timelineSteps = computed(() => buildVibe64TimelineSteps(selectedSession.value));
  const sessionFacts = computed(() => vibe64SessionFacts(selectedSession.value || {}));
  const selectedDetailRefreshState = computed(() => {
    const detailSession = selectedDetailSession.value;
    const listSession = selectedListSession.value;
    const reason = selectedSessionDetailRefreshReason(
      detailSession,
      listSession,
      selectedSessionId.value
    );
    return {
      detailRevision: sessionRevisionNumber(detailSession),
      fetching: Boolean(selectedSessionResource.isFetching?.value),
      listRevision: sessionRevisionNumber(listSession),
      reason,
      selectedSessionId: String(selectedSessionId.value || "")
    };
  });

  function sessionForId(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      return null;
    }
    if (normalizedSessionId === selectedSessionId.value && selectedRawSession.value) {
      return enrichVibe64SessionForDisplay(selectedRawSession.value);
    }
    const detailSession = sessionDetailRecordForId(
      sessionDetailRecordsById,
      normalizedSessionId,
      selectedSessionView.record
    );
    const listSession = sessions.value.find((session) => session.sessionId === normalizedSessionId) || null;
    return enrichVibe64SessionForDisplay(
      selectedSessionRecord(detailSession, listSession, normalizedSessionId)
    );
  }

  async function refreshSelectedSession() {
    if (!selectedSessionId.value) {
      return null;
    }
    return refetchEndpointResource(selectedSessionResource);
  }

  async function refreshSessionList() {
    return refetchEndpointResource(sessionListResource);
  }

  let refreshSessionDataInFlight = null;
  let refreshSessionDataQueuedIncludeList = false;

  async function runSessionDataRefresh({
    includeList = false,
    reason = ""
  } = {}) {
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("client.sessionData.refresh.start", {
      includeList: includeList === true,
      reason: String(reason || ""),
      selectedSessionId: String(selectedSessionId.value || "")
    });
    try {
      const result = await Promise.all(
        [
          includeList ? refreshSessionList() : null,
          refreshSelectedSession()
        ].filter(Boolean)
      );
      vibe64SessionDebugLog("client.sessionData.refresh.done", {
        ...vibe64SessionDebugSummary(selectedSession.value || {}),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        includeList: includeList === true,
        reason: String(reason || ""),
        selectedSessionId: String(selectedSessionId.value || ""),
        sessionCount: sessions.value.length
      });
      return result;
    } catch (error) {
      vibe64SessionDebugLog("client.sessionData.refresh.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        includeList: includeList === true,
        reason: String(reason || ""),
        selectedSessionId: String(selectedSessionId.value || "")
      });
      throw error;
    }
  }

  async function refreshSessionData(options = {}) {
    const reason = typeof options === "string" ? options : String(options?.reason || "");
    const includeList = typeof options === "object" && options?.includeList === true;
    const queueIfInFlight = typeof options === "object" && options?.queueIfInFlight === true;
    if (refreshSessionDataInFlight) {
      refreshSessionDataQueuedIncludeList = refreshSessionDataQueuedIncludeList || includeList || queueIfInFlight;
      vibe64SessionDebugLog("client.sessionData.refresh.join", {
        includeList,
        queueIfInFlight,
        reason,
        selectedSessionId: String(selectedSessionId.value || "")
      });
      return refreshSessionDataInFlight;
    }

    refreshSessionDataInFlight = runSessionDataRefresh({
      includeList,
      reason
    });
    try {
      return await refreshSessionDataInFlight;
    } finally {
      refreshSessionDataInFlight = null;
      if (refreshSessionDataQueuedIncludeList) {
        refreshSessionDataQueuedIncludeList = false;
        void refreshSessionData({
          includeList: true,
          reason: "coalesced-trailing"
        });
      }
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

  watch(() => selectedSessionView.record, (session) => {
    rememberSessionDetailRecord(sessionDetailRecordsById, session);
  }, {
    immediate: true
  });

  let selectedDetailRefreshKey = "";
  watch(selectedDetailRefreshState, (state) => {
    if (!state.reason) {
      selectedDetailRefreshKey = "";
      return;
    }
    if (state.fetching) {
      return;
    }
    const refreshKey = [
      state.selectedSessionId,
      state.reason,
      state.detailRevision ?? "",
      state.listRevision ?? ""
    ].join("|");
    if (refreshKey === selectedDetailRefreshKey) {
      return;
    }
    selectedDetailRefreshKey = refreshKey;
    vibe64SessionDebugLog("client.sessionData.selectedSession.detailRefresh", {
      detailRevision: state.detailRevision,
      listRevision: state.listRevision,
      reason: state.reason,
      selectedSessionId: state.selectedSessionId
    });
    void refreshSelectedSession();
  }, {
    flush: "post",
    immediate: true
  });

  watch(capabilitiesDebugState, (state) => {
    vibe64SessionDebugLog("client.sessionData.capabilities.changed", state);
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
  rememberSessionDetailRecord,
  sessionDetailRecordForId,
  sessionRecordHasActiveCodexWork,
  sessionListRealtimeShouldRefresh,
  selectedSessionRealtimeShouldRefresh,
  selectedSessionRecord,
  selectedSessionDetailRefreshReason,
  sessionIdExistsInList,
  sessionRevisionNumber,
  shouldPreserveSelectedSessionDuringRefresh,
  useVibe64SessionData
};
