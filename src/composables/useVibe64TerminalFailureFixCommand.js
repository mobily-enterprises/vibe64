import { computed } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64TerminalFailureFixPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  terminalFailureFixContext
} from "@/lib/vibe64TerminalFailurePrompt.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function useVibe64TerminalFailureFixCommand({
  sessionsApiPath = null
} = {}) {
  const paths = usePaths();
  const resolvedSessionsApiPath = computed(() => {
    return String(
      readRefOrGetterValue(sessionsApiPath) ||
      paths.api(VIBE64_SESSIONS_API_SUFFIX, {
        surface: VIBE64_SURFACE_ID
      })
    );
  });
  const command = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64TerminalFailureFixPath(context.sessionsApiPath, context.sessionId)
    }),
    buildRawPayload: (_model, { context }) => terminalFailureFixContext(context),
    fallbackRunError: "Terminal fix could not start.",
    messages: {
      error: "Terminal fix could not start."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.terminal.fix",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  async function request(input = {}) {
    const context = terminalFailureFixContext(input);
    return command.run({
      ...context,
      sessionsApiPath: resolvedSessionsApiPath.value
    });
  }

  return {
    command,
    request
  };
}

export {
  useVibe64TerminalFailureFixCommand
};
