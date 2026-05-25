<template>
  <section class="studio-ai-session-runtime">
    <div
      class="studio-ai-sessions__layout"
      :class="`studio-ai-sessions__layout--${sessionMode}`"
    >
      <AiStudioAutopilotView
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
        <AiStudioSessionWorkspace
          class="studio-ai-sessions__inspect-workspace"
          :actions="actions"
          :dialogs="dialogs"
          :page="guardedPage"
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

      <AiStudioSessionTerminals
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

    <AiStudioSessionDialogs
      :dialogs="dialogs"
      :short-session-id="sessionData.shortSessionId"
      @update-input-values="dialogs.input.values = $event"
    />
  </section>
</template>

<script setup>
import { computed, onMounted, proxyRefs, ref, unref, watch } from "vue";
import AiStudioAutopilotView from "@/components/studio/ai-studio-session/AiStudioAutopilotView.vue";
import AiStudioSessionDialogs from "@/components/studio/ai-studio-session/AiStudioSessionDialogs.vue";
import AiStudioSessionTerminals from "@/components/studio/ai-studio-session/AiStudioSessionTerminals.vue";
import AiStudioSessionWorkspace from "@/components/studio/ai-studio-session/AiStudioSessionWorkspace.vue";
import {
  useAiStudioHeadlessCommandRunner
} from "@/composables/useAiStudioHeadlessCommandRunner.js";
import {
  useAiStudioArtifactReadiness
} from "@/composables/useAiStudioArtifactReadiness.js";
import {
  useAiStudioHumanInputResponsePreview
} from "@/composables/useAiStudioHumanInputResponsePreview.js";
import {
  useAiStudioConversationLog
} from "@/composables/useAiStudioConversationLog.js";
import {
  useAiStudioSessionWorkflow
} from "@/composables/useAiStudioSessionWorkflow.js";
import {
  useAiStudioReportPreview
} from "@/composables/useAiStudioReportPreview.js";
import {
  aiStudioSessionFacts,
  buildAiStudioAutopilotNavigationSteps,
  buildAiStudioTimelineSteps,
  enrichAiStudioSessionForDisplay
} from "@/lib/aiStudioSessionPanelModel.js";
import {
  aiStudioSessionDisplayTitle,
  aiStudioSessionStatusColor,
  aiStudioSessionStatusLabel,
  isClosedAiStudioSession
} from "@/lib/aiStudioSessionViewModel.js";
import {
  aiStudioShellPanelTargetId
} from "@/lib/aiStudioShellPanelTarget.js";
import {
  aiStudioSessionDebugLog,
  aiStudioSessionDebugSummary
} from "@/lib/aiStudioSessionDebugLog.js";

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
const selectedSession = computed(() => enrichAiStudioSessionForDisplay(selectedListSession.value));
const selectedSessionTitle = computed(() => {
  return aiStudioSessionDisplayTitle(selectedSession.value || {}) ||
    `Session ${props.sessionData.shortSessionId(props.sessionId)}`;
});
const shellPanelTargetId = computed(() => aiStudioShellPanelTargetId(props.sessionId));
const isSelectedSessionClosed = computed(() => isClosedAiStudioSession(selectedSession.value || {}));
const sessionFacts = computed(() => aiStudioSessionFacts(selectedSession.value || {}));
const timelineSteps = computed(() => buildAiStudioTimelineSteps(selectedSession.value));
const autopilotNavigationSteps = computed(() => buildAiStudioAutopilotNavigationSteps(selectedSession.value));
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
const sessionWorkflow = useAiStudioSessionWorkflow({
  sessionData: sessionScopedData
});
const autopilotCommandRunner = useAiStudioHeadlessCommandRunner();
const artifactReadiness = useAiStudioArtifactReadiness({
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
const reportPreview = proxyRefs(useAiStudioReportPreview({
  active: computed(() => props.active),
  artifactReadiness: liveArtifactReadiness,
  session: selectedSession
}));
const humanInputResponsePreview = proxyRefs(useAiStudioHumanInputResponsePreview({
  active: computed(() => props.active),
  artifactReadiness: liveArtifactReadiness,
  session: selectedSession
}));
const conversationLog = proxyRefs(useAiStudioConversationLog({
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
  statusColor: aiStudioSessionStatusColor,
  statusLabel: aiStudioSessionStatusLabel
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
const codexTerminalReadOnly = computed(() => props.sessionMode !== "inspect");
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
  aiStudioSessionDebugLog("client.sessionRuntimeHost.state", {
    ...aiStudioSessionDebugSummary(selectedSession.value || {}),
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
    aiStudioSessionDebugLog("client.sessionRuntimeHost.artifactReadiness.changed", {
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
  align-items: flex-start;
  display: grid;
  gap: 0.9rem;
  min-height: 0;
}

.studio-ai-sessions__layout--autopilot {
  grid-template-columns: minmax(0, 1fr);
  position: relative;
}

.studio-ai-sessions__layout--inspect {
  grid-template-columns: minmax(18rem, 0.78fr) minmax(30rem, 1.22fr);
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
    grid-template-columns: minmax(12rem, 15rem) minmax(0, 1fr);
  }

  .studio-ai-sessions__layout--autopilot > .studio-autopilot {
    grid-column: 1 / -1;
  }

  .studio-ai-sessions__layout--autopilot > .studio-ai-sessions__terminals--autopilot-preview {
    grid-column: 2;
    max-width: min(64rem, 100%);
    width: 100%;
  }
}
</style>
