import { computed, ref, watch } from "vue";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64OutputResultPath,
  vibe64OutputsPath,
  vibe64OutputsQueryKey,
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64SessionRevision } from "@/lib/vibe64SessionViewModel.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";
import {
  launchControlScopeKey,
  launchControlsCanLoadTargets,
  launchStatusErrorText,
  launchStatusRetryDelay,
  launchStatusShouldRetry,
  outputTargetsRealtimeShouldRefresh
} from "@/lib/vibe64LaunchStatus.js";
import { launchPreviewFromStatus } from "@/lib/vibe64LaunchPreview.js";

/**
 * The selected session's outputs status: whether it can be loaded, the loaded
 * targets, runs, results and Preview, and its refreshes. It refetches when the
 * session changes elsewhere or its source operations resume.
 * `localLaunchStarting()` says whether this tab is starting an output itself,
 * so the tab's own start notice does not refetch.
 * @param {{
 *   localLaunchStarting: () => boolean,
 *   projectSlug: import("vue").Ref<string>,
 *   session: unknown,
 *   sourceOperationsSuspended: unknown,
 *   windowDisplayed: unknown
 * }} options
 */
function useVibe64OutputStatus({
  localLaunchStarting,
  projectSlug,
  session,
  sourceOperationsSuspended,
  windowDisplayed
}) {
  const paths = usePaths();
  const launchStatusAttempt = ref(0);
  const sourceOperationsResumePending = ref(false);
  let launchStatusAttemptLoading = false;
  let launchStatusAttemptScopeKey = "";

  const selectedSession = computed(() => readRefOrGetterValue(session) || null);
  const sessionId = computed(() => String(selectedSession.value?.sessionId || ""));
  const sessionRevision = computed(() => vibe64SessionRevision(selectedSession.value));
  const launchScopeKey = computed(() => launchControlScopeKey(projectSlug.value, sessionId.value));
  const terminalDisplayed = computed(() => readRefOrGetterValue(windowDisplayed) !== false);
  const workspacePreparing = computed(() => selectedSession.value?.workspaceSetup?.status === "running");
  const launchSourceOperationsSuspended = computed(() => (
    readRefOrGetterValue(sourceOperationsSuspended) === true || workspacePreparing.value
  ));
  const canLoadOutputs = computed(() => launchControlsCanLoadTargets({
    displayed: terminalDisplayed.value,
    session: selectedSession.value || {},
    sourceOperationsSuspended: launchSourceOperationsSuspended.value
  }));
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const outputTargetsPath = computed(() => {
    return sessionId.value ? vibe64OutputsPath(sessionsApiPath.value, sessionId.value) : "";
  });
  // The browser names the editor origin that frames the Preview; routing
  // headers can be rewritten before the request reaches the server.
  const outputTargetsRequestPath = computed(() => {
    const origin = typeof window === "undefined" ? "" : String(window.location?.origin || "");
    return outputTargetsPath.value && origin
      ? `${outputTargetsPath.value}?editorOrigin=${encodeURIComponent(origin)}`
      : outputTargetsPath.value;
  });

  const outputTargetsResource = useEndpointResource({
    enabled: canLoadOutputs,
    fallbackLoadError: "Outputs could not be loaded.",
    path: outputTargetsRequestPath,
    queryOptions: {
      retry: launchStatusShouldRetry,
      retryDelay: launchStatusRetryDelay
    },
    queryKey: computed(() => vibe64OutputsQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      sessionId.value,
      projectSlug.value
    )),
    refreshOnPull: true,
    requestRecovery: false,
    realtime: null
  });

  const status = computed(() => outputTargetsResource.data.value || {});
  const outputTargetsLoaded = computed(() => status.value.ok !== false && Array.isArray(status.value.outputTargets));
  const launchStatusLoadError = computed(() => {
    if (workspacePreparing.value) return "";
    const setup = selectedSession.value?.workspaceSetup;
    if (["failed", "ambiguous"].includes(setup?.status)) {
      return setup.diagnostic || "Workspace preparation failed. Expand Preparing workspace to inspect the failure and retry setup.";
    }
    if (outputTargetsResource.isLoading.value) return "";
    const error = outputTargetsResource.query.error.value || null;
    return launchStatusErrorText({
      error,
      fallback: outputTargetsResource.loadError.value,
      path: outputTargetsPath.value
    });
  });
  const preview = computed(() => launchPreviewFromStatus(status.value));
  const previewState = computed(() => preview.value.state);
  const previewStoppedIntent = computed(() => preview.value.stoppedIntent);
  const testApproval = computed(() => ["waiting", "resuming"].includes(status.value.testApproval?.state)
    ? status.value.testApproval : null);
  const previewMessage = computed(() => preview.value.message);
  const previewHref = computed(() => preview.value.href);
  const previewTargetHref = computed(() => preview.value.targetHref);
  const previewCanRestart = computed(() => preview.value.canRestart);
  const previewCanShowLog = computed(() => preview.value.canShowLog);
  const previewCanStart = computed(() => preview.value.canStart);
  const previewRecovery = computed(() => preview.value.recovery);
  const previewTarget = computed(() => (
    isRecord(status.value.previewTarget) ? status.value.previewTarget : null
  ));
  const outputTargets = computed(() => {
    return Array.isArray(status.value.outputTargets) ? status.value.outputTargets : [];
  });
  const outputRuns = computed(() => {
    return Array.isArray(status.value.outputRuns) ? status.value.outputRuns : [];
  });
  const outputResults = computed(() => outputRuns.value.flatMap((run) => (
    (Array.isArray(run?.results) ? run.results : []).map((result) => ({
      ...result,
      href: vibe64OutputResultPath(sessionsApiPath.value, sessionId.value, result.id),
      outputTargetId: String(run.outputTargetId || ""),
      runId: String(run.id || "")
    }))
  )));
  const outputExecution = computed(() => {
    const value = status.value.output;
    return isRecord(value)
      ? value
      : {
          error: null,
          mode: "",
          presentationKind: "",
          state: "idle",
          targetId: ""
        };
  });

  // Refetches the current scope's outputs. A caller that captured `scopeKey`
  // earlier gets nothing once the project or session has changed since.
  async function refresh({
    scopeKey = launchScopeKey.value
  } = {}) {
    if (!canLoadOutputs.value) {
      return null;
    }
    const refreshScopeKey = String(scopeKey || "").trim();
    if (!refreshScopeKey || refreshScopeKey !== launchScopeKey.value) {
      return null;
    }
    return outputTargetsResource.query.refetch({
      cancelRefetch: true
    });
  }

  // Runs the session's declared setup when its stored state is `status`: a
  // newly configured recipe, or the Preview's Retry setup after a failure.
  async function startWorkspaceSetupWhen(status = "") {
    if (
      String(selectedSession.value?.workspaceSetup?.status || "").trim() !== status ||
      !sessionId.value
    ) {
      return false;
    }
    try {
      const result = await getHttpWebClient().request(
        vibe64SessionPath(sessionsApiPath.value, sessionId.value, "/workspace-setup/retry"),
        {
          body: vibe64RealtimeOriginPayload(),
          method: "POST"
        }
      );
      return result?.ok !== false;
    } catch (error) {
      vibe64SessionDebugLog("client.launchPreview.workspaceSetup.start.error", {
        error: vibe64SessionDebugError(error),
        sessionId: sessionId.value
      });
      return false;
    }
  }

  /** A new scope starts counting its status loads again. */
  function resetLaunchStatusAttempt() {
    launchStatusAttempt.value = 0;
    launchStatusAttemptLoading = false;
    launchStatusAttemptScopeKey = launchScopeKey.value;
  }

  watch(launchSourceOperationsSuspended, (suspended, wasSuspended) => {
    if (suspended) {
      sourceOperationsResumePending.value = true;
      return;
    }
    if (wasSuspended !== true) {
      return;
    }
    const resumeScopeKey = launchScopeKey.value;
    void Promise.resolve(refresh({ scopeKey: resumeScopeKey })).finally(() => {
      if (
        !launchSourceOperationsSuspended.value &&
        launchScopeKey.value === resumeScopeKey
      ) {
        sourceOperationsResumePending.value = false;
      }
    });
  }, {
    flush: "sync",
    immediate: true
  });

  useRealtimeEvent({
    enabled: canLoadOutputs,
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: (context) => outputTargetsRealtimeShouldRefresh({
      localLaunchStarting: localLaunchStarting(),
      payload: context?.payload || {}
    }, sessionId.value),
    onEvent: () => refresh()
  });

  watch(() => [
    launchScopeKey.value,
    canLoadOutputs.value ? "loadable" : "blocked",
    outputTargetsResource.isLoading.value ? "loading" : "ready"
  ].join("|"), () => {
    const scopeKey = launchScopeKey.value;
    if (!scopeKey || !canLoadOutputs.value) {
      launchStatusAttempt.value = 0;
      launchStatusAttemptScopeKey = scopeKey;
      launchStatusAttemptLoading = false;
      return;
    }
    if (launchStatusAttemptScopeKey !== scopeKey) {
      launchStatusAttempt.value = 0;
      launchStatusAttemptScopeKey = scopeKey;
      launchStatusAttemptLoading = false;
    }
    if (outputTargetsResource.isLoading.value && !launchStatusAttemptLoading) {
      launchStatusAttempt.value += 1;
      launchStatusAttemptLoading = true;
      return;
    }
    if (!outputTargetsResource.isLoading.value) {
      launchStatusAttemptLoading = false;
    }
  }, {
    flush: "sync",
    immediate: true
  });

  return {
    canLoadOutputs,
    launchScopeKey,
    launchStatusAttempt,
    launchStatusLoadError,
    outputExecution,
    outputResults,
    outputRuns,
    outputTargets,
    outputTargetsLoaded,
    outputTargetsResource,
    previewCanRestart,
    previewCanShowLog,
    previewCanStart,
    previewHref,
    previewMessage,
    previewRecovery,
    previewState,
    previewStoppedIntent,
    previewTarget,
    previewTargetHref,
    refresh,
    resetLaunchStatusAttempt,
    selectedSession,
    sessionId,
    sessionRevision,
    sessionsApiPath,
    startWorkspaceSetupWhen,
    status,
    terminalDisplayed,
    testApproval,
    workspacePreparing
  };
}

export {
  useVibe64OutputStatus
};
