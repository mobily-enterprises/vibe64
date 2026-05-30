<template>
  <section class="studio-ai-session-runtime">
    <div
      class="studio-ai-sessions__layout"
      :class="`studio-ai-sessions__layout--${sessionMode}`"
    >
      <Vibe64AutopilotView
        v-if="sessionMode === 'autopilot'"
        :actions="actions"
        :active="autopilotModeActive"
        :automation-enabled="autopilotAutomationEnabled"
        :autopilot-steps="autopilotNavigationSteps"
        :command-runner="autopilotCommandRunner"
        :conversation-log="conversationLog"
        :diff="dialogs.diff"
        :human-input-response-preview="humanInputResponsePreview"
        :page="guardedPage"
        :refresh-session-data="sessionData.refreshSessionData"
        :report-preview="reportPreview"
        :review="review"
        :rewind-busy="Boolean(timeline.rewindCommand?.isRunning)"
        :rewind-to-step="timeline.rewindToStep"
        :session="selection.selectedSession"
        :inert="autopilotViewInert"
        @busy-change="setAutopilotBusy"
      />

      <div
        v-if="autopilotInteractionLocked"
        class="studio-ai-sessions__codex-thinking-overlay"
        role="status"
        aria-live="polite"
      >
        <div class="studio-ai-sessions__codex-thinking-status">
          <v-progress-circular
            class="studio-ai-sessions__codex-thinking-spinner"
            color="primary"
            indeterminate
            :size="48"
            :width="3"
          >
            <v-icon :icon="mdiRobotOutline" size="24" />
          </v-progress-circular>
          <strong>Codex is thinking...</strong>
        </div>
      </div>

      <div
        v-if="sessionMode === 'inspect'"
        class="studio-ai-sessions__inspect-slot"
      >
        <Vibe64SessionWorkspace
          class="studio-ai-sessions__inspect-workspace"
          :actions="actions"
          :active="props.active && sessionMode === 'inspect'"
          :conversation-log="conversationLog"
          :dialogs="dialogs"
          :page="guardedPage"
          :refresh-session-data="sessionData.refreshSessionData"
          :report-preview="reportPreview"
          :review="review"
          :human-input-response-preview="humanInputResponsePreview"
          :selection="selection"
          :step-input="stepInput"
          :timeline="timeline"
        />

        <div
          :id="shellPanelTargetId"
          class="studio-ai-sessions__shell-terminal-target"
        />
      </div>

      <Vibe64SessionTerminals
        :class="{
          'studio-ai-sessions__terminals--autopilot-preview': codexTerminalPreviewVisible,
          'studio-ai-sessions__terminals--autopilot-foreground': codexTerminalForegroundVisible
        }"
        :allow-codex-start="codexTerminalCanStart"
        :codex-terminal="codexTerminal"
        :codex-read-only="codexTerminalReadOnly"
        :codex-scope="codexTerminalScope"
        :codex-terminal-state="activeCodexTerminalState"
        :command-terminal="commandTerminal"
        :display-mode="codexTerminalDisplayMode"
        :headless-command-terminal="headlessCommandTerminal"
        :listen-codex-when-hidden="codexTerminalListenWhenHidden"
        :session="selection.selectedSession"
        :show-command-output="sessionMode === 'inspect'"
        @codex-activity-change="handleCodexActivityChange"
        @codex-session-update="emitGlobalCodexTerminalUpdate"
      />
    </div>

    <Vibe64SessionDialogs
      :dialogs="dialogs"
      :short-session-id="sessionData.shortSessionId"
      @update-input-values="dialogs.input.values = $event"
    />
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, proxyRefs, ref, unref, watch } from "vue";
import {
  mdiRobotOutline
} from "@mdi/js";
import Vibe64AutopilotView from "@/components/studio/vibe64-session/Vibe64AutopilotView.vue";
import Vibe64SessionDialogs from "@/components/studio/vibe64-session/Vibe64SessionDialogs.vue";
import Vibe64SessionTerminals from "@/components/studio/vibe64-session/Vibe64SessionTerminals.vue";
import Vibe64SessionWorkspace from "@/components/studio/vibe64-session/Vibe64SessionWorkspace.vue";
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
  vibe64ShellPanelTargetId
} from "@/lib/vibe64ShellPanelTarget.js";
import {
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
} from "@/lib/vibe64SessionDebugLog.js";

