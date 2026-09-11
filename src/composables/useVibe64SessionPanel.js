import { computed, proxyRefs, reactive, ref, unref, watch } from "vue";
import { useRoute } from "vue-router";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import {
  blockingVibe64SessionPageError
} from "@/lib/vibe64SessionPanelModel.js";
import {
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";
import {
  useVibe64SessionData
} from "@/composables/useVibe64SessionData.js";
import {
  useVibe64SessionRepositoryStatusRegistry
} from "@/composables/useVibe64SessionRepositoryStatusRegistry.js";
import {
  sessionRecordHasActiveAgentWork
} from "@/lib/vibe64MountedSessionState.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  PROJECT_SETTINGS_ENDPOINT,
  VIBE64_PROJECT_CHANGED_EVENT,
  projectSettingsQueryKey
} from "@/lib/studioGateApi.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";

const vibe64SessionPanelEmits = [
  "chat-attention",
  "execution-attention",
  "title-change",
  "project-attention"
];
const vibe64SessionPanelProps = {
  chatCollapsed: {
    default: false,
    type: Boolean
  },
  githubActorTeleportTarget: {
    default: "",
    type: String
  },
  projectContext: {
    default: () => ({}),
    type: Object
  },
  projectPane: {
    default: "",
    type: String
  },
  previewToolbarTeleportTarget: {
    default: "",
    type: String
  }
};

