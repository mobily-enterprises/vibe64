<template>
  <v-sheet
    rounded="lg"
    color="surface"
    class="vibe64-terminal-surface"
    :class="{
      'vibe64-terminal-surface--collapsed': !expanded,
      'vibe64-terminal-surface--draggable': draggable,
      'vibe64-terminal-surface--fill': fill,
      'vibe64-terminal-surface--focused': focused
    }"
  >
    <header
      class="vibe64-terminal-surface__header"
      @pointerdown="draggable && $emit('drag-start', $event)"
    >
      <div class="vibe64-terminal-surface__heading">
        <slot name="heading" :title="title" :subtitle="subtitle">
          <strong class="vibe64-terminal-surface__title">{{ title }}</strong>
          <span v-if="subtitle" class="vibe64-terminal-surface__subtitle">{{ subtitle }}</span>
        </slot>
      </div>

      <div class="vibe64-terminal-surface__actions" @pointerdown.stop>
        <v-btn
          v-if="error"
          :aria-controls="errorDetailsId"
          :aria-expanded="String(errorDetailsOpen)"
          :aria-label="errorDetailsToggleLabel"
          class="vibe64-terminal-surface__error-toggle"
          color="error"
          :icon="mdiAlertCircleOutline"
          size="small"
          :title="errorDetailsToggleLabel"
          variant="tonal"
          @click="toggleErrorDetails"
        />
        <slot name="actions-before" />
        <v-btn
          v-if="retryable"
          color="primary"
          :loading="starting"
          size="small"
          variant="flat"
          @click="retry"
        >
          Retry
        </v-btn>
        <v-btn
          v-if="showCopy"
          :disabled="!selectedText && !output"
          size="small"
          variant="text"
          @click="$emit('copy')"
        >
          Copy
        </v-btn>
        <v-btn
          v-if="showInterrupt"
          :disabled="!sessionId || exited"
          size="small"
          variant="text"
          @click="$emit('interrupt')"
        >
          Ctrl-C
        </v-btn>
        <v-btn
          v-if="collapsible"
          size="small"
          variant="text"
          @click="$emit('toggle-expanded')"
        >
          {{ expanded ? "Collapse" : "Expand" }}
        </v-btn>
        <v-btn
          v-if="showClose"
          size="small"
          variant="text"
          @click="$emit('close')"
        >
          {{ closeLabel }}
        </v-btn>
        <slot name="actions-after" />
      </div>
    </header>

    <span v-if="error" class="d-sr-only" role="alert">
      {{ errorTitle }}. {{ error }}
    </span>

    <div
      v-if="error"
      v-show="errorDetailsOpen"
      :id="errorDetailsId"
      class="vibe64-terminal-surface__error-details"
    >
      <StudioErrorNotice
        :title="errorTitle"
        :error="error"
        compact
      >
        <template v-if="$slots['error-actions']" #actions>
          <slot name="error-actions" />
        </template>
      </StudioErrorNotice>
    </div>

    <div v-show="expanded" class="vibe64-terminal-surface__body">
      <div v-if="$slots['before-terminal']" class="vibe64-terminal-surface__before-terminal">
        <slot name="before-terminal" />
      </div>
      <div class="vibe64-terminal-surface__stage">
        <div class="vibe64-terminal-surface__overlay">
          <slot name="overlay" />
        </div>

        <div
          class="vibe64-terminal-surface__host"
          :style="hostStyle"
          @click="$emit('focus')"
          @pointerdown.capture="$emit('focus')"
        >
          <div :ref="terminalHostRef" class="vibe64-terminal-surface__mount" />
        </div>
      </div>

      <footer class="vibe64-terminal-surface__footer">
        <slot name="footer" :command-preview="commandPreview" :status="status">
          <span class="vibe64-terminal-surface__command">
            {{ commandPreview || "No command running." }}
          </span>
          <v-chip v-if="status" size="x-small" variant="tonal">
            {{ status }}
          </v-chip>
        </slot>
      </footer>
    </div>
  </v-sheet>
</template>

<script setup>
import { computed, ref, useId, watch } from "vue";
import { mdiAlertCircleOutline } from "@mdi/js";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";

