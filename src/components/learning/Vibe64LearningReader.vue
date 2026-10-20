<script setup>
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import TrainingVisualPlayer from "@local/vibe64-training/client/visual-player";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import { projectAppPath } from "@/lib/vibe64ProjectScope.js";
import { VIBE64_LEARNING_ROUTES } from "@/lib/vibe64Learning.js";
import Vibe64LearningMarkdown from "./Vibe64LearningMarkdown.vue";

// The lesson reader: steps with readable text and diagrams, and the step's
// own check. Verdicts come only from the Training actions (auto check, choice
// comparator, self Done); this view displays the saved results.
const MAX_COMMAND_IDS = 64;
const props = defineProps({
  learning: { type: Object, required: true },
  // The saved learning revision, required by lesson.end.
  learningRevision: { type: Number, default: null },
  // Test seam for the visual resource read.
  readVisual: { type: Function, default: null }
});
const router = useRouter();
const lesson = computed(() => props.learning.lesson.value);
const steps = computed(() => lesson.value?.steps || []);
const step = computed(() => props.learning.currentStep.value);
const index = computed(() => steps.value.findIndex(value => value.id === step.value?.id));
const ended = computed(() => Boolean(lesson.value?.attempt?.ended));
const legacy = computed(() => Boolean(lesson.value && lesson.value.schemaVersion !== 2));
const busy = computed(() => props.learning.state.busy);
const statusOf = stepId => props.learning.stepStatus(stepId);
const statusLabel = Object.freeze({ passed: "Passed", "not-yet-passed": "Not yet passed", "not-started": "Not checked yet" });
const kind = computed(() => step.value?.check?.kind || "none");
const requiredDone = computed(() => steps.value.filter(value => value.required).every(value => statusOf(value.id) === "passed"));

// Choice: the selection is local until Check answer; the answer key never reaches the browser.
const selected = ref([]);
watch(() => step.value?.id, () => { selected.value = []; });
function toggleOption(optionIndex) {
  selected.value = selected.value.includes(optionIndex)
    ? selected.value.filter(value => value !== optionIndex) : [...selected.value, optionIndex];
}

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
watch(() => [step.value?.id, props.learning.state.open], ([, open]) => { if (open) void restoreScroll(); }, { immediate: true });
let scrollTimer = null;
function onScroll() {
  if (restoring || !body.value) return;
  clearTimeout(scrollTimer);
  const top = body.value.scrollTop;
  scrollTimer = setTimeout(() => props.learning.setScroll(top), 200);
}
onBeforeUnmount(() => clearTimeout(scrollTimer));

// Diagrams: read the step's declared visual for this attempt; Play restores the
// declared initial state, then sends its commands in order with fresh IDs. The
// player keeps at most 64 command IDs per mounted instance, so it is remounted
// before a Play would pass that bound.
const visualResource = shallowRef(null);
const visualError = ref("");
const visualKey = ref(0);
const player = ref(null);
const playing = ref(false);
let usedIds = 0;
const visuals = new Map();
watch(() => [props.learning.state.attemptId, step.value?.visual?.id], async ([attemptId, visualId]) => {
  visualResource.value = null;
  visualError.value = "";
  usedIds = 0;
  if (!attemptId || !visualId) return;
  const key = `${attemptId}\n${visualId}`;
  try {
    if (!visuals.has(key)) {
      const read = props.readVisual || (url => getHttpWebClient().request(resolveStudioRequestUrl(url), { method: "GET" }));
      visuals.set(key, read(VIBE64_LEARNING_ROUTES.visual(attemptId, visualId)));
    }
    const result = await visuals.get(key);
    if (props.learning.state.attemptId !== attemptId || step.value?.visual?.id !== visualId) return;
    if (result?.id !== visualId || result.visual?.id !== visualId) throw new Error("The lesson diagram did not match this step.");
    visualResource.value = result;
  } catch (cause) {
    visuals.delete(key);
    if (step.value?.visual?.id === visualId) visualError.value = String(cause?.message || "The lesson diagram could not be read.");
  }
}, { immediate: true });

