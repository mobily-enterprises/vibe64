<script setup>
import { computed } from "vue";
import { courseStatusLabel, earlierCompletionLabel, offered, previewCourse, previewNote, statusLabels } from "./courseProgress.js";
import TrainingCourseArt from "./TrainingCourseArt.vue";
import TrainingProgressRing from "./TrainingProgressRing.vue";
import TrainingStartFeedback from "./TrainingStartFeedback.vue";

// Presentational course page. The parent picker owns every start/resume gate
// and emits only the original start and resume intents. Every mastery state,
// count and ring below is drawn from the supplied saved progress only.
const props = defineProps({
  course: { type: Object, required: true },
  progress: { type: Object, required: true },
  startAllowed: Boolean,
  // Display only: whether courses.list reports this person may try preview courses.
  canTryPreviews: Boolean,
  resumeAllowed: Boolean,
  // The picker's feedback for a start requested from this course, if any.
  startFeedback: { type: Object, default: null },
  // Whether the start of this exact lesson is in progress.
  startingLesson: { type: Function, default: () => false }
});
const emit = defineEmits(["all-courses", "start", "resume"]);

const complete = computed(() => Boolean(props.progress.total && props.progress.completed === props.progress.total));
const availability = computed(() => courseStatusLabel(props.course));
const preview = computed(() => previewCourse(props.course));
const isNext = lesson => Boolean(props.progress.next && props.progress.next.code === lesson.code && props.progress.next.hash === lesson.hash);
// One running step number across topics so the path reads as one journey.
const path = computed(() => {
  let step = 0;
  return props.progress.topics.map((topic, index) => ({
    topic,
    index: index + 1,
    done: topic.lessons.filter(value => value.status === "completed").length,
    lessons: topic.lessons.map(value => ({ ...value, step: ++step, next: isNext(value.lesson) }))
  }));
});
</script>

