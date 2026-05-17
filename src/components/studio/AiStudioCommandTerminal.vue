<template>
  <v-sheet rounded="lg" class="ai-command-terminal">
    <div class="ai-command-terminal__bar">
      <div>
        <div class="ai-command-terminal__title">Command terminal</div>
        <div class="ai-command-terminal__subtitle">
          {{ activeActionLabel || "Run adapter commands here." }}
        </div>
      </div>
      <div class="ai-command-terminal__actions">
        <v-btn
          :icon="expanded ? mdiChevronDown : mdiChevronUp"
          size="small"
          variant="text"
          @click="toggleExpanded"
        />
        <v-btn
          v-if="canRetry"
          color="primary"
          :loading="terminalStarting"
          size="small"
          variant="flat"
          @click="restartTerminal"
        >
          Retry
        </v-btn>
        <v-btn
          :disabled="!terminalSessionId || terminalExited"
          size="small"
          variant="text"
          @click="sendCtrlC"
        >
          Ctrl-C
        </v-btn>
        <v-btn
          :disabled="!terminalSessionId"
          size="small"
          variant="text"
          @click="closeTerminal"
        >
          Close
        </v-btn>
      </div>
    </div>

    <v-expand-transition>
      <div v-show="expanded" class="ai-command-terminal__body">
        <StudioErrorNotice
          v-if="terminalError"
          title="Command terminal needs attention"
          :error="terminalError"
          compact
          class="mb-2"
        />

        <div ref="terminalHost" class="ai-command-terminal__host" />

        <div class="ai-command-terminal__footer">
          <span>{{ terminalCommandPreview || "No command running." }}</span>
          <v-chip v-if="terminalStatus" size="x-small" variant="tonal">
            {{ terminalStatus }}
          </v-chip>
        </div>
      </div>
    </v-expand-transition>
  </v-sheet>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  mdiChevronDown,
  mdiChevronUp
} from "@mdi/js";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import { useStudioTerminal } from "@/composables/useStudioTerminal.js";
import {
  aiStudioCommandTerminalWebSocketUrl,
  closeAiStudioCommandTerminal,
  startAiStudioCommandTerminal
} from "@/lib/aiStudioSessionApi.js";

const props = defineProps({
  action: {
    type: Object,
    default: null
  },
  session: {
    type: Object,
    default: null
  },
  startRequestKey: {
    type: [String, Number],
    default: ""
  }
});

const emit = defineEmits(["finished", "running-changed"]);

const terminalClosedByUser = ref(false);
const expanded = ref(true);

let terminalStartPromise = null;
let finishedEmittedForTerminalId = "";
let handledStartRequestKey = "";

const FINISHED_TERMINAL_HOLD_MS = 500;

const sessionId = computed(() => props.session?.sessionId || "");
const actionId = computed(() => props.action?.id || "");
const activeActionLabel = computed(() => props.action?.label || "");

const {
  applyTerminalSession,
  closeTerminalSocket,
  connectTerminalSocket,
  disposeTerminalUi,
  resetTerminalDisplay,
  resetTerminalSessionState,
  sendCtrlC,
  setupTerminalUi,
  terminalCommandPreview,
  terminalError,
  terminalExited,
  terminalExitCode,
  terminalHost,
  terminalSessionId,
  terminalStarting,
  terminalStatus
} = useStudioTerminal({
  onStatusUpdate: handleTerminalStatusUpdate,
  webSocketUrl(terminalId) {
    return aiStudioCommandTerminalWebSocketUrl(sessionId.value, terminalId);
  }
});

const canRetry = computed(() => Boolean(
  sessionId.value &&
  actionId.value &&
  (
    terminalError.value ||
    terminalClosedByUser.value ||
    (terminalExited.value && terminalExitCode.value !== 0)
  )
));

function terminalIsRunning(status = terminalStatus.value) {
  return status === "running" || status === "closing" || terminalStarting.value;
}

function emitRunningState() {
  emit("running-changed", terminalIsRunning());
}

function scheduleFinished(exitCode, closeError = "") {
  if (!terminalSessionId.value || finishedEmittedForTerminalId === terminalSessionId.value) {
    return;
  }
  finishedEmittedForTerminalId = terminalSessionId.value;
  window.setTimeout(() => {
    emit("finished", {
      actionId: actionId.value,
      closeError: String(closeError || terminalError.value || ""),
      exitCode,
      sessionId: sessionId.value
    });
  }, FINISHED_TERMINAL_HOLD_MS);
}

