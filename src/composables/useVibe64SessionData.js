import { computed, onScopeDispose, proxyRefs, ref, unref, watch } from "vue";
import { useVibe64SessionDialogs } from "@/composables/useVibe64SessionDialogs.js";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { useQueryClient } from "@tanstack/vue-query";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
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
  vibe64SessionPath,
  vibe64SessionQueryKey,
  vibe64SessionsQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  createVibe64CurrentSessionPublisher
} from "@/lib/vibe64CurrentSessionPublisher.js";
import {
  enrichVibe64SessionForDisplay,
  shortVibe64SessionId as shortSessionId,
  visibleVibe64Sessions,
  vibe64SessionMatchesPurpose
} from "@/lib/vibe64SessionPanelModel.js";
import {
  vibe64SessionDisplayTitle,
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel,
  isArchivedVibe64Session
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
  vibe64SessionListRefreshRequested
} from "@/lib/vibe64SessionClientRefresh.js";
import {
  mountedSessionRealtimeShouldRefresh
} from "@/lib/vibe64MountedSessionState.js";
import {
  agentTurnRealtimeOverlayFromPayload,
  latestAgentTurnRealtimeOverlay
} from "@/lib/vibe64AgentTurnRealtimeOverlay.js";

import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

const SESSION_LIST_IGNORED_REALTIME_REASONS = new Set([
  "assistant-stream",
  "assistant-response-bundle",
  "codex-app-server-ready",
  "codex-app-server-agent-result",
  "codex-app-server-agent-result-invalid",
  "codex-app-server-agent-result-missing",
  "codex-app-server-agent-result-provider-failed",
  "codex-app-server-blocked",
  "codex-app-server-commentary",
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
  "opencode-server-assistant-message",
  "opencode-server-message-delivered",
  "opencode-server-progress",
  "opencode-server-reasoning",
  "opencode-server-tool",
  "opencode-server-turn-active",
  "opencode-server-turn-idle",
  "agent-terminal-started",
  "agent-terminal-closed",
  "output-target-started",
  "output-target-ready",
  "output-target-closed",
  "output-target-stopped"
]);
function sessionArchiveOperation(session) {
  try {
    return JSON.parse(session?.metadata?.session_archive_operation || "null");
  } catch {
    return { status: "failed", error: "Session archive state could not be read." };
  }
}

function sessionIdExistsInList(sessionId = "", nextSessions = []) {
  const normalizedSessionId = String(sessionId || "").trim();
  return Boolean(normalizedSessionId) && nextSessions.some((session) => session.sessionId === normalizedSessionId);
}

