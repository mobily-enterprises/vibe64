import { computed, onScopeDispose, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import {
  useRealtimeEvent,
  useRealtimeSocket
} from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { VIBE64_ASSISTANT_ACCESS_ERROR_CODES } from "@local/vibe64-runtime/shared";
import { VIBE64_CONNECTIONS_CHANGED_EVENT } from "@/lib/studioGateApi.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  agentTurnRealtimeOverlayFromPayload,
  latestAgentTurnRealtimeOverlay,
  sessionWithAgentTurnRealtimeOverlay
} from "@/lib/vibe64AgentTurnRealtimeOverlay.js";
import {
  latestSessionDetailRecord,
  mountedSessionDetailLoadState,
  mountedSessionDetailRefreshReason,
  mountedSessionRealtimeShouldRefresh,
  mountedSessionRecord,
  sessionRecordHasActiveAgentWork
} from "@/lib/vibe64MountedSessionState.js";
import {
  enrichVibe64SessionForDisplay
} from "@/lib/vibe64SessionPanelModel.js";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SURFACE_ID,
  vibe64SessionPath,
  vibe64SessionQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
} from "@/lib/vibe64SessionDebugLog.js";
import {
  vibe64SessionRevision
} from "@/lib/vibe64SessionViewModel.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function refetchMountedSessionResource(resource) {
  if (typeof resource?.query?.refetch === "function") {
    return resource.query.refetch({
      cancelRefetch: false
    });
  }
  return resource?.reload?.();
}

