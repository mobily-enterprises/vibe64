import { computed, proxyRefs, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  blockingVibe64SessionPageError
} from "@/lib/vibe64SessionPanelModel.js";
import {
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";
import {
  sessionRecordHasActiveAgentWork,
  useVibe64SessionData
} from "@/composables/useVibe64SessionData.js";
import {
  useVibe64SessionViewSync
} from "@/composables/useVibe64SessionViewSync.js";

const vibe64SessionPanelEmits = ["title-change", "project-attention", "project-pane-change"];
const vibe64SessionPanelProps = {
  chatCollapsed: {
    default: false,
    type: Boolean
  },
  projectContext: {
    default: () => ({}),
    type: Object
  },
  githubActorTeleportTarget: {
    default: "",
    type: String
  },
  projectPane: {
    default: "",
    type: String
  },
  previewToolbarTeleportTarget: {
    default: "",
    type: String
  },
  saveProjectConfig: {
    default: null,
    type: Function
  },
  savingProjectConfig: {
    default: false,
    type: Boolean
  }
};

function useVibe64SessionPanel(props, emit) {
  const route = useRoute();

  const fallbackAbandon = {
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

  const selection = proxyRefs({
    isClosed: sessionData.isSelectedSessionClosed,
    selectedSession: sessionData.selectedSession,
    selectedSessionId: sessionData.selectedSessionId
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
    createSessionMode: sessionData.createSessionMode,
    createSessionTitle: sessionData.createSessionTitle,
    selectSession: sessionData.selectSessionId,
    sessions: toolbarSessions,
    shortSessionId: sessionData.shortSessionId,
    workflowDefinitions: sessionData.workflowDefinitions
  });
  useVibe64SessionViewSync({
    enabled: computed(() => Boolean(selection.selectedSessionId)),
    sessionId: () => selection.selectedSessionId,
    sessionsApiPath: sessionData.sessionsApiPath,
    viewState: computed(() => selection.selectedSession?.uiSync?.viewState || null)
  });

  const projectPane = computed(() => normalizeProjectPane(props.projectPane || route.query.pane));
  const chatCollapsed = computed(() => Boolean(props.chatCollapsed));
  const dashboardProjectActive = computed(() => projectPane.value === "dashboard");
  const emptyDashboardContext = computed(() => sessionPanelDashboardContext(props.projectContext));
  const emptyBlockedReason = computed(() => String(
    !toolbar.canCreateSession && toolbar.createSessionTitle ? toolbar.createSessionTitle : ""
  ).trim());
  const emptyChatHintText = computed(() => {
    if (emptyStateLoading.value) {
      return "Loading sessions.";
    }
    return emptyBlockedReason.value || "Use the + button to start a session.";
  });
  const emptyPreviewTitleText = computed(() => {
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
  const selectedRuntimeState = computed(() => runtimeStateBySessionId[selection.selectedSessionId] || null);
  const sessionLoadError = computed(() => Boolean(
    sessionData.sessionList.loadError ||
    sessionData.selectedSessionView?.loadError
  ));
  const runtimeHostSessionIds = computed(() => {
    const visibleSessionIds = new Set((toolbar.sessions || []).map((session) => session.sessionId));
    if (selection.selectedSession && selection.selectedSessionId) {
      visibleSessionIds.add(selection.selectedSessionId);
    }
    if (sessionLoadError.value) {
      for (const mountedSessionId of mountedRuntimeSessionIds.value) {
        visibleSessionIds.add(mountedSessionId);
      }
    }
    return mountedRuntimeSessionIds.value.filter((sessionId) => visibleSessionIds.has(sessionId));
  });
  const emptyStateLoading = computed(() => Boolean(
    sessionData.sessionList.isInitialLoading &&
    !selection.selectedSession &&
    runtimeHostSessionIds.value.length < 1
  ));
  const emptyLayoutVisible = computed(() => Boolean(!selection.selectedSession && runtimeHostSessionIds.value.length < 1));
  const selectedAbandon = computed(() => selectedRuntimeState.value?.toolbarControls?.abandon || fallbackAbandon);
  const rawPageError = computed(() => blockingVibe64SessionPageError({
    hasMountedRuntime: runtimeHostSessionIds.value.length > 0,
    runtimePageError: selectedRuntimeState.value?.pageError,
    selectedSession: selection.selectedSession,
    selectedSessionLoadError: sessionData.selectedSessionView?.loadError,
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
      if (selection.selectedSession) {
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
    if (selection.selectedSession) {
      ensureRuntimeHost(selection.selectedSessionId);
    }
  });

  watch(() => [
    selection.selectedSessionId,
    selection.selectedSession ? "selected" : "empty"
  ].join("|"), () => {
    if (selection.selectedSession) {
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
    emitProjectAttention,
    emitProjectPaneChange,
    emptyChatHintText,
    emptyCreateAttention,
    emptyDashboardContext,
    emptyLayoutVisible,
    emptyPreviewDetailText,
    emptyPreviewTitleText,
    emptyStateLoading,
    pageError,
    projectPane,
    runtimeHostSessionIds,
    selectedAbandon,
    selection,
    sessionData,
    setRuntimeBusy,
    setRuntimePageError,
    setRuntimeToolbarControls,
    toolbar,
    visiblePageError
  };

  function emitProjectPaneChange(pane = "") {
    emit("project-pane-change", pane);
  }

  function emitProjectAttention() {
    emit("project-attention");
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
        pageError: ""
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

function sessionPanelDashboardContext(projectContext = {}) {
  const safeProjectContext = projectContext && typeof projectContext === "object" && !Array.isArray(projectContext)
    ? projectContext
    : {};
  return {
    projectContext: safeProjectContext
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
    if (Boolean(session?.agentThinking) === agentThinking) {
      return session;
    }
    return {
      ...session,
      agentThinking
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

export {
  sessionPanelDashboardContext,
  sessionPanelRuntimeHostDiagnostics,
  sessionPanelToolbarSessions,
  useVibe64SessionPanel,
  vibe64SessionPanelEmits,
  vibe64SessionPanelProps
};
