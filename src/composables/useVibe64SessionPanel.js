import { computed, proxyRefs, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import {
  blockingVibe64SessionPageError
} from "@/lib/vibe64SessionPanelModel.js";
import {
  useVibe64SessionData
} from "@/composables/useVibe64SessionData.js";

const vibe64SessionPanelEmits = ["title-change", "project-attention", "project-pane-change"];
const vibe64SessionPanelProps = {
  chatCollapsed: {
    default: false,
    type: Boolean
  },
  projectPane: {
    default: "",
    type: String
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
  const toolbar = proxyRefs({
    canCreateSession: sessionData.canCreateSession,
    createSession: sessionData.createSession,
    createSessionCommand: sessionData.createSessionCommand,
    createSessionMode: sessionData.createSessionMode,
    createSessionTitle: sessionData.createSessionTitle,
    selectSession: sessionData.selectSessionId,
    sessions: sessionData.sessions,
    shortSessionId: sessionData.shortSessionId,
    workflowDefinitions: sessionData.workflowDefinitions
  });

  const projectPane = computed(() => normalizeProjectPane(props.projectPane || route.query.pane));
  const chatCollapsed = computed(() => Boolean(props.chatCollapsed));
  const dashboardProjectActive = computed(() => projectPane.value === "dashboard");
  const emptyDashboardContext = Object.freeze({});
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
    busy = false,
    sessionId = ""
  } = {}) {
    const state = ensureRuntimeState(sessionId);
    if (state) {
      state.busy = Boolean(busy);
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
  return ["configure", "dashboard", "history", "preview", "run", "setup"].includes(value)
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

export {
  useVibe64SessionPanel,
  vibe64SessionPanelEmits,
  vibe64SessionPanelProps
};
