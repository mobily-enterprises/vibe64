<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { clearTrainingGuide, guideElementVisible, registerTrainingGuideOverlay, trainingGuide } from "./trainingGuide.js";

// A coach mark over one real Vibe64 control: a soft spotlight, a ring with a
// ripple and a short caption pointing at it. It never takes input: the
// learner clicks the control underneath themselves.
const unregister = registerTrainingGuideOverlay();
const rect = ref(null);
const lifetime = ref(0);
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
  lifetime.value = Math.max(0, guide.expiresAt - Date.now());
  timer = setTimeout(() => clearTrainingGuide(guide.id), lifetime.value);
  globalThis.document?.addEventListener("pointerdown", dismiss, true);
  globalThis.document?.addEventListener("keydown", dismiss, true);
  measure();
}, { immediate: true });
onBeforeUnmount(() => {
  stop();
  unregister();
});

const pad = 6;
const gap = 14;
const captionMaxWidth = 352;
const ringStyle = computed(() => rect.value && {
  top: `${rect.value.top - pad}px`, left: `${rect.value.left - pad}px`,
  width: `${rect.value.width + pad * 2}px`, height: `${rect.value.height + pad * 2}px`
});
// The caption sits below the control, or above it where the viewport ends;
// its pointer tracks the control's centre even when the caption is clamped.
// A ringed pane that fills a phone screen leaves no room outside it, so the
// caption then sits inside the pane's top edge without a pointer.
const captionRoom = 60;
const captionPlacement = computed(() => {
  if (!rect.value) return "below";
  const viewport = globalThis.innerHeight || 0;
  const below = rect.value.top + rect.value.height + pad + gap;
  if (!viewport || below + captionRoom <= viewport) return "below";
  return rect.value.top - pad - gap - captionRoom >= 0 ? "above" : "inside";
});
const captionStyle = computed(() => {
  if (!rect.value) return null;
  const viewportWidth = globalThis.innerWidth || 0;
  const width = viewportWidth ? Math.min(captionMaxWidth, viewportWidth - 16) : captionMaxWidth;
  const preferred = Math.max(8, rect.value.left - pad);
  const left = viewportWidth ? Math.max(8, Math.min(preferred, viewportWidth - 8 - width)) : preferred;
  const arrow = Math.max(20, Math.min(rect.value.left + rect.value.width / 2 - left, width - 20));
  const vertical = {
    above: { bottom: `${Math.max(8, (globalThis.innerHeight || 0) - (rect.value.top - pad - gap))}px` },
    below: { top: `${rect.value.top + rect.value.height + pad + gap}px` },
    inside: { top: `${Math.max(8, rect.value.top) + gap}px` }
  }[captionPlacement.value];
  return { ...vertical, left: `${left}px`, maxWidth: `${width}px`,
    "--training-guide-arrow": `${arrow}px`, "--training-guide-lifetime": `${lifetime.value}ms` };
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
      <div class="training-guide-overlay__spotlight" :style="ringStyle" aria-hidden="true" />
      <div class="training-guide-overlay__ring" :style="ringStyle" />
      <div
        v-if="trainingGuide.caption"
        class="training-guide-overlay__caption"
        :class="`training-guide-overlay__caption--${captionPlacement}`"
        :style="captionStyle"
      >
        <svg class="training-guide-overlay__caption-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M10,9A1,1 0 0,1 11,8A1,1 0 0,1 12,9V13.47L13.21,13.6L18.15,15.79C18.68,16.03 19,16.56 19,17.14V21.5C18.97,22.32 18.32,22.97 17.5,23H11C10.62,23 10.26,22.85 10,22.57L5.1,18.37L5.84,17.6C6.03,17.39 6.3,17.28 6.58,17.28H6.8L10,19V9M11,5A4,4 0 0,1 15,9C15,10.5 14.2,11.77 13,12.46V11.24C13.61,10.69 14,9.89 14,9A3,3 0 0,0 11,6A3,3 0 0,0 8,9C8,9.89 8.39,10.69 9,11.24V12.46C7.8,11.77 7,10.5 7,9A4,4 0 0,1 11,5Z" />
        </svg>
        <span class="training-guide-overlay__caption-text">{{ trainingGuide.caption }}</span>
        <span class="training-guide-overlay__timer" aria-hidden="true" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.training-guide-overlay {
  --training-guide-accent-rgb: var(--v-theme-primary, 37, 99, 235);
  --training-guide-accent: rgb(var(--training-guide-accent-rgb));
  --training-guide-on-accent: rgb(var(--v-theme-on-primary, 255, 255, 255));
  --training-guide-radius: var(--v64-shape-md, 12px);
  --training-guide-ease: var(--v64-ease-emphasized-decelerate, cubic-bezier(0.05, 0.7, 0.1, 1));
  --training-guide-enter: var(--v64-duration-long, 500ms);
  inset: 0;
  pointer-events: none;
  position: fixed;
  z-index: 3000;
}

/* A gentle scrim with a hole over the control: the rest of the app recedes. */
.training-guide-overlay__spotlight {
  animation: training-guide-scrim var(--training-guide-enter) var(--training-guide-ease) both;
  border-radius: var(--training-guide-radius);
  box-shadow: 0 0 0 200vmax rgba(12, 16, 28, 0.24);
  position: fixed;
}

/* The ring lands on the control, haloed in white so it reads on any surface. */
.training-guide-overlay__ring {
  animation: training-guide-land var(--training-guide-enter) var(--training-guide-ease) both;
  border: 3px solid var(--training-guide-accent);
  border-radius: var(--training-guide-radius);
  box-shadow:
    inset 0 0 0 1.5px rgba(255, 255, 255, 0.9),
    0 0 0 1.5px rgba(255, 255, 255, 0.9),
    0 0 22px 3px rgba(var(--training-guide-accent-rgb), 0.5);
  position: fixed;
}
/* Two staggered ripples radiate outward from the ring. */
.training-guide-overlay__ring::before,
.training-guide-overlay__ring::after {
  animation: training-guide-ripple 2s var(--training-guide-ease) var(--training-guide-enter) infinite both;
  border: 2px solid rgba(var(--training-guide-accent-rgb), 0.6);
  border-radius: calc(var(--training-guide-radius) + 5px);
  content: "";
  inset: -6px;
  position: absolute;
}
.training-guide-overlay__ring::after {
  animation-delay: calc(var(--training-guide-enter) + 1s);
}

/* The coach-mark caption: a filled M3 rich tooltip with a pointer. */
.training-guide-overlay__caption {
  align-items: center;
  animation: training-guide-caption-below var(--training-guide-enter) var(--training-guide-ease) 90ms both;
  background: var(--training-guide-accent);
  border-radius: var(--training-guide-radius);
  box-shadow: var(--v64-elevation-3, 0 4px 8px 3px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.12)),
    0 10px 28px rgba(var(--training-guide-accent-rgb), 0.28);
  box-sizing: border-box;
  color: var(--training-guide-on-accent);
  display: flex;
  font: var(--v64-type-label-lg, 500 0.875rem/1.25rem system-ui, sans-serif);
  font-weight: 650;
  gap: var(--v64-space-2, 8px);
  letter-spacing: 0.01em;
  padding: 10px 16px 13px 10px;
  position: fixed;
  width: max-content;
}
.training-guide-overlay__caption--above {
  animation-name: training-guide-caption-above;
}
.training-guide-overlay__caption::before {
  background: inherit;
  border-radius: 2px;
  content: "";
  height: 12px;
  left: calc(var(--training-guide-arrow, 24px) - 6px);
  position: absolute;
  top: -5px;
  transform: rotate(45deg);
  width: 12px;
}
.training-guide-overlay__caption--above::before {
  bottom: -5px;
  top: auto;
}
.training-guide-overlay__caption--inside::before {
  display: none;
}
.training-guide-overlay__caption-icon {
  background: rgba(255, 255, 255, 0.22);
  border-radius: 999px;
  box-sizing: border-box;
  fill: currentColor;
  flex: 0 0 auto;
  height: 30px;
  padding: 5px;
  width: 30px;
}
.training-guide-overlay__caption-text {
  min-width: 0;
  overflow-wrap: anywhere;
}
/* The ring's real remaining time, draining along the caption's lower edge. */
.training-guide-overlay__timer {
  animation: training-guide-timer var(--training-guide-lifetime, 8000ms) linear both;
  background: currentColor;
  border-radius: 999px;
  bottom: 5px;
  height: 2px;
  left: 50px;
  opacity: 0.5;
  position: absolute;
  right: 16px;
  transform-origin: left center;
}

.training-guide-overlay--still *,
.training-guide-overlay--still *::before,
.training-guide-overlay--still *::after {
  animation: none !important;
}
.training-guide-overlay--still .training-guide-overlay__ring::before,
.training-guide-overlay--still .training-guide-overlay__ring::after,
.training-guide-overlay--still .training-guide-overlay__timer {
  display: none;
}

@keyframes training-guide-scrim {
  from { box-shadow: 0 0 0 200vmax rgba(12, 16, 28, 0); }
}
@keyframes training-guide-land {
  from { opacity: 0; transform: scale(1.4); }
}
@keyframes training-guide-ripple {
  0% { opacity: 0.85; transform: scale(1); }
  70%, 100% { opacity: 0; transform: scale(1.22); }
}
@keyframes training-guide-caption-below {
  from { opacity: 0; transform: translateY(-10px) scale(0.94); }
}
@keyframes training-guide-caption-above {
  from { opacity: 0; transform: translateY(10px) scale(0.94); }
}
@keyframes training-guide-timer {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}
@media (prefers-reduced-motion: reduce) {
  .training-guide-overlay *,
  .training-guide-overlay *::before,
  .training-guide-overlay *::after { animation: none !important; }
  .training-guide-overlay__ring::before,
  .training-guide-overlay__ring::after,
  .training-guide-overlay__timer { display: none; }
}
</style>
