import { computed, ref, unref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import {
  AI_CONNECTIONS_ENDPOINT,
  VIBE64_CONNECTIONS_CHANGED_EVENT
} from "../lib/accountsGateApi.js";

import { vibe64ResourceResponseError } from "/src/lib/vibe64ApiResponses.js";
import { VIBE64_SURFACE_ID } from "/src/lib/vibe64RequestConfig.js";

function useAiConnections({
  endpoint = AI_CONNECTIONS_ENDPOINT,
  catalogProviderId = "",
  enabled = true
} = {}) {
  function providerPath(providerId = "", suffix = "") {
    return `${endpoint}/${encodeURIComponent(String(providerId || "").trim())}${suffix}`;
  }
  const normalizedCatalogProviderId = computed(() => String(
    unref(catalogProviderId) || ""
  ).trim());
  const resource = useEndpointResource({
    enabled: computed(() => Boolean(unref(enabled))),
    fallbackLoadError: "AI provider connections could not be loaded.",
    path: endpoint,
    queryKey: ["vibe64", "ai-connections", endpoint],
    queryOptions: {
      refetchOnMount: "always",
      refetchOnWindowFocus: false
    },
    realtime: {
      event: VIBE64_CONNECTIONS_CHANGED_EVENT
    },
    refreshOnPull: true,
    requestRecoveryLabel: "AI provider connections"
  });
  const catalogResource = useEndpointResource({
    enabled: false,
    fallbackLoadError: "OpenCode providers could not be loaded.",
    path: `${endpoint}/catalog`,
    queryKey: computed(() => [
      "vibe64",
      "ai-connections",
      endpoint,
      "assistant-capabilities",
      "opencode-provider",
      normalizedCatalogProviderId.value || "none"
    ]),
    queryOptions: {
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
      retry: false
    },
    readQuery: computed(() => ({
      engineId: "opencode",
      limit: "100",
      modelProviderId: normalizedCatalogProviderId.value
    })),
    requestRecoveryLabel: "OpenCode providers"
  });
  const registryResource = useEndpointResource({
    enabled: false,
    fallbackLoadError: "OpenCode providers could not be loaded.",
    path: `${endpoint}/catalog`,
    queryKey: [
      "vibe64",
      "ai-connections",
      endpoint,
      "assistant-capabilities",
      "opencode-providers"
    ],
    queryOptions: {
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
      retry: false
    },
    readQuery: computed(() => ({
      engineId: "opencode"
    })),
    requestRecoveryLabel: "OpenCode providers"
  });
  const saveCommand = useCommand({
    access: "never",
    apiSuffix: endpoint.replace(/^\/api/u, ""),
    buildCommandOptions: (_model, { context }) => ({
      method: "PATCH",
      path: providerPath(context?.providerId)
    }),
    buildRawPayload: (_model, { context }) => ({
      apiKey: String(context?.apiKey || ""),
      label: String(context?.label || ""),
      providerRevision: String(context?.providerRevision || "")
    }),
    fallbackRunError: "The AI provider key could not be saved.",
    fieldErrorKeys: ["apiKey"],
    messages: {
      error: "The AI provider key could not be saved.",
      success: "AI provider connected."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.account.ai-connections.save",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "PATCH"
  });
  const removeCommand = useCommand({
    access: "never",
    apiSuffix: endpoint.replace(/^\/api/u, ""),
    buildCommandOptions: (_model, { context }) => ({
      method: "POST",
      path: providerPath(context?.providerId, "/remove")
    }),
    buildRawPayload: () => ({}),
    fallbackRunError: "The AI provider connection could not be removed.",
    messages: {
      error: "The AI provider connection could not be removed.",
      success: "AI provider disconnected."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.account.ai-connections.remove",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
  const modelAccessCommand = useCommand({
    access: "never",
    apiSuffix: endpoint.replace(/^\/api/u, ""),
    buildCommandOptions: (_model, { context }) => ({
      method: "PATCH",
      path: providerPath(context?.providerId, "/model-access")
    }),
    buildRawPayload: (_model, { context }) => {
      const operation = String(context?.operation || "");
      return {
        operation,
        ...(["disable-additional", "enable-all"].includes(operation)
          ? { unlocked: operation === "enable-all" }
          : {})
      };
    },
    fallbackRunError: "Provider model access could not be changed.",
    messages: {
      error: "Provider model access could not be changed.",
      success: "Provider model access updated."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.account.ai-connections.model-access",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "PATCH"
  });
  const savingProviderId = ref("");
  const removingProviderId = ref("");
  const updatingModelAccessProviderId = ref("");
  const connections = computed(() => (
    Array.isArray(resource.data.value?.connections) ? resource.data.value.connections : []
  ));
  function openCodeEngine(data = null) {
    const engines = Array.isArray(data?.engines) ? data.engines : [];
    return engines.find((engine) => String(engine?.engineId || "") === "opencode") || null;
  }
  const catalogEngine = computed(() => openCodeEngine(catalogResource.data.value));
  const catalogProviders = computed(() => (
    Array.isArray(catalogEngine.value?.modelProviders)
      ? catalogEngine.value.modelProviders
      : []
  ));
  const catalogProvider = computed(() => catalogProviders.value.find((provider) => (
    String(provider?.id || "") === normalizedCatalogProviderId.value
  )) || null);
  const catalogLoadError = computed(() => (
    vibe64ResourceResponseError(
      catalogResource.data.value,
      "OpenCode providers could not be loaded."
    ) || catalogResource.loadError.value
  ));
  const registryProviders = computed(() => {
    const engine = openCodeEngine(registryResource.data.value);
    return Array.isArray(engine?.modelProviders) ? engine.modelProviders : [];
  });
  const registryLoadError = computed(() => (
    vibe64ResourceResponseError(
      registryResource.data.value,
      "OpenCode providers could not be loaded."
    ) || registryResource.loadError.value
  ));
  const loadError = computed(() => (
    vibe64ResourceResponseError(
      resource.data.value,
      "AI provider connections could not be loaded."
    ) || resource.loadError.value
  ));

  async function saveConnection(input = {}) {
    const providerId = String(input.providerId || input.modelProviderId || "").trim();
    if (!providerId || savingProviderId.value) {
      return null;
    }
    savingProviderId.value = providerId;
    try {
      const response = await saveCommand.run({ ...input, providerId });
      if (response?.ok !== false) {
        await resource.reload();
      }
      return response;
    } finally {
      savingProviderId.value = "";
    }
  }

  async function removeConnection(providerId = "") {
    const id = String(providerId || "").trim();
    if (!id || removingProviderId.value) {
      return null;
    }
    removingProviderId.value = id;
    try {
      const response = await removeCommand.run({ providerId: id });
      if (response?.ok !== false) {
        await resource.reload();
      }
      return response;
    } finally {
      removingProviderId.value = "";
    }
  }

  async function updateModelAccess(providerId = "", operation = "") {
    const id = String(providerId || "").trim();
    const requestedOperation = String(operation || "").trim();
    if (!id || !requestedOperation || updatingModelAccessProviderId.value) {
      return null;
    }
    updatingModelAccessProviderId.value = id;
    try {
      const response = await modelAccessCommand.run({
        operation: requestedOperation,
        providerId: id
      });
      if (response?.ok !== false) {
        await resource.reload();
      }
      return response;
    } finally {
      updatingModelAccessProviderId.value = "";
    }
  }

  return {
    catalogEngine,
    catalogLoadError,
    catalogProvider,
    connections,
    isInitialLoading: resource.isInitialLoading,
    loadError,
    reload: resource.reload,
    reloadCatalog: catalogResource.reload,
    reloadRegistry: registryResource.reload,
    removeConnection,
    removingProviderId,
    registryIsFetching: registryResource.isFetching,
    registryIsInitialLoading: registryResource.isInitialLoading,
    registryLoadError,
    registryProviders,
    saveConnection,
    savingProviderId,
    updateModelAccess,
    updatingModelAccessProviderId
  };
}

export {
  useAiConnections
};
