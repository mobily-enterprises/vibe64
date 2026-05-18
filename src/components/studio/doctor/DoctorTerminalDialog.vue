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
        <v-chip :color="status === 'running' ? 'primary' : 'default'" size="small" variant="tonal">
          {{ status || "starting" }}
        </v-chip>
      </div>
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
defineProps({
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
  title: {
    type: String,
    default: "Terminal"
  }
});

const emit = defineEmits([
  "close",
  "copy-selection",
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
</style>
