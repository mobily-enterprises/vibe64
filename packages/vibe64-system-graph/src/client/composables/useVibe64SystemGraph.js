import {
  computed,
  onScopeDispose,
  ref,
  unref,
  watch
} from "vue";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";

import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { lessonDashboardApiPath, useVibe64LessonDashboard } from "@/lib/vibe64LessonDashboard.js";

const SYSTEM_GRAPH_API_SUFFIX = "/vibe64/system-graph";
const SYSTEM_GRAPH_SURFACE = "app";

function encodeSegment(value = "") {
  return encodeURIComponent(String(value || "").trim());
}

function systemSessionPath(apiPath = "", sessionId = "", suffix = "") {
  return `${apiPath}/sessions/${encodeSegment(sessionId)}${suffix}`;
}

function systemQueryKey(projectSlug, sessionId = "", resource = "") {
  return ["vibe64", "system-graph", projectSlug, String(sessionId || ""), resource];
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
  const workingProjectSlug = useVibe64ProjectSlug();
  // A practice lesson's Architecture reads its own project through the saved attempt.
  const lessonDashboard = useVibe64LessonDashboard();
  const projectSlug = computed(() => lessonDashboard.value ? `lesson:${lessonDashboard.value.attemptId}` : workingProjectSlug.value);
  const normalizedSessionId = computed(() => String(unref(sessionId) || "").trim());
  const enabled = computed(() => Boolean(unref(active) && normalizedSessionId.value));
  const apiPath = computed(() => lessonDashboardApiPath(lessonDashboard.value, paths.api(SYSTEM_GRAPH_API_SUFFIX, {
    surface: SYSTEM_GRAPH_SURFACE
  })));
  const sessionPath = computed(() => systemSessionPath(apiPath.value, normalizedSessionId.value));

  // Retained readers share query keys. Their endpoints must stay identical;
  // enabled suspends loading without replacing the shared fetcher's path.
  const statusResource = useEndpointResource({
    enabled,
    fallbackLoadError: "Architecture index status could not be loaded.",
    path: computed(() => `${sessionPath.value}/status`),
    queryKey: computed(() => systemQueryKey(projectSlug.value, normalizedSessionId.value, "status")),
    queryOptions: { refetchOnWindowFocus: false, retry: false },
    requestRecoveryLabel: "Architecture index status"
  });
  const systemStatus = computed(() => statusResource.data.value || {});
  const machineEnabled = computed(() => enabled.value && projection === "native" && cityAvailable(systemStatus.value, "machine"));
  const programEnabled = computed(() => enabled.value && projection === "native" && cityAvailable(systemStatus.value, "program"));

  const machineResource = useEndpointResource({
    enabled: machineEnabled,
    fallbackLoadError: "Source facts could not be loaded.",
    path: computed(() => `${sessionPath.value}/cities/machine`),
    queryKey: computed(() => systemQueryKey(projectSlug.value, normalizedSessionId.value, "machine-city")),
    requestRecoveryLabel: "Source facts"
  });
  const architectureEnabled = computed(() => enabled.value && projection === "architecture" && cityAvailable(systemStatus.value, "machine"));
  const architectureResource = useEndpointResource({ enabled: architectureEnabled, path: computed(() => `${sessionPath.value}/architecture`), queryKey: computed(() => systemQueryKey(projectSlug.value, normalizedSessionId.value, "architecture")), queryOptions: { refetchOnWindowFocus: false, retry: false }, fallbackLoadError: "Architecture could not be loaded.", requestRecoveryLabel: "Architecture" });
  const programResource = useEndpointResource({
    enabled: programEnabled,
    fallbackLoadError: "Program descriptions could not be loaded.",
    path: computed(() => `${sessionPath.value}/cities/program`),
    queryKey: computed(() => systemQueryKey(projectSlug.value, normalizedSessionId.value, "program-city")),
    requestRecoveryLabel: "Program descriptions"
  });
  const refreshResource = useEndpointResource({
    enabled: false,
    fallbackSaveError: "Architecture analysis could not be refreshed.",
    path: computed(() => `${sessionPath.value}/refresh`),
    queryKey: computed(() => systemQueryKey(projectSlug.value, normalizedSessionId.value, "refresh")),
    requestRecoveryLabel: "Refresh architecture analysis",
    writeMethod: "POST"
  });

  const cancelResource = useEndpointResource({ enabled: false, path: computed(() => `${sessionPath.value}/refresh/cancel`), queryKey: computed(() => systemQueryKey(projectSlug.value, normalizedSessionId.value, 'refresh-cancel')), writeMethod: 'POST', fallbackSaveError: 'Architecture cancellation could not be confirmed.' });

  const subsystemResource = useEndpointResource({
    enabled: computed(() => enabled.value && projection === "native"),
    fallbackLoadError: "Subsystems could not be loaded.",
    path: computed(() => `${sessionPath.value}/subsystems`),
    queryKey: computed(() => systemQueryKey(projectSlug.value, normalizedSessionId.value, "subsystems")),
    requestRecoveryLabel: "Subsystems"
  });

  const refreshStatusResource = useEndpointResource({
    enabled,
    path: computed(() => `${sessionPath.value}/refresh/status`),
    queryKey: computed(() => systemQueryKey(projectSlug.value, normalizedSessionId.value, "refresh-status")),
    queryOptions: { refetchOnMount: "always", refetchOnWindowFocus: false, retry: false },
    realtime: {
      event: "vibe64.session.changed",
      matches: ({ payload = {} } = {}) => (lessonDashboard.value
        ? payload.learningAttemptId === lessonDashboard.value.attemptId
        : !payload.learningAttemptId && payload.projectSlug === projectSlug.value) &&
        payload.sessionId === normalizedSessionId.value && payload.reason === "architecture-refresh"
    },
    fallbackLoadError: "Analysis progress is unavailable."
  });
  const localRefreshOutput = ref("");
  const scan = computed(() => refreshStatusResource.data.value?.refresh || null);
  const refreshing = computed(() => scan.value?.status === "running" || refreshResource.isSaving.value);
  const clock = ref(Date.now());
  let timer;
  watch(() => enabled.value && refreshing.value, running => {
    clearInterval(timer);
    clock.value = Date.now();
    if (running) timer = setInterval(() => { clock.value = Date.now(); }, 1000);
  }, { immediate: true });
  onScopeDispose(() => clearInterval(timer));
  useRealtimeEvent({ enabled, event: "connect", onEvent: () => reload() });
  watch(() => `${scan.value?.id}:${scan.value?.startedAt}:${scan.value?.status}`, () => {
    const status = scan.value?.status;
    if (status === "running" && !refreshResource.isSaving.value) {
      refreshResource.mutation.reset();
      cancelResource.mutation.reset();
      localRefreshOutput.value = "";
    }
    if (enabled.value && status && status !== "running") void reload();
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
    (scan.value?.status === "failed" ? scan.value.message : "") ||
    (scan.value?.status !== "running" ? refreshResource.saveError.value : "") ||
    architectureResource.loadError.value ||
    statusResource.loadError.value ||
    machineResource.loadError.value ||
    programResource.loadError.value ||
    ""
  ));

  async function reload() {
    if (!enabled.value) return;
    await Promise.all([refreshStatusResource.reload(), statusResource.reload(), ...(projection === "native" ? [subsystemResource.reload()] : [])]);
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

  watch([enabled, sessionPath, projectSlug], ([isEnabled]) => {
    if (isEnabled) void refreshStatusResource.reload();
  }, { immediate: true });
  let lastReloadVersion = 0;
  watch([enabled, () => unref(reloadVersion)], ([isEnabled, version]) => {
    if (isEnabled && version !== lastReloadVersion) {
      lastReloadVersion = version;
      void reload();
    }
  }, { immediate: true });

  async function refresh() {
    if (refreshing.value) return null;
    localRefreshOutput.value = "";
    try {
      const result = await refreshResource.save({}, { method: "POST", options: { timeoutMs: 10 * 60 * 1000 } });
      await reload();
      return result;
    } catch (error) {
      localRefreshOutput.value = String(error?.details?.commandOutput || "");
      await refreshStatusResource.reload();
      // The retained view already presents this resource error. Do not also
      // throw it into the shell's blocking application-error dialog.
      if (!refreshResource.saveError.value) throw error;
      return null;
    }
  }

  return {
    architecture: computed(() => architectureResource.data.value?.architecture || null),
    cancelRefresh: () => cancelResource.save({}, { method: "POST" }),
    error,
    loading,
    machineCity,
    programCity,
    refresh,
    refreshing,
    refreshProgress: computed(() => {
      if (!refreshing.value) return null;
      const progress = scan.value;
      const elapsedSeconds = progress?.status === "running" ? Math.max(0, Math.floor((clock.value - progress.startedAt) / 1000)) : 0;
      return { message: refreshStatusResource.loadError.value ? "Analysis continues; progress unavailable." : progress?.status === "running" ? progress.message : "Starting project analysis…", elapsedSeconds };
    }),
    refreshOutput: computed(() => scan.value?.commandOutput || localRefreshOutput.value),
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
