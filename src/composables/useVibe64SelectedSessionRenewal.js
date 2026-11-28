import { computed } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import {
  VIBE64_SESSION_SUMMARY_CHANGED_EVENT,
  VIBE64_SURFACE_ID,
  vibe64SessionPath,
  vibe64SessionQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import { mountedSessionRealtimeShouldRefresh } from "@/lib/vibe64MountedSessionState.js";
import { renewedSuccessorSessionId } from "@/lib/vibe64SessionListLookup.js";

/**
 * Follows the renewal behind the selected session: the renewal of a selected session that left the
 * list, or of the session the selected one was renewed from. The session collection selects the
 * successor once that renewal has completed, and the address hands over to it once the renewal confirms
 * it (useVibe64SessionAddress).
 * @param {{
 *   availableSessions: import("vue").ComputedRef<Array<{ sessionId: string, metadata?: { renewed_from?: string } }>>,
 *   projectSlug: import("vue").Ref<string>,
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
  selectedListSession,
  selectedSessionId,
  selectedSessionMissing,
  sessionList,
  sessionsApiPath
}) {
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

  // The renewal confirms the session shown as its successor: it has completed, from the session the shown one was
  // renewed from, naming exactly the shown one, which the list names as that session's only successor.
  const selectionRenewalConfirmed = computed(() => {
    const predecessorId = selectionRenewalPredecessorId.value;
    const shownId = String(selectedSessionId.value || "").trim();
    const renewal = selectionRenewalResource.data.value?.renewal;
    if (!predecessorId || shownId === predecessorId || selectionRenewalResource.loadError?.value) return false;
    if (selectionRenewalResource.isInitialLoading?.value || selectionRenewalResource.isLoading?.value) return false;
    return renewal?.status === "completed" &&
      String(renewal.sessionId || "").trim() === predecessorId &&
      String(renewal.successor?.sessionId || "").trim() === shownId &&
      renewedSuccessorSessionId({ predecessorSessionId: predecessorId, sessions: availableSessions.value }) === shownId;
  });

  return {
    selectionRenewalConfirmed,
    selectionRenewalPredecessorId,
    selectionRenewalResource
  };
}

export {
  useVibe64SelectedSessionRenewal
};
