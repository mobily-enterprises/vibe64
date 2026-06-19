<script setup>
import { RouterView } from "vue-router";
import ShellErrorHost from "@jskit-ai/shell-web/client/components/ShellErrorHost";
</script>

<template>
  <v-app>
    <RouterView />
    <ShellErrorHost />
  </v-app>
</template>

<style>
.v-application .v-btn.v-btn--variant-outlined.text-primary:not(.v-btn--disabled) {
  background: rgba(var(--v-theme-primary), 0.1) !important;
  border-color: rgba(var(--v-theme-primary), 0.32) !important;
  color: rgb(var(--v-theme-primary)) !important;
}

.v-application .v-btn.v-btn--variant-outlined.text-primary:not(.v-btn--disabled):hover {
  background: rgba(var(--v-theme-primary), 0.14) !important;
}
</style>
