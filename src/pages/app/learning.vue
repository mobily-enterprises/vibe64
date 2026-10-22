<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "app"
    }
  }
}
</route>

<script setup>
import ProjectPage from "./project/[slug].vue";

// /app/learning (both hosts): Learn mode with no practice project selected
// (no lesson, or a lesson without one) is the project page
// with no project selected.
</script>

<template>
  <ProjectPage />
</template>
