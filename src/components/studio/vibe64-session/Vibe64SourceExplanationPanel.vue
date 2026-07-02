<template>
  <aside
    class="vibe64-source-explanation"
    aria-label="Source explanation"
  >
    <header class="vibe64-source-explanation__header">
      <div class="vibe64-source-explanation__source">
        <button
          class="vibe64-source-explanation__range"
          :title="sourceRangeFullLabel"
          type="button"
          @click="emit('open-range', explanation)"
        >
          <span class="vibe64-source-explanation__range-path">
            {{ sourceRangePathLabel }}
          </span>
          <span
            v-if="sourceRangeSuffixLabel"
            class="vibe64-source-explanation__range-suffix"
          >
            {{ sourceRangeSuffixLabel }}
          </span>
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
      <v-btn
        class="vibe64-source-explanation__collapse-button"
        aria-label="Collapse explanation"
        :icon="mdiChevronRight"
        size="small"
        title="Collapse explanation"
        type="button"
        variant="text"
        @click="emit('collapse')"
      />
      <v-btn
        :icon="mdiClose"
        size="x-small"
        title="Close explanation"
        type="button"
        variant="text"
        @click="emit('close')"
      />
    </header>

    <v-alert
      v-if="explanation.stale"
      class="vibe64-source-explanation__stale"
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
    >
      <article
        v-for="message in chatMessages"
        :key="message.id"
        class="vibe64-source-explanation__message"
        :class="[
          `vibe64-source-explanation__message--${message.role}`,
          { 'vibe64-source-explanation__message--thinking': message.status === 'thinking' }
        ]"
      >
        <strong>{{ message.role === "user" ? "You" : "Vibe64" }}</strong>
        <div
          v-if="message.status === 'thinking'"
          class="vibe64-source-explanation__thinking"
        >
          <LongTextPreviewBlocks
            v-if="message.text"
            compact
            class="vibe64-source-explanation__thinking-detail"
            :blocks="message.blocks"
            @link-click="handleExplanationLinkClick"
          />
          <div
            class="vibe64-source-explanation__status"
            role="status"
          >
            <span
              aria-hidden="true"
              class="vibe64-source-explanation__status-mark"
            />
            <span>Thinking...</span>
          </div>
        </div>
        <LongTextPreviewBlocks
          v-else-if="message.text"
          :blocks="message.blocks"
          @link-click="handleExplanationLinkClick"
        />
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
      class="vibe64-source-explanation__followup-alert"
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
        :auto-grow="true"
        :disabled="Boolean(followupDisabledReason)"
        label="Ask about this explanation"
        :model-value="followup"
        placeholder="Ask a follow-up"
        rows="1"
        @submit="submitFollowup"
        @update:model-value="emit('update:followup', $event)"
      >
        <template #footer>
          <div class="vibe64-source-explanation__followup-footer">
            <Vibe64AgentSettingsMenu
              :agent-settings="agentSettings"
              :disabled="Boolean(followupDisabledReason)"
              @update-setting="updateAgentSetting"
            />
            <v-btn
              v-if="thinking"
              color="error"
              :disabled="!busy"
              :icon="mdiStop"
              size="small"
              title="Stop explanation"
              type="button"
              variant="tonal"
              @click="emit('stop')"
            />
            <v-btn
              color="primary"
              :disabled="!followup.trim() || busy || Boolean(followupDisabledReason)"
              :icon="mdiSend"
              size="small"
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
  mdiChevronRight,
  mdiClose,
  mdiSend,
  mdiStop
} from "@mdi/js";

import { useScrollToBottom } from "@/composables/useScrollToBottom.js";
import Vibe64AutopilotPromptTextarea from "@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue";
import Vibe64AgentSettingsMenu from "@/components/studio/vibe64-session/Vibe64AgentSettingsMenu.vue";
import LongTextPreviewBlocks from "@/components/studio/LongTextPreviewBlocks.vue";
import { scrollElementNearBottom } from "@/lib/scrollFollowState.js";
import { parseLongTextReviewBlocks } from "@/lib/studioLongTextBlocks.js";
import { sourceEditorLinkTarget } from "@/lib/vibe64SourceEditorLinks.js";

