import { computed, hasInjectionContext, inject, unref } from "vue";
import { vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
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
  vibe64SessionEventMatchesScope,
  vibe64SessionPath,
  vibe64SessionQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { VIBE64_CONNECTIONS_CHANGED_EVENT } from "@/lib/studioGateApi.js";

function assistantAccessText(value = "") {
  return String(value ?? "").trim();
}

function useVibe64AssistantAccess({
  active = true,
  projectSlug: projectSlugInput,
  viewer: viewerInput,
  sessionId = "",
  sessionsApiPath = ""
} = {}) {
  const projectSlug = projectSlugInput === undefined ? useVibe64ProjectSlug()
    : computed(() => readRefOrGetterValue(projectSlugInput));
  const viewer = viewerInput === undefined
    ? (hasInjectionContext() ? inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" }) : { actorKey: "local" })
    : viewerInput;
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
      return vibe64SessionEventMatchesScope(payload, { projectSlug: projectSlug.value }) &&
        mountedSessionRealtimeShouldRefresh({ payload }, currentSessionId.value, "includeAccess");
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
    return selection ? vibe64AssistantSelectionLabel(selection) : assistantAccessText(access.value?.accessLabel) || "Unavailable";
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
    if (canUseChat.value || initialAccessLoading.value) return "";
    // Steering joins the running turn on its own connection; say why that connection refuses.
    if (access.value?.steering && !canUseNative.value) {
      return access.value.available === true
        ? "Only the owner can steer this turn. You can send a message when it finishes."
        : "This turn's AI connection is unavailable right now, so you can't steer it. " +
          "Check AI Accounts, or send your message when the turn finishes.";
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