async function play() {
  const entries = step.value?.visual?.play || [];
  const resource = visualResource.value;
  if (!resource || playing.value) return;
  playing.value = true;
  visualError.value = "";
  try {
    if (usedIds + entries.length > MAX_COMMAND_IDS) {
      visualKey.value += 1;
      usedIds = 0;
      await nextTick();
    }
    if (!player.value) throw new Error("The diagram has not mounted.");
    await player.value.restore({ state: resource.visual.initialState, paused: false, labels: {} });
    for (const entry of entries) {
      usedIds += 1;
      await player.value.command({ commandId: globalThis.crypto.randomUUID(), name: entry.name, parameters: { ...(entry.parameters || {}) } });
    }
  } catch (cause) {
    visualError.value = String(cause?.message || "The diagram could not play.");
  } finally {
    playing.value = false;
  }
}

const actionError = ref("");
async function showMe() {
  actionError.value = "";
  try {
    const result = await props.learning.showMe(step.value.id);
    if (result?.guide && result.guide.shown === false) {
      actionError.value = "That place is not visible on this page. Open your practice project, then choose Show me again.";
    }
  } catch (cause) {
    actionError.value = String(cause?.message || "That place could not be shown.");
  }
  // Show me minimised L; an unshown place brings the lesson back with the reason.
  if (actionError.value) void props.learning.show();
}
function teachMe() {
  actionError.value = "";
  try { props.learning.teachMe(step.value.id); }
  catch (cause) { actionError.value = String(cause?.message || "Colleague could not be asked."); }
}
const go = offset => {
  const next = steps.value[index.value + offset];
  if (next) props.learning.selectStep(next.id);
};
const practiceSlug = computed(() => lesson.value?.practiceProjectSlug || "");
function openPractice() {
  props.learning.minimise();
  void router?.push(projectAppPath(practiceSlug.value));
}
function endLesson() {
  return props.learning.endLesson({ expectedRevision: props.learningRevision });
}
</script>

