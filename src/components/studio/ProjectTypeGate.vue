<template>
  <div class="project-type-gate">
    <StudioErrorNotice
      v-if="errorMessage"
      title="Setup could not load"
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

    <v-sheet
      v-else-if="needsSetup"
      rounded="lg"
      border
      class="project-type-gate__setup-needed"
    >
      <div>
        <h2 class="project-type-gate__setup-title">Setup needed</h2>
        <p class="project-type-gate__setup-message">
          {{ setupGate.message || "Finish setup before using project tools." }}
        </p>
      </div>
      <v-btn
        color="primary"
        variant="flat"
        :to="setupRoute"
      >
        Open setup
      </v-btn>
    </v-sheet>

    <slot
      v-else-if="targetProject"
      :target-project="targetProject"
      :reload="loadTargetProject"
    />
  </div>
</template>

<script setup>
import { computed, proxyRefs, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
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
  PROJECT_CONFIG_ENDPOINT,
  PROJECT_TYPE_ENDPOINT,
  TARGET_PROJECT_ENDPOINT,
  projectConfigQueryKey,
  projectTypeQueryKey,
  readAdapterSetupStatus,
  readProjectSetupStatus,
  readStudioSetupStatus,
  targetProjectQueryKey
} from "@/lib/studioGateApi.js";
import {
  studioHttpClient
} from "@/lib/studioHttp.js";

const emit = defineEmits(["ready", "missing", "error"]);
const props = defineProps({
  configureProject: {
    default: false,
    type: Boolean
  },
  requireSetup: {
    default: false,
    type: Boolean
  }
});

const savingConfig = ref(false);
const savingType = ref("");
const setupGate = ref({
  message: "",
  ready: false,
  tab: "studio-setup"
});
const setupLoading = ref(false);
const setupError = ref("");

const setupChecks = [
  {
    label: "Studio Setup",
    read: readStudioSetupStatus,
    tab: "studio-setup"
  },
  {
    label: "Adapter Setup",
    read: readAdapterSetupStatus,
    tab: "adapter-setup"
  },
  {
    label: "Project Setup",
    read: readProjectSetupStatus,
    tab: "project-setup"
  }
];

function projectQueryKey(queryKeyFactory) {
  return computed(() => queryKeyFactory(AI_STUDIO_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC));
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

const targetProjectView = useStudioEndpointView({
  fallbackLoadError: "Target project inspection failed.",
  path: TARGET_PROJECT_ENDPOINT,
  queryKeyFactory: targetProjectQueryKey
});

const projectTypeView = useStudioEndpointView({
  fallbackLoadError: "Project type could not load.",
  path: PROJECT_TYPE_ENDPOINT,
  queryKeyFactory: projectTypeQueryKey
});

const projectConfigView = useStudioEndpointView({
  enabled: computed(() => projectTypeView.record?.projectType?.ready === true),
  fallbackLoadError: "Project config could not load.",
  path: PROJECT_CONFIG_ENDPOINT,
  queryKeyFactory: projectConfigQueryKey
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
    (props.configureProject || projectConfig.value?.ready !== true);
});
const projectReady = computed(() => {
  return targetProject.value &&
    projectType.value?.ready === true &&
    projectConfig.value?.ready === true;
});
const setupSatisfied = computed(() => {
  return props.requireSetup !== true || setupGate.value.ready === true;
});
const needsSetup = computed(() => {
  return projectReady.value &&
    props.configureProject !== true &&
    props.requireSetup === true &&
    setupGate.value.ready !== true;
});
const loading = computed(() => Boolean(
  targetProjectView.isLoading ||
  projectTypeView.isLoading ||
  projectConfigView.isLoading ||
  setupLoading.value
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
  setupError.value ||
  saveError.value ||
  ""
));
const setupRoute = computed(() => ({
  path: "/setup",
  query: {
    tab: setupGate.value.tab || "studio-setup"
  }
}));

async function loadTargetProject() {
  await Promise.all([
    targetProjectView.refresh(),
    projectTypeView.refresh()
  ]);
  if (projectTypeView.record?.projectType?.ready === true) {
    await projectConfigView.refresh();
  }
}

async function loadSetupGate() {
  if (props.requireSetup !== true || !projectReady.value) {
    setupGate.value = {
      message: "",
      ready: props.requireSetup !== true,
      tab: "studio-setup"
    };
    return;
  }

  setupLoading.value = true;
  setupError.value = "";

  try {
    for (const check of setupChecks) {
      const status = await check.read();
      if (status?.ready !== true) {
        setupGate.value = {
          message: status?.blockedReason || `${check.label} is incomplete.`,
          ready: false,
          tab: check.tab
        };
        return;
      }
    }

    setupGate.value = {
      message: "",
      ready: true,
      tab: ""
    };
  } catch (error) {
    setupError.value = String(error?.message || error || "Setup readiness could not load.");
    setupGate.value = {
      message: "Setup readiness could not load.",
      ready: false,
      tab: "studio-setup"
    };
  } finally {
    setupLoading.value = false;
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

watch([projectReady, () => props.requireSetup], () => {
  void loadSetupGate();
}, {
  immediate: true
});

watch([targetProject, () => props.configureProject, setupSatisfied], ([project, configureProject]) => {
  if (!project) {
    return;
  }
  if (
    projectReady.value &&
    setupSatisfied.value &&
    configureProject !== true
  ) {
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

.project-type-gate__setup-needed {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  min-width: 0;
  padding: 1rem;
}

.project-type-gate__setup-title {
  font-size: 1.1rem;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.2;
  margin: 0 0 0.25rem;
}

.project-type-gate__setup-message {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.9rem;
  line-height: 1.35;
  margin: 0;
}

@media (max-width: 640px) {
  .project-type-gate__setup-needed {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
