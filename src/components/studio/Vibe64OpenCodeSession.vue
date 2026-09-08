<template>
  <div
    class="vibe64-opencode-session"
    :class="{ 'vibe64-opencode-session--headless': displayMode === 'headless' }"
    :aria-hidden="displayMode === 'headless' ? 'true' : undefined"
  >
    <Vibe64InteractiveTerminal
      :command-preview="terminalCommandPreview"
      :error="terminalError"
      error-title="OpenCode terminal needs attention"
      fill
      height="100%"
      :presentation="terminalPresentation"
      :show-interrupt="!readOnly"
      :stage="terminalSubtitle"
      :status="terminalStatus"
      :subtitle="terminalSubtitle"
      :terminal="terminalController"
      title="OpenCode terminal"
      :visible="terminalStreamActive"
      @clean-exit="closeTerminal"
      @close="closeTerminal"
    >
      <template #overlay>
        <div v-if="showStartPanel" class="vibe64-opencode-session__start-panel">
          <v-sheet
            class="vibe64-opencode-session__start-card"
            elevation="4"
            role="status"
            rounded="lg"
          >
            <div class="vibe64-opencode-session__start-icon">
              <v-icon :icon="terminalExited ? mdiRestart : mdiPlayCircleOutline" size="30" />
            </div>
            <div class="vibe64-opencode-session__start-copy">
              <strong>{{ terminalExited ? "OpenCode terminal exited" : "OpenCode terminal is off" }}</strong>
              <span>{{ sourcePending ? "The terminal can start after the session source is ready." : "Start an interactive OpenCode terminal for this session." }}</span>
            </div>
            <v-btn
              v-if="!sourcePending"
              :aria-busy="terminalStarting ? 'true' : undefined"
              class="vibe64-opencode-session__start-action"
              color="primary"
              :disabled="terminalStarting"
              :prepend-icon="terminalExited ? mdiRestart : mdiPlayCircleOutline"
              variant="flat"
              @click="restartTerminal"
            >
              {{ terminalStarting ? "Starting OpenCode…" : terminalExited ? "Restart OpenCode" : "Start OpenCode" }}
            </v-btn>
          </v-sheet>
        </div>
      </template>

      <template #footer="{ commandPreview, status }">
        <span class="vibe64-opencode-session__command">
          {{ commandPreview || "OpenCode is not running." }}
        </span>
        <v-chip v-if="status" size="x-small" variant="tonal">
          {{ status }}
        </v-chip>
      </template>
    </Vibe64InteractiveTerminal>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { mdiPlayCircleOutline, mdiRestart } from "@mdi/js";
import Vibe64InteractiveTerminal from "@/components/studio/Vibe64InteractiveTerminal.vue";
import { useVibe64Terminal } from "@/composables/useVibe64Terminal.js";
import { useVibe64TerminalCommands } from "@/composables/useVibe64TerminalCommands.js";
import { createWebSocketTerminalDriver } from "@/lib/vibe64TerminalDriver.js";
import { vibe64AgentTerminalWebSocketUrl } from "@/lib/vibe64SessionApi.js";
import { vibe64TerminalErrorMessage } from "@/lib/vibe64TerminalErrors.js";
import { vibe64SessionSourcePath } from "@/lib/vibe64SessionPaths.js";

const props = defineProps({
  allowStart: {
    default: true,
    type: Boolean
  },
  displayMode: {
    default: "full",
    type: String
  },
  listenWhenHidden: {
    default: false,
    type: Boolean
  },
  readOnly: {
    default: false,
    type: Boolean
  },
  session: {
    default: null,
    type: Object
  },
  visible: {
    default: true,
    type: Boolean
  }
});

const emit = defineEmits(["session-update"]);
const terminalCommands = useVibe64TerminalCommands();
const sessionId = computed(() => String(props.session?.sessionId || ""));
const sessionSource = computed(() => vibe64SessionSourcePath(props.session || {}));
const displayActive = computed(() => props.visible && props.displayMode !== "headless");
const serverTerminal = computed(() => {
  const terminal = props.session?.agentSession?.terminal;
  return terminal && typeof terminal === "object" && !Array.isArray(terminal)
    ? terminal
    : {};
});
const serverTerminalId = computed(() => String(
  serverTerminal.value.id || serverTerminal.value.terminalSessionId || ""
));
const hiddenListenActive = computed(() => Boolean(
  props.listenWhenHidden && serverTerminalId.value && !displayActive.value
));
const terminalStreamActive = computed(() => Boolean(displayActive.value || hiddenListenActive.value));
const terminalPresentation = computed(() => displayActive.value ? "inline" : "headless");

const terminalController = useVibe64Terminal({
  driver: createWebSocketTerminalDriver({
    closeSession: closeDriverSession,
    webSocketUrl(terminalId) {
      return vibe64AgentTerminalWebSocketUrl(sessionId.value, terminalId);
    }
  }),
  fitOnResize: true,
  initiallyVisible: false,
  liveResize: true,
  onStatusUpdate: emitTerminalState,
  readOnly: computed(() => props.readOnly),
  resizeReportDelayMs: 120
});

const {
  applyTerminalSession,
  closeTerminalSocket,
  connectTerminalSocket,
  disposeTerminalUi,
  resetTerminalDisplay,
  resetTerminalSessionState,
  terminalCommandPreview,
  terminalError,
  terminalExited,
  terminalSessionId,
  terminalStarting,
  terminalStatus
} = terminalController;

