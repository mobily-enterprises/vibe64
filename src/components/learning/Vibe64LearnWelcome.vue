<script setup>
import { mdiSchoolOutline } from "@mdi/js";
import Vibe64LearnerIllustration from "@/components/learning/Vibe64LearnerIllustration.vue";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";

// Learn mode's welcome with no lesson in progress: the learner illustration,
// a headline and Choose a lesson, which opens Courses on its lesson picker.
const learning = useVibe64Learning();
</script>

<template>
  <div class="vibe64-learn-welcome" data-test="learn-welcome">
    <Vibe64LearnerIllustration />
    <h2 class="vibe64-learn-welcome__title">Ready to learn something new?</h2>
    <p class="vibe64-learn-welcome__text">
      Pick a lesson and Vibe64 sets up a practice project for you, with a
      teacher beside you every step of the way.
    </p>
    <v-btn
      class="vibe64-learn-welcome__choose"
      data-test="choose-lesson"
      :prepend-icon="mdiSchoolOutline"
      rounded="pill"
      size="large"
      variant="flat"
      @click="learning?.openCourses('courses')"
    >
      Choose a lesson
    </v-btn>
  </div>
</template>

<style scoped>
.vibe64-learn-welcome {
  align-items: center;
  animation: vibe64-learn-welcome-in var(--v64-duration-long, 400ms) var(--v64-ease-emphasized-decelerate, ease-out);
  display: grid;
  gap: var(--v64-space-3);
  justify-items: center;
  max-width: 24rem;
  text-align: center;
}

.vibe64-learn-welcome__title {
  color: var(--v64-on-surface);
  font: var(--v64-type-headline-sm, 600 1.5rem/2rem system-ui, sans-serif);
  letter-spacing: -0.01em;
  margin: var(--v64-space-2) 0 0;
}

.vibe64-learn-welcome__text {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-lg, 400 1rem/1.5rem system-ui, sans-serif);
  margin: 0;
}

/* The learner plate's yellow, as a filled M3 button. */
.vibe64-learn-welcome__choose {
  background: var(--v64-learning) !important;
  box-shadow: 0 4px 14px var(--v64-learning-glow);
  color: #1d1600 !important;
  font-weight: 700;
  letter-spacing: 0.01em;
  margin-top: var(--v64-space-2);
  padding-inline: var(--v64-space-6, 1.5rem) !important;
  text-transform: none;
  transition: transform var(--v64-duration-short, 150ms) var(--v64-ease-standard, ease), box-shadow var(--v64-duration-short, 150ms) var(--v64-ease-standard, ease);
}

.vibe64-learn-welcome__choose:hover {
  box-shadow: 0 6px 20px var(--v64-learning-glow);
  transform: translateY(-1px);
}

@keyframes vibe64-learn-welcome-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .vibe64-learn-welcome,
  .vibe64-learn-welcome__choose {
    animation: none;
    transition: none;
  }
}
</style>