function useVibe64MountedSessionData({
  active = false,
  sessionId,
  sessionsApiPath,
  summarySession = null
} = {}) {
  const projectSlug = useVibe64ProjectSlug();
  const detailRecord = ref(null);
  const agentTurnOverlay = ref(null);
  const agentConnectionStatus = ref("initializing");
  const mountedActive = computed(() => readRefOrGetterValue(active) === true);
  const activeSessionId = computed(() => String(readRefOrGetterValue(sessionId) || "").trim());
  const activeSessionsApiPath = computed(() => String(readRefOrGetterValue(sessionsApiPath) || "").trim());
  const listSession = computed(() => {
    const session = readRefOrGetterValue(summarySession);
    return session?.sessionId === activeSessionId.value ? session : null;
  });
  const detailPath = computed(() => (
    activeSessionId.value && activeSessionsApiPath.value
      ? vibe64SessionPath(activeSessionsApiPath.value, activeSessionId.value)
      : ""
  ));
  const detailQueryKey = computed(() => [
    ...vibe64SessionQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      projectSlug.value
    ),
    activeSessionId.value
  ]);
  const detailResource = useEndpointResource({
    enabled: computed(() => Boolean(activeSessionId.value && activeSessionsApiPath.value)),
    fallbackLoadError: "Vibe64 session could not be loaded.",
    path: detailPath,
    queryKey: detailQueryKey,
    queryOptions: {
      queryFn: ({ signal }) => getHttpWebClient().request(detailPath.value, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      }),
      // The HTTP client already retries reads; reconciliation retries after
      // the deadline. Keep the query layer from adding another retry loop.
      retry: false,
      refetchOnMount: "always",
      refetchOnWindowFocus: false
    },
    readMethod: "GET",
    realtime: {
      event: VIBE64_SESSION_CHANGED_EVENT,
      matches: ({ payload = {} } = {}) => mountedSessionRealtimeShouldRefresh(
        { payload },
        activeSessionId.value
      )
    },
    refreshOnPull: true,
    requestRecoveryLabel: "Vibe64 session"
  });
  const detailState = computed(() => mountedSessionDetailLoadState({
    detailSession: detailRecord.value,
    fetching: Boolean(detailResource.isFetching?.value),
    listSession: listSession.value,
    loadError: detailResource.loadError?.value || "",
    loading: Boolean(detailResource.isLoading?.value || detailResource.isInitialLoading?.value),
    sessionId: activeSessionId.value
  }));
  const baseSession = computed(() => mountedSessionRecord(
    detailRecord.value,
    listSession.value,
    activeSessionId.value
  ));
  const session = computed(() => enrichVibe64SessionForDisplay(
    sessionWithAgentTurnRealtimeOverlay(
      baseSession.value,
      agentTurnOverlay.value
    )
  ));

  let refreshInFlight = null;

  function acceptSessionResponse(candidate = null) {
    const nextRecord = latestSessionDetailRecord(
      detailRecord.value,
      candidate,
      activeSessionId.value
    );
    if (!nextRecord || nextRecord === detailRecord.value) {
      return false;
    }
    detailRecord.value = nextRecord;
    const canonicalRevision = vibe64SessionRevision(nextRecord);
    if (
      canonicalRevision !== null &&
      canonicalRevision >= Number(agentTurnOverlay.value?.revision)
    ) {
      agentTurnOverlay.value = null;
    }
    return true;
  }

  async function refresh(options = {}) {
    const reason = typeof options === "string" ? options : String(options?.reason || "");
    if (!activeSessionId.value || !activeSessionsApiPath.value) {
      return null;
    }
    if (refreshInFlight) {
      return refreshInFlight;
    }
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("client.mountedSession.refresh.start", {
      reason,
      sessionId: activeSessionId.value
    });
    refreshInFlight = Promise.resolve(refetchMountedSessionResource(detailResource));
    try {
      const result = await refreshInFlight;
      vibe64SessionDebugLog("client.mountedSession.refresh.done", {
        ...vibe64SessionDebugSummary(session.value || {}),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        reason,
        sessionId: activeSessionId.value
      });
      return result;
    } catch (error) {
      vibe64SessionDebugLog("client.mountedSession.refresh.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        reason,
        sessionId: activeSessionId.value
      });
      throw error;
    } finally {
      refreshInFlight = null;
    }
  }

  function refreshInBackground(reason = "") {
    void refresh({ reason }).catch(() => {
      // The mounted host retains its last usable snapshot and exposes the resource error.
    });
  }

  useRealtimeEvent({
    enabled: computed(() => Boolean(activeSessionId.value)),
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => Boolean(
      agentTurnRealtimeOverlayFromPayload(payload, activeSessionId.value)
    ),
    onEvent: ({ payload = {} } = {}) => {
      const overlay = agentTurnRealtimeOverlayFromPayload(payload, activeSessionId.value);
      if (!overlay) {
        return;
      }
      agentTurnOverlay.value = latestAgentTurnRealtimeOverlay(
        agentTurnOverlay.value,
        overlay
      );
      vibe64SessionDebugLog("client.mountedSession.agentTurn", {
        active: overlay.active === true,
        reason: overlay.reason,
        sessionId: overlay.sessionId,
        threadId: String(overlay.agentSession?.thread?.id || ""),
        turnId: String(overlay.agentSession?.turn?.id || "")
      });
    }
  });

  const realtimeSocket = useRealtimeSocket({ required: false });
  let connectionGeneration = realtimeSocket.connected ? 1 : 0;
  let reconciliationInFlight = null;
  let reconciliationController = null;
  let reconciliationRetryTimer = null;
  let reconciliationRetryDelay = 1_000;
  let disposed = false;

  function clearReconciliationRetry() {
    clearTimeout(reconciliationRetryTimer);
    reconciliationRetryTimer = null;
  }

  function scheduleReconciliationRetry() {
    clearReconciliationRetry();
    if (disposed || !realtimeSocket.connected || globalThis.document?.hidden) {
      return;
    }
    reconciliationRetryTimer = setTimeout(() => {
      reconciliationRetryTimer = null;
      if (!globalThis.document?.hidden) {
        void reconcileMountedAgentSession("retry");
      }
    }, reconciliationRetryDelay);
    reconciliationRetryDelay = Math.min(reconciliationRetryDelay * 2, 30_000);
  }

  // Provider preparation belongs to the selected view and connection
  // lifecycle, never passive session reads or status polling. The selected
  // view starts its provider before the first message, while a reconnect also
  // resumes any provider thread that still has active work.
  async function reconcileMountedAgentSession(reason = "realtime-connect") {
    if (disposed || !realtimeSocket.connected || !activeSessionId.value || !activeSessionsApiPath.value) {
      return null;
    }
    if (reconciliationInFlight) {
      return reconciliationInFlight;
    }
    clearReconciliationRetry();
    const generation = connectionGeneration;
    const controller = new AbortController();
    reconciliationController = controller;
    const currentConnection = () => (
      !disposed && realtimeSocket.connected && generation === connectionGeneration
    );
    const timeout = setTimeout(() => {
      controller.abort(new Error("Assistant status check timed out."));
    }, 45_000);
    const cancelled = new Promise((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
    });
    agentConnectionStatus.value = ["disconnected", "unknown", "reconciling", "unavailable"].includes(agentConnectionStatus.value)
      ? "reconciling"
      : "initializing";
    const checking = (async () => {
      const refreshed = await refresh({ reason });
      if (!currentConnection() || controller.signal.aborted) {
        return null;
      }
      if (refreshed?.isError) {
        throw refreshed.error;
      }
      const recoveringActiveAgentWork = sessionRecordHasActiveAgentWork(session.value);
      if (mountedActive.value || recoveringActiveAgentWork) {
        const result = await getHttpWebClient().request(
          vibe64SessionPath(
            activeSessionsApiPath.value,
            activeSessionId.value,
            "/agent-session"
          ),
          {
            body: {},
            method: "POST",
            signal: controller.signal
          }
        );
        if (result?.ok !== true) {
          throw Object.assign(new Error(result?.error || "Assistant status could not be reconciled."), {
            code: result?.code
          });
        }
      }
      if (currentConnection() && !controller.signal.aborted) {
        agentConnectionStatus.value = "connected";
        reconciliationRetryDelay = 1_000;
        // Provider verification has succeeded. A failed display refresh must
        // not turn that success into an unknown provider status.
        if (recoveringActiveAgentWork) {
          refreshInBackground("agent-session-reconciled");
        }
      }
      return session.value;
    })();
    reconciliationInFlight = Promise.race([checking, cancelled]).catch((error) => {
      if (currentConnection()) {
        const unavailable = error?.code === VIBE64_ASSISTANT_ACCESS_ERROR_CODES.UNAVAILABLE;
        agentConnectionStatus.value = unavailable ? "unavailable" : "unknown";
        if (!unavailable) scheduleReconciliationRetry();
        console.warn("Vibe64 assistant status check failed.", {
          code: String(error?.code || ""),
          message: String(error?.message || ""),
          reason,
          sessionId: activeSessionId.value
        });
      }
      vibe64SessionDebugLog("client.mountedSession.agentConnection.error", {
        error: vibe64SessionDebugError(error),
        reason,
        sessionId: activeSessionId.value
      });
      return null;
    }).finally(() => {
      clearTimeout(timeout);
      reconciliationController = null;
      reconciliationInFlight = null;
      // Calls from the same connection share this check. A reconnect during
      // the check needs one replacement once its predecessor has settled.
      if (!disposed && realtimeSocket.connected && generation !== connectionGeneration) {
        void reconcileMountedAgentSession("realtime-reconnected");
      }
    });
    return reconciliationInFlight;
  }

  const reconcileAfterRealtimeConnect = () => {
    connectionGeneration += 1;
    reconciliationRetryDelay = 1_000;
    void reconcileMountedAgentSession();
  };
  useRealtimeEvent({
    enabled: mountedActive,
    event: VIBE64_CONNECTIONS_CHANGED_EVENT,
    onEvent: reconcileAfterRealtimeConnect
  });
  const markRealtimeDisconnected = () => {
    connectionGeneration += 1;
    clearReconciliationRetry();
    reconciliationController?.abort();
    agentConnectionStatus.value = "disconnected";
  };
  const reconcileAfterVisible = () => {
    if (!globalThis.document?.hidden && agentConnectionStatus.value === "unknown") {
      void reconcileMountedAgentSession("visible");
    }
  };
  function retryAgentConnection() {
    if (disposed) return;
    if (realtimeSocket.connected) {
      return reconcileMountedAgentSession("manual-retry");
    }
    realtimeSocket.connect?.();
  }
  globalThis.document?.addEventListener("visibilitychange", reconcileAfterVisible);
  realtimeSocket.on("connect", reconcileAfterRealtimeConnect);
  realtimeSocket.on("connect_error", markRealtimeDisconnected);
  realtimeSocket.on("disconnect", markRealtimeDisconnected);
  if (realtimeSocket.connected) {
    queueMicrotask(() => {
      void reconcileMountedAgentSession("initial-realtime-connect");
    });
  }
  onScopeDispose(() => {
    disposed = true;
    clearReconciliationRetry();
    reconciliationController?.abort();
    globalThis.document?.removeEventListener("visibilitychange", reconcileAfterVisible);
    realtimeSocket.off("connect", reconcileAfterRealtimeConnect);
    realtimeSocket.off("connect_error", markRealtimeDisconnected);
    realtimeSocket.off("disconnect", markRealtimeDisconnected);
  });

  watch(detailResource.data, (candidate) => {
    acceptSessionResponse(candidate || null);
  }, {
    immediate: true
  });

  let summaryRefreshKey = "";
  watch(() => {
    const reason = mountedSessionDetailRefreshReason(
      detailRecord.value,
      listSession.value,
      activeSessionId.value
    );
    return {
      detailRevision: vibe64SessionRevision(detailRecord.value),
      fetching: Boolean(detailResource.isFetching?.value),
      listRevision: vibe64SessionRevision(listSession.value),
      reason,
      sessionId: activeSessionId.value
    };
  }, (state) => {
    if (!state.reason) {
      summaryRefreshKey = "";
      return;
    }
    if (state.fetching) {
      return;
    }
    const refreshKey = [
      state.sessionId,
      state.reason,
      state.detailRevision ?? "",
      state.listRevision ?? ""
    ].join("|");
    if (refreshKey === summaryRefreshKey) {
      return;
    }
    summaryRefreshKey = refreshKey;
    refreshInBackground(state.reason);
  }, {
    flush: "post",
    immediate: true
  });

  watch(detailState, (state) => {
    vibe64SessionDebugLog("client.mountedSession.detailState", {
      loading: state.loading === true,
      ready: state.ready === true,
      sessionId: state.sessionId,
      state: state.state
    });
  }, {
    immediate: true
  });

  return {
    acceptSessionResponse,
    agentConnectionStatus,
    detailState,
    reconcileMountedAgentSession,
    retryAgentConnection,
    refresh,
    resource: detailResource,
    session
  };
}

export {
  refetchMountedSessionResource,
  useVibe64MountedSessionData
};
