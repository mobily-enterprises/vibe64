<script setup>
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";
import { redirectToChild } from "@jskit-ai/kernel/client/pageRedirects";
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
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

const route = useRoute();
const workspaceSlug = computed(() => firstRouteParam(route.params.slug));
const workspaceBasePath = computed(() => workspaceSlug.value ? `/app/${encodeURIComponent(workspaceSlug.value)}` : "/app/manage");
const dashboardSectionLinks = computed(() => getPlacements()
  .filter((placement) => (
    placement?.kind === "link" &&
    placement?.owner === "app-dashboard" &&
    placement?.target === "page.section-nav"
  ))
  .sort((left, right) => Number(left?.order || 0) - Number(right?.order || 0))
  .map((placement) => ({
    disabled: placement?.props?.disabled === true,
    icon: placement?.props?.icon || "",
    id: placement?.id || "",
    label: placement?.props?.label || "",
    to: `${workspaceBasePath.value}${placement?.props?.scopedSuffix || placement?.props?.unscopedSuffix || ""}`
  })));

function firstRouteParam(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").trim();
}
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
