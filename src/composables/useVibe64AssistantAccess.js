import { computed, hasInjectionContext, inject, unref } from "vue";
import { VIBE64_ACCOUNTS_CHANGED_EVENT } from "@local/vibe64-accounts/client";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "@/lib/vibe64AssistantHost.js";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";

import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { vibe64ResourceResponseError } from "@/lib/vibe64ApiResponses.js";
import { mountedSessionRealtimeShouldRefresh } from "@/lib/vibe64MountedSessionState.js";
import {
  VIBE64_SESSION_CHANGED_EVENT,
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
  const accessPath = computed(() => enabled.value
    ? vibe64SessionPath(currentSessionsApiPath.value, currentSessionId.value, "/assistant-access")
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
  const scopeKey = computed(() => JSON.stringify([projectSlug.value, currentSessionId.value, actorKey.value]));

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
  const accessError = computed(() => vibe64ResourceResponseError(
    accessResource.data.value,
    "AI access could not be loaded."
  ) || assistantAccessText(accessResource.loadError.value));
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
    if (access.value?.steering && access.value?.ownerOnly && !canUseNative.value) {
      return "Only the owner can steer this turn. You can send a message when it finishes.";
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

  return {
    access,
    accessError,
    accessLabel,
    canUseAi,
    canUseChat,
    canRouteChat,
    canUseNative,
    canUsePurpose,
    purposes,
    scopeKey,
    initialAccessLoading,
    reload: accessResource.reload,
    restrictionMessage
  };
}

export {
  useVibe64AssistantAccess
};
