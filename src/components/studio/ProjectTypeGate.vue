<template>
  <div class="project-type-gate">
    <StudioErrorNotice
      v-if="errorMessage"
      title="Project setup could not load"
      :error="errorMessage"
      compact
    />

    <template v-if="projectTemplateChooserVisible || canReturnToProjectTemplates">
      <ProjectTemplateSetup
        v-show="projectTemplateChooserVisible"
        :applying-template-id="applyingTemplateId"
        :loading="projectTemplatesLoading"
        :templates="projectTemplates"
        @advanced="showAdvancedProjectSetup"
        @apply="applyProjectTemplate"
      />
    </template>

    <div
      v-if="needsProjectType && !projectTemplateChooserVisible"
      class="project-type-gate__advanced"
    >
      <v-btn
        v-if="canReturnToProjectTemplates"
        class="project-type-gate__templates-back"
        :prepend-icon="mdiArrowLeft"
        color="primary"
        variant="text"
        @click="showProjectTemplates"
      >
        Back to ready-made apps
      </v-btn>
      <ProjectTypeSetup
        :state="projectType"
        @select="selectDraftProjectType"
      />
    </div>

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
import { mdiArrowLeft } from "@mdi/js";
import ProjectConfigSetup from "@/components/studio/ProjectConfigSetup.vue";
import ProjectTemplateSetup from "@/components/studio/ProjectTemplateSetup.vue";
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
  applyProjectTemplate,
  applyingTemplateId,
  canReturnToProjectTemplates,
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
  projectTemplateChooserVisible,
  projectTemplates,
  projectTemplatesLoading,
  projectType,
  saveProjectConfig,
  savingConfig,
  selectDraftProjectType,
  showAdvancedProjectSetup,
  showProjectTemplates
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

.project-type-gate__advanced {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.project-type-gate__templates-back {
  align-self: flex-start;
  flex: 0 0 auto;
  margin: 0.2rem 0.55rem 0.15rem;
  text-transform: none;
}
</style>
