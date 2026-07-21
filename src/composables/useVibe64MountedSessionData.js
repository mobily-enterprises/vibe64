import { computed, onScopeDispose, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import {
  useRealtimeEvent,
  useRealtimeSocket
} from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  agentTurnRealtimeOverlayFromPayload,
  latestAgentTurnRealtimeOverlay,
  sessionWithAgentTurnRealtimeOverlay
} from "@/lib/vibe64AgentTurnRealtimeOverlay.js";
import {
  composerMenuProjectionFromRealtimePayload,
  sessionComposerMenuNeedsRefresh,
  sessionComposerMenuProjection,
  sessionWithCachedComposerMenu
} from "@/lib/vibe64SessionComposerMenuProjection.js";
import {
  latestSessionDetailRecord,
  mountedSessionDetailLoadState,
  mountedSessionDetailRefreshReason,
  mountedSessionRealtimeShouldRefresh,
  mountedSessionRecord
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
  sessionId,
  sessionsApiPath,
  summarySession = null
} = {}) {
  const projectSlug = useVibe64ProjectSlug();
  const detailRecord = ref(null);
  const composerMenu = ref(null);
  const agentTurnOverlay = ref(null);
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
  const detailReadQuery = computed(() => ({
    includeComposerMenu: "1",
    ...(projectSlug.value ? { projectSlug: projectSlug.value } : {})
  }));
  const detailResource = useEndpointResource({
    enabled: computed(() => Boolean(activeSessionId.value && activeSessionsApiPath.value)),
    fallbackLoadError: "Vibe64 session could not be loaded.",
    path: detailPath,
    queryKey: detailQueryKey,
    queryOptions: {
      refetchOnMount: "always",
      refetchOnWindowFocus: false
    },
    readMethod: "GET",
    readQuery: detailReadQuery,
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
      sessionWithCachedComposerMenu(baseSession.value, composerMenu.value),
      agentTurnOverlay.value
    )
  ));

  let refreshInFlight = null;
  let requestedComposerMenuSignature = "";

  function rememberComposerMenu(candidate = null) {
    const projection = sessionComposerMenuProjection(candidate);
    if (!projection.signature || !Array.isArray(projection.items)) {
      return false;
    }
    composerMenu.value = {
      itemCount: projection.itemCount ?? projection.items.length,
      items: projection.items,
      signature: projection.signature
    };
    if (requestedComposerMenuSignature === projection.signature) {
      requestedComposerMenuSignature = "";
    }
    return true;
  }

  function acceptSessionResponse(candidate = null) {
    const nextRecord = latestSessionDetailRecord(
      detailRecord.value,
      candidate,
      activeSessionId.value
    );
    rememberComposerMenu(candidate);
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

  function refreshComposerMenuInBackground(signature = "", reason = "") {
    requestedComposerMenuSignature = signature;
    void refresh({ reason }).catch(() => {
      // A later event, selection, or reconnect can retry the fixed-session refresh.
    }).finally(() => {
      if (
        requestedComposerMenuSignature === signature &&
        composerMenu.value?.signature !== signature
      ) {
        requestedComposerMenuSignature = "";
      }
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

  useRealtimeEvent({
    enabled: computed(() => Boolean(activeSessionId.value)),
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => Boolean(
      composerMenuProjectionFromRealtimePayload(payload, activeSessionId.value)
    ),
    onEvent: ({ payload = {} } = {}) => {
      const projection = composerMenuProjectionFromRealtimePayload(payload, activeSessionId.value);
      if (
        !projection ||
        projection.signature === composerMenu.value?.signature ||
        projection.signature === requestedComposerMenuSignature
      ) {
        return;
      }
      refreshComposerMenuInBackground(
        projection.signature,
        "composer-menu-signature"
      );
    }
  });

  const realtimeSocket = useRealtimeSocket({ required: false });
  const reconcileAfterRealtimeConnect = () => {
    refreshInBackground("realtime-connect");
  };
  realtimeSocket.on("connect", reconcileAfterRealtimeConnect);
  onScopeDispose(() => {
    realtimeSocket.off("connect", reconcileAfterRealtimeConnect);
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

  watch(() => sessionComposerMenuNeedsRefresh(session.value, composerMenu.value), (needsRefresh) => {
    if (!needsRefresh || detailResource.isFetching?.value) {
      return;
    }
    const signature = sessionComposerMenuProjection(session.value).signature;
    if (!signature || signature === requestedComposerMenuSignature) {
      return;
    }
    refreshComposerMenuInBackground(signature, "composer-menu-cache-miss");
  }, {
    flush: "post",
    immediate: true
  });

  watch(detailState, (state) => {
    vibe64SessionDebugLog("client.mountedSession.detailState", {
      loading: state.loading === true,
      ready: state.ready === true,
      sessionId: state.sessionId,
      state: state.state,
      suppressPassiveComposer: state.suppressPassiveComposer === true
    });
  }, {
    immediate: true
  });

  return {
    acceptSessionResponse,
    detailState,
    refresh,
    resource: detailResource,
    session
  };
}

export {
  refetchMountedSessionResource,
  useVibe64MountedSessionData
};
