<script setup>
import { mdiArrowLeft } from "@mdi/js";
</script>

<template>
  <v-btn
    class="dashboard-back"
    color="primary"
    :prepend-icon="mdiArrowLeft"
    rounded="pill"
    type="button"
    variant="text"
  >
    <slot>Back to dashboard</slot>
  </v-btn>
</template>

<style scoped>
.dashboard-back {
  font: var(--v64-type-label-lg, 500 0.875rem/1.25rem system-ui, sans-serif);
  font-size: 0.95rem;
  height: 40px;
  letter-spacing: 0;
  min-height: 40px;
  padding-inline: var(--v64-space-3, 12px) var(--v64-space-4, 16px);
  text-transform: none;
}

.dashboard-back :deep(.v-btn__prepend) {
  margin-inline-end: var(--v64-space-2, 8px);
}

.dashboard-back:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
</style>
