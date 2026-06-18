<template>
  <section
    v-if="visible"
    class="studio-conversation-log"
    aria-label="Conversation history"
  >
    <v-btn
      v-if="reloadable"
      aria-label="Reload chat"
      class="studio-conversation-log__reload"
      :disabled="reloading"
      :icon="mdiRefresh"
      :loading="reloading"
      size="x-small"
      title="Reload chat"
      type="button"
      variant="text"
      @click="emit('reload')"
    />

    <v-progress-circular
      v-if="loadingIndicatorVisible && !reloadable"
      class="studio-conversation-log__loading"
      color="primary"
      indeterminate
      size="18"
      width="2"
    />

    <v-alert
      v-if="error"
      density="compact"
      type="warning"
      variant="tonal"
    >
      {{ error }}
    </v-alert>

    <div
      v-else
      ref="bodyElement"
      class="studio-conversation-log__body"
    >
      <article
        v-for="turn in displayTurns"
        :key="turn.turnId"
        class="studio-conversation-log__turn"
      >
        <div
          v-if="turn.system"
          class="studio-conversation-log__system"
        >
          <v-icon
            class="studio-conversation-log__system-icon"
            :icon="mdiInformationOutline"
            size="15"
          />
          <div class="studio-conversation-log__system-body">
            <div class="studio-conversation-log__system-meta">
              <span>Status</span>
              <time v-if="turn.system.displayAt">{{ turn.system.displayAt }}</time>
            </div>
            <LongTextPreviewBlocks
              compact
              :blocks="turn.system.blocks"
            />
          </div>
        </div>

        <div
          v-if="turn.user"
          class="studio-conversation-log__message-row studio-conversation-log__message-row--user"
        >
          <div class="studio-conversation-log__message studio-conversation-log__message--user">
            <LongTextPreviewBlocks :blocks="turn.user.blocks" />
            <div
              v-if="turn.user.displayAt"
              class="studio-conversation-log__message-footer studio-conversation-log__message-footer--user"
            >
              <time v-if="turn.user.displayAt">{{ turn.user.displayAt }}</time>
            </div>
            <div
              v-if="turn.optimistic?.status === 'failed'"
              class="studio-conversation-log__optimistic-failure"
            >
              <span>{{ turn.optimistic.error || "Message could not be sent." }}</span>
              <div class="studio-conversation-log__optimistic-actions">
                <v-btn
                  color="primary"
                  size="x-small"
                  type="button"
                  variant="tonal"
                  @click="emit('resend-turn', turn.optimistic.id)"
                >
                  Resend
                </v-btn>
                <v-btn
                  size="x-small"
                  type="button"
                  variant="text"
                  @click="emit('edit-turn', turn.optimistic.id)"
                >
                  Edit
                </v-btn>
              </div>
            </div>
          </div>
          <span class="studio-conversation-log__avatar studio-conversation-log__avatar--user">
            <v-icon :icon="mdiAccountOutline" size="15" />
          </span>
        </div>

        <div
          v-if="turn.thinking.length"
          class="studio-conversation-log__thinking"
        >
          <div class="studio-conversation-log__thinking-label">
            Thinking
          </div>
          <div
            v-for="message in turn.thinking"
            :key="`${message.at}:${message.text}`"
            class="studio-conversation-log__thinking-message"
          >
            <LongTextPreviewBlocks
              compact
              :blocks="message.blocks"
            />
          </div>
        </div>

        <div
          v-if="turn.assistant"
          class="studio-conversation-log__message-row studio-conversation-log__message-row--assistant"
        >
          <div class="studio-conversation-log__assistant-header">
            <span class="studio-conversation-log__avatar studio-conversation-log__avatar--assistant">
              <v-icon :icon="mdiRobotOutline" size="16" />
            </span>
            <div class="studio-conversation-log__message-header">
              <span>Codex</span>
            </div>
          </div>
          <div class="studio-conversation-log__message studio-conversation-log__message--assistant">
            <LongTextPreviewBlocks
              v-if="turn.assistant.blocks.length"
              :blocks="turn.assistant.blocks"
            />
            <ol
              v-if="turn.assistant.questions.length"
              class="studio-conversation-log__questions"
            >
              <li
                v-for="question in turn.assistant.questions"
                :key="question.name"
                class="studio-conversation-log__question"
              >
                <span class="studio-conversation-log__question-number">{{ question.number }}</span>
                <span class="studio-conversation-log__question-text">{{ question.label }}</span>
              </li>
            </ol>
          </div>
          <div
            v-if="turn.assistant.displayAt"
            class="studio-conversation-log__message-footer studio-conversation-log__message-footer--assistant"
          >
            <time>{{ turn.assistant.displayAt }}</time>
          </div>
        </div>
      </article>

      <article
        v-for="message in displayActivityMessages"
        :key="message.id"
        class="studio-conversation-log__turn"
      >
        <div
          v-if="message.appearance === 'assistant'"
          class="studio-conversation-log__message-row studio-conversation-log__message-row--assistant studio-conversation-log__message-row--activity-assistant"
        >
          <div class="studio-conversation-log__assistant-header">
            <span class="studio-conversation-log__avatar studio-conversation-log__avatar--assistant">
              <v-progress-circular
                v-if="message.loading"
                color="white"
                indeterminate
                size="15"
                width="2"
              />
              <v-icon
                v-else
                :icon="message.icon || mdiRobotOutline"
                size="16"
              />
            </span>
            <div class="studio-conversation-log__message-header">
              <span>{{ message.label }}</span>
            </div>
          </div>
          <div class="studio-conversation-log__message studio-conversation-log__message--assistant studio-conversation-log__message--activity-assistant">
            <h3 v-if="message.title" class="studio-conversation-log__activity-title">
              {{ message.title }}
            </h3>
            <LongTextPreviewBlocks
              v-if="message.blocks.length"
              :blocks="message.blocks"
            />
          </div>
          <div
            v-if="message.displayAt"
            class="studio-conversation-log__message-footer studio-conversation-log__message-footer--assistant studio-conversation-log__message-footer--activity-assistant"
          >
            <time>{{ message.displayAt }}</time>
          </div>
        </div>
        <div
          v-else-if="message.appearance === 'thinking'"
          class="studio-conversation-log__thinking studio-conversation-log__thinking--activity"
        >
          <div class="studio-conversation-log__thinking-label">
            {{ message.label }}
          </div>
          <div class="studio-conversation-log__thinking-message">
            <LongTextPreviewBlocks
              compact
              :blocks="message.blocks"
            />
          </div>
        </div>
        <div
          v-else
          class="studio-conversation-log__message studio-conversation-log__message--activity"
          :class="{
            'studio-conversation-log__message--activity-guide': message.appearance === 'guide',
            'studio-conversation-log__message--activity-success': message.tone === 'success',
            'studio-conversation-log__message--activity-warning': message.tone === 'warning',
            'studio-conversation-log__message--activity-error': message.tone === 'error'
          }"
        >
          <div class="studio-conversation-log__message-header">
            <span>
              <v-progress-circular
                v-if="message.loading"
                color="primary"
                indeterminate
                size="15"
                width="2"
              />
              <v-icon
                v-else-if="message.icon"
                :icon="message.icon"
                size="16"
              />
              {{ message.label }}
            </span>
            <time v-if="message.displayAt">{{ message.displayAt }}</time>
          </div>
          <h3 v-if="message.title" class="studio-conversation-log__activity-title">
            {{ message.title }}
          </h3>
          <LongTextPreviewBlocks
            v-if="message.blocks.length"
            :blocks="message.blocks"
          />
        </div>
      </article>
      <div
        ref="bottomElement"
        class="studio-conversation-log__bottom"
        aria-hidden="true"
      />
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import {
  mdiAccountOutline,
  mdiInformationOutline,
  mdiRefresh,
  mdiRobotOutline
} from "@mdi/js";
import { useScrollToBottom } from "@/composables/useScrollToBottom.js";
import LongTextPreviewBlocks from "@/components/studio/LongTextPreviewBlocks.vue";
import { parseNumberedQuestionPrompt } from "@/lib/vibe64NumberedQuestionSugar.js";
import { parseLongTextReviewBlocks } from "@/lib/studioLongTextBlocks.js";

