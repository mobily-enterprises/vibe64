<template>
  <div v-if="message.delivery" role="status">
    <p>{{ message.text }}</p>
    <p v-if="message.delivery.error" class="text-body-small">{{ message.delivery.error }}</p>
    <v-btn
      variant="tonal"
      min-height="48"
      :disabled="message.delivery.checking"
      @click="$emit('check-delivery', message.delivery.messageId)"
    >
      {{ message.delivery.checking ? 'Checking delivery…' : 'Check delivery' }}
    </v-btn>
  </div>
  <slot v-else>
    <LongTextPreviewBlocks compact :blocks="message.blocks" @link-click="$emit('link-click', $event)" />
  </slot>
</template>

<script setup>
import { LongTextPreviewBlocks } from "@jskit-ai/assistant-core/client/conversation";

defineProps({ message: { type: Object, required: true } });
defineEmits(["check-delivery", "link-click"]);
</script>
