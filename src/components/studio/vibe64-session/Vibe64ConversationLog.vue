<template>
  <section
    v-if="visible"
    class="studio-conversation-log"
    :class="`studio-conversation-log--${variant}`"
    aria-label="Conversation history"
  >
    <v-btn
      v-if="reloadable"
      :aria-label="reloading ? 'Reloading chat' : 'Reload chat'"
      class="studio-conversation-log__reload"
      :disabled="reloading"
      :icon="mdiRefresh"
      size="x-small"
      :title="reloading ? 'Reloading chat' : 'Reload chat'"
      type="button"
      variant="text"
      @click="emit('reload')"
    />

    <v-skeleton-loader
      v-if="loadingIndicatorVisible && !reloadable"
      aria-label="Loading conversation"
      class="studio-conversation-log__loading-skeleton"
      type="list-item-avatar-two-line@3"
    />

    <div
      v-if="initialScrollPending"
      class="studio-conversation-log__settling"
      aria-hidden="true"
    >
      <v-skeleton-loader
        aria-label="Preparing conversation"
        class="studio-conversation-log__settling-skeleton"
        type="list-item-avatar-two-line@3"
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
      aria-label="Conversation messages"
      class="studio-conversation-log__body"
      :class="{ 'studio-conversation-log__body--settling': initialScrollPending }"
      tabindex="0"
      @keydown.capture="markKeyboardScrollIntent"
      @pointerdown.self="markUserScrollIntent"
      @scroll.passive="updateLatestFollowFromScroll"
      @touchmove.passive="markUserScrollIntent"
      @wheel.passive="markUserScrollIntent"
    >
      <div
        v-if="welcomeMessage"
        class="studio-conversation-log__welcome"
        role="status"
      >
        <div class="studio-conversation-log__assistant-header">
          <span class="studio-conversation-log__avatar studio-conversation-log__avatar--assistant">
            <v-icon :icon="mdiRobotOutline" size="16" />
          </span>
          <div class="studio-conversation-log__message-header">
            <span>{{ assistantLabel }}</span>
          </div>
        </div>
        <p>{{ welcomeMessage }}</p>
      </div>

      <div
        v-if="hasMoreBefore || loadingMore || loadMoreError"
        class="studio-conversation-log__load-more"
      >
        <v-btn
          color="primary"
          :disabled="loadingMore || !hasMoreBefore"
          size="x-small"
          type="button"
          variant="tonal"
          @click="requestLoadMore"
        >
          {{ loadingMore ? "Loading older messages…" : "Load older messages" }}
        </v-btn>
        <div
          v-if="loadMoreError"
          class="studio-conversation-log__load-more-error"
        >
          {{ loadMoreError }}
        </div>
      </div>

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
              @link-click="handleLongTextLinkClick"
            />
          </div>
        </div>

        <div
          v-if="turn.user"
          class="studio-conversation-log__message-row studio-conversation-log__message-row--user"
        >
          <div class="studio-conversation-log__message studio-conversation-log__message--user">
            <div
              class="studio-conversation-log__user-content"
            >
              <LongTextPreviewBlocks
                :blocks="userMessageExpanded(turn) ? turn.user.blocks : (turn.user.previewBlocks || turn.user.blocks)"
                @link-click="handleLongTextLinkClick"
              />
            </div>
            <button
              v-if="userMessageCollapsible(turn.user)"
              :aria-expanded="userMessageExpanded(turn)"
              class="studio-conversation-log__user-content-toggle"
              type="button"
              @click="toggleUserMessage(turn)"
            >
              {{ userMessageExpanded(turn) ? "Show less" : "Read more" }}
            </button>
            <Vibe64ConversationAttachments :items="turn.user.attachments" :session-id="sessionId" />
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
                  @click="emit('cancel-turn', turn.optimistic.id)"
                >
                  Cancel
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

        <template
          v-for="entry in turn.agentTimeline"
          :key="entry.key"
        >
          <Vibe64ConversationProgress
            v-if="entry.role === 'thinking'"
            :key="`${turn.turnId}:${turn.pending ? 'active' : 'completed'}:${entry.key}`"
            class="studio-conversation-log__thinking"
            :messages="entry.messages"
            :pending="turn.pending"
          />
          <div
            v-else
            class="studio-conversation-log__message-row studio-conversation-log__message-row--assistant"
            :data-message-role="entry.role"
          >
            <div class="studio-conversation-log__assistant-header">
              <span class="studio-conversation-log__avatar studio-conversation-log__avatar--assistant">
                <v-icon :icon="mdiRobotOutline" size="16" />
              </span>
              <div class="studio-conversation-log__message-header">
                <span>{{ assistantLabel }}</span>
              </div>
            </div>
            <div class="studio-conversation-log__message studio-conversation-log__message--assistant">
              <LongTextPreviewBlocks
                v-if="entry.message.blocks.length"
                :blocks="entry.message.blocks"
                @link-click="handleLongTextLinkClick"
              />
              <ol
                v-if="entry.message.questions.length"
                class="studio-conversation-log__questions"
              >
                <li
                  v-for="question in entry.message.questions"
                  :key="question.name"
                  class="studio-conversation-log__question"
                >
                  <span class="studio-conversation-log__question-number">{{ question.number }}</span>
                  <div class="studio-conversation-log__question-content">
                    <span class="studio-conversation-log__question-text">
                      <LongTextInlineParts
                        :text="question.label"
                        @link-click="handleLongTextLinkClick"
                      />
                    </span>
                    <ul
                      v-if="question.choices.length"
                      class="studio-conversation-log__question-choices"
                    >
                      <li v-for="choice in question.choices" :key="choice.value">
                        <LongTextInlineParts
                          :text="choice.label"
                          @link-click="handleLongTextLinkClick"
                        /><span v-if="choice.recommended"> · Recommended</span>
                      </li>
                    </ul>
                  </div>
                </li>
              </ol>
              <LongTextPreviewBlocks
                v-if="entry.message.outroBlocks.length"
                :blocks="entry.message.outroBlocks"
                @link-click="handleLongTextLinkClick"
              />
            </div>
            <div
              v-if="entry.message.displayAt"
              class="studio-conversation-log__message-footer studio-conversation-log__message-footer--assistant"
            >
              <time>{{ entry.message.displayAt }}</time>
            </div>
          </div>
        </template>
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
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  mdiAccountOutline,
  mdiInformationOutline,
  mdiRefresh,
  mdiRobotOutline
} from "@mdi/js";
import { useScrollToBottom } from "@/composables/useScrollToBottom.js";
import LongTextInlineParts from "@/components/studio/LongTextInlineParts.vue";
import LongTextPreviewBlocks from "@/components/studio/LongTextPreviewBlocks.vue";
import Vibe64ConversationProgress from "@/components/studio/vibe64-session/Vibe64ConversationProgress.vue";
import Vibe64ConversationAttachments from "@/components/studio/vibe64-session/Vibe64ConversationAttachments.vue";
import { parseNumberedQuestionPrompt } from "@/lib/vibe64NumberedQuestionSugar.js";
import { parseLongTextReviewBlocks } from "@/lib/studioLongTextBlocks.js";
import { sourceEditorLinkTarget } from "@/lib/vibe64SourceEditorLinks.js";
import {
  scrollElementNearBottom
} from "@/lib/scrollFollowState.js";
import {
  normalizeThinkingMessageText
} from "@/lib/vibe64ConversationThinkingText.js";

