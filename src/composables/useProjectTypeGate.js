import { computed, proxyRefs, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  PROJECT_CONFIG_ENDPOINT,
  PROJECT_TEMPLATES_ENDPOINT,
  PROJECT_TYPE_ENDPOINT,
  VIBE64_PROJECT_CONFIG_API_SUFFIX,
  VIBE64_PROJECT_CHANGED_EVENT,
  VIBE64_PROJECT_TEMPLATES_API_SUFFIX,
  projectConfigQueryKey,
  projectTemplatesQueryKey,
  projectTypeQueryKey
} from "@/lib/studioGateApi.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";

const cachedProjectTypeRecords = new Map();
const cachedProjectConfigRecords = new Map();

function useProjectTypeGate({
  configureProject = false,
  emit
} = {}) {
  const savingConfig = ref(false);
  const applyingTemplateId = ref("");
  const draftApplicationTypeId = ref("");
  const draftProjectTypeId = ref("");
  const projectSetupMode = ref("templates");
  const projectSlug = useVibe64ProjectSlug();
  const configureProjectValue = computed(() => readRefOrGetterValue(configureProject) === true);
  const projectTypeCacheKey = computed(() => [
    projectSlug.value || "unscoped",
    "project"
  ].join(":"));

  const projectTypeView = useStudioEndpointView({
    fallbackLoadError: "Project type could not load.",
    path: PROJECT_TYPE_ENDPOINT,
    projectSlug,
    requestRecoveryLabel: "Project type",
    queryKeyFactory: projectTypeQueryKeyForProject
  });
  const cachedProjectTypeRecord = computed(() => cachedProjectTypeRecords.get(projectTypeCacheKey.value) || null);
  const projectTypeRecord = computed(() => projectTypeView.record || cachedProjectTypeRecord.value || {});
  const projectType = computed(() => projectTypeRecord.value?.projectType || {});
  const projectTypeRequiresSelection = computed(() => (
    projectType.value.ready !== true && projectType.value.status === "missing"
  ));
  const projectTemplatesView = useStudioEndpointView({
    enabled: computed(() => Boolean(projectTypeRecord.value?.projectType) && projectTypeRequiresSelection.value),
    fallbackLoadError: "Ready-made project templates could not load.",
    path: PROJECT_TEMPLATES_ENDPOINT,
    projectSlug,
    requestRecoveryLabel: "Project templates",
    queryKeyFactory: projectTemplatesQueryKey
  });
  const projectTemplatesRecord = computed(() => projectTemplatesView.record || {});
  const projectTemplates = computed(() => (
    Array.isArray(projectTemplatesRecord.value?.templates) ? projectTemplatesRecord.value.templates : []
  ));
  const projectTemplateEligibility = computed(() => projectTemplatesRecord.value?.eligibility || {});
  const hasDraftProjectType = computed(() => Boolean(draftProjectTypeId.value));
  const draftProjectConfigQuery = computed(() => {
    const query = {};
    if (hasDraftProjectType.value) {
      query.projectType = draftProjectTypeId.value;
    }
    return Object.keys(query).length > 0 ? query : null;
  });

  const projectConfigView = useStudioEndpointView({
    enabled: computed(() => projectType.value.ready === true || hasDraftProjectType.value),
    fallbackLoadError: "Project config could not load.",
    path: PROJECT_CONFIG_ENDPOINT,
    projectSlug,
    queryKeyFactory: projectConfigQueryKeyWithDraft,
    readQuery: draftProjectConfigQuery,
    requestRecoveryLabel: "Project config"
  });

  const saveProjectConfigCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_PROJECT_CONFIG_API_SUFFIX,
    buildCommandOptions: () => ({
      method: "PUT",
      path: PROJECT_CONFIG_ENDPOINT
    }),
    buildRawPayload: (_model, { context }) => ({
      projectType: String(context.projectType || ""),
      sessionId: String(context.sessionId || ""),
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
  const applyProjectTemplateCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_PROJECT_TEMPLATES_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: `${PROJECT_TEMPLATES_ENDPOINT}/${encodeURIComponent(context.templateId || "")}/apply`
    }),
    buildRawPayload: () => ({}),
    fallbackRunError: "The project template could not be applied.",
    messages: {
      error: "The project template could not be applied."
    },
    onRunSuccess: loadProjectState,
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.project-templates.apply",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const projectConfigCacheKey = computed(() => {
    return `${projectSlug.value || "unscoped"}:project:${draftProjectTypeId.value || "saved"}`;
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
  const projectStateInitialLoading = computed(() => Boolean(
    (!projectTypeLoaded.value && projectTypeView.isInitialLoading) ||
    (
      projectType.value.ready === true &&
      !projectConfigLoaded.value &&
      projectConfigView.isInitialLoading
    )
  ));
  const projectReady = computed(() => projectType.value.ready === true && projectConfig.value.ready === true);
  const projectState = computed(() => ({
    projectConfig: projectConfig.value,
    projectType: projectType.value
  }));
  const needsProjectType = computed(() => {
    return projectTypeLoaded.value && projectTypeRequiresSelection.value && !hasDraftProjectType.value;
  });
  const needsProjectConfig = computed(() => {
    return (hasDraftProjectType.value || projectType.value.ready === true) &&
      projectConfigLoaded.value &&
      (hasDraftProjectType.value || configureProjectValue.value || projectConfig.value.ready !== true);
  });
  const projectTemplatesLoaded = computed(() => Array.isArray(projectTemplatesRecord.value?.templates));
  const projectTemplatesLoading = computed(() => Boolean(
    projectTemplatesView.isInitialLoading ||
    projectTemplatesView.isLoading ||
    (!projectTemplatesLoaded.value && !projectTemplatesView.loadError)
  ));
  const projectTemplatesEligible = computed(() => projectTemplateEligibility.value?.eligible === true);
  const projectTemplateChooserVisible = computed(() => {
    return needsProjectType.value &&
      projectSetupMode.value === "templates" &&
      (projectTemplatesLoading.value || projectTemplatesEligible.value);
  });
  const canReturnToProjectTemplates = computed(() => {
    return needsProjectType.value && projectTemplatesEligible.value;
  });
  const saveError = computed(() => {
    if (saveProjectConfigCommand.messageType === "error") {
      return String(saveProjectConfigCommand.message || "");
    }
    return "";
  });
  const applyTemplateError = computed(() => {
    if (applyProjectTemplateCommand.messageType === "error") {
      return String(applyProjectTemplateCommand.message || "");
    }
    return "";
  });
  const projectTypeStateError = computed(() => {
    if (!projectTypeLoaded.value || projectType.value.ready === true || projectTypeRequiresSelection.value) {
      return "";
    }
    return String(
      projectType.value.message ||
      projectType.value.errorCode ||
      "Committed project configuration could not be read."
    );
  });
  const errorMessage = computed(() => String(
    projectTypeView.loadError ||
    projectTypeStateError.value ||
    projectConfigView.loadError ||
    projectTemplatesView.loadError ||
    applyTemplateError.value ||
    saveError.value ||
    ""
  ));

  watch(() => projectTypeView.record, (record) => {
    if (record?.projectType) {
      cachedProjectTypeRecords.set(projectTypeCacheKey.value, record);
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

  watch([projectState, configureProjectValue], ([project, shouldConfigureProject]) => {
    if (!projectTypeLoaded.value) {
      return;
    }
    if (projectReady.value && shouldConfigureProject !== true) {
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

  watch(projectSlug, () => {
    projectSetupMode.value = "templates";
  });

  watch(errorMessage, (message) => {
    if (message) {
      emit("error", message);
    }
  });

  return {
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
    projectStateInitialLoading,
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
  };

  function projectConfigQueryKeyWithDraft(surfaceId, ownershipFilter, slug) {
    return [
      ...projectConfigQueryKey(surfaceId, ownershipFilter, slug),
      "project",
      "draft-project-type",
      draftProjectTypeId.value || ""
    ];
  }

  function projectTypeQueryKeyForProject(surfaceId, ownershipFilter, slug) {
    return [
      ...projectTypeQueryKey(surfaceId, ownershipFilter, slug),
      "project"
    ];
  }

  async function loadProjectState() {
    await projectTypeView.refresh();
    if (projectType.value.ready === true) {
      await projectConfigView.refresh();
    }
  }

  async function applyProjectTemplate(templateId = "") {
    const normalizedTemplateId = String(templateId || "").trim();
    if (!normalizedTemplateId || applyingTemplateId.value) {
      return;
    }
    applyingTemplateId.value = normalizedTemplateId;
    try {
      await applyProjectTemplateCommand.run({
        templateId: normalizedTemplateId
      });
    } finally {
      applyingTemplateId.value = "";
    }
  }

  function showAdvancedProjectSetup() {
    projectSetupMode.value = "advanced";
  }

  function showProjectTemplates() {
    if (projectTemplatesEligible.value) {
      projectSetupMode.value = "templates";
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

  async function saveProjectConfig(values, options = {}) {
    const explicitSessionId = String(options?.sessionId || "").trim();
    savingConfig.value = true;
    try {
      await saveProjectConfigCommand.run({
        projectType: draftProjectTypeId.value,
        sessionId: explicitSessionId,
        values: values || {}
      });
      draftApplicationTypeId.value = "";
      draftProjectTypeId.value = "";
    } finally {
      savingConfig.value = false;
    }
  }
}

function useStudioEndpointView({
  enabled = true,
  fallbackLoadError = "Request failed.",
  path,
  projectSlug,
  readQuery = null,
  requestRecoveryLabel = "Request",
  queryKeyFactory
}) {
  const resource = useEndpointResource({
    enabled,
    fallbackLoadError,
    path,
    queryKey: computed(() => queryKeyFactory(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, projectSlug.value)),
    readQuery,
    refreshOnPull: true,
    requestRecoveryLabel: requestRecoveryLabel,
    realtime: {
      event: VIBE64_PROJECT_CHANGED_EVENT
    }
  });

  return proxyRefs({
    isInitialLoading: resource.isInitialLoading,
    isLoading: resource.isLoading,
    loadError: resource.loadError,
    record: resource.data,
    refresh: resource.reload,
    resource
  });
}

export {
  useProjectTypeGate
};
