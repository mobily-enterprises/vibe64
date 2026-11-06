<script setup>
import AiOnboardingMark from "./AiOnboardingMark.vue";

// Success's provider mark: it arrives with a glow in the provider's tone, and a
// check draws in once Colleague has proved it answers.
defineProps({
  provider: { type: Object, required: true },
  proven: Boolean
});
</script>

<template>
  <div class="aio-success-mark" :class="`aio-success-mark--${provider.tone}`">
    <AiOnboardingMark :provider="provider" :size="96" :settle-delay="provider.crown ? 350 : -1" />
    <svg v-if="proven" class="aio-check" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="18" />
      <path d="M12 20.5 l5.5 5.5 l10.5 -11" />
    </svg>
  </div>
</template>

<style scoped>
.aio-success-mark {
  animation: aio-arrive var(--v64-duration-long) var(--v64-ease-emphasized-decelerate) both;
  margin-bottom: var(--v64-space-6);
  position: relative;
}
/* A soft glow in the provider's tone behind the tile. */
.aio-success-mark::before {
  animation: aio-glow 1400ms var(--v64-ease-emphasized-decelerate) 120ms both;
  background: radial-gradient(closest-side, var(--aio-glow), transparent);
  content: "";
  inset: -56px;
  position: absolute;
  z-index: -1;
}
.aio-success-mark--primary { --aio-glow: color-mix(in srgb, var(--aio-crown) 45%, transparent); }
.aio-success-mark--secondary { --aio-glow: color-mix(in srgb, rgb(var(--v-theme-primary)) 30%, transparent); }
.aio-success-mark--tertiary { --aio-glow: color-mix(in srgb, rgb(var(--v-theme-tertiary)) 40%, transparent); }
.aio-success-mark--neutral { --aio-glow: color-mix(in srgb, rgb(var(--v-theme-outline)) 40%, transparent); }
.aio-check {
  animation: aio-pop var(--v64-duration-medium) var(--v64-ease-emphasized-decelerate) both;
  bottom: -10px;
  height: 40px;
  position: absolute;
  right: -12px;
  width: 40px;
}
.aio-check circle { fill: rgb(var(--v-theme-success)); stroke: rgb(var(--v-theme-surface)); stroke-width: 3; }
.aio-check path {
  animation: aio-draw calc(var(--v64-duration-medium) + 100ms) var(--v64-ease-emphasized-decelerate) 150ms both;
  fill: none;
  stroke: rgb(var(--v-theme-on-success));
  stroke-dasharray: 28;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 3.5;
}
@keyframes aio-arrive { from { opacity: 0; transform: scale(0.6); } 70% { opacity: 1; transform: scale(1.06); } }
@keyframes aio-glow { from { opacity: 0; transform: scale(0.4); } }
@keyframes aio-draw { from { stroke-dashoffset: 28; } to { stroke-dashoffset: 0; } }
@keyframes aio-pop { from { opacity: 0; transform: scale(0.4); } 60% { opacity: 1; transform: scale(1.12); } }

@media (prefers-reduced-motion: reduce) {
  .aio-success-mark, .aio-success-mark::before, .aio-check, .aio-check path { animation: none; }
}
</style>
