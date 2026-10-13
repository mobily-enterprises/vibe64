<template>
  <details v-if="message.messageId?.startsWith('assistant-routing-outcome:')" :key="message.messageId">
    <summary class="text-body-small py-2">Workflow details</summary>
    <AssistantConversationStatus :message="message" @check-delivery="$emit('check-delivery', $event)" @link-click="$emit('link-click', $event)">
      <template v-if="$slots.default" #default><slot /></template>
    </AssistantConversationStatus>
  </details>
  <AssistantConversationStatus v-else :message="message" @check-delivery="$emit('check-delivery', $event)" @link-click="$emit('link-click', $event)">
    <template v-if="$slots.default" #default><slot /></template>
  </AssistantConversationStatus>
</template>

<script setup>
import { AssistantConversationStatus } from "@jskit-ai/assistant-core/client/conversation";

defineProps({ message: { type: Object, required: true } });
defineEmits(["check-delivery", "link-click"]);
</script>

<style scoped>
summary {
  min-height: 48px;
  align-content: center;
  cursor: pointer;
}
</style>
