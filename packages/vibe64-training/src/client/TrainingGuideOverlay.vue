<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { clearTrainingGuide, guideElementVisible, registerTrainingGuideOverlay, trainingGuide } from "./trainingGuide.js";

// A ring, pulse and short caption over one real Vibe64 control. It never
// takes input: the learner clicks the control underneath themselves.
const unregister = registerTrainingGuideOverlay();
const rect = ref(null);
const reducedMotion = ref(Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches));
let frame = 0;
let timer = null;

function stop() {
  if (frame) globalThis.cancelAnimationFrame?.(frame);
  frame = 0;
  clearTimeout(timer);
  timer = null;
  globalThis.document?.removeEventListener("pointerdown", dismiss, true);
  globalThis.document?.removeEventListener("keydown", dismiss, true);
}
function dismiss() {
  clearTrainingGuide(trainingGuide.value?.id);
}
function measure() {
  const guide = trainingGuide.value;
  if (!guide) return;
  // The learner moved on (or the view changed): the ring would point at nothing.
  if (!guideElementVisible(guide.element)) {
    clearTrainingGuide(guide.id);
    return;
  }
  const box = guide.element.getBoundingClientRect();
  rect.value = { top: box.top, left: box.left, width: box.width, height: box.height };
  if (globalThis.requestAnimationFrame) frame = globalThis.requestAnimationFrame(measure);
}
watch(trainingGuide, guide => {
  stop();
  rect.value = null;
  if (!guide) return;
  timer = setTimeout(() => clearTrainingGuide(guide.id), Math.max(0, guide.expiresAt - Date.now()));
  globalThis.document?.addEventListener("pointerdown", dismiss, true);
  globalThis.document?.addEventListener("keydown", dismiss, true);
  measure();
}, { immediate: true });
onBeforeUnmount(() => {
  stop();
  unregister();
});

const pad = 6;
const ringStyle = computed(() => rect.value && {
  top: `${rect.value.top - pad}px`, left: `${rect.value.left - pad}px`,
  width: `${rect.value.width + pad * 2}px`, height: `${rect.value.height + pad * 2}px`
});
const captionStyle = computed(() => {
  if (!rect.value) return null;
  const below = rect.value.top + rect.value.height + pad + 8;
  const viewport = globalThis.innerHeight || 0;
  const top = viewport && below + 40 > viewport ? Math.max(8, rect.value.top - pad - 44) : below;
  return { top: `${top}px`, left: `${Math.max(8, rect.value.left - pad)}px` };
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="trainingGuide && rect"
      class="training-guide-overlay"
      :class="{ 'training-guide-overlay--still': reducedMotion }"
      :data-guide-step="trainingGuide.step"
      aria-live="polite"
    >
      <div class="training-guide-overlay__ring" :style="ringStyle" />
      <div v-if="trainingGuide.caption" class="training-guide-overlay__caption" :style="captionStyle">
        {{ trainingGuide.caption }}
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.training-guide-overlay {
  inset: 0;
  pointer-events: none;
  position: fixed;
  z-index: 3000;
}
.training-guide-overlay__ring {
  animation: training-guide-pulse 1.4s ease-out infinite;
  border: 3px solid rgb(var(--v-theme-primary, 37, 99, 235));
  border-radius: 10px;
  box-shadow: 0 0 0 0 rgba(var(--v-theme-primary, 37, 99, 235), 0.45);
  position: fixed;
}
.training-guide-overlay__caption {
  background: rgb(var(--v-theme-primary, 37, 99, 235));
  border-radius: 7px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  color: rgb(var(--v-theme-on-primary, 255, 255, 255));
  font-size: 0.8rem;
  font-weight: 650;
  max-width: min(22rem, calc(100vw - 16px));
  padding: 0.3rem 0.6rem;
  position: fixed;
}
.training-guide-overlay--still .training-guide-overlay__ring {
  animation: none;
}
@keyframes training-guide-pulse {
  0% { box-shadow: 0 0 0 0 rgba(var(--v-theme-primary, 37, 99, 235), 0.45); }
  100% { box-shadow: 0 0 0 14px rgba(var(--v-theme-primary, 37, 99, 235), 0); }
}
@media (prefers-reduced-motion: reduce) {
  .training-guide-overlay__ring { animation: none; }
}
</style>
