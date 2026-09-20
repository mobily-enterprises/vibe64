import { computed, ref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";

import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { vibe64ResourceResponseError } from "@/lib/vibe64ApiResponses.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";
import { mountedSessionRealtimeShouldRefresh } from "@/lib/vibe64MountedSessionState.js";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64SessionPath,
  vibe64SessionQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { VIBE64_CONNECTIONS_CHANGED_EVENT } from "@/lib/studioGateApi.js";

const ASSISTANT_ACCESS_IGNORED_REALTIME_REASONS = new Set([
  "assistant-stream",
  "opencode-credential-failure",
  "opencode-provider-failure",
  "opencode-server-assistant-message",
  "opencode-server-message-delivered",
  "opencode-server-progress",
  "opencode-server-reasoning",
  "opencode-server-tool",
  "opencode-server-turn-idle",
  "claude-stream-turn-idle",
  "claude-stream-message",
  "claude-stream-message-delivered"
]);

function assistantAccessText(value = "") {
  return String(value ?? "").trim();
}

function useVibe64AssistantAccess({
  active = true,
  sessionId = "",
  sessionsApiPath = ""
} = {}) {
  const projectSlug = useVibe64ProjectSlug();
  const currentSessionId = computed(() => assistantAccessText(
    readRefOrGetterValue(sessionId)
  ));
  const currentSessionsApiPath = computed(() => assistantAccessText(
    readRefOrGetterValue(sessionsApiPath)
  ));
  const enabled = computed(() => Boolean(
    readRefOrGetterValue(active) !== false &&
    currentSessionId.value &&
    currentSessionsApiPath.value
  ));
  const sessionPath = computed(() => enabled.value
    ? vibe64SessionPath(currentSessionsApiPath.value, currentSessionId.value)
    : ""
  );
  const accessPath = computed(() => sessionPath.value
    ? `${sessionPath.value}/assistant-access`
    : ""
  );
  const suggestionsPath = computed(() => sessionPath.value
    ? `${sessionPath.value}/message-suggestions`
    : ""
  );
  const realtime = {
    events: [VIBE64_SESSION_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT],
    matches: ({ event = "", payload = {} } = {}) => {
      if (event === VIBE64_CONNECTIONS_CHANGED_EVENT) {
        return true;
      }
      const reason = assistantAccessText(payload.reason);
      return !ASSISTANT_ACCESS_IGNORED_REALTIME_REASONS.has(reason) &&
        mountedSessionRealtimeShouldRefresh({ payload }, currentSessionId.value);
    }
  };
  const accessResource = useEndpointResource({
    enabled,
    fallbackLoadError: "AI access could not be loaded.",
    path: accessPath,
    queryKey: computed(() => [
      ...vibe64SessionQueryKey(
        VIBE64_SURFACE_ID,
        ROUTE_VISIBILITY_PUBLIC,
        projectSlug.value
      ),
      currentSessionId.value,
      "assistant-access"
    ]),
    queryOptions: {
      refetchOnMount: "always",
      refetchOnWindowFocus: true
    },
    readMethod: "GET",
    realtime,
    refreshOnPull: true,
    requestRecoveryLabel: "AI access"
  });
  const suggestionsResource = useEndpointResource({
    enabled,
    fallbackLoadError: "Message suggestions could not be loaded.",
    path: suggestionsPath,
    queryKey: computed(() => [
      ...vibe64SessionQueryKey(
        VIBE64_SURFACE_ID,
        ROUTE_VISIBILITY_PUBLIC,
        projectSlug.value
      ),
      currentSessionId.value,
      "message-suggestions"
    ]),
    queryOptions: {
      refetchOnMount: "always",
      refetchOnWindowFocus: true
    },
    readMethod: "GET",
    realtime,
    refreshOnPull: true,
    requestRecoveryLabel: "Message suggestions"
  });
  const suggestionCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_model, { context }) => ({
      method: "POST",
      path: assistantAccessText(context?.path)
    }),
    buildRawPayload: (_model, { context }) => vibe64RealtimeOriginPayload(
      context?.body || {}
    ),
    fallbackRunError: "The message suggestion could not be updated.",
    messages: {
      error: "The message suggestion could not be updated."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.message-suggestions.command",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
  const pendingAction = ref(null);

  const access = computed(() => {
    const value = accessResource.data.value;
    return value && value.ok !== false ? value : null;
  });
  const accessLabel = computed(() => assistantAccessText(
    access.value?.accessLabel
  ) || "Unavailable");
  const canUseAi = computed(() => access.value?.canUse === true);
  const canRequestMessage = computed(() => access.value?.canRequestMessage === true);
  const canSubmitMainChat = computed(() => canUseAi.value || canRequestMessage.value);
  const canManage = computed(() => suggestionsResource.data.value?.canManage === true);
  const suggestions = computed(() => (
    Array.isArray(suggestionsResource.data.value?.suggestions)
      ? suggestionsResource.data.value.suggestions
      : []
  ));
  const pendingSuggestions = computed(() => suggestions.value.filter((suggestion) => (
    ["pending", "delivering"].includes(assistantAccessText(suggestion?.status))
  )));
  const accessError = computed(() => vibe64ResourceResponseError(
    accessResource.data.value,
    "AI access could not be loaded."
  ) || assistantAccessText(accessResource.loadError.value));
  const suggestionsError = computed(() => vibe64ResourceResponseError(
    suggestionsResource.data.value,
    "Message suggestions could not be loaded."
  ) || assistantAccessText(suggestionsResource.loadError.value));
  const initialAccessLoading = computed(() => Boolean(
    readRefOrGetterValue(active) !== false &&
    !access.value &&
    !accessError.value &&
    (
      !enabled.value ||
      accessResource.isInitialLoading.value ||
      accessResource.isLoading.value
    )
  ));
  const restrictionMessage = computed(() => {
    if (canRequestMessage.value) {
      return "Only the workspace owner can run this personal AI connection. You can request a main-chat message for approval.";
    }
    if (access.value?.available === true && access.value?.ownerOnly === true) {
      return "Only the workspace owner can use this personal AI connection.";
    }
    if (!access.value || access.value.available !== true) {
      return accessError.value || "The selected AI connection is unavailable.";
    }
    return "";
  });

  function actionIsPending(name = "", suggestionId = "") {
    return pendingAction.value?.name === name &&
      (!suggestionId || pendingAction.value?.suggestionId === suggestionId);
  }

  async function reload() {
    await Promise.all([
      accessResource.reload?.(),
      suggestionsResource.reload?.()
    ]);
  }

  async function runSuggestionAction(name, path, body = {}, suggestionId = "") {
    if (!enabled.value || pendingAction.value) {
      return null;
    }
    const actionSessionId = currentSessionId.value;
    pendingAction.value = { name, sessionId: actionSessionId, suggestionId };
    try {
      const response = await suggestionCommand.run({ body, path });
      if (currentSessionId.value === actionSessionId && response?.ok !== false) {
        await suggestionsResource.reload?.();
      }
      return response;
    } finally {
      if (pendingAction.value?.sessionId === actionSessionId) {
        pendingAction.value = null;
      }
    }
  }

  async function suggestMessage(input = {}) {
    const response = await runSuggestionAction(
      "suggest",
      suggestionsPath.value,
      input
    );
    return response?.ok === false || !response
      ? response
      : { ...response, suggested: true };
  }

  function suggestionDecisionPath(suggestionId = "", decision = "") {
    return `${suggestionsPath.value}/${encodeURIComponent(
      assistantAccessText(suggestionId)
    )}/${decision}`;
  }

  function withdrawSuggestion(suggestionId = "") {
    const id = assistantAccessText(suggestionId);
    return runSuggestionAction(
      "withdraw",
      suggestionDecisionPath(id, "withdraw"),
      {},
      id
    );
  }

  function approveSuggestion(suggestionId = "") {
    const id = assistantAccessText(suggestionId);
    return runSuggestionAction(
      "approve",
      suggestionDecisionPath(id, "approve"),
      {},
      id
    );
  }

  function discardSuggestion(suggestionId = "") {
    const id = assistantAccessText(suggestionId);
    return runSuggestionAction(
      "discard",
      suggestionDecisionPath(id, "discard"),
      {},
      id
    );
  }

  return {
    access,
    accessError,
    accessLabel,
    actionIsPending,
    approveSuggestion,
    canManage,
    canRequestMessage,
    canSubmitMainChat,
    canUseAi,
    discardSuggestion,
    initialAccessLoading,
    pendingAction,
    pendingSuggestions,
    reload,
    restrictionMessage,
    suggestMessage,
    suggestionsError,
    withdrawSuggestion
  };
}

export {
  useVibe64AssistantAccess
};
