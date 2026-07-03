import { computed, proxyRefs, ref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";

import {
  VIBE64_SURFACE_ID
} from "/src/lib/vibe64RequestConfig.js";
import {
  MANAGED_APP_AUTH_CONNECT_ENDPOINT,
  MANAGED_APP_AUTH_DISCONNECT_ENDPOINT,
  MANAGED_APP_AUTH_ENDPOINT,
  MANAGED_APP_AUTH_SETUP_ENDPOINT,
  MANAGED_APP_AUTH_SMTP_LOGIN_DISCONNECT_ENDPOINT,
  MANAGED_APP_AUTH_SMTP_LOGIN_ENDPOINT,
  MANAGED_APP_AUTH_SYNC_ENDPOINT,
  VIBE64_MANAGED_APP_AUTH_CHANGED_EVENT,
  managedAppAuthQueryKey
} from "../lib/managedAppAuthApi.js";

function managedAppAuthResourceQueryKey() {
  return computed(() => managedAppAuthQueryKey(VIBE64_SURFACE_ID, ROUTE_VISIBILITY_PUBLIC, ""));
}

function useManagedAppAuth() {
  const forceRefresh = ref(false);
  const statusResource = useEndpointResource({
    enabled: true,
    fallbackLoadError: "Managed app login status could not load.",
    path: MANAGED_APP_AUTH_ENDPOINT,
    queryKey: managedAppAuthResourceQueryKey(),
    readQuery: computed(() => forceRefresh.value ? { refresh: true } : null),
    realtime: {
      event: VIBE64_MANAGED_APP_AUTH_CHANGED_EVENT
    },
    refreshOnPull: true,
    requestRecoveryLabel: "Managed app login status"
  });

  const connectCommand = useCommand({
    access: "never",
    apiSuffix: "/vibe64/managed-app-auth/connect",
    buildCommandOptions: () => ({
      method: "POST",
      path: MANAGED_APP_AUTH_CONNECT_ENDPOINT
    }),
    buildRawPayload: (_model, { context }) => ({
      accessToken: String(context.accessToken || ""),
      environment: String(context.environment || ""),
      environments: Array.isArray(context.environments) ? context.environments : [],
      organizationSlug: String(context.organizationSlug || ""),
      regionGroup: String(context.regionGroup || "americas")
    }),
    fallbackRunError: "Managed app login token could not be connected.",
    messages: {
      error: "Managed app login token could not be connected.",
      success: "Managed app login token connected."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.managed-app-auth.connect",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const setupCommand = useCommand({
    access: "never",
    apiSuffix: "/vibe64/managed-app-auth/setup",
    buildCommandOptions: () => ({
      method: "POST",
      path: MANAGED_APP_AUTH_SETUP_ENDPOINT
    }),
    buildRawPayload: (_model, { context }) => ({
      accessToken: String(context.accessToken || ""),
      organizationSlug: String(context.organizationSlug || ""),
      regionGroup: String(context.regionGroup || "americas")
    }),
    fallbackRunError: "Managed app login setup failed.",
    messages: {
      error: "Managed app login setup failed.",
      success: "Managed app login setup saved."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.managed-app-auth.setup",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const syncCommand = useCommand({
    access: "never",
    apiSuffix: "/vibe64/managed-app-auth/sync",
    buildCommandOptions: () => ({
      method: "POST",
      path: MANAGED_APP_AUTH_SYNC_ENDPOINT
    }),
    buildRawPayload: (_model, { context }) => ({
      redirectUrls: Array.isArray(context.redirectUrls) ? context.redirectUrls : [],
      siteUrl: String(context.siteUrl || "")
    }),
    fallbackRunError: "Managed app login sync failed.",
    messages: {
      error: "Managed app login sync failed.",
      success: "Managed app login synced."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.managed-app-auth.sync",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const saveSmtpLoginCommand = useCommand({
    access: "never",
    apiSuffix: "/vibe64/managed-app-auth/smtp-login",
    buildCommandOptions: () => ({
      method: "POST",
      path: MANAGED_APP_AUTH_SMTP_LOGIN_ENDPOINT
    }),
    buildRawPayload: (_model, { context }) => ({
      fromEmail: String(context.fromEmail || ""),
      fromName: String(context.fromName || ""),
      smtpHost: String(context.smtpHost || ""),
      smtpPassword: String(context.smtpPassword ?? ""),
      smtpPort: String(context.smtpPort || ""),
      smtpUser: String(context.smtpUser || "")
    }),
    fallbackRunError: "SMTP login could not be saved.",
    messages: {
      error: "SMTP login could not be saved.",
      success: "SMTP login saved."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.managed-app-auth.smtp-login",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const disconnectSmtpLoginCommand = useCommand({
    access: "never",
    apiSuffix: "/vibe64/managed-app-auth/smtp-login/disconnect",
    buildCommandOptions: () => ({
      method: "POST",
      path: MANAGED_APP_AUTH_SMTP_LOGIN_DISCONNECT_ENDPOINT
    }),
    buildRawPayload: () => ({}),
    fallbackRunError: "SMTP login could not be removed.",
    messages: {
      error: "SMTP login could not be removed."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.managed-app-auth.smtp-login.disconnect",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const disconnectCommand = useCommand({
    access: "never",
    apiSuffix: "/vibe64/managed-app-auth/disconnect",
    buildCommandOptions: () => ({
      method: "POST",
      path: MANAGED_APP_AUTH_DISCONNECT_ENDPOINT
    }),
    buildRawPayload: () => ({}),
    fallbackRunError: "Managed app login PAT could not be removed.",
    messages: {
      error: "Managed app login PAT could not be removed."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.managed-app-auth.disconnect",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  async function refresh() {
    forceRefresh.value = true;
    try {
      return await statusResource.reload();
    } finally {
      forceRefresh.value = false;
    }
  }

  async function connect(input = {}) {
    const result = await connectCommand.run(input);
    await statusResource.reload();
    return result;
  }

  async function setup(input = {}) {
    const result = await setupCommand.run(input);
    await statusResource.reload();
    return result;
  }

  async function sync(input = {}) {
    const result = await syncCommand.run(input);
    await statusResource.reload();
    return result;
  }

  async function saveSmtpLogin(input = {}) {
    const result = await saveSmtpLoginCommand.run(input);
    await statusResource.reload();
    return result;
  }

  async function disconnectSmtpLogin() {
    const result = await disconnectSmtpLoginCommand.run({});
    await statusResource.reload();
    return result;
  }

  async function disconnect() {
    const result = await disconnectCommand.run({});
    await statusResource.reload();
    return result;
  }

  return proxyRefs({
    connect,
    connectCommand,
    disconnect,
    disconnectCommand,
    disconnectSmtpLogin,
    disconnectSmtpLoginCommand,
    isLoading: statusResource.isLoading,
    loadError: statusResource.loadError,
    refresh,
    saveSmtpLogin,
    saveSmtpLoginCommand,
    setup,
    setupCommand,
    status: statusResource.data,
    statusResource,
    sync,
    syncCommand
  });
}

export {
  useManagedAppAuth
};
