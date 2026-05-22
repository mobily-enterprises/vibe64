<template>
  <div v-if="visible" class="ai-studio-launch-controls">
    <v-menu location="bottom end">
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
      minimized-width="min(28rem, calc(100vw - 1.5rem))"
      :minimized="terminalMinimized"
      :storage-key="terminalWindowStorageKey"
      :visible="terminalVisible"
    >
      <template #default="{ startDrag }">
        <AiStudioCommandTerminal
          class="ai-studio-launch-controls__terminal"
          :ai-fix-available="workflowAiFixAvailable"
          draggable
          :initial-expanded="!terminalMinimized"
          terminal-kind="launch"
          title="Launch terminal"
          :launch-target="activeLaunchTarget"
          :session="session"
          :start-request-key="startKey"
          @closed="closeTerminal"
          @drag-start="startDrag"
          @expanded-changed="handleTerminalExpandedChanged"
          @fix-requested="handleFixRequested"
          @ready="handleReady"
          @running-changed="handleRunningChanged"
          @started="handleStarted"
        >
          <template #header-actions>
            <v-btn
              v-if="showOpenTarget"
              color="primary"
              :disabled="openDisabled"
              :loading="openTargetCommand.isRunning"
              :prepend-icon="mdiOpenInNew"
              size="small"
              :title="openTitle"
              variant="tonal"
              @click="open"
            >
              {{ openTarget.label || "Open browser" }}
            </v-btn>
          </template>
        </AiStudioCommandTerminal>
      </template>
    </AiStudioFloatingTerminalWindow>
  </div>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiOpenInNew,
  mdiPlayCircleOutline
} from "@mdi/js";
import AiStudioCommandTerminal from "@/components/studio/AiStudioCommandTerminal.vue";
import AiStudioFloatingTerminalWindow from "@/components/studio/AiStudioFloatingTerminalWindow.vue";
import {
  launchTerminalAiFixAvailable,
  useAiStudioLaunchControls
} from "@/composables/useAiStudioLaunchControls.js";

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

const workflowAiFixAvailable = computed(() => (
  launchTerminalAiFixAvailable({
    fixCommandFailure: props.fixCommandFailure,
    workflowCommand: props.workflowCommand
  })
));

const {
  activeLaunchTarget,
  closeTerminal,
  handleRunningChanged,
  handleReady,
  handleTerminalExpandedChanged,
  handleStarted,
  loading,
  launchButtonsDisabled,
  launchTargets,
  loadError,
  open,
  openDisabled,
  openTarget,
  openTargetCommand,
  openTitle,
  run,
  showOpenTarget,
  startKey,
  terminalMinimized,
  terminalDisplayed,
  terminalWindowStorageKey,
  terminalVisible,
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

function handleFixRequested(payload) {
  if (!workflowAiFixAvailable.value) {
    return null;
  }
  return props.fixCommandFailure?.(payload);
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

.ai-studio-launch-controls__menu {
  max-width: min(20rem, 92vw);
  min-width: min(14rem, 92vw);
}

.ai-studio-launch-controls__terminal {
  height: 100%;
}
</style>
