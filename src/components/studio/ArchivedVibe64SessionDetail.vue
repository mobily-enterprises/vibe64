<template>
  <v-sheet
    v-if="session"
    class="studio-archived-session-detail"
    rounded="lg"
    border
  >
    <div class="studio-archived-session-detail__header">
      <div class="studio-archived-session-detail__title">
        <v-icon :icon="archiveIcon" size="20" />
        <div>
          <h2>Archived session {{ shortSessionId(session.sessionId) }}</h2>
          <p>Read-only history. Source restore is not available from archived sessions.</p>
        </div>
      </div>
      <v-btn
        v-if="backTo"
        class="studio-archived-session-detail__back"
        :prepend-icon="mdiArrowLeft"
        size="small"
        :to="backTo"
        variant="tonal"
      >
        Back to sessions
      </v-btn>
    </div>

    <div class="studio-archived-session-detail__grid">
      <section class="studio-archived-session-detail__section">
        <h3>Facts</h3>
        <dl class="studio-archived-session-detail__fact-list">
          <div
            v-for="fact in archiveFactRows(session)"
            :key="fact.label"
            class="studio-archived-session-detail__fact-row"
          >
            <dt>
              <v-icon :icon="fact.icon" size="16" />
              <span>{{ fact.label }}</span>
            </dt>
            <dd>{{ fact.value }}</dd>
          </div>
        </dl>
      </section>

      <section class="studio-archived-session-detail__section">
        <h3>Completed Steps</h3>
        <ol v-if="completedStepRows(session).length" class="studio-archived-session-detail__step-list">
          <li
            v-for="step in completedStepRows(session)"
            :key="step.id"
          >
            <span>{{ step.label }}</span>
            <small v-if="step.message">{{ step.message }}</small>
          </li>
        </ol>
        <p v-else class="studio-archived-session-detail__muted">No completed steps were recorded.</p>
      </section>
    </div>

    <section v-if="session.finalReportText" class="studio-archived-session-detail__section">
      <h3>Final Report</h3>
      <pre class="studio-archived-session-detail__report">{{ session.finalReportText }}</pre>
    </section>

    <section class="studio-archived-session-detail__section studio-archived-session-detail__conversation">
      <h3>Conversation</h3>
      <Vibe64ConversationLog
        :error="conversationError"
        :has-more-before="conversationHasMoreBefore"
        :loading="conversationLoading"
        :loading-more="conversationLoadingMore"
        :load-more-error="conversationLoadMoreError"
        :reloadable="true"
        :reloading="conversationLoading"
        :source-root="session.source || ''"
        :turns="conversationTurns"
        :visible="true"
        @load-more="conversationLog.loadMore"
        @reload="conversationLog.reload"
      />
      <p
        v-if="!conversationLoading && !conversationError && conversationTurns.length < 1"
        class="studio-archived-session-detail__muted"
      >
        No conversation messages were recorded for this archive.
      </p>
    </section>
  </v-sheet>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiArchiveCancelOutline,
  mdiArrowLeft,
  mdiCheckCircle
} from "@mdi/js";
import Vibe64ConversationLog from "@/components/studio/vibe64-session/Vibe64ConversationLog.vue";
import {
  archiveFactRows,
  completedStepRows,
  shortSessionId
} from "@/composables/useArchivedVibe64Sessions.js";

const props = defineProps({
  archive: {
    default: "completed",
    type: String
  },
  backTo: {
    default: null,
    type: [Object, String]
  },
  conversationLog: {
    default: () => ({}),
    type: Object
  },
  session: {
    default: null,
    type: Object
  }
});

const archiveIcon = computed(() => {
  return props.archive === "abandoned" ? mdiArchiveCancelOutline : mdiCheckCircle;
});
const conversationTurns = computed(() => (
  Array.isArray(props.conversationLog?.turns) ? props.conversationLog.turns : []
));
const conversationError = computed(() => String(props.conversationLog?.error || ""));
const conversationLoadMoreError = computed(() => String(props.conversationLog?.loadMoreError || ""));
const conversationHasMoreBefore = computed(() => Boolean(props.conversationLog?.hasMoreBefore));
const conversationLoading = computed(() => Boolean(props.conversationLog?.loading));
const conversationLoadingMore = computed(() => Boolean(props.conversationLog?.loadingMore));
</script>

<style scoped>
.studio-archived-session-detail {
  display: grid;
  gap: 1rem;
  padding: 1rem;
}

.studio-archived-session-detail__header {
  align-items: flex-start;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.22);
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  padding-bottom: 0.8rem;
}

.studio-archived-session-detail__title {
  align-items: flex-start;
  display: flex;
  gap: 0.6rem;
  min-width: 0;
}

.studio-archived-session-detail__title h2 {
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.2;
  margin: 0;
}

.studio-archived-session-detail__title p,
.studio-archived-session-detail__muted {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.86rem;
  margin: 0;
}

.studio-archived-session-detail__back {
  flex: 0 0 auto;
  min-height: 40px;
}

.studio-archived-session-detail__grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.studio-archived-session-detail__section {
  display: grid;
  gap: 0.6rem;
  min-width: 0;
}

.studio-archived-session-detail__section h3 {
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.2;
  margin: 0;
}

.studio-archived-session-detail__fact-list {
  display: grid;
  gap: 0.45rem;
  margin: 0;
}

.studio-archived-session-detail__fact-row {
  align-items: start;
  display: grid;
  gap: 0.5rem;
  grid-template-columns: minmax(7rem, max-content) minmax(0, 1fr);
}

.studio-archived-session-detail__fact-row dt {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.68);
  display: inline-flex;
  font-size: 0.82rem;
  gap: 0.3rem;
  min-width: 0;
}

.studio-archived-session-detail__fact-row dd {
  color: rgba(var(--v-theme-on-surface), 0.84);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.8rem;
  margin: 0;
  overflow-wrap: anywhere;
}

.studio-archived-session-detail__step-list {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding-left: 1.2rem;
}

.studio-archived-session-detail__step-list li {
  color: rgba(var(--v-theme-on-surface), 0.84);
  font-size: 0.86rem;
}

.studio-archived-session-detail__step-list small {
  color: rgba(var(--v-theme-on-surface), 0.62);
  display: block;
  font-size: 0.78rem;
}

.studio-archived-session-detail__report {
  background: rgba(var(--v-theme-surface-variant), 0.32);
  border: 1px solid rgba(var(--v-border-color), 0.22);
  border-radius: 6px;
  color: rgb(var(--v-theme-on-surface));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.82rem;
  line-height: 1.42;
  margin: 0;
  max-height: 28rem;
  overflow: auto;
  padding: 0.75rem;
  white-space: pre-wrap;
}

.studio-archived-session-detail__conversation {
  border-top: 1px solid rgba(var(--v-border-color), 0.22);
  padding-top: 0.9rem;
}

.studio-archived-session-detail__conversation :deep(.studio-conversation-log__body) {
  max-height: min(34rem, 70vh);
  min-height: 12rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

@media (max-width: 720px) {
  .studio-archived-session-detail__grid {
    grid-template-columns: 1fr;
  }

  .studio-archived-session-detail__fact-row {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .studio-archived-session-detail__header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
