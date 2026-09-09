<script setup>
import IntegrationsPanel from "@/components/studio/IntegrationsPanel.vue";
defineProps({ dashboardContext: { type: Object, default: () => ({}) } });
</script>
<template>
  <IntegrationsPanel :key="dashboardContext.sessionId || 'none'" :dashboard-context="dashboardContext" />
</template>
