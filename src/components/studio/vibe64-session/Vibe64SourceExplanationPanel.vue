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
      <v-btn
        v-if="sourceFileOpenElsewhere"
        :prepend-icon="mdiArrowLeft"
        size="x-small"
        title="Back to discussed file"
        type="button"
        variant="tonal"
        @click="emit('open-range', explanation)"
      >
        Back to discussed file
      </v-btn>
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
      ref="threadElement"
      class="vibe64-source-explanation__thread"
      aria-label="Explanation chat"
      @scroll="updateThreadFollowState"
      v-memo="[explanation]"
    >
      <article
        v-for="message in chatMessages"
        :key="message.id"
        class="vibe64-source-explanation__message"
        :class="`vibe64-source-explanation__message--${message.role}`"
      >
        <strong>{{ message.role === "user" ? "You" : "Vibe64" }}</strong>
        <LongTextPreviewBlocks
          v-if="message.text"
          :blocks="message.blocks"
          @link-click="handleExplanationLinkClick"
        />
        <div
          v-else-if="message.status === 'thinking'"
          class="vibe64-source-explanation__status"
          role="status"
        >
          <span
            aria-hidden="true"
            class="vibe64-source-explanation__status-mark"
          />
          <span>Thinking...</span>
        </div>
        <div
          v-else-if="message.status === 'stopped'"
          class="vibe64-source-explanation__status vibe64-source-explanation__status--stopped"
        >
          Stopped.
        </div>
      </article>
      <div
        ref="threadBottomElement"
        class="vibe64-source-explanation__thread-bottom"
      />
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
        :auto-grow="false"
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
              v-if="thinking"
              color="error"
              :disabled="!busy"
              :icon="mdiStop"
              title="Stop explanation"
              type="button"
              variant="tonal"
              @click="emit('stop')"
            />
            <v-btn
              color="primary"
              :disabled="!followup.trim() || busy || Boolean(followupDisabledReason)"
              :icon="mdiSend"
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
import { computed, ref, watch } from "vue";
import {
  mdiArrowLeft,
  mdiClose,
  mdiSend,
  mdiStop
} from "@mdi/js";

import { useScrollToBottom } from "@/composables/useScrollToBottom.js";
import Vibe64AutopilotPromptTextarea from "@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue";
import LongTextPreviewBlocks from "@/components/studio/LongTextPreviewBlocks.vue";
import { scrollElementNearBottom } from "@/lib/scrollFollowState.js";
import { parseLongTextReviewBlocks } from "@/lib/studioLongTextBlocks.js";
import { sourceEditorLinkTarget } from "@/lib/vibe64SourceEditorLinks.js";

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
  },
  selectedPath: {
    default: "",
    type: String
  }
});

const emit = defineEmits([
  "close",
  "open-range",
  "open-source-link",
  "send-followup",
  "stop",
  "update:followup"
]);

const followupDisabledReason = computed(() => (
  props.explanation?.agentThreadId
    ? ""
    : "Regenerate this explanation to enable follow-up chat."
));
const threadElement = ref(null);
const threadBottomElement = ref(null);
const followingLatest = ref(true);
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
).map((message) => ({
  ...message,
  blocks: parseLongTextReviewBlocks(message.text || "", {
    preserveParagraphLineBreaks: message.role === "user"
  })
})));
const thinking = computed(() => chatMessages.value.some((message) => message.status === "thinking"));
const discussedFilePath = computed(() => normalizePanelSourcePath(props.explanation?.sourceRange?.path));
const sourceFileOpenElsewhere = computed(() => Boolean(
  discussedFilePath.value &&
  normalizePanelSourcePath(props.selectedPath) &&
  normalizePanelSourcePath(props.selectedPath) !== discussedFilePath.value
));
const threadScrollKey = computed(() => chatMessages.value
  .map((message) => [
    message.id || "",
    message.role || "",
    message.status || "",
    String(message.text || "").length
  ].join(":"))
  .join("|"));

