<template>
  <AssistantConversationElement :adapter="adapter">
    <template #attachments="{ items }">
      <Vibe64ConversationAttachments :items="items" :session-id="sessionId" />
    </template>
    <template #system-message="{ message }">
      <Vibe64ConversationStatus :message="message" @check-delivery="emit('resend', $event)">
        <template v-if="$slots['message-text']" #default>
          <slot name="message-text" :message="message" />
        </template>
      </Vibe64ConversationStatus>
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
import { chatTurnsWithRouting } from "@/lib/vibe64ChatDelivery.js";
import Vibe64ConversationStatus from "./Vibe64ConversationStatus.vue";
import { assistantModeLabel } from "@local/vibe64-runtime/shared/assistantRouting";
import { vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { thinkingMessagePresentation, usesCommentaryForThinking } from "@/lib/vibe64ThinkingPresentation.js";
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
    const displayed = thinkingMessagePresentation(message, selection);
    if (!displayed) return null;
    return selection ? { ...displayed, assistantLabel: `${message.assistantRouting?.resolvedMode ? `${assistantModeLabel(message.assistantRouting.resolvedMode)} · ` : ""}${vibe64AssistantSelectionLabel(selection)}` } : displayed;
  }).filter(Boolean));
  return chatTurnsWithRouting(
    props.delivery ? props.delivery.turns(result) : result,
    props.routingRequest,
    props.delivery?.state.sending === true
  );
});
const adapter = computed(() => ({
  conversation: {
    working: props.working,
    turns: turns.value,
    assistantLabel: props.assistantLabel,
    scrollKey: props.scrollKey,
    variant: "task",
    visible: true,
    userMessageFormat: "plain",
    progressPreviewLimit: usesCommentaryForThinking(props.messages.at(-1)?.assistantSelection) ? 1 : 0,
    systemLabel: "System",
    welcomeMessage: turns.value.length ? "" : props.emptyMessage
  },
  actions: {
    resend: (id) => emit("resend", id),
    cancel: (id) => emit("cancel", id),
    edit: (id) => emit("edit", id)
  }
}));
</script>
