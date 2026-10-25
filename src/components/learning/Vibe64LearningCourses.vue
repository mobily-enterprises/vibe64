<script setup>
import { computed, ref, toValue, watch } from "vue";
import { useRoute } from "vue-router";
import TrainingLessonPicker from "@local/vibe64-training/client/lesson-picker";
import { aiOnboardingAvailable, aiOnboardingNeeded, requestVibe64AiOnboarding } from "@local/vibe64-accounts/client";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import { VIBE64_LEARNING_AI_REQUIRED_CODE } from "@/lib/vibe64Learning.js";

// The Courses surface. `courses` is the Courses adapter
// (useVibe64LearningCourses); a confirmed start or Continue lesson opens the
// lesson through the shared controller (`learning`), which also asks once
// before a start archives a different lesson in progress.
const props = defineProps({
  courses: { type: Object, required: true }
});
const learning = useVibe64Learning();
const opened = operation => request(async owner => learning.opened(await operation(owner, { onAdmitted: learning.admitted })));
// A Courses start reports failure on its card; Retry lesson start reports it here.
const start = (selection, kind = "start") => request(owner => learning.startLesson(selection, owner.startLesson), kind);
const route = useRoute();
const error = ref("");
const errorLearner = ref("");
// A failed lesson start is shown on the course card that requested it.
const errorKind = ref("");
const catalogue = computed(() => toValue(props.courses.coursesResource.data));
const progress = computed(() => toValue(props.courses.learningResource.data));
const busy = computed(() => toValue(props.courses.busy));
const retry = computed(() => toValue(props.courses.startRetry));
const starting = computed(() => toValue(props.courses.starting) === true);
const installState = computed(() => toValue(props.courses.installState) || null);
const errorVisible = computed(() => Boolean(errorLearner.value && errorLearner.value === toValue(props.courses.learnerId)
  && toValue(props.courses.active)));
// The lesson in progress waits for the learner's AI (its saved preparation
// failure says why); before any lesson, a learner with no AI is told first.
const aiFailure = computed(() => {
  const failure = progress.value?.ok === true ? progress.value.active?.preparation?.failure : null;
  return failure?.code === VIBE64_LEARNING_AI_REQUIRED_CODE ? failure : null;
});
const aiNotice = computed(() => aiFailure.value?.message ||
  (aiOnboardingNeeded.value ? "Lessons use your AI: the coding agent in each practice project and Colleague, your teacher, both need it. Set up your AI before you start." : ""));
const canRequest = computed(() => Boolean(toValue(props.courses.learnerId) && toValue(props.courses.active)));
let feedbackGeneration = 0;
watch(() => [toValue(props.courses.learnerId), toValue(props.courses.active), route.fullPath], () => {
  feedbackGeneration += 1;
  error.value = "";
  errorLearner.value = "";
}, { flush: "sync" });

async function request(operation, kind = "") {
  const owner = props.courses;
  const learner = toValue(owner.learnerId);
  const target = route.fullPath;
  const generation = feedbackGeneration;
  error.value = "";
  errorLearner.value = learner;
  errorKind.value = kind;
  try { return await operation(owner); }
  catch (cause) {
    // The saved lesson now says it waits for the learner's AI (aiNotice).
    if (cause?.code === VIBE64_LEARNING_AI_REQUIRED_CODE) {
      await owner.learningResource.reload();
      return null;
    }
    if (props.courses === owner && generation === feedbackGeneration && learner === toValue(owner.learnerId) && target === route.fullPath) {
      error.value = String(cause?.message || "The lesson request was not confirmed. Read saved progress before trying again.");
    }
    return null;
  }
}
</script>

<template>
  <div class="vibe64-learning-launcher">
    <v-alert v-if="error && errorVisible && errorKind !== 'start'" type="error" variant="tonal" class="vibe64-learning-launcher__error">
      {{ error }}
    </v-alert>
    <v-alert v-if="aiNotice" type="warning" variant="tonal" class="vibe64-learning-launcher__error" data-test="learning-ai-notice">
      <p>{{ aiNotice }}</p>
      <v-btn v-if="aiOnboardingAvailable" color="primary" variant="flat" rounded="pill" min-height="40" class="vibe64-learning-launcher__ai" @click="requestVibe64AiOnboarding()">
        Set up your AI
      </v-btn>
    </v-alert>
    <v-btn v-if="retry" class="vibe64-learning-launcher__retry" variant="tonal" rounded="pill" min-height="48" :disabled="busy || !canRequest" @click="start(toValue(courses.startRetry), '')">
      Retry lesson start
    </v-btn>
    <!-- A host's own Courses content (for example its own saved lessons) sits
         above the picker; opened() opens a lesson it resumes like any other. -->
    <slot :courses="courses" :opened="opened" :busy="busy" :can-request="canRequest" />
    <TrainingLessonPicker
      :catalogue-result="catalogue"
      :learning-result="progress"
      :catalogue-loading="toValue(courses.coursesResource.isLoading)"
      :learning-loading="toValue(courses.learningResource.isLoading)"
      :catalogue-error="toValue(courses.coursesResource.loadError)"
      :learning-error="toValue(courses.learningResource.loadError)"
      :busy="busy"
      :can-start="canRequest"
      :can-resume="canRequest"
      :create-course="input => request(owner => owner.createCourse(input))"
      :available-result="toValue(courses.availableResource?.data)"
      :available-loading="toValue(courses.availableResource?.isLoading) === true"
      :available-error="toValue(courses.availableResource?.loadError) || ''"
      :install-state="installState"
      :starting="starting"
      :start-unconfirmed="Boolean(retry)"
      :start-error="error && errorVisible && errorKind === 'start' ? error : ''"
      @refresh="request(owner => owner.refresh())"
      @start="start"
      @resume="opened((owner, options) => owner.resumeLesson($event.attemptId, options))"
      @install="request(owner => owner.installCourse($event))"
    />
  </div>
</template>

<style scoped>
.vibe64-learning-launcher { min-height: 0; overflow-y: auto; padding: var(--v64-space-4, 16px); }
.vibe64-learning-launcher__retry { margin-bottom: var(--v64-space-3, 12px); letter-spacing: 0; text-transform: none; }
.vibe64-learning-launcher__error { flex: 0 0 auto; margin-block: 0 var(--v64-space-3, 12px); }
.vibe64-learning-launcher__ai { margin-top: var(--v64-space-2, 8px); letter-spacing: 0; text-transform: none; }
</style>
