<script setup>
import { computed, ref, toValue, watch } from "vue";
import { mdiCheckCircle } from "@mdi/js";
import { courseProgress } from "@local/vibe64-training/client/course-progress";
import { useVibe64PracticeProjects } from "@/composables/useVibe64PracticeProjects.js";

// L's "Lesson finished" screen (lesson surface): shown when the learner's own
// step result completes the lesson, and again from the reader of a complete
// lesson. It ends the attempt through the reader's existing Finish lesson flow
// (lesson.end, reason restart, every result kept), which also ends the learning
// state of the lesson; then it offers the practice project's deletion (the
// existing one-click practice.delete), the next lesson of the same course and
// Courses.
const props = defineProps({
  learning: { type: Object, required: true },
  // L's courses adapter (useVibe64LearningCourses): courses, saved lessons, start.
  courses: { type: Object, required: true },
  // The saved learning revision, required by lesson.end.
  learningRevision: { type: Number, default: null }
});
// "ended": lesson.end succeeded, so the host rereads the saved lessons it shows.
const emit = defineEmits(["ended"]);
const lesson = computed(() => props.learning.lesson.value);
const attempt = computed(() => lesson.value?.attempt || null);
const ended = computed(() => Boolean(attempt.value?.ended));
const steps = computed(() => lesson.value?.steps || []);
const passedCount = computed(() => steps.value.filter(step => props.learning.stepStatus(step.id) === "passed").length);
const busy = computed(() => props.learning.state.busy);

// Finish: end the attempt once, as soon as the saved revision is known.
const endError = ref("");
let endingFor = "";
async function finish() {
  if (ended.value || busy.value || props.learningRevision === null) return;
  endError.value = "";
  const result = await props.learning.endLesson({ expectedRevision: props.learningRevision });
  if (result) emit("ended");
  else endError.value = props.learning.state.error || "Finishing the lesson was not confirmed. Try again.";
}
watch([() => props.learning.state.attemptId, () => props.learningRevision, ended], ([attemptId, revision, done]) => {
  if (done || revision === null || !attemptId || endingFor === attemptId) return;
  endingFor = attemptId;
  void finish();
}, { immediate: true });

// The practice project: deleted with one click, or kept (it stays under Practice).
const practice = useVibe64PracticeProjects({ enabled: computed(() => Boolean(props.learning.state.open)),
  learningResource: props.courses.learningResource, coursesResource: props.courses.coursesResource });
const practiceSlug = computed(() => lesson.value?.practiceProjectSlug || "");
const practiceListed = computed(() => practice.practiceProjects.value.some(project => project.slug === practiceSlug.value));
const deleting = computed(() => Boolean(toValue(practice.deletingSlug)));
const practiceChoice = ref("");
watch(() => props.learning.state.attemptId, () => { practiceChoice.value = ""; });
async function deletePractice() {
  const project = { slug: practiceSlug.value, attemptId: props.learning.state.attemptId, deleteAvailable: true };
  if (await practice.deletePracticeProject(project)) practiceChoice.value = "deleted";
}

// The next lesson: the first lesson of this course not completed yet that can be started.
const pin = computed(() => attempt.value?.pin || null);
const saved = computed(() => {
  const value = toValue(props.courses.learningResource.data);
  return value?.ok === true && value.available === true ? value : null;
});
const nextLesson = computed(() => {
  const catalogue = toValue(props.courses.coursesResource.data);
  const course = catalogue?.ok === true && Array.isArray(catalogue.courses) ? catalogue.courses.find(value =>
    value?.courseId === pin.value?.course?.courseId && value.release === pin.value?.course?.release) : null;
  if (!course || !saved.value) return null;
  const progress = courseProgress(course, saved.value.lessonProgress || [], saved.value.active || null, saved.value.history || [],
    { canTryPreviews: catalogue.canTryPreviews === true });
  const next = progress.next;
  return next && next.code !== pin.value?.lesson?.code ? { course, lesson: next } : null;
});
const startError = ref("");
const canStart = computed(() => Boolean(ended.value && nextLesson.value && saved.value && !saved.value.active &&
  !toValue(props.courses.busy)));
