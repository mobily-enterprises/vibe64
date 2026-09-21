<script setup>
import { RouterView } from "vue-router";
import ShellErrorHost from "@jskit-ai/shell-web/client/components/ShellErrorHost";
import { useVibe64InAppLinks } from "./composables/useVibe64InAppLinks.js";

useVibe64InAppLinks();
</script>

<template>
  <v-app>
    <RouterView />
    <ShellErrorHost />
  </v-app>
</template>

<style>
/* The shared goal control has no color prop for its hard-coded paused indicator. */
.v-application .assistant-goal .assistant-goal__light--paused {
  background: rgb(var(--v-theme-warning));
  box-shadow: 0 0 0 3px rgba(var(--v-theme-warning), 0.12);
}

.v-application .v-btn.v-btn--variant-outlined.text-primary:not(.v-btn--disabled) {
  background: rgba(var(--v-theme-primary), 0.1) !important;
  border-color: rgba(var(--v-theme-primary), 0.32) !important;
  color: rgb(var(--v-theme-primary)) !important;
}

.v-application .v-btn.v-btn--variant-outlined.text-primary:not(.v-btn--disabled):hover {
  background: rgba(var(--v-theme-primary), 0.14) !important;
}

.v-application .v-field--variant-outlined .v-field__outline {
  --v-field-border-opacity: 1;
  color: rgba(var(--v-theme-on-surface), 0.42);
}

.v-application .v-field--variant-outlined.v-field--focused {
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.28);
}

.v-application .v-field--variant-outlined.v-field--focused .v-field__outline {
  color: rgb(var(--v-theme-primary));
}
</style>
