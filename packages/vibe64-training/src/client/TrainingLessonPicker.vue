<script setup>
import { computed, ref, watch } from "vue";

const props = defineProps({
  catalogueResult: { type: Object, default: null },
  learningResult: { type: Object, default: null },
  catalogueLoading: Boolean,
  learningLoading: Boolean,
  catalogueError: { type: String, default: "" },
  learningError: { type: String, default: "" },
  busy: Boolean,
  canStart: Boolean,
  canResume: Boolean
});
const emit = defineEmits(["refresh", "start", "resume"]);
const selectionId = ref("");
const text = value => typeof value === "string" && value.length > 0;
const revision = value => Number.isSafeInteger(value) && value >= 0;

// These are display-shape guards, not replicas of the server's content,
// permission, pin, progress or admission validators.
const catalogueInvalid = computed(() => {
  const result = props.catalogueResult;
  return result?.ok === true && result.available === true && (!revision(result.revision) ||
    !Array.isArray(result.courses) || result.courses.some(course =>
      !text(course?.courseId) || !text(course.release) || !text(course.title) ||
      typeof course.enabled !== "boolean" || !text(course.status) || !Array.isArray(course.lessons) ||
      course.lessons.some(lesson => !text(lesson?.code) || !text(lesson.hash) ||
        !text(lesson.topicId) || !text(lesson.topicRelease) || !text(lesson.status))));
});
const courses = computed(() => !catalogueInvalid.value && props.catalogueResult?.ok === true &&
  props.catalogueResult.available === true ? props.catalogueResult.courses : []);

function choiceId(course, lesson) {
  return JSON.stringify([course.courseId, course.release, lesson.code, lesson.hash, lesson.topicId, lesson.topicRelease]);
}
const choices = computed(() => courses.value.flatMap(course => course.lessons.map(lesson => ({
  course, lesson, id: choiceId(course, lesson)
}))));
const selected = computed(() => choices.value.find(choice => choice.id === selectionId.value) || null);
watch(choices, values => {
  if (!props.catalogueLoading && !catalogueInvalid.value && props.catalogueResult?.ok === true &&
      props.catalogueResult.available === true && !values.some(value => value.id === selectionId.value)) {
    selectionId.value = "";
  }
}, { immediate: true });

function hasDisplayPin(attempt) {
  return text(attempt?.attemptId) && text(attempt.pin?.course?.courseId) && text(attempt.pin.course.release) &&
    text(attempt.pin?.topic?.topicId) && text(attempt.pin.topic.release) && text(attempt.pin.topic.commit) &&
    text(attempt.pin?.lesson?.code) && text(attempt.pin.lesson.hash);
}
const learningInvalid = computed(() => {
  const result = props.learningResult;
  if (result?.ok !== true || result.available !== true) return false;
  if (!revision(result.revision) || !Object.hasOwn(result, "active") ||
      result.active !== null && (!hasDisplayPin(result.active) || result.active.ended) || !Array.isArray(result.history) ||
      result.history.some(attempt => !hasDisplayPin(attempt) || !attempt.ended)) return true;
  const completion = result.completion;
  return completion != null && (!result.active || !revision(completion.required) || !revision(completion.passed) ||
    completion.passed > completion.required || typeof completion.completed !== "boolean" ||
    completion.lessonCode !== result.active.pin.lesson.code || completion.lessonHash !== result.active.pin.lesson.hash);
});
const learningReady = computed(() => !props.learningLoading && !props.learningError && !learningInvalid.value &&
  props.learningResult?.ok === true && props.learningResult.available === true);
const savedAttempt = computed(() => !learningInvalid.value && props.learningResult?.ok === true &&
  props.learningResult.available === true ? props.learningResult.active : null);
const history = computed(() => !learningInvalid.value && props.learningResult?.ok === true &&
  props.learningResult.available === true ? props.learningResult.history : []);
const completion = computed(() => savedAttempt.value ? props.learningResult.completion : null);
function offered(course, lesson) {
  return course.enabled && course.status === "released" && lesson.status === "published";
}
const startEnabled = computed(() => props.canStart && !props.busy && !props.catalogueLoading && !props.catalogueError &&
  learningReady.value && !savedAttempt.value && selected.value && offered(selected.value.course, selected.value.lesson));
