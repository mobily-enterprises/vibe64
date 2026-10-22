<script setup>
import { trainingIcons as icons } from "./trainingIcons.js";

// What happens with the lesson start requested from this course, shown where
// it was pressed. The picker owns the state; this only words it.
defineProps({
  // { phase: "starting" | "failed" | "unconfirmed", message?: string }
  feedback: { type: Object, required: true }
});
</script>

<template>
  <div v-if="feedback.phase === 'starting'" class="training-start-feedback training-start-feedback--progress" role="status" data-test="lesson-start-feedback">
    <v-progress-circular indeterminate size="24" width="3" color="primary" />
    <div>
      <strong>Starting your lesson</strong>
      <p>Creating your practice project. This can take a while; the lesson opens by itself when it is ready.</p>
    </div>
  </div>
  <div v-else-if="feedback.phase === 'failed'" class="training-start-feedback training-start-feedback--error" role="alert" data-test="lesson-start-feedback">
    <v-icon :icon="icons.info" size="24" />
    <div>
      <strong>The lesson did not start</strong>
      <p>{{ feedback.message }}</p>
    </div>
  </div>
  <div v-else-if="feedback.phase === 'unconfirmed'" class="training-start-feedback training-start-feedback--warn" role="status" data-test="lesson-start-feedback">
    <v-icon :icon="icons.info" size="24" />
    <div>
      <strong>Lesson start not confirmed</strong>
      <p>Use Retry lesson start to repeat that same request.</p>
    </div>
  </div>
</template>

<style scoped>
.training-start-feedback {
  display: flex; align-items: flex-start; gap: var(--v64-space-3, 12px);
  padding: var(--v64-space-3, 12px) var(--v64-space-4, 16px); border-radius: var(--v64-shape-md, 12px);
  font: var(--v64-type-body-md);
}
.training-start-feedback > :first-child { flex: none; }
.training-start-feedback strong { display: block; font: var(--v64-type-label-lg); }
.training-start-feedback p { margin: 2px 0 0; white-space: normal; overflow-wrap: anywhere; }
.training-start-feedback--progress { background: var(--v64-primary-container); color: var(--v64-on-primary-container); }
.training-start-feedback--warn { background: var(--v64-learning-container); color: var(--v64-on-learning-container); }
.training-start-feedback--error { background: rgba(var(--v-theme-error), 0.12); color: rgb(var(--v-theme-error)); }
</style>
