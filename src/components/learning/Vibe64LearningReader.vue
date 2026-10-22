<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { revealCurrentStep } from "@/lib/vibe64Learning.js";
import Vibe64LearningMarkdown from "./Vibe64LearningMarkdown.vue";
import Vibe64LearningStep from "./Vibe64LearningStep.vue";

// The lesson reader of the Learn page's Lesson pane: the lesson's steps with
// their status, and the current step (Vibe64LearningStep). It lays itself out
// by its own width, so a narrow pane gets the phone step row.
// Verdicts come only from the Training actions (auto check, choice comparator,
// self Done); this view displays the saved results.
const props = defineProps({
  learning: { type: Object, required: true },
  // The reader is on screen: it then restores its saved scroll place.
  visible: { type: Boolean, default: true },
  // Test seam for the step's visual resource read.
  readVisual: { type: Function, default: null }
});
// return: Show me could not show its place, so the host shows the step again.
const emit = defineEmits(["return"]);
const lesson = computed(() => props.learning.lesson.value);
const steps = computed(() => lesson.value?.steps || []);
const step = computed(() => props.learning.currentStep.value);
const statusOf = stepId => props.learning.stepStatus(stepId);
const statusLabel = Object.freeze({ passed: "Passed", "not-yet-passed": "Not yet passed", "not-started": "Not checked yet" });
const requiredDone = computed(() => props.learning.complete);

// Scroll: the reader returns to the saved place of the current step.
const body = ref(null);
let restoring = false;
async function restoreScroll() {
  await nextTick();
  if (!body.value) return;
  restoring = true;
  body.value.scrollTop = props.learning.state.scroll || 0;
  requestAnimationFrameSafe(() => { restoring = false; });
}
function requestAnimationFrameSafe(callback) {
  if (globalThis.requestAnimationFrame) globalThis.requestAnimationFrame(callback);
  else setTimeout(callback, 0);
}
// Separate sources: a realtime lesson reread keeps the step ID and must not jump the scroll back.
watch([() => step.value?.id, () => props.visible], ([, shown]) => { if (shown) void restoreScroll(); }, { immediate: true });
let scrollTimer = null;
function onScroll() {
  if (restoring || !body.value) return;
  clearTimeout(scrollTimer);
  const top = body.value.scrollTop;
  scrollTimer = setTimeout(() => props.learning.setScroll(top), 200);
}
onBeforeUnmount(() => clearTimeout(scrollTimer));

// The phone step row follows the current step (Next, Previous, a restored place).
const stepList = ref(null);
watch([() => step.value?.id, () => props.visible], async ([, shown]) => {
  if (!shown) return;
  await nextTick();
  revealCurrentStep(stepList.value);
}, { immediate: true });
</script>

<template>
  <div class="vibe64-learning-reader-frame">
  <div class="vibe64-learning-reader" :aria-busy="learning.state.loading">
    <v-alert v-if="learning.state.error" type="error" variant="tonal" rounded="lg" class="vibe64-learning-reader__alert" role="alert">
      {{ learning.state.error }}
      <template #append><v-btn variant="text" min-height="48" @click="learning.loadLesson()">Retry</v-btn></template>
    </v-alert>
    <v-skeleton-loader v-if="!lesson && learning.state.loading" type="heading, paragraph, paragraph" aria-label="Loading the lesson" />

    <template v-else-if="lesson">
      <nav class="vibe64-learning-reader__steps" aria-label="Lesson steps">
        <p class="vibe64-learning-reader__lesson">
          <span class="vibe64-learning-reader__code">{{ lesson.code }}</span>
          <strong>{{ lesson.title }}</strong>
        </p>
        <ol ref="stepList">
          <li v-for="(value, position) in steps" :key="value.id">
            <button
              type="button"
              class="vibe64-learning-reader__step"
              :class="[`is-${statusOf(value.id)}`, { 'is-current': value.id === step?.id }]"
              :aria-current="value.id === step?.id ? 'step' : undefined"
              :data-step-id="value.id"
              @click="learning.selectStep(value.id)"
            >
              <span class="vibe64-learning-reader__step-mark" aria-hidden="true">{{ statusOf(value.id) === 'passed' ? '✓' : position + 1 }}</span>
              <span class="vibe64-learning-reader__step-title">{{ value.title }}</span>
              <span class="vibe64-learning-reader__step-status">{{ value.required ? statusLabel[statusOf(value.id)] : statusOf(value.id) === 'passed' ? 'Done' : 'Optional' }}</span>
            </button>
          </li>
        </ol>
        <div v-if="requiredDone" class="vibe64-learning-reader__summary">
          <p v-if="requiredDone" class="vibe64-learning-reader__complete" role="status">
            <span class="vibe64-learning-reader__complete-long">Every required step is passed. This lesson is complete.</span>
            <span class="vibe64-learning-reader__complete-short">✓ Lesson complete</span>
          </p>
          <v-btn color="primary" variant="flat" rounded="pill" min-height="48" data-test="learning-finish"
            @click="learning.showFinished()">Lesson finished</v-btn>
        </div>
      </nav>

      <article v-if="step" ref="body" class="vibe64-learning-reader__body" :aria-labelledby="`vibe64-learning-step-${step.id}`" @scroll.passive="onScroll">
        <Vibe64LearningStep :learning="learning" :heading-id="`vibe64-learning-step-${step.id}`" :read-visual="readVisual" @return="emit('return')">
          <template #after-actions>
            <details v-if="lesson.notesText" class="vibe64-learning-reader__notes">
              <summary>Lesson notes</summary>
              <Vibe64LearningMarkdown :text="lesson.notesText" />
            </details>
          </template>
        </Vibe64LearningStep>
      </article>
    </template>
  </div>
  </div>