const {
  scrollAfterLayout: scrollThreadToBottom
} = useScrollToBottom({
  anchor: threadBottomElement,
  enabled: computed(() => followingLatest.value),
  scrollAnchorIntoView: false,
  target: threadElement
});

function normalizePanelSourcePath(value = "") {
  return String(value || "").trim().replaceAll("\\", "/").replace(/^\.\/+/u, "");
}

function submitFollowup() {
  if (!props.followup.trim() || props.busy || followupDisabledReason.value) {
    return;
  }
  emit("send-followup");
}

function queueThreadBottomScroll({
  force = false
} = {}) {
  if (force) {
    followingLatest.value = true;
  }
  void scrollThreadToBottom({
    behavior: force ? "auto" : "smooth"
  });
}

function updateThreadFollowState(event = {}) {
  followingLatest.value = scrollElementNearBottom(event?.currentTarget || threadElement.value);
}

function handleExplanationLinkClick(payload = {}) {
  const target = sourceEditorLinkTarget(payload);
  if (!target) {
    return;
  }
  payload.event?.preventDefault?.();
  payload.event?.stopPropagation?.();
  emit("open-source-link", target);
}

watch(() => props.explanation?.id || "", () => {
  queueThreadBottomScroll({
    force: true
  });
}, {
  flush: "post",
  immediate: true
});

watch(threadScrollKey, (value, previous) => {
  if (!value || value === previous) {
    return;
  }
  const latestMessage = chatMessages.value.at(-1);
  queueThreadBottomScroll({
    force: latestMessage?.role === "user"
  });
}, {
  flush: "post"
});
</script>

<style scoped>
.vibe64-source-explanation {
  block-size: 100%;
  border-left: 1px solid rgba(var(--v-border-color), 0.28);
  contain: layout style paint;
  display: grid;
  gap: 0.75rem;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto auto;
  max-block-size: 100%;
  min-block-size: 0;
  min-width: 0;
  overflow: hidden;
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
  flex-wrap: wrap;
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

.vibe64-source-explanation__status {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.78);
  display: flex;
  font-size: 0.84rem;
  font-weight: 650;
  gap: 0.45rem;
  line-height: 1.35;
  min-block-size: 1.4rem;
}

.vibe64-source-explanation__status-mark {
  animation: vibe64-source-explanation-thinking-pulse 1.3s ease-in-out infinite;
  background: rgb(var(--v-theme-primary));
  border-radius: 999px;
  block-size: 0.46rem;
  flex: 0 0 auto;
  inline-size: 0.46rem;
}

.vibe64-source-explanation__status--stopped {
  color: rgba(var(--v-theme-on-surface), 0.62);
}

.vibe64-source-explanation__thread {
  contain: layout style paint;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  min-block-size: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 0.1rem;
}

.vibe64-source-explanation__message {
  border-radius: 7px;
  display: grid;
  gap: 0.28rem;
  max-width: 100%;
  min-width: 0;
  padding: 0.55rem 0.65rem;
}

.vibe64-source-explanation__thread > .vibe64-source-explanation__message:first-child {
  margin-top: auto;
}

.vibe64-source-explanation__message--user {
  background: rgba(var(--v-theme-primary), 0.12);
}

.vibe64-source-explanation__message--assistant {
  background: transparent;
  padding-inline: 0.1rem;
}

.vibe64-source-explanation__followup {
  align-self: end;
  min-width: 0;
  width: 100%;
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
  gap: 0.45rem;
  justify-content: flex-end;
  min-width: 0;
}

.vibe64-source-explanation__thread-bottom {
  flex: 0 0 1px;
  height: 1px;
}

@keyframes vibe64-source-explanation-thinking-pulse {
  0%,
  100% {
    opacity: 0.62;
  }

  50% {
    opacity: 1;
  }
}
</style>
