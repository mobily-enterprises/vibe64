<script setup>
import { computed, ref, watch } from "vue";
import TrainingCourseCreator from "./TrainingCourseCreator.vue";
import TrainingCoursePage from "./TrainingCoursePage.vue";
import TrainingCourseArt from "./TrainingCourseArt.vue";
import TrainingCourseCatalogue from "./TrainingCourseCatalogue.vue";
import TrainingProgressRing from "./TrainingProgressRing.vue";
import TrainingStartFeedback from "./TrainingStartFeedback.vue";
import { courseProgress, courseStatusLabel, offered, previewCourse, previewNote } from "./courseProgress.js";
import { trainingIcons as icons } from "./trainingIcons.js";

const props = defineProps({
  catalogueResult: { type: Object, default: null },
  learningResult: { type: Object, default: null },
  catalogueLoading: Boolean,
  learningLoading: Boolean,
  catalogueError: { type: String, default: "" },
  learningError: { type: String, default: "" },
  busy: Boolean,
  canStart: Boolean,
  canResume: Boolean,
  // Optional owner-only custom course request; resolves to the confirmed result or null.
  createCourse: { type: Function, default: null },
  starting: Boolean,
  startUnconfirmed: Boolean,
  // The host's message when the last start requested here failed.
  startError: { type: String, default: "" },
  // Optional official catalogue: supplied only where installation is composed.
  availableResult: { type: Object, default: null },
  availableLoading: Boolean,
  availableError: { type: String, default: "" },
  installState: { type: Object, default: null }
});
const emit = defineEmits(["refresh", "start", "resume", "install"]);
const selectionId = ref("");
const text = value => typeof value === "string" && value.length > 0;
const revision = value => Number.isSafeInteger(value) && value >= 0;
const lessonTitlesMissing = computed(() => Array.isArray(props.catalogueResult?.courses) &&
  props.catalogueResult.courses.some(course => Array.isArray(course?.lessons) &&
    course.lessons.some(lesson => !text(lesson?.title))));

