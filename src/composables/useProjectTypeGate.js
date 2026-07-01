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
  useStoredSelection
} from "@/composables/useStoredSelection.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  selectedSessionStorageKey,
  vibe64SessionsQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  visibleVibe64Sessions
} from "@/lib/vibe64SessionPanelModel.js";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";

const PROJECT_GATE_TRACE_OPTIONS = Object.freeze({
  env: {
    VIBE64_SESSION_DEBUG: "1"
  }
});
const cachedProjectTypeRecords = new Map();
const cachedProjectConfigRecords = new Map();

function projectGateTraceLog(event = "", details = {}) {
  return vibe64SessionDebugLog(event, details, PROJECT_GATE_TRACE_OPTIONS);
}

function plainDebugObject(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sortedDebugKeys(value = {}) {
  return Object.keys(plainDebugObject(value)).sort((left, right) => left.localeCompare(right));
}

function projectGateSessionSummary(session = {}) {
  return {
    currentStep: String(session?.currentStep || ""),
    sessionId: String(session?.sessionId || session?.id || ""),
    status: String(session?.status || ""),
    stepStatus: String(session?.stepMachine?.status || "")
  };
}

function useProjectTypeGate({
  configureProject = false,
  emit
} = {}) {
  const savingConfig = ref(false);
  const draftApplicationTypeId = ref("");
  const draftProjectTypeId = ref("");
  const projectSlug = useVibe64ProjectSlug();
  const paths = usePaths();
  const sessionSelection = useStoredSelection({
    storageKey: computed(() => selectedSessionStorageKey(projectSlug.value))
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
    buildRawPayload: (_model, { context }) => {
      const payload = {
        projectType: String(context.projectType || ""),
        sessionId: String(context.sessionId || ""),
        values: context.values || {}
      };
      projectGateTraceLog("client.projectConfigTrace.projectGate.saveProjectConfig.payload", projectGateTraceState({
        payloadProjectType: payload.projectType,
        payloadSessionId: payload.sessionId,
        valueKeyCount: sortedDebugKeys(payload.values).length,
        valueKeys: sortedDebugKeys(payload.values)
      }));
      return payload;
    },
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

  function projectGateTraceState(extra = {}) {
    return {
      configLoaded: projectConfigLoaded.value,
      configureProject: configureProjectValue.value === true,
      draftApplicationTypeId: String(draftApplicationTypeId.value || ""),
      draftConfigReadQuery: draftProjectConfigQuery.value || null,
      draftProjectTypeId: String(draftProjectTypeId.value || ""),
      errorMessage: String(errorMessage.value || ""),
      projectConfigCacheKey: projectConfigCacheKey.value,
      projectReady: projectReady.value,
      projectSlug: String(projectSlug.value || ""),
      projectTypeCacheKey: projectTypeCacheKey.value,
      projectTypeLoaded: projectTypeLoaded.value,
      readSessionQuery: sessionScopeReadQuery.value || null,
      selectedSessionId: String(selectedSessionId.value || ""),
      sessionCount: sessions.value.length,
      sessionIds: sessions.value.map((session) => String(session.sessionId || session.id || "")),
      sessions: sessions.value.map(projectGateSessionSummary),
      sessionScopeReady: sessionScopeReady.value,
      ...extra
    };
  }

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
      projectGateTraceLog("client.projectConfigTrace.projectGate.sessionSelection.waiting", projectGateTraceState({
        payloadLoaded: false
      }));
      return;
    }
    projectGateTraceLog("client.projectConfigTrace.projectGate.sessionSelection.before", projectGateTraceState({
      fallbackSessionId: state.sessions.at(-1)?.sessionId || "",
      payloadLoaded: true
    }));
    sessionSelection.selectAvailableId(state.sessions, {
      fallbackId: state.sessions.at(-1)?.sessionId || "",
      getId: (session) => session.sessionId
    });
    projectGateTraceLog("client.projectConfigTrace.projectGate.sessionSelection.after", projectGateTraceState({
      fallbackSessionId: state.sessions.at(-1)?.sessionId || "",
      payloadLoaded: true
    }));
  }, {
    immediate: true
  });

  watch(() => ({
    configEnabled: readRefOrGetterValue(projectConfigView.resource.enabled),
    configReadQuery: draftProjectConfigQuery.value,
    projectTypeEnabled: readRefOrGetterValue(projectTypeView.resource.enabled),
    projectTypeReadQuery: sessionScopeReadQuery.value,
    selectedSessionId: String(selectedSessionId.value || ""),
    sessionScopeReady: sessionScopeReady.value
  }), (state) => {
    projectGateTraceLog("client.projectConfigTrace.projectGate.readScope.changed", projectGateTraceState({
      configEnabled: Boolean(state.configEnabled),
      configReadQuery: state.configReadQuery || null,
      projectTypeEnabled: Boolean(state.projectTypeEnabled),
      projectTypeReadQuery: state.projectTypeReadQuery || null
    }));
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
    projectGateTraceLog("client.projectConfigTrace.projectGate.loadProjectState.start", projectGateTraceState());
    try {
      await projectTypeView.refresh();
      if (projectType.value.ready === true) {
        await projectConfigView.refresh();
      }
      projectGateTraceLog("client.projectConfigTrace.projectGate.loadProjectState.done", projectGateTraceState());
    } catch (error) {
      projectGateTraceLog("client.projectConfigTrace.projectGate.loadProjectState.error", projectGateTraceState({
        error: vibe64SessionDebugError(error)
      }));
      throw error;
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
    const resolvedSessionId = explicitSessionId || selectedSessionId.value;
    projectGateTraceLog("client.projectConfigTrace.projectGate.saveProjectConfig.start", projectGateTraceState({
      explicitSessionId,
      resolvedSessionId,
      optionKeys: sortedDebugKeys(options),
      valueKeyCount: sortedDebugKeys(values).length,
      valueKeys: sortedDebugKeys(values)
    }));
    savingConfig.value = true;
    try {
      await saveProjectConfigCommand.run({
        projectType: draftProjectTypeId.value,
        sessionId: resolvedSessionId,
        values: values || {}
      });
      draftApplicationTypeId.value = "";
      draftProjectTypeId.value = "";
      projectGateTraceLog("client.projectConfigTrace.projectGate.saveProjectConfig.done", projectGateTraceState({
        explicitSessionId,
        resolvedSessionId,
        valueKeyCount: sortedDebugKeys(values).length,
        valueKeys: sortedDebugKeys(values)
      }));
    } catch (error) {
      projectGateTraceLog("client.projectConfigTrace.projectGate.saveProjectConfig.error", projectGateTraceState({
        error: vibe64SessionDebugError(error),
        explicitSessionId,
        resolvedSessionId,
        valueKeyCount: sortedDebugKeys(values).length,
        valueKeys: sortedDebugKeys(values)
      }));
      throw error;
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

  function endpointTraceState(extra = {}) {
    return {
      enabled: Boolean(readRefOrGetterValue(enabled)),
      path: String(path || ""),
      projectSlug: String(projectSlug.value || ""),
      readQuery: readRefOrGetterValue(readQuery) || null,
      requestRecoveryLabel,
      ...extra
    };
  }

  watch(() => ({
    enabled: Boolean(readRefOrGetterValue(enabled)),
    projectSlug: String(projectSlug.value || ""),
    readQuery: readRefOrGetterValue(readQuery) || null
  }), (state) => {
    projectGateTraceLog("client.projectConfigTrace.projectGate.endpoint.scope", endpointTraceState(state));
  }, {
    immediate: true
  });

  async function refreshResource() {
    projectGateTraceLog("client.projectConfigTrace.projectGate.endpoint.refresh.start", endpointTraceState());
    try {
      const response = await resource.reload();
      projectGateTraceLog("client.projectConfigTrace.projectGate.endpoint.refresh.done", endpointTraceState({
        hasResponse: Boolean(response)
      }));
      return response;
    } catch (error) {
      projectGateTraceLog("client.projectConfigTrace.projectGate.endpoint.refresh.error", endpointTraceState({
        error: vibe64SessionDebugError(error)
      }));
      throw error;
    }
  }

  return proxyRefs({
    isLoading: resource.isLoading,
    loadError: resource.loadError,
    record: resource.data,
    refresh: refreshResource,
    resource
  });
}

export {
  useProjectTypeGate
};