const resumeEnabled = computed(() => props.canResume && !props.busy && learningReady.value && savedAttempt.value && !savedAttempt.value.ended);

function requestStart() {
  if (!startEnabled.value) return;
  const { course, lesson } = selected.value;
  emit("start", { courseId: course.courseId, release: course.release, lessonCode: lesson.code,
    expectedRevision: props.learningResult.revision });
}
function requestResume() {
  if (resumeEnabled.value) emit("resume", { attemptId: savedAttempt.value.attemptId });
}
</script>

<template>
  <section class="training-lesson-picker" aria-label="Lessons" :aria-busy="catalogueLoading || learningLoading">
    <header class="training-lesson-picker__header">
      <div>
        <h2>Lessons</h2>
        <p>Choose an installed lesson or resume your saved lesson.</p>
      </div>
      <v-btn variant="text" min-height="48" :disabled="busy || catalogueLoading || learningLoading" @click="emit('refresh')">Refresh lessons</v-btn>
    </header>

    <v-skeleton-loader v-if="learningLoading && !savedAttempt" type="list-item-two-line" aria-label="Loading saved lesson" />
    <v-alert v-if="learningError || learningInvalid" type="error" variant="tonal" role="alert">
      {{ learningError || 'Saved learning could not be displayed. Refresh before requesting a lesson; no progress was changed.' }}
    </v-alert>
    <p v-else-if="!learningLoading && (!learningResult || learningResult.ok !== true || learningResult.available !== true)" role="status">
      {{ learningResult?.error || 'Saved learning is not available yet. No lesson has been started here.' }}
    </p>
    <v-card v-if="savedAttempt" variant="outlined" class="training-lesson-picker__saved">
      <v-card-title>Saved lesson · {{ savedAttempt.pin.lesson.code }}</v-card-title>
      <v-card-text>
        <p>{{ savedAttempt.pin.course.courseId }} · {{ savedAttempt.pin.course.release }}</p>
        <p v-if="completion">{{ completion.passed }} of {{ completion.required }} required assessments passed. {{ completion.completed ? 'Required assessments complete.' : 'Continue the remaining assessments.' }}</p>
        <p v-else>Saved attempt retained. Completion has not been reported.</p>
        <p v-if="learningResult.activeSummaryCurrent === false">The saved summary needs reconciliation. Resume rechecks this same attempt; reading it does not repair it.</p>
        <details>
          <summary>Saved lesson identity</summary>
          <dl>
            <dt>Topic</dt><dd>{{ savedAttempt.pin.topic.topicId }} · {{ savedAttempt.pin.topic.release }}</dd>
            <dt>Commit</dt><dd><code>{{ savedAttempt.pin.topic.commit }}</code></dd>
            <dt>Lesson hash</dt><dd><code>{{ savedAttempt.pin.lesson.hash }}</code></dd>
            <dt>Attempt</dt><dd><code>{{ savedAttempt.attemptId }}</code></dd>
          </dl>
        </details>
        <p v-if="!canResume">Lesson resume is unavailable in this installation. Your saved attempt remains visible.</p>
      </v-card-text>
      <v-card-actions><v-btn variant="tonal" min-height="48" :disabled="!resumeEnabled" @click="requestResume">Resume saved lesson</v-btn></v-card-actions>
    </v-card>

    <v-skeleton-loader v-if="catalogueLoading && !courses.length" type="heading, list-item-two-line, list-item-two-line" aria-label="Loading installed lessons" />
    <v-alert v-if="catalogueError || catalogueInvalid" type="error" variant="tonal" role="alert">
      {{ catalogueError || 'Installed lesson choices could not be displayed. Refresh or ask the owner to restore the exact content; nothing was installed or enabled.' }}
    </v-alert>
    <p v-else-if="!catalogueLoading && (!catalogueResult || catalogueResult.ok !== true || catalogueResult.available !== true)" role="status">
      {{ catalogueResult?.error || 'Installed lessons are not available yet.' }}
    </p>
    <p v-else-if="!catalogueLoading && courses.length === 0" role="status">No courses are installed. Ask the owner to install and enable a course; this picker cannot install one.</p>

    <v-radio-group v-if="courses.length" v-model="selectionId" label="Choose a lesson" class="training-lesson-picker__choices" :disabled="busy || catalogueLoading || !!catalogueError">
      <v-card v-for="course in courses" :key="JSON.stringify([course.courseId, course.release])" variant="outlined">
        <v-card-title>{{ course.title }}</v-card-title>
        <v-card-subtitle>{{ course.courseId }} · {{ course.release }} · {{ !course.enabled ? 'Disabled for new lessons' : course.status === 'released' ? 'Enabled' : 'Preview course' }}</v-card-subtitle>
        <v-card-text>
          <p v-if="course.lessons.length === 0">This course has no displayed lesson choices.</p>
          <div v-for="lesson in course.lessons" :key="choiceId(course, lesson)" class="training-lesson-picker__choice">
            <v-radio :value="choiceId(course, lesson)" :label="lesson.code" :disabled="!offered(course, lesson)" />
            <p>{{ lesson.topicId }} · {{ lesson.topicRelease }} · {{ lesson.status === 'published' ? 'Published' : 'Draft — unavailable for new lessons' }}</p>
            <details><summary>Lesson identity</summary><code>{{ lesson.hash }}</code></details>
          </div>
        </v-card-text>
      </v-card>
    </v-radio-group>
    <div v-if="courses.length" class="training-lesson-picker__start">
      <p v-if="savedAttempt">Resume your saved lesson. Starting a different lesson requires explicitly ending that attempt first; its history remains retained.</p>
      <p v-else-if="!canStart">Starting lessons is unavailable in this installation.</p>
      <p v-else-if="!selected">Select a published lesson from an enabled release.</p>
      <v-btn variant="tonal" min-height="48" :disabled="!startEnabled" @click="requestStart">Start selected lesson</v-btn>
    </div>

    <details v-if="history.length" class="training-lesson-picker__history">
      <summary>Saved lesson history ({{ history.length }})</summary>
      <ol>
        <li v-for="attempt in history" :key="attempt.attemptId">
          <strong>{{ attempt.pin.lesson.code }}</strong> · {{ attempt.pin.course.courseId }} · {{ attempt.pin.course.release }}
          <p>Ended attempt · <code>{{ attempt.attemptId }}</code></p>
          <p>Topic {{ attempt.pin.topic.topicId }} · {{ attempt.pin.topic.release }} · <code>{{ attempt.pin.topic.commit }}</code></p>
          <p>Lesson hash · <code>{{ attempt.pin.lesson.hash }}</code></p>
        </li>
      </ol>
    </details>
  </section>
