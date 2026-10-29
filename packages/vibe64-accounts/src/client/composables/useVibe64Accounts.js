import { computed, ref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useQueryClient } from "@tanstack/vue-query";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import {
  CODEX_RECONNECT_REQUIRED_CODE,
  CODEX_RECONNECT_REQUIRED_MESSAGE
} from "@local/vibe64-core/shared";
import {
  VIBE64_SURFACE_ID
} from "/src/lib/vibe64RequestConfig.js";
import {
  ACCOUNTS_AUTH_ENDPOINT,
  ACCOUNTS_ENDPOINT,
  VIBE64_ACCOUNTS_CHANGED_EVENT,
  VIBE64_ACCOUNTS_AUTH_API_SUFFIX,
  VIBE64_ACCOUNTS_GIT_IDENTITY_API_SUFFIX,
  VIBE64_ACCOUNTS_PERSONAL_AI_PROFILE_API_SUFFIX,
  accountsQueryKey
} from "../lib/accountsGateApi.js";

function accountsResourceQueryKey() {
  return computed(() => accountsQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, ""));
}

function codexReconnectRequiredAccount(account = {}) {
  return {
    ...account,
    code: CODEX_RECONNECT_REQUIRED_CODE,
    connected: false,
    id: "codex",
    label: account.label || "Codex",
    message: CODEX_RECONNECT_REQUIRED_MESSAGE,
    observed: account.observed || "Codex authentication was rejected during use.",
    required: true,
    scope: account.scope || "app",
    status: "reconnect_required"
  };
}

function statusWithCodexReconnectRequired(status = {}) {
  const source = status && typeof status === "object" && !Array.isArray(status)
    ? status
    : {};
  const accounts = Array.isArray(source.accounts) ? source.accounts : [];
  let codexAccountFound = false;
  const nextAccounts = accounts.map((account) => {
    if (String(account?.id || "").trim().toLowerCase() !== "codex") {
      return account;
    }
    codexAccountFound = true;
    return codexReconnectRequiredAccount(account);
  });
  if (!codexAccountFound) {
    nextAccounts.unshift(codexReconnectRequiredAccount());
  }
  return {
    ...source,
    accounts: nextAccounts,
    blockedReason: CODEX_RECONNECT_REQUIRED_MESSAGE,
    ok: source.ok !== false,
    ready: false
  };
}

// An account action answers with that account's new row. Showing it at once
// keeps the readiness rule the server applies: every required account connected.
function statusWithAccount(status, account) {
  const id = String(account?.id || "");
  const accounts = Array.isArray(status?.accounts) ? status.accounts : [];
  if (!id || !accounts.some((row) => row?.id === id)) return status;
  const nextAccounts = accounts.map((row) => row?.id === id ? account : row);
  const missing = nextAccounts.find((row) => row?.required && row.connected !== true);
  return { ...status, accounts: nextAccounts, blockedReason: missing ? String(missing.message || "") : "", ready: !missing };
}

function useVibe64Accounts({
  client = null
} = {}) {
  const queryClient = useQueryClient();
  const forceRefresh = ref(false);
  const authSessionReadId = ref("");
  const statusQueryKey = accountsResourceQueryKey();
  const statusResource = useEndpointResource({
    client,
    enabled: true,
    fallbackLoadError: "Account status could not load.",
    path: ACCOUNTS_ENDPOINT,
    queryKey: statusQueryKey,
    readQuery: computed(() => forceRefresh.value ? { refresh: true } : null),
    realtime: {
      event: VIBE64_ACCOUNTS_CHANGED_EVENT
    },
    refreshOnPull: true,
    requestRecoveryLabel: "Account status"
  });
  const authSessionResource = useEndpointResource({
    client,
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
    queryOptions: {
      retry: false
    },
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
    client,
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
    client,
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
    client,
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
    client,
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

  const savePersonalAiProfileCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_ACCOUNTS_PERSONAL_AI_PROFILE_API_SUFFIX,
    buildRawPayload: (_model, { context }) => ({
      preferredName: String(context.preferredName || "")
    }),
    client,
    fallbackRunError: "Your name could not be saved.",
    messages: {
      error: "Your name could not be saved.",
      success: "Your name is saved."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.accounts.personal-ai-profile.save",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "PATCH"
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

  async function savePersonalAiProfile(options = {}) {
    const result = await savePersonalAiProfileCommand.run({
      preferredName: options.preferredName || ""
    });
    await reloadLocalStatus();
    return result;
  }

  async function refresh() {
    forceRefresh.value = true;
    try {
      return await statusResource.reload();
    } finally {
      forceRefresh.value = false;
    }
  }

  async function reloadLocalStatus() {
    forceRefresh.value = false;
    return statusResource.reload();
  }

  function markCodexReconnectRequired() {
    queryClient.setQueryData(statusQueryKey.value, statusWithCodexReconnectRequired);
  }

  function showAccount(account) {
    queryClient.setQueryData(statusQueryKey.value, (status) => statusWithAccount(status, account));
  }

  return {
    cancelAuthSession,
    isLoading: statusResource.isLoading,
    loadError: statusResource.loadError,
    logoutCommand,
    markCodexReconnectRequired,
    saveGitIdentity,
    saveGitIdentityCommand,
    savePersonalAiProfile,
    savePersonalAiProfileCommand,
    readAuthSession,
    reloadLocalStatus,
    refresh,
    logout,
    showAccount,
    cancelAuthSessionCommand,
    startAuth,
    startAuthCommand,
    status: statusResource.data,
    authSessionResource,
    statusResource
  };
}

export {
  statusWithAccount,
  statusWithCodexReconnectRequired,
  useVibe64Accounts
};
