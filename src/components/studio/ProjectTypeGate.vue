<template>
  <div class="project-type-gate">
    <StudioErrorNotice
      v-if="errorMessage"
      title="Project type could not load"
      :error="errorMessage"
      compact
    />

    <v-progress-linear
      v-if="loading && !targetProject"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <ProjectTypeSetup
      v-else-if="needsProjectType"
      :saving-type="savingType"
      :state="projectType"
      @select="saveProjectType"
    />

    <slot
      v-else-if="targetProject"
      :target-project="targetProject"
      :reload="loadTargetProject"
    />
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useView } from "@jskit-ai/users-web/client/composables/useView";
import ProjectTypeSetup from "@/components/studio/ProjectTypeSetup.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS
} from "@/lib/aiStudioRequestConfig.js";
import {
  AI_STUDIO_PROJECT_TYPE_API_SUFFIX,
  TARGET_PROJECT_API_SUFFIX
} from "@/lib/studioGateApi.js";

const emit = defineEmits(["ready", "missing", "error"]);

const savingType = ref("");

const targetProjectView = useView({
  access: "never",
  apiSuffix: TARGET_PROJECT_API_SUFFIX,
  fallbackLoadError: "Target project inspection failed.",
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.target-project.view",
  surfaceId: AI_STUDIO_SURFACE_ID
});

const projectTypeView = useView({
  access: "never",
  apiSuffix: AI_STUDIO_PROJECT_TYPE_API_SUFFIX,
  fallbackLoadError: "Project type could not load.",
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.project-type.view",
  surfaceId: AI_STUDIO_SURFACE_ID
});

const saveProjectTypeCommand = useCommand({
  access: "never",
  apiSuffix: AI_STUDIO_PROJECT_TYPE_API_SUFFIX,
  buildCommandOptions: () => ({
    method: "PUT",
    options: LOCAL_STUDIO_COMMAND_OPTIONS
  }),
  buildRawPayload: (_model, { context }) => ({
    projectType: String(context.projectType || "")
  }),
  fallbackRunError: "Project type could not be saved.",
  messages: {
    error: "Project type could not be saved.",
    success: "Project type saved."
  },
  onRunSuccess: async () => {
    await loadTargetProject();
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.project-type.save",
  surfaceId: AI_STUDIO_SURFACE_ID,
  writeMethod: "PUT"
});

const targetProject = computed(() => {
  if (!targetProjectView.record) {
    return null;
  }
  return {
    ...targetProjectView.record,
    projectType: projectTypeView.record?.projectType || {}
  };
});
const projectType = computed(() => targetProject.value?.projectType || {});
const needsProjectType = computed(() => targetProject.value && projectType.value?.ready !== true);
const loading = computed(() => Boolean(targetProjectView.isLoading || projectTypeView.isLoading));
const saveError = computed(() => {
  return saveProjectTypeCommand.messageType === "error"
    ? String(saveProjectTypeCommand.message || "")
    : "";
});
const errorMessage = computed(() => String(
  targetProjectView.loadError ||
  projectTypeView.loadError ||
  saveError.value ||
  ""
));

async function loadTargetProject() {
  await Promise.all([
    targetProjectView.refresh(),
    projectTypeView.refresh()
  ]);
}

async function saveProjectType(projectTypeId) {
  savingType.value = String(projectTypeId || "");
  try {
    await saveProjectTypeCommand.run({
      projectType: savingType.value
    });
  } finally {
    savingType.value = "";
  }
}

watch(targetProject, (project) => {
  if (!project) {
    return;
  }
  if (project.projectType?.ready === true) {
    emit("ready", project);
    return;
  }
  emit("missing", project);
}, {
  immediate: true
});

watch(errorMessage, (message) => {
  if (message) {
    emit("error", message);
  }
});
</script>

<style scoped>
.project-type-gate {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}
</style>
