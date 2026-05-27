<template>
  <section
    v-if="visible"
    class="studio-conversation-log"
    aria-label="Conversation history"
  >
    <div class="studio-conversation-log__header">
      <div class="studio-conversation-log__title">
        <v-icon :icon="mdiMessageTextOutline" size="18" />
        <strong>Conversation</strong>
      </div>
      <v-progress-circular
        v-if="loading"
        color="primary"
        indeterminate
        size="18"
        width="2"
      />
    </div>

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
          v-if="turn.user"
          class="studio-conversation-log__message studio-conversation-log__message--user"
        >
          <div class="studio-conversation-log__message-header">
            <span>
              <v-icon :icon="mdiAccountOutline" size="16" />
              You
            </span>
            <time v-if="turn.user.displayAt">{{ turn.user.displayAt }}</time>
          </div>
          <LongTextPreviewBlocks :blocks="turn.user.blocks" />
        </div>

        <div
          v-if="turn.assistant"
          class="studio-conversation-log__message studio-conversation-log__message--assistant"
        >
          <div class="studio-conversation-log__message-header">
            <span>
              <v-icon :icon="mdiRobotOutline" size="16" />
              Codex
            </span>
            <time v-if="turn.assistant.displayAt">{{ turn.assistant.displayAt }}</time>
          </div>
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
          v-else
          class="studio-conversation-log__pending"
        >
          <v-progress-circular
            color="primary"
            indeterminate
            size="16"
            width="2"
          />
          <span>Waiting for Codex...</span>
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
  mdiMessageTextOutline,
  mdiRobotOutline
} from "@mdi/js";
import { useScrollToBottom } from "@/composables/useScrollToBottom.js";
import LongTextPreviewBlocks from "@/components/studio/LongTextPreviewBlocks.vue";
import { parseNumberedQuestionPrompt } from "@/lib/vibe64NumberedQuestionSugar.js";
import { parseLongTextReviewBlocks } from "@/lib/studioLongTextBlocks.js";

const props = defineProps({
  error: {
    default: "",
    type: String
  },
  loading: {
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
  allowNumberedQuestions = false
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
    blocks: parseLongTextReviewBlocks(hasQuestions ? questionInput.intro : message.text),
    questions: hasQuestions ? questionInput.questions : [],
    displayAt: displayTime(message.at)
  };
}

const displayTurns = computed(() => (Array.isArray(props.turns) ? props.turns : [])
  .map((turn, index) => ({
    assistant: displayMessage(turn.assistant, {
      allowNumberedQuestions: true
    }),
    turnId: String(turn.turnId || index + 1),
    user: displayMessage(turn.user)
  }))
  .filter((turn) => turn.user || turn.assistant));

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
    messageScrollKey(turn.user),
    messageScrollKey(turn.assistant)
  ].join(":");
}

const scrollTrigger = computed(() => [
  props.visible ? "visible" : "hidden",
  props.loading ? "loading" : "ready",
  props.scrollKey,
  displayTurns.value.map(turnScrollKey).join("|")
].join(":"));

const { scrollAfterLayout: scrollToLatestMessage } = useScrollToBottom({
  anchor: bottomElement,
  enabled: computed(() => props.visible),
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
  gap: 0.65rem;
  min-height: 0;
  padding: 0.75rem;
  text-align: left;
}

.studio-conversation-log__header {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
}

.studio-conversation-log__title {
  align-items: center;
  color: rgb(var(--v-theme-primary));
  display: flex;
  gap: 0.38rem;
  min-width: 0;
}

.studio-conversation-log__title strong {
  color: rgb(var(--v-theme-on-surface));
}

.studio-conversation-log__body {
  display: grid;
  gap: 0.75rem;
  min-height: 0;
  overflow: auto;
  padding-right: 0.15rem;
}

.studio-conversation-log__turn {
  display: grid;
  gap: 0.45rem;
}

.studio-conversation-log__message {
  border-radius: 8px;
  display: grid;
  gap: 0.35rem;
  min-width: 0;
  padding: 0.65rem 0.75rem;
}

.studio-conversation-log__message--user {
  background: rgba(var(--v-theme-primary), 0.07);
  justify-self: end;
  max-width: min(42rem, 88%);
}

.studio-conversation-log__message--assistant {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.18);
  justify-self: start;
  max-width: min(48rem, 94%);
}

.studio-conversation-log__message-header {
  align-items: center;
  color: rgb(var(--v-theme-on-surface-variant));
  display: flex;
  font-size: 0.78rem;
  gap: 0.7rem;
  justify-content: space-between;
  line-height: 1.2;
}

.studio-conversation-log__message-header span {
  align-items: center;
  display: flex;
  gap: 0.25rem;
}

.studio-conversation-log__questions {
  display: grid;
  gap: 0.4rem;
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
  gap: 0.5rem;
  grid-template-columns: auto minmax(0, 1fr);
  padding: 0.5rem 0.58rem;
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

.studio-conversation-log__pending {
  align-items: center;
  color: rgb(var(--v-theme-on-surface-variant));
  display: flex;
  font-size: 0.84rem;
  gap: 0.45rem;
  padding: 0.15rem 0.25rem;
}

.studio-conversation-log__bottom {
  height: 1px;
}
</style>
