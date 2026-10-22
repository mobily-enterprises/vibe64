<script setup>
import { computed, onBeforeUnmount, onMounted } from "vue";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import { useVibe64LearningCourses } from "@/composables/useVibe64LearningCourses.js";
import Vibe64LearningFinished from "./Vibe64LearningFinished.vue";
import Vibe64LearningReader from "./Vibe64LearningReader.vue";

// The Lesson pane of the Learn page: the current lesson's reader, or its
// "Lesson finished" screen, beside Colleague. On the lesson's practice project
// the step bar's Lesson button shows it in the project pane; it is the whole
// main area of a lesson without one. Both hosts render it. Its Learning yellow
// surface says "this is about learning", apart from the project's own panes.
const props = defineProps({
  // The pane is on screen (the reader restores its scroll place when shown).
  visible: { type: Boolean, default: true }
});
const learning = useVibe64Learning();
const finished = computed(() => Boolean(learning?.state.finished && learning.lesson.value));
// The Finished screen's next lesson and its start (requests only while it shows).
const courses = useVibe64LearningCourses({ active: computed(() => props.visible && finished.value) });

// The reader's place is saved when the pane goes away or the page is left.
const flush = () => learning?.flushReader();
onMounted(() => globalThis.addEventListener?.("pagehide", flush));
onBeforeUnmount(() => {
  globalThis.removeEventListener?.("pagehide", flush);
  flush();
});
</script>

<template>
  <section v-if="learning" class="vibe64-learning-lesson-pane" aria-label="Lesson" data-test="learning-lesson-pane" data-vibe64-guide-pane="lesson">
    <div v-if="finished" class="vibe64-learning-lesson-pane__scroll">
      <Vibe64LearningFinished :learning="learning" :courses="courses" />
    </div>
    <Vibe64LearningReader v-else :learning="learning" :visible="visible" @return="learning.openLesson()" />
  </section>
</template>

<style scoped>
.vibe64-learning-lesson-pane {
  background: var(--v64-learning-container, rgb(var(--v-theme-surface)));
  color: rgb(var(--v-theme-on-surface));
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.vibe64-learning-lesson-pane__scroll { height: 100%; overflow-y: auto; }
</style>
