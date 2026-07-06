<template>
  <section class="vibe64-dashboard-page">
    <AdapterSettingsPanel />
  </section>
</template>

<script setup>
import AdapterSettingsPanel from "@/components/studio/AdapterSettingsPanel.vue";
</script>

<style scoped>
.vibe64-dashboard-page {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}
</style>