const props = defineProps({
  active: {
    default: false,
    type: Boolean
  },
  sessionData: {
    required: true,
    type: Object
  },
  globalCodexOpen: {
    default: false,
    type: Boolean
  },
  globalCodexTerminalState: {
    default: null,
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
  autopilotCodexOpen: {
    default: false,
    type: Boolean
  }
});

const emit = defineEmits([
  "busy-change",
  "global-codex-update",
  "page-error-change",
  "toolbar-controls-ready"
]);

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
const shellPanelTargetId = computed(() => vibe64ShellPanelTargetId(props.sessionId));
const isSelectedSessionClosed = computed(() => isClosedVibe64Session(selectedSession.value || {}));
const sessionFacts = computed(() => vibe64SessionFacts(selectedSession.value || {}));
const timelineSteps = computed(() => buildVibe64TimelineSteps(selectedSession.value));
const autopilotNavigationSteps = computed(() => buildVibe64AutopilotNavigationSteps(selectedSession.value));
const sessionScopedData = {
  canCreateSession: props.sessionData.canCreateSession,
  clearSelectedSession: props.sessionData.clearSelectedSession,
  createSessionCommand: props.sessionData.createSessionCommand,
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
  timelineSteps
};
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
const stepInput = proxyRefs(sessionWorkflow.stepInput);
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
  terminalSessionId: "",
  working: false
});
const autopilotModeActive = computed(() => Boolean(props.active && props.sessionMode === "autopilot"));
const autopilotAutomationEnabled = computed(() => props.sessionMode === "autopilot");
const codexTerminalPresentation = computed(() => {
  const presentation = selectedSession.value?.presentation?.terminal?.codex;
  return presentation && typeof presentation === "object" && !Array.isArray(presentation)
    ? presentation
    : {};
});
const codexTerminalPreviewClock = ref(Date.now());
let codexTerminalPreviewTimer = null;
let presentationRefreshTimer = null;
let lastPresentationRefreshKey = "";
const codexTerminalPreviewVisibleUntilMs = computed(() => {
  const visibleUntil = String(codexTerminalPresentation.value.visibleUntil || "");
  const time = Date.parse(visibleUntil);
  return Number.isFinite(time) ? time : 0;
});
const presentationRefreshAtMs = computed(() => {
  const refreshAt = String(selectedSession.value?.presentation?.refreshAt || "");
  const time = Date.parse(refreshAt);
  return Number.isFinite(time) ? time : 0;
});
const codexTerminalPreviewWithinWindow = computed(() => {
  const visibleUntil = codexTerminalPreviewVisibleUntilMs.value;
  return Boolean(visibleUntil && codexTerminalPreviewClock.value <= visibleUntil);
});
const serverCodexTerminalPreviewVisible = computed(() => Boolean(
  props.active &&
  props.sessionMode === "autopilot" &&
  codexTerminalPresentation.value.visible === true &&
  codexTerminalPresentation.value.terminalSessionId &&
  codexTerminalPreviewWithinWindow.value
));
const autopilotCodexTerminalVisible = computed(() => Boolean(
  props.active &&
  props.sessionMode === "autopilot" &&
  props.autopilotCodexOpen &&
  selectedSessionId.value
));
const globalCodexTerminalVisible = computed(() => Boolean(
  props.active &&
  props.sessionMode === "autopilot" &&
  props.globalCodexOpen &&
  !autopilotCodexTerminalVisible.value
));
const codexTerminalForegroundVisible = computed(() => Boolean(
  autopilotCodexTerminalVisible.value ||
  globalCodexTerminalVisible.value
));
const selectedCodexTerminalId = computed(() => String(
  selectedSession.value?.codexTerminal?.id || ""
));
const hiddenCodexTerminalActivityVisible = computed(() => Boolean(
  props.active &&
  props.sessionMode === "autopilot" &&
  !codexTerminalForegroundVisible.value &&
  codexTerminalActivity.value.active &&
  codexTerminalActivity.value.scope === "session" &&
  codexTerminalActivity.value.sessionId === selectedSessionId.value
));
const codexTerminalPreviewVisible = computed(() => Boolean(
  serverCodexTerminalPreviewVisible.value ||
  hiddenCodexTerminalActivityVisible.value
));
const autopilotInteractionLocked = computed(() => Boolean(
  props.active &&
  props.sessionMode === "autopilot" &&
  codexTerminalPreviewVisible.value &&
  !codexTerminalForegroundVisible.value
));
const autopilotViewInert = computed(() => Boolean(
  props.sessionMode !== "autopilot" ||
  autopilotInteractionLocked.value
));
const codexTerminalDisplayMode = computed(() => {
  if (!props.active) {
    return "headless";
  }
  if (codexTerminalForegroundVisible.value) {
    return "full";
  }
  if (props.sessionMode === "inspect") {
    return "full";
  }
  if (codexTerminalPreviewVisible.value) {
    return "compact";
  }
  return "headless";
});
const codexTerminalCanStart = computed(() => Boolean(
  props.active &&
  (props.sessionMode === "inspect" || codexTerminalForegroundVisible.value)
));
const codexTerminalReadOnly = computed(() => {
  if (codexTerminalForegroundVisible.value) {
    return false;
  }
  if (props.sessionMode === "inspect") {
    return false;
  }
  return codexTerminalPresentation.value.readOnlyInAutopilot !== false;
});
const codexTerminalScope = computed(() => (globalCodexTerminalVisible.value ? "global" : "session"));
const activeCodexTerminalState = computed(() => (
  globalCodexTerminalVisible.value ? props.globalCodexTerminalState : null
));
const codexTerminalListenWhenHidden = computed(() => Boolean(
  props.active &&
  props.sessionMode === "autopilot" &&
  !codexTerminalForegroundVisible.value &&
  selectedCodexTerminalId.value
));
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

