import { computed } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  runVibe64ClientControl
} from "@/lib/vibe64ClientControlDispatcher.js";
import {
  VIBE64_API_SUFFIX,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64AgentSessionsReconcilePath,
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function useVibe64ClientControls({
  sessionsApiPath = null
} = {}) {
  const paths = usePaths();
  const resolvedSessionsApiPath = computed(() => String(
    readRefOrGetterValue(sessionsApiPath) ||
    paths.api(VIBE64_SESSIONS_API_SUFFIX, {
      surface: VIBE64_SURFACE_ID
    })
  ));
  const resolvedVibe64ApiPath = computed(() => paths.api(VIBE64_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const ensureAgentSessionCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64SessionPath(context.sessionsApiPath, context.sessionId, "/agent-session")
    }),
    buildCommandPayload: () => undefined,
    fallbackRunError: "The assistant could not be prepared.",
    messages: {
      error: "The assistant could not be prepared."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.client-controls.agent-session",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
  const reconnectAgentSessionsCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64AgentSessionsReconcilePath(context.vibe64ApiPath)
    }),
    buildCommandPayload: () => undefined,
    fallbackRunError: "Assistant sessions could not be reconnected.",
    messages: {
      error: "Assistant sessions could not be reconnected."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.client-controls.agent-sessions-reconcile",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  async function ensureAgentSession(sessionId = "") {
    return ensureAgentSessionCommand.run({
      sessionId: String(sessionId || ""),
      sessionsApiPath: resolvedSessionsApiPath.value
    });
  }

  async function reconnectAgentSessions() {
    return reconnectAgentSessionsCommand.run({
      vibe64ApiPath: resolvedVibe64ApiPath.value
    });
  }

  async function runClientControl(control = {}, context = {}) {
    return runVibe64ClientControl(control, {
      ...context,
      ensureAgentSession,
      reconnectAgentSessions
    });
  }

  return {
    ensureAgentSession,
    ensureAgentSessionCommand,
    reconnectAgentSessions,
    reconnectAgentSessionsCommand,
    runClientControl
  };
}

export {
  useVibe64ClientControls
};