function useVibe64SessionPanel(props, emit) {
  const route = useRoute();
  const projectSlug = useVibe64ProjectSlug();

  const fallbackArchive = {
    command: {
      isRunning: false
    },
    request: () => null
  };
  const dismissedPageError = ref("");
  const mountedRuntimeSessionIds = ref([]);
  const runtimeStateBySessionId = reactive({});
  const sessionData = useVibe64SessionData({
    onTitleChange(title) {
      emit("title-change", title);
    }
  });
  const projectSettingsKey = computed(() => projectSettingsQueryKey(
    VIBE64_SURFACE_ID,
    ROUTE_VISIBILITY_PUBLIC,
    projectSlug.value
  ));
  const projectSettings = useEndpointResource({
    enabled: computed(() => Boolean(projectSlug.value)),
    fallbackLoadError: "Project settings could not load.",
    path: computed(() => scopedDevelopmentApiUrl(PROJECT_SETTINGS_ENDPOINT, projectSlug.value)),
    queryKey: projectSettingsKey,
    realtime: {
      event: VIBE64_PROJECT_CHANGED_EVENT,
      // Refresh both the selected-source reader and source-specific settings pages.
      queryKey: computed(() => projectSettingsKey.value.slice(0, -1))
    },
    refreshOnPull: true,
    requestRecoveryLabel: "Project settings"
  });
  const promptHintPolicy = computed(() => {
    const promptHints = projectSettings.data.value?.promptHints;
    return {
      enabled: promptHints?.enabled !== false,
      ready: Boolean(promptHints && !projectSettings.loadError.value)
    };
  });
  const selection = proxyRefs({
    isArchived: sessionData.isSelectedSessionArchived,
    selectedSession: sessionData.selectedSession,
    selectedSessionId: sessionData.selectedSessionId
  });
  let repositoryStatusRegistry = {
    observe: () => null
  };
  repositoryStatusRegistry = useVibe64SessionRepositoryStatusRegistry({
    onState: applyRuntimeWorkState,
    selectedSessionId: () => selection.selectedSessionId,
    sessionSourceOperationsSuspended: (sessionId) => (
      runtimeStateBySessionId[sessionId]?.sourceOperationsSuspended === true
    ),
    sessions: sessionData.sessions,
    sessionsApiPath: sessionData.sessionsApiPath
  });
  const toolbarSessions = computed(() => sessionPanelToolbarSessions({
    runtimeStateBySessionId,
    selectedSession: selection.selectedSession,
    selectedSessionId: selection.selectedSessionId,
    sessions: sessionData.sessions.value || []
  }));
  const toolbar = proxyRefs({
    canCreateSession: sessionData.canCreateSession,
    createSession: sessionData.createSession,
    createSessionCommand: sessionData.createSessionCommand,
    createSessionRunning: sessionData.createSessionRunning,
    createSessionVisible: sessionData.createSessionVisible,
    createSessionTitle: sessionData.createSessionTitle,
    selectSession: sessionData.selectSessionId,
    sessions: toolbarSessions,
    shortSessionId: sessionData.shortSessionId
  });
  const projectPane = computed(() => normalizeProjectPane(props.projectPane || route.query.pane));
  const chatCollapsed = computed(() => Boolean(props.chatCollapsed));
  const dashboardProjectActive = computed(() => projectPane.value === "dashboard");
  const emptyDashboardContext = computed(() => sessionPanelDashboardContext(
    props.projectContext,
    sessionData.sessionsApiPath
  ));
  const emptyBlockedReason = computed(() => String(
    !toolbar.canCreateSession && toolbar.createSessionTitle ? toolbar.createSessionTitle : ""
  ).trim());
  const selectedRuntimeState = computed(() => runtimeStateBySessionId[selection.selectedSessionId] || null);
  const sessionLoadError = computed(() => Boolean(sessionData.sessionList.loadError));
  const runtimeHostSessionIds = computed(() => {
    const visibleSessionIds = new Set((toolbar.sessions || []).filter((session) => !session.archiving).map((session) => session.sessionId));
    if (selection.selectedSessionId) {
      visibleSessionIds.add(selection.selectedSessionId);
    }
    if (sessionLoadError.value) {
      for (const mountedSessionId of mountedRuntimeSessionIds.value) {
        visibleSessionIds.add(mountedSessionId);
      }
    }
    return mountedRuntimeSessionIds.value.filter((sessionId) => visibleSessionIds.has(sessionId));
  });
  const emptyStateActivity = computed(() => sessionPanelEmptyStateActivity({
    createSessionRunning: sessionData.createSessionRunning.value,
    runtimeHostSessionCount: runtimeHostSessionIds.value.length,
    selectedSession: selection.selectedSession,
    sessionListInitialLoading: sessionData.sessionList.isInitialLoading
  }));
  const emptyStateLoading = computed(() => Boolean(emptyStateActivity.value));
  const emptyStateInitialLoading = computed(() => emptyStateActivity.value === "loading");
  const emptyStateStatusText = computed(() => (
    emptyStateActivity.value === "creating" ? "Creating session." : "Loading sessions."
  ));
  const emptyChatHintText = computed(() => {
    if (emptyStateActivity.value === "creating") {
      return "Creating session.";
    }
    if (emptyStateActivity.value === "loading") {
      return "Loading sessions.";
    }
    return emptyBlockedReason.value || "Use the + button to start a session.";
  });
  const emptyPreviewTitleText = computed(() => {
    if (emptyStateActivity.value === "creating") {
      return "Creating session.";
    }
    return emptyStateLoading.value ? "Loading session." : "Create a session to start preview.";
  });
  const emptyPreviewDetailText = computed(() => {
    if (emptyStateLoading.value) {
      return "";
    }
    return emptyBlockedReason.value;
  });
  const emptyCreateAttention = computed(() => Boolean(
    !emptyStateLoading.value &&
    toolbar.canCreateSession &&
    (toolbar.sessions || []).length < 1
  ));
  const emptyLayoutVisible = computed(() => !selection.selectedSession);
  const selectedArchive = computed(() => sessionData.archive || fallbackArchive);
  const selectedSessionArchiving = computed(() => sessionPanelSelectedSessionArchiving({
    archive: selectedArchive.value,
    selectedSessionId: selection.selectedSessionId
  }));
  const rawPageError = computed(() => blockingVibe64SessionPageError({
    hasMountedRuntime: runtimeHostSessionIds.value.length > 0,
    runtimePageError: selectedRuntimeState.value?.pageError,
    selectedSession: selection.selectedSession,
    selectedSessionLoadError: "",
    sessionListLoadError: sessionData.sessionList.loadError,
    sessions: toolbar.sessions || []
  }));
  const pageError = computed(() => sessionPanelPageErrorMessage(rawPageError.value));
  const visiblePageError = computed(() => Boolean(
    pageError.value &&
    dismissedPageError.value !== pageError.value
  ));
  const runtimeHostDiagnostics = computed(() => sessionPanelRuntimeHostDiagnostics({
    mountedRuntimeSessionIds: mountedRuntimeSessionIds.value,
    runtimeHostSessionIds: runtimeHostSessionIds.value,
    runtimeStateBySessionId,
    selectedSessionId: selection.selectedSessionId,
    sessionLoadError: sessionLoadError.value,
    sessions: toolbar.sessions || []
  }));

  watch(sessionData.sessions, (sessions = []) => {
    if (sessionLoadError.value) {
      if (selection.selectedSessionId) {
        ensureRuntimeHost(selection.selectedSessionId);
      }
      return;
    }
    const visibleSessionIds = new Set(sessions.map((session) => session.sessionId));
    mountedRuntimeSessionIds.value = mountedRuntimeSessionIds.value.filter((sessionId) => visibleSessionIds.has(sessionId));
    for (const sessionId of Object.keys(runtimeStateBySessionId)) {
      if (!visibleSessionIds.has(sessionId)) {
        delete runtimeStateBySessionId[sessionId];
      }
    }
    if (selection.selectedSessionId) {
      ensureRuntimeHost(selection.selectedSessionId);
    }
  });

  watch(() => [
    selection.selectedSessionId,
    selection.selectedSessionId ? "selected" : "empty"
  ].join("|"), () => {
    if (selection.selectedSessionId) {
      ensureRuntimeHost(selection.selectedSessionId);
    }
  }, {
    immediate: true
  });

  watch(pageError, (error) => {
    if (!error) {
      dismissedPageError.value = "";
    }
  });

  watch(runtimeHostDiagnostics, (diagnostics) => {
    vibe64SessionDebugLog("client.sessionPanel.runtimeHosts.changed", diagnostics);
  }, {
    immediate: true
  });

  return {
    chatCollapsed,
    dashboardProjectActive,
    dismissPageError,
    emitChatAttention,
    emitProjectAttention,
    emptyChatHintText,
    emptyCreateAttention,
    emptyDashboardContext,
    emptyLayoutVisible,
    emptyPreviewDetailText,
    emptyPreviewTitleText,
    emptyStateInitialLoading,
    emptyStateLoading,
    emptyStateStatusText,
    pageError,
    promptHintPolicy,
    projectPane,
    runtimeHostSessionIds,
    selectedArchive,
    selectedSessionArchiving,
    selection,
    sessionData,
    setRuntimeBusy,
    setRuntimePageError,
    setRuntimeSourceOperationsSuspended,
    setRuntimeWorkState,
    setRuntimeToolbarControls,
    toolbar,
    visiblePageError
  };

  function emitProjectAttention() {
    emit("project-attention");
  }

  function emitChatAttention() {
    emit("chat-attention");
  }

  function dismissPageError() {
    dismissedPageError.value = String(pageError.value || "");
  }

  function ensureRuntimeState(sessionId = "") {
    const key = String(sessionId || "");
    if (!key) {
      return null;
    }
    if (!runtimeStateBySessionId[key]) {
      runtimeStateBySessionId[key] = {
        toolbarControls: null,
        agentThinking: false,
        busy: false,
        pageError: "",
        sourceOperationsSuspended: false,
        repositoryWorkState: {
          checkedAt: "",
          state: "checking"
        }
      };
    }
    return runtimeStateBySessionId[key];
  }

  function ensureRuntimeHost(sessionId = "") {
    const key = String(sessionId || "");
    if (!key || mountedRuntimeSessionIds.value.includes(key)) {
      return;
    }
    mountedRuntimeSessionIds.value = [
      ...mountedRuntimeSessionIds.value,
      key
    ];
    ensureRuntimeState(key);
  }

  function setRuntimeToolbarControls({
    controls = null,
    sessionId = ""
  } = {}) {
    const state = ensureRuntimeState(sessionId);
    if (state) {
      state.toolbarControls = controls;
    }
  }

  function setRuntimeBusy({
    agentThinking = false,
    busy = false,
    sessionId = ""
  } = {}) {
    const state = ensureRuntimeState(sessionId);
    if (state) {
      state.busy = Boolean(busy);
      state.agentThinking = Boolean(agentThinking);
    }
  }

  function setRuntimePageError({
    error = "",
    sessionId = ""
  } = {}) {
    const state = ensureRuntimeState(sessionId);
    if (state) {
      state.pageError = String(error || "");
    }
  }

  function setRuntimeSourceOperationsSuspended({
    sessionId = "",
    suspended = false
  } = {}) {
    const state = ensureRuntimeState(sessionId);
    if (state) {
      state.sourceOperationsSuspended = suspended === true;
    }
  }

  function setRuntimeWorkState({
    sessionId = "",
    workState = null
  } = {}) {
    repositoryStatusRegistry.observe(sessionId, workState);
  }

  function applyRuntimeWorkState({
    sessionId = "",
    workState = null
  } = {}) {
    const state = ensureRuntimeState(sessionId);
    if (state) {
      state.repositoryWorkState = sessionRepositoryWorkState(workState);
    }
  }
}