<template>
  <section class="training-course-page" :aria-label="`Course ${course.title}`">
    <div class="training-course-page__all">
      <v-btn variant="text" class="training-course-page__all-btn" @click="emit('all-courses')">All courses</v-btn>
    </div>

    <header class="training-course-page__hero" :class="{ 'is-complete': complete }">
      <TrainingCourseArt
        class="training-course-page__cover" :course-id="course.courseId" :title="course.title"
        :statuses="progress.lessons.map(value => value.status)"
      />
      <div class="training-course-page__hero-body">
        <div class="training-course-page__hero-text">
          <p class="training-course-page__eyebrow">Course</p>
          <h3 class="training-course-page__title">{{ course.title }}</h3>
          <div class="training-course-page__meta">
            <span class="training-course-page__chip"><code>{{ course.courseId }} · {{ course.release }}</code></span>
            <span class="training-course-page__chip" :class="{ 'is-muted': !course.enabled || course.status !== 'released' }">{{ availability }}</span>
            <span class="training-course-page__chip">{{ progress.topics.length }} {{ progress.topics.length === 1 ? 'topic' : 'topics' }}</span>
          </div>
          <p class="training-course-page__count">{{ progress.completed }} of {{ progress.total }} lessons complete</p>
        </div>
        <TrainingProgressRing
          class="training-course-page__ring" :value="progress.completed" :max="progress.total" :size="88" :stroke="9"
          :label="`${progress.completed} of ${progress.total} lessons complete`"
        >
          <span class="training-course-page__ring-value"><strong>{{ progress.completed }}</strong>/{{ progress.total }}</span>
        </TrainingProgressRing>
      </div>
    </header>

    <div class="training-course-page__next" :class="{ 'is-complete': complete }">
      <template v-if="progress.activeHere">
        <div class="training-course-page__next-text">
          <p class="training-course-page__next-label">Lesson in progress</p>
          <p class="training-course-page__next-title">Pick up where you left off.</p>
        </div>
        <v-btn color="primary" variant="flat" rounded="pill" :disabled="!resumeAllowed" @click="emit('resume')">Continue lesson</v-btn>
      </template>
      <template v-else-if="progress.next">
        <div class="training-course-page__next-text">
          <p class="training-course-page__next-label">Up next</p>
          <p class="training-course-page__next-title">{{ progress.next.title }} · {{ progress.next.code }}</p>
        </div>
        <v-btn
          color="primary" variant="flat" rounded="pill" :readonly="startingLesson(progress.next)"
          :disabled="!startAllowed && !startingLesson(progress.next)" @click="emit('start', progress.next)"
        >
          <template v-if="startingLesson(progress.next)"><v-progress-circular indeterminate size="18" width="2" class="training-course-page__spinner" />Starting lesson…</template>
          <template v-else>Start next lesson</template>
        </v-btn>
      </template>
      <div v-else-if="complete" class="training-course-page__next-text">
        <p class="training-course-page__next-label">All lessons done</p>
        <p class="training-course-page__next-title">Course complete.</p>
      </div>
      <p v-else-if="preview && !canTryPreviews" class="training-course-page__next-title training-course-page__preview-note">{{ previewNote }}</p>
      <p v-else class="training-course-page__next-title">No lesson in this course can be started here.</p>
    </div>
    <TrainingStartFeedback v-if="startFeedback" :feedback="startFeedback" />
    <p v-if="course.unusableLessons?.length" class="training-course-page__empty" role="note">
      Not shown, because this version of Vibe64 can't teach {{ course.unusableLessons.length === 1 ? "it" : "them" }}:
      {{ course.unusableLessons.map(lesson => lesson.title).join(", ") }}. Update the course when Courses offers an update.
    </p>

    <ol class="training-course-page__topics">
      <li v-for="{ topic, index, done, lessons } in path" :key="JSON.stringify([topic.topicId, topic.release])" class="training-course-page__topic">
        <div class="training-course-page__topic-head">
          <span class="training-course-page__topic-index" aria-hidden="true">{{ index }}</span>
          <div class="training-course-page__topic-text">
            <h4>{{ topic.title }}</h4>
            <p>{{ topic.topicId }} · {{ topic.release }}</p>
          </div>
          <span v-if="lessons.length" class="training-course-page__topic-done" :aria-label="`${done} of ${lessons.length} lessons completed in this topic`">{{ done }}/{{ lessons.length }}</span>
        </div>
        <p v-if="!lessons.length" class="training-course-page__empty">This topic has no displayed lesson choices.</p>
        <ol class="training-course-page__path">
          <li
            v-for="{ lesson, status, current, step, next, earlier } in lessons" :key="JSON.stringify([lesson.code, lesson.hash])"
            class="training-course-page__lesson" :class="[`is-${status}`, { 'is-next': next && !progress.activeHere }]"
          >
            <span class="training-course-page__node" aria-hidden="true">
              <v-icon v-if="status === 'completed'" icon="$check" size="22" />
              <v-icon v-else-if="status === 'in-progress'" icon="$play" size="22" />
              <span v-else>{{ step }}</span>
            </span>
            <div class="training-course-page__card">
              <div class="training-course-page__card-main">
                <strong class="training-course-page__lesson-title">{{ lesson.title }} · {{ lesson.code }}</strong>
                <p class="training-course-page__lesson-meta">
                  <span class="training-course-page__status" :class="`is-${status}`">{{ statusLabels[status] }}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{{ lesson.status === 'published' ? 'Published' : 'Draft — unavailable for new lessons' }}</span>
                  <span v-if="!lesson.required"> · Optional</span>
                </p>
                <p v-if="earlier" class="training-course-page__earlier">{{ earlierCompletionLabel(earlier) }}</p>
                <details class="training-course-page__identity"><summary>Lesson identity</summary><code>{{ lesson.hash }}</code></details>
              </div>
              <v-btn
                v-if="offered(course, lesson, canTryPreviews) && !current"
                :variant="next ? 'tonal' : 'text'" color="primary" rounded="pill"
                class="training-course-page__start" :readonly="startingLesson(lesson)" :disabled="!startAllowed && !startingLesson(lesson)"
                @click="emit('start', lesson)"
              >
                <template v-if="startingLesson(lesson)"><v-progress-circular indeterminate size="18" width="2" class="training-course-page__spinner" />Starting lesson…</template><template v-else>Start lesson</template>
              </v-btn>
            </div>
          </li>
        </ol>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.training-course-page__spinner { margin-right: var(--v64-space-2, 8px); }
