<template>
  <section class="vibe64-dashboard-page">
    <EnvPanel />
  </section>
</template>

<script setup>
import EnvPanel from "@/components/studio/EnvPanel.vue";
</script>

<style scoped>
.vibe64-dashboard-page {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}
</style>
