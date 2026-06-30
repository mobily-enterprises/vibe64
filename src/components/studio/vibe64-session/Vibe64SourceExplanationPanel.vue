<template>
  <aside
    class="vibe64-source-explanation"
    aria-label="Source explanation"
  >
    <header class="vibe64-source-explanation__header">
      <div>
        <p>Explanation</p>
        <h3>{{ explanation.title || "Code explanation" }}</h3>
      </div>
      <v-btn
        :icon="mdiClose"
        size="small"
        title="Close explanation"
        type="button"
        variant="text"
        @click="emit('close')"
      />
    </header>

    <div class="vibe64-source-explanation__meta">
      <button
        class="vibe64-source-explanation__range"
        type="button"
        @click="emit('open-range', explanation)"
      >
        {{ explanation.sourceRange.path }}:{{ explanation.sourceRange.startLine }}-{{ explanation.sourceRange.endLine }}
      </button>
      <v-chip
        v-if="explanation.stale"
        color="warning"
        size="x-small"
        variant="tonal"
      >
        Stale
      </v-chip>
    </div>

    <v-alert
      v-if="explanation.stale"
      density="compact"
      type="warning"
      variant="tonal"
    >
      {{ explanation.staleReason || "The source changed after this explanation was created." }}
    </v-alert>

    <section
      class="vibe64-source-explanation__thread"
      aria-label="Explanation chat"
    >
      <article
        v-for="message in chatMessages"
        :key="message.id"
        class="vibe64-source-explanation__message"
        :class="`vibe64-source-explanation__message--${message.role}`"
      >
        <strong>{{ message.role === "user" ? "You" : "Vibe64" }}</strong>
        <p>{{ message.text }}</p>
      </article>
    </section>

    <v-alert
      v-if="followupDisabledReason"
      density="compact"
      type="info"
      variant="tonal"
    >
      {{ followupDisabledReason }}
    </v-alert>

    <form
      class="vibe64-source-explanation__followup"
      @submit.prevent="submitFollowup"
    >
      <Vibe64AutopilotPromptTextarea
        :attachments-enabled="false"
        :disabled="busy || Boolean(followupDisabledReason)"
        label="Ask about this explanation"
        :model-value="followup"
        placeholder="Ask a follow-up"
        rows="2"
        submit-on-enter
        @submit="submitFollowup"
        @update:model-value="emit('update:followup', $event)"
      >
        <template #footer>
          <div class="vibe64-source-explanation__followup-footer">
            <v-btn
              color="primary"
              :disabled="!followup.trim() || busy || Boolean(followupDisabledReason)"
              :icon="mdiSend"
              :loading="busy"
              title="Send follow-up"
              type="submit"
              variant="flat"
            />
          </div>
        </template>
      </Vibe64AutopilotPromptTextarea>
    </form>
  </aside>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiClose,
  mdiSend
} from "@mdi/js";

import Vibe64AutopilotPromptTextarea from "@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue";

const props = defineProps({
  busy: {
    default: false,
    type: Boolean
  },
  explanation: {
    default: () => ({
      body: "",
      followups: [],
      messages: [],
      sourceRange: {},
      summary: "",
      title: ""
    }),
    type: Object
  },
  followup: {
    default: "",
    type: String
  }
});

const emit = defineEmits([
  "close",
  "open-range",
  "send-followup",
  "update:followup"
]);

const followupDisabledReason = computed(() => (
  props.explanation?.codexSessionId
    ? ""
    : "Regenerate this explanation to enable follow-up chat."
));
const chatMessages = computed(() => (
  Array.isArray(props.explanation?.messages) && props.explanation.messages.length
    ? props.explanation.messages
    : [
        ...(props.explanation?.body
          ? [{
              id: "body",
              role: "assistant",
              text: props.explanation.body
            }]
          : []),
        ...(Array.isArray(props.explanation?.followups) ? props.explanation.followups : [])
      ]
));

function submitFollowup() {
  if (!props.followup.trim() || props.busy || followupDisabledReason.value) {
    return;
  }
  emit("send-followup");
}
</script>

<style scoped>
.vibe64-source-explanation {
  border-left: 1px solid rgba(var(--v-border-color), 0.28);
  display: grid;
  gap: 0.75rem;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto auto;
  min-width: 0;
  overflow: auto;
  padding: 0.78rem;
}

.vibe64-source-explanation__header {
  align-items: start;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.vibe64-source-explanation__header p {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.72rem;
  font-weight: 760;
  letter-spacing: 0.06em;
  margin: 0 0 0.15rem;
  text-transform: uppercase;
}

.vibe64-source-explanation__header h3 {
  font-size: 0.95rem;
  line-height: 1.2;
  margin: 0;
}

.vibe64-source-explanation__meta {
  align-items: center;
  display: flex;
  gap: 0.45rem;
  min-width: 0;
}

.vibe64-source-explanation__range {
  background: transparent;
  border: 0;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.76rem;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-source-explanation__message strong {
  font-size: 0.76rem;
}

.vibe64-source-explanation__message p {
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-size: 0.84rem;
  line-height: 1.45;
  margin: 0;
  white-space: pre-wrap;
}

.vibe64-source-explanation__thread {
  align-content: start;
  display: grid;
  gap: 0.55rem;
  min-height: 0;
  overflow: auto;
  padding-right: 0.1rem;
}

.vibe64-source-explanation__message {
  border-radius: 7px;
  display: grid;
  gap: 0.28rem;
  padding: 0.55rem 0.65rem;
}

.vibe64-source-explanation__message--user {
  background: rgba(var(--v-theme-primary), 0.12);
}

.vibe64-source-explanation__message--assistant {
  background: rgba(var(--v-theme-surface-variant), 0.36);
}

.vibe64-source-explanation__followup {
  min-width: 0;
}

.vibe64-source-explanation__followup :deep(.studio-autopilot-prompt-textarea) {
  padding-inline: 0;
}

.vibe64-source-explanation__followup :deep(.studio-autopilot-prompt-textarea__field) {
  border-radius: 9px;
}

.vibe64-source-explanation__followup :deep(.studio-autopilot-prompt-textarea__input) {
  min-height: 3.2rem;
}

.vibe64-source-explanation__followup-footer {
  display: flex;
  justify-content: flex-end;
  min-width: 0;
}
</style>