function emitGlobalCodexTerminalUpdate(payload = {}) {
  if (globalCodexTerminalVisible.value) {
    emit("global-codex-update", payload);
  }
}

function handleCodexActivityChange(payload = {}) {
  const activity = {
    active: Boolean(payload.active || payload.busy || payload.working),
    busy: Boolean(payload.busy),
    scope: String(payload.scope || ""),
    sessionId: String(payload.sessionId || ""),
    terminalSessionId: String(payload.terminalSessionId || ""),
    working: Boolean(payload.working)
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

function clearCodexTerminalPreviewTimer() {
  if (!codexTerminalPreviewTimer) {
    return;
  }
  globalThis.clearTimeout(codexTerminalPreviewTimer);
  codexTerminalPreviewTimer = null;
}

function clearPresentationRefreshTimer() {
  if (!presentationRefreshTimer) {
    return;
  }
  globalThis.clearTimeout(presentationRefreshTimer);
  presentationRefreshTimer = null;
}

function scheduleCodexTerminalPreviewExpiry() {
  clearCodexTerminalPreviewTimer();
  codexTerminalPreviewClock.value = Date.now();
  const visibleUntil = codexTerminalPreviewVisibleUntilMs.value;
  if (!visibleUntil || !props.active || props.sessionMode !== "autopilot") {
    return;
  }
  const delay = Math.max(0, visibleUntil - Date.now()) + 25;
  codexTerminalPreviewTimer = globalThis.setTimeout(() => {
    codexTerminalPreviewTimer = null;
    codexTerminalPreviewClock.value = Date.now();
  }, delay);
}

function schedulePresentationRefresh() {
  clearPresentationRefreshTimer();
  const refreshAt = presentationRefreshAtMs.value;
  if (!refreshAt || !props.active || !props.sessionId) {
    return;
  }
  const refreshKey = `${props.sessionId}:${refreshAt}`;
  if (lastPresentationRefreshKey === refreshKey) {
    return;
  }
  const delay = Math.max(25, refreshAt - Date.now() + 25);
  presentationRefreshTimer = globalThis.setTimeout(async () => {
    presentationRefreshTimer = null;
    lastPresentationRefreshKey = refreshKey;
    if (!props.active || !props.sessionId) {
      return;
    }
    try {
      await props.sessionData.refreshSessionData();
    } catch (error) {
      vibe64SessionDebugLog("client.sessionRuntimeHost.presentationRefresh.error", {
        error: String(error?.message || error || "Session presentation refresh failed."),
        refreshAt: new Date(refreshAt).toISOString(),
        sessionId: props.sessionId
      });
    }
  }, delay);
}

onMounted(() => {
  emitToolbarControls();
  emitBusy();
  emitPageError();
});

onBeforeUnmount(() => {
  clearCodexTerminalPreviewTimer();
  clearPresentationRefreshTimer();
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
    terminalSessionId: "",
    working: false
  };
}, {
  flush: "post"
});

watch(() => [
  props.active ? "active" : "inactive",
  props.sessionMode,
  serverCodexTerminalPreviewVisible.value ? "visible" : "hidden",
  codexTerminalPresentation.value.terminalSessionId || "",
  codexTerminalPresentation.value.visibleUntil || ""
].join("|"), scheduleCodexTerminalPreviewExpiry, {
  flush: "post",
  immediate: true
});

watch(() => [
  props.active ? "active" : "inactive",
  props.sessionId,
  presentationRefreshAtMs.value || ""
].join("|"), schedulePresentationRefresh, {
  flush: "post",
  immediate: true
});
</script>

<style scoped>
.studio-ai-session-runtime {
  display: grid;
  min-height: 0;
}

.studio-ai-sessions__layout {
  --studio-ai-sessions-codex-terminal-column: minmax(30rem, 1.22fr);
  --studio-ai-sessions-inspect-main-column: minmax(18rem, 0.78fr);
  --studio-ai-sessions-layout-gap: 0.9rem;
  align-items: flex-start;
  display: grid;
  gap: var(--studio-ai-sessions-layout-gap);
  min-height: 0;
}

.studio-ai-sessions__layout--autopilot {
  grid-template-columns: minmax(0, 1fr);
  position: relative;
}

.studio-ai-sessions__layout--inspect {
  grid-template-columns: var(--studio-ai-sessions-inspect-main-column) var(--studio-ai-sessions-codex-terminal-column);
}

.studio-ai-sessions__layout--autopilot > .studio-autopilot {
  grid-column: 1;
  grid-row: 1;
  position: relative;
  z-index: 2;
}

.studio-ai-sessions__codex-thinking-overlay {
  display: flex;
  justify-content: center;
  left: 0;
  pointer-events: none;
  position: absolute;
  right: 0;
  top: 0.45rem;
  z-index: 4;
}

.studio-ai-sessions__codex-thinking-status {
  align-items: center;
  background: rgba(var(--v-theme-surface), 0.88);
  border: 1px solid rgba(var(--v-theme-primary), 0.22);
  border-radius: 8px;
  box-shadow: 0 0.4rem 1.1rem rgba(0, 0, 0, 0.12);
  color: rgb(var(--v-theme-on-surface));
  display: flex;
  gap: 0.7rem;
  min-height: 3.5rem;
  padding: 0.35rem 0.8rem;
}

.studio-ai-sessions__codex-thinking-status strong {
  font-size: 1.05rem;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.15;
}

.studio-ai-sessions__codex-thinking-spinner :deep(.v-icon) {
  animation: studio-ai-sessions-codex-thinking-pulse 1.45s ease-in-out infinite;
}

@keyframes studio-ai-sessions-codex-thinking-pulse {
  0%,
  100% {
    opacity: 0.58;
    transform: scale(0.96);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}

.studio-ai-sessions__inspect-slot {
  display: grid;
  min-height: 0;
  min-width: 0;
  position: relative;
}

.studio-ai-sessions__inspect-workspace,
.studio-ai-sessions__shell-terminal-target {
  grid-area: 1 / 1;
  min-height: 0;
  min-width: 0;
}

.studio-ai-sessions__shell-terminal-target {
  pointer-events: none;
  z-index: 3;
}

.studio-ai-sessions__layout--autopilot > .studio-ai-sessions__terminals--autopilot-preview {
  align-self: start;
  grid-column: 1;
  grid-row: 1;
  height: min(18rem, 38vh);
  justify-self: center;
  margin-top: 0;
  max-width: min(64rem, calc(100% - 2rem));
  opacity: 0.14;
  pointer-events: none;
  width: min(64rem, calc(100% - 2rem));
  z-index: 1;
}

.studio-ai-sessions__layout--autopilot > .studio-ai-sessions__terminals--autopilot-foreground {
  align-self: stretch;
  grid-column: 1;
  grid-row: 1;
  justify-self: stretch;
  min-height: min(42rem, 72vh);
  pointer-events: auto;
  z-index: 5;
}

@media (max-width: 980px) {
  .studio-ai-sessions__layout {
    grid-template-columns: 1fr;
  }
}

@media (min-width: 981px) {
  .studio-ai-session-runtime,
  .studio-ai-sessions__layout {
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .studio-ai-sessions__layout {
    align-items: stretch;
  }

  .studio-ai-sessions__layout--autopilot {
    grid-template-columns: var(--studio-ai-sessions-inspect-main-column) var(--studio-ai-sessions-codex-terminal-column);
  }

  .studio-ai-sessions__layout--autopilot > .studio-autopilot {
    grid-column: 1 / -1;
  }

  .studio-ai-sessions__layout--autopilot > .studio-ai-sessions__terminals--autopilot-preview {
    grid-column: 2;
    max-width: min(64rem, 100%);
    width: 100%;
  }

  .studio-ai-sessions__layout--autopilot > .studio-ai-sessions__terminals--autopilot-foreground {
    grid-column: 2;
    width: 100%;
  }
}
</style>