const sourcePending = computed(() => Boolean(
  displayActive.value && sessionId.value && !sessionSource.value && !terminalSessionId.value
));
const canStart = computed(() => Boolean(
  props.allowStart && displayActive.value && sessionId.value && sessionSource.value
));
const showStartPanel = computed(() => Boolean(
  displayActive.value &&
  !terminalStarting.value &&
  (!terminalSessionId.value || terminalExited.value)
));
const terminalSubtitle = computed(() => {
  if (terminalStarting.value) {
    return "Starting OpenCode";
  }
  return terminalExited.value ? "Exited" : terminalStatus.value === "running" ? "" : "OpenCode agent session";
});

function emitTerminalState() {
  const id = String(terminalSessionId.value || serverTerminalId.value || "");
  if (!sessionId.value || !id) {
    return;
  }
  emit("session-update", {
    agentTerminalCommandPreview: terminalCommandPreview.value,
    agentTerminalSessionId: id,
    agentTerminalStatus: terminalStatus.value,
    sessionId: sessionId.value
  });
}

async function closeDriverSession(terminalId) {
  const result = await terminalCommands.closeAgentTerminal(sessionId.value, terminalId);
  if (result?.ok === false) {
    throw new Error(vibe64TerminalErrorMessage(result, "OpenCode terminal process could not be stopped."));
  }
  return result;
}

async function attachTerminal(session = {}) {
  const id = String(session.id || session.terminalSessionId || "").trim();
  if (!id || id === terminalSessionId.value) {
    return Boolean(id);
  }
  closeTerminalSocket();
  resetTerminalDisplay();
  await applyTerminalSession({ ...session, id }, {
    fallbackStatus: session.status || "running",
    ownership: "attached"
  });
  if (terminalStreamActive.value) {
    void connectTerminalSocket();
  }
  return true;
}

async function startTerminal() {
  if (!canStart.value) {
    return false;
  }
  if (terminalExited.value) {
    closeTerminalSocket();
    resetTerminalSessionState();
    resetTerminalDisplay();
  }
  terminalStarting.value = true;
  terminalError.value = "";
  try {
    const session = await terminalCommands.startAgentTerminal(sessionId.value);
    if (session?.ok === false || !session?.id) {
      throw new Error(vibe64TerminalErrorMessage(session, "OpenCode terminal failed to start."));
    }
    await applyTerminalSession(session, {
      fallbackStatus: "running",
      ownership: "owned"
    });
    emitTerminalState();
    return await connectTerminalSocket();
  } catch (error) {
    terminalError.value = vibe64TerminalErrorMessage(error, "OpenCode terminal failed to start.");
    return false;
  } finally {
    terminalStarting.value = false;
  }
}

async function closeTerminal() {
  if (!terminalSessionId.value) {
    detachTerminal();
    return true;
  }
  if (!(await terminalController.closeTerminal({ deleteSession: true }))) {
    return false;
  }
  resetTerminalDisplay();
  emitTerminalState();
  return true;
}

async function restartTerminal() {
  terminalError.value = "";
  if (terminalSessionId.value && !(await closeTerminal())) {
    return false;
  }
  return startTerminal();
}

function detachTerminal() {
  closeTerminalSocket();
  resetTerminalSessionState();
  resetTerminalDisplay();
}

watch(serverTerminal, (terminal) => {
  void attachTerminal(terminal);
}, {
  flush: "post",
  immediate: true
});

watch(terminalStreamActive, (active) => {
  if (active && terminalSessionId.value) {
    void connectTerminalSocket();
  }
});

watch(sessionId, (_next, previous) => {
  if (previous) {
    detachTerminal();
  }
});

onMounted(() => {
  if (terminalStreamActive.value && terminalSessionId.value) {
    void connectTerminalSocket();
  }
});

onBeforeUnmount(() => {
  detachTerminal();
  disposeTerminalUi();
});
</script>

<style scoped>
.vibe64-opencode-session {
  block-size: 100%;
  min-block-size: 0;
  min-inline-size: 0;
  position: relative;
}

.vibe64-opencode-session--headless {
  block-size: 0;
  inline-size: 0;
  overflow: hidden;
  position: absolute;
}

.vibe64-opencode-session__start-panel {
  align-items: center;
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 1rem;
  position: absolute;
}

.vibe64-opencode-session__start-card {
  align-items: center;
  display: grid;
  gap: 0.9rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  max-inline-size: 48rem;
  padding: 1rem;
  width: 100%;
}

.vibe64-opencode-session__start-icon {
  align-items: center;
  background: rgb(var(--v-theme-secondary-container));
  border-radius: 50%;
  color: rgb(var(--v-theme-on-secondary-container));
  display: flex;
  height: 3.25rem;
  justify-content: center;
  width: 3.25rem;
}

.vibe64-opencode-session__start-copy {
  display: grid;
  gap: 0.2rem;
}

.vibe64-opencode-session__start-copy span,
.vibe64-opencode-session__command {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-size: 0.82rem;
}

@media (max-width: 600px) {
  .vibe64-opencode-session__start-card {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .vibe64-opencode-session__start-action {
    grid-column: 1 / -1;
  }
}
</style>
