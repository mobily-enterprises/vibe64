<template>
  <Vibe64RepositoryWorkspace
    v-if="dashboardContext.active !== false"
    :dashboard-context="dashboardContext"
    view="changes"
  />
</template>

<script setup>
import Vibe64RepositoryWorkspace from "@/components/studio/repository/Vibe64RepositoryWorkspace.vue";

definePage({ meta: { jskit: { parent: "/project/:slug/dashboard" } } });

defineProps({
  dashboardContext: { default: () => ({}), type: Object }
});
</script>
