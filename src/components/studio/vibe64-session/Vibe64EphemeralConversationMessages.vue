<template>
  <div
    v-if="messages.length === 0"
    class="vibe64-ephemeral-conversation__empty"
  >
    {{ emptyMessage }}
  </div>
  <article
    v-for="message in messages"
    :key="message.id"
    class="vibe64-ephemeral-conversation__message"
    :class="`vibe64-ephemeral-conversation__message--${message.role}`"
  >
    <strong>{{ message.role === "system" ? "System" : message.role === "user" ? userLabel : assistantLabel }}</strong>
    <Vibe64ConversationProgress
      v-if="message.role === 'assistant' && message.progressUpdates?.length"
      :key="`${message.id}:${['starting', 'inProgress'].includes(message.status) ? 'active' : 'completed'}`"
      class="vibe64-ephemeral-conversation__progress"
      :aria-label="`${assistantLabel} progress`"
      :messages="message.progressUpdates"
      :preview-limit="0"
    />
    <LongTextPreviewBlocks
      v-if="message.text && message.role === 'assistant'"
      :blocks="parseLongTextReviewBlocks(message.text)"
    />
    <slot v-else-if="message.text" name="message-text" :message="message">
      <p>{{ message.text }}</p>
    </slot>
    <span v-else-if="message.status === 'interrupted'">Stopped.</span>
    <span v-else-if="message.status === 'failed'">{{ assistantLabel }} stopped with an error.</span>
    <Vibe64ConversationAttachments
      v-if="message.attachments?.length"
      :items="message.attachments"
      :session-id="sessionId"
    />
  </article>
</template>

<script setup>
import LongTextPreviewBlocks from "@/components/studio/LongTextPreviewBlocks.vue";
import Vibe64ConversationProgress from "@/components/studio/vibe64-session/Vibe64ConversationProgress.vue";
import Vibe64ConversationAttachments from "@/components/studio/vibe64-session/Vibe64ConversationAttachments.vue";
import { parseLongTextReviewBlocks } from "@/lib/studioLongTextBlocks.js";

defineProps({
  sessionId: { default: "", type: String },
  assistantLabel: {
    default: "Temporary AI",
    type: String
  },
  emptyMessage: {
    default: "Ask a focused question without adding it to the main conversation.",
    type: String
  },
  messages: {
    default: () => [],
    type: Array
  },
  userLabel: {
    default: "You",
    type: String
  }
});
</script>

<style scoped>
.vibe64-ephemeral-conversation__empty {
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin: auto;
  max-width: 26rem;
  text-align: center;
}

.vibe64-ephemeral-conversation__message {
  border-radius: 10px;
  display: grid;
  gap: 0.2rem;
  max-width: 92%;
  min-width: 0;
  padding: 0.55rem 0.65rem;
}

.vibe64-ephemeral-conversation__message--user {
  align-self: end;
  background: rgba(var(--v-theme-primary), 0.11);
}

.vibe64-ephemeral-conversation__message--assistant {
  align-self: start;
  background: rgba(var(--v-theme-tertiary), 0.09);
}

.vibe64-ephemeral-conversation__message--system {
  align-self: start;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.875rem;
}

.vibe64-ephemeral-conversation__message p {
  margin: 0;
  white-space: pre-wrap;
}

.vibe64-ephemeral-conversation__progress {
  margin: 0.15rem 0;
}

.vibe64-ephemeral-conversation__message span {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
  line-height: 1.35;
}
</style>
