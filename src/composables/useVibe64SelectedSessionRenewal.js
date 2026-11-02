import { computed, onScopeDispose } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { selectedSessionIdFromRoute } from "@/composables/useVibe64SessionSelection.js";
import {
  VIBE64_SESSION_SUMMARY_CHANGED_EVENT,
  VIBE64_SURFACE_ID,
  vibe64SessionPath,
  vibe64SessionQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import { renewedSuccessorSessionId } from "@/lib/vibe64SessionListLookup.js";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";
import { mountedSessionRealtimeShouldRefresh } from "@/lib/vibe64MountedSessionState.js";

/**
 * Follows the renewal behind the selected session: the renewal of a selected session that left the
 * list, or of the session the selected one was renewed from. Once that renewal has completed and its
 * successor is selected, the address moves from the predecessor to the successor.
 * @param {{
 *   availableSessions: import("vue").ComputedRef<Array<{ sessionId: string }>>,
 *   projectSlug: import("vue").Ref<string>,
 *   route: import("vue-router").RouteLocationNormalizedLoaded,
 *   router: import("vue-router").Router,
 *   selectedListSession: import("vue").ComputedRef<{ metadata?: { renewed_from?: string } } | null>,
 *   selectedSessionId: import("vue").Ref<string>,
 *   selectedSessionMissing: import("vue").ComputedRef<boolean>,
 *   sessionList: { loadError: string, pages: object[], unavailableItems: Array<{ sessionId: string }> },
 *   sessionsApiPath: import("vue").ComputedRef<string>
 * }} options
 */
function useVibe64SelectedSessionRenewal({
  availableSessions,
  projectSlug,
  route,
  router,
  selectedListSession,
  selectedSessionId,
  selectedSessionMissing,
  sessionList,
  sessionsApiPath
}) {
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });
  const selectionRenewalPredecessorId = computed(() => {
    const selectedId = String(selectedSessionId.value || "").trim();
    if (!selectedId || sessionList.pages.length < 1 || String(sessionList.loadError || "").trim()) {
      return "";
    }
    if (sessionList.unavailableItems.some((session) => session.sessionId === selectedId)) {
      return "";
    }
    if (selectedSessionMissing.value) {
      return selectedId;
    }
    return String(selectedListSession.value?.metadata?.renewed_from || "").trim();
  });
  const selectionRenewalPath = computed(() => (
    selectionRenewalPredecessorId.value
      ? vibe64SessionPath(
          sessionsApiPath.value,
          selectionRenewalPredecessorId.value,
          "/renewal"
        )
      : ""
  ));
  const selectionRenewalResource = useEndpointResource({
    enabled: computed(() => Boolean(selectionRenewalPredecessorId.value)),
    fallbackLoadError: "The selected session renewal could not be checked.",
    path: selectionRenewalPath,
    queryKey: computed(() => [
      ...vibe64SessionQueryKey(
        VIBE64_SURFACE_ID,
        ROUTE_VISIBILITY_PUBLIC,
        projectSlug.value
      ),
      selectionRenewalPredecessorId.value,
      "renewal"
    ]),
    queryOptions: {
      refetchOnMount: "always",
      refetchOnWindowFocus: false
    },
    readMethod: "GET",
    realtime: {
      event: VIBE64_SESSION_SUMMARY_CHANGED_EVENT,
      matches: ({ payload = {} } = {}) => mountedSessionRealtimeShouldRefresh(
        { payload },
        selectionRenewalPredecessorId.value
      )
    },
    requestRecoveryLabel: "Selected session renewal"
  });

  let pendingRenewalNavigation = null;
  function syncRenewalSuccessorUrl(predecessorId, successorId) {
    if (selectedSessionIdFromRoute(route) !== predecessorId) return;
    const capturedProject = String(projectSlug.value || "").trim();
    const capturedApiPath = sessionsApiPath.value;
    const predecessorUrl = route.fullPath;
    if (pendingRenewalNavigation?.predecessorUrl === predecessorUrl &&
      pendingRenewalNavigation?.successorId === successorId) return;
    const sameRenewal = () => {
      const renewal = selectionRenewalResource.data.value?.renewal;
      return !disposed &&
        String(projectSlug.value || "").trim() === capturedProject && sessionsApiPath.value === capturedApiPath &&
        selectedSessionId.value === successorId &&
        !selectionRenewalResource.loadError?.value && !selectionRenewalResource.isInitialLoading?.value &&
        !selectionRenewalResource.isLoading?.value && renewal?.status === "completed" &&
        String(renewal.sessionId || "").trim() === predecessorId &&
        String(renewal.successor?.sessionId || "").trim() === successorId &&
        renewedSuccessorSessionId({ predecessorSessionId: predecessorId, sessions: availableSessions.value }) === successorId;
    };
    if (!sameRenewal()) return;
    const target = { path: route.path, hash: route.hash, query: { ...route.query, session: successorId } };
    const targetUrl = router.resolve(target).fullPath;
    const navigation = { predecessorUrl, successorId };
    const removeGuard = router.beforeResolve((to) => {
      if (to.fullPath === targetUrl && (!sameRenewal() || route.fullPath !== predecessorUrl)) return false;
    });
    pendingRenewalNavigation = navigation;
    // Reconciliation has already selected the successor. The predecessor host
    // may be inactive now, so the collection owner also owns its replacement URL.
    void (async () => {
      try {
        await router.replace(target);
      } catch (error) {
        if (sameRenewal()) {
          vibe64SessionDebugLog("client.sessionData.renewalNavigation.error", {
            error: vibe64SessionDebugError(error), sessionId: successorId
          });
        }
      } finally {
        removeGuard();
        if (pendingRenewalNavigation === navigation) pendingRenewalNavigation = null;
      }
    })();
  }

  return {
    selectionRenewalPredecessorId,
    selectionRenewalResource,
    syncRenewalSuccessorUrl
  };
}

export {
  useVibe64SelectedSessionRenewal
};