// These are display-shape guards, not replicas of the server's content,
// permission, pin, progress or admission validators.
const catalogueInvalid = computed(() => {
  const result = props.catalogueResult;
  return result?.ok === true && result.available === true && (!revision(result.revision) ||
    !Array.isArray(result.courses) || result.courses.some(course =>
      !text(course?.courseId) || !text(course.release) || !text(course.title) ||
      typeof course.enabled !== "boolean" || !text(course.status) || !Array.isArray(course.lessons) ||
      !Array.isArray(course.topics) || course.topics.some(topic => !text(topic?.topicId) || !text(topic.release) || !text(topic.title)) ||
      course.lessons.some(lesson => !text(lesson?.code) || !text(lesson.hash) ||
        !text(lesson.topicId) || !text(lesson.topicRelease) || !text(lesson.status) || !text(lesson.title))));
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
  if (result.lessonProgress !== undefined && (!Array.isArray(result.lessonProgress) || result.lessonProgress.some(value =>
    !text(value?.lessonCode) || !text(value.lessonHash) || !revision(value.required) || !revision(value.passed) ||
    value.passed > value.required || typeof value.completed !== "boolean" || typeof value.open !== "boolean"))) return true;
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
// A different lesson may be started while one is in progress: the server
// refuses it once and the host asks to archive the current one first.
const startPossible = computed(() => Boolean(props.canStart && !props.starting && !props.startUnconfirmed && !props.busy &&
  !props.catalogueLoading && !props.catalogueError && learningReady.value));
// Display only: the server admits preview lessons for the workspace owner alone.
const canTryPreviews = computed(() => !catalogueInvalid.value && props.catalogueResult?.ok === true &&
  props.catalogueResult.canTryPreviews === true);
const startEnabled = computed(() => startPossible.value && selected.value &&
  offered(selected.value.course, selected.value.lesson, canTryPreviews.value));
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
// Course Start selects one exact displayed lesson for the same original start.
function startLesson(course, lesson) {
  selectionId.value = choiceId(course, lesson);
  if (startEnabled.value) startedFrom.value = { key: courseKey(course), lesson: choiceId(course, lesson) };
  requestStart();
}
// Start feedback is shown on the course and lesson that requested it.
const startedFrom = ref(null);
const startFeedback = computed(() => !startedFrom.value ? null
  : props.starting ? { phase: "starting" }
    : props.startError ? { phase: "failed", message: props.startError }
      : props.startUnconfirmed ? { phase: "unconfirmed" } : null);
const feedbackFor = key => startedFrom.value?.key === key ? startFeedback.value : null;
const startingHere = (course, lesson) => props.starting && startedFrom.value?.lesson === choiceId(course, lesson);

const courseKey = course => JSON.stringify([course.courseId, course.release]);
const lessonProgress = computed(() => !learningInvalid.value && props.learningResult?.ok === true &&
  props.learningResult.available === true ? props.learningResult.lessonProgress || [] : []);
const releaseOrder = (left, right) => {
  const a = left.split(".").map(Number), b = right.split(".").map(Number);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
};
// A release that an update disabled stays installed for its saved attempts;
// it is listed only while a saved lesson still uses it.
const superseded = course => !course.enabled && courses.value.some(other => other.courseId === course.courseId && other.enabled &&
  releaseOrder(other.release, course.release) > 0);
const summaries = computed(() => courses.value.map(course => ({ course, key: courseKey(course),
  progress: courseProgress(course, lessonProgress.value, savedAttempt.value, history.value, { canTryPreviews: canTryPreviews.value }) }))
  .filter(summary => !superseded(summary.course) || summary.progress.activeHere));
const availableCourses = computed(() => props.availableResult?.ok === true && Array.isArray(props.availableResult.courses)
  ? props.availableResult.courses : []);
// The newer catalogue release offered as this installed card's update.
const updateFor = course => availableCourses.value.find(value => value.courseId === course.courseId &&
  value.updateFrom === course.release && value.installed === "not-installed") || null;
const showCatalogue = computed(() => Boolean(props.availableResult || props.availableLoading || props.availableError));
function requestInstall(selection) {
  if (!props.busy) emit("install", selection);
}
function viewInstalled({ courseId, release }) {
  openCourseKey.value = courseKey({ courseId, release });
}
const openCourseKey = ref("");
const openCourse = computed(() => summaries.value.find(summary => summary.key === openCourseKey.value) || null);
watch(summaries, values => {
  if (!props.catalogueLoading && openCourseKey.value && !values.some(value => value.key === openCourseKey.value)) openCourseKey.value = "";
});

const creating = ref(false);
const canCreateCourses = computed(() => typeof props.createCourse === "function" && !catalogueInvalid.value &&
  props.catalogueResult?.ok === true && props.catalogueResult.canCreateCourses === true);
const availableTopics = computed(() => [...new Map(courses.value.filter(course => course.enabled && course.status === "released")
  .flatMap(course => course.topics).map(topic => [JSON.stringify([topic.topicId, topic.release]), topic])).values()]);
async function requestCreateCourse(input) {
  if (!canCreateCourses.value || props.busy) return;
  const result = await props.createCourse({ ...input, expectedRevision: props.catalogueResult.revision });
  if (result?.ok !== true || !result.course) return;
  creating.value = false;
  openCourseKey.value = courseKey(result.course);
}

// Display-only lookups for the saved lesson card: the readable title of the
// exact pinned lesson when the current catalogue still lists it.
const savedPlace = computed(() => {
  const pin = savedAttempt.value?.pin;
  if (!pin) return null;
  const course = courses.value.find(value => value.courseId === pin.course.courseId && value.release === pin.course.release);
  const lesson = course?.lessons.find(value => value.code === pin.lesson.code && value.hash === pin.lesson.hash);
  return { courseTitle: course?.title || "", lessonTitle: lesson?.title || "" };
});
const statusTone = course => !course.enabled ? "disabled" : course.status === "released" ? "enabled" : "preview";
const statusIcon = { enabled: icons.checkCircle, preview: icons.eye, disabled: icons.cancel };
// Installed lessons this Vibe64 cannot teach are left out of the course and named.
function unusableNote(course) {
  const titles = course.unusableLessons.map(lesson => lesson.title).join(", ");
  return `${course.unusableLessons.length === 1 ? "One lesson is" : `${course.unusableLessons.length} lessons are`} not shown because this version of Vibe64 can't teach ${course.unusableLessons.length === 1 ? "it" : "them"}: ${titles}. Update the course when Courses offers an update.`;
}

// The header counts the cards shown (an older release an update replaced is
// hidden); lessons shared by several courses count once.
const uniqueLessonCount = computed(() => new Set(summaries.value.flatMap(({ course }) =>
  course.lessons.map(lesson => `${lesson.code}\n${lesson.hash}`))).size);
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
</script>
<template>
  <section class="training-lesson-picker" :class="{ 'training-lesson-picker--course-open': openCourse }" aria-label="Courses"
    :aria-busy="catalogueLoading || learningLoading">
    <header class="tlp-hero">
      <svg class="tlp-hero__art" viewBox="0 0 240 160" aria-hidden="true" focusable="false">
        <circle cx="188" cy="34" r="58" class="tlp-hero__sun" />
        <path d="M18 132 C 62 132, 64 92, 104 92 S 150 52, 196 52" class="tlp-hero__trail" />
        <circle cx="18" cy="132" r="9" class="tlp-hero__stop tlp-hero__stop--done" />
        <circle cx="104" cy="92" r="9" class="tlp-hero__stop tlp-hero__stop--done" />
        <circle cx="196" cy="52" r="11" class="tlp-hero__stop" />
        <path d="M190 52 l4.5 4.5 l8 -9" class="tlp-hero__tick" />
      </svg>
      <div class="tlp-hero__text">
        <p class="tlp-eyebrow"><v-icon :icon="icons.school" size="18" /> Learning</p>
        <h2>Courses</h2>
        <p>Choose a course to see its lessons and your progress, or continue your lesson.</p>
        <p v-if="summaries.length" class="tlp-hero__meta">
          {{ plural(summaries.length, 'course') }} · {{ plural(uniqueLessonCount, 'lesson') }} installed
        </p>
      </div>
      <v-btn class="tlp-hero__refresh" variant="tonal" rounded="pill" min-height="48" :prepend-icon="icons.refresh"
        :disabled="busy || catalogueLoading || learningLoading" @click="emit('refresh')">Refresh courses</v-btn>
    </header>

    <div v-if="learningLoading && !savedAttempt" class="tlp-skeleton tlp-skeleton--saved" role="status" aria-label="Loading saved lesson">
      <span class="tlp-shimmer tlp-shimmer--ring" />
      <span class="tlp-skeleton__lines"><span class="tlp-shimmer" style="width: 40%" /><span class="tlp-shimmer" style="width: 70%" /><span class="tlp-shimmer" style="width: 55%" /></span>
    </div>
    <v-alert v-if="learningError || learningInvalid" type="error" variant="tonal" rounded="lg" role="alert">
      {{ learningError || 'Saved learning could not be displayed. Refresh before requesting a lesson; no progress was changed.' }}
    </v-alert>
    <p v-else-if="!learningLoading && (!learningResult || learningResult.ok !== true || learningResult.available !== true)" class="tlp-note" role="status">
      <v-icon :icon="icons.info" size="20" />
      <span>{{ learningResult?.error || 'Saved learning is not available yet. No lesson has been started here.' }}</span>
    </p>

    <article v-if="savedAttempt" class="tlp-saved training-lesson-picker__saved" aria-labelledby="tlp-saved-heading">
      <div class="tlp-saved__glow" aria-hidden="true" />
      <TrainingProgressRing v-if="completion" class="tlp-saved__ring" :value="completion.passed" :max="completion.required" :size="96" :stroke="10"
        :label="`${completion.passed} of ${completion.required} required steps done`">
        <span class="tlp-saved__ring-value"><strong>{{ completion.passed }}</strong> of {{ completion.required }}<small>required done</small></span>
      </TrainingProgressRing>
      <div v-else class="tlp-saved__badge" aria-hidden="true"><v-icon :icon="icons.bookmark" size="36" /></div>
      <div class="tlp-saved__body">
        <p id="tlp-saved-heading" class="tlp-eyebrow tlp-eyebrow--learning">Lesson in progress · {{ savedAttempt.pin.lesson.code }}</p>
        <h3 class="tlp-saved__title">{{ savedPlace.lessonTitle || 'Continue where you left off' }}</h3>
        <p class="tlp-saved__meta">
          <template v-if="savedPlace.courseTitle">{{ savedPlace.courseTitle }} · </template>{{ savedAttempt.pin.course.courseId }} · {{ savedAttempt.pin.course.release }}
        </p>
        <p v-if="completion" class="tlp-saved__status">
          <v-icon v-if="completion.completed" :icon="icons.checkCircle" size="18" color="success" />
          {{ completion.passed }} of {{ completion.required }} required steps done. {{ completion.completed ? 'This lesson is complete.' : 'Continue the remaining steps.' }}
        </p>
        <p v-else class="tlp-saved__status">Saved attempt retained. Completion has not been reported.</p>
        <p v-if="learningResult.activeSummaryCurrent === false" class="tlp-note tlp-note--warn">The saved summary needs reconciliation. Continue lesson rechecks this same attempt; reading it does not repair it.</p>
        <p v-if="!canResume" class="tlp-note">Continuing a lesson is unavailable in this installation. Your lesson remains visible.</p>
        <div class="tlp-saved__actions">
          <v-btn color="primary" variant="flat" rounded="pill" size="large" min-height="48" :prepend-icon="icons.play"
            :disabled="!resumeEnabled" @click="requestResume">Continue lesson</v-btn>
        </div>
        <details class="tlp-identity">
          <summary><v-icon :icon="icons.info" size="18" /><span>Saved lesson identity</span><v-icon class="tlp-chevron" :icon="icons.chevronDown" size="18" /></summary>
          <dl>
            <dt>Topic</dt><dd>{{ savedAttempt.pin.topic.topicId }} · {{ savedAttempt.pin.topic.release }}</dd>
            <dt>Commit</dt><dd><code>{{ savedAttempt.pin.topic.commit }}</code></dd>
            <dt>Lesson hash</dt><dd><code>{{ savedAttempt.pin.lesson.hash }}</code></dd>
            <dt>Attempt</dt><dd><code>{{ savedAttempt.attemptId }}</code></dd>
          </dl>
        </details>
      </div>
    </article>

    <div v-if="catalogueLoading && !courses.length" class="tlp-grid" role="status" aria-label="Loading installed courses">
      <div v-for="index in 3" :key="index" class="tlp-skeleton tlp-skeleton--card">
        <span class="tlp-shimmer tlp-shimmer--art" />
        <span class="tlp-skeleton__lines"><span class="tlp-shimmer" style="width: 65%; height: 18px" /><span class="tlp-shimmer" style="width: 45%" /><span class="tlp-shimmer" style="width: 80%" /></span>
      </div>
    </div>
    <v-alert v-if="catalogueError || catalogueInvalid" type="error" variant="tonal" rounded="lg" role="alert">
      {{ catalogueError || (lessonTitlesMissing ? 'Lesson titles are unavailable. Refresh courses; your saved lesson and history remain retained.' : 'Installed courses could not be displayed. Refresh or ask the owner to restore the exact content; nothing was installed or enabled.') }}
    </v-alert>
    <div v-else-if="!catalogueLoading && (!catalogueResult || catalogueResult.ok !== true || catalogueResult.available !== true)" class="tlp-empty" role="status">
      <v-icon :icon="icons.info" size="32" class="tlp-empty__icon" />
      <p>{{ catalogueResult?.error || 'Installed courses are not available yet.' }}</p>
    </div>
    <div v-else-if="!catalogueLoading && courses.length === 0" class="tlp-empty" role="status">
      <svg class="tlp-empty__art" viewBox="0 0 120 80" aria-hidden="true" focusable="false">
        <rect x="10" y="66" width="100" height="6" rx="3" class="tlp-empty__shelf" />
        <rect x="24" y="30" width="16" height="36" rx="3" class="tlp-empty__book" />
        <rect x="44" y="22" width="14" height="44" rx="3" class="tlp-empty__book tlp-empty__book--alt" />
        <rect x="70" y="40" width="16" height="26" rx="3" class="tlp-empty__book tlp-empty__book--ghost" transform="rotate(-12 78 53)" />
      </svg>
      <p v-if="showCatalogue">No courses are installed yet. Choose a course in the catalogue below and select Install.</p>
      <p v-else>No courses are installed. Ask the owner to install and enable a course; this page cannot install one.</p>
    </div>

    <TrainingCoursePage
      v-if="openCourse"
      :course="openCourse.course"
      :progress="openCourse.progress"
      :start-allowed="startPossible"
      :can-try-previews="canTryPreviews"
      :resume-allowed="!!resumeEnabled"
      :start-feedback="feedbackFor(openCourse.key)"
      :starting-lesson="lesson => startingHere(openCourse.course, lesson)"
      @back="openCourseKey = ''"
      @start="startLesson(openCourse.course, $event)"
      @resume="requestResume"
    />
    <template v-else>
      <div v-if="courses.length" class="tlp-grid training-lesson-picker__courses">
        <article v-for="({ course, key, progress }, index) in summaries" :key="key" class="tlp-card"
          :class="{ 'tlp-card--active': progress.activeHere, 'tlp-card--off': statusTone(course) !== 'enabled' }"
          :style="{ '--tlp-index': index }" :aria-label="course.title">
          <div class="tlp-card__cover">
            <TrainingCourseArt :course-id="course.courseId" :title="course.title" :statuses="progress.lessons.map(value => value.status)" />
            <div class="tlp-card__chips">
              <span v-if="progress.activeHere" class="tlp-chip tlp-chip--learning"><v-icon :icon="icons.bookmark" size="14" />Lesson in progress</span>
              <span v-else-if="progress.total && progress.completed === progress.total" class="tlp-chip tlp-chip--success"><v-icon :icon="icons.trophy" size="14" />Course complete</span>
              <span class="tlp-chip" :class="`tlp-chip--${statusTone(course)}`"><v-icon :icon="statusIcon[statusTone(course)]" size="14" />{{ courseStatusLabel(course) }}</span>
              <span v-if="updateFor(course)" class="tlp-chip tlp-chip--learning"><v-icon :icon="icons.update" size="14" />Update available: {{ updateFor(course).release }}</span>
            </div>
          </div>
          <div class="tlp-card__body">
            <h3 class="tlp-card__title">{{ course.title }}</h3>
            <p class="tlp-card__id"><code>{{ course.courseId }} · {{ course.release }}</code></p>
            <p class="tlp-card__facts">
              <span><v-icon :icon="icons.layers" size="16" />{{ plural(course.topics.length, 'topic') }}</span>
              <span><v-icon :icon="icons.book" size="16" />{{ plural(course.lessons.length, 'lesson') }}</span>
            </p>
            <p v-if="course.unusableLessons?.length" class="tlp-card__next" role="note">{{ unusableNote(course) }}</p>
            <div class="tlp-card__progress">
              <TrainingProgressRing :value="progress.completed" :max="progress.total" :size="48" :stroke="5"
                :label="`${course.title}: ${progress.completed} of ${progress.total} lessons complete`" />
              <div>
                <p class="tlp-card__count">{{ progress.completed }} of {{ progress.total }} lessons complete</p>
                <p v-if="progress.next && !progress.activeHere" class="tlp-card__next">Next: {{ progress.next.title }}</p>
                <p v-else-if="previewCourse(course) && !canTryPreviews && !progress.activeHere" class="tlp-card__next tlp-card__preview-note">{{ previewNote }}</p>
              </div>
            </div>
            <TrainingStartFeedback v-if="feedbackFor(key)" :feedback="feedbackFor(key)" />
          </div>
          <div class="tlp-card__actions">
            <v-btn v-if="progress.activeHere" color="primary" variant="flat" rounded="pill" min-height="48" :prepend-icon="icons.play"
              :disabled="!resumeEnabled" @click="requestResume">Continue lesson</v-btn>
            <v-btn v-else-if="progress.next" color="primary" variant="flat" rounded="pill" min-height="48"
              :prepend-icon="startingHere(course, progress.next) ? undefined : icons.play"
              :readonly="startingHere(course, progress.next)" :disabled="!startPossible && !startingHere(course, progress.next)"
              @click="startLesson(course, progress.next)">
              <template v-if="startingHere(course, progress.next)"><v-progress-circular indeterminate size="18" width="2" class="tlp-card__spinner" />Starting lesson…</template>
              <template v-else>Start lesson</template>
            </v-btn>
            <v-btn v-if="updateFor(course)" variant="tonal" rounded="pill" min-height="48" :prepend-icon="icons.update"
              :loading="installState?.phase === 'installing' && installState.courseId === course.courseId"
              :disabled="busy" @click="requestInstall({ courseId: course.courseId, release: updateFor(course).release })">Update</v-btn>
            <v-btn variant="text" rounded="pill" min-height="48" :append-icon="icons.arrowRight" @click="openCourseKey = key">View course</v-btn>
          </div>
        </article>
        <div v-if="canCreateCourses && !creating" class="tlp-new" :style="{ '--tlp-index': summaries.length }">
          <span class="tlp-new__icon" aria-hidden="true"><v-icon :icon="icons.path" size="28" /></span>
          <p>Combine installed topics into a course of your own.</p>
          <v-btn variant="tonal" rounded="pill" min-height="48" :prepend-icon="icons.plus" :disabled="busy || catalogueLoading" @click="creating = true">New course</v-btn>
        </div>
      </div>
      <TrainingCourseCreator v-if="creating && canCreateCourses" :topics="availableTopics" :busy="busy" @create="requestCreateCourse" @cancel="creating = false" />
      <div v-else-if="canCreateCourses && !courses.length"><v-btn variant="tonal" rounded="pill" min-height="48" :prepend-icon="icons.plus" :disabled="busy || catalogueLoading" @click="creating = true">New course</v-btn></div>
      <TrainingCourseCatalogue v-if="showCatalogue && !creating" :available-result="availableResult" :available-loading="availableLoading"
        :available-error="availableError" :install-state="installState" :busy="busy"
        @install="requestInstall" @view="viewInstalled" @refresh="emit('refresh')" />
    </template>
    <div v-if="courses.length && (savedAttempt || (startUnconfirmed && !startFeedback) || !canStart)" class="training-lesson-picker__start">
      <p v-if="savedAttempt" class="tlp-note"><v-icon :icon="icons.info" size="20" /><span>A lesson is in progress. Starting a different one first asks to archive it.</span></p>
      <p v-else-if="startUnconfirmed && !startFeedback" class="tlp-note tlp-note--warn"><v-icon :icon="icons.info" size="20" /><span>The last lesson start was not confirmed. Use Retry lesson start to repeat that same request.</span></p>
      <p v-else-if="!canStart" class="tlp-note"><v-icon :icon="icons.info" size="20" /><span>Starting lessons is unavailable in this installation.</span></p>
    </div>

    <details v-if="history.length" class="tlp-history training-lesson-picker__history">
      <summary><v-icon :icon="icons.history" size="20" /><span>Saved lesson history ({{ history.length }})</span><v-icon class="tlp-chevron" :icon="icons.chevronDown" size="18" /></summary>
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
.training-lesson-picker {
  --tlp-gap: var(--v64-space-4, 16px);
  display: flex; flex-direction: column; gap: var(--v64-space-5, 24px); min-width: 0;
  padding: var(--v64-space-4, 16px); overflow: auto; container-type: inline-size;
  color: var(--v64-on-surface);
}
.training-lesson-picker p, .training-lesson-picker code, .training-lesson-picker dd, .training-lesson-picker h3 { white-space: normal; overflow-wrap: anywhere; }
.training-lesson-picker :deep(.v-label) { white-space: normal; overflow-wrap: anywhere; }
.training-lesson-picker :deep(.v-btn) { letter-spacing: 0.01em; text-transform: none; font-weight: 600; }
/* M3 disabled filled button: neutral container, not a faded primary. */
.training-lesson-picker :deep(.v-btn--variant-flat.v-btn--disabled) { background: rgba(var(--v-theme-on-surface), 0.12) !important; color: rgba(var(--v-theme-on-surface), 0.5) !important; }
.training-lesson-picker :deep(.v-btn--variant-flat.v-btn--disabled .v-btn__overlay) { opacity: 0; }

/* Eyebrow labels */
.tlp-eyebrow {
  display: inline-flex; align-items: center; gap: var(--v64-space-1, 4px); margin: 0;
  font: var(--v64-type-label-md); letter-spacing: 0.08em; text-transform: uppercase; color: var(--v64-on-surface-variant);
}
.tlp-eyebrow--learning { color: var(--v64-on-learning-container); }

/* Hero */
.tlp-hero {
  position: relative; display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between;
  gap: var(--v64-space-4, 16px); overflow: hidden; isolation: isolate;
  padding: var(--v64-space-5, 24px); border-radius: var(--v64-shape-xl, 28px);
  background:
    radial-gradient(120% 140% at 100% 0%, var(--v64-learning-container) 0%, transparent 55%),
    linear-gradient(135deg, var(--v64-surface-container-high) 0%, var(--v64-primary-container) 100%);
}
.tlp-hero__art { position: absolute; right: -8px; top: -6px; width: 260px; height: auto; z-index: -1; opacity: 0.95; }
.tlp-hero__sun { fill: var(--v64-learning); opacity: 0.35; }
.tlp-hero__trail { fill: none; stroke: var(--v64-on-primary-container); stroke-width: 3; stroke-dasharray: 2 8; stroke-linecap: round; opacity: 0.45; }
.tlp-hero__stop { fill: var(--v64-surface); stroke: var(--v64-on-primary-container); stroke-width: 3; opacity: 0.9; }
.tlp-hero__stop--done { fill: var(--v64-primary); stroke: var(--v64-primary); opacity: 0.55; }
.tlp-hero__stop:not(.tlp-hero__stop--done) { fill: var(--v64-learning); stroke: var(--v64-on-learning); opacity: 0.85; }
.tlp-hero__tick { fill: none; stroke: var(--v64-on-learning); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; opacity: 0.8; }
.tlp-hero__text { flex: 1 1 18rem; min-width: 0; max-width: 34rem; }
.tlp-hero__text h2 { margin: var(--v64-space-1, 4px) 0 var(--v64-space-2, 8px); font: var(--v64-type-display-sm); letter-spacing: -0.01em; }
.tlp-hero__text p { margin: 0; font: var(--v64-type-body-lg); color: var(--v64-on-surface-variant); }
.tlp-hero__text .tlp-eyebrow { color: var(--v64-on-learning-container); }
.tlp-hero__text .tlp-hero__meta { margin-top: var(--v64-space-3, 12px); font: var(--v64-type-label-lg); color: var(--v64-on-primary-container); }
.tlp-hero__refresh { flex: none; background: var(--v64-surface) !important; }
.training-lesson-picker--course-open .tlp-hero { padding-block: var(--v64-space-4, 16px); }
.training-lesson-picker--course-open .tlp-hero__text h2 { font: var(--v64-type-headline-sm); }
.training-lesson-picker--course-open .tlp-hero__text > p:not(.tlp-eyebrow) { display: none; }

/* Notes and banners */
.tlp-note {
  display: flex; align-items: flex-start; gap: var(--v64-space-3, 12px); margin: 0;
  padding: var(--v64-space-3, 12px) var(--v64-space-4, 16px); border-radius: var(--v64-shape-lg, 16px);
  background: var(--v64-surface-container); color: var(--v64-on-surface-variant); font: var(--v64-type-body-md);
}
.tlp-note :deep(.v-icon), .tlp-note :deep(.v-progress-circular) { flex: none; margin-top: 1px; }
.tlp-note--warn { background: var(--v64-learning-container); color: var(--v64-on-learning-container); }

/* Saved lesson hero */
.tlp-saved {
  position: relative; display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--v64-space-5, 24px);
  overflow: hidden; isolation: isolate; padding: var(--v64-space-5, 24px);
  border-radius: var(--v64-shape-xl, 28px); border: 1px solid color-mix(in srgb, var(--v64-learning) 45%, transparent);
  background: linear-gradient(120deg, var(--v64-learning-container) 0%, var(--v64-surface-container-low) 70%);
  box-shadow: var(--v64-elevation-1);
  animation: tlp-rise var(--v64-duration-long, 500ms) var(--v64-ease-emphasized-decelerate) both;
}
.tlp-saved__glow {
  position: absolute; z-index: -1; right: -60px; top: -80px; width: 260px; height: 260px; border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--v64-learning) 45%, transparent) 0%, transparent 70%);
}
.tlp-saved__ring { --training-ring-color: var(--v64-primary); --training-ring-track: color-mix(in srgb, var(--v64-primary) 16%, transparent); }
.tlp-saved__ring-value { font: var(--v64-type-label-lg); color: var(--v64-on-surface-variant); }
.tlp-saved__ring-value strong { font: var(--v64-type-headline-sm); color: var(--v64-on-surface); }
.tlp-saved__ring-value { display: flex; flex-direction: column; align-items: center; line-height: 1.1; text-align: center; }
.tlp-saved__ring-value small { font-size: 0.6875rem; }
.tlp-saved__badge {
  flex: none; display: grid; place-items: center; width: 96px; height: 96px; border-radius: 50%;
  background: var(--v64-learning); color: var(--v64-on-learning); box-shadow: var(--v64-elevation-2);
}
.tlp-saved__body { flex: 1 1 16rem; min-width: 0; display: flex; flex-direction: column; gap: var(--v64-space-2, 8px); }
.tlp-saved__title { margin: 0; font: var(--v64-type-headline-sm); }
.tlp-saved__meta { margin: 0; font: var(--v64-type-body-md); color: var(--v64-on-surface-variant); }
.tlp-saved__status { display: flex; align-items: center; gap: var(--v64-space-2, 8px); margin: 0; font: var(--v64-type-body-lg); }
.tlp-saved .tlp-note { background: color-mix(in srgb, var(--v64-surface) 70%, transparent); }
.tlp-saved__actions { display: flex; flex-wrap: wrap; gap: var(--v64-space-2, 8px); margin-top: var(--v64-space-2, 8px); }