const props = defineProps({
  sessionId: { default: "", type: String },
  assistantLabel: {
    default: "Codex",
    type: String
  },
  error: {
    default: "",
    type: String
  },
  followLatestKey: {
    default: 0,
    type: [Number, String]
  },
  hasMoreBefore: {
    default: false,
    type: Boolean
  },
  loading: {
    default: false,
    type: Boolean
  },
  loadingMore: {
    default: false,
    type: Boolean
  },
  loadMoreError: {
    default: "",
    type: String
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
  sourceRoot: {
    default: "",
    type: String
  },
  turns: {
    default: () => [],
    type: Array
  },
  variant: {
    default: "main",
    validator: (value) => ["main", "task"].includes(value),
    type: String
  },
  visible: {
    default: false,
    type: Boolean
  },
  welcomeMessage: {
    default: "",
    type: String
  }
});

const emit = defineEmits(["cancel-turn", "edit-turn", "load-more", "open-source-file", "reload", "resend-turn"]);

const USER_MESSAGE_COLLAPSE_MIN_CHARACTERS = 360;
const USER_MESSAGE_PREVIEW_MAX_CHARACTERS = 280;
const USER_MESSAGE_PREVIEW_MAX_LINES = 4;
const DISPLAY_MESSAGE_CACHE_LIMIT = 500;
const bodyElement = ref(null);
const bottomElement = ref(null);
const expandedUserMessages = ref(new Set());
const followingLatest = ref(true);
const initialScrollSettled = ref(false);
const userScrollIntent = ref(false);
const displayMessageCache = new Map();
let liveScrollFrame = 0;
let userScrollIntentTimer = null;
let initialScrollVersion = 0;
let loadMoreScrollSnapshot = null;
let loadMoreRequestVersion = 0;
let pendingTailFollow = false;
const USER_SCROLL_INTENT_RESET_MS = 600;
const KEYBOARD_SCROLL_KEYS = new Set([
  " ",
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
  "Spacebar"
]);
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

function userMessagePreviewText(value = "") {
  const text = String(value || "");
  const characters = [...text];
  const lines = text.split(/\r\n?|\n/u);
  if (
    characters.length <= USER_MESSAGE_COLLAPSE_MIN_CHARACTERS &&
    lines.length <= USER_MESSAGE_PREVIEW_MAX_LINES
  ) {
    return "";
  }
  const firstLines = lines.slice(0, USER_MESSAGE_PREVIEW_MAX_LINES).join("\n");
  const preview = [...firstLines]
    .slice(0, USER_MESSAGE_PREVIEW_MAX_CHARACTERS)
    .join("")
    .trimEnd();
  return preview ? `${preview}…` : "";
}

function displayMessage(message = null, {
  allowNumberedQuestions = false,
  preserveParagraphLineBreaks = false,
  previewUserMessage = false
} = {}, cacheKey = "") {
  if (!message) {
    return null;
  }
  const normalizedCacheKey = String(cacheKey || "").trim();
  const cached = normalizedCacheKey ? displayMessageCache.get(normalizedCacheKey) : null;
  if (
    cached &&
    cached.allowNumberedQuestions === allowNumberedQuestions &&
    cached.attachments === message.attachments &&
    cached.at === message.at &&
    cached.messageId === message.messageId &&
    cached.preserveParagraphLineBreaks === preserveParagraphLineBreaks &&
    cached.previewUserMessage === previewUserMessage &&
    cached.role === message.role &&
    cached.text === message.text
  ) {
    return cached.value;
  }
  const questionInput = allowNumberedQuestions
    ? parseNumberedQuestionPrompt(message.text)
    : {
        intro: "",
        outro: "",
        questions: []
      };
  const hasQuestions = questionInput.questions.length > 0;
  const previewText = previewUserMessage ? userMessagePreviewText(message.text) : "";
  const value = {
    ...message,
    blocks: parseLongTextReviewBlocks(hasQuestions ? questionInput.intro : message.text, {
      preserveParagraphLineBreaks
    }),
    outroBlocks: parseLongTextReviewBlocks(hasQuestions ? questionInput.outro : "", {
      preserveParagraphLineBreaks
    }),
    previewBlocks: previewText
      ? parseLongTextReviewBlocks(previewText, { preserveParagraphLineBreaks: true })
      : null,
    questions: hasQuestions ? questionInput.questions : [],
    displayAt: displayTime(message.at)
  };
  if (normalizedCacheKey) {
    if (
      displayMessageCache.size >= DISPLAY_MESSAGE_CACHE_LIMIT &&
      !displayMessageCache.has(normalizedCacheKey)
    ) {
      displayMessageCache.delete(displayMessageCache.keys().next().value);
    }
    displayMessageCache.set(normalizedCacheKey, {
      allowNumberedQuestions,
      attachments: message.attachments,
      at: message.at,
      messageId: message.messageId,
      preserveParagraphLineBreaks,
      previewUserMessage,
      role: message.role,
      text: message.text,
      value
    });
  }
  return value;
}

function displayThinkingMessage(message = null) {
  if (!message) {
    return null;
  }
  const text = normalizeThinkingMessageText(message.text);
  if (!text) {
    return null;
  }
  return {
    ...message,
    text,
    displayAt: displayTime(message.at)
  };
}

function conversationAgentMessages(turn = {}) {
  if (Array.isArray(turn.messages)) {
    return turn.messages.filter((message) => (
      ["assistant", "commentary", "thinking"].includes(String(message?.role || "").trim())
    ));
  }
  return [
    ...(Array.isArray(turn.thinking) ? turn.thinking : []),
    ...(Array.isArray(turn.commentary) ? turn.commentary : []),
    turn.assistant
  ].filter(Boolean);
}

function conversationMessageKey(message = {}, index = 0) {
  return [
    String(message.messageId || "").trim(),
    String(message.role || "").trim(),
    String(message.at || "").trim(),
    index
  ].join(":");
}

function displayAgentTimeline(turn = {}, turnKey = "") {
  const timeline = [];
  for (const [index, message] of conversationAgentMessages(turn).entries()) {
    const role = String(message?.role || "").trim();
    if (role === "thinking") {
      const displayed = displayThinkingMessage(message);
      if (!displayed) {
        continue;
      }
      const keyedMessage = {
        ...displayed,
        key: conversationMessageKey(message, index)
      };
      const previous = timeline.at(-1);
      if (previous?.role === "thinking") {
        previous.messages.push(keyedMessage);
        continue;
      }
      timeline.push({
        key: `thinking:${keyedMessage.key}`,
        messages: [keyedMessage],
        role
      });
      continue;
    }
    timeline.push({
      key: conversationMessageKey(message, index),
      message: displayMessage(message, {
        allowNumberedQuestions: true
      }, `${turnKey}:agent:${conversationMessageKey(message, index)}`),
      role
    });
  }
  return timeline;
}

function handleLongTextLinkClick(payload = {}) {
  const target = sourceEditorLinkTarget({
    href: payload.href,
    sourceRoot: props.sourceRoot,
    text: payload.text
  });
  if (!target) {
    return;
  }
  payload.event?.preventDefault?.();
  emit("open-source-file", target);
}

const displayTurns = computed(() => (Array.isArray(props.turns) ? props.turns : [])
  .map((turn, index) => {
    const turnId = String(turn.turnId || index + 1);
    return {
      agentTimeline: displayAgentTimeline(turn, turnId),
      optimistic: turn.optimistic && typeof turn.optimistic === "object" && !Array.isArray(turn.optimistic)
        ? turn.optimistic
        : null,
      pending: turn.pending === true,
      system: displayMessage(turn.system, {}, `${turnId}:system`),
      turnId,
      user: displayMessage(turn.user, {
        preserveParagraphLineBreaks: true,
        previewUserMessage: true
      }, `${turnId}:user`)
    };
  })
  .filter((turn) => turn.system || turn.user || turn.agentTimeline.length));

function userMessageCollapsible(message = null) {
  return Array.isArray(message?.previewBlocks);
}

function userMessageExpanded(turn = {}) {
  return expandedUserMessages.value.has(String(turn.turnId || ""));
}

function toggleExpandedKey(expandedKeys, key) {
  const next = new Set(expandedKeys.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  expandedKeys.value = next;
}

function toggleUserMessage(turn = {}) {
  const key = String(turn.turnId || "");
  if (!key) {
    return;
  }
  toggleExpandedKey(expandedUserMessages, key);
}

const loadingIndicatorVisible = computed(() => Boolean(
  props.loading &&
  !displayTurns.value.length
));
const initialScrollPending = computed(() => Boolean(
  props.visible &&
  displayTurns.value.length &&
  !initialScrollSettled.value
));

function messageScrollKey(message = null) {
  if (!message) {
    return "empty";
  }
  return [
    message.messageId || "",
    message.role || "",
    message.at || "",
    String(message.text || "")
  ].join("/");
}

function agentTimelineScrollKey(timeline = []) {
  return (Array.isArray(timeline) ? timeline : []).map((entry) => (
    entry?.role === "thinking"
      ? (entry.messages || []).map(messageScrollKey).join("+")
      : messageScrollKey(entry?.message)
  )).join("|");
}

function latestRenderedTailScrollKey(turns = []) {
  const turn = Array.isArray(turns) ? turns.at(-1) : null;
  if (!turn) {
    return "";
  }
  const timeline = Array.isArray(turn.agentTimeline) ? turn.agentTimeline : [];
  return [
    turn.turnId,
    messageScrollKey(turn.system),
    messageScrollKey(turn.user),
    turn.optimistic?.id || "",
    turn.optimistic?.status || "",
    turn.optimistic?.error || "",
    turn.pending ? "pending" : "settled",
    agentTimelineScrollKey(timeline)
  ].join(":");
}

const timelineScrollTrigger = computed(() => [
  props.visible ? "visible" : "hidden",
  props.error ? "error" : "body",
  loadingIndicatorVisible.value ? "loading" : "ready",
  displayTurns.value.length ? "has-turns" : "empty",
  props.scrollKey
].join(":"));
const latestRenderedTailKey = computed(() => latestRenderedTailScrollKey(displayTurns.value));
const autoScrollEnabled = computed(() => Boolean(
  props.visible &&
  followingLatest.value
));

const {
  clearScheduledScrolls,
  scrollAfterLayout: scrollToLatestMessage,
  scrollNow: scrollToLatestMessageNow
} = useScrollToBottom({
  anchor: bottomElement,
  enabled: autoScrollEnabled,
  scrollAnchorIntoView: false,
  target: bodyElement
});

function clearUserScrollIntent() {
  if (userScrollIntentTimer && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
    window.clearTimeout(userScrollIntentTimer);
  }
  userScrollIntentTimer = null;
  userScrollIntent.value = false;
}

function resumePendingTailFollow() {
  const shouldResume = pendingTailFollow && followingLatest.value;
  pendingTailFollow = false;
  if (shouldResume) {
    queueLiveBottomScroll();
  }
}

function markUserScrollIntent() {
  userScrollIntent.value = true;
  clearLiveBottomScroll();
  clearScheduledScrolls();
  if (userScrollIntentTimer && typeof window !== "undefined" && typeof window.clearTimeout === "function") {
    window.clearTimeout(userScrollIntentTimer);
  }
  if (typeof window === "undefined" || typeof window.setTimeout !== "function") {
    return;
  }
  userScrollIntentTimer = window.setTimeout(() => {
    userScrollIntentTimer = null;
    userScrollIntent.value = false;
    resumePendingTailFollow();
  }, USER_SCROLL_INTENT_RESET_MS);
}

function markKeyboardScrollIntent(event = {}) {
  if (!KEYBOARD_SCROLL_KEYS.has(String(event.key || "")) || event.defaultPrevented) {
    return;
  }
  const target = event.target;
  const tagName = String(target?.tagName || "").toLowerCase();
  if (
    target?.isContentEditable ||
    ["input", "select", "textarea"].includes(tagName) ||
    ([" ", "Spacebar"].includes(event.key) && ["a", "button"].includes(tagName))
  ) {
    return;
  }
  markUserScrollIntent();
}

function scrollToLatestMessageAfterLayout({
  behavior = "auto",
  force = false
} = {}) {
  if (force) {
    followingLatest.value = true;
    clearUserScrollIntent();
  }
  return scrollToLatestMessage({
    behavior
  });
}

function queueInitialBottomScroll() {
  const version = initialScrollVersion + 1;
  initialScrollVersion = version;
  initialScrollSettled.value = false;
  void scrollToLatestMessageAfterLayout({
    behavior: "auto",
    force: true
  }).finally(() => {
    if (initialScrollVersion === version) {
      initialScrollSettled.value = true;
    }
  });
}

function queueLiveBottomScroll({
  force = false
} = {}) {
  if (userScrollIntent.value && !force) {
    pendingTailFollow = true;
    return;
  }
  if (force) {
    pendingTailFollow = false;
    followingLatest.value = true;
    clearUserScrollIntent();
  }
  if (liveScrollFrame) {
    return;
  }
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    void scrollToLatestMessageAfterLayout({ behavior: "auto" });
    return;
  }
  liveScrollFrame = window.requestAnimationFrame(() => {
    liveScrollFrame = 0;
    scrollToLatestMessageNow({ behavior: "auto" });
  });
}

function clearLiveBottomScroll() {
  if (
    liveScrollFrame &&
    typeof window !== "undefined" &&
    typeof window.cancelAnimationFrame === "function"
  ) {
    window.cancelAnimationFrame(liveScrollFrame);
  }
  liveScrollFrame = 0;
}

function updateLatestFollowFromScroll(event = {}) {
  const target = event?.currentTarget || bodyElement.value;
  const shouldFollow = scrollElementNearBottom(target);
  if (!shouldFollow && !userScrollIntent.value && followingLatest.value) {
    return;
  }
  followingLatest.value = shouldFollow;
  if (shouldFollow) {
    clearUserScrollIntent();
    resumePendingTailFollow();
    return;
  }
  if (!shouldFollow) {
    clearLiveBottomScroll();
    clearScheduledScrolls();
  }
}

function requestLoadMore() {
  if (!props.hasMoreBefore || props.loadingMore) {
    return;
  }
  followingLatest.value = false;
  pendingTailFollow = false;
  markUserScrollIntent();
  const element = bodyElement.value;
  const version = loadMoreRequestVersion + 1;
  loadMoreRequestVersion = version;
  loadMoreScrollSnapshot = element
    ? {
        scrollHeight: element.scrollHeight,
        scrollKey: props.scrollKey,
        scrollTop: element.scrollTop,
        version
      }
    : null;
  emit("load-more", {
    complete: ({ changed = false } = {}) => {
      void completeLoadMoreRequest(version, changed);
    }
  });
}

function clearLoadMoreScrollSnapshot() {
  loadMoreRequestVersion += 1;
  loadMoreScrollSnapshot = null;
}

async function completeLoadMoreRequest(version, changed) {
  const snapshot = loadMoreScrollSnapshot;
  if (!snapshot || snapshot.version !== version) {
    return;
  }
  if (!changed || snapshot.scrollKey !== props.scrollKey) {
    clearLoadMoreScrollSnapshot();
    return;
  }
  await nextTick();
  if (loadMoreScrollSnapshot?.version !== version) {
    return;
  }
  const element = bodyElement.value;
  if (element) {
    element.scrollTop = snapshot.scrollTop + (element.scrollHeight - snapshot.scrollHeight);
  }
  clearLoadMoreScrollSnapshot();
}

onBeforeUnmount(() => {
  clearLiveBottomScroll();
  clearUserScrollIntent();
  clearLoadMoreScrollSnapshot();
});

watch(() => [
  timelineScrollTrigger.value,
  latestRenderedTailKey.value
], ([timelineKey, value], [previousTimelineKey, previous] = []) => {
  if (timelineKey !== previousTimelineKey) {
    return;
  }
  if (!value || value === previous) {
    return;
  }
  queueLiveBottomScroll({
    force: false
  });
}, {
  flush: "post"
});

watch(() => [
  props.scrollKey,
  props.followLatestKey
], ([scrollKey, value], [previousScrollKey, previous] = []) => {
  if (scrollKey !== previousScrollKey || value === previous) {
    return;
  }
  queueLiveBottomScroll({
    force: true
  });
}, {
  flush: "post"
});

watch(timelineScrollTrigger, () => {
  clearLoadMoreScrollSnapshot();
  queueInitialBottomScroll();
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

.studio-conversation-log__loading-skeleton {
  inset: 0;
  overflow: hidden;
  position: absolute;
  z-index: 1;
}

.studio-conversation-log__settling {
  background: rgb(var(--v-theme-surface));
  inset: 0;
  overflow: hidden;
  padding: 0.5rem;
  position: absolute;
  z-index: 1;
}

.studio-conversation-log__settling-skeleton {
  height: 100%;
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

.studio-conversation-log__welcome {
  background: rgba(var(--v-theme-primary), 0.08);
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 16px;
  color: rgb(var(--v-theme-on-surface));
  display: grid;
  flex: 0 0 auto;
  gap: 0.55rem;
  margin: 0.1rem 0.15rem 0;
  padding: 0.8rem 0.9rem 0.9rem;
}

.studio-conversation-log__welcome p {
  line-height: 1.48;
  margin: 0;
}

.studio-conversation-log__body--settling {
  visibility: hidden;
}

.studio-conversation-log__load-more {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.35rem 0 0.55rem;
}

.studio-conversation-log__load-more-error {
  color: rgb(var(--v-theme-error));
  font-size: 0.76rem;
  line-height: 1.3;
  text-align: center;
}

.studio-conversation-log__load-more + .studio-conversation-log__turn,
.studio-conversation-log__body > .studio-conversation-log__turn:first-child {
  margin-top: auto;
}

.studio-conversation-log__turn {
  contain-intrinsic-block-size: auto 12rem;
  content-visibility: auto;
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

.studio-conversation-log--task {
  border-color: rgba(126, 87, 194, 0.32);
}

.studio-conversation-log--task .studio-conversation-log__avatar--assistant {
  background: #7e57c2;
}

.studio-conversation-log--task .studio-conversation-log__message--user {
  background: #eee8f8;
  color: #2d2440;
}

.studio-conversation-log__thinking {
  justify-self: start;
  margin-left: 2.15rem;
  max-width: min(34rem, 86%);
}

.studio-conversation-log__user-content-toggle {
  background: transparent;
  border: 0;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  font: inherit;
  text-align: left;
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

.studio-conversation-log__message--assistant :deep(.studio-long-text-review__paragraph),
.studio-conversation-log__message--user :deep(.studio-long-text-review__paragraph) {
  font-size: 0.94rem;
  margin-block: 0;
}

.studio-conversation-log__message--user :deep(.studio-long-text-review__paragraph) {
  white-space: pre-wrap;
}

.studio-conversation-log__user-content {
  min-width: 0;
}

.studio-conversation-log__user-content-toggle {
  align-self: flex-start;
  font-size: 0.78rem;
  font-weight: 650;
  padding: 0;
}

.studio-conversation-log__user-content-toggle:hover,
.studio-conversation-log__user-content-toggle:focus-visible {
  text-decoration: underline;
}

.studio-conversation-log__message--assistant :deep(.studio-long-text-review__paragraph code),
.studio-conversation-log__message--assistant :deep(.studio-long-text-review__list li > code),
.studio-conversation-log__message--assistant :deep(.studio-long-text-review__table th > code),
.studio-conversation-log__message--assistant :deep(.studio-long-text-review__table td > code),
.studio-conversation-log__message--assistant :deep(.studio-long-text-review__details-summary code),
.studio-conversation-log__message--user :deep(.studio-long-text-review__paragraph code),
.studio-conversation-log__message--user :deep(.studio-long-text-review__list li > code),
.studio-conversation-log__message--user :deep(.studio-long-text-review__table th > code),
.studio-conversation-log__message--user :deep(.studio-long-text-review__table td > code),
.studio-conversation-log__message--user :deep(.studio-long-text-review__details-summary code) {
  background: rgba(var(--v-theme-primary), 0.07);
  border: 1px solid rgba(var(--v-theme-primary), 0.14);
  border-radius: 3px;
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.9em;
  padding: 0.02rem 0.2rem;
}

.studio-conversation-log__questions {
  box-sizing: border-box;
  display: grid;
  gap: 0.2rem;
  list-style: none;
  margin: 0;
  max-width: 100%;
  min-width: 0;
  padding: 0;
}

.studio-conversation-log__question {
  align-items: start;
  background: rgba(var(--v-theme-surface), 0.62);
  border: 1px solid rgba(var(--v-theme-outline), 0.2);
  border-radius: 8px;
  box-sizing: border-box;
  display: grid;
  gap: 0.32rem;
  grid-template-columns: auto minmax(0, 1fr);
  max-width: 100%;
  min-width: 0;
  padding: 0.28rem 0.42rem;
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
  max-width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
}

.studio-conversation-log__question-content {
  display: block;
  min-width: 0;
}

.studio-conversation-log__question-choices {
  color: rgba(var(--v-theme-on-surface), 0.72);
  display: inline;
  font-size: 0.8rem;
  margin: 0;
  padding: 0;
}

.studio-conversation-log__question-choices::before {
  content: " · ";
}

.studio-conversation-log__question-choices li {
  display: inline;
  overflow-wrap: anywhere;
}

.studio-conversation-log__question-choices li + li::before {
  content: " · ";
}

.studio-conversation-log__bottom {
  height: 1px;
}
</style>
