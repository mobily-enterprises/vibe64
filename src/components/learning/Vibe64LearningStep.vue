<script setup>
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import TrainingVisualPlayer from "@local/vibe64-training/client/visual-player";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import { VIBE64_LEARNING_ROUTES } from "@/lib/vibe64Learning.js";
import Vibe64LearningMarkdown from "./Vibe64LearningMarkdown.vue";

// One lesson step exactly as the reader shows it: label, title, Markdown body,
// its diagram with Play, its check and Show me / Teach me; the step bar and the step list move between steps.
// Show me on a step with beats plays them in the lesson step bar.
// Used by the Lesson pane's reader. Verdicts come only
// from the Training actions (auto check, choice comparator, self or reading
// step Done) through
// the shared L controller, so every surface shows the same saved results.
const MAX_COMMAND_IDS = 64;
const props = defineProps({
  learning: { type: Object, required: true },
  // The step heading's id (the host labels its region with it).
  headingId: { type: String, default: "" },
  // Test seam for the visual resource read.
  readVisual: { type: Function, default: null }
});
// "return": Show me could not show its place, so the host shows the step (and
// its reason) again.
const emit = defineEmits(["return"]);
// The Show me / Teach me failure; a host whose view unmounts while hidden keeps it.
const actionError = defineModel("error", { type: String, default: "" });
const lesson = computed(() => props.learning.lesson.value);
const steps = computed(() => lesson.value?.steps || []);
const step = computed(() => props.learning.currentStep.value);
const index = computed(() => steps.value.findIndex(value => value.id === step.value?.id));
const ended = computed(() => Boolean(lesson.value?.attempt?.ended));
const busy = computed(() => props.learning.state.busy);
const statusOf = stepId => props.learning.stepStatus(stepId);
const statusLabel = Object.freeze({ passed: "Passed", "not-yet-passed": "Not yet passed", "not-started": "Not checked yet" });
const kind = computed(() => step.value?.check?.kind || "none");

