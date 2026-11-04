import { computed, proxyRefs, ref, watch } from "vue";
import { VIBE64_PROJECT_CHANGED_EVENT } from "@/lib/studioGateApi.js";
import { useRoute, useRouter } from "vue-router";
import { useVibe64SessionDialogs } from "@/composables/useVibe64SessionDialogs.js";
import { useVibe64SessionCreation } from "@/composables/useVibe64SessionCreation.js";
import { useVibe64SelectedSessionRenewal } from "@/composables/useVibe64SelectedSessionRenewal.js";
import { useVibe64CurrentSessionPublication } from "@/composables/useVibe64CurrentSessionPublication.js";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import { projectSlugFromRoute } from "@/lib/vibe64ProjectScope.js";
import {
  selectedSessionIdFromRoute,
  useVibe64SessionSelection
} from "@/composables/useVibe64SessionSelection.js";
import {
  VIBE64_CURRENT_SESSION_API_SUFFIX,
  VIBE64_SESSION_SUMMARY_CHANGED_EVENT,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64SessionEventMatchesScope,
  vibe64SessionsQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  enrichVibe64SessionForDisplay,
  shortVibe64SessionId as shortSessionId,
  visibleVibe64Sessions
} from "@/lib/vibe64SessionPanelModel.js";
import {
  vibe64SessionDisplayTitle,
  isArchivedVibe64Session
} from "@/lib/vibe64SessionViewModel.js";
import { refetchEndpointResource } from "@/lib/vibe64EndpointResourceRefetch.js";
import { sessionArchiveState } from "@/lib/vibe64SessionArchiveState.js";
import {
  renewedSuccessorSessionId,
  sessionIdExistsInList
} from "@/lib/vibe64SessionListLookup.js";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";
import {
  agentTurnRealtimeOverlayFromPayload,
  latestAgentTurnRealtimeOverlay
} from "@/lib/vibe64AgentTurnRealtimeOverlay.js";

// A ?session= that is not one of this project's sessions (another project's,
// or one that is gone) leaves the URL, with its chat, once the list has
// answered; the project's normal session choice then applies. Null keeps the
// URL: no such param, or the route already shows another project.
function routeQueryWithoutUnlistedSession({ route = {}, projectSlug = "", sessions = [] } = {}) {
  const routeSessionId = selectedSessionIdFromRoute(route);
  if (!routeSessionId || projectSlugFromRoute(route) !== projectSlug ||
    sessionIdExistsInList(routeSessionId, sessions)) return null;
  const { session: _session, conversation: _conversation, chat: _chat, ...query } = route.query || {};
  return query;
}

function shouldPreserveSelectedSessionDuringRefresh({
  createSessionRunning = false,
  currentSessionId = "",
  nextSessions = [],
  sessionListLoading = false
} = {}) {
  const normalizedSessionId = String(currentSessionId || "").trim();
  if (!normalizedSessionId || sessionIdExistsInList(normalizedSessionId, nextSessions)) {
    return false;
  }
  return Boolean(sessionListLoading || createSessionRunning);
}

function sessionListRealtimeShouldRefresh({ payload = {} } = {}, projectSlug = "") {
  return vibe64SessionEventMatchesScope(payload, { projectSlug }) &&
    payload.clientRefresh?.includeList !== false;
}

