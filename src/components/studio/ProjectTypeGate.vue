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
      v-else-if="projectReady"
      :target-project="projectState"
      :reload="loadProjectState"
      :save-project-config="saveProjectConfig"
      :saving-config="savingConfig"
    />
  </div>
</template>

<script>
let cachedProjectTypeRecord = null;
let cachedProjectConfigRecord = null;
</script>

<script setup>
import { computed, proxyRefs, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import ProjectConfigSetup from "@/components/studio/ProjectConfigSetup.vue";
import ProjectTypeSetup from "@/components/studio/ProjectTypeSetup.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  VIBE64_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS
} from "@/lib/vibe64RequestConfig.js";
import {
  VIBE64_PROJECT_CONFIG_API_SUFFIX,
  VIBE64_PROJECT_TYPE_API_SUFFIX,
  PROJECT_CONFIG_ENDPOINT,
  PROJECT_TYPE_ENDPOINT,
  projectConfigQueryKey,
  projectTypeQueryKey
} from "@/lib/studioGateApi.js";
import {
  studioHttpClient
} from "@/lib/studioHttp.js";

const emit = defineEmits(["ready", "missing", "error"]);
const props = defineProps({
  configureProject: {
    default: false,
    type: Boolean
  }
});

const savingConfig = ref(false);
const savingType = ref("");

function projectQueryKey(queryKeyFactory) {
  return computed(() => queryKeyFactory(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC));
}

function useStudioEndpointView({
  enabled = true,
  fallbackLoadError = "Request failed.",
  path,
  queryKeyFactory
}) {
  const resource = useEndpointResource({
    client: studioHttpClient,
    enabled,
    fallbackLoadError,
    path,
    queryKey: projectQueryKey(queryKeyFactory),
    refreshOnPull: true
  });

  return proxyRefs({
    isLoading: resource.isLoading,
    loadError: resource.loadError,
    record: resource.data,
    refresh: resource.reload,
    resource
  });
}

const projectTypeView = useStudioEndpointView({
  fallbackLoadError: "Project type could not load.",
  path: PROJECT_TYPE_ENDPOINT,
  queryKeyFactory: projectTypeQueryKey
});
const projectTypeRecord = computed(() => projectTypeView.record || cachedProjectTypeRecord || {});
const projectType = computed(() => projectTypeRecord.value?.projectType || {});

const projectConfigView = useStudioEndpointView({
  enabled: computed(() => projectType.value.ready === true),
  fallbackLoadError: "Project config could not load.",
  path: PROJECT_CONFIG_ENDPOINT,
  queryKeyFactory: projectConfigQueryKey
});

const saveProjectTypeCommand = useCommand({
  access: "never",
  apiSuffix: VIBE64_PROJECT_TYPE_API_SUFFIX,
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
  onRunSuccess: loadProjectState,
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.project-type.save",
  surfaceId: VIBE64_SURFACE_ID,
  writeMethod: "PUT"
});

const saveProjectConfigCommand = useCommand({
  access: "never",
  apiSuffix: VIBE64_PROJECT_CONFIG_API_SUFFIX,
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
  onRunSuccess: loadProjectState,
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.project-config.save",
  surfaceId: VIBE64_SURFACE_ID,
  writeMethod: "PUT"
});

const projectConfigRecord = computed(() => projectConfigView.record || cachedProjectConfigRecord || {});
const projectConfig = computed(() => projectConfigRecord.value?.config || {});
const projectTypeLoaded = computed(() => Boolean(projectTypeRecord.value?.projectType));
const projectConfigLoaded = computed(() => Boolean(projectConfigRecord.value?.config));
const projectReady = computed(() => projectType.value.ready === true && projectConfig.value.ready === true);
const projectState = computed(() => ({
  projectConfig: projectConfig.value,
  projectType: projectType.value
}));

const needsProjectType = computed(() => {
  return projectTypeLoaded.value && projectType.value.ready !== true;
});
const needsProjectConfig = computed(() => {
  return projectType.value.ready === true &&
    projectConfigLoaded.value &&
    (props.configureProject || projectConfig.value.ready !== true);
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
  projectTypeView.loadError ||
  projectConfigView.loadError ||
  saveError.value ||
  ""
));

async function loadProjectState() {
  await projectTypeView.refresh();
  if (projectType.value.ready === true) {
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

watch(projectTypeRecord, (record) => {
  if (record?.projectType) {
    cachedProjectTypeRecord = record;
  }
}, {
  immediate: true
});

watch(projectConfigRecord, (record) => {
  if (record?.config) {
    cachedProjectConfigRecord = record;
  }
}, {
  immediate: true
});

watch([projectState, () => props.configureProject], ([project, configureProject]) => {
  if (!projectTypeLoaded.value) {
    return;
  }
  if (projectReady.value && configureProject !== true) {
    emit("ready", project);
    return;
  }
  emit("missing", project);
}, {
  immediate: true
});

watch(() => projectType.value.ready, (ready) => {
  if (ready === true && !projectConfigLoaded.value) {
    void projectConfigView.refresh();
  }
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
