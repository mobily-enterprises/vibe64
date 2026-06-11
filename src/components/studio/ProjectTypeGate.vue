<template>
  <div class="project-type-gate">
    <StudioErrorNotice
      v-if="errorMessage"
      title="Project setup could not load"
      :error="errorMessage"
      compact
    />

    <ProjectTypeSetup
      v-if="needsProjectType"
      :state="projectType"
      @select="selectDraftProjectType"
    />

    <ProjectConfigSetup
      v-else-if="needsProjectConfig"
      :can-change-project-type="hasDraftProjectType"
      :saving="savingConfig"
      :setup-summary="projectConfigSetupSummary"
      :state="projectConfig"
      @change-project-type="clearDraftProjectType"
      @save="saveProjectConfig"
    />

    <slot
      v-else-if="projectReady"
      :target-project="projectState"
      :reload="loadProjectState"
      :save-project-config="saveProjectConfig"
      :saving-config="savingConfig"
    />
  </div>
</template>

<script setup>
import ProjectConfigSetup from "@/components/studio/ProjectConfigSetup.vue";
import ProjectTypeSetup from "@/components/studio/ProjectTypeSetup.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import { useProjectTypeGate } from "@/composables/useProjectTypeGate.js";

const emit = defineEmits(["ready", "missing", "error"]);
const props = defineProps({
  configureProject: {
    default: false,
    type: Boolean
  }
});

const {
  clearDraftProjectType,
  errorMessage,
  hasDraftProjectType,
  loadProjectState,
  needsProjectConfig,
  needsProjectType,
  projectConfig,
  projectConfigSetupSummary,
  projectReady,
  projectState,
  projectType,
  saveProjectConfig,
  savingConfig,
  selectDraftProjectType
} = useProjectTypeGate({
  configureProject: () => props.configureProject,
  emit
});
</script>

<style scoped>
.project-type-gate {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}
</style>
