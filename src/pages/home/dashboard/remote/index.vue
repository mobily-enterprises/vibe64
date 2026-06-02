<template>
  <section class="vibe64-dashboard-page">
    <header class="vibe64-dashboard-page__header">
      <h2>Remote</h2>
      <p>Run configured remote project actions from the main checkout.</p>
    </header>

    <Vibe64ProjectTools display-mode="panel" />
  </section>
</template>

<script setup>
import Vibe64ProjectTools from "@/components/studio/Vibe64ProjectTools.vue";
</script>

<style scoped>
.vibe64-dashboard-page {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}

.vibe64-dashboard-page__header {
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.12);
  padding-bottom: 0.65rem;
}

.vibe64-dashboard-page__header h2,
.vibe64-dashboard-page__header p {
  letter-spacing: 0;
  margin: 0;
}

.vibe64-dashboard-page__header h2 {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1rem;
  font-weight: 760;
  line-height: 1.15;
}

.vibe64-dashboard-page__header p {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.84rem;
  line-height: 1.35;
  margin-top: 0.18rem;
}
</style>
