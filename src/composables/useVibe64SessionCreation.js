import { onScopeDispose, ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
} from "@/lib/vibe64SessionDebugLog.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";

/**
 * Creates a session in the selected project, one at a time. The new session joins the cached list
 * at once and is selected, then the list is read again; a creation that finishes after the project
 * changed leaves the new project's list and selection alone.
 * @param {{
 *   projectSlug: import("vue").Ref<string>,
 *   refreshSessionDataInBackground: (options: { reason: string }) => void,
 *   selectSessionId: (sessionId: string) => void,
 *   sessionListQueryKey: import("vue").ComputedRef<unknown[]>,
 *   sessionsApiPath: import("vue").ComputedRef<string>
 * }} options
 */
function useVibe64SessionCreation({
  projectSlug,
  refreshSessionDataInBackground,
  selectSessionId,
  sessionListQueryKey,
  sessionsApiPath
}) {
  const queryClient = useQueryClient();
  const createSessionCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_model, { context }) => ({ method: "POST", path: context?.apiPath }),
    buildRawPayload: (_model, { context }) => vibe64RealtimeOriginPayload({
      assistantSelection: context?.assistantSelection || {},
      ...(context?.repositoryBranch ? { repositoryBranch: context.repositoryBranch } : {}),
      ...(context?.pullRequestNumber ? { pullRequestNumber: context.pullRequestNumber } : {})
    }),
    fallbackRunError: "Vibe64 session could not be created.",
    messages: {
      error: "Vibe64 session could not be created.",
      success: "Vibe64 session created."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.create",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
  // useCommand's observable operation state is shared by placement source. It
  // may still describe a creation in another project after project navigation,
  // so it cannot own this page's local loading state.
  const createSessionRunning = ref(false);
  let createSessionInFlight = null;
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });

  async function createSession(assistantSelection = {}, { pullRequestNumber, repositoryBranch } = {}) {
    if (createSessionInFlight) {
      return createSessionInFlight;
    }
    const startedAtMs = Date.now();
    const creationProjectSlug = String(projectSlug.value || "").trim();
    const creationApiPath = sessionsApiPath.value;
    const creationQueryKey = [...sessionListQueryKey.value];
    vibe64SessionDebugLog("client.sessionData.createSession.start");
    createSessionRunning.value = true;
    createSessionInFlight = (async () => {
      try {
        const response = await createSessionCommand.run({ assistantSelection, pullRequestNumber, repositoryBranch, apiPath: creationApiPath });
        if (
          !disposed &&
          creationProjectSlug === String(projectSlug.value || "").trim()
        ) {
          if (
            response?.creation &&
            response?.limits
          ) {
            queryClient.setQueryData(creationQueryKey, (currentPayload) => {
              if (
                !currentPayload ||
                typeof currentPayload !== "object" ||
                Array.isArray(currentPayload)
              ) {
                return currentPayload;
              }
              const currentSessions = Array.isArray(currentPayload.sessions)
                ? currentPayload.sessions
                : [];
              const createdSession = response.sessionId
                ? Object.fromEntries(Object.entries(response).filter(([key]) => ![
                    "creation",
                    "limits",
                    "ok"
                  ].includes(key)))
                : null;
              return {
                ...currentPayload,
                creation: response.creation,
                limits: response.limits,
                ...(createdSession && !currentSessions.some((item) => (
                  item?.sessionId === createdSession.sessionId
                ))
                  ? {
                      sessions: [...currentSessions, createdSession]
                    }
                  : {})
              };
            });
          }
          if (response?.sessionId) {
            selectSessionId(response.sessionId);
          }
          refreshSessionDataInBackground({ reason: "create-session" });
        }
        vibe64SessionDebugLog("client.sessionData.createSession.done", {
          ...vibe64SessionDebugSummary(response || {}),
          code: String(response?.code || response?.errors?.[0]?.code || ""),
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          ok: response?.ok !== false
        });
        return response;
      } catch (error) {
        vibe64SessionDebugLog("client.sessionData.createSession.error", {
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          error: vibe64SessionDebugError(error)
        });
        throw error;
      } finally {
        createSessionRunning.value = false;
        createSessionInFlight = null;
      }
    })();
    return createSessionInFlight;
  }

  return {
    createSession,
    createSessionCommand,
    createSessionRunning
  };
}

export {
  useVibe64SessionCreation
};
