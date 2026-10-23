<template>
  <PublishPage :dashboard-context="dashboardContext" />
</template>

<script setup>
import PublishPage from "@local/vibe64-publishing/client/publish-page";

defineProps({
  dashboardContext: { default: () => ({}), type: Object }
});
</script>
