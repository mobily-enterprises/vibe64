<script setup>
// The "Record what runs" dialog. v-model opens it; started { recording } is
// emitted after a successful start, and select-preview when the person chooses
// "Go to Preview" afterwards.
// Placeholder: renders an empty container until the recorder lands.
defineProps({
  modelValue: { type: Boolean, default: false },
  sessionId: { type: String, required: true }
});
defineEmits(["update:modelValue", "started", "select-preview"]);
</script>

<template>
  <div v-if="modelValue" class="vibe64-usage-record-dialog" />
</template>
