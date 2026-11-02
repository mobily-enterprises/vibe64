import { onScopeDispose, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import {
  VIBE64_CURRENT_SESSION_API_SUFFIX,
  VIBE64_SURFACE_ID
} from "@/lib/vibe64SessionRequestConfig.js";
import { createVibe64CurrentSessionPublisher } from "@/lib/vibe64CurrentSessionPublisher.js";
import { sessionIdExistsInList } from "@/lib/vibe64SessionListLookup.js";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";

function selectedSessionIdForCurrentAlias({
  createSessionRunning = false,
  selectedSessionId = "",
  sessionListLoaded = true,
  sessionListLoadError = "",
  sessionListLoading = false,
  sessions = []
} = {}) {
  if (
    !sessionListLoaded ||
    sessionListLoading ||
    String(sessionListLoadError || "").trim()
  ) {
    return null;
  }
  const normalizedSessionId = String(selectedSessionId || "").trim();
  if (sessionIdExistsInList(normalizedSessionId, sessions)) {
    return normalizedSessionId;
  }
  if (sessions.length > 0 || createSessionRunning) {
    return null;
  }
  return "";
}

/**
 * Publishes the selected session as the project's current-session shortcut once the loaded list can
 * vouch for it, after each render that changes the selection; an empty project publishes no session.
 * @param {{
 *   selectionReconciliationState: import("vue").ComputedRef<{
 *     createSessionRunning: boolean,
 *     currentSessionApiPath: string,
 *     nextSessions: Array<{ sessionId: string }>,
 *     selectedSessionId: string,
 *     sessionListLoaded: boolean,
 *     sessionListLoadError: string,
 *     sessionListLoading: boolean
 *   }>
 * }} options
 */
function useVibe64CurrentSessionPublication({ selectionReconciliationState }) {
  const updateCurrentSessionCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_CURRENT_SESSION_API_SUFFIX,
    buildCommandOptions: (_model, { context }) => ({
      method: "PUT",
      path: String(context?.apiPath || "")
    }),
    buildRawPayload: (_model, { context }) => ({
      sessionId: String(context?.sessionId || "").trim()
    }),
    fallbackRunError: "The current session shortcut could not be updated.",
    messages: {
      error: "The current session shortcut could not be updated."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.current.update",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "PUT"
  });
  const currentSessionPublisher = createVibe64CurrentSessionPublisher({
    async publish({ apiPath, sessionId }) {
      const response = await updateCurrentSessionCommand.run({
        apiPath,
        sessionId
      });
      if (!response || response.ok === false) {
        throw new Error(
          String(response?.error || "The current session shortcut could not be updated.")
        );
      }
    },
    onError(error, publication) {
      vibe64SessionDebugLog("client.sessionData.currentSession.error", {
        error: vibe64SessionDebugError(error),
        sessionId: publication.sessionId
      });
    }
  });
  onScopeDispose(() => {
    currentSessionPublisher.stop();
  });

  watch(selectionReconciliationState, (state) => {
    const publicationSessionId = selectedSessionIdForCurrentAlias({
      createSessionRunning: state.createSessionRunning,
      selectedSessionId: state.selectedSessionId,
      sessionListLoaded: state.sessionListLoaded,
      sessionListLoadError: state.sessionListLoadError,
      sessionListLoading: state.sessionListLoading,
      sessions: state.nextSessions
    });
    if (publicationSessionId === null || !state.currentSessionApiPath) {
      return;
    }
    void currentSessionPublisher.request({
      apiPath: state.currentSessionApiPath,
      sessionId: publicationSessionId
    });
  }, {
    flush: "post",
    immediate: true
  });
}

export {
  selectedSessionIdForCurrentAlias,
  useVibe64CurrentSessionPublication
};
