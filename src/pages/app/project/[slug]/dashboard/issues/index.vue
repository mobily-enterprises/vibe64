<script setup>
import GithubIssuesPanel from "@/components/studio/GithubIssuesPanel.vue";

definePage({ meta: { jskit: { parent: "/project/:slug/dashboard" } } });
defineProps({ dashboardContext: { type: Object, default: () => ({}) } });
</script>
<template>
  <GithubIssuesPanel :dashboard-context="dashboardContext" />
</template>
