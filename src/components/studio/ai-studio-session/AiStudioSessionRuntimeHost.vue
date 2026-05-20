<template>
  <section class="studio-ai-session-runtime">
    <div
      class="studio-ai-sessions__layout"
      :class="`studio-ai-sessions__layout--${sessionMode}`"
    >
      <AiStudioAutopilotView
        v-show="sessionMode === 'autopilot'"
        :actions="actions"
        :active="active"
        :codex-terminal="codexTerminal"
        :codex-terminal-host-id="codexTerminalHostId"
        :command-runner="autopilotCommandRunner"
        :diff="dialogs.diff"
        :page="guardedPage"
        :refresh-session-data="sessionData.refreshSessionData"
        :review="review"
        :session="selection.selectedSession"
        @busy-change="setAutopilotBusy"
        @codex-waiting-change="setAutopilotCodexWaiting"
      />

      <AiStudioSessionWorkspace
        v-show="sessionMode === 'inspect'"
        :actions="actions"
        :dialogs="dialogs"
        :issue-request="issueRequest"
        :page="guardedPage"
        :review="review"
        :selection="selection"
        :timeline="timeline"
        @update-issue-request-text="issueRequest.text = $event"
      />

      <Teleport
        defer
        :to="codexTerminalHostSelector"
        :disabled="!autopilotCodexTerminalDocked"
      >
        <AiStudioSessionTerminals
          :codex-terminal="codexTerminal"
          :command-terminal="commandTerminal"
          :display-mode="codexTerminalDisplayMode"
          :headless-command-terminal="headlessCommandTerminal"
          :session="selection.selectedSession"
        />
      </Teleport>
    </div>

    <AiStudioSessionDialogs
      :dialogs="dialogs"
      :short-session-id="sessionData.shortSessionId"
      @update-draft-open="dialogs.draftEditor.open = $event"
      @update-draft-values="dialogs.draftEditor.values = $event"
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
  useAiStudioSessionWorkflow
} from "@/composables/useAiStudioSessionWorkflow.js";
import {
  aiStudioSessionFacts,
  buildAiStudioTimelineSteps,
  enrichAiStudioSessionForDisplay
} from "@/lib/aiStudioSessionPanelModel.js";
import {
  aiStudioSessionDisplayTitle,
  aiStudioSessionStatusColor,
  aiStudioSessionStatusLabel,
  isClosedAiStudioSession
} from "@/lib/aiStudioSessionViewModel.js";

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
  const sessions = unref(props.sessionData.sessions) || [];
  return sessions.find((session) => session.sessionId === props.sessionId) || null;
});
const selectedSession = computed(() => enrichAiStudioSessionForDisplay(selectedListSession.value));
const selectedSessionTitle = computed(() => {
  return aiStudioSessionDisplayTitle(selectedSession.value || {}) ||
    `Session ${props.sessionData.shortSessionId(props.sessionId)}`;
});
const isSelectedSessionClosed = computed(() => isClosedAiStudioSession(selectedSession.value || {}));
const sessionFacts = computed(() => aiStudioSessionFacts(selectedSession.value || {}));
const timelineSteps = computed(() => buildAiStudioTimelineSteps(selectedSession.value));
const codexTerminalHostId = computed(() => `studio-autopilot-codex-terminal-host-${props.sessionId}`);
const codexTerminalHostSelector = computed(() => `#${codexTerminalHostId.value}`);

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

const actions = proxyRefs(sessionWorkflow.actions);
const codexTerminal = proxyRefs(sessionWorkflow.codexTerminal);
const commandTerminal = proxyRefs(sessionWorkflow.commandTerminal);
const dialogs = {
  abandon: proxyRefs(sessionWorkflow.dialogs.abandon),
  diff: proxyRefs(sessionWorkflow.dialogs.diff),
  draftEditor: proxyRefs(sessionWorkflow.dialogs.draftEditor),
  input: proxyRefs(sessionWorkflow.dialogs.input)
};
const issueRequest = proxyRefs(sessionWorkflow.issueRequest);
const page = proxyRefs(sessionWorkflow.page);
const review = proxyRefs(sessionWorkflow.review);
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
const autopilotCodexWaiting = ref(false);
const autopilotCodexTerminalDocked = computed(() => {
  return props.active && props.sessionMode === "autopilot" && autopilotCodexWaiting.value;
});
const codexTerminalDisplayMode = computed(() => {
  // Inactive hosts stay mounted headless so Codex output capture remains session-owned.
  if (!props.active) {
    return "headless";
  }
  if (props.sessionMode === "inspect") {
    return "full";
  }
  return autopilotCodexTerminalDocked.value ? "compact" : "headless";
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

function setAutopilotCodexWaiting(waiting) {
  autopilotCodexWaiting.value = Boolean(waiting);
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
      fixCommandFailure: codexTerminal.fixCommandFailure
    },
    sessionId: props.sessionId
  });
}

onMounted(() => {
  emitToolbarControls();
  emitBusy();
  emitPageError();
});

watch(interactionBusy, emitBusy, {
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
}

.studio-ai-sessions__layout--inspect {
  grid-template-columns: minmax(18rem, 0.7fr) minmax(30rem, 1.3fr);
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
}
</style>
