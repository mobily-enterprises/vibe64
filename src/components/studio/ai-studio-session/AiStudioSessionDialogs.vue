<template>
  <AiStudioSessionInputDialog
    :input="dialogs.input"
    @update-values="emit('update-input-values', $event)"
  />

  <AiStudioSessionDiffDialog :diff="dialogs.diff" />

  <AiStudioSessionAbandonDialog
    :abandon="dialogs.abandon"
    :short-session-id="shortSessionId"
  />
</template>

<script setup>
import AiStudioSessionAbandonDialog from "@/components/studio/ai-studio-session/AiStudioSessionAbandonDialog.vue";
import AiStudioSessionDiffDialog from "@/components/studio/ai-studio-session/AiStudioSessionDiffDialog.vue";
import AiStudioSessionInputDialog from "@/components/studio/ai-studio-session/AiStudioSessionInputDialog.vue";

defineProps({
  dialogs: {
    default: () => ({}),
    type: Object
  },
  shortSessionId: {
    default: (sessionId) => String(sessionId || ""),
    type: Function
  }
});

const emit = defineEmits([
  "update-input-values"
]);
</script>
