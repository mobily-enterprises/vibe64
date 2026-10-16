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
import { chatTurnsWithRouting } from "@/lib/vibe64ChatDelivery.js";
import Vibe64ConversationStatus from "./Vibe64ConversationStatus.vue";
import { conversationAttribution } from "@/lib/vibe64ConversationAttribution.js";
import { thinkingMessagePresentation, usesCommentaryForThinking } from "@/lib/vibe64ThinkingPresentation.js";
const props = defineProps({
  adapter: { type: Object, required: true },
  recoveryMessage: { type: Object, default: null },
  routingRequest: { type: Object, default: null },
  working: { type: Boolean, default: undefined },
  sessionId: { type: String, default: "" },
  scrollKey: { type: String, default: "" },
  assistantLabel: { type: String, default: "Temporary AI" },
  emptyMessage: { type: String, default: "Ask a focused question without adding it to the main conversation." },
  userLabel: { type: String, default: "You" }
});
const emit = defineEmits(["resend", "cancel", "edit"]);
const displayAdapter = computed(() => {
  const supplied = props.adapter;
  let turns = (supplied.conversation.turns || []).map(turn => {
    const selection = turn.metadata?.assistantSelection;
    const present = message => {
      if (!message) return message;
      const recordedSelection = message.assistantSelection || message.metadata?.assistantSelection || selection;
      const displayed = thinkingMessagePresentation(message, recordedSelection);
      return displayed && { ...displayed,
        ...conversationAttribution(recordedSelection, message.assistantRouting || message.metadata?.assistantRouting || turn.metadata?.assistantRouting) };
    };
    return { ...turn,
      ...conversationAttribution(selection, turn.metadata?.assistantRouting),
      assistant: present(turn.assistant),
      thinking: turn.thinking?.map(present).filter(Boolean),
      commentary: turn.commentary?.map(present).filter(Boolean),
      messages: turn.messages?.map(present).filter(Boolean)
    };
  });
  const notice = props.recoveryMessage;
  if (notice && !turns.some(turn => (turn.messages || [turn.system]).some(message => message?.messageId === notice.id))) {
    turns = [...turns, { turnId: notice.id, system: { ...notice, messageId: notice.id }, messages: [{ ...notice, messageId: notice.id }] }];
  }
  turns = chatTurnsWithRouting(supplied.delivery ? supplied.delivery.turns(turns) : turns,
    props.routingRequest, supplied.delivery?.state.sending === true);
  return { ...supplied,
    // Apply the existing receipt projection once, before product Router status.
    delivery: null,
    conversation: { ...supplied.conversation, cancellableDelivery: true,
      working: props.working ?? supplied.conversation.working, turns,
      assistantLabel: props.assistantLabel, scrollKey: props.scrollKey, variant: "task", visible: true,
      userMessageFormat: "plain", progressPreviewLimit: usesCommentaryForThinking(turns.at(-1)?.metadata?.assistantSelection) ? 1 : 0,
      systemLabel: "System", welcomeMessage: turns.length ? "" : props.emptyMessage
    },
    actions: { ...supplied.actions,
      resend: id => emit("resend", id), checkDelivery: id => emit("resend", id),
      cancel: id => emit("cancel", id), edit: id => emit("edit", id)
    }
  };
});
</script>
