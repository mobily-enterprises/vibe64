import { computed, proxyRefs, ref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useQueryClient } from "@tanstack/vue-query";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import {
  VIBE64_SURFACE_ID
} from "/src/lib/vibe64RequestConfig.js";
import {
  ACCOUNTS_AUTH_ENDPOINT,
  ACCOUNTS_ENDPOINT,
  VIBE64_ACCOUNTS_CHANGED_EVENT,
  VIBE64_ACCOUNTS_AUTH_API_SUFFIX,
  VIBE64_ACCOUNTS_GIT_IDENTITY_API_SUFFIX,
  accountsQueryKey
} from "../lib/accountsGateApi.js";
import {
  invalidateVibe64CapabilitiesQueryClient
} from "/src/lib/vibe64CapabilitiesInvalidation.js";

function accountsResourceQueryKey() {
  return computed(() => accountsQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, ""));
}

function useVibe64Accounts() {
  const queryClient = useQueryClient();
  const forceRefresh = ref(false);
  const authSessionReadId = ref("");
  const statusResource = useEndpointResource({
    enabled: true,
    fallbackLoadError: "Account status could not load.",
    path: ACCOUNTS_ENDPOINT,
    queryKey: accountsResourceQueryKey(),
    readQuery: computed(() => forceRefresh.value ? { refresh: true } : null),
    realtime: {
      event: VIBE64_ACCOUNTS_CHANGED_EVENT
    },
    refreshOnPull: true,
    requestRecoveryLabel: "Account status"
  });
  const authSessionResource = useEndpointResource({
    enabled: false,
    fallbackLoadError: "Account login session could not load.",
    path: computed(() => authSessionReadId.value
      ? `${ACCOUNTS_AUTH_ENDPOINT}/${encodeURIComponent(authSessionReadId.value)}`
      : ""),
    queryKey: computed(() => [
      "vibe64",
      "accounts",
      "auth-session",
      authSessionReadId.value
    ]),
    requestRecoveryLabel: "Account login session"
  });

  const startAuthCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_ACCOUNTS_AUTH_API_SUFFIX,
    buildCommandOptions: () => ({
      method: "POST"
    }),
    buildRawPayload: (_model, { context }) => ({
      accountId: String(context.accountId || ""),
      ...(String(context.mode || "") === "api_key" ? {
        apiKey: String(context.apiKey || "")
      } : {}),
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

  const cancelAuthSessionCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_ACCOUNTS_AUTH_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "DELETE",
      path: `${ACCOUNTS_AUTH_ENDPOINT}/${encodeURIComponent(String(context?.sessionId || ""))}`
    }),
    fallbackRunError: "Account login could not be cancelled.",
    messages: {
      error: "Account login could not be cancelled."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.accounts.auth.cancel",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "DELETE"
  });

  const logoutCommand = useCommand({
    access: "never",
    apiSuffix: "/vibe64/accounts/logout",
    buildRawPayload: (_model, { context }) => ({
      accountId: String(context?.accountId || "")
    }),
    fallbackRunError: "Account logout failed.",
    messages: {
      error: "Account logout failed."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.accounts.logout",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const saveGitIdentityCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_ACCOUNTS_GIT_IDENTITY_API_SUFFIX,
    buildRawPayload: (_model, { context }) => ({
      gitUserEmail: String(context.gitUserEmail || context.email || ""),
      gitUserName: String(context.gitUserName || context.name || "")
    }),
    fallbackRunError: "Git identity could not be saved.",
    messages: {
      error: "Git identity could not be saved.",
      success: "Git identity saved."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.accounts.git-identity.save",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  async function startAuth(accountId, mode = "browser", options = {}) {
    return startAuthCommand.run({
      accountId,
      apiKey: options.apiKey || "",
      gitUserEmail: options.gitUserEmail || options.email || "",
      gitUserName: options.gitUserName || options.name || "",
      mode
    });
  }

  async function readAuthSession(sessionId) {
    authSessionReadId.value = String(sessionId || "").trim();
    if (!authSessionReadId.value) {
      return null;
    }
    const result = await authSessionResource.reload();
    return result?.data || authSessionResource.data.value || null;
  }

  async function cancelAuthSession(sessionId) {
    return cancelAuthSessionCommand.run({
      sessionId
    });
  }

  async function logout(accountId) {
    return logoutCommand.run({
      accountId
    });
  }

  async function saveGitIdentity(options = {}) {
    return saveGitIdentityCommand.run({
      gitUserEmail: options.gitUserEmail || options.email || "",
      gitUserName: options.gitUserName || options.name || ""
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

  function invalidateCapabilities(context = {}) {
    return invalidateVibe64CapabilitiesQueryClient(queryClient, {
      debugEventPrefix: "client.auth.capabilities.invalidate",
      ...context
    });
  }

  return proxyRefs({
    cancelAuthSession,
    invalidateCapabilities,
    isLoading: statusResource.isLoading,
    loadError: statusResource.loadError,
    logoutCommand,
    saveGitIdentity,
    saveGitIdentityCommand,
    readAuthSession,
    refresh,
    logout,
    cancelAuthSessionCommand,
    startAuth,
    startAuthCommand,
    status: statusResource.data,
    authSessionResource,
    statusResource
  });
}

export {
  useVibe64Accounts
};