function sessionRepositoryWorkState(workState = null) {
  const source = workState && typeof workState === "object" ? workState : {};
  const freshness = {
    checkedAt: String(source.checkedAt || ""),
    ...(source.updateStatusPending === true ? { updateStatusPending: true } : {})
  };
  const operationStatus = String(source.operation?.status || "").trim();
  const operationCode = String(source.operation?.code || "").trim();
  const updateStatus = String(source.updateOperation?.status || "").trim();
  if (operationStatus === "running") {
    return {
      ...freshness,
      state: "saving"
    };
  }
  if (updateStatus === "running") {
    return {
      ...freshness,
      state: "updating"
    };
  }
  if (
    (operationStatus === "failed" && operationCode !== "vibe64_session_save_update_required") ||
    updateStatus === "failed"
  ) {
    return {
      ...freshness,
      state: "needs_help",
      updateAvailable: source.updateAvailable === true
    };
  }
  if ((source.loading || source.unsaved === null || source.unsaved === undefined) && source.updateAvailable !== true) {
    return {
      ...freshness,
      state: source.error ? "unavailable" : "checking"
    };
  }
  const changedCount = Array.isArray(source.changedPaths) ? source.changedPaths.length : 0;
  if (source.unsaved === true) {
    return {
      changedCount,
      ...freshness,
      state: "unsaved",
      updateAvailable: source.updateAvailable === true
    };
  }
  return {
    ...freshness,
    state: source.error
      ? "unavailable"
      : (source.updateAvailable === true ? "update_available" : "saved")
  };
}

