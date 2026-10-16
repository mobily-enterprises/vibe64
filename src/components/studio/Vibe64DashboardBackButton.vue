<script setup>
import { mdiArrowLeft } from "@mdi/js";
</script>

<template>
  <v-btn :prepend-icon="mdiArrowLeft" size="x-small" type="button" variant="text">
    <slot>Back to dashboard</slot>
  </v-btn>
</template>