.tlp-identity {
  margin-top: var(--v64-space-2, 8px); padding-top: var(--v64-space-3, 12px);
  border-top: 1px solid color-mix(in srgb, var(--v64-on-surface) 10%, transparent);
  font: var(--v64-type-body-md); color: var(--v64-on-surface-variant);
}
.tlp-identity summary, .tlp-history summary { list-style: none; }
.tlp-identity summary::-webkit-details-marker, .tlp-history summary::-webkit-details-marker { display: none; }
.tlp-identity summary { border: 1px solid var(--v64-outline); background: color-mix(in srgb, var(--v64-surface) 60%, transparent); margin-left: 0 !important; }
.tlp-chevron { transition: transform var(--v64-duration-short) var(--v64-ease-standard); }
details[open] > summary .tlp-chevron { transform: rotate(180deg); }
.tlp-identity summary, .tlp-history summary {
  cursor: pointer; width: fit-content; min-height: 40px; display: inline-flex; align-items: center; gap: var(--v64-space-2, 8px);
  padding: 0 var(--v64-space-3, 12px); margin-left: calc(-1 * var(--v64-space-3, 12px)); border-radius: var(--v64-shape-full, 999px);
  font: var(--v64-type-label-lg); transition: background-color var(--v64-duration-short) var(--v64-ease-standard);
}
.tlp-identity summary:hover, .tlp-history summary:hover { background: rgba(var(--v-theme-on-surface), var(--v64-state-hover)); }
.tlp-identity summary:focus-visible, .tlp-history summary:focus-visible { outline: 2px solid var(--v64-primary); outline-offset: 2px; }
.tlp-identity dl {
  display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--v64-space-1, 4px) var(--v64-space-3, 12px);
  margin: var(--v64-space-2, 8px) 0 0; padding: var(--v64-space-3, 12px); border-radius: var(--v64-shape-md, 12px);
  background: color-mix(in srgb, var(--v64-surface) 75%, transparent);
}
.tlp-identity dt { font-weight: 600; color: var(--v64-on-surface); }
.tlp-identity dd { margin: 0; }
.tlp-identity code, .tlp-history code { font-size: 0.75rem; }

