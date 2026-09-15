<template>
  <AssistantConversationElement :adapter="adapter">
    <template #attachments="{ items }">
      <Vibe64ConversationAttachments :items="items" :session-id="sessionId" />
    </template>
    <template v-if="$slots['message-text']" #system-message="{ message }">
      <slot name="message-text" :message="message" />
    </template>
    <template v-if="$slots.hints" #hints>
      <slot name="hints" />
    </template>
    <template v-if="$slots.composer" #composer>
      <slot name="composer" />
    </template>
  </AssistantConversationElement>
</template>
<script setup>
import { computed } from "vue";
import { AssistantConversationElement } from "@jskit-ai/assistant-core/client/conversation";
import { conversationTurnsFromMessages } from "@jskit-ai/assistant-core/shared/conversation";
import Vibe64ConversationAttachments from "./Vibe64ConversationAttachments.vue";
const props = defineProps({
  sessionId: { type: String, default: "" },
  scrollKey: { type: String, default: "" },
  assistantLabel: { type: String, default: "Temporary AI" },
  emptyMessage: { type: String, default: "Ask a focused question without adding it to the main conversation." },
  messages: { type: Array, default: () => [] },
  userLabel: { type: String, default: "You" }
});
const adapter = computed(() => ({
  conversation: {
    turns: conversationTurnsFromMessages(props.messages),
    assistantLabel: props.assistantLabel,
    scrollKey: props.scrollKey,
    variant: "task",
    visible: true,
    userMessageFormat: "plain",
    progressPreviewLimit: 0,
    systemLabel: "System",
    welcomeMessage: props.messages.length ? "" : props.emptyMessage
  },
  actions: {}
}));
</script>