function useVibe64SessionData() {
  const projectSlug = useVibe64ProjectSlug();
  const route = useRoute();
  const router = useRouter();
  const paths = usePaths();
  const selectionScope = computed(() => String(projectSlug.value || "").trim());
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const currentSessionApiPath = computed(() => paths.api(VIBE64_CURRENT_SESSION_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const sessionListQueryKey = computed(() => vibe64SessionsQueryKey(
    VIBE64_SURFACE_ID,
    ROUTE_VISIBILITY_PUBLIC,
    projectSlug.value
  ));
  const sessionListResource = useEndpointResource({
    fallbackLoadError: "Vibe64 sessions could not be loaded.",
    path: sessionsApiPath,
    queryKey: sessionListQueryKey,
    readQuery: {
      limit: 20
    },
    queryOptions: {
      // A list cached by an earlier visit can name a stale last opened
      // session, so each visit reads the list again before choosing.
      refetchOnMount: "always",
      refetchOnWindowFocus: false
    },
    requestRecoveryLabel: "Vibe64 sessions",
    realtime: {
      events: [VIBE64_SESSION_SUMMARY_CHANGED_EVENT, VIBE64_PROJECT_CHANGED_EVENT, "connect"],
      matches: (event) => sessionListRealtimeShouldRefresh(event, projectSlug.value)
    }
  });
  const sessionList = proxyRefs({
    unavailableItems: computed(() => sessionListResource.data.value?.unavailableSessions || []),
    items: computed(() => {
      const payload = sessionListResource.data.value || {};
      return Array.isArray(payload.sessions) ? payload.sessions : [];
    }),
    loadError: computed(() => sessionListResource.loadError.value),
    // Loading lasts until this page has read the list itself.
    isInitialLoading: computed(() => sessionListResource.isInitialLoading.value ||
      !sessionListResource.query.isFetchedAfterMount.value),
    isLoading: computed(() => sessionListResource.isLoading.value),
    pages: computed(() => {
      const payload = sessionListResource.data.value;
      return payload && typeof payload === "object" && !Array.isArray(payload) ? [payload] : [];
    }),
    reload: sessionListResource.reload,
    resource: sessionListResource
  });
  // Without a session in the address, the project opens the person's last
  // opened session, reported by the list once this page has read it.
  const sessionSelection = useVibe64SessionSelection({
    projectSlug,
    rememberedId: () => sessionList.isInitialLoading ? "" : sessionList.pages[0]?.lastOpenedSessionId
  });
  const selectedSessionId = sessionSelection.selectedId;
  let emptySessionListObservedForProject = "";
  const {
    createSession,
    createSessionCommand,
    createSessionRunning
  } = useVibe64SessionCreation({
    projectSlug,
    refreshSessionDataInBackground,
    selectSessionId,
    sessionListQueryKey,
    sessionsApiPath
  });
  const archiveAttempts = ref({});
  const agentActivityBySessionId = ref({});
  const sessions = computed(() => {
    const items = new Map((sessionList.items || []).map((session) => [session.sessionId, session]));
    for (const [id, attempt] of Object.entries(archiveAttempts.value)) {
      if (attempt.succeeded) {
        items.delete(id);
      } else {
        items.set(id, {
          ...(items.get(id) || attempt.session),
          archiving: true,
          archiveStartedAt: attempt.startedAt
        });
      }
    }
    return visibleVibe64Sessions([...items.values()]).map((session) => {
      const archiveState = sessionArchiveState(session);
      return {
        ...session,
        agentActivity: latestAgentTurnRealtimeOverlay(
          session.agentActivity,
          agentActivityBySessionId.value[session.sessionId]
        ),
        archiveOperation: archiveState.operation,
        archiveStartedAt: archiveState.operation?.startedAt || session.archiveStartedAt,
        archiveError: archiveState.archiveError,
        archiving: Boolean(session.archiving || archiveState.archiving)
      };
    });
  });
  const availableSessions = computed(() => sessions.value.filter((session) => !session.archiving));
  const selectedListSession = computed(() => {
    return sessions.value.find((session) => session.sessionId === selectedSessionId.value) || null;
  });
  const selectedSessionMissing = computed(() => {
    const selectedId = String(selectedSessionId.value || "").trim();
    if (
      !selectedId ||
      sessionList.pages.length < 1 ||
      String(sessionList.loadError || "").trim() ||
      sessionIdExistsInList(selectedId, sessions.value)
    ) {
      return false;
    }
    return true;
  });
  const {
    selectionRenewalPredecessorId,
    selectionRenewalResource,
    syncRenewalSuccessorUrl
  } = useVibe64SelectedSessionRenewal({
    availableSessions,
    projectSlug,
    route,
    router,
    selectedListSession,
    selectedSessionId,
    selectedSessionMissing,
    sessionList,
    sessionsApiPath
  });
  const creationOptions = computed(() => sessionList.pages?.[0]?.creation || {});
  const selectedSession = computed(() => enrichVibe64SessionForDisplay(selectedListSession.value));
  const isSelectedSessionArchived = computed(() => isArchivedVibe64Session(selectedSession.value || {}));
  const canCreateSession = computed(() => {
    return creationOptions.value.canCreate === true;
  });
  const createSessionVisible = computed(() => (
    creationOptions.value.showCreateAction === true
  ));
  const createSessionTitle = computed(() => {
    if (creationOptions.value.disabledReason) {
      return String(creationOptions.value.disabledReason);
    }
    if (creationOptions.value.canCreate !== true) {
      return "Session creation is unavailable.";
    }
    return "Create a new Vibe64 session";
  });
  const selectedSessionTitle = computed(() => {
    return vibe64SessionDisplayTitle(selectedSession.value || {}) ||
      `Session ${shortSessionId(selectedSessionId.value)}`;
  });

  async function refreshSessionList() {
    return refetchEndpointResource(sessionListResource);
  }

  let refreshSessionDataInFlight = null;

  async function refreshSessionData(options = {}) {
    const reason = typeof options === "string" ? options : String(options.reason || "");
    if (refreshSessionDataInFlight) {
      vibe64SessionDebugLog("client.sessionData.refresh.join", {
        reason,
        selectedSessionId: String(selectedSessionId.value || "")
      });
      return refreshSessionDataInFlight;
    }
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("client.sessionData.refresh.start", {
      reason,
      selectedSessionId: String(selectedSessionId.value || "")
    });
    refreshSessionDataInFlight = refreshSessionList();
    try {
      const result = await refreshSessionDataInFlight;
      vibe64SessionDebugLog("client.sessionData.refresh.done", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        reason,
        selectedSessionId: String(selectedSessionId.value || ""),
        sessionCount: sessions.value.length
      });
      return result;
    } catch (error) {
      vibe64SessionDebugLog("client.sessionData.refresh.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        reason,
        selectedSessionId: String(selectedSessionId.value || "")
      });
      throw error;
    } finally {
      refreshSessionDataInFlight = null;
    }
  }

  function refreshSessionDataInBackground(options = {}) {
    void refreshSessionData(options).catch(() => {
      // The endpoint resource and refresh debug event retain the failure for the UI and diagnostics.
    });
  }

  function selectSessionId(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (sessions.value.some((session) => session.sessionId === normalizedSessionId && session.archiving)) {
      return;
    }
    vibe64SessionDebugLog("client.sessionData.selectSession", {
      fromSessionId: String(selectedSessionId.value || ""),
      toSessionId: normalizedSessionId
    });
    if (normalizedSessionId) {
      emptySessionListObservedForProject = "";
    }
    sessionSelection.select(normalizedSessionId);
  }

  function clearSelectedSession() {
    emptySessionListObservedForProject = selectionScope.value;
    sessionSelection.clear();
  }

  function selectPreviousSession(sessionId) {
    const navigation = sessions.value;
    const index = navigation.findIndex((session) => session.sessionId === sessionId);
    const previous = navigation.slice(0, Math.max(0, index)).filter((session) => !session.archiving).at(-1);
    selectSessionId(previous?.sessionId || availableSessions.value.at(-1)?.sessionId || "");
  }

  const archive = proxyRefs(useVibe64SessionDialogs({
    beginArchive(sessionId) {
      archiveAttempts.value[sessionId] = {
        startedAt: new Date().toISOString(),
        session: sessions.value.find((session) => session.sessionId === sessionId)
      };
      if (selectedSessionId.value === sessionId) {
        selectPreviousSession(sessionId);
      }
      return projectSlug.value;
    },
    finishArchive(sessionId, succeeded, archiveProject) {
      if (projectSlug.value !== archiveProject) return;
      if (succeeded) {
        archiveAttempts.value[sessionId] = { succeeded: true };
      } else {
        delete archiveAttempts.value[sessionId];
        if (!selectedSessionId.value) selectSessionId(sessionId);
      }
    },
    isSelectedSessionArchived,
    refreshSessionData,
    selectedSessionId,
    selectedSessionTitle,
    sessionsApiPath
  }));

  const archiveFeedback = useUiFeedback({ source: "vibe64.sessions.archive.remote" });
  const shownArchiveFailures = new Set();
  watch(projectSlug, () => {
    archiveAttempts.value = {};
    agentActivityBySessionId.value = {};
    shownArchiveFailures.clear();
  });
  useRealtimeEvent({
    event: VIBE64_SESSION_SUMMARY_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => vibe64SessionEventMatchesScope(payload, { projectSlug: projectSlug.value }),
    onEvent: ({ payload = {} } = {}) => {
      const id = String(payload.sessionId || "");
      if (!id) return;
      const activity = agentTurnRealtimeOverlayFromPayload(payload, id);
      if (activity) {
        agentActivityBySessionId.value[id] = latestAgentTurnRealtimeOverlay(
          agentActivityBySessionId.value[id],
          { active: activity.active, revision: activity.revision }
        );
      }
      if (payload.reason === "session-archiving") {
        const session = sessions.value.find((item) => item.sessionId === id);
        if (session) {
          archiveAttempts.value[id] = {
            session,
            startedAt: archiveAttempts.value[id]?.startedAt || new Date().toISOString()
          };
        }
        if (selectedSessionId.value === id) selectPreviousSession(id);
      } else if (payload.reason === "session-archived") {
        archiveAttempts.value[id] = { succeeded: true };
      } else if (payload.reason === "session-archive-failed") {
        delete archiveAttempts.value[id];
        if (!selectedSessionId.value) selectSessionId(id);
      }
    }
  });
  watch(() => sessionList.items, (items) => {
    for (const id of Object.keys(agentActivityBySessionId.value)) {
      if (!items.some((session) => session.sessionId === id)) delete agentActivityBySessionId.value[id];
    }
    for (const [id, attempt] of Object.entries(archiveAttempts.value)) {
      if (attempt.succeeded || archive.archivingSessionId === id) continue;
      const session = items.find((item) => item.sessionId === id);
      if (!session || !sessionArchiveState(session).archiving) {
        delete archiveAttempts.value[id];
      }
    }
  });
  watch(sessions, (items) => {
    for (const session of items) {
      const key = `${session.sessionId}:${session.metadata?.session_archive_operation}`;
      if (!session.archiveError || shownArchiveFailures.has(key)) continue;
      shownArchiveFailures.add(key);
      if (archive.archivingSessionId !== session.sessionId) {
        archiveFeedback.error(new Error(session.archiveError));
      }
    }
  }, { immediate: true });

  function dropUnlistedRouteSession() {
    const query = routeQueryWithoutUnlistedSession({ route, projectSlug: projectSlug.value, sessions: sessions.value });
    if (query) void router.replace({ path: route.path, hash: route.hash, query }).catch(() => null);
  }

  const selectionReconciliationState = computed(() => {
    const nextSessions = availableSessions.value;
    return {
      createSessionRunning: createSessionRunning.value,
      currentSessionApiPath: currentSessionApiPath.value,
      selectionScope: selectionScope.value,
      selectionRenewal: selectionRenewalResource.data.value?.renewal || null,
      selectionRenewalLoadError: String(
        selectionRenewalResource.loadError?.value || ""
      ),
      selectionRenewalLoaded: Boolean(
        selectionRenewalResource.data.value &&
        typeof selectionRenewalResource.data.value === "object" &&
        !Array.isArray(selectionRenewalResource.data.value)
      ),
      selectionRenewalLoading: Boolean(
        selectionRenewalResource.isInitialLoading?.value ||
        selectionRenewalResource.isLoading?.value
      ),
      selectionRenewalPredecessorId: selectionRenewalPredecessorId.value,
      projectSlug: String(projectSlug.value || "").trim(),
      selectedSessionMissing: selectedSessionMissing.value,
      nextSessions,
      selectedSessionId: String(selectedSessionId.value || ""),
      sessionListInitialLoading: sessionList.isInitialLoading,
      sessionListLoaded: sessionList.pages.length > 0,
      sessionListLoadError: String(sessionList.loadError || ""),
      sessionListLoading: sessionList.isLoading
    };
  });

  watch(selectionReconciliationState, (state) => {
    const nextSessions = state.nextSessions;
    if (sessions.value.some((session) => session.sessionId === state.selectedSessionId && session.archiving)) {
      selectPreviousSession(state.selectedSessionId);
      return;
    }
    vibe64SessionDebugLog("client.sessionData.sessions.changed", {
      selectedSessionId: String(selectedSessionId.value || ""),
      sessionCount: nextSessions.length
    });
    if (
      state.sessionListInitialLoading ||
      state.sessionListLoadError ||
      shouldPreserveSelectedSessionDuringRefresh({
        createSessionRunning: state.createSessionRunning,
        currentSessionId: state.selectedSessionId,
        nextSessions,
        sessionListLoading: state.sessionListLoading
      })
    ) {
      return;
    }
    if (!state.selectedSessionId && nextSessions.length === 0) {
      emptySessionListObservedForProject = state.selectionScope;
    }
    if (state.selectionRenewalPredecessorId) {
      if (
        state.selectionRenewalLoading ||
        state.selectionRenewalLoadError ||
        !state.selectionRenewalLoaded
      ) {
        return;
      }
      const selectionRenewal = state.selectionRenewal;
      if (
        selectionRenewal &&
        String(selectionRenewal.sessionId || "").trim() === state.selectionRenewalPredecessorId
      ) {
        const renewalStatus = String(selectionRenewal.status || "").trim();
        if (renewalStatus === "completed") {
          const renewedSuccessorId = renewedSuccessorSessionId({
            predecessorSessionId: state.selectionRenewalPredecessorId,
            sessions: nextSessions
          });
          if (state.selectedSessionMissing) {
            if (renewedSuccessorId) {
              sessionSelection.selectAvailableId(nextSessions, {
                fallbackId: renewedSuccessorId,
                getId: (session) => session.sessionId
              });
            }
          }
          if (renewedSuccessorId && selectedSessionId.value === renewedSuccessorId) {
            syncRenewalSuccessorUrl(state.selectionRenewalPredecessorId, renewedSuccessorId);
          }
          if (state.selectedSessionMissing) return;
        } else if (state.selectedSessionMissing && ["failed", "running"].includes(renewalStatus)) {
          return;
        }
        if (["failed", "running"].includes(renewalStatus)) {
          sessionSelection.select(state.selectionRenewalPredecessorId);
          return;
        }
      }
    }
    // A renewal owns its predecessor's link (syncRenewalSuccessorUrl).
    if (!state.selectionRenewalPredecessorId) dropUnlistedRouteSession();
    if (
      !state.selectedSessionId &&
      emptySessionListObservedForProject === state.selectionScope
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

  useVibe64CurrentSessionPublication({ selectionReconciliationState });

  return {
    archive,
    canCreateSession,
    clearSelectedSession,
    createSession,
    createSessionCommand,
    createSessionRunning,
    createSessionVisible,
    createSessionTitle,
    isSelectedSessionArchived,
    refreshSessionData,
    selectSessionId,
    selectedSession,
    selectedSessionId,
    selectedSessionTitle,
    sessionList,
    sessions,
    sessionsApiPath,
    shortSessionId
  };
}

export {
  routeQueryWithoutUnlistedSession,
  sessionListRealtimeShouldRefresh,
  shouldPreserveSelectedSessionDuringRefresh,
  useVibe64SessionData
};
