import { computed, proxyRefs, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  PROJECT_CONFIG_ENDPOINT,
  PROJECT_TYPE_ENDPOINT,
  VIBE64_PROJECT_CONFIG_API_SUFFIX,
  VIBE64_PROJECT_CHANGED_EVENT,
  projectConfigQueryKey,
  projectTypeQueryKey
} from "@/lib/studioGateApi.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  useVibe64SessionSelection
} from "@/composables/useVibe64SessionSelection.js";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  vibe64SessionsQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  visibleVibe64Sessions
} from "@/lib/vibe64SessionPanelModel.js";

const cachedProjectTypeRecords = new Map();
const cachedProjectConfigRecords = new Map();

function useProjectTypeGate({
  configureProject = false,
  emit
} = {}) {
  const savingConfig = ref(false);
  const draftApplicationTypeId = ref("");
  const draftProjectTypeId = ref("");
  const projectSlug = useVibe64ProjectSlug();
  const paths = usePaths();
  const sessionSelection = useVibe64SessionSelection({
    projectSlug
  });
  const selectedSessionId = sessionSelection.selectedId;
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const sessionListResource = useEndpointResource({
    fallbackLoadError: "Vibe64 sessions could not be loaded.",
    path: sessionsApiPath,
    queryKey: computed(() => vibe64SessionsQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      projectSlug.value
    )),
    readQuery: {
      limit: 20
    },
    queryOptions: {
      refetchOnMount: false,
      refetchOnWindowFocus: false
    },
    requestRecoveryLabel: "Vibe64 sessions",
    realtime: {
      event: VIBE64_PROJECT_CHANGED_EVENT
    }
  });
  const configureProjectValue = computed(() => readRefOrGetterValue(configureProject) === true);
  const sessionListPayload = computed(() => {
    const payload = sessionListResource.data.value;
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  });
  const sessions = computed(() => visibleVibe64Sessions(
    Array.isArray(sessionListPayload.value?.sessions) ? sessionListPayload.value.sessions : []
  ));
  const sessionScopeReady = computed(() => Boolean(
    sessionListPayload.value &&
    (sessions.value.length < 1 || selectedSessionId.value)
  ));
  const sessionScopeReadQuery = computed(() => {
    const sessionId = String(selectedSessionId.value || "").trim();
    return sessionId ? { sessionId } : null;
  });
  const projectTypeCacheKey = computed(() => [
    projectSlug.value || "unscoped",
    selectedSessionId.value || "project"
  ].join(":"));

  const projectTypeView = useStudioEndpointView({
    enabled: sessionScopeReady,
    fallbackLoadError: "Project type could not load.",
    path: PROJECT_TYPE_ENDPOINT,
    projectSlug,
    readQuery: sessionScopeReadQuery,
    requestRecoveryLabel: "Project type",
    queryKeyFactory: projectTypeQueryKeyWithSession
  });
  const cachedProjectTypeRecord = computed(() => cachedProjectTypeRecords.get(projectTypeCacheKey.value) || null);
  const projectTypeRecord = computed(() => projectTypeView.record || cachedProjectTypeRecord.value || {});
  const projectType = computed(() => projectTypeRecord.value?.projectType || {});
  const hasDraftProjectType = computed(() => Boolean(draftProjectTypeId.value));
  const draftProjectConfigQuery = computed(() => {
    const query = {
      ...(sessionScopeReadQuery.value || {})
    };
    if (hasDraftProjectType.value) {
      query.projectType = draftProjectTypeId.value;
    }
    return Object.keys(query).length > 0 ? query : null;
  });

  const projectConfigView = useStudioEndpointView({
    enabled: computed(() => sessionScopeReady.value && (projectType.value.ready === true || hasDraftProjectType.value)),
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

  const projectConfigCacheKey = computed(() => {
    return `${projectSlug.value || "unscoped"}:${selectedSessionId.value || "project"}:${draftProjectTypeId.value || "saved"}`;
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
      (hasDraftProjectType.value || configureProjectValue.value || projectConfig.value.ready !== true);
  });
  const saveError = computed(() => {
    if (saveProjectConfigCommand.messageType === "error") {
      return String(saveProjectConfigCommand.message || "");
    }
    return "";
  });
  const errorMessage = computed(() => String(
    sessionListResource.loadError.value ||
    projectTypeView.loadError ||
    projectConfigView.loadError ||
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

  watch(() => ({
    payloadLoaded: Boolean(sessionListPayload.value),
    selectedSessionId: String(selectedSessionId.value || ""),
    sessions: sessions.value
  }), (state) => {
    if (!state.payloadLoaded) {
      return;
    }
    sessionSelection.selectAvailableId(state.sessions, {
      fallbackId: state.sessions.at(-1)?.sessionId || "",
      getId: (session) => session.sessionId
    });
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

  watch(errorMessage, (message) => {
    if (message) {
      emit("error", message);
    }
  });

  return {
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
  };

  function projectConfigQueryKeyWithDraft(surfaceId, ownershipFilter, slug) {
    return [
      ...projectConfigQueryKey(surfaceId, ownershipFilter, slug),
      "session",
      selectedSessionId.value || "project",
      "draft-project-type",
      draftProjectTypeId.value || ""
    ];
  }

  function projectTypeQueryKeyWithSession(surfaceId, ownershipFilter, slug) {
    return [
      ...projectTypeQueryKey(surfaceId, ownershipFilter, slug),
      "session",
      selectedSessionId.value || "project"
    ];
  }

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

  async function saveProjectConfig(values, options = {}) {
    const explicitSessionId = String(options?.sessionId || "").trim();
    savingConfig.value = true;
    try {
      await saveProjectConfigCommand.run({
        projectType: draftProjectTypeId.value,
        sessionId: explicitSessionId || selectedSessionId.value,
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
