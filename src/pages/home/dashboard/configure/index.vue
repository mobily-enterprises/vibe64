<template>
  <section class="vibe64-dashboard-page">
    <ProjectConfigSetup
      :saving="savingProjectConfig"
      :state="projectConfig"
      @save="saveConfig"
    />
  </section>
</template>

<script setup>
import { computed } from "vue";
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
  min-width: 0;
}
</style>
