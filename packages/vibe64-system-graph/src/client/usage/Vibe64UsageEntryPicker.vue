<template>
  <v-btn
    class="usage-picker"
    variant="outlined"
    block
    :append-icon="mdiMenuDown"
    :aria-label="label"
    @click="emit('update:modelValue', true)"
  ><span class="usage-picker__label">{{ label }}</span></v-btn>
  <v-dialog :model-value="modelValue" fullscreen transition="dialog-bottom-transition" @update:model-value="emit('update:modelValue', $event)">
    <v-card class="usage-picker__dialog">
      <v-toolbar density="comfortable" color="surface">
        <v-btn :icon="mdiClose" aria-label="Close" @click="emit('update:modelValue', false)" />
        <v-toolbar-title class="text-title-large">{{ title }}</v-toolbar-title>
      </v-toolbar>
      <div class="usage-picker__body"><slot /></div>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { mdiClose, mdiMenuDown } from "@mdi/js";

// Phone layout: the rail's content behind a full-width button.
defineProps({
  modelValue: { type: Boolean, default: false },
  label: { type: String, required: true },
  title: { type: String, required: true }
});
const emit = defineEmits(["update:modelValue"]);
</script>

<style scoped>
.usage-picker { justify-content: space-between; text-transform: none; letter-spacing: normal; min-height: 44px; border-color: var(--v64-outline); }
@media (pointer: coarse) {
  .usage-picker { min-height: 48px; }
}
.usage-picker :deep(.v-btn__content) { flex: 1; min-width: 0; justify-content: flex-start; }
.usage-picker__label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.usage-picker__dialog { display: flex; flex-direction: column; height: 100%; }
.usage-picker__body { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
</style>
