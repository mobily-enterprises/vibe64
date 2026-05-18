<template>
  <div v-if="visible" class="ai-studio-launch-controls">
    <v-btn
      v-for="launchTarget in launchTargets"
      :key="launchTarget.id"
      color="primary"
      :disabled="launchButtonsDisabled || launchTarget.available === false"
      :prepend-icon="mdiPlayCircleOutline"
      size="small"
      :title="launchTarget.disabledReason || launchTarget.label"
      variant="tonal"
      @click="run(launchTarget)"
    >
      {{ launchTarget.label }}
    </v-btn>

    <v-btn
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

    <v-chip
      v-if="loadError"
      color="warning"
      size="small"
      variant="tonal"
      :title="loadError"
    >
      Launch unavailable
    </v-chip>

    <v-dialog
      v-model="terminalVisible"
      max-width="min(92vw, 72rem)"
      persistent
    >
      <AiStudioCommandTerminal
        class="ai-studio-launch-controls__terminal"
        terminal-kind="launch"
        title="Launch terminal"
        :launch-target="activeLaunchTarget"
        :session="session"
        :start-request-key="startKey"
        @closed="closeTerminal"
        @running-changed="handleRunningChanged"
        @started="handleStarted"
      >
        <template #header-actions>
          <v-btn
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
    </v-dialog>
  </div>
</template>

<script setup>
import {
  mdiOpenInNew,
  mdiPlayCircleOutline
} from "@mdi/js";
import AiStudioCommandTerminal from "@/components/studio/AiStudioCommandTerminal.vue";
import {
  useAiStudioLaunchControls
} from "@/composables/useAiStudioLaunchControls.js";

const props = defineProps({
  busy: {
    type: Boolean,
    default: false
  },
  session: {
    type: Object,
    default: null
  }
});

const {
  activeLaunchTarget,
  closeTerminal,
  handleRunningChanged,
  handleStarted,
  launchButtonsDisabled,
  launchTargets,
  loadError,
  open,
  openDisabled,
  openTarget,
  openTargetCommand,
  openTitle,
  run,
  startKey,
  terminalVisible,
  visible
} = useAiStudioLaunchControls({
  busy: () => props.busy,
  session: () => props.session
});
</script>

<style scoped>
.ai-studio-launch-controls {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  justify-content: flex-end;
  min-width: 0;
}

.ai-studio-launch-controls__terminal {
  height: min(72vh, 44rem);
}
</style>
