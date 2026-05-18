<template>
  <v-sheet rounded="lg" class="ai-command-terminal">
    <div class="ai-command-terminal__bar">
      <div>
        <div class="ai-command-terminal__title">{{ terminalTitle }}</div>
        <div class="ai-command-terminal__subtitle">
          {{ terminalSubtitle }}
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
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  mdiChevronDown,
  mdiChevronUp
} from "@mdi/js";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import { useStudioTerminal } from "@/composables/useStudioTerminal.js";
import {
  aiStudioCommandTerminalWebSocketUrl,
  aiStudioLaunchTerminalWebSocketUrl
} from "@/lib/aiStudioSessionApi.js";
import {
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  aiStudioCommandTerminalPath,
  aiStudioLaunchTerminalPath
} from "@/lib/aiStudioSessionRequestConfig.js";

const props = defineProps({
  action: {
    type: Object,
    default: null
  },
  actionInput: {
    type: Object,
    default: () => ({})
  },
  launchTarget: {
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
  },
  terminalKind: {
    type: String,
    default: "command"
  },
  title: {
    type: String,
    default: ""
  }
});

const emit = defineEmits(["closed", "finished", "running-changed", "started"]);

const terminalClosedByUser = ref(false);
const expanded = ref(true);
const paths = usePaths();

let terminalStartPromise = null;
let finishedEmittedForTerminalId = "";
let handledStartRequestKey = "";

const FINISHED_TERMINAL_HOLD_MS = 500;

const sessionId = computed(() => props.session?.sessionId || "");
const actionId = computed(() => props.action?.id || "");
const activeActionLabel = computed(() => props.action?.label || "");
const launchTargetId = computed(() => props.launchTarget?.id || "");
const launchTargetLabel = computed(() => props.launchTarget?.label || "");
const sessionsApiPath = computed(() => paths.api(AI_STUDIO_SESSIONS_API_SUFFIX, {
  surface: AI_STUDIO_SURFACE_ID
}));
const launchTerminal = computed(() => props.terminalKind === "launch");
const terminalTitle = computed(() => {
  if (props.title) {
    return props.title;
  }
  if (launchTerminal.value) {
    return "Launch terminal";
  }
  return "Command terminal";
});
const terminalSubtitle = computed(() => {
  if (launchTerminal.value) {
    return launchTargetLabel.value || "Run a launch target.";
  }
  return activeActionLabel.value || "Run adapter commands here.";
});
const startFailureMessage = computed(() => {
  if (launchTerminal.value) {
    return "Launch terminal failed to start.";
  }
  return "Command terminal failed to start.";
});
const canStartTerminal = computed(() => {
  return Boolean(
    sessionId.value &&
    (
      (launchTerminal.value && launchTargetId.value) ||
      actionId.value
    )
  );
});

function terminalPath({
  sessionId: selectedSessionId = "",
  terminalKind = "command",
  terminalSessionId: selectedTerminalSessionId = ""
} = {}) {
  if (terminalKind === "launch") {
    return aiStudioLaunchTerminalPath(sessionsApiPath.value, selectedSessionId, selectedTerminalSessionId);
  }
  return aiStudioCommandTerminalPath(sessionsApiPath.value, selectedSessionId, selectedTerminalSessionId);
}

const startTerminalCommand = useCommand({
  access: "never",
  apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
  buildCommandOptions: (_payload, { context }) => ({
    method: "POST",
    options: LOCAL_STUDIO_COMMAND_OPTIONS,
    path: terminalPath(context)
  }),
  buildRawPayload: (_model, { context }) => {
    if (context.terminalKind === "launch") {
      return {
        launchTargetId: String(context.launchTargetId || "")
      };
    }
    if (context.terminalKind === "command") {
      return {
        actionId: String(context.actionId || ""),
        input: context.actionInput || {}
      };
    }
    return {};
  },
  fallbackRunError: "Terminal failed to start.",
  messages: {
    error: "Terminal failed to start."
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.command-terminal.start",
  suppressSuccessMessage: true,
  surfaceId: AI_STUDIO_SURFACE_ID,
  writeMethod: "POST"
});

const closeTerminalCommand = useCommand({
  access: "never",
  apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
  buildCommandOptions: (_payload, { context }) => ({
    method: "DELETE",
    options: LOCAL_STUDIO_COMMAND_OPTIONS,
    path: terminalPath(context)
  }),
  fallbackRunError: "Terminal could not close.",
  messages: {
    error: "Terminal could not close."
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.command-terminal.close",
  suppressSuccessMessage: true,
  surfaceId: AI_STUDIO_SURFACE_ID,
  writeMethod: "DELETE"
});

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
    if (launchTerminal.value) {
      return aiStudioLaunchTerminalWebSocketUrl(sessionId.value, terminalId);
    }
    return aiStudioCommandTerminalWebSocketUrl(sessionId.value, terminalId);
  }
});

const canRetry = computed(() => Boolean(
  canStartTerminal.value &&
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
  if (!canStartTerminal.value) {
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
      const session = await startTerminalCommand.run({
        actionId: actionId.value,
        actionInput: props.actionInput || {},
        launchTargetId: launchTargetId.value,
        sessionId: sessionId.value,
        terminalKind: props.terminalKind
      });
      if (session?.ok === false) {
        throw new Error(session.error || session.errors?.[0]?.message || startFailureMessage.value);
      }
      if (!session) {
        throw new Error(startFailureMessage.value);
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
      emit("started", {
        appUrl: session.metadata?.appUrl || "",
        metadata: session.metadata || {},
        sessionId: sessionId.value,
        terminalSessionId: terminalSessionId.value
      });
      emitRunningState();
      return connectTerminalSocket();
    } catch (error) {
      terminalError.value = String(error?.message || error || startFailureMessage.value);
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

async function closeTerminal({
  emitClosed = true
} = {}) {
  const existingTerminalId = terminalSessionId.value;
  resetTerminalSessionState();
  terminalClosedByUser.value = true;
  emitRunningState();
  closeTerminalSocket();
  if (existingTerminalId && sessionId.value) {
    await closeTerminalCommand.run({
      sessionId: sessionId.value,
      terminalKind: props.terminalKind,
      terminalSessionId: existingTerminalId
    }).catch(() => null);
  }
  if (emitClosed) {
    emit("closed");
  }
}

async function restartTerminal() {
  await closeTerminal({
    emitClosed: false
  });
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
}, {
  immediate: true
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

@media (min-width: 981px) {
  .ai-command-terminal {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .ai-command-terminal__body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
  }

  .ai-command-terminal__host {
    flex: 1 1 auto;
    height: auto;
    min-height: 0;
  }
}
</style>
