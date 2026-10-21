<script setup>
import { computed } from "vue";
import { courseStatusLabel, earlierCompletionLabel, offered, previewCourse, previewNote, statusLabels } from "./courseProgress.js";
import TrainingCourseArt from "./TrainingCourseArt.vue";
import TrainingProgressRing from "./TrainingProgressRing.vue";

// Presentational course page. The parent picker owns every start/resume gate
// and emits only the original start and resume intents. Every mastery state,
// count and ring below is drawn from the supplied saved progress only.
const props = defineProps({
  course: { type: Object, required: true },
  progress: { type: Object, required: true },
  startAllowed: Boolean,
  // Display only: whether courses.list reports this person may try preview courses.
  canTryPreviews: Boolean,
  resumeAllowed: Boolean
});
const emit = defineEmits(["back", "start", "resume"]);

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
    <div class="training-course-page__back">
      <v-btn variant="text" min-height="48" class="training-course-page__back-btn" @click="emit('back')">
        <svg class="training-course-page__back-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z" /></svg>
        Back to courses
      </v-btn>
    </div>

    <header class="training-course-page__hero" :class="{ 'is-complete': complete }">
      <TrainingCourseArt class="training-course-page__cover" :course-id="course.courseId" :title="course.title"
        :statuses="progress.lessons.map(value => value.status)" />
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
        <TrainingProgressRing class="training-course-page__ring" :value="progress.completed" :max="progress.total" :size="88" :stroke="9"
          :label="`${progress.completed} of ${progress.total} lessons complete`">
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
        <v-btn color="primary" variant="flat" min-height="48" rounded="pill" :disabled="!resumeAllowed" @click="emit('resume')">Continue lesson</v-btn>
      </template>
      <template v-else-if="progress.next">
        <div class="training-course-page__next-text">
          <p class="training-course-page__next-label">Up next</p>
          <p class="training-course-page__next-title">{{ progress.next.title }} · {{ progress.next.code }}</p>
        </div>
        <v-btn color="primary" variant="flat" min-height="48" rounded="pill" :disabled="!startAllowed" @click="emit('start', progress.next)">{{ preview ? 'Try preview' : 'Start next lesson' }}</v-btn>
      </template>
      <div v-else-if="complete" class="training-course-page__next-text">
        <p class="training-course-page__next-label">All lessons done</p>
        <p class="training-course-page__next-title">Course complete.</p>
      </div>
      <p v-else-if="preview && !canTryPreviews" class="training-course-page__next-title training-course-page__preview-note">{{ previewNote }}</p>
      <p v-else class="training-course-page__next-title">No lesson in this course can be started here.</p>
    </div>

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
              <svg v-if="status === 'completed'" viewBox="0 0 24 24"><path d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6 11-11-1.4-1.4z" /></svg>
              <svg v-else-if="status === 'in-progress'" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" /></svg>
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
                :variant="next ? 'tonal' : 'text'" color="primary" min-height="48" rounded="pill"
                class="training-course-page__start" :disabled="!startAllowed" @click="emit('start', lesson)"
              >{{ preview ? 'Try preview' : 'Start lesson' }}</v-btn>
            </div>
          </li>
        </ol>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.training-course-page__earlier { margin: 2px 0 0; font: var(--v64-type-body-sm, 400 0.8125rem/1.25rem system-ui, sans-serif); color: var(--v64-on-surface-variant); }