</template>

<style scoped>
.training-lesson-picker { display: flex; flex-direction: column; gap: 1rem; min-width: 0; padding: 1rem; overflow: auto; }
.training-lesson-picker__header { display: flex; flex-wrap: wrap; align-items: start; justify-content: space-between; gap: 0.5rem; }
.training-lesson-picker__header h2 { font-size: 1.25rem; }
.training-lesson-picker__header p { margin-top: 0.25rem; }
.training-lesson-picker__choices :deep(.v-selection-control-group) { gap: 1rem; }
.training-lesson-picker__choice + .training-lesson-picker__choice { margin-top: 1rem; }
.training-lesson-picker__choice p { margin-bottom: 0.5rem; }
.training-lesson-picker__saved p + p { margin-top: 0.5rem; }
.training-lesson-picker__history li + li { margin-top: 1rem; }
.training-lesson-picker :deep(.v-card-title), .training-lesson-picker :deep(.v-card-subtitle), .training-lesson-picker p, .training-lesson-picker code, .training-lesson-picker dd { white-space: normal; overflow-wrap: anywhere; }
.training-lesson-picker dl { margin-top: 0.5rem; }
.training-lesson-picker dt { font-weight: 600; }
.training-lesson-picker dd { margin-bottom: 0.5rem; }
</style>
