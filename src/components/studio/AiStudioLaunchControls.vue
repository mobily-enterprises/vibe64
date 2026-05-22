<template>
  <div v-if="visible" class="ai-studio-launch-controls">
    <div
      v-if="terminalDockVisible"
      class="ai-studio-launch-controls__dock"
      :title="terminalTitle"
    >
      <span
        class="ai-studio-launch-controls__status-dot"
        :class="`ai-studio-launch-controls__status-dot--${terminalIndicatorState}`"
        :aria-label="terminalIndicatorLabel"
        :title="terminalIndicatorLabel"
      />

      <v-btn
        v-for="action in launchActions"
        :key="action.id || action.href"
        :icon="mdiOpenInNew"
        size="small"
        :title="action.label || action.href"
        variant="text"
        @click="openAction(action)"
      />

      <v-btn
        v-if="terminalCanRetry"
        :disabled="operationBusy"
        :icon="mdiRefresh"
        size="small"
        title="Retry"
        variant="text"
        @click="retryTerminal"
      />

      <v-btn
        v-if="terminalCanRestart"
        :disabled="operationBusy"
        :icon="mdiRestart"
        size="small"
        title="Restart"
        variant="text"
        @click="restartTerminal"
      />

      <v-btn
        :icon="mdiConsoleLine"
        size="small"
        title="Show launch terminal"
        variant="text"
        @click="expandTerminal"
      />
    </div>

    <v-menu v-else-if="!terminalVisible && launchTargets.length > 0" location="bottom end">
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps"
          color="primary"
          :disabled="runMenuDisabled"
          :loading="loading"
          :prepend-icon="mdiPlayCircleOutline"
          :size="buttonSize"
          title="Run target"
          :variant="buttonVariant"
        >
          {{ buttonLabel }}
        </v-btn>
      </template>

      <v-list class="ai-studio-launch-controls__menu" density="compact">
        <v-list-item
          v-for="launchTarget in launchTargets"
          :key="launchTarget.id"
          :disabled="launchButtonsDisabled || launchTarget.available === false"
          :prepend-icon="mdiPlayCircleOutline"
          :subtitle="launchTarget.disabledReason || ''"
          :title="launchTarget.label"
          @click="run(launchTarget)"
        />
      </v-list>
    </v-menu>

    <v-chip
      v-if="loadError"
      color="warning"
      size="small"
      variant="tonal"
      :title="loadError"
    >
      Launch unavailable
    </v-chip>

    <AiStudioFloatingTerminalWindow
      :displayed="terminalDisplayed"
      :minimized="false"
      :storage-key="terminalWindowStorageKey"
      :visible="terminalWindowVisible"
    >
      <template #default="{ startDrag }">
        <AiStudioTerminalFrame
          class="ai-studio-launch-controls__terminal"
          :command-preview="terminalCommandPreview"
          draggable
          :error="terminalError"
          :status="terminalStatus"
          :subtitle="terminalSubtitle"
          :terminal-host-ref="setTerminalHost"
          :title="terminalTitle"
          @drag-start="startDrag"
        >
          <template #actions>
            <v-btn
              :icon="mdiChevronDown"
              size="small"
              title="Minimize terminal"
              variant="text"
              @click="minimizeTerminal"
            />

            <v-btn
              v-for="action in launchActions"
              :key="`window:${action.id || action.href}`"
              color="primary"
              :prepend-icon="mdiOpenInNew"
              size="small"
              :title="action.href"
              variant="tonal"
              @click="openAction(action)"
            >
              {{ action.label || "Open" }}
            </v-btn>

            <v-btn
              v-if="terminalCanRestart"
              color="primary"
              :disabled="operationBusy"
              :prepend-icon="mdiRestart"
              size="small"
              variant="tonal"
              @click="restartTerminal"
            >
              Restart
            </v-btn>

            <v-btn
              v-if="terminalCanStop"
              :disabled="operationBusy"
              :prepend-icon="mdiStop"
              size="small"
              variant="tonal"
              @click="stopTerminal"
            >
              Stop
            </v-btn>

            <v-btn
              v-if="terminalCanRetry"
              color="primary"
              :disabled="operationBusy"
              :prepend-icon="mdiRefresh"
              size="small"
              variant="flat"
              @click="retryTerminal"
            >
              Retry
            </v-btn>

            <v-btn
              v-if="workflowAiFixVisible"
              color="primary"
              :prepend-icon="mdiRobotOutline"
              size="small"
              variant="tonal"
              @click="requestAiFix"
            >
              Get AI to fix it
            </v-btn>

            <v-btn
              v-if="terminalCanCopyLog"
              :icon="mdiContentCopy"
              size="small"
              title="Copy log"
              variant="text"
              @click="copyLog"
            />

            <v-btn
              v-if="terminalCanClose"
              :disabled="operationBusy"
              :prepend-icon="mdiClose"
              size="small"
              variant="text"
              @click="closeTerminal"
            >
              Close
            </v-btn>
          </template>
        </AiStudioTerminalFrame>
      </template>
    </AiStudioFloatingTerminalWindow>
  </div>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiChevronDown,
  mdiClose,
  mdiConsoleLine,
  mdiContentCopy,
  mdiOpenInNew,
  mdiPlayCircleOutline,
  mdiRefresh,
  mdiRobotOutline,
  mdiRestart,
  mdiStop
} from "@mdi/js";
import AiStudioFloatingTerminalWindow from "@/components/studio/AiStudioFloatingTerminalWindow.vue";
import AiStudioTerminalFrame from "@/components/studio/AiStudioTerminalFrame.vue";
import {
  launchTerminalAiFixAvailable,
  useAiStudioLaunchControls
} from "@/composables/useAiStudioLaunchControls.js";
import {
  terminalFailureFixRequest
} from "@/lib/aiStudioTerminalFailurePrompt.js";

