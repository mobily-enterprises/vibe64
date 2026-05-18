<template>
  <v-dialog
    :model-value="modelValue"
    max-width="760"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-sheet rounded="lg" class="doctor-repair-dialog">
      <h2 class="text-subtitle-1 mb-2">Confirm repair</h2>
      <p class="text-body-2 text-medium-emphasis mb-3">
        Studio will run this command locally after confirmation.
      </p>
      <div v-if="fields.length" class="doctor-repair-dialog__field-grid mb-3">
        <v-text-field
          v-for="field in fields"
          :key="field.id"
          :model-value="fieldValue(field.id)"
          :autocomplete="field.autocomplete || undefined"
          density="compact"
          hide-details="auto"
          :label="field.label"
          :placeholder="field.placeholder || ''"
          :type="field.type || 'text'"
          variant="outlined"
          @update:model-value="setFieldValue(field.id, $event)"
        />
      </div>
      <pre class="doctor-repair-dialog__command mb-3">{{ commandPreview }}</pre>
      <div class="d-flex justify-end ga-2">
        <v-btn variant="text" :disabled="running" @click="emit('update:modelValue', false)">Close</v-btn>
        <v-btn
          color="primary"
          :disabled="!canRun"
          :loading="running"
          @click="emit('run')"
        >
          Run repair
        </v-btn>
      </div>
    </v-sheet>
  </v-dialog>
</template>

<script setup>
const props = defineProps({
  canRun: {
    type: Boolean,
    default: false
  },
  commandPreview: {
    type: String,
    default: ""
  },
  fields: {
    type: Array,
    default: () => []
  },
  modelValue: {
    type: Boolean,
    default: false
  },
  running: {
    type: Boolean,
    default: false
  },
  values: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(["run", "update:modelValue", "update:values"]);

function fieldValue(fieldId = "") {
  return props.values?.[fieldId] || "";
}

function setFieldValue(fieldId = "", value = "") {
  emit("update:values", {
    ...props.values,
    [fieldId]: value
  });
}
</script>

<style scoped>
.doctor-repair-dialog {
  padding: 0.5rem 0.625rem;
}

.doctor-repair-dialog :deep(.v-btn) {
  min-height: 48px;
}

.doctor-repair-dialog__field-grid {
  display: grid;
  gap: 0.375rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
}

.doctor-repair-dialog__field-grid :deep(.v-field),
.doctor-repair-dialog__field-grid :deep(.v-field__input) {
  min-height: 48px;
}

.doctor-repair-dialog__command {
  background: rgb(var(--v-theme-surface-variant));
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.8125rem;
  line-height: 1.25;
  margin: 0;
  margin-top: 0.45rem;
  max-height: 3.75rem;
  max-width: 100%;
  overflow: auto;
  padding: 0.35rem 0.45rem;
  white-space: pre-wrap;
  width: 100%;
}
</style>
