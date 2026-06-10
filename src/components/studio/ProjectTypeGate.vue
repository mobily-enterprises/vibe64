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

<script>
const cachedProjectTypeRecords = new Map();
const cachedProjectConfigRecords = new Map();
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
  PROJECT_CONFIG_ENDPOINT,
  PROJECT_TYPE_ENDPOINT,
  projectConfigQueryKey,
  projectTypeQueryKey
} from "@/lib/studioGateApi.js";
import {
  scopedDevelopmentApiUrl,
  studioHttpClient
} from "@/lib/studioHttp.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";

const emit = defineEmits(["ready", "missing", "error"]);
const props = defineProps({
  configureProject: {
    default: false,
    type: Boolean
  }
});

const savingConfig = ref(false);
const draftApplicationTypeId = ref("");
const draftProjectTypeId = ref("");
const projectSlug = useVibe64ProjectSlug();

function projectQueryKey(queryKeyFactory) {
  return computed(() => queryKeyFactory(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, projectSlug.value));
}

function useStudioEndpointView({
  enabled = true,
  fallbackLoadError = "Request failed.",
  path,
  readQuery = null,
  queryKeyFactory
}) {
  const resource = useEndpointResource({
    client: studioHttpClient,
    enabled,
    fallbackLoadError,
    path,
    queryKey: projectQueryKey(queryKeyFactory),
    readQuery,
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
const cachedProjectTypeRecord = computed(() => cachedProjectTypeRecords.get(projectSlug.value) || null);
const projectTypeRecord = computed(() => projectTypeView.record || cachedProjectTypeRecord.value || {});
const projectType = computed(() => projectTypeRecord.value?.projectType || {});
const hasDraftProjectType = computed(() => Boolean(draftProjectTypeId.value));

function projectConfigQueryKeyWithDraft(surfaceId, ownershipFilter, slug) {
  return [
    ...projectConfigQueryKey(surfaceId, ownershipFilter, slug),
    "draft-project-type",
    draftProjectTypeId.value || ""
  ];
}

const draftProjectConfigQuery = computed(() => {
  return hasDraftProjectType.value
    ? {
        projectType: draftProjectTypeId.value
      }
    : null;
});

const projectConfigView = useStudioEndpointView({
  enabled: computed(() => projectType.value.ready === true || hasDraftProjectType.value),
  fallbackLoadError: "Project config could not load.",
  path: PROJECT_CONFIG_ENDPOINT,
  queryKeyFactory: projectConfigQueryKeyWithDraft,
  readQuery: draftProjectConfigQuery
});

const saveProjectConfigCommand = useCommand({
  access: "never",
  apiSuffix: VIBE64_PROJECT_CONFIG_API_SUFFIX,
  buildCommandOptions: () => ({
    method: "PUT",
    options: LOCAL_STUDIO_COMMAND_OPTIONS,
    path: scopedDevelopmentApiUrl(PROJECT_CONFIG_ENDPOINT)
  }),
  buildRawPayload: (_model, { context }) => ({
    projectType: String(context.projectType || ""),
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

const projectConfigCacheKey = computed(() => {
  return `${projectSlug.value || "unscoped"}:${draftProjectTypeId.value || "saved"}`;
});
const cachedProjectConfigRecord = computed(() => cachedProjectConfigRecords.get(projectConfigCacheKey.value) || null);
const projectConfigRecord = computed(() => projectConfigView.record || cachedProjectConfigRecord.value || {});
const projectConfig = computed(() => projectConfigRecord.value?.config || {});
const draftProjectType = computed(() => findProjectType(draftProjectTypeId.value));
const savedProjectType = computed(() => findProjectType(projectType.value?.projectType));
const draftApplicationType = computed(() => findApplicationType(draftApplicationTypeId.value));
const currentProjectTypeLabel = computed(() => {
  return draftProjectType.value?.label ||
    savedProjectType.value?.label ||
    projectType.value?.adapter?.label ||
    "";
});
const currentApplicationTypeLabel = computed(() => {
  return draftApplicationType.value?.label ||
    draftProjectType.value?.applicationTypes?.[0]?.label ||
    "";
});
const projectConfigSetupSummary = computed(() => {
  const labels = [
    currentApplicationTypeLabel.value,
    currentProjectTypeLabel.value
  ].filter(Boolean);
  return labels.join(" / ");
});
const projectTypeLoaded = computed(() => Boolean(projectTypeRecord.value?.projectType));
const projectConfigLoaded = computed(() => Boolean(projectConfigRecord.value?.config));
const projectReady = computed(() => projectType.value.ready === true && projectConfig.value.ready === true);
const projectState = computed(() => ({
  projectConfig: projectConfig.value,
  projectType: projectType.value
}));

const needsProjectType = computed(() => {
  return projectTypeLoaded.value && projectType.value.ready !== true && !hasDraftProjectType.value;
});
const needsProjectConfig = computed(() => {
  return (hasDraftProjectType.value || projectType.value.ready === true) &&
    projectConfigLoaded.value &&
    (hasDraftProjectType.value || props.configureProject || projectConfig.value.ready !== true);
});
const saveError = computed(() => {
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

function findProjectType(projectTypeId = "") {
  const normalizedProjectTypeId = String(projectTypeId || "");
  if (!normalizedProjectTypeId) {
    return null;
  }
  return (Array.isArray(projectType.value?.availableProjectTypes) ? projectType.value.availableProjectTypes : [])
    .find((availableProjectType) => String(availableProjectType.id || "") === normalizedProjectTypeId) || null;
}

function findApplicationType(applicationTypeId = "") {
  const normalizedApplicationTypeId = String(applicationTypeId || "");
  if (!normalizedApplicationTypeId) {
    return null;
  }
  return (Array.isArray(projectType.value?.availableApplicationTypes) ? projectType.value.availableApplicationTypes : [])
    .find((availableApplicationType) => String(availableApplicationType.id || "") === normalizedApplicationTypeId) || null;
}

function selectDraftProjectType(selection) {
  if (selection && typeof selection === "object" && !Array.isArray(selection)) {
    draftApplicationTypeId.value = String(selection.applicationTypeId || "");
    draftProjectTypeId.value = String(selection.projectType || "");
    return;
  }
  draftApplicationTypeId.value = "";
  draftProjectTypeId.value = String(selection || "");
}

function clearDraftProjectType() {
  draftApplicationTypeId.value = "";
  draftProjectTypeId.value = "";
}

async function saveProjectConfig(values) {
  savingConfig.value = true;
  try {
    await saveProjectConfigCommand.run({
      projectType: draftProjectTypeId.value,
      values: values || {}
    });
    draftApplicationTypeId.value = "";
    draftProjectTypeId.value = "";
  } finally {
    savingConfig.value = false;
  }
}

watch(() => projectTypeView.record, (record) => {
  if (record?.projectType) {
    cachedProjectTypeRecords.set(projectSlug.value, record);
  }
}, {
  immediate: true
});

watch(() => projectConfigView.record, (record) => {
  if (record?.config) {
    cachedProjectConfigRecords.set(projectConfigCacheKey.value, record);
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
