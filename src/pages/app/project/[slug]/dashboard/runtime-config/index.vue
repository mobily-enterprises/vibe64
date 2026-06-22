<template>
  <section class="vibe64-dashboard-page">
    <RuntimeConfigPanel />
  </section>
</template>

<script setup>
import RuntimeConfigPanel from "@/components/studio/RuntimeConfigPanel.vue";
</script>

<style scoped>
.vibe64-dashboard-page {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}
</style>
