<script setup>
import { mdiChevronUp, mdiSchoolOutline } from "@mdi/js";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import Vibe64LearningLessonPane from "./Vibe64LearningLessonPane.vue";

// The lesson as a sheet over a practice project's Preview or Dash while the
// Lesson toggle is on. What it covers stays mounted underneath (the Preview
// keeps running, unreloaded); Hide lesson here, the toggle, or choosing
// Preview or Dash uncovers it.
const learning = useVibe64Learning();
</script>

<template>
  <div v-if="learning" class="vibe64-lesson-sheet" data-test="lesson-sheet">
    <header class="vibe64-lesson-sheet__header">
      <v-icon :icon="mdiSchoolOutline" size="18" />
      <span class="vibe64-lesson-sheet__title">Lesson</span>
      <v-btn
        class="vibe64-lesson-sheet__hide" variant="tonal" rounded="pill" size="small" min-height="32"
        :prepend-icon="mdiChevronUp" data-test="lesson-sheet-hide" @click="learning.hideLesson()"
      >
        Hide lesson
      </v-btn>
    </header>
    <Vibe64LearningLessonPane class="vibe64-lesson-sheet__pane" />
  </div>
</template>

<style scoped>
.vibe64-lesson-sheet {
  background: var(--v64-learning-container, rgb(var(--v-theme-surface)));
  border: 1px solid var(--v64-learning-strong, #f5c518);
  border-radius: var(--v64-shape-md, 12px);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.22);
  display: flex;
  flex-direction: column;
  inset: 0;
  min-height: 0;
  overflow: hidden;
  position: absolute;
  z-index: 3;
}
.vibe64-lesson-sheet__header {
  align-items: center;
  border-bottom: 1px solid var(--v64-learning-strong, #f5c518);
  color: var(--v64-on-learning-container, inherit);
  display: flex;
  flex: 0 0 auto;
  gap: var(--v64-space-2, 8px);
  min-height: 44px;
  padding: 4px 8px 4px 12px;
}
.vibe64-lesson-sheet__title { flex: 1 1 auto; font-weight: 700; }
.vibe64-lesson-sheet__hide { letter-spacing: 0; text-transform: none; }
.vibe64-lesson-sheet__pane { flex: 1 1 auto; height: auto; }
</style>
