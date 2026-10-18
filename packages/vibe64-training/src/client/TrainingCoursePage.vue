<script setup>
import { offered, statusLabels } from "./courseProgress.js";

// Presentational course page. The parent picker owns every start/resume gate
// and emits only the original start and resume intents.
defineProps({
  course: { type: Object, required: true },
  progress: { type: Object, required: true },
  startAllowed: Boolean,
  resumeAllowed: Boolean
});
const emit = defineEmits(["back", "start", "resume"]);
</script>

<template>
  <section class="training-course-page" :aria-label="`Course ${course.title}`">
    <div><v-btn variant="text" min-height="48" @click="emit('back')">Back to courses</v-btn></div>
    <header>
      <h3>{{ course.title }}</h3>
      <p>{{ course.courseId }} · {{ course.release }} · {{ !course.enabled ? 'Disabled for new lessons' : course.status === 'released' ? 'Enabled' : 'Preview course' }}</p>
      <p>{{ progress.completed }} of {{ progress.total }} lessons complete</p>
      <v-progress-linear :model-value="progress.total ? 100 * progress.completed / progress.total : 0" height="8" rounded
        :aria-label="`${progress.completed} of ${progress.total} lessons complete`" />
    </header>
    <div class="training-course-page__next">
      <v-btn v-if="progress.activeHere" variant="tonal" min-height="48" :disabled="!resumeAllowed" @click="emit('resume')">Continue</v-btn>
      <template v-else-if="progress.next">
        <v-btn variant="tonal" min-height="48" :disabled="!startAllowed" @click="emit('start', progress.next)">Start next lesson</v-btn>
        <p>Next: {{ progress.next.title }} · {{ progress.next.code }}</p>
      </template>
      <p v-else-if="progress.total && progress.completed === progress.total">Course complete.</p>
      <p v-else>No lesson in this course can be started here.</p>
    </div>
    <ol class="training-course-page__topics">
      <li v-for="topic in progress.topics" :key="JSON.stringify([topic.topicId, topic.release])">
        <h4>{{ topic.title }}</h4>
        <p>{{ topic.topicId }} · {{ topic.release }}</p>
        <p v-if="!topic.lessons.length">This topic has no displayed lesson choices.</p>
        <ol>
          <li v-for="{ lesson, status } in topic.lessons" :key="JSON.stringify([lesson.code, lesson.hash])" class="training-course-page__lesson">
            <strong>{{ lesson.title }} · {{ lesson.code }}</strong>
            <p>{{ statusLabels[status] }} · {{ lesson.status === 'published' ? 'Published' : 'Draft — unavailable for new lessons' }}{{ lesson.required ? '' : ' · Optional' }}</p>
            <details><summary>Lesson identity</summary><code>{{ lesson.hash }}</code></details>
            <v-btn v-if="offered(course, lesson) && !progress.activeHere" variant="text" min-height="48" :disabled="!startAllowed" @click="emit('start', lesson)">Start lesson</v-btn>
          </li>
        </ol>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.training-course-page { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.training-course-page h3 { font-size: 1.125rem; }
.training-course-page h4 { font-size: 1rem; }
.training-course-page header p, .training-course-page__next p { margin-block: 0.25rem; }
.training-course-page__next { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.training-course-page__topics, .training-course-page__topics ol { padding-left: 1.25rem; }
.training-course-page__topics > li + li { margin-top: 1rem; }
.training-course-page__lesson { margin-top: 0.75rem; }
.training-course-page p, .training-course-page code, .training-course-page strong { white-space: normal; overflow-wrap: anywhere; }
</style>
