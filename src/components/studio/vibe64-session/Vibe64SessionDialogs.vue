<template>
  <Vibe64SessionInputDialog
    :input="dialogs.input"
    @update-values="emit('update-input-values', $event)"
  />

  <Vibe64SessionDiffDialog :diff="dialogs.diff" />

  <Vibe64SessionAbandonDialog
    :abandon="dialogs.abandon"
    :short-session-id="shortSessionId"
  />
</template>

<script setup>
import Vibe64SessionAbandonDialog from "@/components/studio/vibe64-session/Vibe64SessionAbandonDialog.vue";
import Vibe64SessionDiffDialog from "@/components/studio/vibe64-session/Vibe64SessionDiffDialog.vue";
import Vibe64SessionInputDialog from "@/components/studio/vibe64-session/Vibe64SessionInputDialog.vue";

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