const props = defineProps({
  closeLabel: {
    default: "Close",
    type: String
  },
  collapsible: {
    default: true,
    type: Boolean
  },
  commandPreview: {
    default: "",
    type: String
  },
  draggable: {
    default: false,
    type: Boolean
  },
  error: {
    default: "",
    type: String
  },
  errorTitle: {
    default: "Terminal needs attention",
    type: String
  },
  exited: {
    default: false,
    type: Boolean
  },
  expanded: {
    default: true,
    type: Boolean
  },
  fill: {
    default: false,
    type: Boolean
  },
  focused: {
    default: false,
    type: Boolean
  },
  height: {
    default: "clamp(18rem, 48vh, 34rem)",
    type: String
  },
  output: {
    default: "",
    type: String
  },
  retryable: {
    default: false,
    type: Boolean
  },
  selectedText: {
    default: "",
    type: String
  },
  sessionId: {
    default: "",
    type: String
  },
  showClose: {
    default: true,
    type: Boolean
  },
  showCopy: {
    default: false,
    type: Boolean
  },
  showInterrupt: {
    default: true,
    type: Boolean
  },
  starting: {
    default: false,
    type: Boolean
  },
  status: {
    default: "",
    type: String
  },
  subtitle: {
    default: "",
    type: String
  },
  terminalHostRef: {
    required: true,
    type: Function
  },
  title: {
    default: "Terminal",
    type: String
  }
});

const emit = defineEmits([
  "close",
  "copy",
  "drag-start",
  "focus",
  "interrupt",
  "retry",
  "toggle-expanded"
]);

const errorDetailsOpen = ref(false);
const errorDetailsId = `vibe64-terminal-error-details-${useId()}`;
const errorDetailsToggleLabel = computed(() => (
  errorDetailsOpen.value ? "Hide terminal error details" : "Show terminal error details"
));
const hostStyle = computed(() => ({
  "--vibe64-terminal-host-height": props.height
}));

function toggleErrorDetails() {
  errorDetailsOpen.value = !errorDetailsOpen.value;
}

function retry() {
  errorDetailsOpen.value = false;
  emit("retry");
}

watch(() => props.error, () => {
  errorDetailsOpen.value = false;
});

watch(() => props.starting, (starting) => {
  if (starting) {
    errorDetailsOpen.value = false;
  }
});
</script>

<style scoped>
.vibe64-terminal-surface {
  border: 1px solid rgba(var(--v-theme-outline), 0.32);
  color: rgb(var(--v-theme-on-surface));
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  padding: 0.75rem;
  text-align: left;
}

.vibe64-terminal-surface--fill {
  height: 100%;
}

.vibe64-terminal-surface--focused {
  border-color: rgba(var(--v-theme-primary), 0.66);
}

.vibe64-terminal-surface__header,
.vibe64-terminal-surface__footer {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.vibe64-terminal-surface__header {
  margin-bottom: 0.55rem;
}

.vibe64-terminal-surface--collapsed .vibe64-terminal-surface__header {
  margin-bottom: 0;
}

.vibe64-terminal-surface--draggable .vibe64-terminal-surface__header {
  cursor: move;
  touch-action: none;
  user-select: none;
}

.vibe64-terminal-surface__heading {
  display: grid;
  flex: 1 1 auto;
  min-width: 0;
}

.vibe64-terminal-surface__title {
  font-size: 0.88rem;
}

.vibe64-terminal-surface__subtitle,
.vibe64-terminal-surface__footer {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.75rem;
}

.vibe64-terminal-surface__actions {
  align-items: center;
  cursor: default;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  justify-content: flex-end;
  user-select: auto;
}

.vibe64-terminal-surface__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
}

.vibe64-terminal-surface__error-details {
  margin-bottom: 0.55rem;
  min-width: 0;
}

.vibe64-terminal-surface__stage {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
}

.vibe64-terminal-surface__overlay:empty {
  display: none;
}

.vibe64-terminal-surface__host {
  background: #101216;
  border-radius: 0.45rem;
  height: var(--vibe64-terminal-host-height);
  min-height: 0;
  overflow: hidden;
}

.vibe64-terminal-surface--fill .vibe64-terminal-surface__host {
  height: 100%;
}

.vibe64-terminal-surface__mount,
.vibe64-terminal-surface__mount :deep(.xterm) {
  height: 100%;
}

.vibe64-terminal-surface__command {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