const props = defineProps({
  activityMessages: {
    default: () => [],
    type: Array
  },
  error: {
    default: "",
    type: String
  },
  loading: {
    default: false,
    type: Boolean
  },
  reloadable: {
    default: false,
    type: Boolean
  },
  reloading: {
    default: false,
    type: Boolean
  },
  scrollKey: {
    default: "",
    type: [Number, String]
  },
  turns: {
    default: () => [],
    type: Array
  },
  visible: {
    default: false,
    type: Boolean
  }
});

const emit = defineEmits(["edit-turn", "reload", "resend-turn"]);

const bodyElement = ref(null);
const bottomElement = ref(null);
const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit"
});

function displayTime(value = "") {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return timeFormatter.format(date);
}

function displayMessage(message = null, {
  allowNumberedQuestions = false,
  preserveParagraphLineBreaks = false
} = {}) {
  if (!message) {
    return null;
  }
  const questionInput = allowNumberedQuestions
    ? parseNumberedQuestionPrompt(message.text)
    : {
        intro: "",
        questions: []
      };
  const hasQuestions = questionInput.questions.length > 0;
  return {
    ...message,
    blocks: parseLongTextReviewBlocks(hasQuestions ? questionInput.intro : message.text, {
      preserveParagraphLineBreaks
    }),
    questions: hasQuestions ? questionInput.questions : [],
    displayAt: displayTime(message.at)
  };
}

