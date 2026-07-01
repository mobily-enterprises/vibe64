<template>
  <section class="vibe64-dashboard-page">
    <Vibe64SetupPanel
      :model-value="activeTab"
      :studio-setup-enabled="studioSetupEnabled"
      @update:model-value="selectTab"
    />
  </section>
</template>

<script setup>
import Vibe64SetupPanel from "@/components/studio/Vibe64SetupPanel.vue";
import { computed } from "vue";
import {
  useVibe64DashboardSetupPage
} from "@/composables/useVibe64DashboardSetupPage.js";

const props = defineProps({
  dashboardContext: {
    default: () => ({}),
    type: Object
  }
});

const studioSetupEnabled = computed(() => {
  return props.dashboardContext?.projectContext?.setup?.studioSetupEnabled !== false;
});
const { activeTab, selectTab } = useVibe64DashboardSetupPage({
  studioSetupEnabled
});
</script>

<style scoped>
.vibe64-dashboard-page {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}
</style>
