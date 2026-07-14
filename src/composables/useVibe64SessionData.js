import { computed, onScopeDispose, proxyRefs, reactive, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  useVibe64SessionSelection
} from "@/composables/useVibe64SessionSelection.js";
import {
  VIBE64_CURRENT_SESSION_API_SUFFIX,
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64SessionQueryKey,
  vibe64SessionsQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  createVibe64CurrentSessionPublisher
} from "@/lib/vibe64CurrentSessionPublisher.js";
import {
  CAPABILITIES_ENDPOINT,
  VIBE64_CONNECTIONS_CHANGED_EVENT,
  VIBE64_PROJECT_CHANGED_EVENT,
  capabilitiesQueryKey
} from "@/lib/studioGateApi.js";
import {
  activeVibe64SeedSession,
  activeVibe64SeedSessionMessage,
  vibe64SessionFacts,
  vibe64SessionLimits,
  buildVibe64TimelineSteps,
  enrichVibe64SessionForDisplay,
  shortVibe64SessionId as shortSessionId,
  visibleVibe64Sessions
} from "@/lib/vibe64SessionPanelModel.js";
import {
  vibe64SessionDisplayTitle,
  vibe64SessionRevision as sessionRevisionNumber,
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
import {
  composerMenuProjectionFromRealtimePayload,
  rememberSessionComposerMenu,
  selectedSessionShouldLoadComposerMenu,
  sessionComposerMenuNeedsRefresh,
  sessionComposerMenuProjection,
  sessionRecordHasComposerMenuProjection,
  sessionWithCachedComposerMenu
} from "@/lib/vibe64SessionComposerMenuProjection.js";
import {
  agentTurnRealtimeOverlayFromPayload,
  sessionWithAgentTurnRealtimeOverlay
} from "@/lib/vibe64AgentTurnRealtimeOverlay.js";

const SESSION_LIST_IGNORED_REALTIME_REASONS = new Set([
  "assistant-response-bundle",
  "codex-app-server-ready",
  "codex-app-server-agent-result",
  "codex-app-server-agent-result-invalid",
  "codex-app-server-agent-result-missing",
  "codex-app-server-agent-result-provider-failed",
  "codex-app-server-blocked",
  "codex-app-server-failed",
  "codex-app-server-final-assistant-message",
  "codex-app-server-live-progress",
  "codex-app-server-prompt-injected",
  "codex-app-server-reasoning-summary",
  "codex-app-server-running",
  "codex-app-server-terminal-assistant-message",
  "codex-app-server-terminal-thinking-message",
  "codex-app-server-terminal-user-message",
  "codex-app-server-turn-active",
  "codex-app-server-turn-claimed",
  "codex-app-server-turn-finalizing",
  "codex-app-server-turn-idle",
  "codex-app-server-turn-state",
  "codex-app-server-message-delivered",
  "codex-prompt-injected",
  "codex-context-replaced",
  "agent-terminal-started",
  "agent-terminal-closed",
  "command-terminal-started",
  "command-terminal-closed",
  "session-action-run",
  "session-advanced",
  "session-agent-control-returned",
  "session-intent-run",
  "session-rewound",
  "session-step-recovered",
  "session-source-recovered",
  "launch-target-started",
  "launch-target-ready",
  "launch-target-closed",
  "launch-target-stopped"
]);
const SELECTED_SESSION_IGNORED_REALTIME_REASONS = new Set([
  "assistant-response-bundle",
  "codex-app-server-prompt-injected",
  "codex-app-server-ready",
  "codex-app-server-final-assistant-message",
  "codex-app-server-live-progress",
  "codex-app-server-reasoning-summary",
  "codex-app-server-running",
  "codex-app-server-terminal-assistant-message",
  "codex-app-server-terminal-thinking-message",
  "codex-app-server-terminal-user-message",
  "codex-app-server-turn-active",
  "codex-app-server-turn-claimed",
  "codex-app-server-turn-finalizing",
  "codex-app-server-turn-idle",
  "codex-app-server-turn-state",
  "codex-app-server-message-delivered",
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

function sessionRecordHasRuntimeProjection(session = null) {
  return Boolean(
    session?.presentation &&
    typeof session.presentation === "object" &&
    !Array.isArray(session.presentation)
  );
}

function sessionRecordHasActiveAgentWork(session = null) {
  return Boolean(
    session?.agentSession?.turn?.active ||
    session?.composerHandoff?.pending ||
    (Array.isArray(session?.composerMessages) && session.composerMessages.some((message) => (
      String(message?.state || "").trim() === "accepted"
    )))
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
        sessionRecordHasActiveAgentWork(detailSession) &&
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
    sessionRecordHasComposerMenuProjection(listSession) &&
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

function selectedSessionDetailLoadState({
  detailSession = null,
  fetching = false,
  listSession = null,
  loadError = "",
  loading = false,
  selectedSessionId = ""
} = {}) {
  const normalizedSessionId = String(selectedSessionId || "").trim();
  const hasDetail = sessionRecordMatchesId(detailSession, normalizedSessionId);
  const hasSummary = sessionRecordMatchesId(listSession, normalizedSessionId);
  const error = String(loadError || "").trim();
  if (!normalizedSessionId) {
    return {
      error: "",
      label: "",
      loading: false,
      ready: false,
      restoring: false,
      sessionId: "",
      state: "summaryOnly",
      suppressPassiveComposer: false
    };
  }
  if (error && !hasDetail) {
    return {
      error,
      label: "Session controls could not load.",
      loading: false,
      ready: false,
      restoring: false,
      sessionId: normalizedSessionId,
      state: "detailError",
      suppressPassiveComposer: false
    };
  }
  if (hasDetail) {
    return {
      error: "",
      label: "",
      loading: false,
      ready: true,
      refreshing: Boolean(fetching || loading),
      restoring: false,
      sessionId: normalizedSessionId,
      state: "detailReady",
      suppressPassiveComposer: false
    };
  }
  if (loading || fetching) {
    return {
      error: "",
      label: "Loading session controls...",
      loading: true,
      ready: false,
      restoring: false,
      sessionId: normalizedSessionId,
      state: "detailLoading",
      suppressPassiveComposer: true
    };
  }
  return {
    error: "",
    label: hasSummary ? "Session controls could not load." : "Loading session...",
    loading: false,
    ready: false,
    restoring: false,
    sessionId: normalizedSessionId,
    state: "summaryOnly",
    suppressPassiveComposer: !hasSummary
  };
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

function selectedSessionIdForCurrentAlias({
  createSessionRunning = false,
  selectedSessionId = "",
  selectedSessionLoading = false,
  sessionListLoaded = true,
  sessionListLoadError = "",
  sessionListLoading = false,
  sessions = []
} = {}) {
  if (
    !sessionListLoaded ||
    sessionListLoading ||
    String(sessionListLoadError || "").trim()
  ) {
    return null;
  }
  const normalizedSessionId = String(selectedSessionId || "").trim();
  if (sessionIdExistsInList(normalizedSessionId, sessions)) {
    return normalizedSessionId;
  }
  if (sessions.length > 0 || createSessionRunning || selectedSessionLoading) {
    return null;
  }
  return "";
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
  const sessionSelection = useVibe64SessionSelection({
    projectSlug
  });

  const selectedSessionId = sessionSelection.selectedId;
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const currentSessionApiPath = computed(() => paths.api(VIBE64_CURRENT_SESSION_API_SUFFIX, {
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
  const sessionDetailRecordsById = reactive({});
  const sessionComposerMenusById = reactive({});
  const requestedComposerMenusById = reactive({});
  const agentTurnRealtimeOverlaysById = reactive({});
  const selectedSessionReadQuery = computed(() => {
    const query = {};
    if (projectSlug.value) {
      query.projectSlug = projectSlug.value;
    }
    if (selectedSessionShouldLoadComposerMenu({
      composerMenusById: sessionComposerMenusById,
      requestedComposerMenusById,
      session: sessionDetailRecordsById[selectedSessionId.value] || null,
      sessionId: selectedSessionId.value
    })) {
      query.includeComposerMenu = "1";
    }
    return Object.keys(query).length > 0 ? query : null;
  });

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
  const updateCurrentSessionCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_CURRENT_SESSION_API_SUFFIX,
    buildCommandOptions: (_model, { context }) => ({
      method: "PUT",
      path: String(context?.apiPath || "")
    }),
    buildRawPayload: (_model, { context }) => ({
      sessionId: String(context?.sessionId || "").trim()
    }),
    fallbackRunError: "The current session shortcut could not be updated.",
    messages: {
      error: "The current session shortcut could not be updated."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.current.update",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "PUT"
  });
  const currentSessionPublisher = createVibe64CurrentSessionPublisher({
    async publish({ apiPath, sessionId }) {
      const response = await updateCurrentSessionCommand.run({
        apiPath,
        sessionId
      });
      if (!response || response.ok === false) {
        throw new Error(
          String(response?.error || "The current session shortcut could not be updated.")
        );
      }
    },
    onError(error, publication) {
      vibe64SessionDebugLog("client.sessionData.currentSession.error", {
        error: vibe64SessionDebugError(error),
        sessionId: publication.sessionId
      });
    }
  });
  onScopeDispose(() => {
    currentSessionPublisher.stop();
  });
  const selectedSessionResource = useEndpointResource({
    enabled: computed(() => Boolean(selectedSessionId.value)),
    fallbackLoadError: "Vibe64 session could not be loaded.",
    path: selectedSessionPath,
    queryKey: selectedSessionQueryKey,
    readQuery: selectedSessionReadQuery,
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

  useRealtimeEvent({
    enabled: computed(() => Boolean(selectedSessionId.value)),
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => {
      return Boolean(agentTurnRealtimeOverlayFromPayload(payload, selectedSessionId.value));
    },
    onEvent: ({ payload = {} } = {}) => {
      const overlay = agentTurnRealtimeOverlayFromPayload(payload, selectedSessionId.value);
      if (!overlay) {
        return;
      }
      agentTurnRealtimeOverlaysById[overlay.sessionId] = overlay;
      vibe64SessionDebugLog("client.sessionData.agentTurn.overlay", {
        active: overlay.active === true,
        reason: overlay.reason,
        sessionId: overlay.sessionId,
        threadId: String(overlay.agentSession?.thread?.id || ""),
        turnId: String(overlay.agentSession?.turn?.id || "")
      });
    }
  });

  function requestComposerMenuRefresh({
    reason = "",
    sessionId = "",
    signature = ""
  } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    const normalizedSignature = String(signature || "").trim();
    if (!normalizedSessionId) {
      return false;
    }
    const cachedMenu = sessionComposerMenusById[normalizedSessionId] || null;
    if (
      normalizedSignature &&
      cachedMenu?.signature === normalizedSignature &&
      Array.isArray(cachedMenu.items)
    ) {
      return false;
    }
    requestedComposerMenusById[normalizedSessionId] = true;
    vibe64SessionDebugLog("client.sessionData.composerMenu.refreshRequested", {
      cachedSignature: String(cachedMenu?.signature || ""),
      reason: String(reason || ""),
      selectedSessionId: String(selectedSessionId.value || ""),
      sessionId: normalizedSessionId,
      signature: normalizedSignature
    });
    if (
      normalizedSessionId === String(selectedSessionId.value || "").trim() &&
      !selectedSessionResource.isFetching?.value
    ) {
      void refreshSelectedSession();
    }
    return true;
  }

  useRealtimeEvent({
    enabled: computed(() => Boolean(selectedSessionId.value)),
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => {
      return Boolean(composerMenuProjectionFromRealtimePayload(payload, selectedSessionId.value));
    },
    onEvent: ({ payload = {} } = {}) => {
      const projection = composerMenuProjectionFromRealtimePayload(payload, selectedSessionId.value);
      if (!projection) {
        return;
      }
      requestComposerMenuRefresh({
        reason: sessionChangedReason(payload) || "composer-menu-signature",
        sessionId: projection.sessionId,
        signature: projection.signature
      });
    }
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
  const selectedDetailSession = computed(() => sessionDetailRecordForId(
    sessionDetailRecordsById,
    selectedSessionId.value,
    selectedSessionView.record
  ));
  const selectedSessionDetailState = computed(() => selectedSessionDetailLoadState({
    detailSession: selectedDetailSession.value,
    fetching: Boolean(selectedSessionResource.isFetching?.value),
    listSession: selectedListSession.value,
    loadError: selectedSessionResource.loadError?.value || "",
    loading: Boolean(selectedSessionResource.isLoading?.value || selectedSessionResource.isInitialLoading?.value),
    selectedSessionId: selectedSessionId.value
  }));
  const selectedBaseSession = computed(() => selectedSessionRecord(
    selectedDetailSession.value,
    selectedListSession.value,
    selectedSessionId.value
  ));
  const selectedRawSession = computed(() => {
    const session = sessionWithCachedComposerMenu(
      selectedBaseSession.value,
      sessionComposerMenusById[selectedSessionId.value] || null
    );
    return sessionWithAgentTurnRealtimeOverlay(
      session,
      agentTurnRealtimeOverlaysById[selectedSessionId.value] || null
    );
  });
  const selectedSession = computed(() => enrichVibe64SessionForDisplay(selectedRawSession.value));
  const isSelectedSessionClosed = computed(() => isClosedVibe64Session(selectedSession.value || {}));
  const pageLoading = computed(() => Boolean(sessionList.isLoading));
  const limits = computed(() => vibe64SessionLimits({
    payloadLimits: sessionList.pages?.[0]?.limits || {},
    sessions: sessions.value
  }));
  const seedSessionLock = computed(() => activeVibe64SeedSession(sessions.value));
  const canCreateSession = computed(() => {
    if (createSessionCapability.value?.enabled === false) {
      return false;
    }
    if (seedSessionLock.value) {
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
    if (seedSessionLock.value) {
      return activeVibe64SeedSessionMessage(seedSessionLock.value);
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
      seedSessionLockId: String(seedSessionLock.value?.sessionId || ""),
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
  const selectedComposerMenuRefreshState = computed(() => {
    const normalizedSessionId = String(selectedSessionId.value || "").trim();
    const cachedMenu = sessionComposerMenusById[normalizedSessionId] || null;
    const projection = sessionComposerMenuProjection(selectedBaseSession.value);
    return {
      cachedSignature: String(cachedMenu?.signature || ""),
      fetching: Boolean(selectedSessionResource.isFetching?.value),
      needsRefresh: sessionComposerMenuNeedsRefresh(selectedBaseSession.value, cachedMenu),
      selectedSessionId: normalizedSessionId,
      signature: projection.signature
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
    const session = sessionWithCachedComposerMenu(
      selectedSessionRecord(detailSession, listSession, normalizedSessionId),
      sessionComposerMenusById[normalizedSessionId] || null
    );
    return enrichVibe64SessionForDisplay(sessionWithAgentTurnRealtimeOverlay(
      session,
      agentTurnRealtimeOverlaysById[normalizedSessionId] || null
    ));
  }

  function acceptSessionResponse(session = null) {
    if (!rememberSessionDetailRecord(sessionDetailRecordsById, session)) {
      return false;
    }
    rememberSessionComposerMenu(sessionComposerMenusById, session);
    return true;
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
      currentSessionApiPath: currentSessionApiPath.value,
      nextSessions,
      selectedSessionId: String(selectedSessionId.value || ""),
      selectedSessionLoading: Boolean(selectedSessionResource.isLoading?.value),
      sessionIds: nextSessions.map((session) => session.sessionId).join("|"),
      sessionListInitialLoading: sessionList.isInitialLoading,
      sessionListLoaded: sessionList.pages.length > 0,
      sessionListLoadError: String(sessionList.loadError || ""),
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

  watch(selectionReconciliationState, (state) => {
    const publicationSessionId = selectedSessionIdForCurrentAlias({
      createSessionRunning: state.createSessionRunning,
      selectedSessionId: state.selectedSessionId,
      selectedSessionLoading: state.selectedSessionLoading,
      sessionListLoaded: state.sessionListLoaded,
      sessionListLoadError: state.sessionListLoadError,
      sessionListLoading: state.sessionListLoading,
      sessions: state.nextSessions
    });
    if (publicationSessionId === null || !state.currentSessionApiPath) {
      return;
    }
    void currentSessionPublisher.request({
      apiPath: state.currentSessionApiPath,
      sessionId: publicationSessionId
    });
  }, {
    flush: "post",
    immediate: true
  });

  watch(() => selectedSessionView.record, (session) => {
    if (rememberSessionComposerMenu(sessionComposerMenusById, session)) {
      delete requestedComposerMenusById[session.sessionId];
    }
    rememberSessionDetailRecord(sessionDetailRecordsById, session);
  }, {
    immediate: true
  });

  watch(selectedSessionId, (nextSessionId, previousSessionId) => {
    if (previousSessionId && previousSessionId !== nextSessionId) {
      delete agentTurnRealtimeOverlaysById[previousSessionId];
    }
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

  watch(selectedSessionDetailState, (state) => {
    vibe64SessionDebugLog("client.sessionData.selectedSession.detailState", {
      loading: state.loading === true,
      ready: state.ready === true,
      restoring: state.restoring === true,
      selectedSessionId: state.sessionId,
      state: state.state,
      suppressPassiveComposer: state.suppressPassiveComposer === true
    });
  }, {
    immediate: true
  });

  let selectedComposerMenuRefreshKey = "";
  watch(selectedComposerMenuRefreshState, (state) => {
    if (!state.needsRefresh) {
      selectedComposerMenuRefreshKey = "";
      return;
    }
    if (state.fetching) {
      return;
    }
    const refreshKey = [
      state.selectedSessionId,
      state.signature,
      state.cachedSignature
    ].join("|");
    if (refreshKey === selectedComposerMenuRefreshKey) {
      return;
    }
    selectedComposerMenuRefreshKey = refreshKey;
    requestComposerMenuRefresh({
      reason: "composer-menu-cache-miss",
      sessionId: state.selectedSessionId,
      signature: state.signature
    });
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
    acceptSessionResponse,
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
    selectedSessionDetailState,
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
    updateCurrentSessionCommand,
    workflowDefinitions
  };
}

export {
  composerMenuProjectionFromRealtimePayload,
  rememberSessionComposerMenu,
  rememberSessionDetailRecord,
  sessionDetailRecordForId,
  agentTurnRealtimeOverlayFromPayload,
  selectedSessionShouldLoadComposerMenu,
  selectedSessionDetailLoadState,
  sessionComposerMenuNeedsRefresh,
  sessionRecordHasComposerMenuProjection,
  sessionRecordHasActiveAgentWork,
  sessionListRealtimeShouldRefresh,
  sessionWithCachedComposerMenu,
  sessionWithAgentTurnRealtimeOverlay,
  selectedSessionRealtimeShouldRefresh,
  selectedSessionRecord,
  selectedSessionDetailRefreshReason,
  selectedSessionIdForCurrentAlias,
  sessionIdExistsInList,
  sessionRevisionNumber,
  shouldPreserveSelectedSessionDuringRefresh,
  useVibe64SessionData
};
