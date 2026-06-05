import { computed, proxyRefs, ref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import {
  VIBE64_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS
} from "@/lib/vibe64RequestConfig.js";
import {
  ACCOUNTS_AUTH_ENDPOINT,
  ACCOUNTS_ENDPOINT,
  ACCOUNTS_LOGOUT_ENDPOINT,
  VIBE64_ACCOUNTS_AUTH_API_SUFFIX,
  accountsQueryKey
} from "@/lib/studioGateApi.js";
import {
  studioHttpClient
} from "@/lib/studioHttp.js";

function accountsResourceQueryKey() {
  return computed(() => accountsQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, ""));
}

function useVibe64Accounts() {
  const forceRefresh = ref(false);
  const statusResource = useEndpointResource({
    client: studioHttpClient,
    enabled: true,
    fallbackLoadError: "Account status could not load.",
    path: ACCOUNTS_ENDPOINT,
    queryKey: accountsResourceQueryKey(),
    readQuery: computed(() => forceRefresh.value ? { refresh: true } : null),
    refreshOnPull: true
  });

  const startAuthCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_ACCOUNTS_AUTH_API_SUFFIX,
    buildCommandOptions: () => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS
    }),
    buildRawPayload: (_model, { context }) => ({
      accountId: String(context.accountId || ""),
      gitUserEmail: String(context.gitUserEmail || ""),
      gitUserName: String(context.gitUserName || ""),
      mode: String(context.mode || "browser")
    }),
    fallbackRunError: "Account login could not start.",
    messages: {
      error: "Account login could not start.",
      success: "Account login started."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.accounts.auth.start",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  async function startAuth(accountId, mode = "browser", options = {}) {
    return startAuthCommand.run({
      accountId,
      gitUserEmail: options.gitUserEmail || options.email || "",
      gitUserName: options.gitUserName || options.name || "",
      mode
    });
  }

  async function readAuthSession(sessionId) {
    return studioHttpClient.get(`${ACCOUNTS_AUTH_ENDPOINT}/${encodeURIComponent(sessionId)}`);
  }

  async function cancelAuthSession(sessionId) {
    return studioHttpClient.delete(`${ACCOUNTS_AUTH_ENDPOINT}/${encodeURIComponent(sessionId)}`);
  }

  async function logout(accountId) {
    return studioHttpClient.post(ACCOUNTS_LOGOUT_ENDPOINT, {
      accountId: String(accountId || "")
    });
  }

  async function refresh() {
    forceRefresh.value = true;
    try {
      return await statusResource.reload();
    } finally {
      forceRefresh.value = false;
    }
  }

  return proxyRefs({
    cancelAuthSession,
    isLoading: statusResource.isLoading,
    loadError: statusResource.loadError,
    readAuthSession,
    refresh,
    logout,
    startAuth,
    startAuthCommand,
    status: statusResource.data,
    statusResource
  });
}

export {
  useVibe64Accounts
};