function renewedSuccessorSessionId({
  predecessorSessionId = "",
  sessions = []
} = {}) {
  const predecessorId = String(predecessorSessionId || "").trim();
  if (!predecessorId) {
    return "";
  }
  const matches = sessions.filter((session) => (
    String(session?.metadata?.renewed_from || "").trim() === predecessorId
  ));
  return matches.length === 1 ? String(matches[0]?.sessionId || "").trim() : "";
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

function sessionListRealtimeShouldRefresh({ payload = {} } = {}, projectSlug = "") {
  if (payload.projectSlug && payload.projectSlug !== projectSlug) {
    return false;
  }
  if (vibe64SessionListRefreshRequested(payload)) {
    return true;
  }
  const reason = sessionChangedReason(payload);
  if (reason === "assistant-routing-changed" && payload.assistantRoutingRequest) {
    return false;
  }
  return !reason || !SESSION_LIST_IGNORED_REALTIME_REASONS.has(reason);
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
  onTitleChange = null,
  learningResource = null,
  purposeFilter = ""
} = {}) {
  const notifyTitleChange = typeof onTitleChange === "function" ? onTitleChange : () => null;
  const queryClient = useQueryClient();
  const projectSlug = useVibe64ProjectSlug();
  const paths = usePaths();
  const learningMode = computed(() => readRefOrGetterValue(purposeFilter) === "learning");
  const learningEndpoint = computed(() => readRefOrGetterValue(learningResource));
  const learningPayload = computed(() => unref(learningEndpoint.value?.data));
  const learningAccessDenied = computed(() => {
    const error = unref(learningEndpoint.value?.query?.error);
    return [401, 403].includes(Number(error?.statusCode || error?.status || error?.response?.status));
  });
  const learningLearnerId = computed(() => {
    const payload = learningPayload.value;
    return !learningAccessDenied.value && payload?.ok === true && payload?.available === true &&
      typeof payload.learnerId === "string" ? payload.learnerId : "";
  });
  const learningLoaded = computed(() => Boolean(learningLearnerId.value && Array.isArray(learningPayload.value?.sessions)));
  const learningLoading = computed(() => Boolean(unref(learningEndpoint.value?.isInitialLoading) || unref(learningEndpoint.value?.isLoading)));
  const learningSessions = computed(() => learningLoaded.value ? learningPayload.value.sessions : []);
  const learningCollectionError = computed(() => {
    const workingIds = new Set(sessionList.items.map(session => session.sessionId));
    const seen = new Set();
    for (const session of learningSessions.value) {
      if (workingIds.has(session.sessionId) || seen.has(session.sessionId)) {
        return "The saved Learning and Working conversations have conflicting identities. Keep the confirmed list and ask the owner to inspect it.";
      }
      seen.add(session.sessionId);
    }
    return "";
  });
  const learningLoadError = computed(() => String(unref(learningEndpoint.value?.loadError) ||
    (learningAccessDenied.value ? "Access to these learning conversations is no longer confirmed." : learningCollectionError.value) ||
    (!learningEndpoint.value ? "Learning conversations are unavailable in this installation." : "")));
  const selectionScope = computed(() => learningMode.value ? `learning:${learningLearnerId.value}` : String(projectSlug.value || "").trim());
  const workingSelection = useVibe64SessionSelection({ projectSlug });
  const learningSelection = useVibe64SessionSelection({
    projectSlug, purpose: "learning", learnerId: learningLearnerId
  });
  const activeSelection = () => learningMode.value ? learningSelection : workingSelection;
  const sessionSelection = {
    selectedId: computed(() => activeSelection().selectedId.value),
    select: id => activeSelection().select(id),
    clear: () => activeSelection().clear(),
    selectAvailableId: (items, options) => activeSelection().selectAvailableId(items, options)
  };

  const selectedSessionId = sessionSelection.selectedId;
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
    enabled: computed(() => !learningEndpoint.value || Boolean(projectSlug.value)),
    fallbackLoadError: "Vibe64 sessions could not be loaded.",
    path: sessionsApiPath,
    queryKey: sessionListQueryKey,
    readQuery: {
      limit: 20
    },
    queryOptions: {
      refetchOnMount: false,
      refetchOnWindowFocus: false
    },
    requestRecoveryLabel: "Vibe64 sessions",
    realtime: {
      events: [VIBE64_SESSION_CHANGED_EVENT, "connect"],
      matches: (event) => !event?.payload?.learningAttemptId && sessionListRealtimeShouldRefresh(event, projectSlug.value)
    }
  });
  const workingLoadError = computed(() => sessionListResource.loadError.value);
  const sessionList = proxyRefs({
    unavailableItems: computed(() => sessionListResource.data.value?.unavailableSessions || []),
    items: computed(() => {
      const payload = sessionListResource.data.value || {};
      return Array.isArray(payload.sessions) ? payload.sessions : [];
    }),
    loadError: computed(() => learningMode.value ? learningLoadError.value : sessionListResource.loadError.value),
    isInitialLoading: computed(() => learningMode.value ? !learningLoaded.value && learningLoading.value : sessionListResource.isInitialLoading.value),
    isLoading: computed(() => learningMode.value ? learningLoading.value : sessionListResource.isLoading.value),
    pages: computed(() => {
      const payload = learningMode.value ? (learningLoaded.value ? learningPayload.value : null) : sessionListResource.data.value;
      return payload && typeof payload === "object" && !Array.isArray(payload) ? [payload] : [];
    }),
    reload: sessionListResource.reload,
    resource: sessionListResource
  });
  let emptySessionListObservedForProject = "";
  const createSessionCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_model, { context }) => ({ method: "POST", path: context?.apiPath }),
    buildRawPayload: (_model, { context }) => vibe64RealtimeOriginPayload({
      assistantSelection: context?.assistantSelection || {},
      ...(context?.workflowEngineId ? { workflowEngineId: context.workflowEngineId } : {}),
      ...(context?.repositoryBranch ? { repositoryBranch: context.repositoryBranch } : {}),
      ...(context?.pullRequestNumber ? { pullRequestNumber: context.pullRequestNumber } : {})
    }),
    fallbackRunError: "Vibe64 session could not be created.",
    messages: {
      error: "Vibe64 session could not be created.",
      success: "Vibe64 session created."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.create",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
  const createSessionPending = ref(false);
  // useCommand's observable operation state is shared by placement source. It
  // may still describe a creation in another project after project navigation,
  // so it cannot own this page's local loading state.
  const createSessionRunning = computed(() => createSessionPending.value);
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
    coalesceByPath: () => Boolean(learningEndpoint.value),
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
  let sessionDataDisposed = false;
  onScopeDispose(() => {
    sessionDataDisposed = true;
    currentSessionPublisher.stop();
  });
  const archiveAttempts = ref({});
  const agentActivityBySessionId = ref({});
  let confirmedCollectionScope = "";
  const sessions = computed((previous) => {
    const collectionScope = JSON.stringify([projectSlug.value, learningLearnerId.value]);
    if (learningCollectionError.value) return confirmedCollectionScope === collectionScope ? previous || [] : [];
    confirmedCollectionScope = collectionScope;
    const items = new Map([...(sessionList.items || []), ...learningSessions.value].map((session) => [session.sessionId, session]));
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
      const operation = sessionArchiveOperation(session);
      return {
        ...session,
        agentActivity: latestAgentTurnRealtimeOverlay(
          session.agentActivity,
          agentActivityBySessionId.value[session.sessionId]
        ),
        archiveOperation: operation,
        archiveStartedAt: operation?.startedAt || session.archiveStartedAt,
        archiveError: operation?.status === "failed" ? operation.error : "",
        archiving: Boolean(session.archiving || operation?.status === "running" || (
          operation?.status !== "failed" && session.metadata?.session_closing_reason === "archived"
        ))
      };
    });
  });
  const availableSessions = computed(() => sessions.value.filter((session) => !session.archiving &&
    vibe64SessionMatchesPurpose(session, readRefOrGetterValue(purposeFilter))));
  const selectedListSession = computed(() => {
    return sessions.value.find((session) => session.sessionId === selectedSessionId.value) || null;
  });
  const selectedSessionsApiPath = computed(() => {
    const session = selectedListSession.value;
    if (session?.purpose === "learning") {
      return learningLearnerId.value && session.learningAttemptId
        ? `/api/learning/${encodeURIComponent(session.learningAttemptId)}/vibe64/sessions` : "";
    }
    return learningMode.value ? "" : sessionsApiPath.value;
  });
  const selectedCurrentSessionApiPath = computed(() => selectedListSession.value?.purpose === "learning"
    ? selectedSessionsApiPath.value ? `${selectedSessionsApiPath.value}/current` : ""
    : learningMode.value ? "" : currentSessionApiPath.value);
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
  const selectionRenewalPredecessorId = computed(() => {
    const selectedId = String(selectedSessionId.value || "").trim();
    if (learningMode.value || selectedListSession.value?.purpose === "learning" || !selectedId || sessionList.pages.length < 1 || String(sessionList.loadError || "").trim()) {
      return "";
    }
    if (sessionList.unavailableItems.some((session) => session.sessionId === selectedId)) {
      return "";
    }
    if (selectedSessionMissing.value) {
      return selectedId;
    }
    return String(selectedListSession.value?.metadata?.renewed_from || "").trim();
  });
  const selectionRenewalPath = computed(() => (
    selectionRenewalPredecessorId.value
      ? vibe64SessionPath(
          sessionsApiPath.value,
          selectionRenewalPredecessorId.value,
          "/renewal"
        )
      : ""
  ));
  const selectionRenewalResource = useEndpointResource({
    enabled: computed(() => Boolean(selectionRenewalPredecessorId.value)),
    fallbackLoadError: "The selected session renewal could not be checked.",
    path: selectionRenewalPath,
    queryKey: computed(() => [
      ...vibe64SessionQueryKey(
        VIBE64_SURFACE_ID,
        ROUTE_VISIBILITY_PUBLIC,
        projectSlug.value
      ),
      selectionRenewalPredecessorId.value,
      "renewal"
    ]),
    queryOptions: {
      refetchOnMount: "always",
      refetchOnWindowFocus: false
    },
    readMethod: "GET",
    realtime: {
      event: VIBE64_SESSION_CHANGED_EVENT,
      matches: ({ payload = {} } = {}) => mountedSessionRealtimeShouldRefresh(
        { payload },
        selectionRenewalPredecessorId.value
      )
    },
    requestRecoveryLabel: "Selected session renewal"
  });
  const creationOptions = computed(() => sessionList.pages?.[0]?.creation || {});
  const selectedSession = computed(() => enrichVibe64SessionForDisplay(selectedListSession.value));
  const isSelectedSessionArchived = computed(() => isArchivedVibe64Session(selectedSession.value || {}));
  const pageLoading = computed(() => Boolean(sessionList.isLoading));
  const canCreateSession = computed(() => {
    return !learningMode.value && creationOptions.value.canCreate === true;
  });
  const createSessionVisible = computed(() => (
    !learningMode.value && creationOptions.value.showCreateAction === true
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
    const learning = learningEndpoint.value;
    if (!learning) return refetchEndpointResource(sessionListResource);
    const [result] = await Promise.all([
      projectSlug.value ? refetchEndpointResource(sessionListResource) : undefined,
      refetchEndpointResource(learning)
    ]);
    return result;
  }

  let refreshSessionDataInFlight = null;

  async function refreshSessionData(options = {}) {
    const reason = typeof options === "string" ? options : String(options?.reason || "");
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
    if (learningMode.value && (!learningLoaded.value || learningLoading.value || learningLoadError.value ||
        !availableSessions.value.some(session => session.sessionId === normalizedSessionId))) return;
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
    if (learningMode.value && (!learningLoaded.value || learningLoading.value || learningLoadError.value)) return;
    const aliasPath = learningMode.value ? selectedCurrentSessionApiPath.value : "";
    emptySessionListObservedForProject = selectionScope.value;
    sessionSelection.clear();
    if (aliasPath) void currentSessionPublisher.request({ apiPath: aliasPath, sessionId: "" });
  }

  function selectPreviousSession(sessionId) {
    const navigation = sessions.value.filter(session => vibe64SessionMatchesPurpose(session, readRefOrGetterValue(purposeFilter)));
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
      }
    },
    archiveAllowed: computed(() => selectedListSession.value?.purpose !== "learning"),
    isSelectedSessionArchived,
    refreshSessionData,
    selectedSessionId,
    selectedSessionTitle,
    sessionsApiPath
  }).archive);

  const archiveFeedback = useUiFeedback({ source: "vibe64.sessions.archive.remote" });
  const shownArchiveFailures = new Set();
  watch(projectSlug, () => {
    archiveAttempts.value = {};
    agentActivityBySessionId.value = {};
    shownArchiveFailures.clear();
  });
  useRealtimeEvent({
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => payload.learningAttemptId
      ? !payload.projectSlug && learningLearnerId.value && [learningPayload.value?.active, ...(learningPayload.value?.history || []),
        ...learningSessions.value].some(attempt => (attempt?.attemptId || attempt?.learningAttemptId) === payload.learningAttemptId)
      : payload.projectSlug === projectSlug.value,
    onEvent: ({ payload = {} } = {}) => {
      const id = String(payload.sessionId || "");
      if (!id) return;
      if (payload.learningAttemptId && sessionListRealtimeShouldRefresh({ payload })) {
        void refetchEndpointResource(learningEndpoint.value)?.catch?.(() => null);
      }
      const activity = agentTurnRealtimeOverlayFromPayload(payload, id);
      if (activity) {
        agentActivityBySessionId.value[id] = latestAgentTurnRealtimeOverlay(
          agentActivityBySessionId.value[id],
          { active: activity.active, revision: activity.revision }
        );
      }
      if (payload.learningAttemptId) return;
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
      }
    }
  });
  watch(() => sessionList.items, (items) => {
    for (const id of Object.keys(agentActivityBySessionId.value)) {
      if (![...items, ...learningSessions.value].some((session) => session.sessionId === id)) delete agentActivityBySessionId.value[id];
    }
    for (const [id, attempt] of Object.entries(archiveAttempts.value)) {
      if (attempt.succeeded || archive.archivingSessionId === id) continue;
      const session = items.find((item) => item.sessionId === id);
      const operation = sessionArchiveOperation(session);
      if (!session || operation?.status === "failed" || (
        operation?.status !== "running" && session.metadata?.session_closing_reason !== "archived"
      )) {
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

  let createSessionInFlight = null;

  async function createSession(assistantSelection = {}, { pullRequestNumber, workflowEngineId, repositoryBranch } = {}) {
    if (learningMode.value) return { ok: false, error: "Open this saved lesson through its supported lesson controls; ordinary project creation is unavailable in Learning mode." };
    if (createSessionInFlight) {
      return createSessionInFlight;
    }
    const startedAtMs = Date.now();
    const creationProjectSlug = String(projectSlug.value || "").trim();
    const creationApiPath = sessionsApiPath.value;
    const creationAliasPath = currentSessionApiPath.value;
    const creationQueryKey = [...sessionListQueryKey.value];
    const creationSelection = workingSelection.capture?.() || { select: id => workingSelection.select(id) };
    vibe64SessionDebugLog("client.sessionData.createSession.start");
    createSessionPending.value = true;
    createSessionInFlight = (async () => {
      try {
        const response = await createSessionCommand.run({ assistantSelection, pullRequestNumber, workflowEngineId, repositoryBranch, apiPath: creationApiPath });
        if (
          !sessionDataDisposed &&
          creationProjectSlug === String(projectSlug.value || "").trim()
        ) {
          if (
            response?.creation &&
            response?.limits
          ) {
            queryClient.setQueryData(creationQueryKey, (currentPayload) => {
              if (
                !currentPayload ||
                typeof currentPayload !== "object" ||
                Array.isArray(currentPayload)
              ) {
                return currentPayload;
              }
              const currentSessions = Array.isArray(currentPayload.sessions)
                ? currentPayload.sessions
                : [];
              const createdSession = response.sessionId
                ? Object.fromEntries(Object.entries(response).filter(([key]) => ![
                    "creation",
                    "limits",
                    "ok"
                  ].includes(key)))
                : null;
              return {
                ...currentPayload,
                creation: response.creation,
                limits: response.limits,
                ...(createdSession && !currentSessions.some((item) => (
                  item?.sessionId === createdSession.sessionId
                ))
                  ? {
                      sessions: [...currentSessions, createdSession]
                    }
                  : {})
              };
            });
          }
          if (response?.sessionId) {
            if (learningMode.value) {
              creationSelection?.select(response.sessionId);
              if (response.ok !== false) void currentSessionPublisher.request({ apiPath: creationAliasPath, sessionId: response.sessionId });
            } else {
              selectSessionId(response.sessionId);
            }
          }
          if (learningMode.value) {
            void refetchEndpointResource(sessionListResource)?.catch?.(() => null);
          } else {
            refreshSessionDataInBackground({ includeList: true, reason: "create-session" });
          }
        }
        vibe64SessionDebugLog("client.sessionData.createSession.done", {
          ...vibe64SessionDebugSummary(response || {}),
          code: String(response?.code || response?.errors?.[0]?.code || ""),
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          ok: response?.ok !== false
        });
        return response;
      } catch (error) {
        vibe64SessionDebugLog("client.sessionData.createSession.error", {
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          error: vibe64SessionDebugError(error)
        });
        throw error;
      } finally {
        createSessionPending.value = false;
        createSessionInFlight = null;
      }
    })();
    return createSessionInFlight;
  }

  const selectionReconciliationState = computed(() => {
    const nextSessions = availableSessions.value;
    return {
      createSessionRunning: createSessionRunning.value,
      currentSessionApiPath: selectedCurrentSessionApiPath.value,
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
      sessionIds: nextSessions.map((session) => session.sessionId).join("|"),
      sessionListInitialLoading: sessionList.isInitialLoading,
      sessionListLoaded: sessionList.pages.length > 0 && (!learningMode.value || learningLoaded.value),
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
      (learningMode.value && !state.sessionListLoaded) ||
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
        if (state.selectedSessionMissing) {
          if (renewalStatus === "completed") {
            const renewedSuccessorId = renewedSuccessorSessionId({
              predecessorSessionId: state.selectedSessionId,
              sessions: nextSessions
            });
            if (renewedSuccessorId) {
              sessionSelection.selectAvailableId(nextSessions, {
                fallbackId: renewedSuccessorId,
                getId: (session) => session.sessionId
              });
            }
            return;
          }
          if (["failed", "running"].includes(renewalStatus)) {
            return;
          }
        }
        if (["failed", "running"].includes(renewalStatus)) {
          sessionSelection.select(state.selectionRenewalPredecessorId);
          return;
        }
      }
    }
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

  watch(selectionReconciliationState, (state) => {
    const publicationSessionId = selectedSessionIdForCurrentAlias({
      createSessionRunning: state.createSessionRunning,
      selectedSessionId: state.selectedSessionId,
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

  watch(selectedSessionTitle, (title) => {
    notifyTitleChange(title || "");
  }, {
    immediate: true
  });

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
    learningLearnerId,
    learningLoadError,
    learningLoaded,
    learningLoading,
    workingLoadError,
    availableSessions,
    pageLoading,
    refreshSessionData,
    selectSessionId,
    selectedSession,
    selectedSessionId,
    selectedSessionTitle,
    selectedSessionsApiPath,
    sessionList,
    sessions,
    sessionsApiPath,
    shortSessionId,
    statusColor: vibe64SessionStatusColor,
    statusLabel: vibe64SessionStatusLabel,
    updateCurrentSessionCommand
  };
}

export {
  sessionListRealtimeShouldRefresh,
  renewedSuccessorSessionId,
  selectedSessionIdForCurrentAlias,
  sessionIdExistsInList,
  shouldPreserveSelectedSessionDuringRefresh,
  useVibe64SessionData
};