/* Course grid and cards */
.tlp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr)); gap: var(--tlp-gap); }
.tlp-card {
  position: relative; display: flex; flex-direction: column; min-width: 0; overflow: hidden;
  border-radius: var(--v64-shape-lg, 16px); background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant); box-shadow: var(--v64-elevation-1);
  transition: box-shadow var(--v64-duration-medium) var(--v64-ease-standard), transform var(--v64-duration-medium) var(--v64-ease-emphasized);
  animation: tlp-rise var(--v64-duration-long, 500ms) var(--v64-ease-emphasized-decelerate) both;
  animation-delay: calc(min(var(--tlp-index, 0), 8) * 60ms);
}
.tlp-card:hover, .tlp-card:focus-within { box-shadow: var(--v64-elevation-3); transform: translateY(-2px); }
.tlp-card--active { border-color: color-mix(in srgb, var(--v64-learning) 70%, transparent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--v64-learning) 45%, transparent), var(--v64-elevation-1); }
.tlp-card--off .tlp-card__cover { filter: saturate(0.35); }
.tlp-card__cover { position: relative; }
.tlp-card__chips { position: absolute; top: var(--v64-space-3, 12px); right: var(--v64-space-3, 12px); left: 72px; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--v64-space-1, 4px); }
.tlp-chip {
  display: inline-flex; align-items: center; gap: 4px; min-height: 26px; padding: 2px 10px 2px 8px;
  border-radius: var(--v64-shape-sm, 8px); font: var(--v64-type-label-md); white-space: nowrap;
  background: var(--v64-surface); color: var(--v64-on-surface); box-shadow: var(--v64-elevation-1);
}
.tlp-chip--enabled :deep(.v-icon) { color: rgb(var(--v-theme-success)); }
.tlp-chip--preview :deep(.v-icon) { color: rgb(var(--v-theme-primary)); }
.tlp-chip--disabled { background: var(--v64-surface-container-highest); color: var(--v64-on-surface-variant); }
.tlp-chip--learning { background: var(--v64-learning); color: var(--v64-on-learning); }
.tlp-chip--success { background: var(--v64-success-container); color: var(--v64-on-surface); }
.tlp-chip--success :deep(.v-icon) { color: rgb(var(--v-theme-success)); }
.tlp-card__body { flex: 1; display: flex; flex-direction: column; gap: var(--v64-space-2, 8px); padding: var(--v64-space-4, 16px) var(--v64-space-4, 16px) var(--v64-space-2, 8px); }
.tlp-card__title { margin: 0; font: var(--v64-type-title-lg); }
.tlp-card__id { margin: 0; }
.tlp-card__id code { padding: 1px 6px; border-radius: var(--v64-shape-xs, 4px); background: var(--v64-surface-container-high); color: var(--v64-on-surface-variant); font-size: 0.75rem; }
.tlp-card__facts { display: flex; flex-wrap: wrap; gap: var(--v64-space-4, 16px); margin: 0; font: var(--v64-type-body-md); color: var(--v64-on-surface-variant); }
.tlp-card__facts span { display: inline-flex; align-items: center; gap: 6px; }
.tlp-card__progress {
  display: flex; align-items: center; gap: var(--v64-space-3, 12px); margin-top: auto;
  padding: var(--v64-space-3, 12px); border-radius: var(--v64-shape-md, 12px); background: var(--v64-surface-container);
}
.tlp-card__progress :deep(.training-progress-ring__content) { font: var(--v64-type-label-md); }
.tlp-card__count { margin: 0; font: var(--v64-type-label-lg); }
.tlp-card__next { margin: 2px 0 0; font: var(--v64-type-body-md); color: var(--v64-on-surface-variant); }
.tlp-card__spinner { margin-right: var(--v64-space-2, 8px); }
.tlp-card__actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--v64-space-2, 8px); padding: var(--v64-space-2, 8px) var(--v64-space-4, 16px) var(--v64-space-4, 16px); }

