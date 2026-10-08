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
    <p class="vibe64-learning-launcher__status" role="status">
      You can switch back to Working without closing your lesson.
    </p>
    <v-alert v-if="error && errorVisible" type="error" variant="tonal" class="vibe64-learning-launcher__error">
      {{ error }}
    </v-alert>
    <v-btn v-if="retry" variant="tonal" :disabled="busy || !canRequest" @click="request(owner => owner.retryStart())">
      Retry lesson start
    </v-btn>
    <section v-if="trialEnabled && trialResource" aria-label="Saved author trial" :aria-busy="toValue(trialResource.isLoading)">
      <h2>Author trial</h2>
      <p>This isolated snapshot is separate from your published lesson progress.</p>
      <v-skeleton-loader v-if="toValue(trialResource.isLoading) && !trial" type="list-item-two-line, actions" aria-label="Loading saved author trial" />
      <v-alert v-if="toValue(trialResource.loadError)" type="error" variant="tonal">
        {{ toValue(trialResource.loadError) }} Refresh lessons before reopening the trial.
      </v-alert>
      <template v-if="trial">
        <p>{{ trial.pin.lesson.code }} · {{ trial.pin.topic.release }}</p>
        <details><summary>Saved trial identity</summary><code>{{ trial.pin.topic.commit }}</code></details>
        <v-btn
          variant="tonal" min-height="48" data-test="resume-author-trial"
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
      :can-start="canRequest && !retry"
      :can-resume="canRequest"
      @refresh="request(owner => owner.refresh())"
      @start="request(owner => owner.startLesson($event))"
      @resume="request(owner => owner.resumeLesson($event.attemptId))"
    />
  </div>
</template>

<style scoped>
.vibe64-learning-launcher { min-height: 0; overflow-y: auto; padding: 1rem; }
.vibe64-learning-launcher__status { color: rgba(var(--v-theme-on-surface), 0.72); font-size: .875rem; }
.vibe64-learning-launcher__error { flex: 0 0 auto; margin-block: .75rem; }
</style>
