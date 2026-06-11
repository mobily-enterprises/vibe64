<template>
  <section class="vibe64-dashboard-page">
    <Vibe64SetupPanel
      :model-value="activeTab"
      @update:model-value="selectTab"
    />
  </section>
</template>

<script setup>
import Vibe64SetupPanel from "@/components/studio/Vibe64SetupPanel.vue";
import {
  useVibe64DashboardSetupPage
} from "@/composables/useVibe64DashboardSetupPage.js";

const { activeTab, selectTab } = useVibe64DashboardSetupPage();
</script>

<style scoped>
.vibe64-dashboard-page {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}
</style>
