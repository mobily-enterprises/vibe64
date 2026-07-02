<template>
  <v-sheet
    rounded="lg"
    color="surface"
    class="ai-command-terminal"
    :class="{
      'ai-command-terminal--collapsed': !expanded,
      'ai-command-terminal--launch': terminalKind === 'launch',
      'ai-command-terminal--service': terminalKind === 'service',
      'ai-command-terminal--shell': terminalKind === 'shell'
    }"
  >
    <div
      class="ai-command-terminal__bar"
      :class="{
        'ai-command-terminal__bar--draggable': draggable
      }"
      @pointerdown="startDrag"
    >
      <div
        class="ai-command-terminal__heading"
      >
        <slot
          name="heading"
          :subtitle="terminalSubtitle"
          :title="terminalTitle"
        >
          <div class="ai-command-terminal__title">{{ terminalTitle }}</div>
          <div class="ai-command-terminal__subtitle">
            {{ terminalSubtitle }}
          </div>
        </slot>
      </div>
      <div class="ai-command-terminal__actions" @pointerdown.stop>
        <slot name="header-actions" />
        <v-btn
          v-if="showExpandedToggle"
          :icon="expanded ? mdiChevronDown : mdiChevronUp"
          size="small"
          :title="expanded ? 'Minimize terminal' : 'Expand terminal'"
          variant="text"
          @click="toggleExpanded"
        />
        <v-btn
          v-if="canRequestAiFix"
          color="primary"
          :prepend-icon="mdiRobotOutline"
          size="small"
          variant="tonal"
          @click="requestAiFix"
        >
          Get AI to fix it
        </v-btn>
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
          v-if="showInterrupt"
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
        <div class="ai-command-terminal__stage">
          <StudioErrorNotice
            v-if="terminalError"
            title="Terminal needs attention"
            :error="terminalError"
            compact
            overlay
          />

          <div ref="terminalHost" class="ai-command-terminal__host" />
        </div>

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
  mdiChevronUp,
  mdiRobotOutline
} from "@mdi/js";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  useVibe64CommandTerminalController
} from "@/composables/useVibe64CommandTerminalController.js";

const props = defineProps({
  action: {
    type: Object,
    default: null
  },
  actionInput: {
    type: Object,
    default: () => ({})
  },
  aiFixAvailable: {
    type: Boolean,
    default: false
  },
  draggable: {
    type: Boolean,
    default: false
  },
  initialExpanded: {
    type: Boolean,
    default: true
  },
  initialTerminalSessionId: {
    type: String,
    default: ""
  },
  closeOnUnmount: {
    type: Boolean,
    default: true
  },
  finishedHoldMs: {
    type: Number,
    default: 500
  },
  launchTarget: {
    type: Object,
    default: null
  },
  reuseRunning: {
    type: Boolean,
    default: true
  },
  session: {
    type: Object,
    default: null
  },
  sessionsApiPath: {
    type: String,
    default: ""
  },
  showInterrupt: {
    type: Boolean,
    default: true
  },
  showExpandedToggle: {
    type: Boolean,
    default: true
  },
  startRequestKey: {
    type: [String, Number],
    default: ""
  },
  terminalApiPath: {
    type: String,
    default: ""
  },
  terminalKind: {
    type: String,
    default: "command"
  },
  title: {
    type: String,
    default: ""
  },
  vibe64ApiPath: {
    type: String,
    default: ""
  }
});

const emit = defineEmits([
  "access-denied",
  "closed",
  "drag-start",
  "expanded-changed",
  "finished",
  "fix-requested",
  "ready",
  "running-changed",
  "started",
  "state-stale"
]);

const {
  canRequestAiFix,
  canRetry,
  closeTerminal,
  expanded,
  focusTerminal,
  requestAiFix,
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
} = useVibe64CommandTerminalController(props, emit);

defineExpose({
  close: closeTerminal,
  focus: focusTerminal,
  start: startTerminal
});

function startDrag(event) {
  if (!props.draggable || event.button !== 0) {
    return;
  }
  emit("drag-start", event);
}
</script>

<style scoped>
.ai-command-terminal {
  color: rgb(var(--v-theme-on-surface));
  min-width: 0;
  padding: 0.75rem;
  text-align: left;
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

.ai-command-terminal__bar--draggable {
  cursor: move;
  touch-action: none;
  user-select: none;
}

.ai-command-terminal__heading {
  flex: 1 1 auto;
  min-width: 0;
}

.ai-command-terminal__title {
  font-size: 0.85rem;
  font-weight: 700;
}

.ai-command-terminal__subtitle,
.ai-command-terminal__footer {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.75rem;
}

.ai-command-terminal__actions {
  align-items: center;
  cursor: default;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  justify-content: flex-end;
  user-select: auto;
}

.ai-command-terminal__body {
  display: grid;
  gap: 0.5rem;
}

.ai-command-terminal__stage {
  position: relative;
}

.ai-command-terminal__host {
  background: #101216;
  border: 2px solid rgba(var(--v-theme-outline), 0.38);
  border-radius: 6px;
  height: clamp(18rem, 38vh, 32rem);
  overflow: hidden;
  padding: 0.35rem;
}

.ai-command-terminal--shell,
.ai-command-terminal--service {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 0.35rem;
}

.ai-command-terminal--shell .ai-command-terminal__bar,
.ai-command-terminal--service .ai-command-terminal__bar {
  margin-bottom: 0.3rem;
}

.ai-command-terminal--shell .ai-command-terminal__body,
.ai-command-terminal--service .ai-command-terminal__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.3rem;
  min-height: 0;
  overflow: hidden;
}

.ai-command-terminal--shell .ai-command-terminal__stage,
.ai-command-terminal--service .ai-command-terminal__stage {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

.ai-command-terminal--shell .ai-command-terminal__host,
.ai-command-terminal--service .ai-command-terminal__host {
  border-width: 1px;
  flex: 1 1 auto;
  height: auto;
  min-height: 0;
  padding: 0.18rem;
}

.ai-command-terminal__host :deep(.xterm) {
  text-align: left;
}

.ai-command-terminal__footer span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-command-terminal--collapsed {
  padding: 0.35rem 0.5rem;
}

.ai-command-terminal--collapsed .ai-command-terminal__bar {
  gap: 0.5rem;
  margin-bottom: 0;
}

.ai-command-terminal--collapsed .ai-command-terminal__heading {
  align-items: baseline;
  display: flex;
  gap: 0.45rem;
}

.ai-command-terminal--collapsed .ai-command-terminal__title,
.ai-command-terminal--collapsed .ai-command-terminal__subtitle {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-command-terminal--collapsed .ai-command-terminal__title {
  flex: 0 0 auto;
}

.ai-command-terminal--collapsed .ai-command-terminal__subtitle {
  flex: 1 1 auto;
}

.ai-command-terminal--collapsed .ai-command-terminal__actions {
  flex: 0 0 auto;
  flex-wrap: nowrap;
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

  .ai-command-terminal--collapsed .ai-command-terminal__bar {
    align-items: center;
    flex-direction: row;
  }

  .ai-command-terminal--collapsed .ai-command-terminal__footer {
    flex-direction: row;
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
