<script setup>
import GithubPullRequestsPanel from "@/components/studio/GithubPullRequestsPanel.vue";

definePage({ meta: { jskit: { parent: "/project/:slug/dashboard" } } });
defineProps({ dashboardContext: { type: Object, default: () => ({}) } });
</script>
<template>
  <GithubPullRequestsPanel :dashboard-context="dashboardContext" />
</template>