function normalizeProjectPane(value = "") {
  return ["dashboard", "preview"].includes(value)
    ? value
    : "preview";
}

function sessionPanelPageErrorMessage(error = "") {
  const message = String(error || "").trim();
  if (/^request failed\.?$/iu.test(message)) {
    return "The session API request failed. Check that the Vibe64 server is running, then refresh the session.";
  }
  return message;
}

function sessionPanelSelectedSessionArchiving({
  archive = null,
  selectedSessionId = ""
} = {}) {
  const selectedId = String(selectedSessionId || "").trim();
  const archivingId = String(archive?.archivingSessionId || "").trim();
  return Boolean(archive?.archiving && selectedId && archivingId === selectedId);
}

function sessionPanelDashboardContext(projectContext = {}, sessionsApiPath = "") {
  const safeProjectContext = projectContext && typeof projectContext === "object" && !Array.isArray(projectContext)
    ? projectContext
    : {};
  return {
    projectContext: safeProjectContext,
    sessionsApiPath: String(unref(sessionsApiPath) || "")
  };
}

function sessionPanelToolbarSessions({
  runtimeStateBySessionId = {},
  selectedSession = null,
  selectedSessionId = "",
  sessions = []
} = {}) {
  const normalizedSelectedSessionId = String(selectedSessionId || "").trim();
  return sessions.map((session) => {
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId) {
      return session;
    }
    const runtimeState = runtimeStateBySessionId[sessionId] || null;
    const sourceSession = sessionId === normalizedSelectedSessionId &&
      selectedSession?.sessionId === sessionId
      ? selectedSession
      : session;
    const agentThinking = Boolean(
      runtimeState?.busy ||
      runtimeState?.agentThinking ||
      sessionRecordHasActiveAgentWork(sourceSession)
    );
    return {
      ...session,
      agentThinking,
      repositoryWorkState: runtimeState?.repositoryWorkState || {
        checkedAt: "",
        state: "checking"
      }
    };
  });
}

