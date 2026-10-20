<script setup>
import { computed } from "vue";
import { useRouter } from "vue-router";
import { mdiArchiveArrowDownOutline, mdiDeleteOutline } from "@mdi/js";
import { projectAppPath } from "@/lib/vibe64ProjectScope.js";
import { useVibe64PracticeProjects } from "@/composables/useVibe64PracticeProjects.js";

// L's Practice tab: the learner's practice projects in the learning space
// (practice.list), the same on both hosts. Open continues the project's lesson
// (learning mode on), then shows the project with L minimised on the current
// step. Archive and Delete are one click each; archived projects keep their
// lesson title and date and can be deleted.
const props = defineProps({
  learning: { type: Object, required: true },
  // The saved learning revision, required by practice.open.
  learningRevision: { type: Number, default: null }
});
const router = useRouter();
const practice = useVibe64PracticeProjects({ enabled: computed(() => Boolean(props.learning.state.open)) });
const busy = computed(() => practice.busy.value);
const dateLabel = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

async function openProject(project) {
  const attemptId = (await practice.open(project, { expectedRevision: props.learningRevision }))?.attempt?.attemptId;
  if (!attemptId) return;
  await props.learning.readLearningMode();
  await props.learning.show({ surface: "lesson", attemptId });
  props.learning.minimise();
  void router?.push(projectAppPath(project.slug));
}
</script>

<template>
  <section class="vibe64-learning-practice" aria-labelledby="vibe64-learning-practice-title" data-test="learning-practice">
    <h2 id="vibe64-learning-practice-title" class="vibe64-learning-practice__title">Practice projects</h2>
    <p class="vibe64-learning-practice__intro">
      Projects your lessons created. They live apart from your own projects. Open one to continue its lesson.
    </p>
    <v-alert v-if="practice.error.value || practice.loadError.value" type="error" variant="tonal" density="compact"
      class="vibe64-learning-practice__error" data-test="learning-practice-error">{{ practice.error.value || practice.loadError.value }}</v-alert>
    <p v-if="practice.loaded.value && !practice.projects.value.length && !practice.archived.value.length"
      class="vibe64-learning-practice__empty" data-test="learning-practice-empty">
      No practice projects yet. Starting a lesson with an exercise creates one.
    </p>
    <ul v-if="practice.projects.value.length" class="vibe64-learning-practice__list">
      <li v-for="project in practice.projects.value" :key="project.practiceId" class="vibe64-learning-practice__row"
        :data-practice-id="project.practiceId">
        <div class="vibe64-learning-practice__text">
          <span class="vibe64-learning-practice__name">{{ project.name }}</span>
          <span class="vibe64-learning-practice__status">{{ project.statusLabel }}</span>
        </div>
        <template v-if="project.status !== 'deleting'">
          <v-btn variant="tonal" rounded="pill" min-height="48" :disabled="Boolean(busy) || learningRevision === null"
            :loading="busy === `open:${project.practiceId}`" data-test="learning-practice-open" @click="openProject(project)">Open</v-btn>
          <v-btn variant="text" :icon="mdiArchiveArrowDownOutline" min-width="48" min-height="48" :aria-label="`Archive ${project.name}`"
            :title="`Archive ${project.name}`" :disabled="Boolean(busy)" :loading="busy === `archive:${project.practiceId}`"
            data-test="learning-practice-archive" @click="practice.archive(project)" />
        </template>
        <v-btn variant="text" :icon="mdiDeleteOutline" min-width="48" min-height="48" :aria-label="`Delete ${project.name}`"
          :title="`Delete ${project.name}`" :disabled="Boolean(busy)" :loading="busy === `delete:${project.practiceId}`"
          data-test="learning-practice-delete" @click="practice.remove(project)" />
      </li>
    </ul>
    <template v-if="practice.archived.value.length">
      <h3 class="vibe64-learning-practice__subtitle">Archived</h3>
      <ul class="vibe64-learning-practice__list" data-test="learning-practice-archived">
        <li v-for="entry in practice.archived.value" :key="`${entry.practiceId}:${entry.archiveId}`" class="vibe64-learning-practice__row">
          <div class="vibe64-learning-practice__text">
            <span class="vibe64-learning-practice__name">{{ entry.name }}</span>
            <span class="vibe64-learning-practice__status">Archived {{ dateLabel(entry.archivedAt) }}</span>
          </div>
          <v-btn variant="text" :icon="mdiDeleteOutline" min-width="48" min-height="48" :aria-label="`Delete archived ${entry.name}`"
            :title="`Delete archived ${entry.name}`" :disabled="Boolean(busy)"
            :loading="busy === `archive-delete:${entry.practiceId}:${entry.archiveId}`"
            data-test="learning-practice-archive-delete" @click="practice.removeArchive(entry)" />
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.vibe64-learning-practice { margin: 0 auto; max-width: 48rem; padding: var(--v64-space-4, 16px); }
.vibe64-learning-practice__title { font: var(--v64-type-title-lg, 600 1.375rem/1.75rem system-ui, sans-serif); margin: 0 0 4px; }
.vibe64-learning-practice__subtitle { font: var(--v64-type-title-md, 600 1.125rem/1.5rem system-ui, sans-serif); margin: var(--v64-space-5, 24px) 0 var(--v64-space-2, 8px); }
.vibe64-learning-practice__intro, .vibe64-learning-practice__empty { color: var(--v64-on-surface-variant, inherit); font-size: 0.875rem; margin: 0 0 var(--v64-space-3, 12px); }
.vibe64-learning-practice__error { margin-bottom: var(--v64-space-2, 8px); }
.vibe64-learning-practice__list { display: flex; flex-direction: column; gap: var(--v64-space-2, 8px); list-style: none; margin: 0; padding: 0; }
.vibe64-learning-practice__row {
  align-items: center;
  border: 1px solid var(--v64-outline-variant, rgba(0, 0, 0, 0.12));
  border-radius: var(--v64-shape-md, 12px);
  display: flex;
  gap: var(--v64-space-2, 8px);
  min-width: 0;
  padding: 4px 4px 4px var(--v64-space-3, 12px);
}
.vibe64-learning-practice__text { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; }
.vibe64-learning-practice__name { font-weight: 600; overflow-wrap: anywhere; }
.vibe64-learning-practice__status { color: var(--v64-on-surface-variant, inherit); font-size: 0.8125rem; }
.vibe64-learning-practice .v-btn { letter-spacing: 0; text-transform: none; }
</style>
