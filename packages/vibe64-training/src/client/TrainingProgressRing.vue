<script setup>
import { computed } from "vue";

// M3 circular determinate indicator with rounded caps for supplied counts.
const props = defineProps({
  value: { type: Number, default: 0 },
  max: { type: Number, default: 0 },
  size: { type: Number, default: 72 },
  stroke: { type: Number, default: 8 },
  label: { type: String, required: true }
});
const radius = computed(() => (props.size - props.stroke) / 2);
const circumference = computed(() => 2 * Math.PI * radius.value);
const fraction = computed(() => props.max > 0 ? Math.min(1, Math.max(0, props.value / props.max)) : 0);
const percent = computed(() => Math.round(fraction.value * 100));
// Leave a small M3 gap between the indicator and the track.
const gap = computed(() => fraction.value > 0 && fraction.value < 1 ? props.stroke * 1.5 : 0);
const visible = computed(() => Math.max(0, fraction.value * circumference.value - gap.value));
</script>

<template>
  <div class="training-progress-ring" role="progressbar" :aria-label="label" aria-valuemin="0" :aria-valuemax="max"
    :aria-valuenow="Math.min(value, max)" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg :viewBox="`0 0 ${size} ${size}`" aria-hidden="true" focusable="false">
      <circle class="training-progress-ring__track" :cx="size / 2" :cy="size / 2" :r="radius" fill="none" :stroke-width="stroke" />
      <circle v-if="visible > 0" class="training-progress-ring__indicator" :cx="size / 2" :cy="size / 2" :r="radius" fill="none"
        :stroke-width="stroke" stroke-linecap="round" :stroke-dasharray="`${visible} ${circumference}`"
        :transform="`rotate(-90 ${size / 2} ${size / 2})`" />
    </svg>
    <span class="training-progress-ring__content"><slot>{{ percent }}%</slot></span>
  </div>
</template>

<style scoped>
.training-progress-ring { position: relative; flex: none; display: inline-grid; place-items: center; }
.training-progress-ring svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.training-progress-ring__track { stroke: var(--training-ring-track, var(--v64-outline-variant, rgba(127, 127, 127, 0.2))); }
.training-progress-ring__indicator {
  stroke: var(--training-ring-color, var(--v64-primary, currentColor));
  transition: stroke-dasharray var(--v64-duration-long, 500ms) var(--v64-ease-emphasized-decelerate, ease-out);
}
.training-progress-ring__content { position: relative; font: var(--v64-type-label-lg, 500 0.875rem/1.25rem system-ui, sans-serif); font-variant-numeric: tabular-nums; }
</style>
