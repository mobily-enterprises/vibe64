<template>
  <section class="vibe64-dashboard-page">
    <AccountsSetup
      lede="Connect GitHub and set the Git identity Studio will use for commits, pull requests, and merge actions."
      needed-label="GitHub configuration required"
      :provider-ids="['github']"
      ready-label="GitHub configured"
      :show-continue="false"
      title="GitHub"
    />
    <ProjectConfigSetup
      :saving="savingProjectConfig"
      :state="projectConfig"
      @save="saveConfig"
    />
  </section>
</template>

<script setup>
import { computed } from "vue";
import AccountsSetup from "@/components/studio/AccountsSetup.vue";
import ProjectConfigSetup from "@/components/studio/ProjectConfigSetup.vue";

const props = defineProps({
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

const projectConfig = computed(() => props.projectContext?.projectConfig || {});

function saveConfig(values = {}) {
  if (typeof props.saveProjectConfig === "function") {
    props.saveProjectConfig(values);
  }
}
</script>

<style scoped>
.vibe64-dashboard-page {
  display: grid;
  gap: 1rem;
  min-width: 0;
}
</style>
