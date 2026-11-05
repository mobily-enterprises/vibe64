<template>
  <AssistantConversationElement :adapter="displayAdapter">
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
import Vibe64ConversationAttachments from "./Vibe64ConversationAttachments.vue";
import Vibe64ConversationStatus from "./Vibe64ConversationStatus.vue";
import { temporaryAiTranscript } from "@/lib/vibe64TemporaryAiTasks.js";
const props = defineProps({
  adapter: { type: Object, required: true },
  routingRequest: { type: Object, default: null },
  working: { type: Boolean, default: undefined },
  sessionId: { type: String, default: "" },
  scrollKey: { type: String, default: "" },
  assistantLabel: { type: String, default: "Temporary AI" },
  emptyMessage: { type: String, default: "Ask a focused question without adding it to the main conversation." },
  userLabel: { type: String, default: "You" }
});
const emit = defineEmits(["resend", "cancel", "edit"]);
const displayAdapter = computed(() => temporaryAiTranscript(props.adapter, {
  routingRequest: props.routingRequest,
  working: props.working,
  scrollKey: props.scrollKey,
  assistantLabel: props.assistantLabel,
  emptyMessage: props.emptyMessage,
  actions: { resend: id => emit("resend", id), cancel: id => emit("cancel", id), edit: id => emit("edit", id) }
}));
</script>
