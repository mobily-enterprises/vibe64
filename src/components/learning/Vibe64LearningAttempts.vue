<script setup>
import { computed, onMounted, ref } from "vue";
import { mdiDeleteOutline } from "@mdi/js";

// Courses → In progress (the one lesson in progress: Open, Restart, Delete)
// and Courses → Archived (finished and archived lessons: Delete). The rows
// come from practice.list through the shared controller; every change is a
// Training action. Restarting and deleting ask once more in the row; until the
// first practice.list read answers, the section shows a loader.
const props = defineProps({
  learning: { type: Object, required: true },
  archived: Boolean
});
const practice = computed(() => props.learning.practice);
const current = computed(() => practice.value.current);
const busy = computed(() => props.learning.state.busy);
const confirming = ref("");
onMounted(() => { void props.learning.readPractice(); });

const dateLabel = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};
async function confirmThen(key, action) {
  if (confirming.value !== key) {
    confirming.value = key;
    return;
  }
  confirming.value = "";
  await action();
}
</script>

<template>
  <section class="vibe64-learning-attempts" :aria-labelledby="`vibe64-learning-attempts-${archived ? 'archived' : 'progress'}`"
    :data-test="archived ? 'learning-archived' : 'learning-progress'">
    <h2 :id="`vibe64-learning-attempts-${archived ? 'archived' : 'progress'}`" class="vibe64-learning-attempts__title">
      {{ archived ? "Archived" : "In progress" }}
    </h2>
    <p class="vibe64-learning-attempts__intro">
      {{ archived
        ? "Lessons you finished or archived, each with its practice project and conversation."
        : "Your lesson in progress. It stays paused, with its practice project and conversation, until you finish, restart or delete it." }}
    </p>
    <v-alert v-if="learning.state.error" type="error" variant="tonal" density="compact" class="vibe64-learning-attempts__error"
      data-test="learning-attempts-error">{{ learning.state.error }}</v-alert>

    <div v-if="!practice.loaded && !learning.state.error" class="vibe64-learning-attempts__loading" role="status"
      data-test="learning-attempts-loading">
      <v-progress-circular indeterminate size="20" width="2" color="primary" />{{ archived ? "Loading archived lessons…" : "Loading your lesson…" }}
    </div>
    <template v-else-if="!archived">
      <p v-if="practice.loaded && !current" class="vibe64-learning-attempts__empty" data-test="learning-progress-empty">
        No lesson in progress. Start one from Courses.
      </p>
      <div v-else-if="current" class="vibe64-learning-attempts__row" :data-attempt-id="current.attemptId">
        <div class="vibe64-learning-attempts__text">
          <span class="vibe64-learning-attempts__name">{{ current.name }}</span>
          <span class="vibe64-learning-attempts__status">
            {{ current.status === "deleting" ? "Being deleted" : current.projectName || "No practice project" }}
          </span>
        </div>
        <template v-if="current.status !== 'deleting'">
          <v-btn variant="flat" color="primary" rounded="pill" min-height="48" :disabled="Boolean(busy)"
            data-test="learning-progress-open" @click="learning.openCurrent()">Open</v-btn>
          <v-btn :variant="confirming === 'restart' ? 'flat' : 'tonal'" :color="confirming === 'restart' ? 'warning' : undefined"
            rounded="pill" min-height="48" :disabled="Boolean(busy)" :loading="busy === 'restart'"
            title="Archive this attempt and start the lesson again" data-test="learning-progress-restart"
            @click="confirmThen('restart', () => learning.restart())">{{ confirming === "restart" ? "Archive and restart" : "Restart" }}</v-btn>
        </template>
        <v-btn :variant="confirming === 'current' ? 'flat' : 'text'" :color="confirming === 'current' ? 'error' : undefined"
          rounded="pill" min-height="48" :disabled="Boolean(busy)" :loading="busy === 'delete'"
          :title="`Delete ${current.name}, its practice project and its conversation`" data-test="learning-progress-delete"
          @click="confirmThen('current', () => learning.deleteAttempt())">{{ confirming === "current" ? "Delete for good" : "Delete" }}</v-btn>
      </div>
    </template>

    <template v-else>
      <p v-if="practice.loaded && !practice.archived.length" class="vibe64-learning-attempts__empty" data-test="learning-archived-empty">
        Nothing archived yet.
      </p>
      <ul v-else class="vibe64-learning-attempts__list">
        <li v-for="entry in practice.archived" :key="entry.attemptId" class="vibe64-learning-attempts__row" :data-attempt-id="entry.attemptId">
          <div class="vibe64-learning-attempts__text">
            <span class="vibe64-learning-attempts__name">{{ entry.name }}</span>
            <span class="vibe64-learning-attempts__status">
              {{ entry.reason === "finished" ? "Finished" : "Archived" }} {{ dateLabel(entry.archivedAt) }}{{ entry.hasProject ? " · with practice project" : "" }}
            </span>
          </div>
          <v-btn v-if="confirming === entry.attemptId" variant="flat" color="error" rounded="pill" min-height="48"
            :disabled="Boolean(busy)" data-test="learning-archived-delete-confirm" @click="confirmThen(entry.attemptId, () => learning.deleteArchived(entry.attemptId))">Delete for good</v-btn>
          <v-btn v-else variant="text" :icon="mdiDeleteOutline" min-width="48" min-height="48" :aria-label="`Delete archived ${entry.name}`"
            :title="`Delete archived ${entry.name}`" :disabled="Boolean(busy)" :loading="busy === `archive-delete:${entry.attemptId}`"
            data-test="learning-archived-delete" @click="confirmThen(entry.attemptId, () => learning.deleteArchived(entry.attemptId))" />
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.vibe64-learning-attempts { margin: 0 auto; max-width: 48rem; padding: var(--v64-space-4, 16px); }
.vibe64-learning-attempts__title { font: var(--v64-type-title-lg, 600 1.375rem/1.75rem system-ui, sans-serif); margin: 0 0 4px; }
.vibe64-learning-attempts__intro, .vibe64-learning-attempts__empty { color: var(--v64-on-surface-variant, inherit); font-size: 0.875rem; margin: 0 0 var(--v64-space-3, 12px); }
.vibe64-learning-attempts__loading { align-items: center; color: var(--v64-on-surface-variant, inherit); display: flex; font-size: 0.875rem; gap: var(--v64-space-2, 8px); min-height: 48px; }
.vibe64-learning-attempts__error { margin-bottom: var(--v64-space-2, 8px); }
.vibe64-learning-attempts__list { display: flex; flex-direction: column; gap: var(--v64-space-2, 8px); list-style: none; margin: 0; padding: 0; }
.vibe64-learning-attempts__row {
  align-items: center;
  border: 1px solid var(--v64-outline-variant, rgba(0, 0, 0, 0.12));
  border-radius: var(--v64-shape-md, 12px);
  display: flex;
  flex-wrap: wrap;
  gap: var(--v64-space-2, 8px);
  min-width: 0;
  padding: 4px 4px 4px var(--v64-space-3, 12px);
}
.vibe64-learning-attempts__text { display: flex; flex: 1 1 12rem; flex-direction: column; min-width: 0; }
.vibe64-learning-attempts__name { font-weight: 600; overflow-wrap: anywhere; }
.vibe64-learning-attempts__status { color: var(--v64-on-surface-variant, inherit); font-size: 0.8125rem; }
.vibe64-learning-attempts .v-btn { letter-spacing: 0; text-transform: none; }
</style>