const displayTurns = computed(() => (Array.isArray(props.turns) ? props.turns : [])
  .map((turn, index) => ({
    assistant: displayMessage(turn.assistant, {
      allowNumberedQuestions: true
    }),
    optimistic: turn.optimistic && typeof turn.optimistic === "object" && !Array.isArray(turn.optimistic)
      ? turn.optimistic
      : null,
    system: displayMessage(turn.system),
    thinking: Array.isArray(turn.thinking)
      ? turn.thinking.map((message) => displayMessage(message)).filter(Boolean)
      : [],
    turnId: String(turn.turnId || index + 1),
    user: displayMessage(turn.user, {
      preserveParagraphLineBreaks: true
    })
  }))
  .filter((turn) => turn.system || turn.user || turn.thinking.length || turn.assistant));

function displayActivityMessage(message = {}, index = 0) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }
  const text = String(message.text || "").trim();
  const title = String(message.title || "").trim();
  const appearance = String(message.appearance || "");
  if (!text && !title && message.loading !== true) {
    return null;
  }
  return {
    appearance: ["assistant", "guide", "thinking"].includes(appearance) ? appearance : "activity",
    blocks: parseLongTextReviewBlocks(text),
    displayAt: displayTime(message.at),
    icon: String(message.icon || "").trim(),
    id: String(message.id || `activity-${index + 1}`).trim(),
    label: String(message.label || "Vibe64").trim() || "Vibe64",
    loading: message.loading === true,
    title,
    tone: String(message.tone || "info").trim()
  };
}

const displayActivityMessages = computed(() => (Array.isArray(props.activityMessages) ? props.activityMessages : [])
  .map(displayActivityMessage)
  .filter(Boolean));

const loadingIndicatorVisible = computed(() => Boolean(
  props.loading &&
  !displayTurns.value.length &&
  !displayActivityMessages.value.length
));

function messageScrollKey(message = null) {
  if (!message) {
    return "empty";
  }
  return [
    message.at || "",
    String(message.text || "").length
  ].join("/");
}

function turnScrollKey(turn = {}) {
  return [
    turn.turnId,
    messageScrollKey(turn.system),
    messageScrollKey(turn.user),
    turn.thinking.map(messageScrollKey).join(","),
    messageScrollKey(turn.assistant)
  ].join(":");
}

const scrollTrigger = computed(() => [
  props.visible ? "visible" : "hidden",
  loadingIndicatorVisible.value ? "loading" : "ready",
  props.scrollKey,
  displayTurns.value.map(turnScrollKey).join("|"),
  displayActivityMessages.value.map((message) => [
    message.id,
    message.appearance,
    message.loading ? "loading" : "ready",
    message.title,
    String(message.blocks.map((block) => block.text || "").join("\n")).length
  ].join(":")).join("|")
].join(":"));

const { scrollAfterLayout: scrollToLatestMessage } = useScrollToBottom({
  anchor: bottomElement,
  enabled: computed(() => props.visible),
  scrollAnchorIntoView: false,
  target: bodyElement
});

onMounted(() => {
  void scrollToLatestMessage();
});

watch(scrollTrigger, () => {
  void scrollToLatestMessage();
}, {
  flush: "post",
  immediate: true
});
</script>

<style scoped>
.studio-conversation-log {
  border: 1px solid rgba(var(--v-theme-outline), 0.24);
  border-radius: 8px;
  display: grid;
  gap: 0.35rem;
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
  padding: 0.5rem;
  position: relative;
  text-align: left;
}

.studio-conversation-log__loading {
  position: absolute;
  right: 0.75rem;
  top: 0.75rem;
  z-index: 1;
}

.studio-conversation-log__reload {
  color: rgba(var(--v-theme-on-surface), 0.66);
  position: absolute;
  right: 0.38rem;
  top: 0.38rem;
  z-index: 2;
}

