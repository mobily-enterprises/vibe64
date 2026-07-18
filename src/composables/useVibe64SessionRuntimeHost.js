import { computed, onBeforeUnmount, onMounted, proxyRefs, ref, unref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { getUsersWebHttpClient } from "@jskit-ai/users-web/client/lib/httpClient";
import {
  useVibe64HeadlessCommandRunner
} from "@/composables/useVibe64HeadlessCommandRunner.js";
import {
  useVibe64ArtifactReadiness
} from "@/composables/useVibe64ArtifactReadiness.js";
import {
  useVibe64HumanInputResponsePreview
} from "@/composables/useVibe64HumanInputResponsePreview.js";
import {
  useVibe64ConversationLog
} from "@/composables/useVibe64ConversationLog.js";
import {
  sessionRecordHasActiveAgentWork
} from "@/composables/useVibe64SessionData.js";
import {
  useVibe64SessionWorkflow
} from "@/composables/useVibe64SessionWorkflow.js";
import {
  useVibe64ReportPreview
} from "@/composables/useVibe64ReportPreview.js";
import {
  vibe64SessionFacts,
  buildVibe64AutopilotNavigationSteps,
  buildVibe64TimelineSteps,
  enrichVibe64SessionForDisplay
} from "@/lib/vibe64SessionPanelModel.js";
import {
  vibe64SessionDisplayTitle,
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel,
  isClosedVibe64Session
} from "@/lib/vibe64SessionViewModel.js";
import {
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
} from "@/lib/vibe64SessionDebugLog.js";
import {
  agentSettingsInputFromContext,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  vibe64RealtimeOriginPayload
} from "@/lib/vibe64BrowserTabOrigin.js";

const AGENT_MESSAGE_ACCEPT_TIMEOUT_MS = 10_000;
const AGENT_TASK_ACCEPT_TIMEOUT_MS = 30_000;
const AGENT_TASK_ACTION_PATHS = Object.freeze({
  finish: "/finish",
  message: "/message",
  start: "",
  stop: "/stop"
});
const LAUNCH_CONTROLS_STABILITY_DELAY_MS = 1000;

function runtimeCapabilitiesState({
  data = null,
  isFetching = false,
  isLoading = false
} = {}) {
  const payload = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const loaded = Boolean(payload.capabilities);
  const fetching = Boolean(isFetching || isLoading);
  return {
    fetching,
    initialLoading: Boolean(fetching && !loaded),
    loaded
  };
}

function runtimeControlsAreBusy({
  active = false,
  loading = false,
  sessionReady = false,
  stable = false
} = {}) {
  return Boolean(!active || !sessionReady || loading || !stable);
}

function agentTerminalStartAllowed({
  active = false,
  capabilitiesReady = false,
  sessionReady = false
} = {}) {
  return Boolean(active && sessionReady && capabilitiesReady);
}

function runtimeHostToolbarSessions({
  activeAgentThinking = false,
  selectedSession = null,
  selectedSessionId = "",
  sessions = []
} = {}) {
  const normalizedSelectedSessionId = String(selectedSessionId || "").trim();
  return (Array.isArray(sessions) ? sessions : []).map((session) => {
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId) {
      return session;
    }
    const sourceSession = sessionId === normalizedSelectedSessionId &&
      selectedSession?.sessionId === sessionId
      ? selectedSession
      : session;
    const agentThinking = Boolean(
      (
        sessionId === normalizedSelectedSessionId &&
        activeAgentThinking
      ) ||
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

function runtimeHostAgentWorking({
  active = false,
  selectedSession = null
} = {}) {
  return Boolean(active && sessionRecordHasActiveAgentWork(selectedSession));
}

function runtimeHostAutopilotPageBusy({
  autopilotBusy = false,
  pageBusy = false
} = {}) {
  return Boolean(pageBusy || autopilotBusy);
}

function runtimeHostInteractionBusy({
  autopilotInteractionLocked = false,
  autopilotPageBusy = false
} = {}) {
  return Boolean(autopilotPageBusy || autopilotInteractionLocked);
}

function sessionScreenSections(session = {}) {
  const sections = session?.presentation?.screen?.sections;
  return Array.isArray(sections) ? sections : [];
}

function sessionScreenSectionKind(section = null) {
  if (typeof section === "string") {
    return section;
  }
  return String(section?.kind || "");
}

function sessionScreenHasSection(session = {}, kind = "") {
  const normalizedKind = String(kind || "");
  return Boolean(normalizedKind) &&
    sessionScreenSections(session).some((section) => sessionScreenSectionKind(section) === normalizedKind);
}

function sessionScreenHasAnySection(session = {}, kinds = []) {
  const wantedKinds = new Set((Array.isArray(kinds) ? kinds : []).map((kind) => String(kind || "")).filter(Boolean));
  return Boolean(wantedKinds.size) &&
    sessionScreenSections(session).some((section) => wantedKinds.has(sessionScreenSectionKind(section)));
}

function artifactPreviewSubresourceActive({
  active = false,
  sectionKind = "",
  session = {}
} = {}) {
  return Boolean(
    active &&
    sessionScreenHasSection(session, sectionKind)
  );
}

function artifactReadinessChangeRefreshDecision({
  active = false,
  initialized = false,
  initializedSessionId = "",
  sessionId = "",
  stepStatus = "",
  version = ""
} = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  if (!active || !initialized || !normalizedSessionId) {
    return {
      initializedSessionId: "",
      refresh: false
    };
  }
  if (String(initializedSessionId || "").trim() !== normalizedSessionId) {
    return {
      initializedSessionId: normalizedSessionId,
      refresh: false
    };
  }
  return {
    initializedSessionId: normalizedSessionId,
    refresh: Boolean(
      version &&
      String(stepStatus || "") !== "awaiting_agent_result"
    )
  };
}

function agentTurnControlPayloadFromContext(context = {}) {
  const source = context && typeof context === "object" && !Array.isArray(context) ? context : {};
  const {
    agentSettings: _agentSettings,
    sessionId: _sessionId,
    ...body
  } = source;
  return vibe64RealtimeOriginPayload({
    ...body,
    ...agentSettingsInputFromContext(source)
  });
}

function useVibe64SessionRuntimeHost(props, emit) {
  const selectedSessionId = computed(() => props.sessionId);
  const selectedListSession = computed(() => {
    if (typeof props.sessionData.sessionForId === "function") {
      return props.sessionData.sessionForId(props.sessionId);
    }
    const sessions = unref(props.sessionData.sessions) || [];
    return sessions.find((session) => session.sessionId === props.sessionId) || null;
  });
  const selectedSession = computed(() => enrichVibe64SessionForDisplay(selectedListSession.value));
  const selectedSessionDetailState = computed(() => {
    const state = readRefOrGetterValue(props.sessionData.selectedSessionDetailState) || {};
    return String(state?.sessionId || "") === props.sessionId
      ? state
      : {
          label: "",
          ready: Boolean(selectedSession.value?.sessionId),
          sessionId: props.sessionId,
          state: selectedSession.value?.sessionId ? "detailReady" : "summaryOnly",
          suppressPassiveComposer: !selectedSession.value?.sessionId
        };
  });
  const selectedSessionTitle = computed(() => {
    return vibe64SessionDisplayTitle(selectedSession.value || {}) ||
      `Session ${props.sessionData.shortSessionId(props.sessionId)}`;
  });
  const isSelectedSessionClosed = computed(() => isClosedVibe64Session(selectedSession.value || {}));
  const sessionFacts = computed(() => vibe64SessionFacts(selectedSession.value || {}));
  const timelineSteps = computed(() => buildVibe64TimelineSteps(selectedSession.value));
  const autopilotNavigationSteps = computed(() => buildVibe64AutopilotNavigationSteps(selectedSession.value));
  const toolbarSessions = computed(() => (
    props.toolbarSessions?.length
      ? props.toolbarSessions
      : unref(props.sessionData.sessions) || []
  ));
  const sourceSafety = computed(() => (
    toolbarSessions.value.find((session) => session?.sessionId === props.sessionId)?.sourceSafety || {}
  ));
  const sessionScopedData = {
    canCreateSession: props.sessionData.canCreateSession,
    clearSelectedSession: props.sessionData.clearSelectedSession,
    createSessionCommand: props.sessionData.createSessionCommand,
    createSessionMode: props.sessionData.createSessionMode,
    createSessionTitle: props.sessionData.createSessionTitle,
    isSelectedSessionClosed,
    pageLoading: props.sessionData.pageLoading,
    refreshSessionData: props.sessionData.refreshSessionData,
    selectSessionId: props.sessionData.selectSessionId,
    selectedSession,
    selectedSessionDetailState,
    selectedSessionId,
    selectedSessionTitle,
    sessionFacts,
    sessionList: props.sessionData.sessionList,
    sessions: props.sessionData.sessions,
    sessionsApiPath: props.sessionData.sessionsApiPath,
    sourceSafety,
    shortSessionId: props.sessionData.shortSessionId,
    statusColor: props.sessionData.statusColor,
    statusLabel: props.sessionData.statusLabel,
    timelineSteps,
    workflowDefinitions: props.sessionData.workflowDefinitions
  };

  const sessionWorkflow = useVibe64SessionWorkflow({
    sessionData: sessionScopedData
  });
  const autopilotCommandRunner = useVibe64HeadlessCommandRunner();
  const artifactReadinessActive = computed(() => Boolean(
    props.active &&
    sessionScreenHasAnySection(selectedSession.value, [
      "report_preview",
      "response_preview"
    ])
  ));
  const artifactReadiness = useVibe64ArtifactReadiness({
    active: artifactReadinessActive,
    sessionId: selectedSessionId
  });
  const artifactReadinessInitialized = computed(() => Boolean(
    artifactReadiness.initialized.value
  ));
  const liveArtifactReadiness = computed(() => {
    const readiness = artifactReadiness.readiness.value?.artifactReadiness;
    return readiness && typeof readiness === "object" ? readiness : {};
  });
  const liveArtifactReadinessVersion = computed(() => artifactReadinessVersion(liveArtifactReadiness.value));
  const reportPreviewActive = computed(() => artifactPreviewSubresourceActive({
    active: props.active,
    initialized: artifactReadinessInitialized.value,
    sectionKind: "report_preview",
    session: selectedSession.value
  }));
  const humanInputResponsePreviewActive = computed(() => artifactPreviewSubresourceActive({
    active: props.active,
    initialized: artifactReadinessInitialized.value,
    sectionKind: "response_preview",
    session: selectedSession.value
  }));

  const actions = proxyRefs(sessionWorkflow.actions);
  const agentTerminal = sessionWorkflow.agentTerminal;
  const commandTerminal = proxyRefs(sessionWorkflow.commandTerminal);
  const dialogs = {
    abandon: proxyRefs(sessionWorkflow.dialogs.abandon),
    diff: proxyRefs(sessionWorkflow.dialogs.diff),
    input: proxyRefs(sessionWorkflow.dialogs.input)
  };
  const page = proxyRefs(sessionWorkflow.page);
  const reportPreview = proxyRefs(useVibe64ReportPreview({
    active: reportPreviewActive,
    artifactReadiness: liveArtifactReadiness,
    session: selectedSession
  }));
  const humanInputResponsePreview = proxyRefs(useVibe64HumanInputResponsePreview({
    active: humanInputResponsePreviewActive,
    artifactReadiness: liveArtifactReadiness,
    session: selectedSession
  }));
  const conversationLog = proxyRefs(useVibe64ConversationLog({
    active: computed(() => Boolean(props.active)),
    session: selectedSession
  }));
  const review = proxyRefs(sessionWorkflow.review);
  const selection = proxyRefs({
    facts: sessionFacts,
    isClosed: isSelectedSessionClosed,
    selectedSession,
    selectedSessionDetailState,
    selectedSessionId,
    selectedSessionTitle,
    statusColor: vibe64SessionStatusColor,
    statusLabel: vibe64SessionStatusLabel
  });
  const timeline = proxyRefs({
    rewindCommand: sessionWorkflow.timeline.rewindCommand,
    rewindToStep: sessionWorkflow.timeline.rewindToStep,
    steps: timelineSteps
  });
  const headlessCommandSessionId = computed(() => String(
    autopilotCommandRunner.lastResult.value?.sessionId ||
    autopilotCommandRunner.activeSessionId.value ||
    ""
  ));
  const headlessCommandMatchesSelectedSession = computed(() => Boolean(
    headlessCommandSessionId.value &&
    headlessCommandSessionId.value === selectedSessionId.value
  ));
  const headlessCommandTerminal = proxyRefs({
    actionId: computed(() => String(autopilotCommandRunner.lastResult.value?.actionId || "")),
    actionLabel: computed(() => String(autopilotCommandRunner.lastResult.value?.actionLabel || "")),
    attemptedCommand: computed(() => String(autopilotCommandRunner.lastResult.value?.attemptedCommand || "")),
    commandPreview: computed(() => headlessCommandMatchesSelectedSession.value ? autopilotCommandRunner.commandPreview.value : ""),
    error: computed(() => {
      const result = autopilotCommandRunner.lastResult.value;
      return headlessCommandMatchesSelectedSession.value && result?.ok === false ? String(result.error || "") : "";
    }),
    exitCode: computed(() => headlessCommandMatchesSelectedSession.value ? autopilotCommandRunner.lastResult.value?.exitCode ?? null : null),
    failed: computed(() => headlessCommandMatchesSelectedSession.value && autopilotCommandRunner.lastResult.value?.ok === false),
    output: computed(() => headlessCommandMatchesSelectedSession.value ? autopilotCommandRunner.output.value : ""),
    running: computed(() => headlessCommandMatchesSelectedSession.value && autopilotCommandRunner.running.value),
    status: computed(() => headlessCommandMatchesSelectedSession.value ? autopilotCommandRunner.status.value : ""),
    terminal: autopilotCommandRunner.terminal,
    terminalSessionId: computed(() => headlessCommandMatchesSelectedSession.value
      ? String(autopilotCommandRunner.lastResult.value?.terminalSessionId || "")
      : ""),
    visible: computed(() => Boolean(
      headlessCommandMatchesSelectedSession.value &&
      (
        autopilotCommandRunner.running.value ||
        autopilotCommandRunner.lastResult.value?.ok === false
      )
    ))
  });

  const autopilotBusy = ref(false);
  const autopilotModeActive = computed(() => Boolean(props.active));
  const autopilotAutomationEnabled = computed(() => true);
  const agentTerminalPresentation = computed(() => {
    const presentation = selectedSession.value?.presentation?.terminal?.agent;
    return presentation && typeof presentation === "object" && !Array.isArray(presentation)
      ? presentation
      : {};
  });
  const selectedAgentTerminalId = computed(() => String(
    selectedSession.value?.agentSession?.terminal?.id ||
    agentTerminalPresentation.value.terminalSessionId ||
    ""
  ));
  const serverSaysAgentIsWorking = computed(() => runtimeHostAgentWorking({
    active: props.active,
    selectedSession: selectedSession.value
  }));
  const autopilotAgentWorkingVisible = computed(() => Boolean(
    serverSaysAgentIsWorking.value
  ));
  const autopilotInteractionLocked = computed(() => Boolean(
    props.active &&
    autopilotAgentWorkingVisible.value
  ));
  const autopilotToolbarSessions = computed(() => runtimeHostToolbarSessions({
    activeAgentThinking: autopilotInteractionLocked.value,
    selectedSession: selectedSession.value,
    selectedSessionId: selectedSessionId.value,
    sessions: toolbarSessions.value
  }));
  const autopilotSessionToolbar = proxyRefs({
    canCreateSession: props.sessionData.canCreateSession,
    createSession: props.sessionData.createSession,
    createSessionCommand: props.sessionData.createSessionCommand,
    createSessionMode: props.sessionData.createSessionMode,
    createSessionTitle: props.sessionData.createSessionTitle,
    selectSession: props.sessionData.selectSessionId,
    sessions: autopilotToolbarSessions,
    shortSessionId: props.sessionData.shortSessionId,
    workflowDefinitions: props.sessionData.workflowDefinitions
  });
  const codexTerminalReadOnly = computed(() => {
    return agentTerminalPresentation.value.readOnlyInAutopilot !== false;
  });
  const codexTerminalScope = computed(() => "session");
  const activeCodexTerminalState = computed(() => null);
  const codexTerminalListenWhenHidden = computed(() => false);
  const launchControlsStable = ref(false);
  let agentMessageRequestSequence = 0;
  let agentMessageRequestTail = Promise.resolve();
  let launchControlsStableTimer = 0;
  const capabilitiesState = computed(() => runtimeCapabilitiesState({
    data: readRefOrGetterValue(props.sessionData.capabilities),
    isFetching: readRefOrGetterValue(props.sessionData.capabilitiesResource?.isFetching),
    isLoading: readRefOrGetterValue(props.sessionData.capabilitiesResource?.isLoading)
  }));
  const launchControlsLoading = computed(() => Boolean(
    readRefOrGetterValue(props.sessionData.pageLoading) ||
    readRefOrGetterValue(props.sessionData.sessionList?.isLoading) ||
    capabilitiesState.value.initialLoading
  ));
  const launchControlsSessionReady = computed(() => Boolean(
    props.sessionId &&
    selectedSession.value?.sessionId &&
    selectedSession.value.sessionId === props.sessionId
  ));
  const launchControlsBusy = computed(() => runtimeControlsAreBusy({
    active: props.active,
    loading: launchControlsLoading.value,
    sessionReady: launchControlsSessionReady.value,
    stable: launchControlsStable.value
  }));
  const codexTerminalCanStart = computed(() => agentTerminalStartAllowed({
    active: props.active,
    capabilitiesReady: capabilitiesState.value.loaded,
    sessionReady: launchControlsSessionReady.value
  }));
  const autopilotPageBusy = computed(() => runtimeHostAutopilotPageBusy({
    autopilotBusy: autopilotBusy.value,
    pageBusy: page.busy
  }));
  const interactionBusy = computed(() => runtimeHostInteractionBusy({
    autopilotInteractionLocked: autopilotInteractionLocked.value,
    autopilotPageBusy: autopilotPageBusy.value
  }));
  const guardedPage = computed(() => ({
    busy: autopilotPageBusy.value,
    copyStatus: page.copyStatus,
    copyText: page.copyText,
    error: page.error,
    launchBusy: launchControlsBusy.value,
    loading: page.loading
  }));

  const interruptAgentTurnCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64SessionPath(
        readRefOrGetterValue(props.sessionData.sessionsApiPath),
        context?.sessionId,
        "/agent-turn/interrupt"
      )
    }),
    buildCommandPayload: (_payload, { context }) => agentTurnControlPayloadFromContext(context),
    fallbackRunError: "Assistant turn could not be interrupted.",
    messages: {
      error: "Assistant turn could not be interrupted."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.agent-turn.interrupt",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  function emitProjectPaneChange(pane = "") {
    emit("project-pane-change", pane);
  }

  function emitProjectAttention() {
    emit("project-attention");
  }

  function setAutopilotBusy(busy) {
    autopilotBusy.value = Boolean(busy);
  }

  function emitBusy() {
    emit("busy-change", {
      busy: interactionBusy.value,
      agentThinking: autopilotInteractionLocked.value,
      sessionId: props.sessionId
    });
  }

  function emitPageError() {
    emit("page-error-change", {
      error: String(page.error || ""),
      sessionId: props.sessionId
    });
  }

  function clearLaunchControlsStableTimer() {
    if (launchControlsStableTimer && typeof window !== "undefined") {
      window.clearTimeout(launchControlsStableTimer);
    }
    launchControlsStableTimer = 0;
  }

  function emitToolbarControls() {
    emit("toolbar-controls-ready", {
      controls: {
        abandon: dialogs.abandon,
        diff: dialogs.diff,
        review
      },
      sessionId: props.sessionId
    });
  }

  async function interruptAgentTurn(input = "user_interrupt") {
    const sessionId = selectedSessionId.value || props.sessionId;
    if (!sessionId) {
      return false;
    }
    const control = input && typeof input === "object" && !Array.isArray(input)
      ? input
      : { reason: String(input || "user_interrupt") };
    try {
      const result = await interruptAgentTurnCommand.run({
        ...control,
        sessionId
      });
      await props.sessionData.refreshSessionData().catch(() => null);
      const interrupted = result?.ok !== false;
      vibe64SessionDebugLog("client.sessionRuntimeHost.agentInterrupt", {
        interrupted,
        reason: String(control.reason || "user_interrupt"),
        sessionId
      });
      return interrupted;
    } catch (error) {
      await props.sessionData.refreshSessionData().catch(() => null);
      vibe64SessionDebugLog("client.sessionRuntimeHost.agentInterrupt.error", {
        error: String(error?.message || error || "Assistant interrupt failed."),
        reason: String(control.reason || "user_interrupt"),
        sessionId
      });
      return false;
    }
  }

  async function cancelAgentMessage(input = "") {
    const sessionId = selectedSessionId.value || props.sessionId;
    const messageId = String(
      input && typeof input === "object" && !Array.isArray(input)
        ? input.messageId || input.composerSubmissionId
        : input
    ).trim();
    if (!sessionId || !messageId) {
      return false;
    }
    const path = vibe64SessionPath(
      readRefOrGetterValue(props.sessionData.sessionsApiPath),
      sessionId,
      `/agent-message/${encodeURIComponent(messageId)}/cancel`
    );
    vibe64SessionDebugLog("client.sessionRuntimeHost.agentMessage.cancel.start", {
      messageId,
      sessionId
    });
    try {
      const result = await getUsersWebHttpClient().request(path, {
        body: agentTurnControlPayloadFromContext({ sessionId }),
        method: "POST",
        signal: AbortSignal.timeout(AGENT_MESSAGE_ACCEPT_TIMEOUT_MS)
      });
      await props.sessionData.refreshSessionData().catch(() => null);
      const cancelled = Boolean(result?.cancelled === true && result?.ok !== false);
      vibe64SessionDebugLog("client.sessionRuntimeHost.agentMessage.cancel", {
        cancelled,
        messageId,
        sessionId
      });
      return cancelled;
    } catch (error) {
      await props.sessionData.refreshSessionData().catch(() => null);
      vibe64SessionDebugLog("client.sessionRuntimeHost.agentMessage.cancel.error", {
        error: String(error?.message || error || "Assistant message cancellation failed."),
        messageId,
        sessionId
      });
      return false;
    }
  }

  async function requestAgentTask(action = "", input = {}) {
    const sessionId = selectedSessionId.value || props.sessionId;
    const suffix = AGENT_TASK_ACTION_PATHS[action];
    if (!sessionId || suffix === undefined) {
      return false;
    }
    const path = vibe64SessionPath(
      readRefOrGetterValue(props.sessionData.sessionsApiPath),
      sessionId,
      `/agent-task${suffix}`
    );
    try {
      const result = await getUsersWebHttpClient().request(path, {
        body: agentTurnControlPayloadFromContext({
          ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}),
          sessionId
        }),
        method: "POST",
        signal: AbortSignal.timeout(AGENT_TASK_ACCEPT_TIMEOUT_MS)
      });
      await props.sessionData.refreshSessionData().catch(() => null);
      if (result?.ok === false) {
        emit("page-error-change", {
          error: String(result.error || "Focused task request failed."),
          sessionId
        });
        return false;
      }
      emit("page-error-change", {
        error: "",
        sessionId
      });
      return true;
    } catch (error) {
      await props.sessionData.refreshSessionData().catch(() => null);
      const message = String(error?.message || error || "Focused task request failed.");
      emit("page-error-change", {
        error: message,
        sessionId
      });
      vibe64SessionDebugLog("client.sessionRuntimeHost.agentTask.error", {
        error: message,
        action,
        sessionId,
      });
      return false;
    }
  }

  function sendAgentMessage(input = {}) {
    const sessionId = selectedSessionId.value || props.sessionId;
    if (!sessionId) {
      return Promise.resolve(false);
    }
    const payload = input && typeof input === "object" && !Array.isArray(input) ? input : {
      message: String(input || "")
    };
    const body = agentTurnControlPayloadFromContext({
      ...payload,
      sessionId
    });
    const path = vibe64SessionPath(
      readRefOrGetterValue(props.sessionData.sessionsApiPath),
      sessionId,
      "/agent-message"
    );
    agentMessageRequestSequence += 1;
    const sequence = agentMessageRequestSequence;
    vibe64SessionDebugLog("client.sessionRuntimeHost.agentMessage.queued", {
      messageId: String(body.composerSubmissionId || ""),
      sequence,
      sessionId
    });
    const request = agentMessageRequestTail.then(async () => {
      try {
        const result = await getUsersWebHttpClient().request(path, {
          body,
          method: "POST",
          signal: AbortSignal.timeout(AGENT_MESSAGE_ACCEPT_TIMEOUT_MS)
        });
        void props.sessionData.refreshSessionData().catch(() => null);
        const accepted = Boolean(result && result.ok !== false);
        vibe64SessionDebugLog("client.sessionRuntimeHost.agentMessage", {
          accepted,
          messageId: String(body.composerSubmissionId || ""),
          sequence,
          sessionId
        });
        return accepted;
      } catch (error) {
        void props.sessionData.refreshSessionData().catch(() => null);
        vibe64SessionDebugLog("client.sessionRuntimeHost.agentMessage.error", {
          error: String(error?.message || error || "Assistant message failed."),
          messageId: String(body.composerSubmissionId || ""),
          sequence,
          sessionId
        });
        return false;
      }
    });
    agentMessageRequestTail = request.then(() => undefined, () => undefined);
    return request;
  }

  onMounted(() => {
    emitToolbarControls();
    emitBusy();
    emitPageError();
  });

  watch([
    interactionBusy,
    autopilotInteractionLocked
  ], emitBusy, {
    flush: "post"
  });

  watch(() => [
    props.active ? "active" : "inactive",
    props.sessionId,
    selectedSession.value?.sessionId || "",
    launchControlsLoading.value ? "loading" : "ready"
  ].join("|"), () => {
    clearLaunchControlsStableTimer();
    launchControlsStable.value = false;
    if (!props.active || !launchControlsSessionReady.value || launchControlsLoading.value) {
      return;
    }
    if (typeof window === "undefined" || LAUNCH_CONTROLS_STABILITY_DELAY_MS <= 0) {
      launchControlsStable.value = true;
      return;
    }
    launchControlsStableTimer = window.setTimeout(() => {
      launchControlsStableTimer = 0;
      launchControlsStable.value = true;
    }, LAUNCH_CONTROLS_STABILITY_DELAY_MS);
  }, {
    flush: "post",
    immediate: true
  });

  watch(() => [
    props.active ? "active" : "inactive",
    props.sessionId,
    selectedSession.value?.currentStep || "",
    selectedSession.value?.stepMachine?.status || ""
  ].join("|"), () => {
    vibe64SessionDebugLog("client.sessionRuntimeHost.state", {
      ...vibe64SessionDebugSummary(selectedSession.value || {}),
      active: props.active,
      sessionId: props.sessionId
    });
  }, {
    flush: "post",
    immediate: true
  });

  let artifactReadinessInitializedSessionId = "";

  watch(() => [
    selectedSessionId.value,
    artifactReadinessActive.value ? "active" : "inactive",
    artifactReadinessInitialized.value ? "initialized" : "pending",
    liveArtifactReadinessVersion.value
  ].join("|"), () => {
    const sessionId = String(selectedSessionId.value || "");
    const version = liveArtifactReadinessVersion.value;
    const decision = artifactReadinessChangeRefreshDecision({
      active: artifactReadinessActive.value,
      initialized: artifactReadinessInitialized.value,
      initializedSessionId: artifactReadinessInitializedSessionId,
      sessionId,
      stepStatus: selectedSession.value?.stepMachine?.status,
      version
    });
    artifactReadinessInitializedSessionId = decision.initializedSessionId;
    if (!decision.refresh) {
      return;
    }
    vibe64SessionDebugLog("client.sessionRuntimeHost.artifactReadiness.changed", {
      artifactReadinessVersion: version,
      sessionId
    });
    void props.sessionData.refreshSessionData({
      reason: "artifact-readiness"
    });
  }, {
    flush: "post"
  });

  watch(() => page.error, emitPageError, {
    flush: "post"
  });

  onBeforeUnmount(() => {
    clearLaunchControlsStableTimer();
  });

  return {
    actions,
    activeCodexTerminalState,
    autopilotAutomationEnabled,
    autopilotCommandRunner,
    autopilotInteractionLocked,
    autopilotModeActive,
    autopilotNavigationSteps,
    autopilotSessionToolbar,
    agentTerminal,
    cancelAgentMessage,
    codexTerminalCanStart,
    codexTerminalListenWhenHidden,
    codexTerminalReadOnly,
    codexTerminalScope,
    commandTerminal,
    conversationLog,
    dialogs,
    emitProjectAttention,
    emitProjectPaneChange,
    guardedPage,
    headlessCommandTerminal,
    humanInputResponsePreview,
    interruptAgentTurn,
    reportPreview,
    review,
    selectedAgentTerminalId,
    selection,
    setAutopilotBusy,
    sendAgentMessage,
    sourceSafety,
    requestAgentTask,
    timeline
  };
}

function artifactReadinessVersion(readiness = {}) {
  return Object.entries(readiness)
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([name, state]) => [
      name,
      state?.nonEmpty === true ? "ready" : "missing",
      String(state?.fingerprint || "")
    ].join(":"))
    .join("|");
}

export {
  artifactPreviewSubresourceActive,
  artifactReadinessChangeRefreshDecision,
  agentTerminalStartAllowed,
  agentTurnControlPayloadFromContext,
  runtimeHostAutopilotPageBusy,
  runtimeCapabilitiesState,
  runtimeControlsAreBusy,
  runtimeHostAgentWorking,
  runtimeHostInteractionBusy,
  runtimeHostToolbarSessions,
  sessionScreenHasAnySection,
  sessionScreenHasSection,
  sessionScreenSections,
  useVibe64SessionRuntimeHost
};
