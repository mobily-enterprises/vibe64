<template>
  <section
    class="studio-ai-session-runtime"
    :data-vibe64-session-runtime-id="props.sessionId"
  >
    <Vibe64AutopilotView
      :actions="actions"
      :active="autopilotModeActive"
      :automation-enabled="autopilotAutomationEnabled"
      :autopilot-steps="autopilotNavigationSteps"
      :assistant-label="selectedAgentRuntimeLabel"
      :codex-terminal-attention="codexBootstrapNeedsTerminalAttention"
      :codex-thinking="codexThinkingVisible"
      :agent-thinking="agentThinkingVisible"
      :ai-terminal-title="aiTerminalTitle"
      :chat-collapsed="props.chatCollapsed"
      :command-runner="autopilotCommandRunner"
      :conversation-log="conversationLog"
      :diff="dialogs.diff"
      :human-input-response-preview="humanInputResponsePreview"
      :interrupt-codex-turn="interruptCodexTurn"
      :page="guardedPage"
      :refresh-session-data="sessionData.refreshSessionData"
      :report-preview="reportPreview"
      :review="review"
      :rewind-busy="Boolean(timeline.rewindCommand?.isRunning)"
      :rewind-to-step="timeline.rewindToStep"
      :session-abandon="dialogs.abandon"
      :session="selection.selectedSession"
      :session-selection-closed="selection.isClosed"
      :session-toolbar="autopilotSessionToolbar"
      :workspace-pane="props.workspacePane"
      @busy-change="setAutopilotBusy"
    >
      <template #shell-terminal="{ active: tabActive }">
        <Vibe64ShellControls
          embedded
          :session="selection.selectedSession"
          :show-activator="false"
          :window-displayed="props.active && tabActive"
        />
      </template>

      <template #ai-terminal="{ active: tabActive }">
        <Vibe64SessionTerminals
          class="studio-ai-sessions__tab-terminal"
          :allow-codex-start="tabActive && codexTerminalCanStart"
          :agent-runtime-id="selectedAgentRuntimeId"
          :codex-recovery="codexRecovery"
          :codex-terminal="codexTerminal"
          :codex-read-only="tabActive ? false : codexTerminalReadOnly"
          :codex-scope="codexTerminalScope"
          :codex-terminal-state="activeCodexTerminalState"
          :command-terminal="commandTerminal"
          :display-mode="tabActive ? 'full' : 'headless'"
          :headless-command-terminal="headlessCommandTerminal"
          :listen-codex-when-hidden="codexTerminalListenWhenHidden || (!tabActive && Boolean(selectedCodexTerminalId))"
          :session="selection.selectedSession"
          :show-command-output="false"
          @codex-activity-change="handleCodexActivityChange"
        />
      </template>

      <template #dashboard="dashboardSlotProps">
        <slot
          name="dashboard"
          :dashboard-context="dashboardSlotProps?.dashboardContext || {}"
        />
      </template>
    </Vibe64AutopilotView>

    <Vibe64SessionDialogs
      :dialogs="dialogs"
      :short-session-id="sessionData.shortSessionId"
      @update-input-values="dialogs.input.values = $event"
    />
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, proxyRefs, ref, unref, watch } from "vue";
import Vibe64AutopilotView from "@/components/studio/vibe64-session/Vibe64AutopilotView.vue";
import Vibe64SessionDialogs from "@/components/studio/vibe64-session/Vibe64SessionDialogs.vue";
import Vibe64SessionTerminals from "@/components/studio/vibe64-session/Vibe64SessionTerminals.vue";
import Vibe64ShellControls from "@/components/studio/Vibe64ShellControls.vue";
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
  readVibe64CodexTerminalQuiet,
  returnVibe64AgentControl,
  sendVibe64CodexTerminalKey,
  startVibe64CodexTerminal
} from "@/lib/vibe64SessionApi.js";