function handleTerminalStatusUpdate({
  closeError = "",
  exitCode = null,
  status = ""
} = {}) {
  terminalError.value = String(closeError || terminalError.value || "");
  emitRunningState();
  if (status === "exited") {
    scheduleFinished(exitCode, closeError);
  }
}

async function startTerminal() {
  if (!sessionId.value || !actionId.value) {
    return false;
  }
  if (terminalStartPromise) {
    return terminalStartPromise;
  }
  terminalStartPromise = (async () => {
    terminalStarting.value = true;
    emitRunningState();
    terminalError.value = "";
    expanded.value = true;
    if (!(await setupTerminalUi())) {
      terminalError.value = "Terminal view is not ready yet.";
      return false;
    }
    try {
      terminalClosedByUser.value = false;
      const session = await startAiStudioCommandTerminal(sessionId.value, actionId.value);
      if (session?.ok === false) {
        throw new Error(session.error || session.errors?.[0]?.message || "Command terminal failed to start.");
      }
      const nextTerminalSessionId = session.id || "";
      if (nextTerminalSessionId && nextTerminalSessionId !== terminalSessionId.value) {
        closeTerminalSocket();
        resetTerminalDisplay();
        finishedEmittedForTerminalId = "";
      }
      applyTerminalSession(session, {
        fallbackStatus: "running"
      });
      emitRunningState();
      return connectTerminalSocket();
    } catch (error) {
      terminalError.value = String(error?.message || error || "Command terminal failed to start.");
      return false;
    } finally {
      terminalStarting.value = false;
      emitRunningState();
    }
  })();

  try {
    return await terminalStartPromise;
  } finally {
    terminalStartPromise = null;
  }
}

async function closeTerminal() {
  const existingTerminalId = terminalSessionId.value;
  resetTerminalSessionState();
  terminalClosedByUser.value = true;
  emitRunningState();
  closeTerminalSocket();
  if (existingTerminalId && sessionId.value) {
    await closeAiStudioCommandTerminal(sessionId.value, existingTerminalId).catch(() => null);
  }
}

async function restartTerminal() {
  await closeTerminal();
  resetTerminalDisplay();
  finishedEmittedForTerminalId = "";
  terminalClosedByUser.value = false;
  await startTerminal();
}

function toggleExpanded() {
  expanded.value = !expanded.value;
  if (expanded.value) {
    void setupTerminalUi();
  }
}

watch(() => props.startRequestKey, async (nextKey) => {
  const normalizedKey = String(nextKey || "");
  if (!normalizedKey || normalizedKey === handledStartRequestKey) {
    return;
  }
  handledStartRequestKey = normalizedKey;
  await startTerminal();
});

watch(sessionId, () => {
  resetTerminalSessionState();
  resetTerminalDisplay();
  finishedEmittedForTerminalId = "";
  terminalClosedByUser.value = false;
  closeTerminalSocket();
  emitRunningState();
});

watch(terminalHost, (host) => {
  if (host) {
    void setupTerminalUi();
  }
}, {
  flush: "post"
});

defineExpose({
  start: startTerminal
});

onBeforeUnmount(() => {
  disposeTerminalUi();
  emit("running-changed", false);
});
</script>

<style scoped>
.ai-command-terminal {
  min-width: 0;
  padding: 0.75rem;
}

.ai-command-terminal__bar,
.ai-command-terminal__footer {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.ai-command-terminal__bar {
  margin-bottom: 0.5rem;
}

.ai-command-terminal__title {
  font-size: 0.85rem;
  font-weight: 700;
}

.ai-command-terminal__subtitle,
.ai-command-terminal__footer {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.75rem;
}

.ai-command-terminal__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  justify-content: flex-end;
}

.ai-command-terminal__body {
  display: grid;
  gap: 0.5rem;
}

.ai-command-terminal__host {
  background: #101216;
  border: 2px solid rgba(var(--v-theme-outline), 0.38);
  border-radius: 6px;
  height: clamp(18rem, 38vh, 32rem);
  overflow: hidden;
  padding: 0.35rem;
}

.ai-command-terminal__footer span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 700px) {
  .ai-command-terminal__bar,
  .ai-command-terminal__footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .ai-command-terminal__host {
    height: min(58vh, 28rem);
  }
}
</style>
