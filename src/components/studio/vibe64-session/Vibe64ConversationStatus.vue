<template>
  <AssistantConversationStatus :message="message" @check-delivery="$emit('check-delivery', $event)" @link-click="$emit('link-click', $event)">
    <template v-if="$slots.default" #default><slot /></template>
  </AssistantConversationStatus>
</template>

<script setup>
import { AssistantConversationStatus } from "@jskit-ai/assistant-core/client/conversation";

defineProps({ message: { type: Object, required: true } });
defineEmits(["check-delivery", "link-click"]);
</script>
