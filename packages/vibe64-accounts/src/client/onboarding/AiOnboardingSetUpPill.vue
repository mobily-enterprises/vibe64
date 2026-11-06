<script setup>
// Top bar reminder, shown until this viewer has a usable AI; compact on phones.
import { aiOnboardingNeeded, requestVibe64AiOnboarding } from "./aiOnboardingEvents.js";
</script>

<template>
  <button v-if="aiOnboardingNeeded" type="button" class="aio-setup-pill" @click="requestVibe64AiOnboarding({ start: 'choose', returnFocus: $event.currentTarget })">
    <v-icon icon="$crown" aria-hidden="true" />
    Set up AI
  </button>
</template>

<style scoped>
.aio-setup-pill {
  align-items: center;
  background: var(--v64-learning);
  border: 0;
  border-radius: var(--v64-shape-full);
  box-shadow: 0 4px 12px -6px rgb(160 110 0 / 70%);
  color: var(--v64-on-learning);
  cursor: pointer;
  display: inline-flex;
  flex: none;
  font: var(--v64-type-label-lg);
  gap: 6px;
  height: 36px;
  margin-inline-end: var(--v64-space-2);
  padding: 0 14px 0 10px;
  white-space: nowrap;
}
.aio-setup-pill:focus-visible { outline: var(--v64-focus-ring-width) solid rgb(var(--v-theme-primary)); outline-offset: var(--v64-focus-ring-offset); }
.aio-setup-pill .v-icon { font-size: 18px; height: 18px; width: 18px; }
@media (hover: hover) {
  .aio-setup-pill:hover { background: color-mix(in srgb, var(--v64-learning), var(--v64-on-learning) 8%); }
}
@media (max-width: 599.98px) {
  .aio-setup-pill { font: var(--v64-type-label-md); gap: 4px; height: 32px; margin-inline-end: var(--v64-space-1); padding: 0 10px 0 8px; }
  .aio-setup-pill .v-icon { font-size: 16px; height: 16px; width: 16px; }
}
</style>