// Choice: the selection is local until Check answer; the answer key never reaches the browser.
// A passed question shows the selection its saved result recorded (also in a fresh browser).
const selected = ref([]);
const savedSelection = computed(() => {
  const passed = (lesson.value?.results || []).filter(result => result?.stepId === step.value?.id &&
    result.kind === "choice" && result.outcome === "passed" && Array.isArray(result.evidence?.selected));
  return passed.length ? passed.at(-1).evidence.selected.filter(Number.isSafeInteger) : null;
});
watch([() => step.value?.id, () => JSON.stringify(savedSelection.value)], ([stepId], [previousStepId] = []) => {
  if (savedSelection.value) selected.value = [...savedSelection.value];
  else if (stepId !== previousStepId) selected.value = [];
}, { immediate: true });
function toggleOption(optionIndex) {
  selected.value = selected.value.includes(optionIndex)
    ? selected.value.filter(value => value !== optionIndex) : [...selected.value, optionIndex];
}

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
// Separate sources: a realtime lesson reread (for example after the reader saves
// its scroll during Play) keeps the IDs and must not remount a playing diagram.
watch([() => props.learning.state.attemptId, () => step.value?.visual?.id], async ([attemptId, visualId]) => {
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
    // A fresh instance without a snapshot starts at the declared initial state
    // with the controller's own labels; only a controller knows its label set.
    await player.value.restore(undefined);
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

// A check that did not pass says why (for example, no App press captured yet);
// the reason is shown until the step changes. It never changes the status.
const checkReason = ref("");
// Separate sources: a lesson reread after the check keeps the same IDs and must not clear it.
watch([() => props.learning.state.attemptId, () => step.value?.id], () => { checkReason.value = ""; });
// A step passed earlier in this attempt keeps its pass: the server neither
// checks nor records a later answer or check, so say so instead of a bare "Passed".
const ALREADY_PASSED = "You already passed this step, so this was not checked again. Your earlier pass counts.";
function resultNote(result) {
  if (result?.alreadyPassed) return ALREADY_PASSED;
  return result?.outcome === "not-yet-passed" && result.reason ? String(result.reason) : "";
}
async function runCheck() {
  const stepId = step.value.id;
  checkReason.value = "";
  const result = await props.learning.runCheck(stepId);
  if (step.value?.id === stepId) checkReason.value = resultNote(result);
}
// A review step: the reviewer's verdict, or why it could not review.
async function runReview() {
  const stepId = step.value.id;
  checkReason.value = "";
  const result = await props.learning.review(stepId);
  if (step.value?.id === stepId) {
    checkReason.value = result ? props.learning.reviewNote(result) : props.learning.state.error || "Your work could not be checked. Try again.";
  }
}
async function answer() {
  const stepId = step.value.id;
  checkReason.value = "";
  const result = await props.learning.answer(stepId, selected.value);
  if (step.value?.id === stepId) checkReason.value = resultNote(result);
}

async function showMe() {
  actionError.value = "";
  let error = "";
  try {
    const result = await props.learning.showMe(step.value.id);
    if (result?.guide && result.guide.shown === false) {
      error = "That place is not visible on this page. Open your practice project, then choose Show me again.";
    }
  } catch (cause) {
    error = String(cause?.message || "That place could not be shown.");
  }
  // Show me moved to another place; an unshown place brings the step back with the reason.
  if (error) {
    actionError.value = error;
    emit("return");
  }
}
// I'm stuck: on a step with something to do or check that has not passed.
const stuckOffered = computed(() => Boolean(!ended.value && statusOf(step.value?.id) !== "passed" &&
  (["auto", "fact", "review"].includes(kind.value) || step.value?.beats?.some(beat => beat.kind === "do"))));
function askStuck() {
  actionError.value = "";
  try {
    props.learning.stuck(step.value.id);
  } catch (cause) { actionError.value = String(cause?.message || "Colleague could not be asked."); }
}
function teachMe() {
  actionError.value = "";
  try {
    props.learning.teachMe(step.value.id);
  } catch (cause) { actionError.value = String(cause?.message || "Colleague could not be asked."); }
}
const go = offset => {
  const next = steps.value[index.value + offset];
  if (next) props.learning.selectStep(next.id);
};
// A reading step (no check) can be marked done too; marking it moves on.
const readingDone = computed(() => kind.value === "none" && statusOf(step.value?.id) === "passed");
async function markRead() {
  const stepId = step.value.id;
  const result = await props.learning.done(stepId);
  if (result && step.value?.id === stepId) go(1);
}
</script>

<template>
  <div v-if="step" class="vibe64-learning-step">
    <p class="vibe64-learning-step__eyebrow">Step {{ index + 1 }} of {{ steps.length }}<template v-if="!step.required"> · optional</template></p>
    <h2 :id="headingId || undefined">{{ step.title }}</h2>
    <p v-if="ended" class="vibe64-learning-step__note" role="status">
      This lesson has ended. You can read it; it is kept under Archived. To do it again, start it from Courses.
      <v-btn variant="text" min-height="48" data-test="learning-ended-courses" @click="learning.show({ surface: 'courses' })">Go to Courses</v-btn>
    </p>
    <Vibe64LearningMarkdown :text="step.bodyText || ''" />

    <section v-if="step.visual" class="vibe64-learning-step__visual" aria-label="Diagram">
      <TrainingVisualPlayer
        v-if="visualResource"
        :key="`${step.visual.id}:${visualKey}`"
        ref="player"
        :resource="visualResource"
        :attempt-id="learning.state.attemptId"
      />
      <v-skeleton-loader v-else-if="!visualError" type="image" aria-label="Loading the diagram" />
      <p v-if="visualError" class="vibe64-learning-step__error" role="alert">{{ visualError }}</p>
      <v-btn v-if="step.visual.play?.length" variant="tonal" rounded="pill" min-height="48" data-test="learning-play"
        :disabled="!visualResource" :loading="playing" @click="play">Play</v-btn>
    </section>

    <section v-if="!ended && kind === 'choice'" class="vibe64-learning-step__check" aria-label="Question">
      <h3>{{ step.check.question }}</h3>
      <!-- A passed question keeps its pass and is not compared again, so a later answer gets no verdict. -->
      <p v-if="statusOf(step.id) === 'passed'" class="vibe64-learning-step__hint" data-test="learning-answer-kept">You already passed this question, so answers are not checked again.</p>
      <p v-else class="vibe64-learning-step__hint">Select every correct option, then choose Check answer.</p>
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
        :disabled="!selected.length || Boolean(busy) || statusOf(step.id) === 'passed'" :loading="busy === `answer:${step.id}`"
        @click="answer">Check answer</v-btn>
      <p v-if="checkReason" class="vibe64-learning-step__hint" role="status" data-test="learning-check-reason">{{ checkReason }}</p>
    </section>
    <section v-else-if="!ended && (kind === 'auto' || kind === 'fact')" class="vibe64-learning-step__check" aria-label="Automatic check">
      <p v-if="step.check.files?.length">Make this change yourself in Dashboard → Files. Saving does not check it: press Check now when you are ready.</p>
      <p v-else-if="kind === 'auto'">This step is checked automatically when you do it in your practice project.</p>
      <v-btn variant="tonal" rounded="pill" min-height="48" data-test="learning-check"
        :disabled="Boolean(busy)" :loading="busy === `check:${step.id}`" @click="runCheck">Check now</v-btn>
      <p v-if="checkReason" class="vibe64-learning-step__hint" role="status" data-test="learning-check-reason">{{ checkReason }}</p>
    </section>
    <section v-else-if="!ended && kind === 'review'" class="vibe64-learning-step__check" aria-label="Review">
      <p>Your AI reviews your work in the practice project against this: <strong>{{ step.check.rubric }}</strong></p>
      <p v-if="statusOf(step.id) === 'passed'" class="vibe64-learning-step__hint" data-test="learning-review-saved">
        {{ learning.reviewNote(learning.savedReview(step.id)) || "Passed ✓" }}
      </p>
      <template v-else>
        <v-btn variant="tonal" rounded="pill" min-height="48" data-test="learning-review"
          :disabled="Boolean(busy)" :loading="busy === `review:${step.id}`" @click="runReview">{{ checkReason ? "Check again" : "Check my work" }}</v-btn>
        <p v-if="busy === `review:${step.id}`" class="vibe64-learning-step__hint" role="status">Checking your work with your AI…</p>
        <p v-if="checkReason" class="vibe64-learning-step__hint" role="status" data-test="learning-check-reason">{{ checkReason }}</p>
      </template>
    </section>
    <section v-else-if="!ended && kind === 'self'" class="vibe64-learning-step__check" aria-label="Self check">
      <!-- The step text says when to press Done; a step already passed is said here, as for questions. -->
      <p v-if="statusOf(step.id) === 'passed'" class="vibe64-learning-step__hint" data-test="learning-done-kept">You already passed this step, so it does not need to be marked done again.</p>
      <v-btn color="primary" variant="flat" rounded="pill" min-height="48" data-test="learning-done"
        :disabled="Boolean(busy) || statusOf(step.id) === 'passed'" :loading="busy === `done:${step.id}`"
        @click="learning.done(step.id)">Done</v-btn>
    </section>
    <p v-if="kind !== 'none'" class="vibe64-learning-step__status" :class="`is-${statusOf(step.id)}`" role="status" data-test="learning-step-status">
      {{ statusLabel[statusOf(step.id)] }}
    </p>
    <template v-else-if="readingDone">
      <p class="vibe64-learning-step__status is-passed" role="status" data-test="learning-step-status">Done</p>
      <p class="vibe64-learning-step__hint" data-test="learning-mark-read-kept">You marked this step done.</p>
    </template>

    <p v-if="actionError" class="vibe64-learning-step__error" role="alert">{{ actionError }}</p>
    <div class="vibe64-learning-step__actions">
      <v-btn v-if="(step.guide || step.beats?.length) && !ended" variant="tonal" rounded="pill" min-height="48" data-test="learning-show-me" @click="showMe">Show me</v-btn>
      <v-btn v-if="!ended" variant="tonal" rounded="pill" min-height="48" data-test="learning-teach-me" @click="teachMe">Teach me</v-btn>
      <v-btn v-if="stuckOffered" variant="tonal" rounded="pill" min-height="48" data-test="learning-stuck" @click="askStuck">I'm stuck</v-btn>
    </div>
    <slot name="after-actions" />
    <div v-if="!ended && kind === 'none' && !readingDone" class="vibe64-learning-step__pager">
      <span class="vibe64-learning-step__pager-end">
        <v-btn color="primary" variant="tonal" rounded="pill" min-height="48"
          data-test="learning-mark-read" :disabled="Boolean(busy)" :loading="busy === `done:${step.id}`" @click="markRead">Mark as done</v-btn>
      </span>
    </div>
  </div>
</template>

<style scoped>
.vibe64-learning-step h2 { font: var(--v64-type-headline-sm, 600 1.5rem/2rem system-ui, sans-serif); margin: 0 0 var(--v64-space-3, 12px); overflow-wrap: anywhere; }
.vibe64-learning-step__eyebrow { margin: 0 0 4px; font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif); letter-spacing: 0.06em; text-transform: uppercase; color: var(--v64-on-surface-variant, inherit); }
.vibe64-learning-step__visual, .vibe64-learning-step__check { display: grid; gap: var(--v64-space-3, 12px); justify-items: start; margin-block: var(--v64-space-5, 24px); }
.vibe64-learning-step__visual > :first-child { justify-self: stretch; }
.vibe64-learning-step__check { padding: var(--v64-space-4, 16px); border-radius: var(--v64-shape-lg, 16px); background: var(--v64-surface-container-low, rgba(0, 0, 0, 0.03)); }
.vibe64-learning-step__check h3 { margin: 0; font: var(--v64-type-title-md, 600 1.125rem/1.5rem system-ui, sans-serif); }
.vibe64-learning-step__hint, .vibe64-learning-step__note { margin: 0; color: var(--v64-on-surface-variant, inherit); }
.vibe64-learning-step__status { font-weight: 600; }
.vibe64-learning-step__status.is-passed { color: rgb(var(--v-theme-success)); }
.vibe64-learning-step__error { color: rgb(var(--v-theme-error)); }
.vibe64-learning-step__actions, .vibe64-learning-step__pager { display: flex; flex-wrap: wrap; gap: var(--v64-space-2, 8px); margin-top: var(--v64-space-4, 16px); }
.vibe64-learning-step__pager { align-items: center; justify-content: space-between; }
.vibe64-learning-step__pager-end { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--v64-space-2, 8px); margin-inline-start: auto; }
.vibe64-learning-step .v-btn { letter-spacing: 0; text-transform: none; }
</style>
