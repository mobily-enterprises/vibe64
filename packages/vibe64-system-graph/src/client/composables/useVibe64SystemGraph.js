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
import { useVibe64ProjectSlug } from "/src/composables/useVibe64ProjectScope.js";

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
  sessionId = ""
} = {}) {
  const paths = usePaths();
  const projectSlug = useVibe64ProjectSlug();
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
    queryKey: computed(() => systemQueryKey(projectSlug.value, normalizedSessionId.value, "status")),
    queryOptions: { refetchOnWindowFocus: false, retry: false },
    requestRecoveryLabel: "Architecture index status"
  });
  const systemStatus = computed(() => statusResource.data.value || {});
  const architectureEnabled = computed(() => enabled.value && cityAvailable(systemStatus.value, "machine"));
  const architectureResource = useEndpointResource({
    enabled: architectureEnabled,
    fallbackLoadError: "Architecture could not be loaded.",
    path: computed(() => `${sessionPath.value}/architecture`),
    queryKey: computed(() => systemQueryKey(projectSlug.value, normalizedSessionId.value, "architecture")),
    queryOptions: { refetchOnWindowFocus: false, retry: false },
    requestRecoveryLabel: "Architecture"
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

  const refreshStatusResource = useEndpointResource({
    enabled,
    path: computed(() => `${sessionPath.value}/refresh/status`),
    queryKey: computed(() => systemQueryKey(projectSlug.value, normalizedSessionId.value, "refresh-status")),
    queryOptions: { refetchOnMount: "always", refetchOnWindowFocus: false, retry: false },
    realtime: {
      event: "vibe64.session.changed",
      matches: ({ payload = {} } = {}) => payload.projectSlug === projectSlug.value &&
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

  const loading = computed(() => Boolean(
    architectureResource.isLoading.value ||
    statusResource.isLoading.value
  ));
  const error = computed(() => (
    cancelResource.saveError.value ||
    (scan.value?.status === "failed" ? scan.value.message : "") ||
    (scan.value?.status !== "running" ? refreshResource.saveError.value : "") ||
    architectureResource.loadError.value ||
    statusResource.loadError.value ||
    ""
  ));

  async function reload() {
    if (!enabled.value) return;
    await Promise.all([refreshStatusResource.reload(), statusResource.reload()]);
    if (architectureEnabled.value) await architectureResource.reload();
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
    systemStatus
  };
}

export {
  SYSTEM_GRAPH_API_SUFFIX,
  cityAvailable,
  systemSessionPath,
  useVibe64SystemGraph
};
