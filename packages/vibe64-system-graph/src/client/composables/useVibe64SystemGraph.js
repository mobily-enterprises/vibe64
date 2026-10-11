import {
  computed,
  unref,
  watch
} from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";

const SYSTEM_GRAPH_API_SUFFIX = "/vibe64/system-graph";
const SYSTEM_GRAPH_SURFACE = "app";

function encodeSegment(value = "") {
  return encodeURIComponent(String(value || "").trim());
}

function systemSessionPath(apiPath = "", sessionId = "", suffix = "") {
  return `${apiPath}/sessions/${encodeSegment(sessionId)}${suffix}`;
}

function systemQueryKey(sessionId = "", resource = "") {
  return ["vibe64", "system-graph", String(sessionId || ""), resource];
}

function cityAvailable(status = {}, kind = "") {
  return status?.cities?.[kind]?.available === true;
}

function useVibe64SystemGraph({
  active = true,
  reloadVersion = 0,
  sessionId = "",
  projection = "native"
} = {}) {
  const paths = usePaths();
  const normalizedSessionId = computed(() => String(unref(sessionId) || "").trim());
  const enabled = computed(() => Boolean(unref(active) && normalizedSessionId.value));
  const apiPath = computed(() => paths.api(SYSTEM_GRAPH_API_SUFFIX, {
    surface: SYSTEM_GRAPH_SURFACE
  }));
  const sessionPath = computed(() => systemSessionPath(apiPath.value, normalizedSessionId.value));

  // Retained readers share query keys. Their endpoints must stay identical;
  // enabled suspends loading without replacing the shared fetcher's path.
  const statusResource = useEndpointResource({
    enabled,
    fallbackLoadError: "Architecture index status could not be loaded.",
    path: computed(() => `${sessionPath.value}/status`),
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "status")),
    requestRecoveryLabel: "Architecture index status"
  });
  const systemStatus = computed(() => statusResource.data.value || {});
  const machineEnabled = computed(() => enabled.value && projection === "native" && cityAvailable(systemStatus.value, "machine"));
  const programEnabled = computed(() => enabled.value && projection === "native" && cityAvailable(systemStatus.value, "program"));

  const machineResource = useEndpointResource({
    enabled: machineEnabled,
    fallbackLoadError: "Source facts could not be loaded.",
    path: computed(() => `${sessionPath.value}/cities/machine`),
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "machine-city")),
    requestRecoveryLabel: "Source facts"
  });
  const architectureEnabled = computed(() => enabled.value && projection === "architecture" && cityAvailable(systemStatus.value, "machine"));
  const architectureResource = useEndpointResource({ enabled: architectureEnabled, path: computed(() => `${sessionPath.value}/architecture`), queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "architecture")), fallbackLoadError: "Architecture could not be loaded.", requestRecoveryLabel: "Architecture" });
  const programResource = useEndpointResource({
    enabled: programEnabled,
    fallbackLoadError: "Program descriptions could not be loaded.",
    path: computed(() => `${sessionPath.value}/cities/program`),
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "program-city")),
    requestRecoveryLabel: "Program descriptions"
  });
  const refreshResource = useEndpointResource({
    enabled: false,
    fallbackSaveError: "Architecture analysis could not be refreshed.",
    path: computed(() => `${sessionPath.value}/refresh`),
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "refresh")),
    requestRecoveryLabel: "Refresh architecture analysis",
    writeMethod: "POST"
  });

  const cancelResource = useEndpointResource({ enabled: false, path: computed(() => `${sessionPath.value}/refresh/cancel`), queryKey: computed(() => systemQueryKey(normalizedSessionId.value, 'refresh-cancel')), writeMethod: 'POST', fallbackSaveError: 'Architecture cancellation could not be confirmed.' });

  const subsystemResource = useEndpointResource({
    enabled,
    fallbackLoadError: "Subsystems could not be loaded.",
    path: computed(() => `${sessionPath.value}/subsystems`),
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "subsystems")),
    requestRecoveryLabel: "Subsystems"
  });

  const machineCity = computed(() => machineResource.data.value?.city || null);
  const programCity = computed(() => programResource.data.value?.city || null);
  const loading = computed(() => Boolean(
    architectureResource.isLoading.value ||
    statusResource.isLoading.value ||
    machineResource.isLoading.value ||
    programResource.isLoading.value
  ));
  const error = computed(() => (
    cancelResource.saveError.value ||
    refreshResource.saveError.value ||
    architectureResource.loadError.value ||
    statusResource.loadError.value ||
    machineResource.loadError.value ||
    programResource.loadError.value ||
    ""
  ));

  async function reload() {
    if (!enabled.value) return;
    await Promise.all([statusResource.reload(), subsystemResource.reload()]);
    const cityLoads = [];
    if (architectureEnabled.value) cityLoads.push(architectureResource.reload());
    if (machineEnabled.value) {
      cityLoads.push(machineResource.reload());
    }
    if (programEnabled.value) {
      cityLoads.push(programResource.reload());
    }
    await Promise.all(cityLoads);
  }

  let lastReloadVersion = 0;
  watch([enabled, () => unref(reloadVersion)], ([isEnabled, version]) => {
    if (isEnabled && version !== lastReloadVersion) {
      lastReloadVersion = version;
      void reload();
    }
  }, { immediate: true });

  async function refresh() {
    const result = await refreshResource.save({}, { method: "POST", timeoutMs: 10 * 60 * 1000 });
    await reload();
    return result;
  }

  return {
    architecture: computed(() => architectureResource.data.value?.architecture || null),
    cancelRefresh: () => cancelResource.save({}, { method: "POST" }),
    error,
    loading,
    machineCity,
    programCity,
    refresh,
    refreshing: refreshResource.isSaving,
    reload,
    subsystemMap: computed(() => subsystemResource.data.value || null),
    subsystemError: subsystemResource.loadError,
    subsystemLoading: subsystemResource.isLoading,
    systemStatus
  };
}

export {
  SYSTEM_GRAPH_API_SUFFIX,
  cityAvailable,
  systemSessionPath,
  useVibe64SystemGraph
};
