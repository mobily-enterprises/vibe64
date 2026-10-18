<script setup>
import { computed, ref, toValue, watch } from "vue";
import { useRoute } from "vue-router";
import TrainingLessonPicker from "@local/vibe64-training/client/lesson-picker";

const props = defineProps({ learning: { type: Object, required: true } });
const route = useRoute();
const error = ref("");
const errorLearner = ref("");
const courses = computed(() => toValue(props.learning.coursesResource.data));
const progress = computed(() => toValue(props.learning.learningResource.data));
const busy = computed(() => toValue(props.learning.busy));
const retry = computed(() => toValue(props.learning.startRetry));
const starting = computed(() => toValue(props.learning.starting) === true);
const trial = computed(() => toValue(props.learning.savedAuthorPreview));
const trialResource = computed(() => props.learning.authorPreviewResource);
const trialEnabled = computed(() => toValue(props.learning.authorPreviewEnabled) === true);
const errorVisible = computed(() => Boolean(errorLearner.value && errorLearner.value === toValue(props.learning.learnerId)
  && toValue(props.learning.learningMode)));
const canRequest = computed(() => Boolean(toValue(props.learning.learnerId) && toValue(props.learning.learningMode)));
let feedbackGeneration = 0;
watch(() => [toValue(props.learning.learnerId), toValue(props.learning.learningMode), route.fullPath, trialEnabled.value], () => {
  feedbackGeneration += 1;
  error.value = "";
  errorLearner.value = "";
}, { flush: "sync" });

async function request(operation) {
  const owner = props.learning;
  const learner = toValue(owner.learnerId);
  const target = route.fullPath;
  const generation = feedbackGeneration;
  error.value = "";
  errorLearner.value = learner;
  try { return await operation(owner); }
  catch (cause) {
    if (props.learning === owner && generation === feedbackGeneration && learner === toValue(owner.learnerId) && target === route.fullPath) {
      error.value = String(cause?.message || "The lesson request was not confirmed. Read saved progress before trying again.");
    }
    return null;
  }
}
</script>

<template>
  <div class="vibe64-learning-launcher">
    <v-alert v-if="error && errorVisible" type="error" variant="tonal" class="vibe64-learning-launcher__error">
      {{ error }}
    </v-alert>
    <v-btn v-if="retry" class="vibe64-learning-launcher__retry" variant="tonal" rounded="pill" min-height="48" :disabled="busy || !canRequest" @click="request(owner => owner.retryStart())">
      Retry lesson start
    </v-btn>
    <section v-if="trialEnabled && trialResource" class="vibe64-learning-launcher__trial" aria-label="Saved author trial" :aria-busy="toValue(trialResource.isLoading)">
      <p class="vibe64-learning-launcher__trial-eyebrow">Authoring</p>
      <h2>Author trial</h2>
      <p>This isolated snapshot is separate from your published lesson progress.</p>
      <v-skeleton-loader v-if="toValue(trialResource.isLoading) && !trial" type="list-item-two-line, actions" aria-label="Loading saved author trial" />
      <v-alert v-if="toValue(trialResource.loadError)" type="error" variant="tonal">
        {{ toValue(trialResource.loadError) }} Refresh courses before reopening the trial.
      </v-alert>
      <template v-if="trial">
        <p>{{ trial.pin.lesson.code }} · {{ trial.pin.topic.release }}</p>
        <details><summary>Saved trial identity</summary><code>{{ trial.pin.topic.commit }}</code></details>
        <v-btn
          variant="tonal" rounded="pill" min-height="48" data-test="resume-author-trial"
          :disabled="busy || !canRequest || toValue(trialResource.isLoading) || !!toValue(trialResource.loadError)"
          @click="request(owner => owner.resumeAuthorPreview(trial.attemptId))"
        >
          Resume author trial
        </v-btn>
      </template>
      <p v-else-if="!toValue(trialResource.isLoading) && !toValue(trialResource.loadError)">
        Ask Colleague to admit the exact clean committed lesson snapshot from your authoring session first.
      </p>
    </section>
    <TrainingLessonPicker
      :catalogue-result="courses"
      :learning-result="progress"
      :catalogue-loading="toValue(learning.coursesResource.isLoading)"
      :learning-loading="toValue(learning.learningResource.isLoading)"
      :catalogue-error="toValue(learning.coursesResource.loadError)"
      :learning-error="toValue(learning.learningResource.loadError)"
      :busy="busy"
      :can-start="canRequest"
      :can-resume="canRequest"
      :create-course="input => request(owner => owner.createCourse(input))"
      :starting="starting"
      :start-unconfirmed="Boolean(retry)"
      @refresh="request(owner => owner.refresh())"
      @start="request(owner => owner.startLesson($event))"
      @resume="request(owner => owner.resumeLesson($event.attemptId))"
    />
    <p class="vibe64-learning-launcher__status" role="status">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 9h2V7h-2m1 13a8 8 0 1 1 0-16 8 8 0 0 1 0 16m0-18a10 10 0 1 0 0 20 10 10 0 0 0 0-20m-1 15h2v-6h-2v6Z" /></svg>
      You can switch back to Working without closing your lesson.
    </p>
  </div>
</template>

<style scoped>
.vibe64-learning-launcher { min-height: 0; overflow-y: auto; padding: var(--v64-space-4, 16px); }
/* A quiet footnote: the pane opens on the Courses hero, not on utility text. */
.vibe64-learning-launcher__status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--v64-space-2, 8px);
  margin: var(--v64-space-5, 24px) 0 0;
  color: var(--v64-on-surface-variant, rgba(var(--v-theme-on-surface), 0.72));
  font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif);
  font-weight: 400;
  text-align: center;
}
.vibe64-learning-launcher__status svg { flex: 0 0 auto; width: 16px; height: 16px; fill: currentColor; opacity: 0.8; }
.vibe64-learning-launcher__retry { margin-bottom: var(--v64-space-3, 12px); letter-spacing: 0; text-transform: none; }
.vibe64-learning-launcher__trial {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--v64-space-2, 8px);
  margin-bottom: var(--v64-space-4, 16px);
  padding: var(--v64-space-4, 16px) var(--v64-space-5, 24px);
  border: 1px dashed var(--v64-outline, rgba(var(--v-theme-on-surface), 0.24));
  border-radius: var(--v64-shape-lg, 16px);
  background: var(--v64-surface-container-low, rgb(var(--v-theme-surface)));
}
.vibe64-learning-launcher__trial > * { margin: 0; max-width: 100%; overflow-wrap: anywhere; }
.vibe64-learning-launcher__trial h2 { font: var(--v64-type-title-lg, 600 1.375rem/1.75rem system-ui, sans-serif); }
.vibe64-learning-launcher__trial-eyebrow { font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif); letter-spacing: 0.08em; text-transform: uppercase; color: var(--v64-on-surface-variant, inherit); }
.vibe64-learning-launcher__trial .v-btn { letter-spacing: 0; text-transform: none; }
.vibe64-learning-launcher__error { flex: 0 0 auto; margin-block: 0 var(--v64-space-3, 12px); }
</style>
