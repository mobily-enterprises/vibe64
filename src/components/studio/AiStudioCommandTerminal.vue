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
          title="Terminal needs attention"
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
import {
  mdiChevronDown,
  mdiChevronUp
} from "@mdi/js";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  useAiStudioCommandTerminalController
} from "@/composables/useAiStudioCommandTerminalController.js";

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

const {
  canRetry,
  closeTerminal,
  expanded,
  restartTerminal,
  sendCtrlC,
  startTerminal,
  terminalCommandPreview,
  terminalError,
  terminalExited,
  terminalHost,
  terminalSessionId,
  terminalStarting,
  terminalStatus,
  terminalSubtitle,
  terminalTitle,
  toggleExpanded
} = useAiStudioCommandTerminalController(props, emit);

defineExpose({
  start: startTerminal
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