.tlp-new {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--v64-space-3, 12px);
  min-height: 14rem; padding: var(--v64-space-5, 24px); text-align: center;
  border: 2px dashed var(--v64-outline); border-radius: var(--v64-shape-lg, 16px); color: var(--v64-on-surface-variant);
  animation: tlp-rise var(--v64-duration-long, 500ms) var(--v64-ease-emphasized-decelerate) both;
  animation-delay: calc(min(var(--tlp-index, 0), 8) * 60ms);
  transition: border-color var(--v64-duration-short) var(--v64-ease-standard), background-color var(--v64-duration-short) var(--v64-ease-standard);
}
.tlp-new:hover, .tlp-new:focus-within { border-color: var(--v64-primary); background: var(--v64-surface-container-low); }
.tlp-new p { margin: 0; max-width: 16rem; font: var(--v64-type-body-md); }
.tlp-new__icon { display: grid; place-items: center; width: 56px; height: 56px; border-radius: var(--v64-shape-lg, 16px); background: var(--v64-primary-container); color: var(--v64-on-primary-container); }

/* Skeletons */
.tlp-skeleton { display: flex; gap: var(--v64-space-4, 16px); border-radius: var(--v64-shape-lg, 16px); background: var(--v64-surface-container-low); border: 1px solid var(--v64-outline-variant); }
.tlp-skeleton--saved { align-items: center; padding: var(--v64-space-5, 24px); border-radius: var(--v64-shape-xl, 28px); }
.tlp-skeleton--card { flex-direction: column; overflow: hidden; }
.tlp-skeleton--card .tlp-skeleton__lines { padding: 0 var(--v64-space-4, 16px) var(--v64-space-5, 24px); }
.tlp-skeleton__lines { flex: 1; display: flex; flex-direction: column; gap: var(--v64-space-3, 12px); }
.tlp-shimmer {
  display: block; height: 12px; border-radius: var(--v64-shape-full, 999px);
  background: linear-gradient(90deg, var(--v64-surface-container-high) 0%, var(--v64-surface-container-highest) 40%, var(--v64-surface-container-high) 80%);
  background-size: 300% 100%; animation: tlp-shimmer 1.6s linear infinite;
}
.tlp-shimmer--ring { flex: none; width: 96px; height: 96px; border-radius: 50%; }
.tlp-shimmer--art { height: 112px; border-radius: 0; }