const props = defineProps({
  active: {
    default: false,
    type: Boolean
  },
  chatCollapsed: {
    default: false,
    type: Boolean
  },
  sessionData: {
    required: true,
    type: Object
  },
  sessionId: {
    required: true,
    type: String
  },
  sessionMode: {
    default: "autopilot",
    type: String
  },
  workspacePane: {
    default: "preview",
    type: String
  }
});

const emit = defineEmits([
  "busy-change",
  "page-error-change",
  "toolbar-controls-ready"
]);

const CODEX_QUIET_TERMINAL_POLL_MS = 1000;

const selectedSessionId = computed(() => props.sessionId);
const selectedListSession = computed(() => {
  if (typeof props.sessionData.sessionForId === "function") {
    return props.sessionData.sessionForId(props.sessionId);
  }
  const sessions = unref(props.sessionData.sessions) || [];
  return sessions.find((session) => session.sessionId === props.sessionId) || null;
});
const selectedSession = computed(() => enrichVibe64SessionForDisplay(selectedListSession.value));
const selectedSessionTitle = computed(() => {
  return vibe64SessionDisplayTitle(selectedSession.value || {}) ||
    `Session ${props.sessionData.shortSessionId(props.sessionId)}`;
});
const selectedAgentRuntimeId = computed(() => String(
  selectedSession.value?.agentRuntimeId ||
  selectedSession.value?.metadata?.agent_runtime_id ||
  selectedSession.value?.actionResult?.agentPromptHandoff?.runtimeId ||
  "codex"
).trim() || "codex");
const selectedAgentRuntimeLabel = computed(() => (
  selectedAgentRuntimeId.value === "opencode" ? "OpenCode" : "Codex"
));
const selectedAgentRuntimeIsCodex = computed(() => selectedAgentRuntimeId.value !== "opencode");
const aiTerminalTitle = computed(() => (
  selectedAgentRuntimeId.value === "opencode"
    ? "Open the active session OpenCode terminal"
    : "Open the active session Codex terminal"
));
const isSelectedSessionClosed = computed(() => isClosedVibe64Session(selectedSession.value || {}));
const sessionFacts = computed(() => vibe64SessionFacts(selectedSession.value || {}));
const timelineSteps = computed(() => buildVibe64TimelineSteps(selectedSession.value));
const autopilotNavigationSteps = computed(() => buildVibe64AutopilotNavigationSteps(selectedSession.value));
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
  selectedSessionId,
  selectedSessionTitle,
  sessionFacts,
  sessionList: props.sessionData.sessionList,
  sessions: props.sessionData.sessions,
  sessionsApiPath: props.sessionData.sessionsApiPath,
  shortSessionId: props.sessionData.shortSessionId,
  statusColor: props.sessionData.statusColor,
  statusLabel: props.sessionData.statusLabel,
  timelineSteps,
  workflowDefinitions: props.sessionData.workflowDefinitions
};
const autopilotSessionToolbar = proxyRefs({
  agentRuntimes: props.sessionData.agentRuntimeOptions,
  canCreateSession: props.sessionData.canCreateSession,
  createSession: props.sessionData.createSession,
  createSessionCommand: props.sessionData.createSessionCommand,
  createSessionMode: props.sessionData.createSessionMode,
  createSessionTitle: props.sessionData.createSessionTitle,
  selectSession: props.sessionData.selectSessionId,
  sessions: props.sessionData.sessions,
  shortSessionId: props.sessionData.shortSessionId,
  workflowDefinitions: props.sessionData.workflowDefinitions
});
const sessionWorkflow = useVibe64SessionWorkflow({
  sessionData: sessionScopedData
});
const autopilotCommandRunner = useVibe64HeadlessCommandRunner();
const artifactReadiness = useVibe64ArtifactReadiness({
  active: computed(() => props.active),
  sessionId: selectedSessionId
});
const liveArtifactReadiness = computed(() => {
  const readiness = artifactReadiness.readiness.value?.artifactReadiness;
  return readiness && typeof readiness === "object" ? readiness : {};
});
const liveArtifactReadinessVersion = computed(() => artifactReadinessVersion(liveArtifactReadiness.value));

