<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { redirectToChild } from "@jskit-ai/kernel/client/pageRedirects";
import { RouterView } from "vue-router";
import SectionContainerShell from "/src/components/SectionContainerShell.vue";

definePage({
  redirect: redirectToChild("connections")
});

defineProps({
  dashboardContext: {
    default: () => ({}),
    type: Object
  },
  projectContext: {
    default: () => ({}),
    type: Object
  },
  saveProjectConfig: {
    default: null,
    type: Function
  },
  savingProjectConfig: {
    default: false,
    type: Boolean
  }
});
</script>

<template>
  <SectionContainerShell>
    <template #tabs>
      <ShellOutlet target="home-dashboard:primary-menu" />
    </template>

    <RouterView
      :dashboard-context="dashboardContext"
      :project-context="projectContext"
      :save-project-config="saveProjectConfig"
      :saving-project-config="savingProjectConfig"
    />
  </SectionContainerShell>
</template>
