<script setup>
import { computed, inject } from "vue";
import { mdiChevronDown, mdiChevronLeft, mdiChevronRight, mdiChevronUp } from "@mdi/js";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import { VIBE64_COLLEAGUE_LAYOUT_KEY } from "@/lib/vibe64AssistantHost.js";

// The current lesson's step bar, at the top of the project page in Learn
// mode (also with no project selected). It names the lesson and its current
// step with its status; Previous/Next move through the steps and Open shows
// the step in the page's Lesson pane (hidden while that pane shows). It
// collapses to one line.
const learning = useVibe64Learning();
const layout = inject(VIBE64_COLLEAGUE_LAYOUT_KEY, null);
const lessonShown = computed(() => Boolean(layout?.value?.lessonVisible));
const lesson = computed(() => learning?.lesson.value || null);
const steps = computed(() => lesson.value?.steps || []);
const step = computed(() => learning?.currentStep.value || null);
const index = computed(() => steps.value.findIndex(value => value.id === step.value?.id));
// The current lesson's step (not a finished lesson's screen).
const visible = computed(() => Boolean(learning?.learnMode && !learning.finished && learning.lessonAttemptId &&
  learning.state.attemptId === learning.lessonAttemptId && step.value));
const collapsed = computed(() => Boolean(learning?.stepBarCollapsed));
const statusLabel = Object.freeze({ passed: "Passed", "not-yet-passed": "Not yet passed", "not-started": "Not checked yet" });
const status = computed(() => step.value ? learning.stepStatus(step.value.id) : "not-started");
const go = offset => {
  const next = steps.value[index.value + offset];
  if (next) learning.selectStep(next.id);
};
</script>

<template>
  <section
    v-if="visible"
    class="vibe64-learning-step-bar"
    :class="{ 'vibe64-learning-step-bar--collapsed': collapsed }"
    aria-label="Lesson steps"
    data-test="learning-step-bar"
  >
    <button
      type="button" class="vibe64-learning-step-bar__toggle" :aria-expanded="!collapsed"
      :aria-label="collapsed ? 'Show the lesson step' : 'Hide the lesson step'" data-test="learning-step-bar-toggle"
      @click="learning.toggleStepBar()"
    >
      <v-icon :icon="collapsed ? mdiChevronDown : mdiChevronUp" size="20" />
    </button>
    <div class="vibe64-learning-step-bar__text">
      <span class="vibe64-learning-step-bar__lesson">{{ lesson.title || lesson.code }}</span>
      <span class="vibe64-learning-step-bar__step">
        Step {{ index + 1 }} of {{ steps.length }}<template v-if="!collapsed">: {{ step.title }}</template>
      </span>
      <span v-if="!collapsed && step.required" class="vibe64-learning-step-bar__status" :class="`is-${status}`">{{ statusLabel[status] }}</span>
    </div>
    <template v-if="!collapsed">
      <v-btn
        :icon="mdiChevronLeft" variant="text" size="small" min-width="40" min-height="40" aria-label="Previous step"
        :disabled="index <= 0" data-test="learning-step-bar-previous" @click="go(-1)"
      />
      <v-btn
        :icon="mdiChevronRight" variant="text" size="small" min-width="40" min-height="40" aria-label="Next step"
        :disabled="index >= steps.length - 1" data-test="learning-step-bar-next" @click="go(1)"
      />
      <v-btn
        v-if="!lessonShown"
        variant="tonal" rounded="pill" min-height="40" data-test="learning-step-bar-open"
        @click="learning.openLesson({ stepId: step.id })"
      >
        Open
      </v-btn>
    </template>
  </section>
</template>

<style scoped>
.vibe64-learning-step-bar {
  align-items: center;
  background: var(--v64-learning-container, rgba(245, 197, 24, 0.16));
  border: 1px solid var(--v64-learning-strong, #f5c518);
  border-radius: var(--v64-shape-md, 12px);
  color: var(--v64-on-learning-container, inherit);
  display: flex;
  flex: 0 0 auto;
  gap: var(--v64-space-2, 8px);
  min-width: 0;
  padding: 2px var(--v64-space-2, 8px) 2px 2px;
}
.vibe64-learning-step-bar__toggle {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 999px;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  flex: 0 0 auto;
  height: 40px;
  justify-content: center;
  width: 40px;
}
.vibe64-learning-step-bar__toggle:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: -2px; }
.vibe64-learning-step-bar__text {
  align-items: baseline;
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: 0 var(--v64-space-2, 8px);
  min-width: 0;
}
.vibe64-learning-step-bar__lesson { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vibe64-learning-step-bar__step { min-width: 0; overflow-wrap: anywhere; }
.vibe64-learning-step-bar__status { font-size: 0.8125rem; opacity: 0.8; }
.vibe64-learning-step-bar__status.is-passed { color: rgb(var(--v-theme-success)); opacity: 1; }
.vibe64-learning-step-bar .v-btn { letter-spacing: 0; text-transform: none; }

@media (max-width: 600px) {
  .vibe64-learning-step-bar__lesson { display: none; }
}
</style>
