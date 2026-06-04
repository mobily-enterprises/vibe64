<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { redirectToChild } from "@jskit-ai/kernel/client/pageRedirects";
import { RouterView } from "vue-router";
import SectionContainerShell from "/src/components/SectionContainerShell.vue";
import getPlacements from "/src/placement.js";

definePage({
  redirect: redirectToChild("accounts")
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

const dashboardSectionLinks = getPlacements()
  .filter((placement) => (
    placement?.kind === "link" &&
    placement?.owner === "home-dashboard" &&
    placement?.target === "page.section-nav"
  ))
  .sort((left, right) => Number(left?.order || 0) - Number(right?.order || 0))
  .map((placement) => ({
    disabled: placement?.props?.disabled === true,
    icon: placement?.props?.icon || "",
    id: placement?.id || "",
    label: placement?.props?.label || "",
    to: placement?.props?.to || ""
  }));
</script>

<template>
  <SectionContainerShell :mobile-section-links="dashboardSectionLinks">
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
