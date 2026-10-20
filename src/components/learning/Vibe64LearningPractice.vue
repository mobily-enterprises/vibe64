<script setup>
import { computed, toValue } from "vue";
import { useRouter } from "vue-router";
import { mdiDeleteOutline } from "@mdi/js";
import { projectAppPath } from "@/lib/vibe64ProjectScope.js";
import { useVibe64PracticeProjects } from "@/composables/useVibe64PracticeProjects.js";

// L's Practice section: the learner's own practice projects, from L's
// learning.read (attempts with a practice slug). It needs no project listing,
// so it works in single-project local mode, where the project picker is not
// served. Open minimises L (its place is kept); delete is one click (D-b), the
// command's snackbar reports it. The Training actions re-authorize both.
const props = defineProps({
  learning: { type: Object, required: true },
  courses: { type: Object, required: true }
});
const router = useRouter();
const practice = useVibe64PracticeProjects({ enabled: computed(() => Boolean(props.learning.state.open)),
  learningResource: props.courses.learningResource, coursesResource: props.courses.coursesResource });
const projects = computed(() => practice.practiceProjects.value);
const deleting = computed(() => toValue(practice.deletingSlug));

function openProject(slug) {
  props.learning.minimise();
  void router?.push(projectAppPath(slug));
}
</script>

<template>
  <section v-if="projects.length" class="vibe64-learning-practice" aria-labelledby="vibe64-learning-practice-title"
    data-test="learning-practice">
    <h2 id="vibe64-learning-practice-title" class="vibe64-learning-practice__title">Practice</h2>
    <p class="vibe64-learning-practice__intro">Your practice projects from lessons. Deleting one removes it for good.</p>
    <v-alert v-if="practice.deleteError.value" type="error" variant="tonal" density="compact"
      class="vibe64-learning-practice__error" data-test="learning-practice-error">{{ practice.deleteError.value }}</v-alert>
    <ul class="vibe64-learning-practice__list">
      <li v-for="project in projects" :key="project.slug" class="vibe64-learning-practice__row" :data-practice-slug="project.slug">
        <button type="button" class="vibe64-learning-practice__open" :disabled="Boolean(deleting)"
          :aria-label="`Open ${project.name}`" @click="openProject(project.slug)">
          <span class="vibe64-learning-practice__name">{{ project.name }}</span>
          <span class="vibe64-learning-practice__slug">{{ project.slug }}</span>
        </button>
        <v-btn v-if="project.mine && project.deleteAvailable && project.attemptId" variant="text" :icon="mdiDeleteOutline"
          min-width="48" min-height="48" :aria-label="`Delete ${project.name}`"
          :title="`Delete ${project.name}`" :disabled="Boolean(deleting)" :loading="deleting === project.slug"
          @click="practice.deletePracticeProject(project)" />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.vibe64-learning-practice {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  margin: var(--v64-space-4, 16px) auto 0;
  max-width: 48rem;
  padding: var(--v64-space-4, 16px);
}
.vibe64-learning-practice__title { font: var(--v64-type-title-md, 600 1.125rem/1.5rem system-ui, sans-serif); margin: 0 0 4px; }
.vibe64-learning-practice__intro { color: rgba(var(--v-theme-on-background), 0.72); font-size: 0.875rem; margin: 0 0 var(--v64-space-2, 8px); }
.vibe64-learning-practice__error { margin-bottom: var(--v64-space-2, 8px); }
.vibe64-learning-practice__list { display: flex; flex-direction: column; gap: 4px; list-style: none; margin: 0; padding: 0; }
.vibe64-learning-practice__row { align-items: center; display: flex; gap: var(--v64-space-2, 8px); min-width: 0; }
.vibe64-learning-practice__open {
  background: transparent;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: var(--v64-shape-md, 12px);
  color: inherit;
  cursor: pointer;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 48px;
  min-width: 0;
  padding: 6px var(--v64-space-3, 12px);
  text-align: left;
}
.vibe64-learning-practice__open:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.vibe64-learning-practice__open:disabled { cursor: default; opacity: 0.6; }
.vibe64-learning-practice__name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vibe64-learning-practice__slug { color: rgba(var(--v-theme-on-background), 0.72); font-size: 0.8125rem; overflow-wrap: anywhere; }
</style>
