<script setup>
import GithubIssuesPanel from "@/components/studio/GithubIssuesPanel.vue";
defineProps({ dashboardContext: { type: Object, default: () => ({}) } });
</script>
<template>
  <GithubIssuesPanel :dashboard-context="dashboardContext" />
</template>