/* Empty states */
.tlp-empty {
  display: flex; flex-direction: column; align-items: center; gap: var(--v64-space-3, 12px); text-align: center;
  padding: var(--v64-space-6, 32px) var(--v64-space-5, 24px); border-radius: var(--v64-shape-xl, 28px);
  background: var(--v64-surface-container-low); border: 1px dashed var(--v64-outline); color: var(--v64-on-surface-variant);
}
.tlp-empty p { margin: 0; max-width: 28rem; font: var(--v64-type-body-lg); }
.tlp-empty__icon { color: var(--v64-primary); }
.tlp-empty__art { width: 132px; height: auto; }
.tlp-empty__shelf { fill: var(--v64-outline); }
.tlp-empty__book { fill: var(--v64-primary); opacity: 0.55; }
.tlp-empty__book--alt { fill: var(--v64-learning); opacity: 0.85; }
.tlp-empty__book--ghost { fill: none; stroke: var(--v64-outline); stroke-width: 2; stroke-dasharray: 3 3; }

/* History */
.tlp-history { padding: var(--v64-space-3, 12px) var(--v64-space-4, 16px); border-radius: var(--v64-shape-lg, 16px); border: 1px solid var(--v64-outline-variant); background: var(--v64-surface-container-lowest); }
.tlp-history summary { margin-left: calc(-1 * var(--v64-space-2, 8px)); padding: 0 var(--v64-space-2, 8px); }
.tlp-history ol { list-style: none; margin: var(--v64-space-3, 12px) 0 0; padding: 0 0 0 var(--v64-space-5, 24px); border-left: 2px solid var(--v64-outline-variant); }
.tlp-history li { position: relative; font: var(--v64-type-body-md); }
.tlp-history li::before { content: ""; position: absolute; left: calc(-1 * var(--v64-space-5, 24px) - 6px); top: 4px; width: 10px; height: 10px; border-radius: 50%; background: var(--v64-outline); }
.tlp-history li + li { margin-top: var(--v64-space-4, 16px); }
.tlp-history li p { margin: 2px 0 0; color: var(--v64-on-surface-variant); }