const actions = proxyRefs(sessionWorkflow.actions);
const codexTerminal = proxyRefs(sessionWorkflow.codexTerminal);
const commandTerminal = proxyRefs(sessionWorkflow.commandTerminal);
const dialogs = {
  abandon: proxyRefs(sessionWorkflow.dialogs.abandon),
  diff: proxyRefs(sessionWorkflow.dialogs.diff),
  input: proxyRefs(sessionWorkflow.dialogs.input)
};
const page = proxyRefs(sessionWorkflow.page);
const reportPreview = proxyRefs(useVibe64ReportPreview({
  active: computed(() => props.active),
  artifactReadiness: liveArtifactReadiness,
  session: selectedSession
}));
const humanInputResponsePreview = proxyRefs(useVibe64HumanInputResponsePreview({
  active: computed(() => props.active),
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
const codexTerminalActivity = ref({
  active: false,
  busy: false,
  scope: "",
  sessionId: "",
  streaming: false,
  terminalSessionId: "",
  working: false
});
const codexRecoveryRunning = ref(false);
const codexRecoveryError = ref("");
const codexControlReturnRunning = ref(false);
const autopilotModeActive = computed(() => Boolean(props.active));
const autopilotAutomationEnabled = computed(() => true);
const codexTerminalPresentation = computed(() => {
  const presentation = selectedSession.value?.presentation?.terminal?.codex;
  return presentation && typeof presentation === "object" && !Array.isArray(presentation)
    ? presentation
    : {};
});
const selectedCodexTerminalId = computed(() => String(
  selectedSession.value?.codexTerminal?.id ||
  codexTerminalPresentation.value.terminalSessionId ||
  ""
));
const codexPromptResponseExpected = computed(() => Boolean(
  props.active &&
  selectedSession.value?.presentation?.prompt?.state === "waiting_for_agent"
));
const codexProgressExpected = computed(() => Boolean(
  props.active &&
  selectedSession.value?.presentation?.screen?.showProgress === true
));
const serverSaysCodexIsWorking = computed(() => Boolean(
  codexPromptResponseExpected.value ||
  codexProgressExpected.value
));
const codexBootstrapNeedsTerminalAttention = computed(() => {
  if (!props.active) {
    return false;
  }
  if (selectedSession.value?.codexTerminal?.attentionRequired === true) {
    return true;
  }
  return (Array.isArray(selectedSession.value?.presentation?.backgroundTasks)
    ? selectedSession.value.presentation.backgroundTasks
    : []
  ).some((task) => (
    String(task?.id || "") === "codex_bootstrap" &&
    String(task?.status || "") === "failed" &&
    Boolean(String(task?.terminalSessionId || ""))
  ));
});
let codexQuietTerminalTimer = null;
const codexTerminalActivityMatchesSelectedSession = computed(() => {
  const activity = codexTerminalActivity.value;
  if (activity.scope !== "session" || activity.sessionId !== selectedSessionId.value) {
    return false;
  }
  return !selectedCodexTerminalId.value ||
    !activity.terminalSessionId ||
    activity.terminalSessionId === selectedCodexTerminalId.value;
});
const codexTerminalActive = computed(() => Boolean(
  codexTerminalActivityMatchesSelectedSession.value &&
  codexTerminalActivity.value.active
));
const terminalSaysCodexIsWorking = computed(() => Boolean(
  codexTerminalActivityMatchesSelectedSession.value &&
  (
    codexTerminalActivity.value.busy ||
    codexTerminalActivity.value.streaming ||
    codexTerminalActivity.value.working
  )
));
const autopilotCodexTerminalVisible = computed(() => Boolean(
  codexBootstrapNeedsTerminalAttention.value
));
const autopilotCodexWorkingVisible = computed(() => Boolean(
  selectedCodexTerminalId.value &&
  !autopilotCodexTerminalVisible.value &&
  (
    terminalSaysCodexIsWorking.value ||
    (
      serverSaysCodexIsWorking.value &&
      (
        codexTerminalActive.value ||
        codexTerminalListenWhenHidden.value
      )
    )
  )
));
const agentStepStatus = computed(() => String(
  selectedSession.value?.stepMachine?.status ||
  selectedSession.value?.presentation?.step?.status ||
  ""
).trim());
const agentResultExpected = computed(() => Boolean(
  props.active &&
  ["attempting_execution", "awaiting_agent_result"].includes(agentStepStatus.value)
));
const autopilotInteractionLocked = computed(() => Boolean(
  props.active &&
  (
    agentResultExpected.value ||
    autopilotCodexWorkingVisible.value
  )
));
const codexThinkingVisible = computed(() => Boolean(
  selectedAgentRuntimeIsCodex.value &&
  autopilotInteractionLocked.value
));
const agentThinkingVisible = computed(() => Boolean(
  !selectedAgentRuntimeIsCodex.value &&
  agentResultExpected.value
));
const codexTerminalCanStart = computed(() => Boolean(
  props.active
));
const codexTerminalReadOnly = computed(() => {
  if (autopilotCodexTerminalVisible.value) {
    return false;
  }
  return codexTerminalPresentation.value.readOnlyInAutopilot !== false;
});
const codexTerminalScope = computed(() => "session");
const activeCodexTerminalState = computed(() => null);
const codexTerminalListenWhenHidden = computed(() => Boolean(
  props.active &&
  serverSaysCodexIsWorking.value &&
  !autopilotCodexTerminalVisible.value &&
  selectedCodexTerminalId.value
));
const codexRecovery = computed(() => ({
  error: codexRecoveryError.value,
  resume: resumeCodexFromAttention,
  running: codexRecoveryRunning.value
}));
const interactionBusy = computed(() => Boolean(
  page.busy ||
  autopilotBusy.value ||
  autopilotInteractionLocked.value
));
const guardedPage = computed(() => ({
  busy: interactionBusy.value,
  copyStatus: page.copyStatus,
  copyText: page.copyText,
  error: page.error,
  loading: page.loading
}));

function setAutopilotBusy(busy) {
  autopilotBusy.value = Boolean(busy);
}

function emitBusy() {
  emit("busy-change", {
    busy: interactionBusy.value,
    sessionId: props.sessionId
  });
}

function emitPageError() {
  emit("page-error-change", {
    error: String(page.error || ""),
    sessionId: props.sessionId
  });
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

function handleCodexActivityChange(payload = {}) {
  const busy = Boolean(payload.busy);
  const streaming = Boolean(payload.streaming);
  const working = Boolean(payload.working);
  const activity = {
    active: Boolean(payload.active || busy || streaming || working),
    busy,
    scope: String(payload.scope || ""),
    sessionId: String(payload.sessionId || ""),
    streaming,
    terminalSessionId: String(payload.terminalSessionId || ""),
    working
  };
  if (activity.scope !== "session" || activity.sessionId !== selectedSessionId.value) {
    return;
  }
  if (
    selectedCodexTerminalId.value &&
    activity.terminalSessionId &&
    activity.terminalSessionId !== selectedCodexTerminalId.value
  ) {
    return;
  }
  codexTerminalActivity.value = activity;
}

async function resumeCodexFromAttention() {
  const sessionId = selectedSessionId.value || props.sessionId;
  if (!sessionId || codexRecoveryRunning.value) {
    return {
      ok: false,
      error: codexRecoveryRunning.value ? "Codex recovery is already running." : "No Vibe64 session is selected."
    };
  }
  codexRecoveryRunning.value = true;
  codexRecoveryError.value = "";
  clearCodexQuietTerminalTimer();
  vibe64SessionDebugLog("client.sessionRuntimeHost.codexRecovery.start", {
    sessionId
  });
  try {
    const result = await startVibe64CodexTerminal(sessionId);
    if (result?.ok === false) {
      throw new Error(result.error || "Codex could not continue.");
    }
    await props.sessionData.refreshSessionData();
    vibe64SessionDebugLog("client.sessionRuntimeHost.codexRecovery.done", {
      sessionId,
      terminalSessionId: String(result?.terminalSessionId || result?.id || "")
    });
    return result || {
      ok: true
    };
  } catch (error) {
    codexRecoveryError.value = String(error?.message || error || "Codex could not continue.");
    await props.sessionData.refreshSessionData().catch(() => null);
    vibe64SessionDebugLog("client.sessionRuntimeHost.codexRecovery.error", {
      error: codexRecoveryError.value,
      sessionId
    });
    return {
      ok: false,
      error: codexRecoveryError.value
    };
  } finally {
    codexRecoveryRunning.value = false;
  }
}

async function returnControlFromQuietCodex() {
  const sessionId = selectedSessionId.value || props.sessionId;
  if (!sessionId || codexControlReturnRunning.value) {
    return {
      ok: false,
      error: codexControlReturnRunning.value ? "Codex control is already returning." : "No Vibe64 session is selected."
    };
  }
  codexControlReturnRunning.value = true;
  clearCodexQuietTerminalTimer();
  vibe64SessionDebugLog("client.sessionRuntimeHost.codexControlReturn.start", {
    sessionId
  });
  try {
    const result = await returnVibe64AgentControl(sessionId);
    if (result?.ok === false) {
      throw new Error(result.error || "Codex control could not be returned.");
    }
    await props.sessionData.refreshSessionData();
    vibe64SessionDebugLog("client.sessionRuntimeHost.codexControlReturn.done", {
      sessionId
    });
    return result || {
      ok: true
    };
  } catch (error) {
    const message = String(error?.message || error || "Codex control could not be returned.");
    await props.sessionData.refreshSessionData().catch(() => null);
    vibe64SessionDebugLog("client.sessionRuntimeHost.codexControlReturn.error", {
      error: message,
      sessionId
    });
    return {
      ok: false,
      error: message
    };
  } finally {
    codexControlReturnRunning.value = false;
  }
}

async function interruptCodexTurn(reason = "user_interrupt") {
  if (!selectedCodexTerminalId.value) {
    return false;
  }
  try {
    const result = await sendVibe64CodexTerminalKey(
      selectedSessionId.value || props.sessionId,
      selectedCodexTerminalId.value,
      "escape"
    );
    const sent = result?.ok !== false;
    vibe64SessionDebugLog("client.sessionRuntimeHost.codexInterrupt", {
      reason,
      sent: sent === true,
      selectedCodexTerminalId: selectedCodexTerminalId.value,
      sessionId: selectedSessionId.value || props.sessionId
    });
    return sent === true;
  } catch (error) {
    vibe64SessionDebugLog("client.sessionRuntimeHost.codexInterrupt.error", {
      error: String(error?.message || error || "Codex interrupt failed."),
      reason,
      selectedCodexTerminalId: selectedCodexTerminalId.value,
      sessionId: selectedSessionId.value || props.sessionId
    });
    return false;
  }
}

function clearCodexQuietTerminalTimer() {
  if (!codexQuietTerminalTimer) {
    return;
  }
  globalThis.clearTimeout(codexQuietTerminalTimer);
  codexQuietTerminalTimer = null;
}

function resetCodexQuietTerminalState() {
  clearCodexQuietTerminalTimer();
}

function canCheckCodexQuietState() {
  return Boolean(
    props.active &&
    codexPromptResponseExpected.value &&
    selectedCodexTerminalId.value &&
    !codexBootstrapNeedsTerminalAttention.value &&
    !codexControlReturnRunning.value
  );
}

function scheduleCodexQuietTerminalCheck(delayMs = CODEX_QUIET_TERMINAL_POLL_MS) {
  clearCodexQuietTerminalTimer();
  if (!canCheckCodexQuietState()) {
    return;
  }
  codexQuietTerminalTimer = globalThis.setTimeout(() => {
    codexQuietTerminalTimer = null;
    void checkCodexQuietTerminal();
  }, Math.max(0, Number(delayMs || 0)));
}

async function checkCodexQuietTerminal() {
  if (!canCheckCodexQuietState()) {
    return;
  }
  const sessionId = selectedSessionId.value || props.sessionId;
  const terminalSessionId = selectedCodexTerminalId.value;
  try {
    const quietState = await readVibe64CodexTerminalQuiet(sessionId, terminalSessionId);
    if (quietState?.ok === false) {
      scheduleCodexQuietTerminalCheck();
      return;
    }
    if (quietState?.quiet === true) {
      await returnControlFromQuietCodex();
      return;
    }
    const idleForMs = Number(quietState?.idleForMs || 0);
    const thresholdMs = Number(quietState?.quietThresholdMs || 0);
    const remainingMs = thresholdMs > idleForMs ? thresholdMs - idleForMs : CODEX_QUIET_TERMINAL_POLL_MS;
    scheduleCodexQuietTerminalCheck(Math.min(CODEX_QUIET_TERMINAL_POLL_MS, Math.max(250, remainingMs)));
  } catch (error) {
    vibe64SessionDebugLog("client.sessionRuntimeHost.codexQuietCheck.error", {
      error: String(error?.message || error || "Codex quiet check failed."),
      sessionId,
      terminalSessionId
    });
    scheduleCodexQuietTerminalCheck();
  }
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

onMounted(() => {
  emitToolbarControls();
  emitBusy();
  emitPageError();
});

watch(interactionBusy, emitBusy, {
  flush: "post"
});

watch(() => [
  props.active ? "active" : "inactive",
  props.sessionMode,
  props.sessionId,
  selectedSession.value?.currentStep || "",
  selectedSession.value?.stepMachine?.status || ""
].join("|"), () => {
  vibe64SessionDebugLog("client.sessionRuntimeHost.state", {
    ...vibe64SessionDebugSummary(selectedSession.value || {}),
    active: props.active,
    sessionId: props.sessionId,
    sessionMode: props.sessionMode
  });
}, {
  flush: "post",
  immediate: true
});

watch(liveArtifactReadinessVersion, (version, previousVersion) => {
  if (props.active && version && version !== previousVersion) {
    vibe64SessionDebugLog("client.sessionRuntimeHost.artifactReadiness.changed", {
      artifactReadinessVersion: version,
      previousArtifactReadinessVersion: previousVersion || "",
      sessionId: props.sessionId
    });
    void props.sessionData.refreshSessionData();
  }
}, {
  flush: "post"
});

watch(() => page.error, emitPageError, {
  flush: "post"
});

watch(() => [
  props.sessionId,
  props.sessionMode,
  selectedCodexTerminalId.value
].join("|"), () => {
  codexTerminalActivity.value = {
    active: false,
    busy: false,
    scope: "",
    sessionId: "",
    streaming: false,
    terminalSessionId: "",
    working: false
  };
  codexRecoveryError.value = "";
  resetCodexQuietTerminalState();
}, {
  flush: "post"
});

watch(() => [
  codexPromptResponseExpected.value ? "prompt-expected" : "prompt-idle",
  selectedCodexTerminalId.value,
  codexBootstrapNeedsTerminalAttention.value ? "bootstrap-attention" : "bootstrap-ok"
].join("|"), () => {
  scheduleCodexQuietTerminalCheck();
}, {
  flush: "post",
  immediate: true
});

onBeforeUnmount(() => {
  clearCodexQuietTerminalTimer();
});

</script>

<style scoped>
.studio-ai-session-runtime {
  display: grid;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.studio-ai-sessions__tab-terminal {
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.studio-ai-sessions__tab-terminal :deep(.studio-ai-sessions__codex-terminal-shell),
.studio-ai-sessions__tab-terminal :deep(.studio-ai-sessions__codex-terminal) {
  height: 100%;
}
</style>
