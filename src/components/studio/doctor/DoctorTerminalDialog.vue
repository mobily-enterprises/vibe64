<template>
  <v-dialog
    :model-value="modelValue"
    max-width="980"
    persistent
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-sheet rounded="lg" class="doctor-terminal-dialog">
      <div class="d-flex align-center justify-space-between ga-3 mb-3">
        <div>
          <h2 class="text-subtitle-1 mb-1">{{ title }}</h2>
          <p class="text-caption text-medium-emphasis mb-0 doctor-terminal-dialog__command">
            {{ commandPreview }}
          </p>
        </div>
        <div
          aria-live="polite"
          class="doctor-terminal-dialog__status"
          :class="{ 'doctor-terminal-dialog__status--running': running }"
          role="status"
        >
          {{ statusLabel }}
        </div>
      </div>
      <v-expansion-panels
        v-if="commandDetails"
        class="doctor-terminal-dialog__details mb-3"
        variant="accordion"
      >
        <v-expansion-panel>
          <v-expansion-panel-title>Command details</v-expansion-panel-title>
          <v-expansion-panel-text>
            <pre class="doctor-terminal-dialog__details-command">{{ commandDetails }}</pre>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
      <v-alert v-if="error" type="error" variant="tonal" class="mb-3">
        {{ error }}
      </v-alert>
      <div class="doctor-terminal-dialog__copy-bar mb-2">
        <v-btn
          variant="tonal"
          :disabled="!selectedText"
          @click="emit('copy-selection')"
        >
          Copy selection
        </v-btn>
        <v-btn
          v-if="terminalUrl"
          variant="tonal"
          @click="emit('copy-url')"
        >
          Copy URL
        </v-btn>
        <p v-if="copyStatus" class="text-caption text-medium-emphasis mb-0">
          {{ copyStatus }}
        </p>
      </div>
      <div :ref="setHost" class="doctor-terminal-dialog__host" />
      <div class="d-flex justify-end ga-2 mt-3">
        <v-btn variant="tonal" :disabled="!sessionId" @click="emit('send-ctrl-c')">Send Ctrl-C</v-btn>
        <v-btn color="primary" variant="flat" @click="emit('close')">Close</v-btn>
      </div>
    </v-sheet>
  </v-dialog>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  commandDetails: {
    type: String,
    default: ""
  },
  commandPreview: {
    type: String,
    default: ""
  },
  copyStatus: {
    type: String,
    default: ""
  },
  error: {
    type: String,
    default: ""
  },
  modelValue: {
    type: Boolean,
    default: false
  },
  selectedText: {
    type: String,
    default: ""
  },
  sessionId: {
    type: String,
    default: ""
  },
  setHost: {
    type: Function,
    required: true
  },
  status: {
    type: String,
    default: ""
  },
  terminalUrl: {
    type: String,
    default: ""
  },
  title: {
    type: String,
    default: "Terminal"
  }
});

const running = computed(() => {
  return ["starting", "running", "closing"].includes(props.status || "starting");
});

const statusLabel = computed(() => {
  const value = String(props.status || "starting").trim();
  if (!value) {
    return "Starting";
  }
  return `${value[0].toUpperCase()}${value.slice(1)}`;
});

const emit = defineEmits([
  "close",
  "copy-selection",
  "copy-url",
  "send-ctrl-c",
  "update:modelValue"
]);
</script>

<style scoped>
.doctor-terminal-dialog {
  padding: 0.5rem 0.625rem;
}

.doctor-terminal-dialog :deep(.v-btn) {
  min-height: 48px;
}

.doctor-terminal-dialog__command {
  overflow-wrap: anywhere;
}

.doctor-terminal-dialog__details-command {
  margin: 0;
  max-height: 12rem;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.doctor-terminal-dialog__copy-bar {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.doctor-terminal-dialog__host {
  background: #111318;
  border-radius: 8px;
  height: min(44vh, 20rem);
  min-height: 13rem;
  overflow: hidden;
  padding: 0.5rem;
}

.doctor-terminal-dialog__host :deep(.xterm) {
  height: 100%;
}

.doctor-terminal-dialog__status {
  align-items: center;
  background: rgb(var(--v-theme-surface-variant));
  border-radius: 999px;
  color: rgb(var(--v-theme-on-surface-variant));
  display: inline-flex;
  flex: 0 0 auto;
  font-size: clamp(1.4rem, 3.5vw, 2.8rem);
  font-weight: 800;
  justify-content: center;
  letter-spacing: 0;
  line-height: 1;
  min-width: min(11.2rem, 30vw);
  padding: 0.5rem 0.875rem;
  position: relative;
  text-transform: uppercase;
}

.doctor-terminal-dialog__status--running {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.doctor-terminal-dialog__status--running::after {
  animation: doctor-terminal-dialog-status-pulse 1.4s ease-in-out infinite;
  background: currentColor;
  border-radius: 999px;
  content: "";
  height: 0.44rem;
  opacity: 0.52;
  position: absolute;
  right: 0.72rem;
  top: 50%;
  transform: translateY(-50%) scale(0.82) translateZ(0);
  transform-origin: center;
  width: 0.44rem;
  will-change: opacity, transform;
}

@keyframes doctor-terminal-dialog-status-pulse {
  0%,
  100% {
    opacity: 0.4;
    transform: translateY(-50%) scale(0.82) translateZ(0);
  }

  50% {
    opacity: 1;
    transform: translateY(-50%) scale(1.08) translateZ(0);
  }
}
</style>
