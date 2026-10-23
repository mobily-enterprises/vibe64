<script setup>
import { computed, ref, toValue, watch } from "vue";
import { mdiCheckCircle } from "@mdi/js";
import { courseProgress } from "@local/vibe64-training/client/course-progress";

// The "Lesson finished" screen (in the Lesson pane): shown when the learner's own
// step result completes the lesson, and again from the reader of a complete
// lesson. It finishes the attempt once (lesson.finish archives its record,
// practice project and conversation; Learn mode stays on), then offers the
// next lesson of the same course and Back to courses.
const props = defineProps({
  learning: { type: Object, required: true },
  // The Courses adapter (useVibe64LearningCourses): courses, saved lessons, start.
  courses: { type: Object, required: true }
});
const lesson = computed(() => props.learning.lesson.value);
const steps = computed(() => lesson.value?.steps || []);
const passedNow = computed(() => steps.value.filter(step => props.learning.stepStatus(step.id) === "passed").length);
const busy = computed(() => props.learning.state.busy);
// What the attempt held when it finished: archiving it clears its live results
// and practice project, so the summary keeps the count and what was archived.
const summary = ref(null);
const passedCount = computed(() => summary.value?.passed ?? passedNow.value);
const archivedWith = computed(() => (summary.value?.practice ?? Boolean(lesson.value?.practiceProjectSlug))
  ? "its practice project and conversation" : "its conversation");

// Finish: once per attempt shown here.
const finished = ref(false);
const finishError = ref("");
let finishingFor = "";
async function finish() {
  if (finished.value || busy.value) return;
  finishError.value = "";
  summary.value ||= props.learning.finishSummary?.() ||
    { passed: passedNow.value, practice: Boolean(lesson.value?.practiceProjectSlug) };
  if (await props.learning.finish(summary.value)) {
    finished.value = true;
    void props.courses.learningResource.reload();
  } else finishError.value = props.learning.state.error || "Finishing the lesson was not confirmed. Try again.";
}
watch(() => props.learning.finished && props.learning.state.attemptId, attemptId => {
  if (!attemptId || finishingFor === attemptId) return;
  finishingFor = attemptId;
  finished.value = false;
  summary.value = null;
  void finish();
}, { immediate: true });

// The next lesson: the first lesson of this course not completed yet that can be started.
const pin = computed(() => lesson.value?.attempt?.pin || null);
const saved = computed(() => {
  const value = toValue(props.courses.learningResource.data);
  return value?.ok === true && value.available === true ? value : null;
});
const nextLesson = computed(() => {
  const catalogue = toValue(props.courses.coursesResource.data);
  const course = catalogue?.ok === true && Array.isArray(catalogue.courses) ? catalogue.courses.find(value =>
    value?.courseId === pin.value?.course?.courseId && value.release === pin.value?.course?.release) : null;
  if (!course || !saved.value) return null;
  const next = courseProgress(course, saved.value.lessonProgress || [], saved.value.active || null, saved.value.history || [],
    { canTryPreviews: catalogue.canTryPreviews === true }).next;
  return next && next.code !== pin.value?.lesson?.code ? { course, lesson: next } : null;
});
const startError = ref("");
const canStart = computed(() => Boolean(finished.value && nextLesson.value && saved.value && !toValue(props.courses.busy)));
async function startNext() {
  if (!canStart.value) return;
  const { course, lesson: next } = nextLesson.value;
  startError.value = "";
  try {
    await props.learning.startLesson({ courseId: course.courseId, release: course.release, lessonCode: next.code,
      expectedRevision: saved.value.revision }, props.courses.startLesson);
  } catch (cause) {
    startError.value = String(cause?.message || "The next lesson did not start. Try again from Courses.");
  }
}
</script>

<template>
  <section class="vibe64-learning-finished" aria-labelledby="vibe64-learning-finished-title" data-test="learning-finished">
    <v-icon :icon="mdiCheckCircle" size="56" class="vibe64-learning-finished__mark" aria-hidden="true" />
    <p class="vibe64-learning-finished__eyebrow">Lesson finished</p>
    <h2 id="vibe64-learning-finished-title">{{ lesson?.title || lesson?.code }}</h2>
    <p>You completed every required step: {{ passedCount }} of {{ steps.length }} steps passed.</p>
    <p v-if="finished">It is archived with {{ archivedWith }}, under Courses → Archived.</p>
    <p v-else-if="!finishError" class="vibe64-learning-finished__hint" role="status">
      <v-progress-circular indeterminate size="16" width="2" class="me-2" />Finishing the lesson…
    </p>
    <v-alert v-if="finishError" type="error" variant="tonal" rounded="lg" role="alert">
      {{ finishError }}
      <template #append><v-btn variant="text" min-height="48" :disabled="Boolean(busy)" data-test="learning-finished-retry" @click="finish">Finish lesson</v-btn></template>
    </v-alert>

    <p v-if="startError" class="vibe64-learning-finished__error" role="alert">{{ startError }}</p>
    <div class="vibe64-learning-finished__actions">
      <v-btn v-if="nextLesson" color="primary" variant="flat" rounded="pill" min-height="48" :disabled="!canStart"
        :loading="Boolean(toValue(courses.starting))" data-test="learning-finished-next" @click="startNext">Next lesson: {{ nextLesson.lesson.title }}</v-btn>
      <v-btn variant="tonal" rounded="pill" min-height="48" data-test="learning-finished-courses"
        @click="learning.show({ surface: 'courses' })">Back to courses</v-btn>
    </div>
  </section>
</template>

<style scoped>
.vibe64-learning-finished { display: grid; gap: var(--v64-space-3, 12px); justify-items: start; max-width: 40rem; margin: 0 auto; padding: var(--v64-space-6, 32px) var(--v64-space-5, 24px); overflow-y: auto; max-height: 100%; }
.vibe64-learning-finished > * { margin: 0; max-width: 100%; }
.vibe64-learning-finished__mark { color: rgb(var(--v-theme-success)); }
.vibe64-learning-finished__eyebrow { font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif); letter-spacing: 0.06em; text-transform: uppercase; color: var(--v64-on-surface-variant, inherit); }
.vibe64-learning-finished h2 { font: var(--v64-type-headline-sm, 600 1.5rem/2rem system-ui, sans-serif); overflow-wrap: anywhere; }
.vibe64-learning-finished__hint { display: flex; align-items: center; color: var(--v64-on-surface-variant, inherit); }
.vibe64-learning-finished__actions { display: flex; flex-wrap: wrap; gap: var(--v64-space-2, 8px); }
.vibe64-learning-finished__error { color: rgb(var(--v-theme-error)); }
.vibe64-learning-finished .v-btn { letter-spacing: 0; text-transform: none; }
</style>