const props = defineProps({
  buttonLabel: {
    default: "Run",
    type: String
  },
  buttonSize: {
    default: "small",
    type: String
  },
  buttonVariant: {
    default: "tonal",
    type: String
  },
  busy: {
    type: Boolean,
    default: false
  },
  fixCommandFailure: {
    type: Function,
    default: null
  },
  session: {
    type: Object,
    default: null
  },
  windowDisplayed: {
    type: Boolean,
    default: true
  },
  workflowCommand: {
    type: Boolean,
    default: false
  }
});

const {
  activeLaunchTarget,
  activeLaunchTargetId,
  closeTerminal,
  copyLog,
  expandTerminal,
  launchActions,
  launchButtonsDisabled,
  launchTargets,
  loading,
  loadError,
  minimizeTerminal,
  openAction,
  operationBusy,
  restartTerminal,
  retryTerminal,
  run,
  setTerminalHost,
  stopTerminal,
  terminalCanClose,
  terminalCanCopyLog,
  terminalCanRestart,
  terminalCanRetry,
  terminalCanStop,
  terminalCommandPreview,
  terminalDisplayed,
  terminalDockVisible,
  terminalError,
  terminalExitCode,
  terminalIndicatorLabel,
  terminalIndicatorState,
  terminalIsRunning,
  terminalOutput,
  terminalSessionId,
  terminalStatus,
  terminalSubtitle,
  terminalTitle,
  terminalVisible,
  terminalWindowVisible,
  terminalWindowStorageKey,
  visible
} = useAiStudioLaunchControls({
  windowDisplayed: () => props.windowDisplayed,
  busy: () => props.busy,
  session: () => props.session
});

const runMenuDisabled = computed(() => Boolean(
  launchButtonsDisabled.value ||
  loading.value ||
  launchTargets.value.length < 1
));
const launchTerminalFailed = computed(() => Boolean(
  terminalError.value ||
  (
    terminalStatus.value === "exited" &&
    terminalExitCode.value !== 0
  )
));
const workflowAiFixVisible = computed(() => Boolean(
  launchTerminalAiFixAvailable({
    fixCommandFailure: props.fixCommandFailure,
    workflowCommand: props.workflowCommand
  }) &&
  !terminalIsRunning.value &&
  launchTerminalFailed.value &&
  (
    terminalOutput.value ||
    terminalCommandPreview.value ||
    terminalError.value
  )
));

function requestAiFix() {
  if (!workflowAiFixVisible.value) {
    return null;
  }
  minimizeTerminal();
  return props.fixCommandFailure?.(terminalFailureFixRequest({
    closeError: terminalError.value,
    commandPreview: terminalCommandPreview.value,
    exitCode: terminalExitCode.value,
    launchTargetId: activeLaunchTargetId.value,
    launchTargetLabel: activeLaunchTarget.value?.label || activeLaunchTargetId.value,
    output: terminalOutput.value,
    sessionId: props.session?.sessionId || "",
    terminalKind: "launch",
    terminalSessionId: terminalSessionId.value,
    terminalStatus: terminalStatus.value
  }));
}
</script>

<style scoped>
.ai-studio-launch-controls {
  align-items: center;
  display: flex;
  gap: 0.45rem;
  justify-content: flex-end;
  min-width: 0;
}

.ai-studio-launch-controls__dock {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.08);
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 999px;
  display: flex;
  gap: 0.12rem;
  min-height: 2.25rem;
  padding: 0 0.25rem;
}

.ai-studio-launch-controls__status-dot {
  border-radius: 999px;
  display: inline-block;
  flex: 0 0 auto;
  height: 0.55rem;
  margin: 0 0.35rem;
  width: 0.55rem;
}

.ai-studio-launch-controls__status-dot--stopped {
  background: rgba(var(--v-theme-on-surface), 0.38);
  box-shadow: 0 0 0 0.2rem rgba(var(--v-theme-on-surface), 0.08);
}

.ai-studio-launch-controls__status-dot--starting {
  animation: ai-studio-launch-status-pulse 0.9s ease-in-out infinite;
  background: rgb(var(--v-theme-error));
  box-shadow: 0 0 0 0.2rem rgba(var(--v-theme-error), 0.14);
}

.ai-studio-launch-controls__status-dot--running {
  background: rgb(var(--v-theme-success));
  box-shadow: 0 0 0 0.2rem rgba(var(--v-theme-success), 0.16);
}

.ai-studio-launch-controls__status-dot--failed {
  background: rgb(var(--v-theme-error));
  box-shadow: 0 0 0 0.2rem rgba(var(--v-theme-error), 0.14);
}

.ai-studio-launch-controls__menu {
  max-width: min(20rem, 92vw);
  min-width: min(14rem, 92vw);
}

.ai-studio-launch-controls__terminal {
  box-shadow: 0 1rem 3rem rgba(13, 24, 42, 0.24);
  height: 100%;
}

.ai-studio-launch-controls__terminal :deep(.ai-studio-terminal-frame__host) {
  height: calc(100% - 5rem);
}

@keyframes ai-studio-launch-status-pulse {
  0%,
  100% {
    opacity: 0.32;
    transform: scale(0.84);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}

</style>