async function startNext() {
  if (!canStart.value) return;
  const { course, lesson: next } = nextLesson.value;
  startError.value = "";
  try {
    const outcome = await props.courses.startLesson({ courseId: course.courseId, release: course.release,
      lessonCode: next.code, expectedRevision: saved.value.revision });
    if (outcome?.attemptId && outcome.current !== false) await props.learning.show({ surface: "lesson", attemptId: outcome.attemptId });
  } catch (cause) {
    startError.value = String(cause?.message || "The next lesson did not start. Try again from Courses.");
  }
}
const backToCourses = () => props.learning.show({ surface: "courses" });
</script>

<template>
  <section class="vibe64-learning-finished" aria-labelledby="vibe64-learning-finished-title" data-test="learning-finished">
    <v-icon :icon="mdiCheckCircle" size="56" class="vibe64-learning-finished__mark" aria-hidden="true" />
    <p class="vibe64-learning-finished__eyebrow">Lesson finished</p>
    <h2 id="vibe64-learning-finished-title">{{ lesson?.title || lesson?.code }}</h2>
    <p>You completed every required step: {{ passedCount }} of {{ steps.length }} steps passed. Your results are kept.</p>
    <p v-if="!ended && !endError" class="vibe64-learning-finished__hint" role="status">
      <v-progress-circular indeterminate size="16" width="2" class="me-2" />Finishing the lesson…
    </p>
    <v-alert v-if="endError" type="error" variant="tonal" rounded="lg" role="alert">
      {{ endError }}
      <template #append><v-btn variant="text" min-height="48" :disabled="Boolean(busy)" data-test="learning-finished-retry" @click="finish">Finish lesson</v-btn></template>
    </v-alert>

    <div v-if="practiceSlug && ended" class="vibe64-learning-finished__card" data-test="learning-finished-practice">
      <h3>Practice project</h3>
      <p v-if="practiceChoice === 'deleted' || (saved && !practiceListed && !deleting && !practiceChoice)">The practice project is deleted.</p>
      <p v-else-if="practiceChoice === 'kept'">The practice project is kept. You can open or delete it later from Courses → Practice.</p>
      <template v-else>
        <p>Delete it now (its files, sessions and Preview go for good, with no archive), or keep it to look at later.</p>
        <p v-if="practice.deleteError.value" class="vibe64-learning-finished__error" role="alert">{{ practice.deleteError.value }}</p>
        <div class="vibe64-learning-finished__actions">
          <v-btn variant="tonal" rounded="pill" min-height="48" :loading="deleting" :disabled="deleting" data-test="learning-finished-delete" @click="deletePractice">Delete practice project</v-btn>
          <v-btn variant="text" rounded="pill" min-height="48" :disabled="deleting" data-test="learning-finished-keep" @click="practiceChoice = 'kept'">Keep practice project</v-btn>
        </div>
      </template>
    </div>

    <p v-if="startError" class="vibe64-learning-finished__error" role="alert">{{ startError }}</p>
    <div class="vibe64-learning-finished__actions">
      <v-btn v-if="nextLesson" color="primary" variant="flat" rounded="pill" min-height="48" :disabled="!canStart"
        :loading="Boolean(toValue(courses.starting))" data-test="learning-finished-next" @click="startNext">Next lesson: {{ nextLesson.lesson.title }}</v-btn>
      <v-btn variant="tonal" rounded="pill" min-height="48" data-test="learning-finished-courses" @click="backToCourses">Back to courses</v-btn>
      <v-btn variant="text" rounded="pill" min-height="48" data-test="learning-finished-read" @click="learning.closeFinished()">Read the lesson again</v-btn>
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
.vibe64-learning-finished__card { display: grid; gap: var(--v64-space-2, 8px); justify-self: stretch; padding: var(--v64-space-4, 16px); border-radius: var(--v64-shape-lg, 16px); background: var(--v64-surface-container-low, rgba(0, 0, 0, 0.03)); }
.vibe64-learning-finished__card > * { margin: 0; }
.vibe64-learning-finished__card h3 { font: var(--v64-type-title-md, 600 1.125rem/1.5rem system-ui, sans-serif); }
.vibe64-learning-finished__actions { display: flex; flex-wrap: wrap; gap: var(--v64-space-2, 8px); }
.vibe64-learning-finished__error { color: rgb(var(--v-theme-error)); }
.vibe64-learning-finished .v-btn { letter-spacing: 0; text-transform: none; }
</style>