.studio-conversation-log__body {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  min-height: 0;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 0.15rem;
}

.studio-conversation-log__body > .studio-conversation-log__turn:first-child {
  margin-top: auto;
}

.studio-conversation-log__turn {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 0.65rem;
  min-height: 0;
  min-width: 0;
}

.studio-conversation-log__message-row {
  align-items: start;
  display: grid;
  gap: 0.65rem;
  max-width: 100%;
  min-width: 0;
  overflow-x: hidden;
}

.studio-conversation-log__message-row--user {
  grid-template-columns: minmax(0, auto) auto;
  justify-self: end;
  max-width: min(28rem, 88%);
  margin-left: auto;
}

.studio-conversation-log__message-row--assistant {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  justify-self: start;
  max-width: min(42rem, 94%);
  margin-right: auto;
}

.studio-conversation-log__message-row--activity-assistant {
  max-width: min(38rem, 92%);
}

.studio-conversation-log__assistant-header {
  align-items: center;
  display: grid;
  gap: 0.65rem;
  grid-template-columns: auto minmax(0, 1fr);
  min-width: 0;
}

.studio-conversation-log__message {
  display: flex;
  flex-direction: column;
  gap: 0.24rem;
  max-width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.studio-conversation-log__avatar {
  align-items: center;
  border-radius: 999px;
  display: inline-flex;
  height: 1.5rem;
  justify-content: center;
  width: 1.5rem;
}

.studio-conversation-log__avatar--user {
  background: #e9f2fc;
  color: #2f79ca;
  margin-top: 0.2rem;
}

.studio-conversation-log__avatar--assistant {
  background: #5b9ce1;
  color: #ffffff;
  margin-top: 0.05rem;
}

.studio-conversation-log__message--user {
  background: #e3ebf5;
  border-radius: 16px;
  color: #202936;
  gap: 0.75rem;
  justify-content: space-between;
  overflow-x: auto;
  padding: 0.75rem 1rem 0.72rem;
  width: fit-content;
}

.studio-conversation-log__message--assistant {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  padding: 0;
}

.studio-conversation-log__message--activity-assistant {
  color: rgba(var(--v-theme-on-surface), 0.76);
}

.studio-conversation-log__message-row--activity-assistant .studio-conversation-log__message-header,
.studio-conversation-log__message-footer--activity-assistant {
  font-size: 0.78rem;
}

.studio-conversation-log__thinking {
  color: rgba(var(--v-theme-on-surface), 0.58);
  display: grid;
  font-size: 0.78rem;
  gap: 0.18rem;
  justify-self: start;
  line-height: 1.42;
  margin-left: 2.15rem;
  max-width: min(34rem, 86%);
  min-width: 0;
  overflow-wrap: anywhere;
}

.studio-conversation-log__thinking-label {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.72rem;
  font-weight: 650;
  line-height: 1.2;
}

.studio-conversation-log__thinking-message :deep(.studio-long-text-review__blocks) {
  color: inherit;
  font-size: inherit;
  line-height: inherit;
}

.studio-conversation-log__thinking-message :deep(.studio-long-text-review__paragraph) {
  font-size: inherit;
  margin-block: 0;
}

.studio-conversation-log__thinking--activity .studio-conversation-log__thinking-message,
.studio-conversation-log__thinking--activity .studio-conversation-log__thinking-message :deep(.studio-long-text-review__blocks),
.studio-conversation-log__thinking--activity .studio-conversation-log__thinking-message :deep(.studio-long-text-review__paragraph) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-conversation-log__message--activity {
  background: rgba(var(--v-theme-primary), 0.055);
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  justify-self: start;
  max-width: min(48rem, 94%);
}

.studio-conversation-log__message--activity-guide {
  background: rgb(var(--v-theme-surface));
  border-color: rgba(var(--v-theme-primary), 0.18);
  border-radius: 18px 18px 18px 6px;
  box-shadow: 0 0.45rem 1.4rem rgba(15, 23, 42, 0.05);
  max-width: min(38rem, 94%);
}

.studio-conversation-log__message--activity-success {
  background: rgba(var(--v-theme-success), 0.08);
  border-color: rgba(var(--v-theme-success), 0.2);
}

.studio-conversation-log__message--activity-warning {
  background: rgba(var(--v-theme-warning), 0.09);
  border-color: rgba(var(--v-theme-warning), 0.24);
}

.studio-conversation-log__message--activity-error {
  background: rgba(var(--v-theme-error), 0.08);
  border-color: rgba(var(--v-theme-error), 0.22);
}

.studio-conversation-log__activity-title {
  font-size: 0.92rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.25;
  margin: 0;
}

.studio-conversation-log__message--activity-assistant .studio-conversation-log__activity-title {
  font-size: 0.84rem;
  font-weight: 680;
}

.studio-conversation-log__system {
  align-items: start;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.84);
  display: grid;
  gap: 0.45rem;
  grid-template-columns: auto minmax(0, 1fr);
  justify-self: start;
  max-width: min(34rem, 96%);
  min-width: 0;
  padding: 0.1rem 0.15rem;
}

