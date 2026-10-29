import { computed, nextTick, onBeforeUnmount, onMounted, proxyRefs, ref, unref, watch } from "vue";
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
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";
import { vibe64ApiError } from "@/lib/vibe64ApiResponses.js";
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

const ACTIVE_WORK_TASK_STATUSES = ["queued", "running", "starting"];

function workTaskActive(task = {}) {
  return ACTIVE_WORK_TASK_STATUSES.includes(String(task?.status || "").trim().toLowerCase());
}

// Inspection reads repository files, so it follows changes that can alter them:
// a started, replaced or finished Save or Update, and checkpoints. Progress
// events of one running Save or Update only change its displayed progress; the
// server still recovers an interrupted one whenever the session is inspected.
function runtimeHostWorkInspectionRevision(session = {}) {
  return runtimeHostWorkTaskRevision(session, { progress: false });
}

function runtimeHostWorkTaskRevision(session = {}, { progress = true } = {}) {
  return (Array.isArray(session?.backgroundTasks) ? session.backgroundTasks : [])
    .filter((task) => SESSION_WORK_TASK_IDS.includes(String(task?.id || "")))
    .map((task) => {
      if (!progress && task.id !== "codex_turn_checkpoint" && workTaskActive(task)) {
        return [task.id, String(task.status || "").trim().toLowerCase(), String(task.operationId || "")].join(":");
      }
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
  const activeOperation = [operation, updateOperation].find(workTaskActive);
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
  const selectedSessionId = computed(() => String(props.sessionId || "").trim());
  const sessionsApiPath = props.sessionData.sessionsApiPath;
  const runtimeProjectContext = computed(() => props.projectContext || {});
  const selectedListSession = computed(() => {
    const sessions = unref(props.sessionData.sessions) || [];
    return sessions.find((session) => session.sessionId === selectedSessionId.value) || null;
  });
  const conversationRuntime = useVibe64ConversationRuntime({
    active: computed(() => Boolean(props.active)),
    projectSlug: computed(() => runtimeProjectContext.value.slug || ""),
    sessionId: selectedSessionId,
    sessionsApiPath,
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
    loading: true,
    operation: null,
    unsaved: null
  });
  useRealtimeEvent({
    event: VIBE64_PROJECT_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => payload.projectSlug === props.projectContext?.slug &&
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
  // The session panel's repository status registry inspects every session's
  // work, this one included: this host's reads join the registry's read of the
  // same change, and each of the registry's results for this session lands here.
  const workInspector = props.sessionWorkInspector;

  function applyInspectedWork(sessionId, state) {
    if (
      state &&
      workStateActive &&
      !sourceOperationsSuspended.value &&
      selectedSessionId.value === sessionId &&
      !selectedSessionArchived.value
    ) {
      workState.value = { ...state };
    }
  }

  watch(selectedSessionId, (sessionId, _previous, onCleanup) => {
    if (sessionId) {
      onCleanup(workInspector.subscribe(sessionId, (state) => applyInspectedWork(sessionId, state)));
    }
  }, { flush: "sync", immediate: true });

  // `settle` marks a change of this session's work tasks, one event of a burst.
  async function inspectWorkState({ settle = false } = {}) {
    const sessionId = selectedSessionId.value;
    if (sourceOperationsSuspended.value) {
      return;
    }
    if (!sessionId || selectedSessionArchived.value) {
      workState.value = {
        checkedAt: new Date().toISOString(),
        error: "",
        loading: false,
        operation: null,
        unsaved: null
      };
      return;
    }
    if (workState.value.unsaved === null || workState.value.unsaved === undefined) {
      workState.value = {
        ...workState.value,
        loading: true
      };
    }
    await workInspector.inspect(sessionId, { settle });
  }

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
    await inspectWorkState();
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
    selectSession: props.sessionData.selectSessionId,
    selectedSession,
    selectedSessionId,
    sessionsApiPath
  });
  const sourceOperationsSuspended = renewalModel.sourceOperationsSuspended;
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
    refreshSessionData,
    projectContext: runtimeProjectContext,
    refreshRepositoryState: props.refreshRepositoryState,
    canCreateSession: props.sessionData.canCreateSession,
    createSession: props.sessionData.createSession,
    createSessionCommand: props.sessionData.createSessionCommand,
    createSessionRunning: props.sessionData.createSessionRunning,
    createSessionVisible: props.sessionData.createSessionVisible,
    createSessionTitle: props.sessionData.createSessionTitle,
    selectSession: props.sessionData.selectSessionId,
    sessions: computed(() => runtimeHostToolbarSessions({
      activeAgentThinking: activeAgentWorking.value,
      fallbackSessions: unref(props.sessionData.sessions),
      selectedSession: selectedSession.value,
      selectedSessionId: selectedSessionId.value,
      sessions: props.toolbarSessions
    }))
  });
  const pageError = computed(() => String(
    mounted.detailState.value?.error ||
    props.sessionData.sessionList?.loadError ||
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

  async function saveSessionWork({ destinationReview, connectedReview } = {}) {
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
        body: { ...vibe64RealtimeOriginPayload(), destinationReview,
          ...(connectedReview !== undefined ? { connectedReview } : {})
        },
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

  async function updateSessionWork({ reviewedConflictId = "", historyReview = undefined, requestId = "" } = {}) {
    const sessionId = selectedSessionId.value;
    if (!sessionId) {
      return false;
    }
    let result;
    try {
      result = await getHttpWebClient().request(
        vibe64SessionPath(
          readRefOrGetterValue(props.sessionData.sessionsApiPath),
          sessionId,
          "/updates/apply"
        ),
        {
          body: vibe64RealtimeOriginPayload({ reviewedConflictId, ...(historyReview ? { historyReview } : {}),
            ...(requestId ? { requestId } : {}) }),
          method: "POST"
        }
      );
    } finally {
      await Promise.allSettled([
        refreshSessionData({ reason: "session-work-update" }),
        refreshWorkState()
      ]);
    }
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
  }, { flush: "post", immediate: true });
  // The first read is needed now; a later revision is one change of a burst
  // that the registry is usually already inspecting.
  let workInspectionRevisionSeen = false;
  watch(() => {
    return `${selectedSessionId.value}:${selectedSessionArchived.value}:${runtimeHostWorkInspectionRevision(selectedSession.value)}`;
  }, () => {
    if (!sourceOperationsSuspended.value) {
      void inspectWorkState({ settle: workInspectionRevisionSeen });
    }
    workInspectionRevisionSeen = true;
  }, { flush: "post", immediate: true });

  onBeforeUnmount(() => {
    interruptFeedback.success();
    workStateActive = false;
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
      props.active && selectedSession.value?.sessionId === selectedSessionId.value
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
    selectedAgentTerminalId,
    selection,
    sendAgentMessage,
    setAutopilotBusy,
    updateSessionWork,
    workState
  };
}

export {
  focusRuntimeSessionChat,
  proxySessionDialogs,
  runtimeHostAgentWorking,
  runtimeHostToolbarSessions,
  runtimeHostWorkInspectionRevision,
  runtimeHostWorkTaskRevision,
  runtimeHostWorkTaskState,
  useVibe64SessionRuntimeHost
};