const props = defineProps({
  agentSettings: {
    default: () => ({}),
    type: Object
  },
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
  "collapse",
  "close",
  "open-range",
  "open-source-link",
  "send-followup",
  "stop",
  "update-agent-setting",
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
const sourceRange = computed(() => props.explanation?.sourceRange || {});
const sourceRangeFullLabel = computed(() => sourceRangeDisplayLabel(sourceRange.value, {
  compact: false
}));
const sourceRangePathLabel = computed(() => sourceRangePathDisplayLabel(sourceRange.value));
const sourceRangeSuffixLabel = computed(() => sourceRangeLineSuffix(sourceRange.value));
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

function sourceRangeLineSuffix({
  endLine,
  startLine
} = {}) {
  const start = Number(startLine);
  const end = Number(endLine);
  if (!Number.isFinite(start) || start < 1) {
    return "";
  }
  if (!Number.isFinite(end) || end < 1 || end === start) {
    return `:${start}`;
  }
  return `:${start}-${end}`;
}

function compactSourcePath(path = "", {
  maxLength = 36
} = {}) {
  const normalized = normalizePanelSourcePath(path);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `...${normalized.slice(-maxLength)}`;
}

function sourceRangePathDisplayLabel(range = {}) {
  const path = normalizePanelSourcePath(range?.path);
  if (!path) {
    return "Source";
  }
  return compactSourcePath(path);
}

function sourceRangeDisplayLabel(range = {}, {
  compact = true
} = {}) {
  const path = normalizePanelSourcePath(range?.path);
  if (!path) {
    return "Source";
  }
  const displayPath = compact ? compactSourcePath(path) : path;
  return `${displayPath}${sourceRangeLineSuffix(range)}`;
}

function submitFollowup() {
  if (!props.followup.trim() || props.busy || followupDisabledReason.value) {
    return;
  }
  emit("send-followup");
}

function updateAgentSetting(parameterId = "", value = "") {
  emit("update-agent-setting", parameterId, value);
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
  gap: 0.42rem;
  grid-template-areas:
    "header"
    "stale"
    "thread"
    "followup-alert"
    "followup";
  grid-template-rows: auto auto minmax(0, 1fr) auto auto;
  height: 100%;
  max-block-size: 100%;
  min-block-size: 0;
  min-width: 0;
  overflow: hidden;
  padding: 0.52rem 0.64rem 2px;
}

.vibe64-source-explanation__header {
  align-items: center;
  display: flex;
  grid-area: header;
  gap: 0.45rem;
  justify-content: space-between;
  min-width: 0;
}

.vibe64-source-explanation__source {
  align-items: center;
  display: flex;
  flex: 1 1 auto;
  flex-wrap: nowrap;
  gap: 0.35rem;
  min-width: 0;
  overflow: hidden;
}

.vibe64-source-explanation__range {
  background: transparent;
  border: 0;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  display: flex;
  flex: 1 1 auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.78rem;
  inline-size: auto;
  line-height: 1.2;
  max-inline-size: 100%;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  text-align: left;
  white-space: nowrap;
}

.vibe64-source-explanation__range-path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-source-explanation__range-suffix {
  flex: 0 0 auto;
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
  font-size: 0.76rem;
  font-weight: 650;
  gap: 0.45rem;
  line-height: 1.35;
  min-block-size: 1.4rem;
  min-width: 0;
}

.vibe64-source-explanation__thinking {
  display: grid;
  gap: 0.22rem;
  min-width: 0;
}

.vibe64-source-explanation__status-mark {
  animation: vibe64-source-explanation-thinking-pulse 1.3s ease-in-out infinite;
  background: rgb(var(--v-theme-primary));
  border-radius: 999px;
  block-size: 0.46rem;
  flex: 0 0 auto;
  inline-size: 0.46rem;
}

.vibe64-source-explanation__thinking-detail {
  min-width: 0;
}

.vibe64-source-explanation__thinking-detail :deep(.studio-long-text-review__paragraph),
.vibe64-source-explanation__thinking-detail :deep(.studio-long-text-review__list li) {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.74rem;
  line-height: 1.28;
}

.vibe64-source-explanation__status--stopped {
  color: rgba(var(--v-theme-on-surface), 0.62);
}

.vibe64-source-explanation__stale {
  grid-area: stale;
}

.vibe64-source-explanation__thread {
  contain: layout style paint;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  grid-area: thread;
  min-block-size: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 0.1rem 0.08rem 0;
}

.vibe64-source-explanation__message {
  border-radius: 7px;
  display: grid;
  gap: 0.24rem;
  max-width: 100%;
  min-width: 0;
  padding: 0.46rem 0.58rem;
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
  grid-area: followup;
  min-width: 0;
  width: 100%;
}

.vibe64-source-explanation__followup-alert {
  grid-area: followup-alert;
}

.vibe64-source-explanation__followup :deep(.studio-autopilot-prompt-textarea) {
  padding: 0.18rem 0 0;
}

.vibe64-source-explanation__followup :deep(.studio-autopilot-prompt-textarea__field) {
  align-items: end;
  border-radius: 9px;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  min-block-size: 3.2rem;
  padding: 0.18rem 0.28rem 0.28rem;
}

.vibe64-source-explanation__followup :deep(.studio-autopilot-prompt-textarea__label) {
  grid-column: 1 / -1;
  margin: -0.44rem 0 0 0.48rem;
}

.vibe64-source-explanation__followup :deep(.studio-autopilot-prompt-textarea__footer) {
  align-self: end;
  grid-column: 2;
  grid-row: 2;
  padding: 0;
}

.vibe64-source-explanation__followup :deep(.studio-autopilot-prompt-textarea__input) {
  grid-column: 1;
  grid-row: 2;
  line-height: 1.34;
  max-height: min(8rem, 22dvh);
  min-height: 1.65rem;
  padding: 0.28rem 0.46rem 0.22rem;
}

.vibe64-source-explanation__followup :deep(.studio-autopilot-prompt-textarea__input::placeholder) {
  color: rgba(var(--v-theme-on-surface), 0.46);
}

.vibe64-source-explanation__followup :deep(.studio-autopilot-prompt-textarea__input:disabled::placeholder) {
  color: rgba(var(--v-theme-on-surface), 0.46);
}

.vibe64-source-explanation__followup-footer {
  display: flex;
  gap: 0.32rem;
  justify-content: flex-end;
  min-width: 0;
}

.vibe64-source-explanation__followup-footer :deep(.v-btn) {
  block-size: 2.25rem;
  inline-size: 2.25rem;
  min-inline-size: 2.25rem;
}

.vibe64-source-explanation__collapse-button {
  min-inline-size: 2.2rem;
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
