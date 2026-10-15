<script setup>
import IncomingChangesPanel from "@/components/studio/IncomingChangesPanel.vue";
defineProps({ dashboardContext: { type: Object, default: () => ({}) } });
</script>
<template>
  <IncomingChangesPanel :dashboard-context="dashboardContext" />
</template>
