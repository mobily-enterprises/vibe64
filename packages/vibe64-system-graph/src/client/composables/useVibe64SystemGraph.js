import {
  computed,
  unref
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
  sessionId = ""
} = {}) {
  const paths = usePaths();
  const normalizedSessionId = computed(() => String(unref(sessionId) || "").trim());
  const enabled = computed(() => Boolean(unref(active) && normalizedSessionId.value));
  const apiPath = computed(() => paths.api(SYSTEM_GRAPH_API_SUFFIX, {
    surface: SYSTEM_GRAPH_SURFACE
  }));
  const sessionPath = computed(() => systemSessionPath(apiPath.value, normalizedSessionId.value));

  const statusResource = useEndpointResource({
    enabled,
    fallbackLoadError: "Genesis City status could not be loaded.",
    path: computed(() => enabled.value ? `${sessionPath.value}/status` : ""),
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "status")),
    requestRecoveryLabel: "Genesis City status"
  });
  const systemStatus = computed(() => statusResource.data.value || {});
  const machineEnabled = computed(() => enabled.value && cityAvailable(systemStatus.value, "machine"));
  const programEnabled = computed(() => enabled.value && cityAvailable(systemStatus.value, "program"));

  const machineResource = useEndpointResource({
    enabled: machineEnabled,
    fallbackLoadError: "Machine City could not be loaded.",
    path: computed(() => machineEnabled.value ? `${sessionPath.value}/cities/machine` : ""),
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "machine-city")),
    requestRecoveryLabel: "Machine City"
  });
  const programResource = useEndpointResource({
    enabled: programEnabled,
    fallbackLoadError: "Program City could not be loaded.",
    path: computed(() => programEnabled.value ? `${sessionPath.value}/cities/program` : ""),
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "program-city")),
    requestRecoveryLabel: "Program City"
  });
  const refreshResource = useEndpointResource({
    enabled: false,
    fallbackSaveError: "Genesis Cities could not be refreshed.",
    path: computed(() => enabled.value ? `${sessionPath.value}/refresh` : ""),
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "refresh")),
    requestRecoveryLabel: "Refresh Genesis Cities",
    writeMethod: "POST"
  });

  const subsystemResource = useEndpointResource({
    enabled,
    fallbackLoadError: "Subsystems could not be loaded.",
    path: computed(() => enabled.value ? `${sessionPath.value}/subsystems` : ""),
    queryKey: computed(() => systemQueryKey(normalizedSessionId.value, "subsystems")),
    requestRecoveryLabel: "Subsystems"
  });

  const machineCity = computed(() => machineResource.data.value?.city || null);
  const programCity = computed(() => programResource.data.value?.city || null);
  const loading = computed(() => Boolean(
    statusResource.isLoading.value ||
    machineResource.isLoading.value ||
    programResource.isLoading.value
  ));
  const error = computed(() => (
    refreshResource.saveError.value ||
    statusResource.loadError.value ||
    machineResource.loadError.value ||
    programResource.loadError.value ||
    ""
  ));

  async function reload() {
    if (!enabled.value) return;
    await Promise.all([statusResource.reload(), subsystemResource.reload()]);
    const cityLoads = [];
    if (machineEnabled.value) {
      cityLoads.push(machineResource.reload());
    }
    if (programEnabled.value) {
      cityLoads.push(programResource.reload());
    }
    await Promise.all(cityLoads);
  }

  async function refresh() {
    const result = await refreshResource.save({}, { method: "POST" });
    await reload();
    return result;
  }

  return {
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