.studio-conversation-log__system-icon {
  color: rgba(var(--v-theme-primary), 0.82);
  margin-top: 0.15rem;
}

.studio-conversation-log__system-body {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
  overflow-wrap: anywhere;
}

.studio-conversation-log__system-meta {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.48);
  display: flex;
  font-size: 0.72rem;
  gap: 0.5rem;
  line-height: 1.15;
}

.studio-conversation-log__message-header {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.82);
  display: flex;
  font-size: 0.9rem;
  gap: 0.7rem;
  justify-content: space-between;
  line-height: 1.2;
}

.studio-conversation-log__message--assistant .studio-conversation-log__message-header {
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-weight: 560;
}

.studio-conversation-log__message-header span {
  align-items: center;
  display: flex;
  gap: 0.25rem;
  min-width: 0;
  overflow-wrap: anywhere;
}

.studio-conversation-log__message-header time {
  color: #6d7888;
  font-weight: 650;
}

.studio-conversation-log__message-footer {
  align-items: center;
  color: #9aa6b6;
  display: flex;
  font-size: 0.88rem;
  font-weight: 500;
  gap: 0.65rem;
  line-height: 1.2;
}

.studio-conversation-log__message-footer--user {
  justify-content: flex-start;
}

.studio-conversation-log__message-footer--assistant {
  justify-content: flex-start;
  margin-top: -0.15rem;
}

.studio-conversation-log__optimistic-failure {
  align-items: center;
  color: rgba(var(--v-theme-error), 0.92);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.76rem;
  gap: 0.35rem 0.55rem;
  line-height: 1.25;
}

.studio-conversation-log__optimistic-actions {
  align-items: center;
  display: inline-flex;
  gap: 0.25rem;
}

.studio-conversation-log__message--assistant :deep(.studio-long-text-review__blocks),
.studio-conversation-log__message--user :deep(.studio-long-text-review__blocks) {
  color: inherit;
  font-size: 0.94rem;
  line-height: 1.5;
  min-width: 0;
  overflow-wrap: anywhere;
}

.studio-conversation-log__message--activity-assistant :deep(.studio-long-text-review__blocks) {
  font-size: 0.82rem;
  line-height: 1.42;
}

.studio-conversation-log__message--assistant :deep(.studio-long-text-review__paragraph),
.studio-conversation-log__message--user :deep(.studio-long-text-review__paragraph) {
  font-size: 0.94rem;
  margin-block: 0;
}

.studio-conversation-log__message--activity-assistant :deep(.studio-long-text-review__paragraph) {
  font-size: 0.82rem;
}

.studio-conversation-log__message--user :deep(.studio-long-text-review__paragraph) {
  white-space: pre-wrap;
}

.studio-conversation-log__message--assistant :deep(.studio-long-text-review__paragraph code),
.studio-conversation-log__message--user :deep(.studio-long-text-review__paragraph code) {
  background: transparent;
  border-radius: 0;
  color: inherit;
  font-family: inherit;
  font-size: 1em;
  padding: 0;
}

.studio-conversation-log__questions {
  display: grid;
  gap: 0.28rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.studio-conversation-log__question {
  align-items: start;
  background: rgba(var(--v-theme-surface), 0.62);
  border: 1px solid rgba(var(--v-theme-outline), 0.2);
  border-radius: 8px;
  display: grid;
  gap: 0.42rem;
  grid-template-columns: auto minmax(0, 1fr);
  padding: 0.36rem 0.5rem;
}

.studio-conversation-log__question-number {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.1);
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
  border-radius: 999px;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  font-size: 0.72rem;
  font-weight: 760;
  height: 1.35rem;
  justify-content: center;
  line-height: 1;
  min-width: 1.35rem;
}

.studio-conversation-log__question-text {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.9rem;
  line-height: 1.35;
  min-width: 0;
  overflow-wrap: anywhere;
}

.studio-conversation-log__bottom {
  height: 1px;
}
</style>