/* Dark theme: the shared on-learning-container token is too dim on the warm
   containers, so Learning labels use the bright Learning accent instead. */
:global(.v-theme--dark .tlp-eyebrow--learning), :global(.v-theme--dark .tlp-hero__text .tlp-eyebrow) { color: var(--v64-learning); }
:global(.v-theme--dark .tlp-note--warn) { color: var(--v64-on-surface); }
:global(.v-theme--dark .tlp-saved__ring) { --training-ring-track: rgba(var(--v-theme-on-surface), 0.16); }
:global(.v-theme--dark .tlp-saved) { background: linear-gradient(120deg, color-mix(in srgb, var(--v64-learning) 16%, rgb(var(--v-theme-surface))) 0%, var(--v64-surface-container-low) 70%); }

@keyframes tlp-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes tlp-shimmer { from { background-position: 100% 0; } to { background-position: -200% 0; } }

@container (max-width: 34rem) {
  .tlp-hero { padding: var(--v64-space-4, 16px); border-radius: var(--v64-shape-lg, 16px); }
  .tlp-hero__art { width: 170px; opacity: 0.55; }
  .tlp-hero__text h2 { font: var(--v64-type-headline-md); }
  .tlp-hero__refresh { width: 100%; }
  .tlp-saved { padding: var(--v64-space-4, 16px); gap: var(--v64-space-4, 16px); border-radius: var(--v64-shape-lg, 16px); }
  .tlp-saved__actions :deep(.v-btn) { flex: 1 1 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .tlp-card, .tlp-saved, .tlp-new { animation: none; transition: none; }
  .tlp-card:hover, .tlp-card:focus-within { transform: none; }
  .tlp-shimmer { animation: none; }
}
</style>
