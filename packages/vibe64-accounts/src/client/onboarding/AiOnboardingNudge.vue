<script>
import { ref } from "vue";

// Dismissed for this page load, even if the Colleague panel remounts.
// readable-check: allow module-state - shared resource: one dismissal on the page holds for every nudge, including one a remounted Colleague panel shows
const dismissed = ref(false);
</script>

<script setup>
import { aiOnboardingNeeded, requestVibe64AiOnboarding } from "./aiOnboardingEvents.js";
</script>

<template>
  <aside v-if="aiOnboardingNeeded && !dismissed" class="aio-nudge" aria-label="Set up your AI">
    <v-icon class="aio-nudge__crown" icon="$crown" size="18" aria-hidden="true" />
    <p class="aio-nudge__text">Vibe64 has no AI yet. Connect Claude for the best experience, or start free with GLM-4.7.</p>
    <div class="aio-nudge__actions">
      <v-btn variant="text" color="primary" @click="requestVibe64AiOnboarding({ start: 'choose' })">Set up your AI</v-btn>
      <v-btn icon="$close" variant="text" size="48" aria-label="Dismiss" @click="dismissed = true" />
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
.aio-nudge__crown { color: var(--aio-crown-strong); flex: none; }
.aio-nudge__text { flex: 1 1 12rem; font: var(--v64-type-body-md); margin: 0; }
.aio-nudge__actions { align-items: center; display: flex; margin-left: auto; }
</style>
