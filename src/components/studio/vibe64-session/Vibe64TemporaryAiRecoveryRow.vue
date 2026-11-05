<template>
  <div class="vibe64-temporary-ai__recovery-row">
    <v-alert v-if="props.restoreError" type="error" variant="tonal" density="compact">
      {{ props.restoreError }}
      <v-btn color="error" variant="text" height="48" @click="emit('retry-restore')">Try again</v-btn>
    </v-alert>
  </div>
</template>

<script setup>
// The temporary AI workspace's notice above the conversation: a saved-chat
// list that could not be restored, with Try again.
const emit = defineEmits(["retry-restore"]);
const props = defineProps({
  restoreError: { type: String, default: "" }
});
</script>

<style scoped>
.vibe64-temporary-ai__recovery-row:not(:empty) {
  max-height: min(20dvh, 8rem);
  overflow-y: auto;
  padding: 0.35rem 0.55rem 0;
}
</style>
