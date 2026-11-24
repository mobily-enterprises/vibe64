<script setup>
import ShellLayout from "@/components/ShellLayout.vue";

const message = "The page you requested does not exist.";
</script>

<template>
  <!-- The shell's top app bar carries the title, and its navigation leads back into the app. -->
  <ShellLayout title="Not Found">
    <section class="d-flex flex-column align-center text-center on-surface-variant py-16">
      <v-icon icon="$searchOff" size="48" />
      <p class="text-body-large mt-4 mb-0">{{ message }}</p>
    </section>
  </ShellLayout>
</template>