.training-course-page__earlier { margin: 2px 0 0; font: var(--v64-type-body-sm, 400 0.8125rem/1.25rem system-ui, sans-serif); color: rgb(var(--v-theme-on-surface-variant)); }
.training-course-page {
  --tcp-node: 40px;
  --tcp-done: rgb(var(--v-theme-success));
  --tcp-done-container: rgb(var(--v-theme-success-container));
  --tcp-progress: var(--v64-learning);
  --tcp-progress-container: var(--v64-learning-container, rgba(245, 197, 24, 0.22));
  display: flex;
  flex-direction: column;
  gap: var(--v64-space-4, 16px);
  min-width: 0;
}
.training-course-page p, .training-course-page code, .training-course-page strong, .training-course-page h3, .training-course-page h4 {
  white-space: normal;
  overflow-wrap: anywhere;
}
.training-course-page__all { margin-inline-start: calc(-1 * var(--v64-space-2, 8px)); }
.training-course-page__all-btn { letter-spacing: 0; text-transform: none; }

/* Hero: the shared course cover above a tonal summary, matching the course cards. */
.training-course-page__hero {
  position: relative;
  border-radius: var(--v64-shape-xl, 28px);
  background: rgb(var(--v-theme-surface-container-low));
  border: 1px solid rgb(var(--v-theme-outline-variant));
  box-shadow: var(--v64-elevation-1, 0 1px 3px rgba(0, 0, 0, 0.12));
  color: rgb(var(--v-theme-on-surface));
  overflow: hidden;
  animation: tcp-rise var(--v64-duration-long, 500ms) var(--v64-ease-emphasized-decelerate, ease-out) both;
}
.training-course-page__cover { height: 120px; }
.training-course-page__hero-body {
  display: flex;
  align-items: center;
  gap: var(--v64-space-4, 16px);
  padding: var(--v64-space-4, 16px) var(--v64-space-5, 24px) var(--v64-space-5, 24px);
}
.training-course-page__hero-text { flex: 1 1 auto; min-width: 0; }
.training-course-page__eyebrow {
  margin: 0;
  font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface-variant));
}
.training-course-page__title { margin: 2px 0 var(--v64-space-2, 8px); font: var(--v64-type-headline-sm, 600 1.5rem/2rem system-ui, sans-serif); }
.training-course-page__meta { display: flex; flex-wrap: wrap; gap: 6px; }
.training-course-page__chip {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid rgb(var(--v-theme-outline));
  border-radius: var(--v64-shape-sm, 8px);
  font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif);
}
.training-course-page__chip code { font: inherit; background: none; padding: 0; }
.training-course-page__chip.is-muted { color: rgb(var(--v-theme-on-surface-variant)); border-style: dashed; }
.training-course-page__count { margin: var(--v64-space-3, 12px) 0 0; font: var(--v64-type-title-md, 600 1rem/1.5rem system-ui, sans-serif); }
.training-course-page__ring { --training-ring-color: rgb(var(--v-theme-primary)); --training-ring-track: color-mix(in srgb, rgb(var(--v-theme-primary)) 16%, transparent); }
.is-complete .training-course-page__ring { --training-ring-color: rgb(var(--v-theme-success)); }
.training-course-page__ring-value { font: var(--v64-type-label-lg, 500 0.875rem/1.25rem system-ui, sans-serif); color: rgb(var(--v-theme-on-surface-variant)); }
.training-course-page__ring-value strong { font: var(--v64-type-title-lg, 600 1.375rem/1.75rem system-ui, sans-serif); color: rgb(var(--v-theme-on-surface)); }

/* Up next */
.training-course-page__next {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--v64-space-3, 12px);
  padding: var(--v64-space-4, 16px) var(--v64-space-4, 16px) var(--v64-space-4, 16px) var(--v64-space-5, 24px);
  border-radius: var(--v64-shape-lg, 16px);
  background: rgb(var(--v-theme-surface-container));
  border: 1px solid rgb(var(--v-theme-outline-variant));
  animation: tcp-rise var(--v64-duration-long, 500ms) var(--v64-ease-emphasized-decelerate, ease-out) 60ms both;
}
.training-course-page__next.is-complete { background: var(--tcp-done-container); border-color: transparent; }
.training-course-page__next-text { min-width: 0; flex: 1 1 12rem; }
.training-course-page__next p { margin: 0; }
.training-course-page__next-label {
  font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface-variant));
}
.training-course-page__next-title { font: var(--v64-type-title-md, 600 1rem/1.5rem system-ui, sans-serif); }
.training-course-page__next .v-btn { letter-spacing: 0; text-transform: none; padding-inline: 24px; }

