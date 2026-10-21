<script setup>
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import Vibe64LearningReader from "./Vibe64LearningReader.vue";

// The Lesson pane of the Learn page: the current lesson's reader, beside
// Colleague. It is the project page's Lesson tab on the lesson's practice
// project, and the whole main area of a lesson without one. Both hosts render it.
defineProps({
  // The pane is on screen (the reader restores its scroll place when shown).
  visible: { type: Boolean, default: true }
});
const learning = useVibe64Learning();
</script>

<template>
  <section v-if="learning" class="vibe64-learning-lesson-pane" aria-label="Lesson" data-test="learning-lesson-pane" data-vibe64-guide-pane="lesson">
    <Vibe64LearningReader :learning="learning" :visible="visible" @return="learning.openLesson()" />
  </section>
</template>

<style scoped>
.vibe64-learning-lesson-pane {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
</style>
