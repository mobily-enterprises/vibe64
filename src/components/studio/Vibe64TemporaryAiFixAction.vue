<template>
  <v-btn
    aria-label="Fix it with AI"
    :aria-busy="pending ? 'true' : undefined"
    class="vibe64-temporary-ai-fix-action"
    :disabled="disabled || pending"
    :prepend-icon="mdiRobotOutline"
    size="small"
    :title="title"
    type="button"
    variant="tonal"
    @click="emit('click')"
  >
    {{ pending ? "Opening…" : "Fix it with AI" }}
  </v-btn>
</template>

<script setup>
import { mdiRobotOutline } from "@mdi/js";

defineProps({
  disabled: {
    default: false,
    type: Boolean
  },
  pending: {
    default: false,
    type: Boolean
  },
  title: {
    default: "Open Temporary AI to diagnose and repair this problem",
    type: String
  }
});

const emit = defineEmits(["click"]);
</script>

<style scoped>
.vibe64-temporary-ai-fix-action {
  block-size: auto;
  max-inline-size: 100%;
  min-block-size: 1.75rem;
  min-inline-size: min(8.5rem, 100%);
  white-space: normal;
}

@media (pointer: coarse) {
  .vibe64-temporary-ai-fix-action {
    min-block-size: 3rem;
  }
}
</style>