/* Topics and the learning path */
.training-course-page__topics { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--v64-space-5, 24px); }
.training-course-page__topic { animation: tcp-rise var(--v64-duration-long, 500ms) var(--v64-ease-emphasized-decelerate, ease-out) 120ms both; }
.training-course-page__topic-head { display: flex; align-items: center; gap: var(--v64-space-3, 12px); margin-bottom: var(--v64-space-3, 12px); }
.training-course-page__topic-index {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: var(--tcp-node);
  height: var(--tcp-node);
  border-radius: var(--v64-shape-md, 12px);
  background: rgb(var(--v-theme-primary-container));
  color: rgb(var(--v-theme-on-primary-container));
  font: var(--v64-type-title-md, 600 1rem/1.5rem system-ui, sans-serif);
}
.training-course-page__topic-text { flex: 1 1 auto; min-width: 0; }
.training-course-page__topic-text h4 { margin: 0; font: var(--v64-type-title-md, 600 1rem/1.5rem system-ui, sans-serif); }
.training-course-page__topic-text p { margin: 0; font: var(--v64-type-body-md, 400 0.875rem/1.25rem system-ui, sans-serif); color: rgb(var(--v-theme-on-surface-variant)); }
.training-course-page__topic-done {
  flex: 0 0 auto;
  padding: 2px 10px;
  border-radius: var(--v64-shape-full, 999px);
  background: rgb(var(--v-theme-surface-container-highest));
  font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif);
  font-variant-numeric: tabular-nums;
}
.training-course-page__empty { margin: 0 0 0 calc(var(--tcp-node) + var(--v64-space-3, 12px)); color: rgb(var(--v-theme-on-surface-variant)); }

