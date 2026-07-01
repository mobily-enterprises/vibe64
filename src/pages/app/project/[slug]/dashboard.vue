<script setup>
import { redirectToChild } from "@jskit-ai/kernel/client/pageRedirects";
import { RouterView } from "vue-router";
import Vibe64DashboardShell from "@/components/studio/Vibe64DashboardShell.vue";

definePage({
  redirect: redirectToChild("env")
});

const props = defineProps({
  dashboardContext: {
    default: () => ({}),
    type: Object
  }
});
</script>

<template>
  <RouterView
    v-if="dashboardContext?.embeddedShell"
    :dashboard-context="dashboardContext"
  />
  <Vibe64DashboardShell
    v-else
    :dashboard-context="props.dashboardContext"
  >
    <RouterView
      :dashboard-context="dashboardContext"
    />
  </Vibe64DashboardShell>
</template>
