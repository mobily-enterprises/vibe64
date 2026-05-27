<template>
  <section class="studio-ai-session-runtime">
    <div
      class="studio-ai-sessions__layout"
      :class="`studio-ai-sessions__layout--${sessionMode}`"
    >
      <Vibe64AutopilotView
        v-show="sessionMode === 'autopilot'"
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
        @busy-change="setAutopilotBusy"
      />

      <div
        v-show="sessionMode === 'inspect'"
        class="studio-ai-sessions__inspect-slot"
      >
        <Vibe64SessionWorkspace
          class="studio-ai-sessions__inspect-workspace"
          :actions="actions"
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
          'studio-ai-sessions__terminals--autopilot-preview': codexTerminalPreviewVisible
        }"
        :allow-codex-start="codexTerminalCanStart"
        :codex-terminal="codexTerminal"
        :codex-read-only="codexTerminalReadOnly"
        :command-terminal="commandTerminal"
        :display-mode="codexTerminalDisplayMode"
        :headless-command-terminal="headlessCommandTerminal"
        :session="selection.selectedSession"
        :show-command-output="sessionMode === 'inspect'"
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
import { computed, onMounted, proxyRefs, ref, unref, watch } from "vue";
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
  sessionId: {
    required: true,
    type: String
  },
  sessionMode: {
    default: "autopilot",
    type: String
  }
});

const emit = defineEmits([
  "busy-change",
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
  active: computed(() => Boolean(props.active && props.sessionMode === "autopilot")),
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
const headlessCommandTerminal = proxyRefs({
  actionId: computed(() => String(autopilotCommandRunner.lastResult.value?.actionId || "")),
  actionLabel: computed(() => String(autopilotCommandRunner.lastResult.value?.actionLabel || "")),
  commandPreview: autopilotCommandRunner.commandPreview,
  error: computed(() => {
    const result = autopilotCommandRunner.lastResult.value;
    return result?.ok === false ? String(result.error || "") : "";
  }),
  exitCode: computed(() => autopilotCommandRunner.lastResult.value?.exitCode ?? null),
  failed: computed(() => autopilotCommandRunner.lastResult.value?.ok === false),
  output: autopilotCommandRunner.output,
  running: autopilotCommandRunner.running,
  status: autopilotCommandRunner.status,
  terminalSessionId: computed(() => String(autopilotCommandRunner.lastResult.value?.terminalSessionId || "")),
  visible: computed(() => Boolean(
    autopilotCommandRunner.running.value ||
    autopilotCommandRunner.lastResult.value?.ok === false
  ))
});

const autopilotBusy = ref(false);
const autopilotModeActive = computed(() => Boolean(props.active && props.sessionMode === "autopilot"));
const autopilotAutomationEnabled = computed(() => props.sessionMode === "autopilot");
const codexTerminalPresentation = computed(() => {
  const presentation = selectedSession.value?.presentation?.terminal?.codex;
  return presentation && typeof presentation === "object" && !Array.isArray(presentation)
    ? presentation
    : {};
});
const codexTerminalPreviewVisible = computed(() => Boolean(
  props.active &&
  props.sessionMode === "autopilot" &&
  codexTerminalPresentation.value.visible === true &&
  codexTerminalPresentation.value.terminalSessionId
));
const codexTerminalDisplayMode = computed(() => {
  if (!props.active) {
    return "headless";
  }
  if (props.sessionMode === "inspect") {
    return "full";
  }
  if (codexTerminalPreviewVisible.value) {
    return "compact";
  }
  return "headless";
});
const codexTerminalCanStart = computed(() => Boolean(props.active && props.sessionMode === "inspect"));
const codexTerminalReadOnly = computed(() => {
  if (props.sessionMode === "inspect") {
    return false;
  }
  return codexTerminalPresentation.value.readOnlyInAutopilot !== false;
});
const interactionBusy = computed(() => Boolean(page.busy || autopilotBusy.value));
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
