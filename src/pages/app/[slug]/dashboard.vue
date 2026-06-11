<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { redirectToChild } from "@jskit-ai/kernel/client/pageRedirects";
import { RouterView } from "vue-router";
import SectionContainerShell from "/src/components/SectionContainerShell.vue";
import {
  useVibe64DashboardPage
} from "@/composables/useVibe64DashboardPage.js";

definePage({
  redirect: redirectToChild("configure")
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

const { dashboardSectionLinks } = useVibe64DashboardPage();
</script>

<template>
  <SectionContainerShell :mobile-section-links="dashboardSectionLinks">
    <template #tabs>
      <ShellOutlet target="app-dashboard:primary-menu" />
    </template>

    <RouterView
      :dashboard-context="dashboardContext"
      :project-context="projectContext"
      :save-project-config="saveProjectConfig"
      :saving-project-config="savingProjectConfig"
    />
  </SectionContainerShell>
</template>