.training-course-page__path { list-style: none; margin: 0; padding: 0; }
.training-course-page__lesson { position: relative; display: flex; gap: var(--v64-space-3, 12px); padding-bottom: var(--v64-space-3, 12px); }
.training-course-page__lesson::before {
  /* The path line joining one node to the next. */
  content: "";
  position: absolute;
  top: calc(var(--tcp-node) + 6px);
  bottom: -6px;
  left: calc(var(--tcp-node) / 2 - 2px);
  width: 4px;
  border-radius: 2px;
  background: rgb(var(--v-theme-outline-variant));
}
.training-course-page__lesson:last-child::before { display: none; }
.training-course-page__lesson.is-completed::before { background: color-mix(in srgb, var(--tcp-done) 55%, transparent); }
.training-course-page__node {
  position: relative;
  z-index: 1;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: var(--tcp-node);
  height: var(--tcp-node);
  margin-top: 6px;
  border-radius: 50%;
  border: 2px solid rgb(var(--v-theme-outline));
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface-variant));
  font: var(--v64-type-label-lg, 500 0.875rem/1.25rem system-ui, sans-serif);
  font-variant-numeric: tabular-nums;
  transition: transform var(--v64-duration-short, 150ms) var(--v64-ease-standard, ease);
}
.is-completed > .training-course-page__node { border-color: transparent; background: var(--tcp-done); color: rgb(var(--v-theme-on-success)); box-shadow: 0 3px 0 color-mix(in srgb, var(--tcp-done) 60%, rgb(var(--v-theme-shadow))); }
.is-in-progress > .training-course-page__node { border-color: transparent; background: var(--tcp-progress); color: var(--v64-on-learning); box-shadow: 0 3px 0 color-mix(in srgb, var(--tcp-progress) 60%, rgb(var(--v-theme-shadow))); }
.is-next > .training-course-page__node { border-color: rgb(var(--v-theme-primary)); color: rgb(var(--v-theme-primary)); }
.is-next > .training-course-page__node::after {
  content: "";
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 2px solid rgba(var(--v-theme-primary), 0.35);
  animation: tcp-pulse 2.4s var(--v64-ease-standard, ease) infinite;
}
.training-course-page__card {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--v64-space-2, 8px) var(--v64-space-3, 12px);
  padding: var(--v64-space-3, 12px) var(--v64-space-3, 12px) var(--v64-space-3, 12px) var(--v64-space-4, 16px);
  border-radius: var(--v64-shape-lg, 16px);
  border: 1px solid rgb(var(--v-theme-outline-variant));
  background: rgb(var(--v-theme-surface-container-low));
  transition: box-shadow var(--v64-duration-short, 150ms) var(--v64-ease-standard, ease);
}
.training-course-page__lesson:hover .training-course-page__card { box-shadow: var(--v64-elevation-1, 0 1px 3px rgba(0, 0, 0, 0.12)); }
.training-course-page__lesson:hover > .training-course-page__node { transform: scale(1.06); }
.is-next > .training-course-page__card { border-color: rgba(var(--v-theme-primary), 0.5); background: rgb(var(--v-theme-surface-container)); box-shadow: var(--v64-elevation-1, 0 1px 3px rgba(0, 0, 0, 0.12)); }
.is-completed > .training-course-page__card { background: color-mix(in srgb, var(--tcp-done) 5%, rgb(var(--v-theme-surface))); }
.training-course-page__card-main { flex: 1 1 14rem; min-width: 0; }
.training-course-page__lesson-title { display: block; font: var(--v64-type-title-md, 600 1rem/1.5rem system-ui, sans-serif); }
.training-course-page__lesson-meta { margin: 4px 0 0; font: var(--v64-type-body-md, 400 0.875rem/1.25rem system-ui, sans-serif); color: rgb(var(--v-theme-on-surface-variant)); }
.training-course-page__status {
  display: inline-block;
  padding: 1px 8px;
  border-radius: var(--v64-shape-full, 999px);
  font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif);
  background: rgb(var(--v-theme-surface-container-highest));
  color: rgb(var(--v-theme-on-surface));
}
.training-course-page__status.is-completed { background: var(--tcp-done-container); color: color-mix(in srgb, var(--tcp-done) 60%, rgb(var(--v-theme-on-surface))); }
.training-course-page__status.is-in-progress { background: var(--tcp-progress-container); color: var(--v64-on-learning-container, inherit); }
.training-course-page__identity { margin-top: 6px; font: var(--v64-type-body-md, 400 0.875rem/1.25rem system-ui, sans-serif); color: rgb(var(--v-theme-on-surface-variant)); }
.training-course-page__identity summary { cursor: pointer; width: fit-content; border-radius: var(--v64-shape-xs, 4px); }
.training-course-page__identity summary:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.training-course-page__identity code { display: block; margin-top: 4px; padding: 6px 8px; border-radius: var(--v64-shape-sm, 8px); background: rgb(var(--v-theme-surface-container-high)); font-size: 0.75rem; }
.training-course-page__start { letter-spacing: 0; text-transform: none; }

@keyframes tcp-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes tcp-pulse { 0% { transform: scale(0.92); opacity: 0.9; } 70% { transform: scale(1.18); opacity: 0; } 100% { opacity: 0; } }

@media (max-width: 599px) {
  .training-course-page__hero-body { padding: var(--v64-space-3, 12px) var(--v64-space-4, 16px) var(--v64-space-4, 16px); align-items: flex-start; }
  .training-course-page__cover { height: 96px; }
  .training-course-page__ring { width: 64px !important; height: 64px !important; }
  .training-course-page__ring-value strong { font: var(--v64-type-title-md, 600 1rem/1.5rem system-ui, sans-serif); }
  .training-course-page__title { margin-bottom: var(--v64-space-1, 4px); }
  .training-course-page__title { font: var(--v64-type-title-lg, 600 1.375rem/1.75rem system-ui, sans-serif); }
  .training-course-page__next { padding-inline-start: var(--v64-space-4, 16px); }
  .training-course-page__next .v-btn { flex: 1 1 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .training-course-page__hero, .training-course-page__next, .training-course-page__topic { animation: none; }
  .is-next > .training-course-page__node::after { animation: none; opacity: 1; }
  .training-course-page__node, .training-course-page__card { transition: none; }
}
</style>
