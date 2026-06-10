<template>
  <section class="vibe64-dashboard-page">
    <header class="vibe64-dashboard-page__header">
      <h1>Github repository</h1>
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
  margin-inline: auto;
  max-width: 68rem;
  min-width: 0;
  width: 100%;
}

.vibe64-dashboard-page__header {
  min-width: 0;
}

.vibe64-dashboard-page__header h1 {
  color: rgb(var(--v-theme-on-surface));
  font-size: var(--generated-ui-screen-title-size, clamp(1.2rem, 1.7vw, 1.55rem));
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.05;
  margin: 0 0 0.15rem;
}
</style>