<template>
  <div class="vibe64-learning-reader" :aria-busy="learning.state.loading">
    <v-alert v-if="learning.state.error" type="error" variant="tonal" rounded="lg" class="vibe64-learning-reader__alert" role="alert">
      {{ learning.state.error }}
      <template #append><v-btn variant="text" min-height="48" @click="learning.loadLesson()">Retry</v-btn></template>
    </v-alert>
    <v-skeleton-loader v-if="!lesson && learning.state.loading" type="heading, paragraph, paragraph" aria-label="Loading the lesson" />

    <section v-else-if="lesson && legacy" class="vibe64-learning-reader__legacy" aria-label="Earlier lesson">
      <h2>{{ lesson.title || lesson.code }}</h2>
      <p>This lesson was started with the earlier teacher format. Its progress is kept, but it cannot continue here.</p>
      <p v-if="!ended">End it, then start the lesson again from Courses.</p>
      <v-btn v-if="!ended" variant="tonal" rounded="pill" min-height="48" :disabled="Boolean(busy) || learningRevision === null"
        :loading="busy === 'end'" @click="endLesson">End this lesson</v-btn>
    </section>

    <template v-else-if="lesson">
      <nav class="vibe64-learning-reader__steps" aria-label="Lesson steps">
        <p class="vibe64-learning-reader__lesson">
          <span class="vibe64-learning-reader__code">{{ lesson.code }}</span>
          <strong>{{ lesson.title }}</strong>
        </p>
        <ol>
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
              <span class="vibe64-learning-reader__step-status">{{ value.required ? statusLabel[statusOf(value.id)] : 'Optional' }}</span>
            </button>
          </li>
        </ol>
        <p v-if="requiredDone" class="vibe64-learning-reader__complete" role="status">Every required step is passed. This lesson is complete.</p>
        <v-btn v-if="practiceSlug" variant="text" rounded="pill" min-height="48" @click="openPractice">Open practice project</v-btn>
      </nav>

      <article v-if="step" ref="body" class="vibe64-learning-reader__body" :aria-labelledby="`vibe64-learning-step-${step.id}`" @scroll.passive="onScroll">
        <p class="vibe64-learning-reader__eyebrow">Step {{ index + 1 }} of {{ steps.length }}<template v-if="!step.required"> · optional</template></p>
        <h2 :id="`vibe64-learning-step-${step.id}`">{{ step.title }}</h2>
        <p v-if="ended" class="vibe64-learning-reader__note" role="status">This lesson has ended. You can read it; its results are kept.</p>
        <Vibe64LearningMarkdown :text="step.bodyText || ''" />

        <section v-if="step.visual" class="vibe64-learning-reader__visual" aria-label="Diagram">
          <TrainingVisualPlayer
            v-if="visualResource"
            :key="`${step.visual.id}:${visualKey}`"
            ref="player"
            :resource="visualResource"
            :attempt-id="learning.state.attemptId"
          />
          <v-skeleton-loader v-else-if="!visualError" type="image" aria-label="Loading the diagram" />
          <p v-if="visualError" class="vibe64-learning-reader__error" role="alert">{{ visualError }}</p>
          <v-btn v-if="step.visual.play?.length" variant="tonal" rounded="pill" min-height="48" data-test="learning-play"
            :disabled="!visualResource" :loading="playing" @click="play">Play</v-btn>
        </section>

        <section v-if="!ended && kind === 'choice'" class="vibe64-learning-reader__check" aria-label="Question">
          <h3>{{ step.check.question }}</h3>
          <p class="vibe64-learning-reader__hint">Select every correct option, then choose Check answer.</p>
          <v-checkbox
            v-for="(option, optionIndex) in step.check.options"
            :key="optionIndex"
            :model-value="selected.includes(optionIndex)"
            :label="option"
            hide-details
            density="comfortable"
            @update:model-value="toggleOption(optionIndex)"
          />
          <v-btn color="primary" variant="flat" rounded="pill" min-height="48" data-test="learning-answer"
            :disabled="!selected.length || Boolean(busy)" :loading="busy === `answer:${step.id}`"
            @click="learning.answer(step.id, selected)">Check answer</v-btn>
        </section>
        <section v-else-if="!ended && kind === 'auto'" class="vibe64-learning-reader__check" aria-label="Automatic check">
          <p>This step is checked automatically when you do it in your practice project.</p>
          <v-btn variant="tonal" rounded="pill" min-height="48" data-test="learning-check"
            :disabled="Boolean(busy)" :loading="busy === `check:${step.id}`" @click="learning.runCheck(step.id)">Check now</v-btn>
        </section>
        <section v-else-if="!ended && kind === 'self'" class="vibe64-learning-reader__check" aria-label="Self check">
          <p>When you have done this step, mark it done.</p>
          <v-btn color="primary" variant="flat" rounded="pill" min-height="48" data-test="learning-done"
            :disabled="Boolean(busy) || statusOf(step.id) === 'passed'" :loading="busy === `done:${step.id}`"
            @click="learning.done(step.id)">Done</v-btn>
        </section>
        <p v-if="kind !== 'none'" class="vibe64-learning-reader__status" :class="`is-${statusOf(step.id)}`" role="status" data-test="learning-step-status">
          {{ statusLabel[statusOf(step.id)] }}
        </p>

        <p v-if="actionError" class="vibe64-learning-reader__error" role="alert">{{ actionError }}</p>
        <div class="vibe64-learning-reader__actions">
          <v-btn v-if="step.guide && !ended" variant="tonal" rounded="pill" min-height="48" data-test="learning-show-me" @click="showMe">Show me</v-btn>
          <v-btn v-if="!ended" variant="tonal" rounded="pill" min-height="48" data-test="learning-teach-me" @click="teachMe">Teach me</v-btn>
        </div>
        <details v-if="lesson.notesText" class="vibe64-learning-reader__notes">
          <summary>Lesson notes</summary>
          <Vibe64LearningMarkdown :text="lesson.notesText" />
        </details>
        <div class="vibe64-learning-reader__pager">
          <v-btn variant="text" rounded="pill" min-height="48" :disabled="index <= 0" @click="go(-1)">Previous step</v-btn>
          <v-btn variant="text" rounded="pill" min-height="48" :disabled="index >= steps.length - 1" @click="go(1)">Next step</v-btn>
        </div>
      </article>
    </template>
  </div>
</template>

