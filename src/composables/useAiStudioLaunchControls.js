import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  aiStudioLaunchTargetOpenPath,
  aiStudioLaunchTargetsPath,
  aiStudioLaunchTargetsQueryKey
} from "@/lib/aiStudioSessionRequestConfig.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function browserCanOpenTarget(target = {}) {
  return String(target.kind || "url") === "url" && Boolean(String(target.href || "").trim());
}

function useAiStudioLaunchControls({
  busy = () => false,
  session = null
} = {}) {
  const paths = usePaths();
  const activeLaunchTarget = ref(null);
  const startKey = ref("");
  const terminalRunning = ref(false);
  const terminalVisible = ref(false);

  const selectedSession = computed(() => readRefOrGetterValue(session) || null);
  const sessionId = computed(() => String(selectedSession.value?.sessionId || ""));
  const sessionsApiPath = computed(() => paths.api(AI_STUDIO_SESSIONS_API_SUFFIX, {
    surface: AI_STUDIO_SURFACE_ID
  }));
  const launchTargetsPath = computed(() => {
    return sessionId.value ? aiStudioLaunchTargetsPath(sessionsApiPath.value, sessionId.value) : "";
  });

  const launchTargetsResource = useEndpointResource({
    enabled: computed(() => Boolean(sessionId.value)),
    fallbackLoadError: "Launch targets could not be loaded.",
    path: launchTargetsPath,
    queryKey: computed(() => aiStudioLaunchTargetsQueryKey(
      AI_STUDIO_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      sessionId.value
    )),
    refreshOnPull: true
  });

  const openTargetCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: aiStudioLaunchTargetOpenPath(sessionsApiPath.value, context.sessionId)
    }),
    fallbackRunError: "Launch target could not be opened.",
    messages: {
      error: "Launch target could not be opened."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.launch-target.open",
    suppressSuccessMessage: true,
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "POST"
  });

  const status = computed(() => launchTargetsResource.data.value || {});
  const launchTargets = computed(() => {
    return Array.isArray(status.value.launchTargets) ? status.value.launchTargets : [];
  });
  const openTarget = computed(() => status.value.openTarget || {
    available: false,
    disabledReason: "Run a launch target first.",
    href: "",
    kind: "url",
    label: "Open browser"
  });
  const visible = computed(() => Boolean(
    sessionId.value &&
      (launchTargets.value.length > 0 || openTarget.value.available || launchTargetsResource.loadError.value)
  ));
  const launchButtonsDisabled = computed(() => Boolean(readRefOrGetterValue(busy) || terminalRunning.value));
  const openDisabled = computed(() => {
    return Boolean(
      readRefOrGetterValue(busy) ||
      openTargetCommand.isRunning ||
      !openTarget.value.available ||
      !browserCanOpenTarget(openTarget.value)
    );
  });
  const openTitle = computed(() => {
    if (readRefOrGetterValue(busy)) {
      return "Wait for the current Studio action to finish.";
    }
    if (!browserCanOpenTarget(openTarget.value)) {
      return openTarget.value.disabledReason || "Run a launch target first.";
    }
    return openTarget.value.href;
  });

  function run(launchTarget = {}) {
    if (!sessionId.value || launchButtonsDisabled.value || launchTarget.available === false || !launchTarget.id) {
      return;
    }
    activeLaunchTarget.value = launchTarget;
    terminalVisible.value = true;
    startKey.value = `${sessionId.value}:launch:${launchTarget.id}:${Date.now()}`;
  }

  async function open() {
    if (!sessionId.value || openDisabled.value) {
      return;
    }
    try {
      const response = await openTargetCommand.run({
        sessionId: sessionId.value
      });
      const target = response?.target || {};
      if (browserCanOpenTarget(target) && typeof window !== "undefined") {
        window.open(target.href, "_blank", "noopener");
      }
    } catch {
      // useCommand owns the user-visible error message.
    }
  }

  function closeTerminal() {
    activeLaunchTarget.value = null;
    startKey.value = "";
    terminalRunning.value = false;
    terminalVisible.value = false;
  }

  async function refresh() {
    if (!sessionId.value) {
      return null;
    }
    return launchTargetsResource.reload();
  }

  async function handleStarted() {
    await refresh().catch(() => null);
  }

  function handleRunningChanged(nextRunning) {
    terminalRunning.value = Boolean(nextRunning);
  }

  watch(sessionId, () => {
    closeTerminal();
  });

  return {
    activeLaunchTarget,
    closeTerminal,
    handleRunningChanged,
    handleStarted,
    launchButtonsDisabled,
    launchTargets,
    loading: launchTargetsResource.isLoading,
    loadError: launchTargetsResource.loadError,
    open,
    openDisabled,
    openTarget,
    openTargetCommand,
    openTitle,
    refresh,
    run,
    startKey,
    terminalRunning,
    terminalVisible,
    visible
  };
}

export {
  useAiStudioLaunchControls
};
