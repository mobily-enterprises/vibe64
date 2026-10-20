<script setup>
// Top bar reminder, shown until this viewer has a usable AI; icon-only on phones.
import { mdiCrown } from "@mdi/js";
import { aiOnboardingNeeded, requestVibe64AiOnboarding } from "./aiOnboardingEvents.js";
</script>

<template>
  <button v-if="aiOnboardingNeeded" type="button" class="aio-setup-pill" aria-label="Set up AI" @click="requestVibe64AiOnboarding({ start: 'choose', returnFocus: $event.currentTarget })">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="mdiCrown" /></svg>
    <span class="aio-setup-pill__label">Set up AI</span>
  </button>
</template>

<style scoped>
.aio-setup-pill {
  align-items: center;
  background: #f5c518;
  border: 0;
  border-radius: var(--v64-shape-full);
  box-shadow: 0 4px 12px -6px rgb(160 110 0 / 70%);
  color: #2b2100;
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
.aio-setup-pill:hover { background: #f9d65c; }
.aio-setup-pill:focus-visible { outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color); outline-offset: var(--v64-focus-ring-offset); }
.aio-setup-pill svg { fill: currentColor; height: 18px; width: 18px; }
@media (max-width: 599.98px) {
  .aio-setup-pill { justify-content: center; padding: 0; width: 36px; }
  .aio-setup-pill__label { display: none; }
}
</style>