<style scoped>
.vibe64-learning-reader {
  display: grid;
  gap: var(--v64-space-4, 16px);
  grid-template-columns: minmax(14rem, 18rem) minmax(0, 1fr);
  height: 100%;
  min-height: 0;
}
.vibe64-learning-reader__alert, .vibe64-learning-reader__legacy { grid-column: 1 / -1; }
.vibe64-learning-reader__legacy { max-width: 44rem; margin: 0 auto; padding: var(--v64-space-5, 24px); }
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
.vibe64-learning-reader__step.is-current { background: var(--v64-learning-container, rgba(245, 197, 24, 0.18)); color: var(--v64-on-learning-container, inherit); }
.vibe64-learning-reader__step:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.vibe64-learning-reader__step-mark {
  align-items: center; border: 1.5px solid currentColor; border-radius: 50%; display: inline-flex; grid-row: span 2;
  font-size: 0.8rem; font-weight: 700; height: 26px; justify-content: center; width: 26px;
}
.vibe64-learning-reader__step.is-passed .vibe64-learning-reader__step-mark { background: rgb(var(--v-theme-success)); border-color: rgb(var(--v-theme-success)); color: rgb(var(--v-theme-on-success)); }
.vibe64-learning-reader__step-title { overflow-wrap: anywhere; font-weight: 600; }
.vibe64-learning-reader__step-status { font-size: 0.75rem; color: var(--v64-on-surface-variant, inherit); }
.vibe64-learning-reader__complete { color: rgb(var(--v-theme-success)); font-weight: 600; }
.vibe64-learning-reader__body { min-height: 0; overflow-y: auto; padding: var(--v64-space-4, 16px) var(--v64-space-5, 24px) var(--v64-space-6, 32px); max-width: 52rem; width: 100%; }
.vibe64-learning-reader__body h2 { font: var(--v64-type-headline-sm, 600 1.5rem/2rem system-ui, sans-serif); margin: 0 0 var(--v64-space-3, 12px); }
.vibe64-learning-reader__eyebrow { margin: 0 0 4px; font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif); letter-spacing: 0.06em; text-transform: uppercase; color: var(--v64-on-surface-variant, inherit); }
.vibe64-learning-reader__visual, .vibe64-learning-reader__check { display: grid; gap: var(--v64-space-3, 12px); justify-items: start; margin-block: var(--v64-space-5, 24px); }
.vibe64-learning-reader__visual > :first-child { justify-self: stretch; }
.vibe64-learning-reader__check { padding: var(--v64-space-4, 16px); border-radius: var(--v64-shape-lg, 16px); background: var(--v64-surface-container-low, rgba(0, 0, 0, 0.03)); }
.vibe64-learning-reader__check h3 { margin: 0; font: var(--v64-type-title-md, 600 1.125rem/1.5rem system-ui, sans-serif); }
.vibe64-learning-reader__hint, .vibe64-learning-reader__note { margin: 0; color: var(--v64-on-surface-variant, inherit); }
.vibe64-learning-reader__status { font-weight: 600; }
.vibe64-learning-reader__status.is-passed { color: rgb(var(--v-theme-success)); }
.vibe64-learning-reader__error { color: rgb(var(--v-theme-error)); }
.vibe64-learning-reader__actions, .vibe64-learning-reader__pager { display: flex; flex-wrap: wrap; gap: var(--v64-space-2, 8px); margin-top: var(--v64-space-4, 16px); }
.vibe64-learning-reader__pager { justify-content: space-between; }
.vibe64-learning-reader__notes { margin-top: var(--v64-space-5, 24px); }
.vibe64-learning-reader .v-btn { letter-spacing: 0; text-transform: none; }

@media (max-width: 760px) {
  /* Phone: steps become a horizontal strip above the step. */
  .vibe64-learning-reader { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); gap: 0; }
  .vibe64-learning-reader__steps { border-inline-end: 0; border-bottom: 1px solid var(--v64-outline-variant, rgba(0, 0, 0, 0.12)); padding: var(--v64-space-2, 8px) var(--v64-space-3, 12px); }
  .vibe64-learning-reader__steps ol { display: flex; overflow-x: auto; margin: var(--v64-space-2, 8px) 0 0; }
  .vibe64-learning-reader__step { grid-template-columns: 28px; min-width: 48px; justify-items: center; }
  .vibe64-learning-reader__step-title, .vibe64-learning-reader__step-status { display: none; }
  .vibe64-learning-reader__body { padding: var(--v64-space-3, 12px) var(--v64-space-4, 16px) var(--v64-space-6, 32px); }
}
</style>
