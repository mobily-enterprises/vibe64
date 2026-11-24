import { computed, onScopeDispose, ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { followHeldRequest } from "@/lib/vibe64HeldRequest.js";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
} from "@/lib/vibe64SessionDebugLog.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";

const CREATION_FAILED = "Vibe64 session could not be created.";
const CREATION_LOST_CONTACT =
  "Vibe64 could not be reached to follow this new session. Check the session list before creating another.";

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
  // The request names its creation (`requestId`), and the server answers within two seconds, as creating while the
  // session's source is made; the page repeats it (`repeat: true`) until the session, and shows one outcome.
  const createSessionResource = useEndpointResource({
    path: sessionsApiPath,
    queryKey: computed(() => ["vibe64.sessions.create", sessionsApiPath.value]),
    enabled: false
  });
  const feedback = useUiFeedback({ source: "vibe64.sessions.create" });

  /** Sends the page's creation until its outcome (`followHeldRequest`). */
  function createFollowed(apiPath, { assistantSelection, pullRequestNumber, repositoryBranch }) {
    const request = vibe64RealtimeOriginPayload({
      assistantSelection: assistantSelection || {},
      ...(repositoryBranch ? { repositoryBranch } : {}),
      ...(pullRequestNumber ? { pullRequestNumber } : {}),
      requestId: globalThis.crypto.randomUUID()
    });
    return followHeldRequest(repeat => createSessionResource.save(repeat ? { ...request, repeat } : request,
      { method: "POST", path: apiPath }), { lostContact: CREATION_LOST_CONTACT, notWorded: CREATION_FAILED });
  }
  // The page's own loading state: a creation in another project, after project navigation, never owns it.
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
        const response = await createFollowed(creationApiPath, { assistantSelection, pullRequestNumber, repositoryBranch });
        feedback.success("Vibe64 session created.");
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
        feedback.error(error, CREATION_FAILED);
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
    createSessionRunning
  };
}

export {
  useVibe64SessionCreation
};