.training-course-page {
  --tcp-node: 40px;
  --tcp-done: rgb(var(--v-theme-success));
  --tcp-done-container: var(--v64-success-container, rgba(var(--v-theme-success), 0.14));
  --tcp-progress: var(--v64-learning, #f5c518);
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
.training-course-page__back { margin-inline-start: calc(-1 * var(--v64-space-2, 8px)); }
.training-course-page__back-btn { letter-spacing: 0; text-transform: none; }
.training-course-page__back-icon { width: 20px; height: 20px; margin-inline-end: 4px; fill: currentColor; }

/* Hero: the shared course cover above a tonal summary, matching the course cards. */
.training-course-page__hero {
  position: relative;
  border-radius: var(--v64-shape-xl, 28px);
  background: var(--v64-surface-container-low, rgb(var(--v-theme-surface)));
  border: 1px solid var(--v64-outline-variant, rgba(var(--v-theme-on-surface), 0.12));
  box-shadow: var(--v64-elevation-1, 0 1px 3px rgba(0, 0, 0, 0.12));
  color: var(--v64-on-surface, rgb(var(--v-theme-on-surface)));
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
  color: var(--v64-on-surface-variant, inherit);
}
.training-course-page__title { margin: 2px 0 var(--v64-space-2, 8px); font: var(--v64-type-headline-sm, 600 1.5rem/2rem system-ui, sans-serif); }
.training-course-page__meta { display: flex; flex-wrap: wrap; gap: 6px; }
.training-course-page__chip {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--v64-outline, rgba(var(--v-theme-on-surface), 0.24));
  border-radius: var(--v64-shape-sm, 8px);
  font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif);
}
.training-course-page__chip code { font: inherit; background: none; padding: 0; }
.training-course-page__chip.is-muted { color: var(--v64-on-surface-variant, inherit); border-style: dashed; }
.training-course-page__count { margin: var(--v64-space-3, 12px) 0 0; font: var(--v64-type-title-md, 600 1rem/1.5rem system-ui, sans-serif); }
.training-course-page__ring { --training-ring-color: var(--v64-primary); --training-ring-track: color-mix(in srgb, var(--v64-primary, #6750a4) 16%, transparent); }
.is-complete .training-course-page__ring { --training-ring-color: rgb(var(--v-theme-success)); }
.training-course-page__ring-value { font: var(--v64-type-label-lg, 500 0.875rem/1.25rem system-ui, sans-serif); color: var(--v64-on-surface-variant, inherit); }
.training-course-page__ring-value strong { font: var(--v64-type-title-lg, 600 1.375rem/1.75rem system-ui, sans-serif); color: var(--v64-on-surface, inherit); }

/* Up next */
.training-course-page__next {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--v64-space-3, 12px);
  padding: var(--v64-space-4, 16px) var(--v64-space-4, 16px) var(--v64-space-4, 16px) var(--v64-space-5, 24px);
  border-radius: var(--v64-shape-lg, 16px);
  background: var(--v64-surface-container, rgba(var(--v-theme-primary), 0.05));
  border: 1px solid var(--v64-outline-variant, rgba(var(--v-theme-on-surface), 0.12));
  animation: tcp-rise var(--v64-duration-long, 500ms) var(--v64-ease-emphasized-decelerate, ease-out) 60ms both;
}
.training-course-page__next.is-complete { background: var(--tcp-done-container); border-color: transparent; }
.training-course-page__next-text { min-width: 0; flex: 1 1 12rem; }
.training-course-page__next p { margin: 0; }
.training-course-page__next-label {
  font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--v64-on-surface-variant, inherit);
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
  background: var(--v64-primary-container, rgba(var(--v-theme-primary), 0.14));
  color: var(--v64-on-primary-container, rgb(var(--v-theme-primary)));
  font: var(--v64-type-title-md, 600 1rem/1.5rem system-ui, sans-serif);
}
.training-course-page__topic-text { flex: 1 1 auto; min-width: 0; }
.training-course-page__topic-text h4 { margin: 0; font: var(--v64-type-title-md, 600 1rem/1.5rem system-ui, sans-serif); }
.training-course-page__topic-text p { margin: 0; font: var(--v64-type-body-md, 400 0.875rem/1.25rem system-ui, sans-serif); color: var(--v64-on-surface-variant, inherit); }
.training-course-page__topic-done {
  flex: 0 0 auto;
  padding: 2px 10px;
  border-radius: var(--v64-shape-full, 999px);
  background: var(--v64-surface-container-highest, rgba(var(--v-theme-primary), 0.11));
  font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif);
  font-variant-numeric: tabular-nums;
}
.training-course-page__empty { margin: 0 0 0 calc(var(--tcp-node) + var(--v64-space-3, 12px)); color: var(--v64-on-surface-variant, inherit); }

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
  background: var(--v64-outline-variant, rgba(var(--v-theme-on-surface), 0.12));
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
  border: 2px solid var(--v64-outline, rgba(var(--v-theme-on-surface), 0.24));
  background: var(--v64-surface, rgb(var(--v-theme-surface)));
  color: var(--v64-on-surface-variant, inherit);
  font: var(--v64-type-label-lg, 500 0.875rem/1.25rem system-ui, sans-serif);
  font-variant-numeric: tabular-nums;
  transition: transform var(--v64-duration-short, 150ms) var(--v64-ease-standard, ease);
}
.training-course-page__node svg { width: 22px; height: 22px; fill: currentColor; }
.is-completed > .training-course-page__node { border-color: transparent; background: var(--tcp-done); color: rgb(var(--v-theme-on-success)); box-shadow: 0 3px 0 color-mix(in srgb, var(--tcp-done) 60%, #000); }
.is-in-progress > .training-course-page__node { border-color: transparent; background: var(--tcp-progress); color: var(--v64-on-learning, #2b2100); box-shadow: 0 3px 0 color-mix(in srgb, var(--tcp-progress) 60%, #000); }
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
  border: 1px solid var(--v64-outline-variant, rgba(var(--v-theme-on-surface), 0.12));
  background: var(--v64-surface-container-low, rgb(var(--v-theme-surface)));
  transition: box-shadow var(--v64-duration-short, 150ms) var(--v64-ease-standard, ease);
}
.training-course-page__lesson:hover .training-course-page__card { box-shadow: var(--v64-elevation-1, 0 1px 3px rgba(0, 0, 0, 0.12)); }
.training-course-page__lesson:hover > .training-course-page__node { transform: scale(1.06); }
.is-next > .training-course-page__card { border-color: rgba(var(--v-theme-primary), 0.5); background: var(--v64-surface-container, rgba(var(--v-theme-primary), 0.05)); box-shadow: var(--v64-elevation-1, 0 1px 3px rgba(0, 0, 0, 0.12)); }
.is-completed > .training-course-page__card { background: color-mix(in srgb, var(--tcp-done) 5%, rgb(var(--v-theme-surface))); }
.training-course-page__card-main { flex: 1 1 14rem; min-width: 0; }
.training-course-page__lesson-title { display: block; font: var(--v64-type-title-md, 600 1rem/1.5rem system-ui, sans-serif); }
.training-course-page__lesson-meta { margin: 4px 0 0; font: var(--v64-type-body-md, 400 0.875rem/1.25rem system-ui, sans-serif); color: var(--v64-on-surface-variant, inherit); }
.training-course-page__status {
  display: inline-block;
  padding: 1px 8px;
  border-radius: var(--v64-shape-full, 999px);
  font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif);
  background: var(--v64-surface-container-highest, rgba(var(--v-theme-on-surface), 0.08));
  color: var(--v64-on-surface, inherit);
}
.training-course-page__status.is-completed { background: var(--tcp-done-container); color: color-mix(in srgb, var(--tcp-done) 60%, rgb(var(--v-theme-on-surface))); }
.training-course-page__status.is-in-progress { background: var(--tcp-progress-container); color: var(--v64-on-learning-container, inherit); }
.training-course-page__identity { margin-top: 6px; font: var(--v64-type-body-md, 400 0.875rem/1.25rem system-ui, sans-serif); color: var(--v64-on-surface-variant, inherit); }
.training-course-page__identity summary { cursor: pointer; width: fit-content; border-radius: var(--v64-shape-xs, 4px); }
.training-course-page__identity summary:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: 2px; }
.training-course-page__identity code { display: block; margin-top: 4px; padding: 6px 8px; border-radius: var(--v64-shape-sm, 8px); background: var(--v64-surface-container-high, rgba(var(--v-theme-on-surface), 0.06)); font-size: 0.75rem; }
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
