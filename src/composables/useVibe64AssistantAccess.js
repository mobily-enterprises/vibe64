import { computed, hasInjectionContext, inject, ref, unref, watch } from "vue";
import { VIBE64_ACCOUNTS_CHANGED_EVENT } from "@local/vibe64-accounts/client";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
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
  const viewer = hasInjectionContext() ? inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" }) : { actorKey: "local" };
  const actorKey = computed(() => unref(viewer)?.actorKey || "");
  const currentSessionId = computed(() => assistantAccessText(
    readRefOrGetterValue(sessionId)
  ));
  const currentSessionsApiPath = computed(() => assistantAccessText(
    readRefOrGetterValue(sessionsApiPath)
  ));
  const enabled = computed(() => Boolean(
    readRefOrGetterValue(active) !== false &&
    currentSessionId.value &&
    currentSessionsApiPath.value && actorKey.value
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
    events: [VIBE64_SESSION_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT, VIBE64_ACCOUNTS_CHANGED_EVENT],
    matches: ({ event = "", payload = {} } = {}) => {
      if (event === VIBE64_CONNECTIONS_CHANGED_EVENT || event === VIBE64_ACCOUNTS_CHANGED_EVENT) {
        return true;
      }
      const reason = assistantAccessText(payload.reason);
      if (["codex-app-server-turn-active", "codex-app-server-turn-idle", "opencode-server-turn-active",
        "opencode-server-turn-idle", "claude-stream-turn-active", "claude-stream-turn-idle"].includes(reason)) {
        return mountedSessionRealtimeShouldRefresh({ payload: { ...payload, reason: "" } }, currentSessionId.value);
      }
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
      "assistant-access", actorKey.value || "signed-out"
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
      "message-suggestions", actorKey.value || "signed-out"
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
  const scopeKey = computed(() => JSON.stringify([projectSlug.value, currentSessionId.value, actorKey.value]));
  watch(scopeKey, () => { pendingAction.value = null; }, { flush: "sync" });

  const access = computed(() => {
    const value = accessResource.data.value;
    return actorKey.value && value && value.ok !== false ? value : null;
  });
  const purposes = computed(() => access.value?.purposes || {});
  const currentPurpose = computed(() => purposes.value[access.value?.currentMode]);
  const accessLabel = computed(() => {
    const selection = currentPurpose.value?.effectiveSelection;
    return currentPurpose.value?.backupUsed ? "Shared backup" : selection
      ? `${selection.engineId} · ${selection.modelId}` : assistantAccessText(access.value?.accessLabel) || "Unavailable";
  });
  const canUseChat = computed(() => access.value?.canUse === true);
  const canRouteChat = computed(() => !access.value?.steering && currentPurpose.value?.available === true);
  const canUseNative = computed(() => access.value?.nativeCanUse === true);
  const canUseAi = computed(() => access.value?.canUseAny ?? canUseChat.value);
  const canUsePurpose = (purpose) => purposes.value[purpose]?.available === true;
  const canRequestMessage = computed(() => access.value?.canRequestMessage === true);
  const canSubmitMainChat = computed(() => canUseChat.value || canRequestMessage.value);
  const canManage = computed(() => Boolean(actorKey.value) && suggestionsResource.data.value?.canManage === true);
  const suggestions = computed(() => (
    actorKey.value && Array.isArray(suggestionsResource.data.value?.suggestions)
      ? suggestionsResource.data.value.suggestions
      : []
  ));
  const pendingSuggestions = computed(() => suggestions.value
    .filter((suggestion) => ["pending", "delivering"].includes(assistantAccessText(suggestion?.status)))
    .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")))
  );
  const recentSuggestions = computed(() => suggestions.value
    .filter((suggestion) => ["delivered", "discarded", "withdrawn"].includes(suggestion?.status))
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
    .slice(0, 3)
  );
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
    if (canUseChat.value) return "";
    if (canRequestMessage.value) {
      return "Write a message and add any files you’d like to share. The owner reviews your request before sending it to the AI.";
    }
    if (currentPurpose.value && !currentPurpose.value.available) return currentPurpose.value.message;
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
    const actionScopeKey = scopeKey.value;
    pendingAction.value = { name, sessionId: actionSessionId, suggestionId, scopeKey: actionScopeKey };
    try {
      const response = await suggestionCommand.run({ body, path });
      if (scopeKey.value !== actionScopeKey) return null;
      if (currentSessionId.value === actionSessionId && response?.ok !== false) {
        await suggestionsResource.reload?.();
      }
      return response;
    } finally {
      if (pendingAction.value?.scopeKey === actionScopeKey) {
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
    canUseChat,
    canRouteChat,
    canUseNative,
    canUsePurpose,
    purposes,
    scopeKey,
    discardSuggestion,
    initialAccessLoading,
    pendingAction,
    pendingSuggestions,
    recentSuggestions,
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
