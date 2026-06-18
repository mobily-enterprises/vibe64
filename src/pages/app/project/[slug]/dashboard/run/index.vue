<template>
  <section class="vibe64-dashboard-page">
    <TargetScriptsPanel mode="inspect" />
  </section>
</template>

<script setup>
import TargetScriptsPanel from "@/components/studio/TargetScriptsPanel.vue";

defineProps({
  dashboardContext: {
    default: () => ({}),
    type: Object
  }
});
</script>

<style scoped>
.vibe64-dashboard-page {
  min-width: 0;
}
</style>
