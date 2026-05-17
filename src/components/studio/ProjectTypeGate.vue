<template>
  <div class="project-type-gate">
    <StudioErrorNotice
      v-if="errorMessage"
      title="Project setup could not load"
      :error="errorMessage"
      compact
    />

    <v-progress-linear
      v-if="showLoadingBar"
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

    <ProjectConfigSetup
      v-else-if="needsProjectConfig"
      :saving="savingConfig"
      :state="projectConfig"
      @save="saveProjectConfig"
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
import ProjectConfigSetup from "@/components/studio/ProjectConfigSetup.vue";
import ProjectTypeSetup from "@/components/studio/ProjectTypeSetup.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS
} from "@/lib/aiStudioRequestConfig.js";
import {
  AI_STUDIO_PROJECT_CONFIG_API_SUFFIX,
  AI_STUDIO_PROJECT_TYPE_API_SUFFIX,
  TARGET_PROJECT_API_SUFFIX,
  projectConfigQueryKey,
  projectTypeQueryKey,
  targetProjectQueryKey
} from "@/lib/studioGateApi.js";

const emit = defineEmits(["ready", "missing", "error"]);

const savingConfig = ref(false);
const savingType = ref("");

const targetProjectView = useView({
  access: "never",
  apiSuffix: TARGET_PROJECT_API_SUFFIX,
  fallbackLoadError: "Target project inspection failed.",
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.target-project.view",
  queryKeyFactory: targetProjectQueryKey,
  surfaceId: AI_STUDIO_SURFACE_ID
});

const projectTypeView = useView({
  access: "never",
  apiSuffix: AI_STUDIO_PROJECT_TYPE_API_SUFFIX,
  fallbackLoadError: "Project type could not load.",
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.project-type.view",
  queryKeyFactory: projectTypeQueryKey,
  surfaceId: AI_STUDIO_SURFACE_ID
});

const projectConfigView = useView({
  access: "never",
  apiSuffix: AI_STUDIO_PROJECT_CONFIG_API_SUFFIX,
  fallbackLoadError: "Project config could not load.",
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.project-config.view",
  queryKeyFactory: projectConfigQueryKey,
  readEnabled: computed(() => projectTypeView.record?.projectType?.ready === true),
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

const saveProjectConfigCommand = useCommand({
  access: "never",
  apiSuffix: AI_STUDIO_PROJECT_CONFIG_API_SUFFIX,
  buildCommandOptions: () => ({
    method: "PUT",
    options: LOCAL_STUDIO_COMMAND_OPTIONS
  }),
  buildRawPayload: (_model, { context }) => ({
    values: context.values || {}
  }),
  fallbackRunError: "Project config could not be saved.",
  messages: {
    error: "Project config could not be saved.",
    success: "Project config saved."
  },
  onRunSuccess: async () => {
    await loadTargetProject();
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.project-config.save",
  surfaceId: AI_STUDIO_SURFACE_ID,
  writeMethod: "PUT"
});

const targetProject = computed(() => {
  if (!targetProjectView.record) {
    return null;
  }
  return {
    ...targetProjectView.record,
    projectConfig: projectConfigView.record?.config || {},
    projectType: projectTypeView.record?.projectType || {}
  };
});
const projectType = computed(() => targetProject.value?.projectType || {});
const projectConfig = computed(() => targetProject.value?.projectConfig || {});
const projectConfigLoaded = computed(() => Boolean(projectConfigView.record?.config));
const needsProjectType = computed(() => targetProject.value && projectType.value?.ready !== true);
const needsProjectConfig = computed(() => {
  return targetProject.value &&
    projectType.value?.ready === true &&
    projectConfig.value?.ready !== true;
});
const loading = computed(() => Boolean(
  targetProjectView.isLoading ||
  projectTypeView.isLoading ||
  projectConfigView.isLoading
));
const waitingForProjectConfig = computed(() => {
  return targetProject.value &&
    projectType.value?.ready === true &&
    !projectConfigLoaded.value &&
    projectConfigView.isLoading;
});
const showLoadingBar = computed(() => {
  return loading.value && (!targetProject.value || waitingForProjectConfig.value);
});
const saveError = computed(() => {
  if (saveProjectTypeCommand.messageType === "error") {
    return String(saveProjectTypeCommand.message || "");
  }
  if (saveProjectConfigCommand.messageType === "error") {
    return String(saveProjectConfigCommand.message || "");
  }
  return "";
});
const errorMessage = computed(() => String(
  targetProjectView.loadError ||
  projectTypeView.loadError ||
  projectConfigView.loadError ||
  saveError.value ||
  ""
));

async function loadTargetProject() {
  await Promise.all([
    targetProjectView.refresh(),
    projectTypeView.refresh()
  ]);
  if (projectTypeView.record?.projectType?.ready === true) {
    await projectConfigView.refresh();
  }
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

async function saveProjectConfig(values) {
  savingConfig.value = true;
  try {
    await saveProjectConfigCommand.run({
      values: values || {}
    });
  } finally {
    savingConfig.value = false;
  }
}

watch(targetProject, (project) => {
  if (!project) {
    return;
  }
  if (project.projectType?.ready === true && project.projectConfig?.ready === true) {
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
