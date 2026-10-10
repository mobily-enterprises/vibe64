import { computed, nextTick, onBeforeUnmount, onMounted, proxyRefs, ref, unref, watch } from "vue";
import { isNavigationFailure, NavigationFailureType, useRoute, useRouter } from "vue-router";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { VIBE64_PROJECT_CHANGED_EVENT } from "@/lib/studioGateApi.js";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useVibe64ConversationRuntime } from "@/composables/useVibe64ConversationRuntime.js";
import { useVibe64SessionRenewal } from "@/composables/useVibe64SessionRenewal.js";
import { sessionRecordHasActiveAgentWork } from "@/lib/vibe64MountedSessionState.js";
import {
  isArchivedVibe64Session,
  vibe64SessionDisplayTitle,
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel
} from "@/lib/vibe64SessionViewModel.js";
import {
  agentTurnControlPayloadFromContext,
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";
import { vibe64ApiError, vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";

const SESSION_WORK_TASK_IDS = ["codex_turn_checkpoint", "save-work", "update-session"];

async function focusRuntimeSessionChat(sessionId = "", root = globalThis.document) {
  const normalizedId = String(sessionId || "").trim();
  if (!normalizedId || !root?.querySelectorAll) {
    return false;
  }
  await nextTick();
  await nextTick();
  const runtime = [...root.querySelectorAll("[data-vibe64-session-runtime-id]")]
    .find((element) => element.getAttribute("data-vibe64-session-runtime-id") === normalizedId);
  const target = runtime?.querySelector?.(".studio-autopilot__chat-panel");
  target?.focus?.({ preventScroll: true });
  return Boolean(target);
}

function proxySessionDialogs(dialogs = {}) {
  return Object.fromEntries(
    Object.entries(dialogs).map(([name, dialog]) => [name, proxyRefs(dialog)])
  );
}

function runtimeHostToolbarSessions({
  activeAgentThinking = false,
  fallbackSessions = [],
  selectedSession = null,
  selectedSessionId = "",
  sessions = null
} = {}) {
  const currentId = String(selectedSessionId || "").trim();
  const navigationSessions = sessions ?? fallbackSessions;
  return (Array.isArray(navigationSessions) ? navigationSessions : []).map((session) => {
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId) {
      return session;
    }
    const source = sessionId === currentId && selectedSession?.sessionId === sessionId
      ? selectedSession
      : session;
    const agentThinking = Boolean(
      (sessionId === currentId ? activeAgentThinking : session.agentThinking) ||
      sessionRecordHasActiveAgentWork(source)
    );
    return Boolean(session?.agentThinking) === agentThinking
      ? session
      : { ...session, agentThinking };
  });
}

function runtimeHostAgentWorking({
  selectedSession = null,
  transientAgentThinking = false
} = {}) {
  return Boolean(
    transientAgentThinking ||
    sessionRecordHasActiveAgentWork(selectedSession)
  );
}

function agentMessageAcceptanceSignal(controller) {
  return controller.signal;
}

function createVibe64SessionWorkRefreshQueue({ inspect } = {}) {
  if (typeof inspect !== "function") {
    throw new TypeError("Session work refresh requires an inspector.");
  }
  let active = null;
  let disposed = false;
  let refreshAfterActive = false;

  async function drain() {
    do {
      refreshAfterActive = false;
      await inspect({
        isCurrent: () => !disposed && !refreshAfterActive
      });
    } while (!disposed && refreshAfterActive);
  }

  function request() {
    if (disposed) {
      return Promise.resolve();
    }
    if (active) {
      refreshAfterActive = true;
      return active;
    }
    active = Promise.resolve().then(drain).finally(() => {
      active = null;
    });
    return active;
  }

  return Object.freeze({
    dispose() {
      disposed = true;
      refreshAfterActive = false;
    },
    request
  });
}

function runtimeHostWorkTaskRevision(session = {}) {
  return (Array.isArray(session?.backgroundTasks) ? session.backgroundTasks : [])
    .filter((task) => SESSION_WORK_TASK_IDS.includes(String(task?.id || "")))
    .map((task) => {
      const events = Array.isArray(task?.events) ? task.events : [];
      const latestEvent = events.at(-1) || {};
      return [
        String(task?.id || ""),
        String(task?.status || ""),
        String(task?.updatedAt || ""),
        String(events.length),
        String(latestEvent.at || ""),
        String(latestEvent.kind || ""),
        String(latestEvent.status || "")
      ].join(":");
    })
    .sort()
    .join("|");
}

function runtimeHostWorkTaskState(session = {}) {
  const tasks = Array.isArray(session?.backgroundTasks) ? session.backgroundTasks : [];
  const operation = tasks.find((task) => String(task?.id || "") === "save-work") || null;
  const updateOperation = tasks.find((task) => String(task?.id || "") === "update-session") || null;
  const activeOperation = [operation, updateOperation].find((task) => (
    ["queued", "running", "starting"].includes(String(task?.status || "").trim().toLowerCase())
  ));
  return {
    activeOperation: activeOperation
      ? {
          kind: activeOperation === operation ? "save" : "update",
          operationId: String(activeOperation.operationId || "").trim()
        }
      : null,
    operation,
    updateOperation
  };
}

function useVibe64SessionRuntimeHost(props, emit) {
  const route = useRoute();
  const router = useRouter();
  // The panel retains this keyed host while its purpose is hidden. Its lesson
  // identity belongs to the saved record, never the currently visible filter.
  const initialSession = (unref(props.sessionData.sessions) || []).find(
    session => session.sessionId === String(props.sessionId || "").trim()
  );
  const learningScope = initialSession?.purpose === "learning" ? {
    learningAttemptId: String(initialSession.learningAttemptId || "").trim(),
    learnerId: String(readRefOrGetterValue(props.sessionData.learningLearnerId) || "").trim(),
    sessionId: initialSession.sessionId,
    noExercise: initialSession.noExercise !== false,
    sourceProjectSlug: initialSession.noExercise === false ? String(initialSession.projectSlug || "").trim() : ""
  } : null;
  if (learningScope && (
    !learningScope.learnerId || !learningScope.learningAttemptId ||
    (learningScope.noExercise ? learningScope.sessionId !== `learning-${learningScope.learningAttemptId}`
      : !learningScope.sessionId || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(learningScope.sourceProjectSlug))
  )) {
    throw new Error("This learning conversation has no confirmed learner and attempt.");
  }
  const selectedSessionId = computed(() => learningScope?.sessionId || String(props.sessionId || "").trim());
  const sessionsApiPath = learningScope
    ? `/api/learning/${encodeURIComponent(learningScope.learningAttemptId)}/vibe64/sessions`
    : props.sessionData.sessionsApiPath;
  const runtimeProjectContext = computed(() => learningScope ? {} : props.projectContext || {});
  const selectedListSession = computed(() => {
    const sessions = unref(props.sessionData.sessions) || [];
    return sessions.find((session) => session.sessionId === selectedSessionId.value) || null;
  });
  const conversationRuntime = useVibe64ConversationRuntime({
    active: computed(() => Boolean(props.active)),
    projectSlug: computed(() => runtimeProjectContext.value.slug || ""),
    sessionId: selectedSessionId,
    sessionsApiPath,
    ...(learningScope ? {
      learningAttemptId: learningScope.learningAttemptId,
      learnerId: learningScope.learnerId,
      noExercise: learningScope.noExercise,
      sourceProjectSlug: learningScope.sourceProjectSlug
    } : {}),
    summarySession: selectedListSession
  });
  const mounted = {
    session: computed(() => conversationRuntime.value?.mounted.session.value || null),
    detailState: computed(() => conversationRuntime.value?.mounted.detailState.value || {}),
    agentConnectionError: computed(() => conversationRuntime.value?.mounted.agentConnectionError.value || ""),
    agentConnectionStatus: computed(() => conversationRuntime.value?.mounted.agentConnectionStatus.value || "initializing"),
    refresh: options => conversationRuntime.value?.mounted.refresh(options),
    retryAgentConnection: (...args) => conversationRuntime.value?.mounted.retryAgentConnection(...args)
  };
  const selectedSession = mounted.session;
  const selectedSessionArchived = computed(() => isArchivedVibe64Session(selectedSession.value || {}));
  const selectedSessionTitle = computed(() => (
    vibe64SessionDisplayTitle(selectedSession.value || {}) ||
    `Session ${props.sessionData.shortSessionId(selectedSessionId.value)}`
  ));
  const autopilotAgentThinking = ref(false);
  const activeAgentWorking = computed(() => runtimeHostAgentWorking({
    selectedSession: selectedSession.value,
    transientAgentThinking: autopilotAgentThinking.value
  }));
  const workState = ref({
    checkedAt: "",
    error: "",
    loading: !learningScope,
    operation: null,
    unsaved: null
  });
  useRealtimeEvent({
    event: VIBE64_PROJECT_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => !learningScope && payload.projectSlug === props.projectContext?.slug &&
      typeof payload.repositoryWorkflow?.requirePullRequest === "boolean",
    onEvent: ({ payload }) => {
      workState.value = {
        ...workState.value,
        publicationRequiresPullRequest: workState.value.destination?.mode === "github" &&
          payload.repositoryWorkflow.requirePullRequest
      };
    }
  });
  let workStateActive = true;

  async function inspectWorkState({ isCurrent }) {
    const sessionId = selectedSessionId.value;
    const sessionArchived = selectedSessionArchived.value;
    const requestIsCurrent = () => Boolean(
      workStateActive &&
      isCurrent() &&
      !sourceOperationsSuspended.value &&
      selectedSessionId.value === sessionId &&
      selectedSessionArchived.value === sessionArchived
    );
    if (sourceOperationsSuspended.value) {
      return;
    }
    if (!sessionId || sessionArchived) {
      if (requestIsCurrent()) {
        workState.value = {
          checkedAt: new Date().toISOString(),
          error: "",
          loading: false,
          operation: null,
          unsaved: null
        };
      }
      return;
    }
    if (
      requestIsCurrent() &&
      (workState.value.unsaved === null || workState.value.unsaved === undefined)
    ) {
      workState.value = {
        ...workState.value,
        loading: true
      };
    }
    try {
      const result = await getHttpWebClient().request(
        vibe64SessionPath(
          readRefOrGetterValue(props.sessionData.sessionsApiPath),
          sessionId,
          "/work"
        ),
        { method: "GET" }
      );
      if (result?.ok === false) {
        throw new Error(vibe64ApiResponseError(result, "Session work could not be inspected."));
      }
      if (requestIsCurrent()) {
        workState.value = {
          ...result,
          checkedAt: new Date().toISOString(),
          error: "",
          loading: false
        };
      }
    } catch (error) {
      if (requestIsCurrent()) {
        workState.value = {
          checkedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error || "Session work could not be inspected."),
          loading: false,
          operation: null,
          unsaved: null
        };
      }
    }
  }

  const workStateRefreshQueue = createVibe64SessionWorkRefreshQueue({
    inspect: inspectWorkState
  });

  async function refreshWorkState(observedWork = null) {
    if (sourceOperationsSuspended.value) {
      return workState.value;
    }
    if (
      observedWork &&
      typeof observedWork === "object" &&
      observedWork.ok !== false &&
      String(observedWork.sessionId || "").trim() === selectedSessionId.value
    ) {
      workState.value = {
        ...observedWork,
        checkedAt: new Date().toISOString(),
        error: "",
        loading: false
      };
      return workState.value;
    }
    await workStateRefreshQueue.request();
    return workState.value;
  }

  async function refreshSessionData(options = {}) {
    const includeList = options?.includeList === true;
    if (!includeList) {
      return mounted.refresh(options);
    }
    return Promise.allSettled([
      mounted.refresh(options),
      props.sessionData.refreshSessionData(options)
    ]);
  }

  const renewalModel = useVibe64SessionRenewal({
    active: computed(() => Boolean(props.active)),
    focusSession: focusRuntimeSessionChat,
    refreshSessionData: props.sessionData.refreshSessionData,
    selectSession: async (successorId) => {
      const predecessorId = selectedSessionId.value;
      const sessionData = props.sessionData;
      const projectSlug = runtimeProjectContext.value.slug;
      const apiPath = readRefOrGetterValue(sessionsApiPath);
      const target = { path: route.path, hash: route.hash, query: { ...route.query, session: successorId } };
      const sameRenewal = () => {
        const renewal = unref(renewalModel.renewal);
        return workStateActive && props.sessionData === sessionData &&
          selectedSessionId.value === predecessorId && runtimeProjectContext.value.slug === projectSlug &&
          readRefOrGetterValue(sessionsApiPath) === apiPath && renewal?.status === "completed" &&
          String(renewal.successor?.sessionId || "").trim() === successorId;
      };
      const canNavigate = () => sameRenewal() && props.active &&
        readRefOrGetterValue(sessionData.selectedSessionId) === predecessorId;
      const removeGuard = router.beforeResolve((to) => {
        if (to.path === target.path && to.hash === target.hash && to.query.session === successorId && !canNavigate()) {
          return false;
        }
      });
      try {
        const failure = await router.replace(target);
        if (failure && !isNavigationFailure(failure, NavigationFailureType.duplicated)) {
          throw failure;
        }
        if (!sameRenewal() || route.path !== target.path || route.hash !== target.hash ||
          route.query.session !== successorId) return false;
        // The route watcher normally selects the successor and hides this host.
        // Never replace a newer explicit tab choice after awaiting navigation.
        if (readRefOrGetterValue(sessionData.selectedSessionId) === successorId) return true;
        if (!canNavigate()) return false;
        sessionData.selectSessionId(successorId);
        return true;
      } finally {
        removeGuard();
      }
    },
    selectedSession,
    // Source-less lessons have no renewal workspace. Keep the original owner
    // present, with no resource target or background request.
    selectedSessionId: learningScope ? "" : selectedSessionId,
    sessionsApiPath: learningScope ? "" : sessionsApiPath
  });
  const sourceOperationsSuspended = computed(() => Boolean(
    learningScope || unref(renewalModel.sourceOperationsSuspended)
  ));
  const dialogs = proxySessionDialogs({
    archive: props.sessionData.archive,
    renewal: renewalModel
  });
  const conversationLog = computed(() => conversationRuntime.value?.conversationLog || null);
  const selection = proxyRefs({
    isArchived: selectedSessionArchived,
    selectedSession,
    selectedSessionDetailState: mounted.detailState,
    selectedSessionId,
    selectedSessionTitle,
    statusColor: vibe64SessionStatusColor,
    statusLabel: vibe64SessionStatusLabel
  });
  const autopilotSessionToolbar = proxyRefs({
    sessionsApiPath,
    workingSessionsApiPath: props.sessionData.sessionsApiPath,
    refreshSessionData,
    projectContext: runtimeProjectContext,
    refreshRepositoryState: props.refreshRepositoryState,
    canCreateSession: props.sessionData.canCreateSession,
    createSession: props.sessionData.createSession,
    createSessionCommand: props.sessionData.createSessionCommand,
    createSessionRunning: props.sessionData.createSessionRunning,
    createSessionVisible: props.sessionData.createSessionVisible,
    ...(learningScope ? { canCreateSession: false, createSessionVisible: false } : {}),
    createSessionTitle: props.sessionData.createSessionTitle,
    selectSession: props.sessionData.selectSessionId,
    sessions: computed(() => runtimeHostToolbarSessions({
      activeAgentThinking: activeAgentWorking.value,
      fallbackSessions: unref(props.sessionData.sessions),
      selectedSession: selectedSession.value,
      selectedSessionId: selectedSessionId.value,
      sessions: props.toolbarSessions
    })),
    shortSessionId: props.sessionData.shortSessionId
  });
  const pageError = computed(() => String(
    mounted.detailState.value?.error ||
    (learningScope ? readRefOrGetterValue(props.sessionData.learningLoadError)
      : readRefOrGetterValue(props.sessionData.workingLoadError ?? props.sessionData.sessionList?.loadError)) ||
    ""
  ));
  const guardedPage = computed(() => ({
    busy: Boolean(mounted.detailState.value?.loading),
    copyText: async (value = "") => typeof navigator === "undefined"
      ? false
      : navigator.clipboard?.writeText?.(String(value || "")),
    error: pageError.value,
    launchBusy: Boolean(mounted.detailState.value?.loading)
  }));

  const interruptFeedback = useUiFeedback({
    dedupeWindowMs: 0,
    errorChannel: "banner",
    source: "vibe64.sessions.agent-turn.interrupt.feedback"
  });

  watch([
    selectedSessionId,
    () => props.active,
    () => selectedSession.value?.agentSession?.turn?.id,
    () => selectedSession.value?.agentSession?.turn?.active
  ], () => interruptFeedback.success());

  async function interruptAgentTurn(input = "user_interrupt") {
    const sessionId = selectedSessionId.value;
    if (!sessionId) {
      return false;
    }
    const control = input && typeof input === "object" && !Array.isArray(input)
      ? input
      : { reason: String(input || "user_interrupt") };
    const turnId = selectedSession.value?.agentSession?.turn?.id;
    interruptFeedback.success();
    try {
      const result = await conversationRuntime.value.interrupt(control);
      if (result?.ok === false) {
        throw vibe64ApiError(result, "Assistant turn could not be interrupted.");
      }
      void refreshSessionData({ reason: "agent-turn-interrupted" }).catch(() => null);
      return result?.ok !== false;
    } catch (error) {
      const turn = selectedSession.value?.agentSession?.turn;
      if (props.active && selectedSessionId.value === sessionId && turn?.active && turn.id === turnId) {
        interruptFeedback.error(error, "Assistant turn could not be interrupted.");
      }
      void refreshSessionData({ reason: "agent-turn-interrupt-failed" }).catch(() => null);
      return false;
    }
  }

  function sendAgentMessage(input = {}) {
    return conversationRuntime.value?.sendAgentMessage(input) ?? false;
  }

  async function retryWorkspaceSetup() {
    if (learningScope) {
      return false;
    }
    const sessionId = selectedSessionId.value;
    if (!sessionId) {
      return false;
    }
    const result = await getHttpWebClient().request(
      vibe64SessionPath(
        readRefOrGetterValue(props.sessionData.sessionsApiPath),
        sessionId,
        "/workspace-setup/retry"
      ),
      {
        body: {},
        method: "POST"
      }
    );
    if (result?.ok === false) {
      throw new Error(result.error || "Workspace preparation could not be started.");
    }
    await refreshSessionData({ reason: "workspace-setup-retry" });
    return true;
  }

  async function saveSessionWork({ destinationReview } = {}) {
    if (learningScope) {
      return false;
    }
    const sessionId = selectedSessionId.value;
    if (!sessionId) {
      return false;
    }
    const result = await getHttpWebClient().request(
      vibe64SessionPath(
        readRefOrGetterValue(props.sessionData.sessionsApiPath),
        sessionId,
        "/save"
      ),
      {
        body: { ...vibe64RealtimeOriginPayload(), destinationReview },
        method: "POST"
      }
    );
    await Promise.allSettled([
      refreshSessionData({ reason: "session-work-save" }),
      refreshWorkState()
    ]);
    if (result?.ok === false && result?.code === "vibe64_session_save_update_required") {
      return result;
    }
    if (result?.ok === false) {
      throw vibe64ApiError(result, "Session work could not be saved.");
    }
    return result;
  }

  async function updateSessionWork({ reviewedConflictId = "", historyReview = undefined } = {}) {
    if (learningScope) {
      return false;
    }
    const sessionId = selectedSessionId.value;
    if (!sessionId) {
      return false;
    }
    const result = await getHttpWebClient().request(
      vibe64SessionPath(
        readRefOrGetterValue(props.sessionData.sessionsApiPath),
        sessionId,
        "/updates/apply"
      ),
      {
        body: vibe64RealtimeOriginPayload({ reviewedConflictId, ...(historyReview ? { historyReview } : {}) }),
        method: "POST"
      }
    );
    await Promise.allSettled([
      refreshSessionData({ reason: "session-work-update" }),
      refreshWorkState()
    ]);
    if (result?.ok === false) {
      throw vibe64ApiError(result, "This session could not be updated.");
    }
    return result;
  }

  async function cancelAgentMessage(messageId = "") {
    return conversationRuntime.value?.cancelMessage(String(messageId || "").trim()) ?? false;
  }

  function setAutopilotBusy(busy = false) {
    autopilotAgentThinking.value = Boolean(busy);
  }

  function emitToolbarControls() {
    emit("toolbar-controls-ready", {
      controls: {
        archive: dialogs.archive
      },
      sessionId: selectedSessionId.value
    });
  }

  function emitBusy() {
    emit("busy-change", {
      agentThinking: activeAgentWorking.value,
      busy: guardedPage.value.busy,
      sessionId: selectedSessionId.value
    });
  }

  function emitProjectAttention() {
    emit("project-attention");
  }

  function emitChatAttention() {
    emit("chat-attention");
  }

  const agentTerminal = {
    sessionUpdate: () => refreshSessionData()
  };
  const selectedAgentTerminalId = computed(() => String(
    selectedSession.value?.agentSession?.terminal?.id ||
    selectedSession.value?.agentSession?.terminal?.terminalSessionId ||
    ""
  ));

  onMounted(() => {
    emitToolbarControls();
    emitBusy();
    emit("page-error-change", {
      error: pageError.value,
      sessionId: selectedSessionId.value
    });
  });

  watch([activeAgentWorking, () => guardedPage.value.busy], emitBusy, { flush: "post" });
  watch(selectedSessionId, () => {
    autopilotAgentThinking.value = false;
  }, { flush: "sync" });
  watch(pageError, (error) => {
    emit("page-error-change", {
      error,
      sessionId: selectedSessionId.value
    });
  }, { flush: "post" });
  watch(workState, (state) => {
    emit("work-state-change", {
      sessionId: selectedSessionId.value,
      workState: { ...state }
    });
  }, { deep: true, flush: "post", immediate: true });
  watch(sourceOperationsSuspended, (suspended, wasSuspended) => {
    emit("source-operations-suspension-change", {
      sessionId: selectedSessionId.value,
      suspended: suspended === true
    });
    if (wasSuspended === true && suspended !== true) {
      void refreshWorkState();
    }
  }, {
    flush: "sync",
    immediate: true
  });
  watch(() => {
    return `${selectedSessionId.value}:${selectedSessionArchived.value}:${runtimeHostWorkTaskRevision(selectedSession.value)}`;
  }, () => {
    const taskState = runtimeHostWorkTaskState(selectedSession.value);
    if (taskState.operation || taskState.updateOperation) {
      workState.value = {
        ...workState.value,
        ...taskState,
        checkedAt: new Date().toISOString(),
        error: "",
        loading: false
      };
    }
    void refreshWorkState();
  }, { flush: "post", immediate: true });

  onBeforeUnmount(() => {
    interruptFeedback.success();
    workStateActive = false;
    workStateRefreshQueue.dispose();
  });

  return {
    agentConnectionError: mounted.agentConnectionError,
    agentConnectionStatus: mounted.agentConnectionStatus,
    retryAgentConnection: mounted.retryAgentConnection,
    agentTerminal,
    autopilotModeActive: computed(() => Boolean(props.active)),
    autopilotSessionToolbar,
    cancelAgentMessage,
    codexTerminalCanStart: computed(() => Boolean(
      !learningScope && props.active && selectedSession.value?.sessionId === selectedSessionId.value
    )),
    conversationLog,
    conversationRuntime,
    dialogs,
    emitChatAttention,
    emitProjectAttention,
    guardedPage,
    interruptAgentTurn,
    refreshSessionData,
    refreshWorkState,
    retryWorkspaceSetup,
    runtimeProjectContext,
    sessionRenewal: dialogs.renewal,
    saveSessionWork,
    sessionsApiPath,
    sourceWorkspaceAvailable: computed(() => !learningScope),
    outputWorkspaceAvailable: computed(() => !learningScope || learningScope.noExercise === false),
    learningAttemptId: learningScope?.learningAttemptId || "",
    selectedAgentTerminalId,
    selection,
    sendAgentMessage,
    setAutopilotBusy,
    updateSessionWork,
    workState
  };
}

export {
  agentMessageAcceptanceSignal,
  agentTurnControlPayloadFromContext,
  createVibe64SessionWorkRefreshQueue,
  focusRuntimeSessionChat,
  proxySessionDialogs,
  runtimeHostAgentWorking,
  runtimeHostToolbarSessions,
  runtimeHostWorkTaskRevision,
  runtimeHostWorkTaskState,
  useVibe64SessionRuntimeHost
};
