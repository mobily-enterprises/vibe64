<template>
  <div class="studio-autopilot__composer-delivery">
    <v-btn
      v-if="stopVisible" aria-label="Stop" title="Stop assistant"
      :disabled="!stopEnabled" :aria-busy="stopping ? 'true' : undefined"
      icon="$stop" size="small" variant="text" class="studio-autopilot__composer-action"
      @click="$emit('stop')"
    />
    <v-btn
      ref="sendButton" :aria-label="submitAriaLabel" :title="submitTitle"
      :disabled="!canSubmit" :aria-busy="sending && !canSubmit ? 'true' : undefined"
      color="primary" size="small" variant="flat"
      :icon="submitMode === 'send' ? '$send' : '$arrowOutward'"
      class="studio-autopilot__composer-action" @click="$emit('submit')"
    />
  </div>
</template>
<script setup>
import { ref } from "vue";
defineProps({
  stopVisible: Boolean, stopEnabled: Boolean, stopping: Boolean,
  canSubmit: Boolean, sending: Boolean,
  submitMode: { type: String, default: "send" },
  submitAriaLabel: { type: String, default: "Send message" },
  submitTitle: { type: String, default: "Send message" }
});
defineEmits(["submit", "stop"]);
const sendButton = ref(null);
// The send button is a v-btn; its element takes the focus.
defineExpose({ focus: () => sendButton.value?.$el.focus() });
</script>
<style scoped>
.studio-autopilot__composer-delivery {
  align-items: center;
  display: flex;
  gap: 0.25rem;
  min-width: 0;
  margin-inline-start: auto;
  flex-shrink: 0;
}
.studio-autopilot__composer-action { flex-shrink: 0; }
@container studio-chat-pane (max-width: 32rem) {
  .studio-autopilot__composer-delivery { gap: 0; }
  .studio-autopilot__composer-action { width: clamp(2rem, 10cqi, 2.5rem); }
}
</style>
