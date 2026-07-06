import { computed, proxyRefs, ref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";

import {
  VIBE64_SURFACE_ID
} from "/src/lib/vibe64RequestConfig.js";

const VIBE64_MANAGED_APP_AUTH_CHANGED_EVENT = "vibe64.managed-app-auth.changed";

function useManagedAppAuthController({
  apiSuffixBase = "",
  endpoints = {},
  fallbackLabel = "Managed app login",
  placementSourceBase = "vibe64.managed-app-auth",
  queryKey = computed(() => ["vibe64", "managed-app-auth"]),
  realtimeEvent = VIBE64_MANAGED_APP_AUTH_CHANGED_EVENT
} = {}) {
  const forceRefresh = ref(false);
  const statusResource = useEndpointResource({
    enabled: true,
    fallbackLoadError: `${fallbackLabel} status could not load.`,
    path: endpoints.status,
    queryKey,
    readQuery: computed(() => forceRefresh.value ? { refresh: true } : null),
    realtime: {
      event: realtimeEvent
    },
    refreshOnPull: true,
    requestRecoveryLabel: `${fallbackLabel} status`
  });

  const connectCommand = useCommand({
    access: "never",
    apiSuffix: `${apiSuffixBase}/connect`,
    buildCommandOptions: () => ({
      method: "POST",
      path: endpoints.connect
    }),
    buildRawPayload: (_model, { context }) => ({
      accessToken: String(context.accessToken || ""),
      environment: String(context.environment || ""),
      environments: Array.isArray(context.environments) ? context.environments : [],
      organizationSlug: String(context.organizationSlug || ""),
      regionGroup: String(context.regionGroup || "americas")
    }),
    fallbackRunError: `${fallbackLabel} token could not be connected.`,
    messages: {
      error: `${fallbackLabel} token could not be connected.`,
      success: `${fallbackLabel} token connected.`
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: `${placementSourceBase}.connect`,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const setupCommand = useCommand({
    access: "never",
    apiSuffix: `${apiSuffixBase}/setup`,
    buildCommandOptions: () => ({
      method: "POST",
      path: endpoints.setup
    }),
    buildRawPayload: (_model, { context }) => ({
      accessToken: String(context.accessToken || ""),
      environment: String(context.environment || ""),
      environments: Array.isArray(context.environments) ? context.environments : [],
      organizationSlug: String(context.organizationSlug || ""),
      regionGroup: String(context.regionGroup || "americas")
    }),
    fallbackRunError: `${fallbackLabel} setup failed.`,
    messages: {
      error: `${fallbackLabel} setup failed.`,
      success: `${fallbackLabel} setup saved.`
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: `${placementSourceBase}.setup`,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const syncCommand = useCommand({
    access: "never",
    apiSuffix: `${apiSuffixBase}/sync`,
    buildCommandOptions: () => ({
      method: "POST",
      path: endpoints.sync
    }),
    buildRawPayload: (_model, { context }) => ({
      redirectUrls: Array.isArray(context.redirectUrls) ? context.redirectUrls : [],
      siteUrl: String(context.siteUrl || "")
    }),
    fallbackRunError: `${fallbackLabel} sync failed.`,
    messages: {
      error: `${fallbackLabel} sync failed.`,
      success: `${fallbackLabel} synced.`
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: `${placementSourceBase}.sync`,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const saveSmtpLoginCommand = useCommand({
    access: "never",
    apiSuffix: `${apiSuffixBase}/smtp-login`,
    buildCommandOptions: () => ({
      method: "POST",
      path: endpoints.smtpLogin
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
    placementSource: `${placementSourceBase}.smtp-login`,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const disconnectSmtpLoginCommand = useCommand({
    access: "never",
    apiSuffix: `${apiSuffixBase}/smtp-login/disconnect`,
    buildCommandOptions: () => ({
      method: "POST",
      path: endpoints.smtpLoginDisconnect
    }),
    buildRawPayload: () => ({}),
    fallbackRunError: "SMTP login could not be removed.",
    messages: {
      error: "SMTP login could not be removed."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: `${placementSourceBase}.smtp-login.disconnect`,
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const disconnectCommand = useCommand({
    access: "never",
    apiSuffix: `${apiSuffixBase}/disconnect`,
    buildCommandOptions: () => ({
      method: "POST",
      path: endpoints.disconnect
    }),
    buildRawPayload: () => ({}),
    fallbackRunError: `${fallbackLabel} PAT could not be removed.`,
    messages: {
      error: `${fallbackLabel} PAT could not be removed.`
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: `${placementSourceBase}.disconnect`,
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
  useManagedAppAuthController
};