</template>

<style scoped>
/* The reader's own width decides its layout (a pane beside the chat column and Colleague is narrow). */
.vibe64-learning-reader-frame { container-type: inline-size; height: 100%; min-height: 0; }
.vibe64-learning-reader {
  display: grid;
  gap: var(--v64-space-4, 16px);
  grid-template-columns: minmax(14rem, 18rem) minmax(0, 1fr);
  height: 100%;
  min-height: 0;
}
.vibe64-learning-reader__alert { grid-column: 1 / -1; }
.vibe64-learning-reader__steps { min-height: 0; overflow-y: auto; padding: var(--v64-space-4, 16px); border-inline-end: 1px solid var(--v64-outline-variant, rgba(0, 0, 0, 0.12)); }
.vibe64-learning-reader__steps ol { list-style: none; margin: var(--v64-space-3, 12px) 0; padding: 0; display: grid; gap: 4px; }
.vibe64-learning-reader__lesson { display: grid; gap: 2px; margin: 0; }
.vibe64-learning-reader__code { font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif); color: var(--v64-on-surface-variant, inherit); }
.vibe64-learning-reader__step {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: var(--v64-shape-md, 12px);
  color: inherit;
  cursor: pointer;
  display: grid;
  gap: 2px var(--v64-space-3, 12px);
  grid-template-columns: 28px minmax(0, 1fr);
  min-height: 48px;
  padding: 6px var(--v64-space-2, 8px);
  text-align: start;
  width: 100%;
}
.vibe64-learning-reader__step:hover { background: var(--v64-surface-container, rgba(0, 0, 0, 0.04)); }
/* The Lesson pane is Learning yellow: the current step lifts out of it as a surface card with the Learning stroke. */
.vibe64-learning-reader__step.is-current {
  background: rgb(var(--v-theme-surface));
  box-shadow: inset 0 0 0 2px var(--v64-learning-strong, #c99a00);
  color: rgb(var(--v-theme-on-surface));
}
.vibe64-learning-reader__step:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.vibe64-learning-reader__step-mark {
  align-items: center; border: 1.5px solid currentColor; border-radius: 50%; display: inline-flex; grid-row: span 2;
  font-size: 0.8rem; font-weight: 700; height: 26px; justify-content: center; width: 26px;
}
.vibe64-learning-reader__step.is-passed .vibe64-learning-reader__step-mark { background: rgb(var(--v-theme-success)); border-color: rgb(var(--v-theme-success)); color: rgb(var(--v-theme-on-success)); }
.vibe64-learning-reader__step-title { overflow-wrap: anywhere; font-weight: 600; }
.vibe64-learning-reader__step-status { font-size: 0.75rem; color: var(--v64-on-surface-variant, inherit); }
.vibe64-learning-reader__summary { display: grid; gap: var(--v64-space-2, 8px); justify-items: start; }
.vibe64-learning-reader__complete { color: rgb(var(--v-theme-success)); font-weight: 600; margin: 0; }
.vibe64-learning-reader__complete-short { display: none; }
.vibe64-learning-reader__body { min-height: 0; overflow-y: auto; padding: var(--v64-space-4, 16px) var(--v64-space-5, 24px) var(--v64-space-6, 32px); max-width: 52rem; width: 100%; }
.vibe64-learning-reader__notes { margin-top: var(--v64-space-5, 24px); }
.vibe64-learning-reader .v-btn { letter-spacing: 0; text-transform: none; }

@container (max-width: 760px) {
  /* Narrow: steps become a horizontal strip above the step. */
  .vibe64-learning-reader { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); gap: 0; }
  .vibe64-learning-reader__steps { border-inline-end: 0; border-bottom: 1px solid var(--v64-outline-variant, rgba(0, 0, 0, 0.12)); padding: var(--v64-space-2, 8px) var(--v64-space-3, 12px); }
  .vibe64-learning-reader__steps ol { display: flex; overflow-x: auto; margin: var(--v64-space-2, 8px) 0 0; }
  .vibe64-learning-reader__step { grid-template-columns: 28px; min-width: 48px; justify-items: center; }
  .vibe64-learning-reader__step-title, .vibe64-learning-reader__step-status { display: none; }
  /* Phone: completion and its buttons share one short row. */
  .vibe64-learning-reader__summary { align-items: center; display: flex; flex-wrap: wrap; gap: 4px var(--v64-space-2, 8px); margin-top: var(--v64-space-2, 8px); }
  .vibe64-learning-reader__complete { font-size: 0.875rem; }
  .vibe64-learning-reader__complete-long { display: none; }
  .vibe64-learning-reader__complete-short { display: inline; }
  .vibe64-learning-reader__body { padding: var(--v64-space-3, 12px) var(--v64-space-4, 16px) var(--v64-space-6, 32px); }
}
</style>
