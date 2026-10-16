<script setup>
import { mdiArrowLeft } from "@mdi/js";
</script>

<template>
  <v-btn class="dashboard-back" :prepend-icon="mdiArrowLeft" size="x-small" type="button" variant="text">
    <slot>Back to dashboard</slot>
  </v-btn>
</template>

<style scoped>
.dashboard-back {
  font-size: 1rem;
}
</style>
