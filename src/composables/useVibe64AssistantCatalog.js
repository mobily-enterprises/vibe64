import { computed, unref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";

import { VIBE64_ACCOUNTS_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT } from "@local/vibe64-accounts/client";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import {
  VIBE64_ASSISTANTS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64AssistantCapabilitiesQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";

function value(input) {
  return unref(input);
}

function normalizedText(input) {
  return String(value(input) || "").trim();
}

function responseEngines(resource) {
  const payload = resource.data.value;
  return Array.isArray(payload?.engines) ? payload.engines : [];
}

function useVibe64AssistantCatalog({
  active,
  configuredOnly = false,
  allConnectedModels = false,
  engineId,
  modelProviderId,
  modelSearch,
  providerConnectedOnly = false,
  providerCursor,
  providerSearch
} = {}) {
  const paths = usePaths();
  const projectSlug = useVibe64ProjectSlug();
  const apiPath = computed(() => paths.api(VIBE64_ASSISTANTS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const enabled = computed(() => Boolean(value(active)));

  const overview = useEndpointResource({
    enabled,
    fallbackLoadError: "AI choices could not be loaded.",
    path: apiPath,
    queryKey: computed(() => vibe64AssistantCapabilitiesQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      projectSlug.value,
      [
        "overview",
        value(configuredOnly) ? "configured" : normalizedText(engineId) || "all",
        value(providerConnectedOnly) ? "connected" : "all",
        ...(value(allConnectedModels) ? ["all-models"] : [])
      ].join(":")
    )),
    queryOptions: {
      refetchOnMount: true,
      staleTime: value(allConnectedModels) ? 30_000 : 0,
      refetchOnWindowFocus: false
    },
    readQuery: computed(() => ({
      ...(value(configuredOnly) ? { configuredOnly: "true" } : {}),
      ...(value(allConnectedModels) ? { allConnectedModels: "true" } : {}),
      ...(value(providerConnectedOnly) ? { connectedOnly: "true" } : {}),
      ...(!value(configuredOnly) && normalizedText(engineId)
        ? { engineId: normalizedText(engineId) }
        : {}),
      limit: value(configuredOnly) ? "100" : "25"
    })),
    realtime: { events: [VIBE64_ACCOUNTS_CHANGED_EVENT, VIBE64_CONNECTIONS_CHANGED_EVENT] },
    requestRecoveryLabel: "AI choices"
  });

  const providerPage = useEndpointResource({
    enabled: computed(() => (
      enabled.value && !value(configuredOnly) && !value(allConnectedModels) && normalizedText(engineId) === "opencode"
    )),
    fallbackLoadError: "OpenCode providers could not be loaded.",
    path: apiPath,
    queryKey: computed(() => vibe64AssistantCapabilitiesQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      projectSlug.value,
      (normalizedText(providerSearch) || normalizedText(providerCursor) ? [
        "providers",
        value(providerConnectedOnly) ? "connected" : "all",
        normalizedText(providerSearch),
        normalizedText(providerCursor)
      ] : [
        "overview", "opencode", value(providerConnectedOnly) ? "connected" : "all"
      ]).join(":")
    )),
    queryOptions: {
      refetchOnMount: "always",
      refetchOnWindowFocus: false
    },
    readQuery: computed(() => ({
      ...(value(providerConnectedOnly) ? { connectedOnly: "true" } : {}),
      ...(normalizedText(providerCursor) ? { cursor: normalizedText(providerCursor) } : {}),
      engineId: "opencode",
      limit: "25",
      ...(normalizedText(providerSearch) ? { search: normalizedText(providerSearch) } : {})
    })),
    requestRecoveryLabel: "OpenCode providers"
  });

  const modelPage = useEndpointResource({
    enabled: computed(() => Boolean(
      enabled.value &&
      !value(configuredOnly) && !value(allConnectedModels) &&
      normalizedText(engineId) &&
      normalizedText(modelProviderId)
    )),
    fallbackLoadError: "Provider models could not be loaded.",
    path: apiPath,
    queryKey: computed(() => vibe64AssistantCapabilitiesQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      projectSlug.value,
      [
        "models",
        normalizedText(engineId),
        normalizedText(modelProviderId),
        value(providerConnectedOnly) ? "connected" : "all",
        normalizedText(modelSearch)
      ].join(":")
    )),
    queryOptions: {
      refetchOnMount: "always",
      refetchOnWindowFocus: false
    },
    readQuery: computed(() => ({
      ...(value(providerConnectedOnly) ? { connectedOnly: "true" } : {}),
      engineId: normalizedText(engineId),
      limit: "100",
      modelProviderId: normalizedText(modelProviderId),
      ...(normalizedText(modelSearch) ? { search: normalizedText(modelSearch) } : {})
    })),
    requestRecoveryLabel: "Provider models"
  });

  const overviewEngines = computed(() => responseEngines(overview));
  const providerEngine = computed(() => responseEngines(providerPage)[0] || null);
  const modelEngine = computed(() => responseEngines(modelPage)[0] || null);
  const selectedOverviewEngine = computed(() => overviewEngines.value.find((engine) => (
    String(engine?.engineId || "") === normalizedText(engineId)
  )) || null);
  const selectedEngine = computed(() => (
    modelEngine.value || providerEngine.value || selectedOverviewEngine.value
  ));
  const selectedProvider = computed(() => {
    const providerId = normalizedText(modelProviderId);
    const sources = [
      ...(modelEngine.value?.modelProviders || []),
      ...(providerEngine.value?.modelProviders || []),
      ...(selectedOverviewEngine.value?.modelProviders || [])
    ];
    return sources.find((provider) => String(provider?.id || "") === providerId) || null;
  });

  async function reload() {
    const requests = [overview.reload()];
    if (!value(configuredOnly) && !value(allConnectedModels)) {
      // Without a search or cursor, the provider page shares the overview query.
      if (
        normalizedText(engineId) === "opencode" &&
        (normalizedText(providerSearch) || normalizedText(providerCursor))
      ) {
        requests.push(providerPage.reload());
      }
      if (normalizedText(modelProviderId)) {
        requests.push(modelPage.reload());
      }
    }
    await Promise.all(requests);
  }

  return {
    apiPath,
    engines: overviewEngines,
    modelEngine,
    modelPage,
    overview,
    providerEngine,
    providerPage,
    reload,
    selectedEngine,
    selectedOverviewEngine,
    selectedProvider
  };
}

export {
  useVibe64AssistantCatalog
};