function sessionPanelRuntimeHostDiagnostics({
  mountedRuntimeSessionIds = [],
  runtimeHostSessionIds = [],
  runtimeStateBySessionId = {},
  selectedSessionId = "",
  sessionLoadError = false,
  sessions = []
} = {}) {
  const mountedIds = mountedRuntimeSessionIds.map((sessionId) => String(sessionId || "").trim()).filter(Boolean);
  const renderedIds = runtimeHostSessionIds.map((sessionId) => String(sessionId || "").trim()).filter(Boolean);
  const sessionIds = sessions.map((session) => String(session?.sessionId || "").trim()).filter(Boolean);
  const renderedSet = new Set(renderedIds);
  const selectedId = String(selectedSessionId || "").trim();
  const sessionSet = new Set(sessionIds);
  const stateIds = Object.keys(runtimeStateBySessionId || {}).map((sessionId) => String(sessionId || "").trim()).filter(Boolean);
  const states = stateIds.map((sessionId) => runtimeStateBySessionId[sessionId]).filter(Boolean);

  return {
    activeRuntimeHostCount: selectedId && mountedIds.includes(selectedId) ? 1 : 0,
    busyRuntimeHostCount: states.filter((state) => Boolean(state?.busy)).length,
    hiddenMountedRuntimeHostCount: mountedIds.filter((sessionId) => sessionId !== selectedId).length,
    mountedRuntimeHostCount: mountedIds.length,
    mountedRuntimeSessionIds: mountedIds,
    orphanedMountedRuntimeHostCount: mountedIds.filter((sessionId) => !sessionSet.has(sessionId)).length,
    pageErrorRuntimeHostCount: states.filter((state) => String(state?.pageError || "").trim()).length,
    renderedRuntimeHostCount: renderedIds.length,
    renderedRuntimeSessionIds: renderedIds,
    runtimeStateCount: stateIds.length,
    selectedSessionId: selectedId,
    sessionLoadError: Boolean(sessionLoadError),
    unrenderedMountedRuntimeHostCount: mountedIds.filter((sessionId) => !renderedSet.has(sessionId)).length,
    visibleRuntimeHostCount: renderedIds.length,
    visibleRuntimeSessionIds: renderedIds,
    visibleSessionCount: sessionIds.length
  };
}

function sessionPanelEmptyStateActivity({
  createSessionRunning = false,
  runtimeHostSessionCount = 0,
  selectedSession = null,
  sessionListInitialLoading = false
} = {}) {
  if (selectedSession || Number(runtimeHostSessionCount) > 0) {
    return "";
  }
  if (createSessionRunning) {
    return "creating";
  }
  return sessionListInitialLoading ? "loading" : "";
}

export {
  sessionPanelDashboardContext,
  sessionPanelEmptyStateActivity,
  sessionPanelRuntimeHostDiagnostics,
  sessionPanelSelectedSessionArchiving,
  sessionRepositoryWorkState,
  sessionPanelToolbarSessions,
  useVibe64SessionPanel,
  vibe64SessionPanelEmits,
  vibe64SessionPanelProps
};
