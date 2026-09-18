<script setup>
import GithubPullRequestsPanel from "@/components/studio/GithubPullRequestsPanel.vue";
defineProps({ dashboardContext: { type: Object, default: () => ({}) } });
</script>
<template>
  <GithubPullRequestsPanel :dashboard-context="dashboardContext" />
</template>
