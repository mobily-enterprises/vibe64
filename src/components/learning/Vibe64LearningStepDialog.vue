<script setup>
import { computed, ref, watch } from "vue";
import { mdiClose, mdiOpenInNew } from "@mdi/js";
import Vibe64LearningStep from "./Vibe64LearningStep.vue";

// Only the current lesson step, above Colleague: a dialog on desktop and a
// full-screen dialog on a phone (it covers Colleague's own dialog and returns
// to it when closed). Every action goes through the shared L controller, so L,
// Colleague's focus and other tabs stay in step with it.
const props = defineProps({
  modelValue: Boolean,
  learning: { type: Object, required: true },
  fullscreen: Boolean,
  // Test seam for the step's visual resource read.
  readVisual: { type: Function, default: null }
});
// open-learning: show this step in L. leave/return: see Vibe64LearningStep.
const emit = defineEmits(["update:modelValue", "open-learning", "leave", "return"]);
const lesson = computed(() => props.learning.lesson.value);
const step = computed(() => props.learning.currentStep.value);
// Kept here: the step view unmounts while Show me hides the dialog.
const actionError = ref("");
watch(() => step.value?.id, () => { actionError.value = ""; });
const close = () => emit("update:modelValue", false);
</script>

<template>
  <v-dialog
    :model-value="modelValue" :fullscreen="fullscreen" max-width="640" scrollable
    aria-label="Current lesson step" @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card class="vibe64-learning-step-dialog" :rounded="fullscreen ? 0 : 'lg'">
      <v-card-title class="vibe64-learning-step-dialog__title">
        <span class="vibe64-learning-step-dialog__lesson" :title="lesson?.title">
          <span v-if="lesson?.code" class="vibe64-learning-step-dialog__code">{{ lesson.code }}</span>
          <span>{{ lesson?.title || 'Current lesson step' }}</span>
        </span>
        <v-btn :icon="mdiClose" variant="text" aria-label="Close current step" title="Close current step" @click="close" />
      </v-card-title>
      <v-divider />
      <v-card-text class="vibe64-learning-step-dialog__body">
        <p v-if="learning.state.error" class="vibe64-learning-step-dialog__error" role="alert">{{ learning.state.error }}</p>
        <Vibe64LearningStep
          v-if="step" v-model:error="actionError" :learning="learning" :read-visual="readVisual" linear
          :heading-id="`vibe64-learning-step-dialog-${step.id}`"
          @leave="emit('leave', $event)" @return="emit('return')"
        />
        <v-skeleton-loader v-else-if="!learning.state.error" type="heading, paragraph" aria-label="Loading the step" />
      </v-card-text>
      <v-divider />
      <v-card-actions class="vibe64-learning-step-dialog__actions">
        <v-btn variant="text" rounded="pill" min-height="48" :append-icon="mdiOpenInNew" data-test="learning-step-open-l" @click="emit('open-learning')">Open in Learning</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.vibe64-learning-step-dialog__title { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 24px; }
.vibe64-learning-step-dialog__lesson { display: grid; flex: 1; min-width: 0; font: var(--v64-type-title-sm, 600 1rem/1.5rem system-ui, sans-serif); }
.vibe64-learning-step-dialog__lesson > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vibe64-learning-step-dialog__code { font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif); color: var(--v64-on-surface-variant, inherit); }
.vibe64-learning-step-dialog__body { padding: 16px 24px 24px !important; }
.vibe64-learning-step-dialog__error { color: rgb(var(--v-theme-error)); }
.vibe64-learning-step-dialog__actions { justify-content: flex-end; padding: 4px 12px; }
.vibe64-learning-step-dialog .v-btn { letter-spacing: 0; text-transform: none; }
@media (max-width: 599px) {
  .vibe64-learning-step-dialog { padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }
  .vibe64-learning-step-dialog__body { padding: 12px 16px 24px !important; }
}
</style>
