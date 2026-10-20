<script>
import { ref } from "vue";

// Dismissed for this page load, even if the Colleague panel remounts.
const dismissed = ref(false);
</script>

<script setup>
import { mdiClose, mdiCrown } from "@mdi/js";
import { aiOnboardingNeeded, requestVibe64AiOnboarding } from "./aiOnboardingEvents.js";
</script>

<template>
  <aside v-if="aiOnboardingNeeded && !dismissed" class="aio-nudge" aria-label="Set up your AI">
    <svg class="aio-nudge__crown" viewBox="0 0 24 24" aria-hidden="true"><path :d="mdiCrown" /></svg>
    <p class="aio-nudge__text">Colleague is on a free starter model. Connect Claude for a much smarter Vibe64.</p>
    <div class="aio-nudge__actions">
      <v-btn variant="text" color="primary" @click="requestVibe64AiOnboarding({ start: 'choose' })">Set up your AI</v-btn>
      <v-btn :icon="mdiClose" variant="text" size="48" aria-label="Dismiss" @click="dismissed = true" />
    </div>
  </aside>
</template>

<style scoped>
.aio-nudge {
  --aio-crown-strong: #8a6a00;
  align-items: center;
  background: var(--v64-secondary-container);
  border-radius: var(--v64-shape-md);
  color: var(--v64-on-secondary-container);
  display: flex;
  flex-wrap: wrap;
  gap: var(--v64-space-1) var(--v64-space-3);
  padding: var(--v64-space-3) var(--v64-space-1) var(--v64-space-3) var(--v64-space-4);
}
.v-theme--dark .aio-nudge { --aio-crown-strong: #f5c518; }
.aio-nudge__crown { fill: var(--aio-crown-strong); flex: none; height: 18px; width: 18px; }
.aio-nudge__text { flex: 1 1 12rem; font: var(--v64-type-body-md); margin: 0; }
.aio-nudge__actions { align-items: center; display: flex; margin-left: auto; }
</style>
