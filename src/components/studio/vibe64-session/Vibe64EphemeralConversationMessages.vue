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
import { assistantRoutingStatusLabel } from "@local/vibe64-runtime/shared/assistantRouting";
const props = defineProps({
  delivery: { type: Object, default: null },
  routingRequest: { type: Object, default: null },
  working: { type: Boolean, default: undefined },
  sessionId: { type: String, default: "" },
  scrollKey: { type: String, default: "" },
  assistantLabel: { type: String, default: "Temporary AI" },
  emptyMessage: { type: String, default: "Ask a focused question without adding it to the main conversation." },
  messages: { type: Array, default: () => [] },
  userLabel: { type: String, default: "You" }
});
const emit = defineEmits(["resend", "cancel", "edit"]);
const turns = computed(() => {
  const result = conversationTurnsFromMessages(props.messages.map((message) => {
    const selection = message.assistantSelection;
    return selection ? { ...message, assistantLabel: `${selection.engineId} · ${selection.modelId}${message.assistantRouting?.resolvedMode ? ` · ${message.assistantRouting.resolvedMode}` : ""}` } : message;
  }));
  const request = props.routingRequest;
  if (request && ["routing", "sending", "uncertain", "failed"].includes(request.status) && !result.some((turn) => turn.user?.messageId === request.messageId)) {
    result.push({ turnId: `routing:${request.messageId}`, user: { messageId: request.messageId, role: "user", text: request.input.displayMessage || request.input.message }, messages: [],
      system: { role: "system", text: assistantRoutingStatusLabel(request) },
      optimistic: { id: request.messageId, status: ["failed", "uncertain"].includes(request.status) ? "failed" : "pending", error: request.error || "" } });
  }
  return result;
});
const adapter = computed(() => ({
  delivery: props.delivery,
  conversation: {
    working: props.working,
    turns: turns.value,
    assistantLabel: props.assistantLabel,
    scrollKey: props.scrollKey,
    variant: "task",
    visible: true,
    userMessageFormat: "plain",
    progressPreviewLimit: 0,
    systemLabel: "System",
    welcomeMessage: props.messages.length ? "" : props.emptyMessage
  },
  actions: {
    resend: (id) => emit("resend", id),
    cancel: (id) => emit("cancel", id),
    edit: (id) => emit("edit", id)
  }
}));
</script>
